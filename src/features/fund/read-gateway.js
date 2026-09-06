import { FUND_SOURCES, validateFundSource, fundMetadata } from './read-contract.js';

const freeze = value => {
  if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function createFundReadGateway({captureConnection,read,now=Date.now,isOffline=()=>false,timeoutMs=30000}) {
  if(typeof captureConnection!=='function' || typeof read!=='function' || !Number.isFinite(timeoutMs) || timeoutMs<=0)
    throw new TypeError('invalid_configuration');
  let epoch=0, revision=Symbol('initial'), ready=false, disposed=false;
  const entries=new Map();
  const fresh=()=>({data:null,state:'idle',loading:false,error:null,fetchedAt:null,lastAttemptAt:null,
    lastSuccessAt:null,epoch,attemptId:0,inflight:null,cancel:null});
  const sourceKey=source=>{if(!Object.hasOwn(FUND_SOURCES,source)) throw new TypeError('invalid_source');};
  function reset(nextReady=false) {
    epoch++; ready=nextReady;
    for(const entry of entries.values()) entry.cancel?.();
    entries.clear();
  }
  function connection() {
    if(disposed) return {ready:false};
    let conn;
    try { conn=captureConnection(); } catch { conn=null; }
    const nextReady=conn?.ready===true && conn.revision!=null;
    const nextRevision=nextReady?conn.revision:null;
    if(nextRevision!==revision || ready!==nextReady) { reset(nextReady); revision=nextRevision; }
    return nextReady?conn:{ready:false};
  }
  function entryFor(source) {
    if(!entries.has(source)) entries.set(source,fresh());
    return entries.get(source);
  }
  function envelope(source,entry) {
    return {data:entry.data,metadata:entry.data?fundMetadata(source,entry.data,now()):null,
      state:disposed?'disposed':!ready?'disconnected':entry.state,loading:entry.loading,error:entry.error,
      fetchedAt:entry.fetchedAt,lastAttemptAt:entry.lastAttemptAt,lastSuccessAt:entry.lastSuccessAt,
      epoch:entry.epoch,attemptId:entry.attemptId};
  }
  function snapshot(source) { sourceKey(source); connection(); return envelope(source,entryFor(source)); }
  function load(source,{force=false,maxAgeMs=1800000}={}) {
    sourceKey(source);
    const conn=connection(), entry=entryFor(source);
    if(!conn.ready || disposed) return Promise.resolve(envelope(source,entry));
    if(entry.inflight) return entry.inflight;
    if(!force && entry.state==='available' && entry.lastSuccessAt!==null && now()-entry.lastSuccessAt<maxAgeMs)
      return Promise.resolve(envelope(source,entry));
    entry.loading=true; entry.lastAttemptAt=now(); entry.attemptId++;
    const requestEpoch=epoch, attemptId=entry.attemptId, controller=new AbortController();
    let timer, stop;
    const boundary=new Promise(resolve=>{stop=reason=>resolve({boundary:reason});});
    entry.cancel=()=>{stop('cancelled');controller.abort();};
    timer=setTimeout(()=>{stop('timeout');controller.abort();},timeoutMs);
    const readWork=Promise.resolve().then(()=>controller.signal.aborted?{boundary:'cancelled'}:
      read(FUND_SOURCES[source],{context:conn.readContext,signal:controller.signal}))
      .catch(()=>({ok:false,status:0}));
    entry.inflight=(async()=>{
      try {
        const response=await Promise.race([readWork,boundary]);
        connection();
        if(disposed || epoch!==requestEpoch || entries.get(source)!==entry || entry.attemptId!==attemptId)
          return {...snapshot(source),discarded:true};
        entry.fetchedAt=now();
        if(response?.boundary) { entry.state='failed'; entry.error=response.boundary==='timeout'?'timeout':'cancelled'; }
        else if(response?.ok===true && response.status>=200 && response.status<300) {
          let parsed,valid;
          try { parsed=JSON.parse(response.text); } catch { entry.state='invalid';entry.error='invalid_json';return envelope(source,entry); }
          try { valid=validateFundSource(source,parsed); } catch { valid={ok:false}; }
          if(!valid.ok) {entry.state='invalid';entry.error='invalid_shape';}
          else {
            entry.data=freeze(parsed); entry.state='available'; entry.error=null; entry.lastSuccessAt=now();
          }
        } else {
          const status=response?.status;
          entry.state=status===404?'not_created':status===401||status===403?'unauthorized':'failed';
          let offline=false;try {offline=isOffline()===true;} catch { /* unknown network state */ }
          if((status===0 || status==null) && offline) entry.state='offline';
          entry.error=entry.state==='not_created'?'not_found':entry.state==='unauthorized'?'access_denied':
            entry.state==='offline'?'offline':'read_failed';
        }
        return envelope(source,entry);
      } catch {
        connection();
        if(disposed || epoch!==requestEpoch || entries.get(source)!==entry) return {...snapshot(source),discarded:true};
        entry.state='failed';entry.error='read_failed';return envelope(source,entry);
      } finally {
        clearTimeout(timer); entry.loading=false;entry.inflight=null;entry.cancel=null;
      }
    })().then(result=>result.discarded?result:({...result,loading:false}));
    return entry.inflight;
  }
  function resetConnection() { reset(false);revision=Symbol('reset'); }
  function dispose() {disposed=true;reset(false);}
  return Object.freeze({snapshot,load,refreshAll:()=>Promise.all(Object.keys(FUND_SOURCES).map(s=>load(s,{force:true}))),resetConnection,dispose});
}
