const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('feedback UI anchor missing/duplicate: '+a);return s.replace(a,b);};
function transformCoordinator(s){
 s=once(s,'localCommit, serializePrimary, proof, queueTransport } = {})','localCommit, serializePrimary, proof, queueTransport, onPrepared = () => {}, onProven = () => {} } = {})');
 s=once(s,'const context = Object.freeze({ isCurrent });','onPrepared(structuredClone(validated)); guard();\n      const context = Object.freeze({ isCurrent });');
 s=once(s,'const confirmSavedInput = check => {','onProven(structuredClone(validated)); guard();\n      const confirmSavedInput = check => {');return s;
}
function transformEntry(s){
 const original=require('../feedback-integration-prep/prepare.cjs').getFunction(s,'createFeedbackEntry');
 s=once(s,original,ENTRY_SOURCE.trim().replace(/^export /,""));return s;
}
const ENTRY_SOURCE = `export function createFeedbackEntry({ isComposing, captureOwner, isOwner, requestLeave, reflectInput, run,
  onResult, onError, onSettled = () => {} } = {}) {
  if ([isComposing,captureOwner,isOwner,requestLeave,reflectInput,run,onResult,onError].some(fn => typeof fn !== 'function')) throw Error('entry_configuration_required');
  return (lifecycle = {}) => {
    const current = () => lifecycle.isCurrent?.() !== false;
    const settled = () => (lifecycle.onSettled || onSettled)();
    let owner, continued = false;
    const fail = error => { try { if (current() && (!owner || isOwner(owner))) onError(error); } finally { settled(); } };
    try {
      if (isComposing()) { fail(Error('finish_composition_first')); return false; }
      owner = captureOwner();
      const leave = () => {
        if (continued) return;
        continued = true;
        try {
          if (!current() || isComposing() || !isOwner(owner)) { settled(); return; }
          if (lifecycle.onRunning?.() === false) { settled(); return; }
          reflectInput(owner);
          Promise.resolve(run(owner.date, () => current() && !isComposing() && isOwner(owner))).then(
            result => { try { if (current() && isOwner(owner)) onResult(result); } finally { settled(); } },
            fail
          );
        } catch (error) { fail(error); }
      };
      if (!requestLeave(leave, { allowDiscard: false })) leave();
      else if (!continued) lifecycle.onDeferred?.();
      return true;
    } catch (error) { fail(error); return false; }
  };
}`;

function transformHttp(s){
 const anchor="if (typeof resource === 'string' && /^taskchute\\/requests";
 if(s.includes('artifact_read_only'))throw Error('already integrated');
 if(s.split(anchor).length!==2)throw Error('artifact anchor');
 s=s.replace(anchor,"if (typeof resource === 'string' && /^taskchute\\/feedback-regeneration\\/(\\d{4}-\\d{2}-\\d{2})\\/feedback-\\1-[a-f0-9]{64}\\/[1-9]\\d*\\.md$/.test(resource)) return resource;\n    "+anchor);
 s=once(s,"if (method === 'PUT' && typeof resource === 'string' && resource.includes('/results/'))", "if (method === 'PUT' && typeof resource === 'string' && resource.startsWith('taskchute/feedback-regeneration/')) throw Error('artifact_read_only');\n    if (method === 'PUT' && typeof resource === 'string' && resource.includes('/results/'))");
 s=once(s,"if (resource?.kind === 'primary-state') return cfg.path;",`if (resource?.kind === 'canonical-index') return 'taskchute/report-index.json';
    if (resource?.kind === 'canonical-directory') return 'taskchute';
    if (resource?.kind === 'canonical-file' && /^AIフィードバック_\\d{4}-\\d{2}-\\d{2}\\.md$/.test(resource.name)) {
      const date=resource.name.slice('AIフィードバック_'.length,-3),[year,month,day]=date.split('-').map(Number),parsed=new Date(0);
      parsed.setUTCFullYear(year,month-1,day);
      if(!date.startsWith('0000')&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date)return 'taskchute/'+resource.name;
    }
    if (resource?.kind === 'primary-state') return cfg.path;`);
 s=once(s,"if (!path?.startsWith('taskchute/')", "if ((path !== 'taskchute' || resource?.kind !== 'canonical-directory') && !path?.startsWith('taskchute/')");
 s=once(s,"if (method === 'PUT' && (resource?.kind === 'primary-state'", "if (method === 'PUT' && ['canonical-index','canonical-directory','canonical-file'].includes(resource?.kind)) throw Error('canonical_read_only');\n    if (method === 'PUT' && (resource?.kind === 'primary-state'");
 s=once(s,"if (data?.encoding !== 'base64'", "if(resource?.kind === 'canonical-directory'){if(!Array.isArray(data)||data.length>10000)throw Error('canonical_directory_invalid');return {status:200,entries:data.map(entry=>({name:entry?.name,type:entry?.type,path:entry?.path}))};}\n      if (data?.encoding !== 'base64'");return s;
}
function transformApp(s){
 if(s.includes('feedbackUiController'))throw Error('already integrated');
 const imports=[['createFeedbackReadonlyPatch','feedback-readonly-patch'],['createFeedbackCanonicalReader','feedback-canonical-reader'],['createFeedbackUiGateway','feedback-ui-gateway'],['createFeedbackUiController','feedback-ui-controller'],['createFeedbackUiView','feedback-ui-view'],['createFeedbackReportOverlay','feedback-report-overlay'],['makeRequest','request-contract']].map(([names,file])=>`import { ${names} } from "./src/features/${file}.mjs";`).join('\n');
 s=imports+'\n'+s;
 s=once(s,'let feedbackEntryClient = null;','let feedbackEntryClient = null;\nlet feedbackReadonlyPatch;\nlet feedbackCanonicalReader = null;\nlet feedbackUiController = null;\nlet feedbackReportController = null;\nlet feedbackUiGateway = null;\nlet feedbackReportOverlay = null;\nlet feedbackOverlayLoaded = false;\nconst feedbackUiView = createFeedbackUiView({escapeHTML,renderMarkdown});');
 s=once(s,'function invalidateFeedbackConnection() { feedbackHttpClient?.invalidate(); }','function invalidateFeedbackConnection() { feedbackHttpClient?.invalidate(); feedbackCanonicalReader?.invalidate(); feedbackUiController?.invalidate(); feedbackReportController?.invalidate(); feedbackOverlayLoaded=false; }');
 s=once(s,'function requestFeedbackRegeneration() {','function ensureFeedbackClients() {');
 s=once(s,'proof, queueTransport: feedbackHttpClient });','proof, queueTransport: feedbackHttpClient, onPrepared: request => feedbackUiController.prepared(request), onProven: request => feedbackUiController.proven(request) });');
 s=once(s,'onResult: () => showToast("日報の再作成依頼を受付済みとして確認しました"),','onSettled: () => feedbackUiController.settled(), onResult: result => feedbackUiController.accepted(result),');
 s=once(s,'onError: error => showToast(error.message === "finish_composition_first" ? "文字の変換を確定してから操作してください" : "依頼の受付を確認できません。保存・通信の状態を確認してください") });',`onError: error => { feedbackUiController.failed(error); if(error.message === "finish_composition_first")showToast("文字の変換を確定してから操作してください"); } });
    feedbackUiGateway = createFeedbackUiGateway({http:feedbackHttpClient,crypto:globalThis.crypto,today:todayISO});
    feedbackUiController = createFeedbackUiController({ gateway: feedbackUiGateway,
      startEntry: lifecycle => feedbackEntryClient(lifecycle), onUpdate: patchFeedbackUi,
      currentHash: async date => { const input = captureReportInput(state,date,deriveReportValues); const report=buildReportMarkdown(input);
        return (await makeRequest(date,report,input.state.journals[date],new Date().toISOString(),globalThis.crypto)).inputHash; } });
    feedbackReportController = createFeedbackUiController({gateway:feedbackUiGateway,startEntry:()=>false,onUpdate:patchFeedbackUi,
      currentHash:async date=>{const input=captureReportInput(state,date,deriveReportValues);return (await makeRequest(date,buildReportMarkdown(input),input.state.journals[date],new Date().toISOString(),globalThis.crypto)).inputHash;}});
    feedbackCanonicalReader = createFeedbackCanonicalReader({http:feedbackHttpClient,onUpdate:()=>queueMicrotask(patchFeedbackUi)});
    feedbackReportOverlay = createFeedbackReportOverlay({gateway:feedbackUiGateway,controller:feedbackReportController,view:(snapshot,body)=>feedbackCanonicalNotice(snapshot.date)+feedbackUiView(snapshot,body),escapeHTML,onUpdate:patchFeedbackUi,
      getCanonicalFiles:()=>feedbackCanonicalReader.files(),getCanonicalBody:file=>feedbackCanonicalReader.body(file.date)});`);
 s=once(s,'  return feedbackEntryClient();','  return feedbackEntryClient;');
 s=once(s,'registerActions({ "feedback-regenerate": () => requestFeedbackRegeneration() });',`function feedbackCanonicalNotice(date) {
  const status=feedbackCanonicalReader?.status(date);
  return status?.failed ? '<p role="status">以前の本文を再取得できません。'+(status.hasBody?'同じ接続で確認済みの本文を表示しています。':'本文は未確認です。')+'</p>' : '';
}
function renderFeedbackUiSlot(date) {
  ensureFeedbackClients(); feedbackUiController.selectDate(date);
  return '<div data-feedback-ui-slot>'+feedbackCanonicalNotice(date)+feedbackUiView(feedbackUiController.snapshot(),feedbackCanonicalReader.body(date))+'</div>';
}
function patchFeedbackUi() {
  feedbackReadonlyPatch ||= createFeedbackReadonlyPatch({document,root:document.getElementById("main")});
  const slot=document.querySelector('[data-feedback-ui-slot]');
  if(state.currentView === 'ai-reports'){const reportSlot=document.querySelector('[data-feedback-overlay-slot]');if(reportSlot){const snapshot=feedbackReportController.snapshot();feedbackReadonlyPatch(reportSlot,feedbackReportOverlay.render(),{date:snapshot.date,busy:snapshot.busy||feedbackCanonicalReader.status(snapshot.date).loading});}return;}
  if(!slot || state.currentView !== 'journal')return;
  const snapshot=feedbackUiController.snapshot();
  if(snapshot.date!==state.selectedDate)return;
  feedbackReadonlyPatch(slot,feedbackCanonicalNotice(snapshot.date)+feedbackUiView(snapshot,feedbackCanonicalReader.body(snapshot.date)),{date:snapshot.date,busy:snapshot.busy||feedbackCanonicalReader.status(snapshot.date).loading});
}
registerActions({
 "feedback-regenerate":()=>{ensureFeedbackClients();feedbackUiController.selectDate(state.selectedDate);feedbackUiController.begin();},
 "feedback-refresh":()=>{const controller=state.currentView === "ai-reports" ? feedbackReportController : feedbackUiController;void feedbackCanonicalReader?.refresh(controller?.snapshot().date);return controller?.refresh();},
 "feedback-report-refresh":()=>Promise.all([feedbackCanonicalReader?.refresh(feedbackReportController?.snapshot().date),feedbackReportOverlay?.refresh()]),
 "feedback-report-date":({target})=>{feedbackReportOverlay?.select(target.dataset.feedbackDate);feedbackReportController?.refresh();},
 "feedback-version":({target})=>(state.currentView === "ai-reports" ? feedbackReportController : feedbackUiController)?.selectVersion(target.dataset.feedbackVersion),
 "feedback-resume":({target})=>(state.currentView === "ai-reports" ? feedbackReportController : feedbackUiController)?.resume(target.dataset.feedbackId),
 "feedback-retry":({target})=>(state.currentView === "ai-reports" ? feedbackReportController : feedbackUiController)?.resume(target.dataset.feedbackId,Number(target.dataset.feedbackAttempt))
});`);
 s=once(s,'if (view === "journal") main.innerHTML = renderJournal();','if (view === "journal") {\n    main.innerHTML = renderJournal();\n    main.querySelector(".journal-tower").insertAdjacentHTML("beforeend", renderFeedbackUiSlot(state.selectedDate));\n  }');
 s=once(s,'function renderAiReportBody(type) {',`function renderAiReportBody(type) {\n  if(type.id === "feedback"){ensureFeedbackClients();if(!feedbackOverlayLoaded){feedbackOverlayLoaded=true;queueMicrotask(()=>{void feedbackCanonicalReader.refresh();void feedbackReportOverlay.refresh();});}return '<div data-feedback-overlay-slot>'+feedbackReportOverlay.render()+'</div>';}`);
 s=once(s,'    updateBatteryTick();','    updateBatteryTick();\n    (state.currentView === "ai-reports" ? feedbackReportController : feedbackUiController)?.tick(document.visibilityState === "visible" && ["journal","ai-reports"].includes(state.currentView));');
 s=once(s,'  maybeRefreshFeedback();                    // v77:','  if(state.currentView === "ai-reports") feedbackReportOverlay?.refresh();\n  else if(state.currentView === "journal") feedbackUiController?.refresh();\n  maybeRefreshFeedback();                    // v77:');
 s=once(s,'    state.journals[d] = target.value;','    state.journals[d] = target.value;\n    feedbackUiController?.inputChanged(d); feedbackReportController?.inputChanged(d);');
 s=once(s,'  if (todayFb && todayFb !== cachedFeedback[today]) {','  if (ensureVisionConnection() !== connectionKey || generation !== visionLegacyGeneration) return;\n  if (todayFb && todayFb !== cachedFeedback[today]) {');
 return s;
}
module.exports={transformApp,transformHttp,transformCoordinator,transformEntry};

