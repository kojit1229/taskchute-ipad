const {getFunction}=require('./prepare.cjs');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('feedback connection anchor');return s.replace(a,b);};
function transformStorage(source){
 if(source.includes('readStoredStateForFeedback'))throw Error('already integrated');
 const anchor='export { loadState, persistLocalNoSchedule, _lastSaveError };';
 return once(source,anchor,`function readStoredStateForFeedback() { return localStorage.getItem(STORAGE_KEY); }
function restoreStoredStateForFeedback(raw) {
  if (raw === null) localStorage.removeItem(STORAGE_KEY);
  else if (typeof raw === "string") localStorage.setItem(STORAGE_KEY, raw);
  else throw Error("invalid_storage_snapshot");
}
export { loadState, persistLocalNoSchedule, _lastSaveError, readStoredStateForFeedback, restoreStoredStateForFeedback };`);
}
const wiring=`
let feedbackHttpClient = null;
let feedbackEntryClient = null;
function invalidateFeedbackConnection() { feedbackHttpClient?.invalidate(); }
function feedbackInputOwner() {
  const date = state.selectedDate;
  if (_imeComposing || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || isArchivedDate(state, date)) throw Error("feedback_input_unavailable");
  const element = document.querySelector('[data-journal-date="' + date + '"]');
  if (!element?.isConnected) throw Error("feedback_input_unavailable");
  return { date, view: state.currentView, element };
}
function ownsFeedbackInput(owner) {
  return !_imeComposing && owner.element.isConnected && state.selectedDate === owner.date && state.currentView === owner.view
    && document.querySelector('[data-journal-date="' + owner.date + '"]') === owner.element && !isArchivedDate(state, owner.date);
}
function reflectFeedbackInput(owner) {
  if (!ownsFeedbackInput(owner) || draftSaveTransaction?.active || draftLeaveGuard.active) throw Error("feedback_input_unavailable");
  if (state.journals[owner.date] !== owner.element.value) {
    state.journals[owner.date] = owner.element.value;
    const meta = (state.journalMeta[owner.date] ||= { aiImported: false, ideal: "", aiTaskCandidates: [], aiRequest: "" });
    meta.textUpdatedAt = nowDateTime();
  }
  ensureJournal(owner.date);
}
function requestFeedbackRegeneration() {
  if (!feedbackEntryClient) {
    feedbackHttpClient = createFeedbackHttp({
      connection: () => personalDataReady(state.settings.github) ? personalDataFileConfig(state.settings.github) : null,
      headers: githubHeaders
    });
    const localCommit = createLocalReportCommit({ getState: () => state,
      canSave: () => !_imeComposing && !draftSaveTransaction?.active && !draftLeaveGuard.active,
      persist: () => { persistLocalNoSchedule(); return !_lastSaveError; },
      readStored: readStoredStateForFeedback, writeStored: restoreStoredStateForFeedback, now: nowDateTime });
    const proof = createReportProofAdapter({ get: feedbackHttpClient.get, putReport: feedbackHttpClient.putReport,
      syncProtectedState: boundProtectedSync(value => saveToGitHub(true, value)) });
    const run = createFeedbackCoordinator({ getState: () => state, identity: feedbackHttpClient.identity,
      selectedDate: () => state.selectedDate, today: todayISO, now: () => new Date().toISOString(), crypto: globalThis.crypto,
      localCommit, serializePrimary: () => JSON.stringify(sanitizedStateForGitHub(), null, 2), proof, queueTransport: feedbackHttpClient });
    feedbackEntryClient = createFeedbackEntry({ isComposing: () => _imeComposing, captureOwner: feedbackInputOwner,
      isOwner: ownsFeedbackInput, requestLeave: requestDraftLeave, reflectInput: reflectFeedbackInput, run,
      onResult: () => showToast("日報の再作成依頼を受付済みとして確認しました"),
      onError: error => showToast(error.message === "finish_composition_first" ? "文字の変換を確定してから操作してください" : "依頼の受付を確認できません。保存・通信の状態を確認してください") });
  }
  return feedbackEntryClient();
}
registerActions({ "feedback-regenerate": () => requestFeedbackRegeneration() });
`;
function transformApp(source){
 if(source.includes('requestFeedbackRegeneration'))throw Error('already integrated');
 const pairs=[['createFeedbackHttp','feedback-http'],['createLocalReportCommit','local-report-commit'],
  ['createReportProofAdapter','report-proof-adapter'],['createFeedbackCoordinator','feedback-coordinator'],
  ['createFeedbackEntry, boundProtectedSync','feedback-entry']];
 source=pairs.map(([names,file])=>`import { ${names} } from "./src/features/${file}.mjs";`).join('\n')+'\n'+source;
 source=once(source,'import { loadState, persistLocalNoSchedule, _lastSaveError } from "./src/storage/local.js";',
  'import { loadState, persistLocalNoSchedule, _lastSaveError, readStoredStateForFeedback, restoreStoredStateForFeedback } from "./src/storage/local.js";');
 const anchor=getFunction(source,'sanitizedStateForGitHub');source=once(source,anchor,anchor+'\n'+wiring);
 for(const line of ['    state.settings.github[target.dataset.githubField] = target.value.trim();','      state.settings.github[key] = val;',
  '      setState(next);','  setState(normalizeState(seedState()));']){
  const escaped=line.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const found=[...source.matchAll(new RegExp('\\n'+escaped+'(\\r*\\n)','g'))];
  if(found.length!==1)throw Error('feedback mutation anchor');
  source=once(source,found[0][0],found[0][0]+line.match(/^ */)[0]+'invalidateFeedbackConnection();'+found[0][1]);
 }
 return source;
}
module.exports={transformApp,transformStorage,wiring};
