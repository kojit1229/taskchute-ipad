'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
const {createFeedbackReadonlyPatch}=await import(pathToFileURL(path.join(__dirname,'../src/features/feedback/feedback-readonly-patch.js')).href);
function fixture(){
 const handlers={},body={},outside={};let button,version,detail,summary;
 function scroller(top,left){let y=top,x=left,maxY=2000,maxX=2000;return {get scrollTop(){return y;},set scrollTop(v){y=Math.max(0,Math.min(maxY,v));},get scrollLeft(){return x;},set scrollLeft(v){x=Math.max(0,Math.min(maxX,v));},limit(a,b){maxY=a;maxX=b;y=Math.min(y,a);x=Math.min(x,b);}};}
 const axes=[scroller(100,12),scroller(40,7),scroller(20,3)],document={body,activeElement:body,scrollingElement:axes[0],getElementById:()=>axes[1],addEventListener:(n,f)=>handlers[n]=f};
 const host={isConnected:true,contains:e=>[button,version,summary].includes(e),querySelectorAll:s=>s==='details'?[detail]:[button,version]};
 function focus(el){document.activeElement=el;handlers.focusin?.({type:'focusin',target:el});}
 function build(disabled){const control=(action,isDisabled)=>({dataset:{action},disabled:isDisabled,focus(){focus(this);}});button=control('feedback-refresh',disabled);version=control('feedback-version',false);detail={dataset:{feedbackDetailKey:'history'},open:false,querySelector:()=>summary};summary={tagName:'SUMMARY',parentElement:detail,focus(){focus(this);}};}
 build(false);detail.open=true;
 Object.defineProperty(host,'innerHTML',{set(html){const held=host.contains(document.activeElement);axes.forEach((a,i)=>a.limit(html==='clamp'?[80,30,10][i]:html==='short-ready'?5:2000,html==='clamp'?[10,5,2][i]:2000));build(html==='clamp'||html==='busy');if(held)document.activeElement=body;}});
 const patch=createFeedbackReadonlyPatch({document,root:axes[2]});
 return {axes,document,host,focus:target=>focus(target==='refresh'?button:target==='version'?version:target==='summary'?summary:target==='outside'?outside:body),get active(){return document.activeElement===button?'refresh':document.activeElement===version?'version':document.activeElement===outside?'outside':document.activeElement===summary?'summary':'body';},get opened(){return detail.open;},event(type,key){handlers[type]({type,key,target:document.activeElement});},draw(html,busy=true,date='2026-09-06'){patch(host,html,{busy,date});},position:()=>axes.map(a=>[a.scrollTop,a.scrollLeft])};
}
for(const order of ['existing-session-before-wheel','new-session-after-wheel-before-scroll','new-session-after-wheel-and-scroll'])test('user scroll survives '+order,()=>{
 const f=fixture();f.draw('ready',false);if(order==='existing-session-before-wheel')f.draw('busy');f.event('wheel');
 if(order==='new-session-after-wheel-before-scroll')f.draw('busy');f.axes[0].scrollTop=450;
 if(order==='new-session-after-wheel-and-scroll')f.draw('busy');assert.equal(f.axes[0].scrollTop,450);f.draw('ready',false);assert.equal(f.axes[0].scrollTop,450);
});
test('three ancestor clamps record actual coordinates and recover origin without user movement',()=>{
 const f=fixture(),origin=f.position();f.focus('refresh');f.draw('clamp');assert.equal(f.active,'body');assert.equal(f.opened,true);assert.deepEqual(f.position(),[[80,10],[30,5],[10,2]]);
 f.draw('clamp');assert.deepEqual(f.position(),[[80,10],[30,5],[10,2]]);f.draw('ready',false);assert.deepEqual(f.position(),origin);assert.equal(f.active,'refresh');assert.equal(f.opened,true);
});
for(const [label,index,property,value] of [['document vertical',0,'scrollTop',50],['main zero',2,'scrollTop',0],['document horizontal zero',0,'scrollLeft',0],['app horizontal',1,'scrollLeft',1]])test('actual intervening '+label+' movement wins over saved origin',()=>{
 const f=fixture();f.draw('clamp');const previous=f.position();f.axes[index][property]=value;const moved=f.position();assert.notDeepEqual(moved,previous);f.draw('ready',false);assert.deepEqual(f.position(),moved);
});
test('zero origin is retained and ready DOM shrink is not mistaken for intervening motion',()=>{
 const f=fixture();f.axes.forEach(a=>{a.scrollTop=0;a.scrollLeft=0;});f.draw('busy');f.draw('ready',false);assert.deepEqual(f.position(),[[0,0],[0,0],[0,0]]);
 const g=fixture();g.draw('busy');g.draw('short-ready',false);assert.deepEqual(g.position(),[[5,12],[5,7],[5,3]]);
});
test('date change starts a new origin instead of restoring previous date',()=>{
 const f=fixture();f.draw('clamp');const now=f.position();f.draw('busy',true,'2026-09-05');f.draw('ready',false,'2026-09-05');assert.deepEqual(f.position(),now);
});
for(const intervention of ['none','pointer','focus','wheel'])test('legacy clamp and external focus '+intervention,()=>{
 const f=fixture();f.focus('refresh');f.draw('clamp');assert.equal(f.opened,true);assert.equal(f.active,'body');
 if(intervention==='pointer')f.event('pointerdown');if(intervention==='wheel')f.event('wheel');
 if(intervention!=='none'){f.axes[0].scrollTop=44;f.focus('outside');}f.draw('ready',false);
 assert.equal(f.axes[0].scrollTop,intervention==='none'?100:44);assert.equal(f.opened,true);assert.equal(f.active,intervention==='none'?'refresh':'outside');
});
for(const [name,disabled,action,expected] of [
 ['enabled-wheel',false,'wheel','refresh'],['disabled-wheel',true,'wheel','refresh'],['disabled-space',true,' ','refresh'],['disabled-arrow',true,'ArrowDown','refresh'],
 ['disabled-pointer-body',true,'pointerdown','body'],['disabled-touch-body',true,'touchstart','body'],['disabled-tab-outside',true,'tabOutside','outside'],['disabled-tab-browser',true,'tabBrowser','body'],
 ['disabled-wheel-then-outside',true,'wheelOutside','outside'],['disabled-tab-version',true,'tabVersion','version']
])test('focus ownership remains correct '+name,()=>{
 const f=fixture();f.focus('refresh');f.draw(disabled?'busy':'ready',true);
 if(action.startsWith('tab')){f.event('keydown','Tab');f.focus(action==='tabOutside'?'outside':action==='tabVersion'?'version':'body');}
 else if(['wheel','pointerdown','touchstart','wheelOutside'].includes(action)){f.event(action==='wheelOutside'?'wheel':action);if(action==='wheelOutside')f.focus('outside');}
 else f.event('keydown',action);
 f.axes[0].scrollTop=450;f.draw('ready',false);assert.equal(f.active,expected);assert.equal(f.axes[0].scrollTop,450);
});
})().catch(error=>{console.error(error);process.exitCode=1;});

