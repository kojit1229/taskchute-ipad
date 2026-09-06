import {createQueueGateway} from './queue-gateway.js';
import {validateRequest,canonical} from './request-contract.js';
import {prefix,validateResult,validateArtifact} from './feedback-result.js';
// Memory-only receipts belong to one HTTP generation. Never serialize into app state.
export function createFeedbackUiGateway({http,crypto,today}={}) {
 if(!http?.get||!http?.put||!http?.connectionKey||!crypto?.subtle||typeof today!=='function')throw Error('ui_gateway_configuration');
 let generation=null;const proofs=new Map();
 function key(){const next=http.connectionKey();if(next!==generation){proofs.clear();generation=next;}return next;}
 function guard(start){if(key()!==start)throw Error('connection_changed');}
 async function json(path,start){const reply=await http.get(path,{fresh:true});guard(start);if(reply.status===404)return null;
  if(reply.status!==200||typeof reply.sha!=='string'||!reply.bytes||reply.bytes.byteLength>524288)throw Error('read_unconfirmed');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reply.bytes));}
 async function request(id,start){const value=await json(prefix+`requests/${id}.json`,start);if(!value)throw Error('request_missing');
  const r=await validateRequest(value,today(),crypto);guard(start);if(r.requestId!==id)throw Error('request_identity_mismatch');return r;}
 const queue=()=>createQueueGateway({transport:http,crypto,today,confirmSavedInput:async r=>{
  const start=key(),proof=proofs.get(r.requestId);if(!proof||canonical(proof.date,proof.snapshot)!==canonical(r.date,r.snapshot))throw Error('saved_input_unconfirmed');
  guard(start);return {date:r.date,inputHash:r.inputHash};}});
 return {
  key,
  async dates(){const start=key(),entries=(await queue().readQueue()).entries;guard(start);return [...new Set(entries.map(x=>x.date))].sort().reverse();},
  rememberProven(r){key();proofs.set(r.requestId,structuredClone(r));},
  async history(date){const start=key(),entries=(await queue().readQueue()).entries;guard(start);const rows=[];
   for(const entry of entries.filter(x=>x.date===date).sort((a,b)=>b.sequence-a.sequence)) {
    let r;try{r=await request(entry.requestId,start);}catch(error){guard(start);rows.push({entry,status:'unconfirmed',reason:'request_unconfirmed'});continue;}
    for(let attempt=entry.attempt;attempt>=1;attempt--) {
     let result=null;try{const raw=await json(prefix+`results/${entry.requestId}/${attempt}.json`,start);if(raw)result=validateResult(raw,entry,attempt);
      rows.push({entry:{...entry,attempt},request:r,result,status:result?.status||(attempt===entry.attempt?'queued':'unconfirmed')});
     }catch(error){guard(start);rows.push({entry:{...entry,attempt},request:r,status:'unconfirmed',reason:'result_unconfirmed'});}
    }
   }
   guard(start);return rows;
  },
  async artifact(row){const start=key();if(row.result?.status!=='succeeded')throw Error('success_unconfirmed');
   const result=validateResult(row.result,row.entry,row.entry.attempt);
   const reply=await http.get('taskchute/'+result.artifactPath,{fresh:true});guard(start);
   if(reply.status!==200)throw Error('artifact_missing');const text=await validateArtifact(reply.text,result,crypto);guard(start);return text;
  },
  async resume(id){const start=key();let r=proofs.get(id);
   // A remotely validated immutable request proves this captured input was already sent.
   if(!r)r=await request(id,start);guard(start);proofs.set(id,r);const result=await queue().enqueue(r);guard(start);return result;
  },
  async retry(id,attempt){const start=key();const result=await queue().retry(id,attempt);guard(start);return result;}
 };
}
