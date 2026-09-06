import {validDate,stamp} from './feedback-result.js';
// Controller never writes journal/report/feedback state. Input preparation belongs to existing entry.
export function createFeedbackUiController({gateway,startEntry,onUpdate,now=()=>Date.now(),currentHash=async()=>null}={}) {
 if(!gateway||typeof startEntry!=='function'||typeof onUpdate!=='function')throw Error('ui_configuration');
 let inputRevision=0,readRevision=0;
 let epoch=0,date=null,connection=null,busy=false,rows=[],status='idle',lastAttemptAt=null,lastGoodAt=null,selected='original',pending=null,hash=null;
 const artifacts=new Map();
 const id=row=>`${row.entry.requestId}/${row.entry.attempt}`;
 function changed(){onUpdate(snapshot());}
 function syncConnection(){const key=gateway.key();if(key!==connection){connection=key;epoch++;rows=[];artifacts.clear();pending=null;selected='original';lastGoodAt=null;lastAttemptAt=null;hash=null;status='idle';busy=false;}return key;}
 function snapshot(){syncConnection();return structuredClone({date,busy,rows,status,lastAttemptAt,lastGoodAt,selected,pending,currentHash:hash,
  versions:[...artifacts.entries()].map(([key,value])=>({key,...value})),now:now()});}
 function context(){syncConnection();const e=++epoch,d=date,c=connection;return ()=>epoch===e&&date===d&&gateway.key()===c;}
 function readContext(){syncConnection();const e=epoch,r=++readRevision,d=date,c=connection;return ()=>epoch===e&&readRevision===r&&date===d&&gateway.key()===c;}
 async function refresh(){if(!date||busy)return;const current=readContext();busy=true;status='loading';lastAttemptAt=now();changed();
  try{const next=await gateway.history(date);if(!current())return;const revision=inputRevision;const nextHash=await Promise.resolve().then(()=>currentHash(date)).catch(()=>null);if(!current())return;hash=revision===inputRevision?nextHash:null;
   for(const row of next.filter(x=>x.status==='succeeded')){try{const text=await gateway.artifact(row);if(!current())return;artifacts.set(id(row),{text,row});}catch{if(!current())return;}}
   rows=next;lastGoodAt=now();status='ready';
  }catch{if(!current())return;status='unconfirmed';}finally{if(current()){busy=false;changed();}}
 }
 return {
  snapshot,
  inputChanged(changedDate){if(changedDate===date){inputRevision++;hash=null;changed();}},
  selectDate(next){if(!validDate(next))throw Error('invalid_date');if(next===date)return;if(next!==date){epoch++;date=next;rows=[];artifacts.clear();pending=null;selected='original';lastGoodAt=null;lastAttemptAt=null;hash=null;status='idle';busy=false;}changed();},
  selectVersion(key){if(key!=='original'&&!artifacts.has(key))return false;selected=key;changed();return true;},
  refresh,
  begin(){syncConnection();if(!date||busy)return false;
   const e=epoch,d=date,c=connection,current=()=>epoch===e&&date===d&&gateway.key()===c;
   busy=true;status='preparing';changed();
   const settled=()=>{if(current()&&busy){busy=false;status='unconfirmed';changed();}};
   try{return startEntry({isCurrent:current,
    onRunning:()=>{if(!current())return false;readRevision++;busy=true;status='preparing';changed();return true;},
    onDeferred:()=>{if(current()){busy=false;status='idle';changed();}},onSettled:settled});}
   catch(error){if(current()){busy=false;status='unconfirmed';changed();}return false;}
  },
  prepared(request){if(request.date!==date)return;busy=true;pending={requestId:request.requestId,date:request.date,inputHash:request.inputHash,stage:'prepared'};changed();},
  proven(request){if(request.date!==date)return;gateway.rememberProven(request);pending={requestId:request.requestId,date:request.date,inputHash:request.inputHash,stage:'saved'};changed();},
  accepted(result){if(result?.request?.date!==date)return;busy=false;pending={requestId:result.request.requestId,date,inputHash:result.request.inputHash,stage:'queued'};status='accepted';changed();},
  settled(){if(busy){busy=false;status='unconfirmed';changed();}},
  failed(error){busy=false;status='unconfirmed';if(pending)pending.stage=error?.stage==='queue'?'input_sent':'unconfirmed';changed();},
  async resume(requestId,attempt=null){syncConnection();if(busy||typeof requestId!=='string'||!requestId.startsWith(`feedback-${date}-`)||!(/-[a-f0-9]{64}$/.test(requestId)))return false;const current=context();busy=true;lastAttemptAt=now();changed();
   try{const result=attempt===null?await gateway.resume(requestId):await gateway.retry(requestId,attempt);if(!current())return;
    pending={requestId:result.request.requestId,date:result.request.date,inputHash:result.request.inputHash,stage:'queued'};status='accepted';
   }catch{if(current())status='unconfirmed';}finally{if(current()){busy=false;changed();}}
  },
  // Parent owns one foreground timer; no hidden polling or automatic generation.
  tick(foreground){if(foreground&&!busy&&(lastAttemptAt===null||now()-lastAttemptAt>=60000))return refresh();},
  invalidate(){connection=null;syncConnection();changed();}
 };
}

