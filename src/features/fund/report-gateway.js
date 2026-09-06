import {classifyFundReport,validReportDate,unionReportEntries} from './report-selection.js';

export function createFundReportGateway({captureConnection,read,readDirectory,now=Date.now,isOffline=()=>false,timeoutMs=30000}) {
  if(typeof captureConnection!=='function' || typeof read!=='function' || (readDirectory!==undefined && typeof readDirectory!=='function') || !Number.isFinite(timeoutMs) || timeoutMs<=0)
    throw new TypeError('invalid_configuration');
  let epoch=0,revision=Symbol(),ready=false,disposed=false;
  const entries=new Map();
  function reset(nextReady=false) {
    epoch++;ready=nextReady;for(const e of entries.values()) e.cancel?.();entries.clear();
  }
  function connection() {
    let c;try {c=disposed?null:captureConnection();} catch {c=null;}
    const next=c?.ready===true && c.revision!=null, rev=next?c.revision:null;
    if(rev!==revision || next!==ready) {reset(next);revision=rev;}
    return next?c:{ready:false};
  }
  function entry(name) {
    if(name!=='report-index.json' && !classifyFundReport({name})) throw new TypeError('invalid_report_path');
    if(!entries.has(name)) entries.set(name,{data:null,state:'idle',error:null,loading:false,
      lastAttemptAt:null,lastSuccessAt:null,fetchedAt:null,attemptId:0,sources:null,epoch,inflight:null,cancel:null});
    return entries.get(name);
  }
  const envelope=(name,e)=>Object.freeze({name,data:e.data,state:disposed?'disposed':!ready?'disconnected':e.state,
    error:e.error,sources:e.sources,loading:e.loading,lastAttemptAt:e.lastAttemptAt,lastSuccessAt:e.lastSuccessAt,
    fetchedAt:e.fetchedAt,attemptId:e.attemptId,epoch:e.epoch});
  function snapshot(name) {connection();return envelope(name,entry(name));}
  function parse(name,text) {
    if(typeof text!=='string' || !text.trim()) throw new Error('invalid_body');
    if(name!=='report-index.json') return text;
    const json=JSON.parse(text);
    const stamp=typeof json?.generatedAt==='string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/.exec(json.generatedAt);
    if(!json || !Array.isArray(json.files) || !stamp || !validReportDate(stamp[1]) ||
      Number(stamp[2])>23 || Number(stamp[3])>59 || Number(stamp[4])>59) throw new Error('invalid_index');
    // Keep explicit metadata, including mismatches, so consumers cannot silently reclassify it.
    const files=json.files.filter(e=>e && typeof e.name==='string' && e.name).map(e=>Object.freeze({name:e.name,type:'file',
      ...(Object.hasOwn(e,'kind')?{kind:e.kind}:{}),...(Object.hasOwn(e,'date')?{date:e.date}:{})}));
    if(json.files.length && !files.length && !json.files.some(e=>e && typeof e.name==='string')) throw new Error('invalid_index');
    return Object.freeze({generatedAt:json.generatedAt,files:Object.freeze(files)});
  }
  function indexCondition(index) {
    // parse() already validated strict UTC components; never invoke implementation-dependent string Date.
    const [date,time]=index.generatedAt.slice(0,-1).split('T'),[y,m,d]=date.split('-').map(Number);
    const [hour,minute,seconds]=time.split(':'),[whole,fraction='']=seconds.split('.'),stamp=new Date(0);
    stamp.setUTCFullYear(y,m-1,d);stamp.setUTCHours(+hour,+minute,+whole,+fraction.padEnd(3,'0').slice(0,3));
    const stale=now()-stamp.getTime()>48*60*60*1000,empty=index.files.length===0;
    return stale?(empty?'stale_empty':'stale'):empty?'empty':'available';
  }
  async function obtain(name,c,signal,force) {
    const options={context:c.readContext,signal};
    const safe=async fn=>{try {return signal.aborted?{ok:false,status:0}:await fn();} catch {return {ok:false,status:0};}};
    const result=await safe(()=>read(name,options));
    if(name!=='report-index.json' || !readDirectory) return result;
    let index=null,indexState='failed';
    if(result?.ok && result.status>=200 && result.status<300) {
      try {index=parse(name,result.text);indexState=indexCondition(index);} catch {indexState='invalid';}
    }
    if(index && indexState==='available' && !force) return {...result,parsed:index,sources:Object.freeze({index:indexState,directory:'not_requested'})};
    if(signal.aborted) return {boundary:'cancelled'};
    const directory=await safe(()=>readDirectory(options));
    let files=null,directoryState='failed';
    if(directory?.ok && directory.status>=200 && directory.status<300) {
      try {
        const raw=JSON.parse(directory.text);
        if(!Array.isArray(raw) || raw.some(e=>!e || typeof e.name!=='string' || typeof e.type!=='string')) throw new Error();
        files=raw.filter(e=>e.type==='file').map(e=>({name:e.name,type:'file'}));directoryState='available';
      } catch {directoryState='invalid';}
    }
    const sources=Object.freeze({index:indexState,directory:directoryState});
    if(index || files) {
      const merged=unionReportEntries(index?.files,files).map(e=>Object.freeze(e));
      return {ok:true,status:200,parsed:Object.freeze({generatedAt:index?.generatedAt??null,files:Object.freeze(merged)}),sources};
    }
    return {...result,sources};
  }
  function load(name,{force=false,maxAgeMs=1800000}={}) {
    const c=connection(),e=entry(name);
    if(!c.ready || disposed) return Promise.resolve(envelope(name,e));
    if(e.inflight) return e.inflight;
    if(!force && e.state==='available' && e.lastSuccessAt!==null && now()-e.lastSuccessAt<maxAgeMs)
      return Promise.resolve(envelope(name,e));
    e.loading=true;e.lastAttemptAt=now();e.attemptId++;
    const requestEpoch=epoch,attempt=e.attemptId,controller=new AbortController();
    let stop,timer;
    const boundary=new Promise(resolve=>{stop=reason=>resolve({boundary:reason});});
    e.cancel=()=>{stop('cancelled');controller.abort();};
    timer=setTimeout(()=>{stop('timeout');controller.abort();},timeoutMs);
    const work=Promise.resolve().then(()=>controller.signal.aborted?{boundary:'cancelled'}:
      obtain(name,c,controller.signal,force)).catch(()=>({ok:false,status:0}));
    e.inflight=(async()=>{
      try {
        const r=await Promise.race([work,boundary]);connection();
        if(disposed || epoch!==requestEpoch || entries.get(name)!==e || e.attemptId!==attempt)
          return Object.freeze({...snapshot(name),discarded:true});
        e.fetchedAt=now();e.sources=r?.sources??null;
        if(r?.boundary) {e.state='failed';e.error=r.boundary;}
        else if(r?.ok===true && r.status>=200 && r.status<300) {
          try {e.data=r.parsed??parse(name,r.text);e.state='available';e.error=null;e.lastSuccessAt=now();}
          catch {e.state='invalid';e.error='invalid_body';}
        } else {
          let offline=false;try {offline=isOffline()===true;} catch { /* unknown */ }
          e.state=r?.status===404?'missing':r?.status===401||r?.status===403?'unauthorized':
            (!r?.status && offline)?'offline':'failed';
          e.error=e.state==='missing'?'not_found':e.state==='unauthorized'?'access_denied':
            e.state==='offline'?'offline':'read_failed';
        }
        e.loading=false;return envelope(name,e);
      } finally {clearTimeout(timer);e.loading=false;e.inflight=null;e.cancel=null;}
    })();
    return e.inflight;
  }
  return Object.freeze({snapshot,load,resetConnection(){reset();revision=Symbol();},dispose(){disposed=true;reset();}});
}

