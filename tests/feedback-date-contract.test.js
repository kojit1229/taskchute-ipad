// Real installed transport; synthetic request only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{
const {createFeedbackHttp}=await import(pathToFileURL(path.join(__dirname,'../src/features/feedback/feedback-http.js')).href);
for(const [date,valid] of [['2024-02-29',true],['2000-02-29',true],['2026-09-07',true],['0001-01-01',true],['0099-12-31',true],['9999-12-31',true],['1900-02-29',false],['2026-02-29',false],['0000-01-01',false],['2026-04-31',false],['2026-00-01',false],['2026-13-01',false],['2026-01-00',false],['2026-1-01',false]]) {
 test('actual canonical GET validation '+date,async()=>{
  let requests=0;
  const http=createFeedbackHttp({connection:()=>({owner:'fixture',repo:'synthetic',branch:'main',token:'fake',path:'taskchute/app-state.json'}),headers:()=>({}),fetch:async()=>{requests++;return {status:404};}});
  const request=http.get({kind:'canonical-file',name:`AIフィードバック_${date}.md`});
  if(valid){assert.equal((await request).status,404);assert.equal(requests,1);}
  else {await assert.rejects(request,/http_path_rejected/);assert.equal(requests,0);}
 });
}
test('canonical file stays read only',async()=>{
 let requests=0;
 const http=createFeedbackHttp({connection:()=>({owner:'fixture',repo:'synthetic',branch:'main',token:'fake',path:'taskchute/app-state.json'}),headers:()=>({}),fetch:async()=>{requests++;throw Error('unexpected request');}});
 await assert.rejects(http.put({kind:'canonical-file',name:'AIフィードバック_2026-09-07.md'},new Uint8Array(),{expectedSha:null}),/canonical_read_only/);
 assert.equal(requests,0);
});

})().catch(error=>{console.error(error);process.exitCode=1;});
