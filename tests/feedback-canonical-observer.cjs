'use strict';
function observeCanonical(source){
 const start='async function load(',end='function listed()';
 if(source.split(start).length!==2||source.split(end).length!==2)throw Error('canonical observer anchor changed');
 return source.replace(start,'async function loadObservedActual(').replace(end,`function load(...args){
 const p=loadObservedActual(...args),probe=globalThis.__feedbackCanonicalProbe ||= [];
 const item={name:args[0]?.name,settled:false};probe.push(item);
 Promise.resolve(p).then(()=>{item.settled=true;},()=>{item.settled=true;});
 return p;
 }
 function listed()`);
}
module.exports={observeCanonical};
