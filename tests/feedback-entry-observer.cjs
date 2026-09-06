'use strict';
function observeEntry(source){
 const anchor='export function createFeedbackEntry(';
 if(source.split(anchor).length!==2)throw Error('actual entry export anchor changed');
 return source.replace(anchor,'function createFeedbackEntry(')+`
// Test-only observer: original options, returned Promise and callback results are retained.
function createFeedbackEntryObserved(options) {
 const probe=globalThis.__feedbackBrowserProbe ||= {runs:[],settled:0};
 let activeInvocation=null;
 const start=createFeedbackEntry({...options,
  run(...args){
   const record={sequence:probe.runs.length+1,outcome:'pending',settled:false};probe.runs.push(record);
   if(activeInvocation)activeInvocation.record=record;
   let value;try{value=options.run(...args);}catch(error){record.outcome='threw';throw error;}
   Promise.resolve(value).then(()=>{record.outcome='fulfilled';},()=>{record.outcome='rejected';});
   return value;
  }
 });
 return (lifecycle={})=>{
  const invocation={record:null};activeInvocation=invocation;
  return start({...lifecycle,
   onRunning(){activeInvocation=invocation;return lifecycle.onRunning?.();},
   onSettled(){try{return (lifecycle.onSettled || options.onSettled || (()=>{}))();}
    finally{if(invocation.record)invocation.record.settled=true;probe.settled++;}}
  });
 };
}
export {createFeedbackEntryObserved as createFeedbackEntry};
`;
}
module.exports={observeEntry};
