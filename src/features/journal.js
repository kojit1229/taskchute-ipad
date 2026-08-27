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
import { registerActions } from "../ui/actions.js";

// ---- 依存注入(configureJournal) ----
let escapeHTML, renderHeader, renderDateBar, renderMarkdown, renderModal, closeModal;
let addDays, todayISO, weekRange, weekDays, showToast, nowDateTime, saveAndRender;
let personalDataReady, latestSleepLogWithin, shortSleepDate, upsertMorningLine;
let renderExperimentSection, JOURNAL_REQUEST_SECTION;

function configureJournal(deps) {
  ({
    escapeHTML, renderHeader, renderDateBar, renderMarkdown, renderModal, closeModal,
    addDays, todayISO, weekRange, weekDays, showToast, nowDateTime, saveAndRender,
    personalDataReady, latestSleepLogWithin, shortSleepDate, upsertMorningLine,
    renderExperimentSection, JOURNAL_REQUEST_SECTION
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
    "store-visit-year": () => openStoreVisitsYearModal()
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
    <div class="store-visit-card" style="margin-bottom:10px; padding:10px 12px; background:var(--panel-soft); border-radius:8px">
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
    saveAndRender("お店の記録を更新しました");
    return;
  }
  state.storeVisits.push({
    id: crypto.randomUUID(), date, name, url, comment,
    createdAt: nowDateTime(), updatedAt: nowDateTime(), deleted: false
  });
  closeModal();
  saveAndRender("お店を記録しました");
}

// deleteFromModal()側(モーダル内「削除」ボタン経由)・カード上の×(即時)の両方から呼ばれる。
// どちらの経路も呼び出し前に確認ダイアログを通す(仕様: 既存件の削除は確認つき)。
function deleteStoreVisit(id) {
  state.storeVisits = state.storeVisits.map((v) => v.id === id
    ? { ...v, deleted: true, updatedAt: nowDateTime() } : v);
  saveAndRender("お店の記録を削除しました");
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

function hoursLabel(v) {
  if (v == null) return "–";
  return `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, "0")}m`;
}

// v131: AutoSleepは前夜分を21:00にしか確定しないため、朝の時点ではdateキーの当日分が
// まだ無いのが通常運転(実データ解析で確認済み)。latestSleepLogWithin()で直近2日以内に
// フォールバックし、フォールバックした日はヘッダに「M/D朝のデータ」と明示する
// (黙って当日扱いしない)。赤警告は2日以内に1件も無い場合のみ出す。
function renderSleepCard(date) {
  const found = latestSleepLogWithin(date);
  const uploadBtn = (danger) => `
    <label class="btn ${danger ? "danger" : "ghost"}" style="font-size:12px; padding:6px 10px; cursor:pointer; white-space:nowrap">
      📤 睡眠CSV
      <input type="file" accept=".csv,text/csv" data-sleep-csv-upload hidden>
    </label>`;
  if (!found) {
    // 2日以内に1件もログが無い: 今日を開いている時は赤帯で警告(毎朝アップする運用)。過去日は控えめに。
    const isToday = date === todayISO();
    return `
      <div class="row" style="margin-bottom:10px; padding:10px 12px; border-radius:10px; justify-content:space-between; align-items:center; ${isToday ? "background:var(--red-soft); border:1.5px solid var(--red)" : "background:var(--panel-soft)"}">
        <span style="font-size:13px; font-weight:700; ${isToday ? "color:var(--red)" : "color:var(--muted)"}">${isToday ? "⚠️ 前夜の睡眠CSVが未アップロードです" : "💤 この日の睡眠ログはありません"}</span>
        ${uploadBtn(isToday)}
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
      ${uploadBtn(false)}
    </div>`;
}

// v17: 各セクションの思考プロンプト(画面表示用、Markdown 出力時は省く)
const JOURNAL_PROMPTS = {
  // v105: 「🛏 睡眠」はテンプレ廃止(実測は睡眠CSV取込に一本化)に伴い削除
  "🙏 感謝(3 つ)": "当たり前すぎて忘れがちな何か。誰・何に対して?(例:朝のコーヒー、子の笑顔)",
  "✨ 今日のハイライト": "今日いちばん心が動いた瞬間は? 嬉しい・面白い・誇らしい、どれでも。",
  "💡 気付き・学び": "うまくいった/いかなかった理由は? 自分・他人・状況について、次に活かせること。",
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

// 【tower-restyle】renderJournal()のみ改装。ロジック(ensureJournal/日付計算/segment開閉判定)は
// 完全に無改変。変更は (a) 全体を<div class="tower-skin journal-tower">でラップ、
// (b) パネル見出し・summaryの文言をTOWER意匠の英語+日本語併記に変更、の2点のみ。
// class/data-action/data-*/id・DOM階層・タグ種別は既存のまま(tests/journal-core.test.js・
// tests/v146.test.js等の参照セレクタと完全一致を維持)。
function renderJournal() {
  ensureJournal(state.selectedDate);
  const previous = addDays(state.selectedDate, -1);
  const date = state.selectedDate;
  const report = (state.reports || {})[date] || "";
  // v141: AIフィードバック列(3列目)はジャーナルタブの表示から撤去した(未使用のため。
  // CHANGES_v141.md参照)。fetchロジック(hydrateStaticMarkdown)・保存データ(state.feedback/
  // cachedFeedback)自体は削除しておらず、統合画面のATISで
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
  return `
    <div class="tower-skin journal-tower">
      ${renderHeader("過去の自分・今の自分・外部視点", "ジャーナル")}
      ${renderDateBar()}
      ${renderExperimentSection()}
      <section class="journal-grid">
        <details class="panel fold journal-panel-prev">
          <summary class="fold-summary"><span class="fold-chevron">▶</span>LOG PREV <span>前日 (${previous})</span></summary>
          <div class="fold-body"><div class="md-render readonly-md">${renderMarkdown(state.journals[previous] || "記載なし")}</div></div>
        </details>
        <div class="panel journal-panel-today">
          <div class="row" style="margin-bottom:10px">
            <h2>JOURNAL LOG <span>当日編集</span></h2>
            <div class="row">
              <button class="btn primary" data-action="generate-report">📊 日報を生成</button>
              ${report ? `<button class="btn" data-action="report-copy-ai">📋 AI用にコピー</button>` : ""}
              ${report && typeof navigator !== "undefined" && navigator.share ? `<button class="btn" data-action="report-share-ai">↗ 共有</button>` : ""}
              <button class="btn" data-action="download-report">Markdown保存</button>
              ${personalDataReady(state.settings.github) ? `<button class="btn" data-action="push-report">📤 GitHubに日報push</button>` : ""}
            </div>
          </div>
          <details class="fold journal-segment journal-segment-morning" ${morningOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="morning"><span class="fold-chevron">▶</span>MORNING BRIEF <span>朝(前夜の睡眠・体調・睡眠時間・服薬・余力)</span></summary>
            <div class="fold-body">
              ${renderSleepCard(date)}
              ${renderMorningEnergyPicker(date)}
              ${renderConditionMorningExtra(date)}
            </div>
          </details>
          <details class="fold journal-segment journal-segment-evening" ${eveningOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="evening"><span class="fold-chevron">▶</span>NIGHT BRIEF <span>夜(体調・メモ・運動・お店ログ)</span></summary>
            <div class="fold-body">
              ${renderEveningConditionCard(date)}
              ${renderGymLogCard(date)}
              ${renderStoreVisitsCard(date)}
            </div>
          </details>
          <details class="fold journal-segment journal-segment-body" ${bodyOpen ? "open" : ""}>
            <summary class="fold-summary" data-action="toggle-journal-segment" data-segment="body"><span class="fold-chevron">▶</span>FREE LOG <span>本文</span></summary>
            <div class="fold-body">
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
              <textarea class="textarea" data-journal-date="${date}">${escapeHTML(state.journals[date])}</textarea>
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
  addGymEntry, deleteGymEntry
};
