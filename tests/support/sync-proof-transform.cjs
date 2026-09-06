const {getFunction}=require('./prepare.cjs');
const once=(source,old,next)=>{if(source.split(old).length!==2)throw Error('sync proof anchor');return source.replace(old,next);};
// Existing protected sync writer remains authoritative; no alternate app-state PUT exists.
function transformSync(source){
 if(source.includes('captureProof'))throw Error('already integrated');
 const before=getFunction(source,'saveToGitHub');let after=before;
 after=once(after,'saveToGitHub(silent = false)', 'saveToGitHub(silent = false, captureProof = null)');
 after=once(after,'  _githubSaveInFlight = true;',
  '  if (captureProof && (typeof captureProof.expectedContent !== "string" || typeof captureProof.isCurrent !== "function" || captureProof.isCurrent() !== true)) return;\n  _githubSaveInFlight = true;');
 for (const anchor of ['    const sha = await fetchGitHubFileSHA(config);',
   '          remoteText = (await downloadGitHubStateText(config)).text;',
   '        if (remoteNorm) await prepareArchiveMerge(remoteNorm, archiveConnection);',
   '    await prepareArchiveMerge(null, archiveConnection);']) {
   after=once(after,anchor,anchor+'\n    if (captureProof && captureProof.isCurrent() !== true) return;');
 }
 after=once(after,'      method: "PUT",','      method: "PUT",\n      ...(captureProof?.signal ? { signal: captureProof.signal } : {}),');
 const content='    const content = JSON.stringify(sanitizedStateForGitHub(), null, 2);';
 after=once(after,content,content+'\n    if (captureProof && (captureProof.isCurrent() !== true || content !== captureProof.expectedContent)) return;');
 const response='    const currentToken = requireGitHubConfig().token;';
 after=once(after,response,'    if (captureProof && captureProof.isCurrent() !== true) return;\n'+response);
 const parsed='      const result = await response.json();';
 after=once(after,parsed,parsed+'\n      if (captureProof && captureProof.isCurrent() !== true) return;');
 const record='    recordSyncPushSuccess();';
 after=once(after,record,'    if (captureProof && captureProof.isCurrent() !== true) return;\n'+record);
 const tail='    maybeWriteBackupSnapshot();';
 // Insert after the complete original statement, retaining its comment.
 after=once(after,tail,tail+'\n    if (captureProof && captureProof.isCurrent() === true) return { ok: true, content };');
 return source.replace(before,after);
}
module.exports={transformSync};
