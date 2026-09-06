import {stamp} from './feedback-result.js';
export function createFeedbackUiView({escapeHTML:e,renderMarkdown}={}) {
 if(typeof e!=='function'||typeof renderMarkdown!=='function')throw Error('view_configuration');
 const button=(action,label,attrs='',disabled=false)=>`<button type="button" class="btn ${action==='feedback-regenerate'?'primary':'ghost'}" data-action="${action}" ${attrs}${disabled?' disabled':''}>${e(label)}</button>`;
 const rowKey=row=>`${row.entry.requestId}/${row.entry.attempt}`;
 function rowLabel(row,s){
  if(row.status==='succeeded')return s.versions.some(v=>v.key===rowKey(row)&&v.row.result.outputHash===row.result.outputHash)?'新版の本文を確認済み':'生成済み・本文未取得';
  if(row.status==='failed')return '生成に失敗';
  if(row.status==='running')return '処理中';
  if(row.status==='queued') {let elapsed=0;try{elapsed=s.now-stamp(row.request.requestedAt);}catch{}return elapsed>=900000?'処理状況を確認できません':'受付済み・応答待ち';}
  return '処理状況を確認できません';
 }
 return (s,originalMarkdown=null)=>{
  const selected=s.versions.find(v=>v.key===s.selected),latest=s.rows[0],states={idle:'未確認',loading:'確認中',preparing:'入力を保存・送信して依頼を準備中',accepted:'依頼の受付を確認済み',ready:'処理状況を確認しました',unconfirmed:'保存・通信・受付の確認が必要です'};
  const history=s.rows.map(row=>{const key=rowKey(row),version=s.versions.find(v=>v.key===key),attrs=`data-feedback-id="${e(row.entry.requestId)}" data-feedback-attempt="${row.entry.attempt}"`;
   return `<li><p>${e(row.entry.date)} · ${row.entry.attempt}回目 · ${e(rowLabel(row,s))}</p><details data-feedback-detail-key="input:${e(key)}"><summary>入力版の詳細</summary><p>${e(row.entry.inputHash)}</p></details>`+
    (version?button('feedback-version','この版を読む',`data-feedback-version="${e(key)}"`):'')+
    (row.status==='failed'&&!s.rows.some(other=>other.entry.requestId===row.entry.requestId&&other.entry.attempt>row.entry.attempt)?button('feedback-retry','同じ入力で再試行',attrs,s.busy):'')+'</li>';}).join('');
  const pending=s.pending&&s.pending.stage!=='queued'?`<p>${s.pending.stage==='input_sent'?'入力は送信済み・依頼未受付':'受付を確認できていません'}</p>`+button('feedback-resume','同じ依頼を再確認・再開',`data-feedback-id="${e(s.pending.requestId)}"`,s.busy):'';
  const body=selected?renderMarkdown(selected.text):typeof originalMarkdown==='string'?renderMarkdown(originalMarkdown):'<p>以前の本文は未取得です。</p>';
  const originalMark=!selected&&s.originalFile&&typeof originalMarkdown==='string'&&originalMarkdown.length>0?` data-report-file="${e(s.originalFile)}" data-report-loaded="1"`:'';
  const changed=selected&&s.currentHash&&selected.row.entry.inputHash!==s.currentHash?'<p>追記未反映。この版は以前に送信した入力から作成されています。</p>':selected&&!s.currentHash?'<p>現在の入力との一致は未確認です。</p>':'';
  return `<section class="feedback-regeneration panel" aria-label="フィードバック再作成"><h3>${e(s.date||'日付未選択')}のフィードバック</h3><p>フィードバックだけを作り直します。ジャーナルに書いた依頼は再実行しません。</p>`+
   `<div class="feedback-controls">${s.readOnly?'':button('feedback-regenerate','現在の入力から再作成を依頼','',s.busy)}${button('feedback-refresh','処理状況を再確認','',s.busy)}${button('feedback-version','以前のフィードバック・依頼処理結果',`data-feedback-version="original"`)}</div>`+
   `<p role="status">${e(states[s.status]||'未確認')}</p>${s.status==='unconfirmed'&&s.lastGoodAt!==null?'<p>前回確認できた履歴を表示しています。</p>':''}`+
   `<p>最終確認: ${s.lastGoodAt===null?'未確認':e(new Date(s.lastGoodAt).toISOString())}</p>${pending}${changed}<div class="feedback-version-body md-render"${originalMark}>${body}</div><details data-feedback-detail-key="history"><summary>再作成の履歴（${s.rows.length}件）</summary><ol>${history}</ol></details></section>`;
 };
}
