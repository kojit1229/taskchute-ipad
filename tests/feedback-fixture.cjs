'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const PREFIX='taskchute/requests/feedback-regeneration/',DATE='2026-09-06';
const sha=t=>crypto.createHash('sha1').update(t).digest('hex'),digest=t=>crypto.createHash('sha256').update(t).digest('hex');
const encode=v=>typeof v==='string'?v:JSON.stringify(v);
function createFeedbackFixture({owner='synthetic-feedback-owner'}={}){
 const files=new Map(),calls=[],releases=[];let offline=false,loseQueue=false,hold=null,readHold=null;
 const canonical='## 以前のフィードバック\nsynthetic original\n## ジャーナル依頼への対応\nsynthetic retained request result';
 files.set(`taskchute/AIフィードバック_${DATE}.md`,canonical);
 files.set('taskchute/report-index.json',{schemaVersion:1,generatedAt:'2026-09-06T03:00:00Z',files:[{name:`AIフィードバック_${DATE}.md`,kind:'feedback',date:DATE}]});
 function entries(){const q=files.get(PREFIX+'queue.json');return q?JSON.parse(encode(q)).entries:[];}
 function request(){const entry=entries().at(-1);assert(entry,'queue entry exists');return JSON.parse(encode(files.get(PREFIX+`requests/${entry.requestId}.json`)));}
 return {files,calls,canonical,entries,request,
  cleanup(){for(const release of releases)release();},
  offline(value){offline=value;},loseQueueOnce(){loseQueue=true;},
  holdNextPrimary(){let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);releases.push(release);hold={entered,gate};return {reached,release};},
  holdNextRead(path){let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);releases.push(release);readHold={path,entered,gate};return {reached,release};},
  async route(route){const req=route.request(),url=new URL(req.url());
   if(url.hostname==='localhost'||url.hostname==='127.0.0.1')return route.continue();
   if(url.hostname!=='api.github.com')return route.abort();
   const match=url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
   if(!match||decodeURIComponent(match[1])!==owner||decodeURIComponent(match[2])!=='synthetic-feedback-repo'){calls.push({owner,path:'outside-fixture-connection',method:req.method()});assert.notEqual(req.method(),'PUT','unexpected write outside captured fixture connection');return route.fulfill({status:404,body:'{}'});}
   const path=match[3].split('/').map(decodeURIComponent).join('/'),method=req.method();calls.push({owner,path,method});
   assert.equal(req.headers().authorization,'Bearer SYNTHETIC_FEEDBACK_TOKEN','fixture connection headers');
   if(method==='GET')assert.equal(url.searchParams.get('ref'),'fixture','configured branch');
   if(offline)return route.abort();
   if(method==='GET'&&path==='taskchute/app-state.json'&&hold){const gate=hold;hold=null;gate.entered();await gate.gate;}
   let capturedText;
   if(method==='GET'&&path===readHold?.path){const gate=readHold;readHold=null;capturedText=files.has(path)?encode(files.get(path)):null;gate.entered();await gate.gate;}
   if(method==='GET'){
    if(path==='taskchute')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([...files.keys()].filter(x=>!x.slice(10).includes('/')).map(x=>({type:'file',name:x.slice(10),path:x})))});
    if(capturedText===null||capturedText===undefined&&!files.has(path))return route.fulfill({status:404,body:'{}'});
    const text=capturedText===undefined?encode(files.get(path)):capturedText;return route.fulfill({status:200,contentType:req.headers().accept?.includes('raw')?'text/plain':'application/json',body:req.headers().accept?.includes('raw')?text:JSON.stringify({type:'file',encoding:'base64',sha:sha(text),size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64')})});
   }
   assert.equal(method,'PUT','only GET/PUT permitted in synthetic API');
   assert(path==='taskchute/app-state.json'||/^taskchute\/日報_\d{4}-\d{2}-\d{2}\.md$/.test(path)||path===PREFIX+'queue.json'||path.startsWith(PREFIX+'requests/'),'unexpected actual writer '+path);
   const payload=req.postDataJSON();assert.equal(payload.branch,'fixture','configured PUT branch');const before=files.has(path)?encode(files.get(path)):null;
   if((before?sha(before):undefined)!==payload.sha)return route.fulfill({status:409,body:'{}'});
   const text=Buffer.from(payload.content,'base64').toString('utf8');assert(!text.includes('SYNTHETIC_FEEDBACK_TOKEN'),'token excluded from persisted payload');
   if(path.startsWith(PREFIX+'requests/')){const r=JSON.parse(text),snapshot=r.snapshot;const canonical=JSON.stringify({date:r.date,reportFormatVersion:1,reportMarkdown:snapshot.reportMarkdown.replace(/\r\n/g,'\n'),journalText:snapshot.journalText.replace(/\r\n/g,'\n')});assert.equal(r.inputHash,digest(canonical));assert.equal(r.requestId,`feedback-${r.date}-${r.inputHash}`);assert.equal(path,PREFIX+`requests/${r.requestId}.json`);}
   files.set(path,text);
   if(path===PREFIX+'queue.json'&&loseQueue){loseQueue=false;return route.abort();}
   return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({content:{sha:sha(text)}})});
  },
  publish(status,{missing=false,wrongHash=false}={}){const entry=entries().at(-1);assert(entry);const result={schemaVersion:1,...entry,status,startedAt:'2026-09-06T03:00:00Z',updatedAt:'2026-09-06T03:00:00Z'};
   if(status==='running')Object.assign(result,{workerId:'synthetic-worker',leaseId:'synthetic-lease',leaseUntil:'2026-09-06T03:10:00+00:00'});
   if(status==='failed')result.reason='synthetic_generation_failed';
   if(status==='succeeded'){const text='## 明日への提案\n'+'synthetic regenerated '+entry.date+'\n'.repeat(2)+'架空の確認文章。'.repeat(600);result.generatedAt='2026-09-06T03:00:00Z';result.outputHash=wrongHash?'0'.repeat(64):digest(text);result.artifactPath=`feedback-regeneration/${entry.date}/${entry.requestId}/${entry.attempt}.md`;if(missing)files.delete('taskchute/'+result.artifactPath);else files.set('taskchute/'+result.artifactPath,text);}
   files.set(PREFIX+`results/${entry.requestId}/${entry.attempt}.json`,result);return result;
  },
  putCount(){return calls.filter(c=>c.method==='PUT').length;}
 };
}
module.exports={createFeedbackFixture,DATE,PREFIX};
