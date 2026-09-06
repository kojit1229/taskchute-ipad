import {FUND_REPORT_TYPES,fundReportFile,validReportDate,resolveFundReportLink} from './report-selection.js';
const labels={fable:'FABLE',codex:'CODEX'};
export function createFundReportView({selection,gateway,escapeHTML,renderMarkdown,onUpdate=()=>{},onBack=()=>{}}) {
  if(!selection || !gateway || [escapeHTML,renderMarkdown,onUpdate,onBack].some(f=>typeof f!=='function')) throw new TypeError('invalid_configuration');
  let sequence=0;
  const text=v=>escapeHTML(String(v??''));
  const received=v=>{try {return typeof v==='number' && Number.isFinite(v)?new Date(v).toISOString():'未確認';} catch {return '未確認';}};
  const historyEntries=()=>gateway.snapshot('report-index.json').data?.files||[];
  const reportKind=(engine,family)=>FUND_REPORT_TYPES.find(t=>t.engine===engine && t.family===family)?.kind;
  function stateText(s,family) {
    if(s.loading) return '読み込み中';
    return ({idle:'未取得',available:'取得済み',missing:family==='brief'?'この日のブリーフはありません':'この日の日誌はありません',
      disconnected:'接続設定が必要です',unauthorized:'読み取り権限を確認してください',offline:'オフライン',
      invalid:'本文の形式を確認できません',failed:s.error==='timeout'?'取得が時間内に終わりませんでした':'取得に失敗しました',
      disposed:'読み取りを終了しました'})[s.state]||'未確認';
  }
  function snapshot() {
    const selected=selection.snapshot();
    return Object.freeze({...selected,report:selected.name?gateway.snapshot(selected.name):null,
      index:gateway.snapshot('report-index.json'),history:selection.history(historyEntries())});
  }
  function notify(area='report',date) {onUpdate(Object.freeze({area,...(date?{date}:{}),selection:selection.snapshot()}));}
  async function loadCurrent({force=false}={}) {
    const started=sequence;
    const initial=selection.snapshot(),indexWork=gateway.load('report-index.json',{force});
    if(!initial.name) {
      const index=await indexWork;
      if(started!==sequence || index.discarded) return {discarded:true};
      selection.initialize(historyEntries());
    } else {
      // Explicit dates can load even if the history index is slow or absent.
      void indexWork.then(index=>{if(started===sequence && !index.discarded) notify();});
    }
    const selected=selection.snapshot();
    if(!selected.name) {notify();return snapshot();}
    const pending=gateway.load(selected.name,{force});notify();
    const result=await pending;
    if(started!==sequence || result.discarded || selected.name!==selection.snapshot().name) return {discarded:true};
    notify();return snapshot();
  }
  function select(engine,family,date) {
    const kind=reportKind(engine,family);
    if(!kind || (date!==undefined && !validReportDate(date))) throw new TypeError('invalid_selection');
    sequence++;selection.select(kind,...(date===undefined?[]:[date]));notify();return loadCurrent();
  }
  function move(direction) {
    sequence++;selection.move(historyEntries(),direction);notify();return loadCurrent();
  }
  function refresh() {sequence++;return loadCurrent({force:true});}
  function openLink(href) {
    const target=resolveFundReportLink(href);
    if(!target) return false;
    void select(target.engine,target.family,target.date);return true;
  }
  function render() {
    const s=snapshot(),family=s.family==='brief'?'朝の投資ブリーフ':'日誌',report=s.report;
    const validBody=typeof report?.data==='string' && report.data.trim().length>0;
    const status=report?stateText(report,s.family):'日付を選ぶための一覧を確認しています';
    const indexState=s.index.loading?'読み込み中':s.index.state==='available'?'取得済み':s.index.state==='idle'?'未取得':
      s.index.state==='disconnected'?'接続設定が必要です':s.index.state==='offline'?'オフライン':'一覧の取得に失敗しました';
    const at=s.history.indexOf(s.date);
    const sources=s.index.sources;
    const indexFallback=sources?.index==='stale_empty'?'一覧ファイルが古く、履歴もないため':sources?.index==='stale'?'一覧ファイルが古いため':sources?.index==='empty'?'一覧ファイルに履歴がないため':null;
    const partial=indexFallback
      ? `${indexFallback}、${sources.directory==='available'?'フォルダの履歴も確認しました。':'フォルダを再確認しましたが取得できませんでした。表示中の履歴は最新とは確認できていません。'}`
      : sources?.directory==='available' && sources.index!=='available'
      ? '一覧ファイルを確認できないため、フォルダで確認できた履歴を表示しています。'
      : sources?.index==='available' && ['failed','invalid'].includes(sources.directory)
        ? 'フォルダの再確認に失敗しました。一覧ファイルで確認できた履歴を表示しています。' : '';
    return `<section class="fund-report-view" data-fund-report-view><h2>${labels[s.engine]} ${family}</h2>
      <div class="segmented">${Object.keys(labels).map(e=>`<button type="button" class="btn ghost ${s.engine===e?'active':''}" style="min-height:44px" data-action="fund-report-engine" data-engine="${e}" aria-pressed="${s.engine===e}">${labels[e]}</button>`).join('')}</div>
      <div class="segmented">${[['journal','日誌'],['brief','朝の投資ブリーフ']].map(([f,l])=>`<button type="button" class="btn ghost ${s.family===f?'active':''}" style="min-height:44px" data-action="fund-report-family" data-family="${f}" aria-pressed="${s.family===f}">${l}</button>`).join('')}</div>
      <div class="row"><button type="button" class="btn ghost" style="min-height:44px" data-action="fund-report-previous" ${at<0||at>=s.history.length-1?'disabled':''}>前の日</button>
      <select data-fund-report-date style="font-size:16px;min-height:44px" aria-label="日誌と朝ブリーフの選択日">${s.history.length?s.history.map(d=>`<option value="${d}" ${d===s.date?'selected':''}>${d}</option>`).join(''):'<option value="">日付の記録なし</option>'}</select>
      <button type="button" class="btn ghost" style="min-height:44px" data-action="fund-report-next" ${at<=0?'disabled':''}>次の日</button>
      <button type="button" class="btn ghost" style="min-height:44px" data-action="fund-report-refresh">再取得</button>
      <button type="button" class="btn ghost" style="min-height:44px" data-action="fund-report-back">戻る</button></div>
      <p class="fund-note">履歴一覧：${indexState} ／ 一覧生成時刻：${text(s.index.data?.generatedAt||'未確認')}</p>
      ${partial?`<p class="fund-note" role="status">${partial}</p>`:''}
      <section class="panel fund-journal"><h3>${labels[s.engine]} ${text(s.date||'日付未選択')} ${family}</h3>
      <p class="fund-status-line" role="status">${status}${validBody && report.state!=='available'?'。前回正常に取得した本文を表示しています':''}</p>
      <p class="fund-note">正常取得時刻（UTC）：${received(report?.lastSuccessAt)} ／ 今回の取得試行（UTC）：${received(report?.lastAttemptAt)}</p>
      ${validBody?`<div class="md-render readonly-md" data-report-file="${text(s.name)}" data-report-loaded="${report.state==='available'?'1':'0'}">${renderMarkdown(report.data)}</div>`:''}
      ${!s.date?'<p>読みたい日付の記録がまだありません</p>':''}</section></section>`;
  }
  function money(date) {
    if(!validReportDate(date)) return '';
    return `<section data-fund-money data-date="${date}">${Object.keys(labels).map(engine=>{
      const name=fundReportFile(reportKind(engine,'journal'),date),s=gateway.snapshot(name);
      const body=typeof s.data==='string'?s.data:'',summary=body.split(/\r?\n/).map(v=>v.trim()).find(Boolean)||'';
      return `<article class="fund-money-summary"><h4>${labels[engine]} FUND ${date}</h4><p>${stateText(s,'journal')}${body && s.state!=='available'?'。前回取得した本文の要約です':''}</p>
        ${summary?`<p>${text(summary.replace(/^#{1,6}\s*/, '').slice(0,60))}</p>`:''}
        <p class="fund-note">正常取得時刻（UTC）：${received(s.lastSuccessAt)}</p>
        <button type="button" class="btn ghost" style="min-height:44px" data-action="fund-report-open" data-engine="${engine}" data-family="journal" data-date="${date}">この日の日誌を読む</button></article>`;
    }).join('')}</section>`;
  }
  async function loadMoney(date,{force=false}={}) {
    if(!validReportDate(date)) throw new TypeError('invalid_date');
    const result=await Promise.all(Object.keys(labels).map(engine=>gateway.load(fundReportFile(reportKind(engine,'journal'),date),{force})));
    if(result.some(r=>r.discarded)) return {discarded:true};
    notify('money',date);return money(date);
  }
  return Object.freeze({render,select,refresh,loadCurrent,money,loadMoney,snapshot,openLink,
    resolveLink:resolveFundReportLink,previous:()=>move(1),next:()=>move(-1),back:()=>onBack()});
}
