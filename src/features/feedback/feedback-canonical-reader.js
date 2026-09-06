import {validDate,stamp as parseTimestamp} from './feedback-result.js';
// Only names observed in this connection's index/directory authorize a body GET.
export function createFeedbackCanonicalReader({http,onUpdate=()=>{},now=Date.now}={}) {
 if(!http||typeof http.get!=='function'||typeof http.connectionKey!=='function')throw Error('canonical_configuration');
 let key=null,epoch=0,indexFiles=null,directoryFiles=null,files=null,pending=null;
 let sources={index:'idle',directory:'idle'};const bodies=new Map();
 function reset(next){key=next;epoch++;indexFiles=null;directoryFiles=null;files=null;pending=null;sources={index:'idle',directory:'idle'};bodies.clear();}
 function check(){const next=http.connectionKey();if(next!==key)reset(next);return key;}
 function known(name){const match=/^AIフィードバック_(\d{4}-\d{2}-\d{2})\.md$/.exec(name||'');return match&&validDate(match[1])?{name,date:match[1]}:null;}
 function parse(result,directory){
  if(result?.status!==200)throw Error('canonical_read_unconfirmed');
  const data=directory?result.entries:JSON.parse(result.text);
  if(!directory){const stamp=parseTimestamp(data?.generatedAt);if(!Number.isFinite(stamp)||now()-stamp>48*60*60*1000)throw Error('canonical_index_invalid_or_stale');}
  const entries=directory?data:data?.files;
  if(!Array.isArray(entries))throw Error('canonical_list_invalid');
  const found=new Map();
  for(const entry of entries){
   const name=typeof entry==='string'?entry:entry?.name,file=known(name);if(!file)continue;
   if(directory&&(entry?.type!=='file'||entry.path!=='taskchute/'+name))continue;
   if(!directory&&typeof entry==='object'&&entry.type!==undefined&&entry.type!=='file')continue;
   found.set(name,file);
  }
  if(!directory&&!found.size)throw Error('canonical_index_empty');
  return [...found.values()];
 }
 async function list(){
  const captured=check();if(pending)return pending;
  const run=epoch,current=()=>check()===captured&&epoch===run;
  const work=(async()=>{
   const results=await Promise.allSettled([
    http.get({kind:'canonical-index'},{context:{isCurrent:current}}),
    http.get({kind:'canonical-directory'},{context:{isCurrent:current}})
   ]);
   if(!current())return;
   for(let i=0;i<2;i++){
    const label=i?'directory':'index';
    try{const result=results[i];if(result.status!=='fulfilled')throw Error('canonical_read_failed');const next=parse(result.value,i===1);if(i)directoryFiles=next;else indexFiles=next;sources[label]='ready';}
    catch{sources[label]='failed';}
   }
   if(indexFiles!==null||directoryFiles!==null)files=[...new Map([...(indexFiles||[]),...(directoryFiles||[])].map(x=>[x.name,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
  })();
  pending=work;
  try{await work;}finally{if(current()&&pending===work){pending=null;onUpdate();}}
 }
 async function load(file,force=false){
  const captured=check(),run=epoch;
  if(!files?.some(x=>x.name===file.name))return;
  let entry=bodies.get(file.name);
  if(!entry){entry={text:null,state:'idle',pending:null};bodies.set(file.name,entry);}
  if(entry.pending)return entry.pending;
  if(!force&&entry.state!=='idle')return;
  const current=()=>check()===captured&&epoch===run&&bodies.get(file.name)===entry;
  entry.state='loading';
  const work=(async()=>{
   try{const result=await http.get({kind:'canonical-file',name:file.name},{context:{isCurrent:current}});if(!current())return;
    if(result?.status!==200||typeof result.text!=='string')throw Error('canonical_body_unconfirmed');entry.text=result.text;entry.state='ready';
   }catch{if(current())entry.state='failed';}
  })();entry.pending=work;
  try{await work;}finally{if(current()&&entry.pending===work){entry.pending=null;onUpdate();}}
 }
 function listed(){check();if(files===null&&!pending&&sources.index==='idle')void list();return files===null?null:files.map(x=>({...x}));}
 function body(date){check();if(!validDate(date))return null;const file=listed()?.find(x=>x.date===date);if(!file)return null;void load(file);return bodies.get(file.name)?.text??null;}
 return {
  files:listed,body,
  invalidate(){reset(http.connectionKey());},
  async refresh(date){const captured=check(),run=epoch;await list();if(check()!==captured||epoch!==run)return;if(validDate(date)){const file=files?.find(x=>x.date===date);if(file)await load(file,true);}},
  status(date){check();const file=files?.find(x=>x.date===date),entry=file?bodies.get(file.name):null;
   return {loading:Boolean(pending||entry?.pending),failed:sources.index==='failed'||sources.directory==='failed'||entry?.state==='failed',hasBody:typeof entry?.text==='string'};
  }
 };
}
