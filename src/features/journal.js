// src/features/journal.js — app.js分割・段階4-3(ジャーナルタブ本体+コンディションOS
// (朝/夜の体調・服薬・余力)・運動記録・今日行ったお店ログの抽出)。
//
// 【tower-restyle改装版】TOWER意匠化(第3弾先行分)。改装元: v223時点のsrc/features/journal.js。
// 変更点は renderJournal() 本体のみ(意匠ラッパー追加+パネル見出し文言の英語+日本語化)。
// ロジック・data-action・data-*・class・id・state操作・保存経路は一切変更していない
// (詳細差分はnotes.md参照)。
//
// 契約(prep-stage4-journal.md §7、src/features/wish.js冒頭コメントと同じconfigureXxx(deps)パターン):
//   1. state の再代入はしない(src/state/store.jsからlive binding importし、プロパティ変更のみ)。
//   2. escapeHTML/renderHeader/renderDateBar/renderMarkdown/renderModal/closeModal/addDays/
//      todayISO/weekRange/weekDays/showToast/nowDateTime/saveAndRender/personalDataReady/
//      latestSleepLogWithin/shortSleepDate/upsertMorningLine/renderExperimentSection/
//      JOURNAL_REQUEST_SECTIONはまだapp.js側に残る汎用ヘルパー・定数のため、configureJournal(deps)
//      による依存注入で受け取る(wish.js方式と同一)。
//   3. renderExperimentSection()はapp.js側の実験表示と共有する
//      コンポーネントのため、実体は移さずdeps注入で「呼ぶだけ」にする(§0/§4/§9 Must級)。
//   4. _journalSegmentOverride(朝/夜/本文detailsの手動開閉オーバーライド)は、click dispatcher
//      (app.js残留・"toggle-journal-segment"分岐)とこのファイルのrenderJournal()の両方が
//      読み書きするため、cachedFeedback(src/state/feedback-cache.js)と同じ理由で
//      独立モジュール src/state/journal-fold.js へ切り出し、双方からimportする。
//   5. ensureConditionLog(コンディションログの遅延初期化)は、このファイル内の各setXxx関数に
//      加えてapp.js側のinputイベントdispatcher(data-condition-note-date分岐、夜のひとこと)からも
//      呼ばれるため、wishHasTodayBlock(wish.js)と同じ「journal.js側へ移しexportし、app.js側は
//      ここからimportして参照を切り替えるだけ」の扱いにした(ロジック無改変)。
//   6. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js(v168時点)の以下の関数群+モジュール定数。ロジックは一切変更していない
// (移動+依存注入化のみ)。
//   renderMorningEnergyPicker/renderConditionMorningExtra/renderEveningConditionCard/
//   lastGymRecord/renderGymLogCard/safeExternalUrl/storeVisitsForDate/renderStoreVisitsCard/
//   openStoreVisitEditor/buildStoreVisitModal/saveStoreVisitFromModal/deleteStoreVisit/
//   deleteStoreVisitWithConfirm/openStoreVisitsYearModal/buildStoreVisitsYearModal/
//   hoursLabel/renderSleepCard/renderJournal/ensureJournal/defaultJournal/setMorningEnergy/
//   ensureConditionLog/conditionRecordedDates/conditionRecordedCountThisWeek/
//   toggleConditionMeds/setConditionCapacity/setEveningMood/addGymEntry/deleteGymEntry
//   (以上、排他的サブウィジェット+アクションハンドラ)+ energyLevels/
//   CONDITION_CAPACITY_OPTIONS/CONDITION_GYM_PRESETS/JOURNAL_PROMPTS(モジュール定数、
//   移動後はこのファイル内のみで参照)。
//
// 設計書(prep-stage4-journal.md)からの逸脱点(監督者への報告事項):
//   a. 設計書§7/§9が「sync層(computeSyncMerge)からの呼び出し元次第で移動先を再検討すべき」と
//      名指ししていたmergeJournalMetaByWinners/journalTemplateTextForは、grepの結果v168時点の
//      app.jsに存在しない(設計書調査時点より前に整理されたか、そもそも実装されなかったと
//      推測される)。該当なしのため今回の抽出には含めていない。
//   b. energyLevels(5段階ラベル定数)は設計書§4がHome側computeHomeBatteryInfoとの共有可能性を
//      示唆していたが、grep実測では朝/夜の体調カード+setMorningEnergyの3箇所以外に参照が無く、
//      Home側は同じ値をstate.settings.morningEnergyLog経由(stateのlive binding)で読むのみで
//      energyLevels定数自体は参照していないため、このファイルへ全面移動した(app.js側に残さない)。
//   c. hoursLabel(睡眠時間の表示整形)もrenderSleepCard内のみの参照だったため全面移動した
//      (latestSleepLogWithin/shortSleepDateはstats/CSV取込側とも共有のためapp.js残留・deps注入)。
//
// characterization test: tests/journal-core.test.js。

import { state } from "../state/store.js";
import { _journalSegmentOverride } from "../state/journal-fold.js";
import { _lastSaveError } from "../storage/local.js";
import { registerActions } from "../ui/actions.js";

// ---- 依存注入(configureJournal) ----
let escapeHTML, renderHeader, renderDateBar, renderMarkdown, renderModal, closeModal;
let addDays, todayISO, weekRange, weekDays, showToast, nowDateTime, saveAndRender, saveState;
let personalDataReady, latestSleepLogWithin, shortSleepDate, upsertMorningLine;
let renderExperimentSection, JOURNAL_REQUEST_SECTION, blocksForDate, taskchuteStartRate;
let timeFromDateTime, flightLogBlocks, bodyScansForDate, bmSummary;
let healthForDate, latestHealthWithin, healthSummaryHTML, fundJournalSummaryForDate;

function configureJournal(deps) {
  ({
    escapeHTML, renderHeader, renderDateBar, renderMarkdown, renderModal, closeModal,
    addDays, todayISO, weekRange, weekDays, showToast, nowDateTime, saveAndRender, saveState,
    personalDataReady, latestSleepLogWithin, shortSleepDate, upsertMorningLine,
    renderExperimentSection, JOURNAL_REQUEST_SECTION, blocksForDate, taskchuteStartRate,
    timeFromDateTime, flightLogBlocks, bodyScansForDate, bmSummary,
    healthForDate, latestHealthWithin, healthSummaryHTML, fundJournalSummaryForDate
  } = deps);
  // v173: app.js分割・段階5-2(prep-stage5-dispatcher.md案A)。click dispatcherのコンディションOS
  // (朝/夜の体調・服薬・余力)+運動記録+お店ログの分岐をレジストリへ移行する
  // (ロジック無改変)。0秒思考/週次/サイクル/問い等の他journalドメインはこのファイル未抽出のため
  // 対象外(app.js残留)。
  registerActions({
    "set-morning": (ctx) => setMorningEnergy(Number(ctx.target.dataset.value)),
    // v235: set-sleepは主観睡眠の入力経路廃止に伴う意図的削除。旧stateは読み取り互換のため温存する。
    "toggle-meds": () => toggleConditionMeds(state.selectedDate),
    "set-capacity": (ctx) => setConditionCapacity(state.selectedDate, ctx.target.dataset.value),
    "set-evening-mood": (ctx) => setEveningMood(state.selectedDate, Number(ctx.target.dataset.value)),
    "add-gym-entry": (ctx) => addGymEntry(ctx.target.dataset.date || state.selectedDate),
    "delete-gym-entry": (ctx) => deleteGymEntry(ctx.target.dataset.date || state.selectedDate, ctx.id),
    "store-visit-add": (ctx) => openStoreVisitEditor("", ctx.target.dataset.date || state.selectedDate),
    "store-visit-edit": (ctx) => openStoreVisitEditor(ctx.id),
    "store-visit-delete": (ctx) => deleteStoreVisitWithConfirm(ctx.id),
    "store-visit-year": () => openStoreVisitsYearModal(),
    // v294: 「書く瞑想」パネル(充放電ログ改善R1a)。チップ追加/削除は差分パッチのみで、
    // renderJournal()全体は再描画しない(WBS検索v288と同じ禁則。フォーカス/IME保護)。
    "km-chip-add": (ctx) => addWriteMeditationChipFromInput(ctx.target.dataset.kind, ctx.target.dataset.date),
    "km-chip-remove": (ctx) => removeWriteMeditationChip(ctx.target.dataset.kind, ctx.target.dataset.date, ctx.id),
    // v296(R1b): 候補チップタップ→同じ追加口(addWriteMeditationChip)。フォーカス移動はしない。
    "km-chip-candidate": (ctx) => addWriteMeditationChip(ctx.target.dataset.kind, ctx.target.dataset.date, ctx.target.dataset.text),
    "km-save": (ctx) => saveWriteMeditationEntry(ctx.target.dataset.date)
  });
}

// ---- ここから抽出したコード本体(app.js:v168時点から移動。ロジック無改変) ----

const energyLevels = [
  { value: 10, label: "良い" },
  { value: 7, label: "少し良い" },
  { value: 5, label: "普通" },
  { value: 3, label: "少し悪い" },
  { value: 0, label: "悪い" }
];

// v38: 朝の体調ピッカー(ジャーナル当日編集の上部)。
//      記録するとエネルギーグラフの始点と、ジャーナル本文の「朝の体調」行に反映される。
//      これまで setMorningEnergy は存在するのに呼び出すUIがなく、常に既定値(5)だった。
function renderMorningEnergyPicker(date) {
  const current = state.settings.morningEnergyLog?.[date];
  return `
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:10px; align-items:center">
      <span class="muted" style="font-size:12.5px; font-weight:700">🌅 朝の体調</span>
      ${energyLevels.map((l) => `
        <button class="btn ${current === l.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
          data-action="set-morning" data-value="${l.value}">${l.label}</button>
      `).join("")}
      ${current === undefined ? `<span class="muted" style="font-size:11px">未記録(タップで記録 → エネルギーグラフの始点になります)</span>` : ""}
    </div>
  `;
}

// v73: コンディションOS ==========================================================
// 「朝の体調」欄(上のrenderMorningEnergyPicker)を入口として拡張する。体調の値そのものは
// 既存の morningEnergyLog を継続利用し(二重管理を避ける)、ここでは服薬・今日の余力という
// 軽量フィールドだけを入力する。v235で主観睡眠の入力UIは廃止し、実測sleep.logsへ一本化した。
const CONDITION_CAPACITY_OPTIONS = [
  { value: "full", label: "全力でいける" },
  { value: "normal", label: "普通" },
  { value: "minimal", label: "最低限で" }
];

function renderConditionMorningExtra(date) {
  const log = state.condition.logs[date] || {};
  return `
    <div class="cond-row" style="margin-bottom:8px">
      <span class="muted cond-row-label">💊 服薬</span>
      <button class="btn ${log.meds ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center" data-action="toggle-meds">
        ${log.meds ? "済み" : "まだ"}
      </button>
    </div>
    <div class="cond-row" style="margin-bottom:10px">
      <span class="muted cond-row-label">🔋 今日の余力</span>
      <span class="row cond-btn-row">
        ${CONDITION_CAPACITY_OPTIONS.map((c) => `
          <button class="btn ${log.capacity === c.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
            data-action="set-capacity" data-value="${c.value}">${c.label}</button>
        `).join("")}
      </span>
    </div>
    <div class="muted cond-week-note" style="font-size:11px; margin-bottom:10px">📝 今週は${conditionRecordedCountThisWeek()}回書けました</div>
  `;
}

// 夜の記録: 体調(朝と同じ5段階を再利用)+ ひとこと(任意)。加点式のため空欄でも何も咎めない。
function renderEveningConditionCard(date) {
  const log = state.condition.logs[date] || {};
  return `
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px; align-items:center">
      <span class="muted" style="font-size:12.5px; font-weight:700">🌙 夜の体調</span>
      ${energyLevels.map((l) => `
        <button class="btn ${log.eveningMood === l.value ? "primary" : "ghost"}" style="font-size:12px; padding:6px 10px; min-height:44px; display:inline-flex; align-items:center"
          data-action="set-evening-mood" data-value="${l.value}">${l.label}</button>
      `).join("")}
    </div>
    <input type="text" class="cond-evening-note" maxlength="80" placeholder="今日のひとこと(任意)"
      data-condition-note-date="${date}" value="${escapeHTML(log.eveningNote || "")}" style="margin-bottom:10px">
  `;
}

// 運動記録: 体調記録の入口から1タップで追記。「①タスク名から目標重量を表示」は無理をせず見送り、
// 代わりに同じ種目の直近記録を軽い目安として添えるだけに留める(CHANGES_v73.md参照)。
const CONDITION_GYM_PRESETS = ["ベンチプレス", "デッドリフト", "スクワット"];

function lastGymRecord(exercise, excludeDate) {
  const rows = [];
  Object.entries(state.condition.logs).forEach(([date, log]) => {
    if (date === excludeDate) return;
    (log.gym || []).forEach((g) => { if (!g.deleted && g.exercise === exercise) rows.push({ date, ...g }); });
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows[0] || null;
}

function renderGymLogCard(date) {
  const log = state.condition.logs[date] || {};
  const entries = (log.gym || []).filter((g) => !g.deleted).slice().reverse();
  return `
    <div class="cond-gym-card" style="margin-bottom:10px">
      <span class="muted" style="font-size:12.5px; font-weight:700">🏋 運動記録</span>
      <div class="row cond-gym-add" style="gap:6px; flex-wrap:wrap; margin-top:6px">
        <input type="text" id="gym-exercise-input" list="gym-exercise-presets" placeholder="種目" class="cond-gym-input" style="width:120px">
        <datalist id="gym-exercise-presets">${CONDITION_GYM_PRESETS.map((p) => `<option value="${escapeHTML(p)}">`).join("")}</datalist>
        <input type="number" id="gym-weight-input" placeholder="kg" class="cond-gym-input" style="width:70px" step="2.5" min="0">
        <span class="muted">kg ×</span>
        <input type="number" id="gym-reps-input" placeholder="回" class="cond-gym-input" style="width:60px" min="0">
        <button class="btn primary" style="font-size:12px; padding:6px 12px" data-action="add-gym-entry" data-date="${date}">記録</button>
      </div>
      ${entries.length ? `<div class="cond-gym-list" style="margin-top:8px">
        ${entries.map((g) => {
          const best = lastGymRecord(g.exercise, date);
          return `<div class="check-row">
            <span class="check-row-name">${escapeHTML(g.exercise)} ${g.weight}kg × ${g.reps}${best ? `<span class="muted" style="font-size:11px"> (前回 ${best.weight}kg×${best.reps} / ${best.date})</span>` : ""}</span>
            <button class="btn ghost" style="font-size:11px; padding:4px 8px" data-action="delete-gym-entry" data-date="${date}" data-id="${escapeHTML(g.id)}">×</button>
          </div>`;
        }).join("")}
      </div>` : `<div class="muted" style="font-size:11px; margin-top:6px">まだ記録がありません</div>`}
    </div>
  `;
}
// ========================================================================

// v141: 今日行ったお店ログ =========================================================
// ジャーナルタブから店名/URL(任意)/感想を記録する。1日に複数件登録可。年間一覧はモーダルで
// 月別グループ表示する(state.storeVisitsはtasks/projectsと同じmergeByIdPreferNewerで
// 多端末マージ・tombstone削除。normalizeState参照)。

// href属性へそのまま埋め込んでよいURLかどうかを検証する(escapeHTMLは文字のエスケープのみで
// javascript:等の危険なスキームは防げないため)。http(s)以外(javascript:/data:等)は
// リンク化せず、店名をプレーンテキストとして表示するフェイルセーフにする。
function safeExternalUrl(url) {
  const s = String(url || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function storeVisitsForDate(date) {
  return (state.storeVisits || [])
    .filter((v) => v.date === date && !v.deleted)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

function renderStoreVisitsCard(date) {
  const visits = storeVisitsForDate(date);
  return `
    <div class="store-visit-card" data-store-visits-date="${date}" style="margin-bottom:10px; padding:10px 12px; background:var(--panel-soft); border-radius:8px">
      <div class="row" style="margin-bottom:6px">
        <span class="muted" style="font-size:12.5px; font-weight:700">🏪 今日行ったお店</span>
        <div class="row" style="gap:6px">
          <button class="btn ghost" style="font-size:12px; padding:5px 10px" data-action="store-visit-year">📅 年間一覧</button>
          <button class="btn primary" style="font-size:12px; padding:5px 10px" data-action="store-visit-add" data-date="${date}">+ 追加</button>
        </div>
      </div>
      ${visits.length ? visits.map((v) => {
        const safeUrl = safeExternalUrl(v.url);
        return `
        <div class="check-row" style="align-items:flex-start; flex-wrap:wrap">
          <div style="flex:1; min-width:0">
            <div class="check-row-name" style="font-weight:600">
              ${safeUrl ? `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(v.name)}</a>` : escapeHTML(v.name)}
            </div>
            ${v.comment ? `<div class="muted" style="font-size:12px; white-space:pre-wrap; margin-top:2px">${escapeHTML(v.comment)}</div>` : ""}
          </div>
          <div class="row" style="gap:4px">
            <button class="btn ghost" style="font-size:11px; padding:4px 8px" data-action="store-visit-edit" data-id="${v.id}">編集</button>
            <button class="btn ghost" style="font-size:11px; padding:4px 8px" data-action="store-visit-delete" data-id="${v.id}">×</button>
          </div>
        </div>`;
      }).join("") : `<div class="muted" style="font-size:11px">まだ記録がありません</div>`}
    </div>
  `;
}

// v317: LIFE再配置後もジャーナル全体を再描画せず、本文textareaとIMEを守る。
function patchStoreVisitsCard(date) {
  const card = document.querySelector(`.store-visit-card[data-store-visits-date="${date}"]`);
  if (card) card.outerHTML = renderStoreVisitsCard(date);
}

function saveAndPatchStoreVisits(date, message) {
  saveState();
  patchStoreVisitsCard(date);
  if (!_lastSaveError) showToast(message);
}

function openStoreVisitEditor(id, date) {
  const sv = id ? (state.storeVisits || []).find((v) => v.id === id && !v.deleted) : null;
  state.modal = { type: "storeVisit", id: id || "", date: sv?.date || date || state.selectedDate };
  renderModal(buildStoreVisitModal(sv, state.modal.date));
}

function buildStoreVisitModal(sv, date) {
  const isNew = !sv;
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">${isNew ? "お店を追加" : "お店を編集"}</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="muted" style="font-size:11.5px; margin-bottom:4px">${escapeHTML(date)} に行ったお店の記録</div>
        <div class="field">
          <label class="field-label">店名</label>
          <input class="input" data-modal-field="name" style="font-size:16px" placeholder="例: 〇〇食堂" value="${escapeHTML(sv?.name || "")}">
        </div>
        <div class="field">
          <label class="field-label">URL(任意)</label>
          <input class="input" type="url" data-modal-field="url" style="font-size:16px" placeholder="https://..." value="${escapeHTML(sv?.url || "")}">
        </div>
        <div class="field">
          <label class="field-label">感想</label>
          <textarea class="textarea" data-modal-field="comment" style="min-height:90px; font-size:16px" placeholder="感想メモ">${escapeHTML(sv?.comment || "")}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        ${isNew ? "" : `<button class="btn danger" data-action="modal-delete">削除</button>`}
        <button class="btn" data-action="modal-close">キャンセル</button>
        <button class="btn primary" data-action="modal-save">${isNew ? "追加" : "保存"}</button>
      </div>
    </div>`;
}

function saveStoreVisitFromModal(id, fields) {
  const name = (fields.name || "").trim();
  if (!name) return showToast("店名を入力してください");
  const url = (fields.url || "").trim();
  const comment = (fields.comment || "").trim();
  const date = (state.modal && state.modal.date) || state.selectedDate;
  if (id) {
    state.storeVisits = state.storeVisits.map((v) => v.id === id
      ? { ...v, name, url, comment, updatedAt: nowDateTime() }
      : v);
    closeModal();
    saveAndPatchStoreVisits(date, "お店の記録を更新しました");
    return;
  }
  state.storeVisits.push({
    id: crypto.randomUUID(), date, name, url, comment,
    createdAt: nowDateTime(), updatedAt: nowDateTime(), deleted: false
  });
  closeModal();
  saveAndPatchStoreVisits(date, "お店を記録しました");
}

// deleteFromModal()側(モーダル内「削除」ボタン経由)・カード上の×(即時)の両方から呼ばれる。
// どちらの経路も呼び出し前に確認ダイアログを通す(仕様: 既存件の削除は確認つき)。
function deleteStoreVisit(id) {
  const date = state.storeVisits.find((v) => v.id === id)?.date || state.selectedDate;
  state.storeVisits = state.storeVisits.map((v) => v.id === id
    ? { ...v, deleted: true, updatedAt: nowDateTime() } : v);
  saveAndPatchStoreVisits(date, "お店の記録を削除しました");
}

function deleteStoreVisitWithConfirm(id) {
  if (!window.confirm("このお店の記録を削除しますか?(この操作は取り消せます)")) return;
  deleteStoreVisit(id);
}

// 年間一覧: state.selectedDateの年を対象に、月別グループで一覧表示する(読み取り専用。
// 編集/削除は当日欄=state.selectedDateの日付ピッカーで対象日へ移動して行う)。
function openStoreVisitsYearModal() {
  const year = state.selectedDate.slice(0, 4);
  state.modal = { type: "storeVisitsYear", year };
  renderModal(buildStoreVisitsYearModal(year));
}

function buildStoreVisitsYearModal(year) {
  const visits = (state.storeVisits || [])
    .filter((v) => !v.deleted && v.date.slice(0, 4) === year)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const byMonth = new Map();
  visits.forEach((v) => {
    const m = v.date.slice(5, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(v);
  });
  const months = [...byMonth.keys()].sort();
  const body = months.length ? months.map((m) => `
    <div class="store-visit-year-month">
      <div class="muted" style="font-size:12px; font-weight:700; margin:10px 0 6px">${Number(m)}月</div>
      ${byMonth.get(m).map((v) => {
        const safeUrl = safeExternalUrl(v.url);
        return `
        <div class="check-row" style="align-items:flex-start; flex-wrap:wrap">
          <div style="flex:1; min-width:0">
            <div class="muted" style="font-size:11.5px">${escapeHTML(v.date)}</div>
            <div style="font-weight:600">${safeUrl ? `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(v.name)}</a>` : escapeHTML(v.name)}</div>
            ${v.comment ? `<div class="muted" style="font-size:12px; white-space:pre-wrap; margin-top:2px">${escapeHTML(v.comment)}</div>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
  `).join("") : `<div class="muted" style="font-size:12px">${escapeHTML(year)}年の記録はまだありません</div>`;
  return `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">🏪 お店 年間一覧(${escapeHTML(year)}年)</h3>
        <button class="modal-close" data-action="modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">
        <button class="btn" data-action="modal-close">閉じる</button>
      </div>
    </div>`;
}
// ========================================================================

// v294: 「書く瞑想」パネル =========================================================
// 充放電ログ改善計画R1a(K承認済み)。放電→充電の固定順チップ入力+任意の深掘りセルフトーク
// (放電/充電それぞれ1本のフリーテキスト)。独立state(state.writeMeditations、bodyScansと
// 同型のmergeById同期コレクション、1日1レコード=id:`wm_${date}`)へ保存し、state.journals[date]
// (FREE LOGの自由記述文字列。Homeタワーからも編集される既知の全文上書きリスクを持つ)には
// 一切書き込まない(journal-anatomy.md §3)。チップ追加/削除/保存はいずれもsaveState()のみ
// (renderJournal()全体は呼ばない。WBS検索v288と同じ「差分パッチでフォーカス/IMEを保護」禁則)。
function writeMeditationFor(date) {
  return (state.writeMeditations || []).find((w) => w.id === `wm_${date}` && !w.deleted) || null;
}

function ensureWriteMeditationEntry(date) {
  const existing = state.writeMeditations.find((w) => w.id === `wm_${date}`);
  if (existing) {
    if (existing.deleted) existing.deleted = false;
    return existing;
  }
  const entry = { id: `wm_${date}`, date, discharge: [], charge: [], dischargeTalk: "", chargeTalk: "", updatedAt: "", deleted: false };
  state.writeMeditations = [...state.writeMeditations, entry];
  return entry;
}

function writeMeditationChipListHTML(kind, date) {
  const items = writeMeditationFor(date)?.[kind] || [];
  if (!items.length) return `<div class="muted" style="font-size:11px; text-align:center; padding:6px 0">まだ何も追加されていません</div>`;
  return items.map((c) => `
    <div class="row" style="align-items:center; gap:8px; background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:9px 10px; font-size:13px; margin-bottom:6px">
      <span style="flex:1">${escapeHTML(c.text)}</span>
      <button class="btn ghost" style="font-size:11px; padding:4px 8px" data-action="km-chip-remove" data-kind="${kind}" data-date="${date}" data-id="${c.id}">×</button>
    </div>`).join("");
}

function writeMeditationOnelinerText(date) {
  const entry = writeMeditationFor(date);
  const d = entry?.discharge.length || 0;
  const c = entry?.charge.length || 0;
  // v294追従: 「未記入」はv73の裁かない文言契約(責める表現の禁止語)に抵触するため、
  // 人ではなくデータの状態を指す「未保存」を使う。
  return `放電${d}件・充電${c}件・${d || c ? "保存済み" : "未保存"}`;
}

// v296(R1b): 候補チップ(疲労/回復3以上の身体スキャン+当日の完了Block名+夜のひとこと)。
// タップでaddWriteMeditationChip経由の同じ入口へ流し込む(重複追加は下記のガードで無害にスキップ)。
// 候補一覧自体は当日データから毎回再計算するだけの読み取り専用関数(状態を持たない)。
// 閾値3以上はK裁定2026-08-30(当初案の4以上から変更)。
function writeMeditationCandidates(kind, date) {
  const candidates = [];
  const scanField = kind === "discharge" ? "fatigue" : "recovery";
  const scanLabel = kind === "discharge" ? "疲労" : "回復";
  (state.bodyScans || [])
    .filter((s) => (s.dateTime || "").startsWith(date) && Number(s[scanField]) >= 3)
    .forEach((s) => {
      const blockTitle = (state.blocks || []).find((b) => b.id === s.pomodoroBlockId && !b.deleted)?.title;
      if (blockTitle) candidates.push({ text: `${scanLabel}${s[scanField]}: ${blockTitle}`, tag: "身体スキャン" });
    });
  (state.blocks || [])
    .filter((b) => !b.deleted && b.date === date && b.completed && b.title)
    .forEach((b) => candidates.push({ text: b.title, tag: "完了Block" }));
  if (kind === "charge") {
    const eveningNote = (state.condition?.logs?.[date]?.eveningNote || "").trim();
    if (eveningNote) candidates.push({ text: eveningNote, tag: "今日の記録" });
  }
  return candidates;
}

function writeMeditationCandidateChipsHTML(kind, date) {
  const candidates = writeMeditationCandidates(kind, date);
  if (!candidates.length) return "";
  const usedTexts = new Set((writeMeditationFor(date)?.[kind] || []).map((c) => c.text));
  return `
    <div class="muted" style="font-size:11px; margin-bottom:4px">💡 候補から選ぶ(タップで追加)</div>
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px">
      ${candidates.map((c) => {
        const used = usedTexts.has(c.text);
        return `<button class="btn ghost" style="font-size:11px; padding:5px 9px; ${used ? "opacity:.35; pointer-events:none" : ""}"
          data-action="km-chip-candidate" data-kind="${kind}" data-date="${date}" data-text="${escapeHTML(c.text)}">${escapeHTML(c.text)} <span class="muted" style="font-size:9px">${c.tag}</span></button>`;
      }).join("")}
    </div>`;
}

// チップ追加/削除/保存の直後、パネル内の該当DOMだけを差し替える(renderJournal()全体は呼ばない)。
function patchWriteMeditationPanel(date) {
  ["discharge", "charge"].forEach((kind) => {
    const list = document.querySelector(`#km-${kind}-list`);
    if (list) list.innerHTML = writeMeditationChipListHTML(kind, date);
    const count = document.querySelector(`#km-${kind}-count`);
    if (count) count.textContent = `${(writeMeditationFor(date)?.[kind] || []).length} / 5件(目安)`;
    const candWrap = document.querySelector(`#km-${kind}-candidates-wrap`);
    if (candWrap) candWrap.innerHTML = writeMeditationCandidateChipsHTML(kind, date);
  });
  const oneliner = document.querySelector("#km-oneliner");
  if (oneliner) oneliner.textContent = writeMeditationOnelinerText(date);
}

// 手入力(km-chip-add)・候補チップ(km-chip-candidate)共通の追加口。同一テキストが既にリストに
// あれば無害にスキップする(候補チップの「使用済みは薄表示」もこの重複判定と一致させる)。
function addWriteMeditationChip(kind, date, rawText) {
  const trimmed = String(rawText || "").trim().slice(0, 80);
  if (!trimmed) return;
  const entry = ensureWriteMeditationEntry(date);
  if (entry[kind].some((c) => c.text === trimmed)) return;
  entry[kind] = [...entry[kind], { id: crypto.randomUUID(), text: trimmed }];
  entry.updatedAt = nowDateTime();
  saveState();
  patchWriteMeditationPanel(date);
}

// クリック(km-chip-add)・Enterキー(app.js側keydown dispatcher)の両方から呼ばれる共通入口。
function addWriteMeditationChipFromInput(kind, date) {
  const input = document.querySelector(`#km-${kind}-input`);
  addWriteMeditationChip(kind, date, input?.value || "");
  if (input) { input.value = ""; input.focus(); }
}

function removeWriteMeditationChip(kind, date, chipId) {
  const entry = writeMeditationFor(date);
  if (!entry) return;
  entry[kind] = entry[kind].filter((c) => c.id !== chipId);
  entry.updatedAt = nowDateTime();
  saveState();
  patchWriteMeditationPanel(date);
}

// app.js側のinputイベントdispatcher([data-km-talk]分岐、data-journal-dateと同じ全体再描画なし
// パターン)から呼ばれる。textareaはchangeイベント(=blur時、値が変わった場合のみ)で保存する。
function setWriteMeditationTalk(kind, date, text) {
  const entry = ensureWriteMeditationEntry(date);
  entry[kind === "discharge" ? "dischargeTalk" : "chargeTalk"] = String(text || "");
  entry.updatedAt = nowDateTime();
  saveState();
}

function saveWriteMeditationEntry(date) {
  const entry = writeMeditationFor(date);
  if (!entry || (entry.discharge.length === 0 && entry.charge.length === 0)) {
    showToast("放電・充電のいずれかを1件以上入力してください");
    return;
  }
  entry.updatedAt = nowDateTime();
  saveState();
  patchWriteMeditationPanel(date);
  showToast("書く瞑想を保存しました");
}

function writeMeditationChipInputHTML(kind, date, label) {
  return `
    <div style="background:var(--panel-soft); border-radius:10px; padding:10px; margin-bottom:8px">
      <div class="row" style="justify-content:space-between; margin-bottom:6px">
        <span style="font-size:12.5px; font-weight:700">${label}</span>
        <span class="muted" id="km-${kind}-count" style="font-size:11px">${(writeMeditationFor(date)?.[kind] || []).length} / 5件(目安)</span>
      </div>
      <div id="km-${kind}-candidates-wrap">${writeMeditationCandidateChipsHTML(kind, date)}</div>
      <div class="row" style="gap:6px; margin-bottom:8px">
        <input type="text" id="km-${kind}-input" class="input" style="flex:1; font-size:16px" maxlength="80" placeholder="自由入力して追加…">
        <button class="btn primary small" data-action="km-chip-add" data-kind="${kind}" data-date="${date}">追加</button>
      </div>
      <div id="km-${kind}-list">${writeMeditationChipListHTML(kind, date)}</div>
    </div>`;
}

function renderWriteMeditationPanel(date) {
  const entry = writeMeditationFor(date);
  return `
    <p class="muted" style="font-size:12.5px; line-height:1.6; margin:0 0 10px">放電(消耗)を出し切ってから、充電(良かったこと)で締めくくります。</p>
    ${writeMeditationChipInputHTML("discharge", date, "① 放電(気分・エネルギーを下げたもの)")}
    ${writeMeditationChipInputHTML("charge", date, "② 充電(良かったこと・ささやかな回復)")}
    <details class="fold" style="margin-bottom:8px">
      <summary class="fold-summary" style="font-size:12.5px"><span class="fold-chevron">▶</span>🔴 放電を深掘りする(任意)</summary>
      <div class="fold-body">
        <textarea class="textarea" style="min-height:100px; font-size:16px" data-km-talk="discharge" data-date="${date}"
          placeholder="なぜ引っかかったんだろう…(検閲されません)">${escapeHTML(entry?.dischargeTalk || "")}</textarea>
      </div>
    </details>
    <details class="fold" style="margin-bottom:10px">
      <summary class="fold-summary" style="font-size:12.5px"><span class="fold-chevron">▶</span>🟢 充電を深掘りする(任意)</summary>
      <div class="fold-body">
        <textarea class="textarea" style="min-height:100px; font-size:16px" data-km-talk="charge" data-date="${date}"
          placeholder="どんな瞬間が良かった?">${escapeHTML(entry?.chargeTalk || "")}</textarea>
      </div>
    </details>
    <button class="btn primary" style="width:100%" data-action="km-save" data-date="${date}">今日の書く瞑想を保存</button>
  `;
}
// ========================================================================

function hoursLabel(v) {
  if (v == null) return "–";
  return `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, "0")}m`;
}

// v131: AutoSleepは前夜分を21:00にしか確定しないため、朝の時点ではdateキーの当日分が
// まだ無いのが通常運転(実データ解析で確認済み)。latestSleepLogWithin()で直近2日以内に
// フォールバックし、フォールバックした日はヘッダに「M/D朝のデータ」と明示する
// (黙って当日扱いしない)。2日以内に1件も無ければ中立の未記録表示にする。
function renderSleepCard(date) {
  const found = latestSleepLogWithin(date);
  const uploadBtn = () => `
    <label class="btn ghost" style="font-size:12px; padding:6px 10px; cursor:pointer; white-space:nowrap">
      📤 睡眠CSV
      <input type="file" accept=".csv,text/csv" data-sleep-csv-upload hidden>
    </label>`;
  if (!found) {
    const health = latestHealthWithin(date);
    const healthSleep = health?.date === date && Number.isFinite(health.sleep_min)
      ? `Apple Health: 睡眠 ${Math.floor(health.sleep_min / 60)}h${String(health.sleep_min % 60).padStart(2, "0")}m${health.bed_time || health.wake_time ? ` (${health.bed_time || "—"}→${health.wake_time || "—"})` : ""}`
      : "";
    return `
      <div class="row sleep-card-empty" style="margin-bottom:10px; padding:10px 12px; border-radius:10px; justify-content:space-between; align-items:center; background:var(--panel-soft)">
        <span class="muted" style="font-size:13px"><span>前夜の睡眠: 未記録(AutoSleep CSV をアップロードすると表示)</span>${healthSleep ? `<small style="display:block; margin-top:3px">${escapeHTML(healthSleep)}</small>` : ""}</span>
        ${uploadBtn()}
      </div>`;
  }
  const { log, logDate, ageDays } = found;
  const chip = (label, val) => `<span style="font-size:12px"><span class="muted">${label}</span> <b>${val}</b></span>`;
  const headerLabel = ageDays > 0
    ? `💤 ${shortSleepDate(logDate)}朝のデータ(前夜分はAutoSleep未確定)`
    : "💤 前夜の睡眠";
  return `
    <div class="row" style="margin-bottom:10px; padding:10px 12px; border-radius:10px; background:var(--panel-soft); justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px">
      <span class="row" style="gap:10px; flex-wrap:wrap; align-items:center">
        <span style="font-size:13px; font-weight:700">${headerLabel}</span>
        ${chip("就寝→起床", `${log.bed || "–"}→${log.wake || "–"}`)}
        ${chip("睡眠", hoursLabel(log.sleepH))}
        ${chip("効率", log.eff == null ? "–" : `${Math.round(log.eff)}%`)}
        ${chip("深さ", hoursLabel(log.deepH))}
        ${log.hrSleep != null ? chip("HR", Math.round(log.hrSleep)) : ""}
        ${log.hrvSleep != null ? chip("HRV", Math.round(log.hrvSleep)) : ""}
      </span>
      ${uploadBtn()}
    </div>`;
}

// v17: 各セクションの思考プロンプト(画面表示用、Markdown 出力時は省く)
const JOURNAL_PROMPTS = {
  // v105: 「🛏 睡眠」はテンプレ廃止(実測は睡眠CSV取込に一本化)に伴い削除
  // v296(R1b): 感謝/ハイライト/気付き・学びの3つは「書く瞑想」パネル(上)へ役割を移した。
  // 見出し自体は後方互換のため残し、ヒント文言だけを誘導文に差し替える(v73責め語彙禁止=
  // 「未記入」ではなく「上へ」という事実案内のみ)。
  "🙏 感謝(3 つ)": "「書く瞑想」パネル(上)の②充電へ移りました。良かったこと・感謝したいことはそちらへどうぞ。",
  "✨ 今日のハイライト": "同じく「書く瞑想」パネル(上)の②充電へ。候補チップから完了Blockを選ぶと早いです。",
  "💡 気付き・学び": "「書く瞑想」パネル(上)③の深掘り(放電/充電セルフトーク)へ移りました。うまくいった/いかなかった理由はそこで言語化できます。",
  "📝 自由記述": "・いまなに考えてる?\n・言葉にならない違和感を、まず雑に書き出す。コントロールできないことは手放してOK。\n・夢・思いつき・心配ごと・読書メモ・なんでも。",
  // v91: 「### 依頼」見出し配下のヒント(JOURNAL_REQUEST_SECTIONの見出しテキストと対応させる)
  "依頼": "AIにやってほしいことがあれば、1行1件でここに書く(例:「相場帳のバグを直して」)。翌朝のバッチが読み取り、タスク登録・0秒思考テーマ登録・Wish追加などをホワイトリスト操作として試みます。"
};

function ensureJournal(date) {
  if (!state.journals[date]) {
    // v38: journalTemplate には作成時の日付が「# YYYY-MM-DD のジャーナル」として
    //      焼き込まれているため、その日の日付に置き換えてから使う
    //      (毎日同じ日付のジャーナルが生成されていた)
    const tpl = state.settings.journalTemplate || defaultJournal(date);
    state.journals[date] = tpl.replace(/^# \d{4}-\d{2}-\d{2} のジャーナル/m, `# ${date} のジャーナル`);
  }
}

// v17: 統合版ジャーナルテンプレ(朝夜の分割を廃止、1ページに集約)
// 思考プロンプトは画面表示のヒントとしてのみ機能(Markdown には含めない)
function defaultJournal(date) {
  return [
    `# ${date} のジャーナル`,
    ``,
    `## 🙏 感謝(3 つ)`,
    `1. `,
    `2. `,
    `3. `,
    ``,
    `## ✨ 今日のハイライト`,
    ``,
    ``,
    `## 💡 気付き・学び`,
    ``,
    ``,
    `## 📝 自由記述`,
    ``,
    ``,
    JOURNAL_REQUEST_SECTION,
    ``
  ].join("\n");
}

function journalHealthHTML(date) {
  const exact = date !== todayISO();
  return exact && !healthForDate(date) ? "" : healthSummaryHTML(date, exact);
}

function journalFlightRows(blocks) {
  return blocks.map((block) => {
    const start = timeFromDateTime(block.actualStartAt) || "--:--";
    const end = timeFromDateTime(block.actualEndAt) || "--:--";
    const net = Number(block.charge || 0) - Number(block.discharge || 0);
    return `<div class="journal-flight-row"><time>${start}-${end}</time><span>${escapeHTML(block.title || "—")}</span><span>充放電 ${net > 0 ? "+" : ""}${net}</span></div>`;
  }).join("");
}

// v317: 生活記録を同じ日付の一ページへ、朝→身体→行動→心→暮らし→お金の順で束ねる。
function renderJournal() {
  ensureJournal(state.selectedDate);
  const previous = addDays(state.selectedDate, -1);
  const date = state.selectedDate;
  const report = (state.reports || {})[date] || "";
  // v141: AIフィードバック列(3列目)はジャーナルタブの表示から撤去した(未使用のため。
  // CHANGES_v141.md参照)。fetchロジック(hydrateStaticMarkdown)・保存データ(state.feedback/
  // cachedFeedback)自体は削除しておらず、AIレポートタブ(kind: feedback)で
  // 引き続き読める。
  // v148(UI改善計画Phase3-4): 当日パネルを朝/夜/本文の3detailsへ再編する。既定openは現在時刻
  // (〜14時=朝、14時〜=夜)/常時(本文)から計算するが、_journalSegmentOverride(src/state/
  // journal-fold.js。click dispatcher"toggle-journal-segment"と共有)に記録があればそちらを
  // 優先する。本文も朝/夜と同じ挙動にする(レビュー対応: 手動で閉じても再render毎にopenへ
  // 戻らないように)。
  const _now = new Date();
  const nowMin = _now.getHours() * 60 + _now.getMinutes();
  const isMorning = nowMin < 14 * 60;
  const morningOpen = "morning" in _journalSegmentOverride ? _journalSegmentOverride.morning : isMorning;
  const eveningOpen = "evening" in _journalSegmentOverride ? _journalSegmentOverride.evening : !isMorning;
  const bodyOpen = "body" in _journalSegmentOverride ? _journalSegmentOverride.body : true;
  const bodyLogOpen = "bodyLog" in _journalSegmentOverride ? _journalSegmentOverride.bodyLog : true;
  const flightLogOpen = "flightLog" in _journalSegmentOverride ? _journalSegmentOverride.flightLog : true;
  const moneyOpen = "money" in _journalSegmentOverride ? _journalSegmentOverride.money : true;
  const journalRequest = String(state.journalMeta?.[date]?.aiRequest || "");
  const requestOverrideApplies = _journalSegmentOverride.requestDate === date
    && "request" in _journalSegmentOverride;
  if ("request" in _journalSegmentOverride && !requestOverrideApplies) {
    delete _journalSegmentOverride.request;
    delete _journalSegmentOverride.requestDate;
  }
  const requestOpen = requestOverrideApplies
    ? _journalSegmentOverride.request : Boolean(journalRequest.trim());
  // v294: 「書く瞑想」の既定開閉は夜(18時以降)=開・それ以外=閉(発注文の指定閾値。
  // MORNING/NIGHT BRIEFの14時判定とは独立の値)。_journalSegmentOverride基盤へ相乗りする。
  const isEveningForKm = nowMin >= 18 * 60;
  const kakuMeisouOpen = "writeMeditation" in _journalSegmentOverride ? _journalSegmentOverride.writeMeditation : isEveningForKm;
  const blocks = blocksForDate(date);
  const flightBlocks = flightLogBlocks(blocks);
  const rate = taskchuteStartRate(blocks);
  const completedCount = flightBlocks.length;
  const energyNet = flightBlocks.reduce((sum, block) => sum + Number(block.charge || 0) - Number(block.discharge || 0), 0);
  const scans = bodyScansForDate(date);
  const scanSummary = scans.length ? bmSummary(scans) : null;
  const fundSummary = fundJournalSummaryForDate(date);
  return `
    <div class="tower-skin journal-tower">
      ${renderHeader("過去の自分・今の自分・外部視点", "ジャーナル")}
      ${renderDateBar()}
      ${renderExperimentSection()}
      <section class="journal-grid">
        <details class="panel fold journal-panel-prev">
          <summary class="fold-summary"><span class="fold-chevron">▶</span>前日 <span>(${previous})</span></summary>
          <div class="fold-body"><div class="md-render readonly-md">${renderMarkdown(state.journals[previous] || "記載なし")}</div></div>
        </details>
        <div class="panel journal-panel-today">
          <div class="journal-daysummary">着手率 ${rate.pct}%・完了 ${completedCount} Block・充放電 ${energyNet > 0 ? "+" : ""}${energyNet}</div>
          <details class="fold journal-segment journal-segment-morning" data-journal-section="morning" ${morningOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="morning"><span class="fold-chevron">▶</span>けさ <span>朝(前夜の睡眠・体調・睡眠時間・服薬・余力)</span></summary>
            <div class="fold-body">
              ${renderSleepCard(date)}
              ${journalHealthHTML(date)}
              ${renderMorningEnergyPicker(date)}
              ${renderConditionMorningExtra(date)}
            </div>
          </details>
          <details class="fold journal-segment" data-journal-section="body" ${bodyLogOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="bodyLog"><span class="fold-chevron">▶</span>BODY <span>筋トレ・身体スキャン</span></summary>
            <div class="fold-body">
              ${renderGymLogCard(date)}
              ${scanSummary ? `<div class="journal-bodyscan">身体スキャン　疲労Σ${scanSummary.fatigue}・回復Σ${scanSummary.recovery}・${scanSummary.total}件</div>` : ""}
            </div>
          </details>
          ${flightBlocks.length ? `<details class="fold journal-segment" data-journal-section="flight" ${flightLogOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="flightLog"><span class="fold-chevron">▶</span>FLIGHT LOG <span>完了Block</span></summary>
            <div class="fold-body">${journalFlightRows(flightBlocks)}</div>
          </details>` : ""}
          <section class="fold journal-segment" data-journal-section="mind">
            <div class="fold-summary">MIND <span>書く瞑想・夜の体調</span></div>
            <div class="fold-body">
              <details class="fold journal-segment journal-segment-writeMeditation" ${kakuMeisouOpen ? "open" : ""}>
                <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="writeMeditation"><span class="fold-chevron">▶</span>🌗 書く瞑想 <span id="km-oneliner">${escapeHTML(writeMeditationOnelinerText(date))}</span></summary>
                <div class="fold-body">${renderWriteMeditationPanel(date)}</div>
              </details>
              <details class="fold journal-segment journal-segment-evening" ${eveningOpen ? "open" : ""}>
                <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="evening"><span class="fold-chevron">▶</span>よる <span>夜の体調・ひとこと</span></summary>
                <div class="fold-body">${renderEveningConditionCard(date)}</div>
              </details>
            </div>
          </section>
          <section class="fold journal-segment" data-journal-section="life">
            <div class="fold-summary">LIFE <span>今日行ったお店</span></div>
            <div class="fold-body">${renderStoreVisitsCard(date)}</div>
          </section>
          ${fundSummary ? `<details class="fold journal-segment" data-journal-section="money" ${moneyOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="money"><span class="fold-chevron">▶</span>MONEY <span>FABLE FUND日誌</span></summary>
            <div class="fold-body">${escapeHTML(fundSummary)}</div>
          </details>` : ""}
          <details class="fold journal-segment journal-segment-body" data-journal-section="journal" ${bodyOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="body"><span class="fold-chevron">▶</span>自由記述 <span>本文</span></summary>
            <div class="fold-body">
              <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
                <button class="btn primary" data-action="generate-report">📊 日報を生成</button>
                ${report ? `<button class="btn" data-action="report-copy-ai">📋 AI用にコピー</button>` : ""}
                ${report && typeof navigator !== "undefined" && navigator.share ? `<button class="btn" data-action="report-share-ai">↗ 共有</button>` : ""}
                <button class="btn" data-action="download-report">Markdown保存</button>
                ${personalDataReady(state.settings.github) ? `<button class="btn" data-action="push-report">📤 GitHubに日報push</button>` : ""}
              </div>
              <details class="journal-prompts" style="margin-bottom:10px; padding:8px 12px; background:var(--panel-soft); border-radius:8px">
                <summary style="cursor:pointer; font-size:13px; color:var(--muted); font-weight:600">💡 思考のヒント(クリックで開閉)</summary>
                <div style="margin-top:10px; display:grid; gap:10px; font-size:12px">
                  ${Object.entries(JOURNAL_PROMPTS).map(([section, prompt]) => `
                    <div>
                      <div style="font-weight:600; color:var(--text); margin-bottom:2px">${section}</div>
                      <div class="muted" style="white-space:pre-line; line-height:1.5">${escapeHTML(prompt)}</div>
                    </div>
                  `).join("")}
                </div>
              </details>
              <textarea id="journalFreeText" class="textarea journal-free" data-journal-date="${date}">${escapeHTML(state.journals[date])}</textarea>
              <details class="fold journal-request-fold" ${requestOpen ? "open" : ""}>
                <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="request"><span class="fold-chevron">▶</span>AIに依頼すること <span>夜のバッチ向け</span></summary>
                <div class="fold-body">
                  <label class="journal-request-label" for="journalAiRequest">AIに依頼すること</label>
                  <textarea id="journalAiRequest" class="textarea journal-ai" rows="2" data-journal-ai-date="${escapeHTML(date)}" placeholder="夜のAIバッチへの依頼・質問">${escapeHTML(journalRequest)}</textarea>
                </div>
              </details>
            </div>
          </details>
        </div>
      </section>
    </div>
  `;
}

function setMorningEnergy(value) {
  state.settings.morningEnergyLog[state.selectedDate] = value;
  ensureJournal(state.selectedDate);
  const label = energyLevels.find((level) => level.value === value)?.label || "";
  state.journals[state.selectedDate] = upsertMorningLine(state.journals[state.selectedDate], `朝の体調: ${label} (${value})`);
  // v73: 「今週書けた日数」の加点式カウントに乗せるため、既存の朝の体調ピッカーだけを
  //      使った日もコンディションログの記録印(morningRecordedAt)を残す。
  ensureConditionLog(state.selectedDate).morningRecordedAt ||= nowDateTime();
  saveAndRender("朝の体調を保存しました");
}

// v73: コンディションOS ==========================================================
function ensureConditionLog(date) {
  state.condition.logs[date] ||= {
    sleepHours: null, meds: null, capacity: "",
    morningRecordedAt: "", eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: []
  };
  return state.condition.logs[date];
}

// 加点式: ストリーク・連続日数は出さない。「その週に書けた日数」だけを数える肯定表現用。
function conditionRecordedDates(days) {
  return days.filter((d) => {
    const log = state.condition.logs[d];
    return state.settings.morningEnergyLog[d] !== undefined || !!log?.morningRecordedAt || !!log?.eveningRecordedAt;
  });
}
function conditionRecordedCountThisWeek() {
  const { weekStart } = weekRange(todayISO());
  return conditionRecordedDates(weekDays(weekStart)).length;
}

function toggleConditionMeds(date) {
  const log = ensureConditionLog(date);
  log.meds = !log.meds;
  log.morningRecordedAt ||= nowDateTime();
  saveAndRender(log.meds ? "服薬済みを記録しました" : "服薬記録を戻しました");
}

function setConditionCapacity(date, capacity) {
  const log = ensureConditionLog(date);
  log.capacity = log.capacity === capacity ? "" : capacity;  // 同じボタンの再タップで解除
  log.morningRecordedAt ||= nowDateTime();
  saveAndRender("今日の余力を記録しました");
}

function setEveningMood(date, value) {
  const log = ensureConditionLog(date);
  log.eveningMood = value;
  log.eveningRecordedAt = nowDateTime();
  saveAndRender("夜の記録を保存しました");
}

function addGymEntry(date) {
  const exInput = document.querySelector("#gym-exercise-input");
  const wInput = document.querySelector("#gym-weight-input");
  const rInput = document.querySelector("#gym-reps-input");
  const exercise = (exInput?.value || "").trim();
  const weight = Number(wInput?.value || 0);
  const reps = Number(rInput?.value || 0);
  if (!exercise || !weight || !reps) {
    showToast("種目・重量・回数を入力してください");
    return;
  }
  const log = ensureConditionLog(date);
  const timestamp = nowDateTime();
  log.gym.push({ id: crypto.randomUUID(), exercise, weight, reps, at: timestamp, createdAt: timestamp, updatedAt: timestamp });
  log.morningRecordedAt ||= timestamp;
  saveAndRender(`${exercise} ${weight}kg×${reps} を記録しました`);
}

function deleteGymEntry(date, entryId) {
  const log = ensureConditionLog(date);
  const target = log.gym.find((g) => g.id === entryId);
  if (!target) return;
  const timestamp = nowDateTime();
  Object.assign(target, { deleted: true, deletedAt: timestamp, updatedAt: timestamp });
  saveAndRender("削除しました");
}
// ========================================================================

export {
  configureJournal,
  renderMorningEnergyPicker, renderConditionMorningExtra, renderEveningConditionCard,
  lastGymRecord, renderGymLogCard,
  safeExternalUrl, storeVisitsForDate, renderStoreVisitsCard,
  openStoreVisitEditor, buildStoreVisitModal, saveStoreVisitFromModal,
  deleteStoreVisit, deleteStoreVisitWithConfirm,
  openStoreVisitsYearModal, buildStoreVisitsYearModal,
  renderSleepCard,
  ensureJournal, defaultJournal, renderJournal,
  setMorningEnergy, ensureConditionLog, conditionRecordedCountThisWeek,
  toggleConditionMeds, setConditionCapacity, setEveningMood,
  addGymEntry, deleteGymEntry,
  writeMeditationFor, setWriteMeditationTalk, addWriteMeditationChipFromInput
};
