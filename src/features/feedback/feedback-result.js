import {digest} from './request-contract.js';
export const prefix = 'taskchute/requests/feedback-regeneration/';
export function validDate(s) {
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const [y,m,d]=s.split('-').map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return y>0&&m>0&&m<13&&d>0&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
export function stamp(s) {
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(?:\d{3}|\d{6}))?Z$/.test(s)||!validDate(s.slice(0,10)))throw Error('invalid_result_time');
 const [y,m,d,h,n,z]=s.match(/\d+/g).map(Number);
 if(h>23||n>59||z>59)throw Error('invalid_result_time');
 const dt=new Date(0);dt.setUTCFullYear(y,m-1,d);dt.setUTCHours(h,n,z,Number((s.split('.')[1]||'0').replace('Z','').slice(0,3)));
 return dt.getTime();
}
export function validateResult(value,entry,attempt) {
 const r=structuredClone(value);
 if(!r||r.schemaVersion!==1||!['running','failed','succeeded'].includes(r.status)||r.attempt!==attempt||!Number.isSafeInteger(attempt)||attempt<1
 ||['requestId','date','inputHash'].some(k=>r[k]!==entry[k]))throw Error('result_identity_mismatch');
 stamp(r.startedAt);stamp(r.updatedAt);
 if(r.status==='failed'&&(typeof r.reason!=='string'||!r.reason))throw Error('invalid_failure');
 if(r.status==='succeeded') {
  stamp(r.generatedAt);
  if(typeof r.outputHash!=='string'||!/[a-f0-9]{64}/.test(r.outputHash)||r.outputHash.length!==64
    ||r.artifactPath!==`feedback-regeneration/${r.date}/${r.requestId}/${r.attempt}.md`)throw Error('invalid_artifact_reference');
 }
 return r;
}
export async function validateArtifact(text,result,crypto) {
 if(typeof text!=='string'||new TextEncoder().encode(text).length<3000||!/^#{1,6}\s+.*明日への提案.*$/m.test(text))throw Error('invalid_artifact_body');
 if(await digest(text,crypto)!==result.outputHash)throw Error('artifact_hash_mismatch');
 return text;
}
