'use strict';
const {createFeedbackFixture,DATE}=require('./feedback-fixture.cjs');
const A='synthetic-feedback-owner',B='synthetic-feedback-owner-b',canonicalPath=`taskchute/AIフィードバック_${DATE}.md`;
function createCanonicalFixture(){
 const a=createFeedbackFixture({owner:A}),b=createFeedbackFixture({owner:B});
 const mark=(owner,suffix='')=>`synthetic canonical ${owner}${suffix}`;
 a.files.set(canonicalPath,mark('A'));b.files.set(canonicalPath,mark('B'));
 return {a,b,mark,canonicalPath,get calls(){return [...a.calls,...b.calls];},
  cleanup(){a.cleanup();b.cleanup();},
  async route(route){const url=new URL(route.request().url());return (url.pathname.startsWith('/repos/'+B+'/')?b:a).route(route);}
 };
}
module.exports={createCanonicalFixture,A,B};
