// Preserve one asynchronous update's origin through disabled-control intermediate renders.
export function createFeedbackReadonlyPatch({document,root}) {
 const sessions=new Map();
 const scroll=()=>[...new Set([document.scrollingElement,document.getElementById('app'),root])].filter(Boolean).map(element=>({element,top:element.scrollTop,left:element.scrollLeft}));
 const key=element=>element?.id?{id:element.id}:element?.dataset?.action?{data:{...element.dataset}}:element?.tagName==='SUMMARY'&&element.parentElement.dataset.feedbackDetailKey?{summary:element.parentElement.dataset.feedbackDetailKey}:null;
 const target=(host,identity)=>!identity?null:identity.summary?[...host.querySelectorAll('details')].find((el,i)=>detailKey(el,i)===identity.summary)?.querySelector('summary'):[...host.querySelectorAll(identity.id?'[id]':'[data-action]')].find(el=>identity.id?el.id===identity.id:Object.entries(identity.data).every(([k,v])=>el.dataset[k]===v));
 function cancel(event){
  const moving=event.type==='wheel'||event.type==='touchstart'||event.type==='pointerdown'||event.type==='keydown'&&['Tab','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key);
  for(const [host,session] of sessions){
   if(!host.isConnected){sessions.delete(host);continue;}
   if(moving)session.scroll=null;
   // Scrolling does not move focus; pointer/touch/Tab can leave it on an unfocusable target.
   if(event.type==='pointerdown'||event.type==='touchstart'||event.type==='keydown'&&event.key==='Tab')session.focus=null;
   if(event.type==='focusin'&&event.target!==document.body&&event.target!==target(host,session.focus)){session.scroll=null;session.focus=host.contains(event.target)?key(event.target):null;}
  }
 }
 for(const name of ['wheel','touchstart','pointerdown','keydown','focusin'])document.addEventListener(name,cancel,true);
 function detailKey(el,index){
  return el.dataset.feedbackDetailKey||'detail:'+index;
 }
 return function replace(host,html,{busy=false,date=null}={}) {
  if(!host)return;
  let session=sessions.get(host);
  if(!session||session.date!==date){session={date,scroll:scroll(),focus:host.contains(document.activeElement)?key(document.activeElement):null};sessions.set(host,session);}
  if(host.contains(document.activeElement))session.focus=key(document.activeElement);
  const immediate=scroll(),opened=new Map([...host.querySelectorAll('details')].map((el,i)=>[detailKey(el,i),el.open]));
  // Movement after a completed patch outranks its saved origin, including delayed native wheel scrolling.
  if(session.observed&&immediate.some(item=>{const old=session.observed.find(saved=>saved.element===item.element);return old&&(old.top!==item.top||old.left!==item.left);}))session.scroll=null;
  host.innerHTML=html;
  [...host.querySelectorAll('details')].forEach((el,i)=>{const value=opened.get(detailKey(el,i));if(value!==undefined)el.open=value;});
  const focused=target(host,session.focus);
  if(focused&&!focused.disabled)focused.focus({preventScroll:true});
  for(const item of session.scroll||immediate){item.element.scrollTop=item.top;item.element.scrollLeft=item.left;}
  session.observed=scroll();
  // Keep the original scroll even if the browser clamps an intermediate short document.
  if(!busy)sessions.delete(host);
 };
}
