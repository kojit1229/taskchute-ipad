// src/features/iron-log.js — TaskChute Journal スリム化P4・レーンB
// 「IRON LOG専用画面モジュール」(界面凍結: p4-interface.md §3)。
//
// 契約:
//   - 他ファイルを一切importしない。全依存はconfigureIronLog(deps)で注入する
//     (deps: { getState, escapeHTML, todayISO, renderHeader, saveAndRender, registerActions })。
//   - 純粋関数(ironDailyTotal / ironTotals / gymSetsForDate / linkedGymBlock /
//     gymCommentSummary / parseIronComment / runIronImport)はstate等を明示引数で受け取り、
//     テストから直接呼べる(configureIronLog未呼び出しでも動く)。
//   - 正本データ: state.condition.logs[date].gym[] = [{id, exercise, weight, reps, at, blockId?}]
//     (p4-interface.md §1)。移行の受け皿: state.ironImport = {done, importedTotalKg, importedDays}。
//   - settings(既定値。normalizeStateへの追記は統合時に監督者側で実施。ここでは未定義でも
//     落ちない防御的読み取りのみ行う):
//       ironDailyTarget(既定2000) / ironManualBaseKg(既定0) / gymBlockKeywords(既定["ジム","筋トレ"])
//     追加(界面凍結書の外・任意上書き用。無くても内部既定値で動く): gymExerciseList
//   - 日時パースはnew Date("文字列")を使わず正規表現で処理する(iOS Safari対策)。
//   - data-actionプレフィクス(凍結): iron-add-set / iron-delete-set / iron-exercise-select /
//     iron-menu-add / iron-menu-delete / iron-menu-up / iron-menu-down

// ---- 依存注入(configureIronLog) ----
let getState, escapeHTML, todayISO, renderHeader, saveAndRender, registerActions;

const DEFAULT_TARGET_KG = 2000;
const DEFAULT_MANUAL_BASE_KG = 0;
const DEFAULT_GYM_KEYWORDS = ["ジム", "筋トレ"];
const DEFAULT_EXERCISES = ["ベンチプレス", "スクワット", "デッドリフト", "ラットプルダウン", "ショルダープレス", "その他"];

function configureIronLog(deps) {
  ({ getState, escapeHTML, todayISO, renderHeader, saveAndRender, registerActions } = deps);
  registerActions({
    "iron-add-set": () => addSetFromForm(),
    "iron-delete-set": (ctx) => deleteSet(ctx),
    "iron-exercise-select": (ctx) => prefillSetInputs(ctx),
    // v272: IRON LOG内で種目メニューを管理し、LOAD SETの選択肢と同じ配列を使う。
    "iron-menu-add": () => addExercise(),
    "iron-menu-delete": (ctx) => deleteExercise(ctx),
    "iron-menu-up": (ctx) => moveExercise(ctx, -1),
    "iron-menu-down": (ctx) => moveExercise(ctx, 1)
  });
}

// ---- 内部ユーティリティ(日時: 正規表現で処理。new Date("文字列")禁止) ----

// "YYYY-MM-DDTHH:mm" 形式から時:分を抽出。不能なら null。
function hhmmFromDateTimeString(str) {
  const m = /T(\d{2}):(\d{2})/.exec(String(str || ""));
  return m ? { h: Number(m[1]), min: Number(m[2]) } : null;
}

function minutesFromDateTimeString(str) {
  const parts = hhmmFromDateTimeString(str);
  return parts ? parts.h * 60 + parts.min : null;
}

// new Date()は文字列パースではなく現在時刻オブジェクト生成のため許容(禁止対象は文字列パース)。
function nowClockParts() {
  const now = new Date();
  return { h: now.getHours(), min: now.getMinutes() };
}

function nowMinutesFromClock() {
  const { h, min } = nowClockParts();
  return h * 60 + min;
}

function nowTimeString() {
  const { h, min } = nowClockParts();
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString("ja-JP");
}

function gymKeywords(state) {
  const list = state?.settings?.gymBlockKeywords;
  return Array.isArray(list) && list.length ? list : DEFAULT_GYM_KEYWORDS;
}

function exerciseList(state) {
  const list = state?.settings?.gymExerciseList;
  return Array.isArray(list) && list.length ? list : DEFAULT_EXERCISES;
}

// v272: 壊れた旧stateも最初のメニュー操作で既定値の複製へ自己修復する。
function exerciseListForWrite(state) {
  const list = state?.settings?.gymExerciseList;
  return Array.isArray(list) && list.length ? list.slice() : DEFAULT_EXERCISES.slice();
}

function matchesGymKeywords(block, keywords) {
  const haystack = `${block?.category || ""} ${block?.title || ""}`;
  return keywords.some((kw) => kw && haystack.includes(kw));
}

// ---- 純粋関数(界面凍結。state/setsを明示引数で受け取る) ----

// 当日(iso)のセット配列。集計(kg = weight×reps)を付与して返す。
function gymSetsForDate(state, iso) {
  const list = state?.condition?.logs?.[iso]?.gym;
  if (!Array.isArray(list)) return [];
  return list.filter((s) => !s?.deleted)
    .map((s) => ({ ...s, kg: (Number(s.weight) || 0) * (Number(s.reps) || 0) }));
}

// 指定日以前の記録日を新しい順で最大365日ぶん返す(日付キーはISO文字列比較)。
function recentGymDates(state, beforeIso) {
  return Object.keys(state?.condition?.logs || {})
    .filter((date) => date <= beforeIso)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 365);
}

// "YYYY-MM-DD" から "M/D"(ゼロ埋めなし)を抽出。不能なら"". new Date()を経由しない(iOS Safari対策と同じ理由)。
function formatMonthDayFromISO(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
}

// isoより前で直近に記録がある日の合計kg({date, kg})。無ければ{date:"", kg:0}。
function ironPreviousDayTotal(state, iso) {
  const dates = recentGymDates(state, iso).filter((date) => date < iso);
  for (const date of dates) {
    const sets = gymSetsForDate(state, date);
    if (sets.length > 0) return { date, kg: sets.reduce((sum, s) => sum + s.kg, 0) };
  }
  return { date: "", kg: 0 };
}

// 指定種目の直近セット。当日はat降順で最新を選び、tombstoneは除外する。
function lastSetForExercise(state, exercise, beforeIso) {
  if (!exercise) return null;
  for (const date of recentGymDates(state, beforeIso)) {
    const list = state?.condition?.logs?.[date]?.gym;
    if (!Array.isArray(list)) continue;
    const latest = list.filter((s) => !s?.deleted && s?.exercise === exercise)
      .sort((a, b) => String(b?.at || "").localeCompare(String(a?.at || "")))[0];
    if (latest) return latest;
  }
  return null;
}

// 指定時刻より前に記録された同種目の最大重量。比較対象が無ければnull。
function bestWeightForExercise(state, exercise, beforeAt) {
  if (!exercise || !beforeAt) return null;
  let best = null;
  for (const date of recentGymDates(state, String(beforeAt).slice(0, 10))) {
    const list = state?.condition?.logs?.[date]?.gym;
    if (!Array.isArray(list)) continue;
    for (const set of list) {
      const at = typeof set?.at === "string" ? set.at : "";
      const weight = Number(set?.weight);
      if (!set?.deleted && set?.exercise === exercise && at && at < beforeAt
        && Number.isFinite(weight) && (best === null || weight > best)) best = weight;
    }
  }
  return best;
}

// 当日総重量kg
function ironDailyTotal(state, iso) {
  return gymSetsForDate(state, iso).reduce((sum, s) => sum + s.kg, 0);
}

// { lifetimeKg, monthKg, bestDay: {date, kg} }
// lifetimeKg = 全期間gym[]合計 + settings.ironManualBaseKg(手動加算) + state.ironImport.importedTotalKg(移行分)。
// monthKg = 実行時の年月(currentYearMonth)に一致する日付キーの合計。
// bestDay = 日別合計が最大の日(存在しなければ {date:"", kg:0})。
function ironTotals(state) {
  const logs = state?.condition?.logs || {};
  const manualBase = Number(state?.settings?.ironManualBaseKg) || DEFAULT_MANUAL_BASE_KG;
  const importedTotalKg = Number(state?.ironImport?.importedTotalKg) || 0;
  const yearMonth = currentYearMonth();

  let structuredKg = 0;
  let monthKg = 0;
  let bestDay = null;
  for (const date of Object.keys(logs)) {
    const sets = gymSetsForDate(state, date);
    if (sets.length === 0) continue;
    const dayKg = sets.reduce((sum, s) => sum + s.kg, 0);
    structuredKg += dayKg;
    if (date.slice(0, 7) === yearMonth) monthKg += dayKg;
    if (!bestDay || dayKg > bestDay.kg) bestDay = { date, kg: dayKg };
  }

  return {
    lifetimeKg: structuredKg + manualBase + importedTotalKg,
    monthKg,
    bestDay: bestDay || { date: "", kg: 0 }
  };
}

// 実行中のジム系Block(1件のみ想定。実行中=actualStartAtあり かつ actualEndAtなし)。
// nowMinutesは経過時間の表示計算にのみ使う(実行中判定そのものには使わない)。
// 戻り値: { block, elapsedMinutes } | null
function linkedGymBlock(state, nowMinutes) {
  const blocks = Array.isArray(state?.blocks) ? state.blocks : [];
  const keywords = gymKeywords(state);
  const running = blocks.find((b) => b && !b.deleted && b.actualStartAt && !b.actualEndAt && matchesGymKeywords(b, keywords));
  if (!running) return null;
  const startMinutes = minutesFromDateTimeString(running.actualStartAt);
  const elapsedMinutes = (startMinutes !== null && Number.isFinite(nowMinutes))
    ? ((nowMinutes - startMinutes + 1440) % 1440)
    : null;
  return { block: running, elapsedMinutes };
}

// Block完了時コメント文字列(書式凍結): 総重量 {合計}kg(種目 重量kg×回数[×同combo件数]、…)
// 同じ(種目, 重量, 回数)の組が複数あれば「×N」で圧縮する。
function gymCommentSummary(sets) {
  const list = Array.isArray(sets) ? sets.filter((set) => !set?.deleted) : [];
  if (list.length === 0) return "";

  const groups = [];
  const indexByKey = new Map();
  for (const s of list) {
    const exercise = s?.exercise || "";
    const weight = Number(s?.weight) || 0;
    const reps = Number(s?.reps) || 0;
    const key = `${exercise}|${weight}|${reps}`;
    if (indexByKey.has(key)) {
      groups[indexByKey.get(key)].count += 1;
    } else {
      indexByKey.set(key, groups.length);
      groups.push({ exercise, weight, reps, count: 1 });
    }
  }

  const totalKg = list.reduce((sum, s) => sum + (Number(s?.weight) || 0) * (Number(s?.reps) || 0), 0);
  const groupText = groups
    .map((g) => `${g.exercise} ${fmtNum(g.weight)}kg×${g.reps}${g.count > 1 ? `×${g.count}` : ""}`)
    .join("、");
  return `総重量 ${fmtNum(totalKg)}kg(${groupText})`;
}

// 過去コメント移行: 「総重量 1,840kg」等から合計kgを抽出。パース不能ならnull。
function parseIronComment(text) {
  const m = /総重量\s*([\d,]+)\s*kg/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 過去Blockコメントからの一回きり移行。state.ironImport.doneで冪等(2回目はno-op)。
// gym[]へ日別セットとして書き戻すことはしない(重量×回数の内訳が無いため)。代わりに
// 累計調整値(importedTotalKg/importedDays)としてstate.ironImportへ集約し、ironTotals()の
// lifetimeKgに加算する(settings.ironManualBaseKgと同じ「実測できない過去分の補正」という扱い)。
// 既にgym[]で構造化済みの日、および同日内の2件目以降のジム系Blockは二重計上防止のためスキップする。
function runIronImport(state) {
  if (!state) return state;
  if (state.ironImport?.done) return state;

  const keywords = gymKeywords(state);
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  const seenDates = new Set();
  let importedTotalKg = 0;
  let importedDays = 0;

  for (const b of blocks) {
    if (!b || b.deleted) continue;
    if (!matchesGymKeywords(b, keywords)) continue;
    const date = b.date || "";
    if (date && gymSetsForDate(state, date).length > 0) continue;
    if (date && seenDates.has(date)) continue;
    const kg = parseIronComment(b.comment);
    if (kg === null) continue;
    if (date) seenDates.add(date);
    importedTotalKg += kg;
    importedDays += 1;
  }

  state.ironImport = { done: true, importedTotalKg, importedDays };
  return state;
}

// ---- data-actionハンドラ(configureIronLog経由。DOM/getStateに依存) ----

function prefillSetInputs(ctx) {
  if (ctx?.event?.type !== "change") return;
  const exercise = ctx?.target?.value || document.querySelector("#ironFormExercise")?.value || "";
  const previous = lastSetForExercise(getState(), exercise, todayISO());
  const weightInput = document.querySelector("#ironFormWeight");
  const repsInput = document.querySelector("#ironFormReps");
  const replacePrefill = (input, value) => {
    if (!input || (input.value !== "" && input.dataset.prefilled !== "1")) return;
    input.value = value ?? "";
    if (value == null || value === "") delete input.dataset.prefilled;
    else input.dataset.prefilled = "1";
  };
  replacePrefill(weightInput, previous?.weight);
  replacePrefill(repsInput, previous?.reps);
}

function addSetFromForm() {
  const state = getState();
  const exercise = document.querySelector("#ironFormExercise")?.value || "";
  const weight = Number(document.querySelector("#ironFormWeight")?.value);
  const reps = Number(document.querySelector("#ironFormReps")?.value);
  if (!exercise || !weight || !reps) return;

  const iso = todayISO();
  const timestamp = `${iso}T${nowTimeString()}`;
  const previousBest = bestWeightForExercise(state, exercise, timestamp);
  const isPersonalBest = previousBest !== null && weight > previousBest;
  const set = { id: crypto.randomUUID(), exercise, weight, reps, at: timestamp, createdAt: timestamp, updatedAt: timestamp };
  const linked = linkedGymBlock(state, nowMinutesFromClock());
  if (linked?.block?.id) set.blockId = linked.block.id;

  state.condition = state.condition || {};
  state.condition.logs = state.condition.logs || {};
  state.condition.logs[iso] = state.condition.logs[iso] || {};
  state.condition.logs[iso].gym = state.condition.logs[iso].gym || [];
  state.condition.logs[iso].gym.push(set);
  saveAndRender(isPersonalBest ? "セットを追加しました(自己ベスト)" : "セットを追加しました");
}

// ctx.id には当日gym[]配列内でのindex(文字列)を渡す想定。
// 永続idの有無にかかわらず、既存UI契約どおりrenderIronLogはdata-id=indexで描画する。
function deleteSet(ctx) {
  const state = getState();
  const iso = todayISO();
  const idx = Number(ctx?.id);
  const list = state?.condition?.logs?.[iso]?.gym;
  if (!Array.isArray(list) || !Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
  const timestamp = `${iso}T${nowTimeString()}`;
  list[idx] = { ...list[idx], deleted: true, deletedAt: timestamp, updatedAt: timestamp };
  saveAndRender("セットを削除しました");
}

// v272: LOAD SETと同じDOM直読み方式で、種目名だけを文字列配列へ保存する。
function addExercise() {
  const state = getState();
  const raw = document.querySelector("#ironMenuName")?.value || "";
  const name = raw.trim();
  if (!name) return;
  const list = exerciseListForWrite(state);
  if (list.includes(name)) return;
  list.push(name);
  state.settings.gymExerciseList = list;
  saveAndRender("種目を追加しました");
}

function deleteExercise(ctx) {
  const state = getState();
  const list = exerciseListForWrite(state);
  const idx = Number(ctx?.id);
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
  if (list.length <= 1) return;
  list.splice(idx, 1);
  state.settings.gymExerciseList = list;
  saveAndRender("種目を削除しました");
}

function moveExercise(ctx, dir) {
  const state = getState();
  const list = exerciseListForWrite(state);
  const idx = Number(ctx?.id);
  const target = idx + dir;
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
  if (target < 0 || target >= list.length) return;
  [list[idx], list[target]] = [list[target], list[idx]];
  state.settings.gymExerciseList = list;
  saveAndRender("並び順を変更しました");
}

// ---- 画面描画 ----

// v272: 種目名はユーザー入力なので表示時に必ずescapeHTMLする。
function exerciseMenuHTML(exercises) {
  const rows = exercises.map((ex, idx) => `
    <div class="iron-menu-row">
      <span class="iron-menu-name" title="${escapeHTML(ex)}">${escapeHTML(ex)}</span>
      <button type="button" class="iron-menu-move" data-action="iron-menu-up" data-id="${idx}"
        ${idx === 0 ? "disabled" : ""} aria-label="上へ">▲</button>
      <button type="button" class="iron-menu-move" data-action="iron-menu-down" data-id="${idx}"
        ${idx === exercises.length - 1 ? "disabled" : ""} aria-label="下へ">▼</button>
      <button type="button" class="iron-menu-del" data-action="iron-menu-delete" data-id="${idx}"
        ${exercises.length <= 1 ? "disabled" : ""} aria-label="削除">✕</button>
    </div>`).join("");

  return `
    <section class="iron-box">
      <h2>MENU <span>種目メニュー</span></h2>
      <div class="iron-menu-list">${rows}</div>
      <div class="iron-menu-form">
        <input id="ironMenuName" type="text" placeholder="種目名を追加" maxlength="24">
        <button type="button" data-action="iron-menu-add">+ 追加</button>
      </div>
    </section>`;
}

function renderIronLog() {
  const state = getState();
  const iso = todayISO();
  const settings = state?.settings || {};
  const target = Number(settings.ironDailyTarget) || DEFAULT_TARGET_KG;
  const exercises = exerciseList(state);
  const selectedExercise = exercises[0] || "";
  const previousSet = lastSetForExercise(state, selectedExercise, iso);

  const rawList = Array.isArray(state?.condition?.logs?.[iso]?.gym) ? state.condition.logs[iso].gym : [];
  const activeList = rawList
    .map((s, idx) => {
      const previousBest = bestWeightForExercise(state, s.exercise, s.at);
      return {
        ...s,
        kg: (Number(s.weight) || 0) * (Number(s.reps) || 0),
        isPersonalBest: previousBest !== null && Number(s.weight) > previousBest,
        idx
      };
    })
    .filter((s) => !s.deleted);
  const rows = activeList
    .slice()
    .reverse(); // 新しいセットが上(mockupのprepend挙動に合わせる)

  const total = ironDailyTotal(state, iso);
  const totals = ironTotals(state);
  const previousDay = ironPreviousDayTotal(state, iso);

  // v363: 達成/未達の語や色を使わず、値をそのまま並べる事実表示のみ(CONCEPT §6)。
  // (差し戻し対応M2): 「前回」に記録日(M/D)を添える。記録が無ければ日付は省く。
  const prevHTML = previousDay.date
    ? `前回 ${formatMonthDayFromISO(previousDay.date)} ・ <b>${fmtNum(previousDay.kg)} kg</b>`
    : `前回 <b>${fmtNum(previousDay.kg)} kg</b>`;
  const factHTML = `今月 <b>${fmtNum(totals.monthKg)} kg</b> ・ ${prevHTML}`;
  const targetHTML = target > 0
    ? `<div class="iron-target-note">目標 ${fmtNum(target)} kg に対し今日 ${fmtNum(total)} kg</div>`
    : "";

  const linked = linkedGymBlock(state, nowMinutesFromClock());
  const linkedHTML = linked
    ? `<div class="iron-linked">
         <span class="iron-linked-status">● 実行中</span>
         <span class="iron-linked-name">${escapeHTML(linked.block.title || "")}</span>
         <span class="iron-linked-time">${hhmmFromDateTimeString(linked.block.actualStartAt)?.h != null
            ? `${String(hhmmFromDateTimeString(linked.block.actualStartAt).h).padStart(2, "0")}:${String(hhmmFromDateTimeString(linked.block.actualStartAt).min).padStart(2, "0")} 開始`
            : ""} — 実行中 ${linked.elapsedMinutes != null
            ? `${String(Math.floor(linked.elapsedMinutes / 60)).padStart(2, "0")}:${String(linked.elapsedMinutes % 60).padStart(2, "0")}`
            : "--:--"}</span>
       </div>
       <div class="iron-linked-foot">このタスクの実行時間内に追加したセットが紐づき、タスク完了時にコメント欄へ「総重量◯kg+種目内訳」を自動転記(→日報に反映)</div>`
    : `<div class="iron-linked">
         <span class="iron-linked-status is-idle">○ 未連動</span>
         <span class="iron-linked-name">実行中のジムタスクはありません</span>
       </div>
       <div class="iron-linked-foot">タスク未連動(セットは当日記録のみ)。ジム系Blockを開始すると自動で連動します。</div>`;

  const setRows = rows.length === 0
    ? `<div class="iron-empty">まだ記録がありません</div>`
    : rows.map((s) => `
        <div class="iron-set-row">
          <time>${escapeHTML((s.at || "").slice(11, 16))}</time>
          <span class="iron-set-name">${escapeHTML(s.exercise || "")}${s.isPersonalBest ? '<span class="iron-pr">PR</span>' : ""}</span>
          <span class="iron-set-detail">${fmtNum(s.weight)}kg × ${fmtNum(s.reps)}</span>
          <span class="iron-set-kg">+${fmtNum(s.kg)}</span>
          <button type="button" class="iron-set-del" data-action="iron-delete-set" data-id="${s.idx}" aria-label="削除">✕</button>
        </div>
      `).join("");

  return `
    ${renderHeader("IRON LOG", "筋トレ")}
    <div class="iron" id="ironRoot">

      <section class="iron-box">
        <h2>LINKED FLIGHT <span>連動中のタスク</span></h2>
        ${linkedHTML}
      </section>

      <section class="iron-box">
        <h2>PAYLOAD <span>今日の総重量</span></h2>
        <div class="iron-payload">
          <div class="iron-total"><span>${fmtNum(total)}</span><small> kg</small></div>
          <div class="iron-fact">${factHTML}</div>
          ${targetHTML}
        </div>
      </section>

      <section class="iron-box">
        <h2>LOAD SET <span>セットを追加</span></h2>
        <div class="iron-form-labels">
          <span>種目</span><span>重量 kg</span><span>回数</span><span></span>
        </div>
        <div class="iron-form">
          <select id="ironFormExercise" data-action="iron-exercise-select">
            ${exercises.map((ex) => `<option value="${escapeHTML(ex)}">${escapeHTML(ex)}</option>`).join("")}
          </select>
          <input id="ironFormWeight" type="number" value="${escapeHTML(previousSet?.weight ?? "")}"${previousSet?.weight != null && previousSet.weight !== "" ? ' data-prefilled="1"' : ""} min="0" step="2.5">
          <input id="ironFormReps" type="number" value="${escapeHTML(previousSet?.reps ?? "")}"${previousSet?.reps != null && previousSet.reps !== "" ? ' data-prefilled="1"' : ""} min="1" step="1">
          <button type="button" data-action="iron-add-set">+ 追加</button>
        </div>
      </section>

      ${exerciseMenuHTML(exercises)}

      <section class="iron-box">
        <h2>TODAY'S SETS <span>${rows.length} セット</span></h2>
        <div class="iron-set-list">${setRows}</div>
      </section>

      <section class="iron-box">
        <h2>TOTALS <span>積み上げ</span></h2>
        <div class="iron-totals">
          <div class="iron-totals-cell"><span>累計</span><strong>${(totals.lifetimeKg / 1000).toFixed(1)} t</strong></div>
          <div class="iron-totals-cell"><span>今月</span><strong>${fmtNum(totals.monthKg)} kg</strong></div>
          <div class="iron-totals-cell"><span>自己ベスト(日)</span><strong>${fmtNum(totals.bestDay.kg)} kg</strong></div>
        </div>
      </section>

    </div>
  `;
}

export {
  configureIronLog,
  renderIronLog,
  gymSetsForDate,
  lastSetForExercise,
  bestWeightForExercise,
  ironDailyTotal,
  ironTotals,
  ironPreviousDayTotal,
  formatMonthDayFromISO,
  linkedGymBlock,
  gymCommentSummary,
  parseIronComment,
  runIronImport
};
