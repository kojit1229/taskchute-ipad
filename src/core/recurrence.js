// src/core/recurrence.js — TaskChute Journal スリム化P1・v217(繰り返し実体化エンジン移設)。
//
// 抽出元: repos/taskchute-ipad の src/features/routine.js(HEAD時点、1,193行)。
// 抽出対象(exportとして公開): recurrenceMatchesDate / makeRecurrenceInstance /
// findActiveDuplicateRecurrenceRule / createRecurrenceRule / triggerAnchorPlacements /
// maintainRecurrences / routineRate / anchorCandidateOptions(Block編集モーダルが使用)。
// 内部でのみ使うヘルパー(非export): chainRunKey / findChainRun / ensureChainRun
// (triggerAnchorPlacementsがチェーン側のアンカー配置に使う。v219でチェーン進行UIは
// 削除されたが、挙動不変を優先して3関数とstate.chainRuns連携は現状のまま残す。
// ロジックは元routine.jsからそのまま複製している。詳細はnotes.md参照)。
//
// 契約:
//   1. src/core/ は src/state/store.js を import しない(純粋性の機械的な判定基準、
//      src/core/merge.js・src/core/today-model.jsと同じ規約)。state はDIで受け取る。
//   2. ただし store.js の `state` は `let state = null; setState(next){ state = next; }`
//      という「再代入されるモジュール変数」であり、既存の全features/*.jsは
//      `import { state } from "../state/store.js"` のESM live bindingでこれを自動追従
//      している(importData/restoreBackup/resetDemoDataがsetState()直後に
//      maintainRecurrences()を呼ぶため、再代入への追従は挙動不変の必須条件)。
//      stateオブジェクトそのものをconfigureRecurrence(deps)で1回だけ受け取って
//      キャッシュすると、setState()による再代入後にキャッシュが古いオブジェクトを
//      指したままになり(=import/restoreBackup/resetDemoData直後の実体化が
//      古いstateに対して行われ、新state側には反映されない)、無言の不具合を生む。
//      → state自体ではなく `getState()`(呼ぶたびに最新のstateを返す関数)を
//      DIで受け取り、各関数の先頭で `const state = getState();` を1行追加する
//      形にした(deps参照の受け取り方の変更のみ。ロジック・条件・順序は無改変)。
//   3. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 各exportの元routine.js内の行範囲・逐語コピーの対応はwiring.md参照。
// characterization test: recurrence-core.test.js(このディレクトリ)。

// ---- 依存注入(configureRecurrence) ----
let todayISO, addDays, parseDate, minutesOf, pad2, nowDateTime, showToast, isTouchedBlock;
let RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS;
let getState;

function configureRecurrence(deps) {
  ({
    todayISO, addDays, parseDate, minutesOf, pad2, nowDateTime, showToast, isTouchedBlock,
    RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS, getState
  } = deps);
}

// ---- ここから抽出したコード本体(元routine.jsから移動。ロジック無改変。
//      stateアクセスのみ `const state = getState();` を関数先頭に追加) ----

// v33: ルーティン実行率(元routine.js:127-132、逐語コピー。state参照なしのため無変更)。
function routineRate(blocks, recurrences = []) {
  // 率計器は計画Blockの消化を測るため、実績記録専用のoneTap Blockは除外する。
  // v253: protectionは実行率で裁かない契約のため、対応するルールのBlockも母集団から除外する。
  const protectedIds = new Set(recurrences.filter((rule) => !rule.deleted && rule.protection).map((rule) => rule.id));
  const list = blocks.filter((b) => b.category === "ルーティン" && !b.oneTap && !protectedIds.has(b.recurrenceGroupId));
  const done = list.filter((b) => b.completed).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// ===== v23: 繰り返しエンジン(ルール + ローリングウィンドウ materialization) =====
// 繰り返しは state.recurrences[] にルールとして保持する。表示用の Block は
// 「今日を中心とした一定期間」だけ実体化し、期間外で未編集のものは破棄する。
// これにより、以前のように 1 シリーズ 400 件を恒久保存することがなくなる。
// 期間の定数 RECURRENCE_KEEP_PAST_DAYS / RECURRENCE_FUTURE_DAYS はapp.js冒頭で定義され、
// configureRecurrence(deps)経由で受け取る(元routine.jsのconfigureRoutine(deps)と同じ理由。
// buildBlockModal等Timeline側の表示文言でも参照されるため、app.js側に定数自体は残した)。

// ルールが指定日付に発生するか(元routine.js:662-675、逐語コピー。state参照なし)。
function recurrenceMatchesDate(rule, isoDate) {
  if (!rule || rule.deleted) return false;
  if (rule.anchorDate && isoDate < rule.anchorDate) return false;
  if (Array.isArray(rule.exceptionDates) && rule.exceptionDates.includes(isoDate)) return false;
  const d = parseDate(isoDate);
  const wd = d.getDay();  // 0=日曜
  switch (rule.kind) {
    case "daily":    return true;
    case "weekdays": return wd >= 1 && wd <= 5;
    case "weekly":   return rule.anchorDate ? wd === parseDate(rule.anchorDate).getDay() : true;
    case "monthly":  return rule.anchorDate ? d.getDate() === parseDate(rule.anchorDate).getDate() : true;
    default:         return false;
  }
}

// ルール + 日付 から表示用 Block(実体)を生成(元routine.js:678-707、逐語コピー。state参照なし)。
function makeRecurrenceInstance(rule, isoDate) {
  return {
    id: `rec_${rule.id}_${isoDate}`,
    taskId: rule.taskId || "",
    date: isoDate,
    title: rule.title || "繰り返しBlock",
    category: rule.category || "",
    plannedStartAt: rule.startTime ? `${isoDate}T${rule.startTime}` : "",
    plannedEndAt: rule.endTime ? `${isoDate}T${rule.endTime}` : "",
    actualStartAt: "",
    actualEndAt: "",
    completed: false,
    // v33: ルーティンはルールの既定 充電/放電 をすべての実体に適用
    charge: rule.category === "ルーティン" ? (Number(rule.expectedCharge) || 0) : 0,
    discharge: rule.category === "ルーティン" ? (Number(rule.expectedDischarge) || 0) : 0,
    expectedCharge: rule.expectedCharge ?? "",
    expectedDischarge: rule.expectedDischarge ?? "",
    comment: "",
    recurrenceGroupId: rule.id,
    pomodoroCount: 0,
    migratedTo: "",
    carryCount: 0,  // v61: ルーティン実体は繰り越し対象外(carryableBlocksで除外)
    orderIndex: 0,
    isMIT: false,
    source: rule.source || "",
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
}

// Block(テンプレート)から新しい繰り返しルールを作成
// v108: 同タイトル・同開始時刻のアクティブな(deletedでない)繰り返しルールが既にあれば
//       新規作成しない(保存の二重発火等で同一内容のルールが重複生成される事故の再発防止、
//       2026-05-22実害・2026-07-15調査で確定)。削除済みルールは対象外(誤ブロックしない)。
// (元routine.js:713-717、逐語コピー。stateアクセスをgetState()経由に変更)
function findActiveDuplicateRecurrenceRule(title, startTime) {
  const state = getState();
  const t = (title || "").trim();
  return (state.recurrences || []).find(
    (r) => !r.deleted && (r.title || "").trim() === t && (r.startTime || "") === (startTime || ""));
}

// 戻り値: 作成したルール。重複検知時は作成せず null(呼び出し側はトースト表示済みとして扱う)。
// (元routine.js:720-751、逐語コピー。stateアクセスをgetState()経由に変更)
function createRecurrenceRule(block, kind) {
  const state = getState();
  const title = block.title || "繰り返しBlock";
  const startTime = block.plannedStartAt ? (block.plannedStartAt.split("T")[1] || "") : "";
  if (findActiveDuplicateRecurrenceRule(title, startTime)) {
    showToast(`「${title}」の繰り返しルールは既にあるため作成しませんでした`);
    return null;
  }
  const rule = {
    id: crypto.randomUUID(),
    title,
    category: block.category || "",
    taskId: block.taskId || "",
    kind,
    startTime,
    endTime: block.plannedEndAt ? (block.plannedEndAt.split("T")[1] || "") : "",
    anchorDate: block.date || todayISO(),
    expectedCharge: block.expectedCharge ?? "",
    expectedDischarge: block.expectedDischarge ?? "",
    source: block.source || "",
    exceptionDates: [],
    protection: false,  // v114: 保護系ルーティン(提案F)。既定false、編集モーダルでON可能
    fallbackTitle: "",  // v115: 縮退版(提案G①)。既定未設定
    fallbackMinutes: null,
    anchor: "",  // v115: アンカー(提案G③)。既定未設定
    streakSince: null,  // v252: 明示的に固定化したdaily/weekdaysだけ日付を持つ
    createdAt: nowDateTime(),
    updatedAt: nowDateTime(),
    deleted: false
  };
  state.recurrences ||= [];
  state.recurrences.push(rule);
  return rule;
}

// ---- 内部ヘルパー(非export): 連続ルーティン(チェーン)runの取得/作成 ----
// triggerAnchorPlacementsがアンカー完了直後のチェーン開始目安(scheduledStartAt)を
// 記録するためだけに使う。v219でチェーン進行UIは削除されたが、この3関数と
// state.chainRuns連携は挙動不変を優先して残す。ロジックは元routine.jsの該当関数の逐語コピー
// (notes.md参照)。

// 元routine.js:553-555、逐語コピー。state参照なし。
function chainRunKey(chainId, date) {
  return `${chainId}_${date}`;
}

// 元routine.js:557-559、逐語コピー。stateアクセスをgetState()経由に変更。
function findChainRun(chainId, date) {
  const state = getState();
  return (state.chainRuns || []).find((r) => r.id === chainRunKey(chainId, date));
}

// 今日分のrunを取得、無ければ作る(currentIndex=0から)。
// 元routine.js:562-575、逐語コピー。stateアクセスをgetState()経由に変更。
function ensureChainRun(chainId) {
  const state = getState();
  state.chainRuns ||= [];
  const today = todayISO();
  let run = findChainRun(chainId, today);
  if (!run) {
    run = {
      id: chainRunKey(chainId, today), chainId, date: today, currentIndex: 0,
      scheduledStartAt: "", startedAt: "", completedAt: "", stepLog: [],
      createdAt: nowDateTime(), updatedAt: nowDateTime()
    };
    state.chainRuns.push(run);
  }
  return run;
}

// v115: アンカー配置(習慣スタッキング、提案G③)。anchorIdが「今日完了」したタイミングで、
// anchorがそれと一致する後続のルーティン/チェーンを直後の時刻に自動配置する。
// ルーティン側(state.recurrences)は既存の繰り返し実体化(makeRecurrenceInstance)を再利用し、
// 時刻だけ「アンカー完了時刻の1分後」に差し替える。チェーン側(state.routineChains)は
// Blockという概念を持たないため、当日分のrunにscheduledStartAtを記録するだけに留める
// (v219で表示UIは削除。既存データへの記録挙動は温存する。詳細はdecisions.md参照)。
// (元routine.js:759-782、逐語コピー。stateアクセスをgetState()経由に変更)
function triggerAnchorPlacements(anchorId, completedAtDateTime) {
  const state = getState();
  if (!anchorId || !completedAtDateTime) return;
  const today = todayISO();
  const afterMin = Math.min(23 * 60 + 59, minutesOf(completedAtDateTime) + 1);
  const startTime = `${pad2(Math.floor(afterMin / 60))}:${pad2(afterMin % 60)}`;
  (state.recurrences || []).forEach((r) => {
    if (r.deleted || r.anchor !== anchorId) return;
    const already = state.blocks.some((b) => !b.deleted && b.recurrenceGroupId === r.id && b.date === today);
    if (already) return;
    const inst = makeRecurrenceInstance(r, today);
    const durMin = (r.startTime && r.endTime)
      ? Math.max(1, minutesOf(`${today}T${r.endTime}`) - minutesOf(`${today}T${r.startTime}`))
      : 10;
    const endMin = Math.min(23 * 60 + 59, afterMin + durMin);
    inst.plannedStartAt = `${today}T${startTime}`;
    inst.plannedEndAt = `${today}T${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`;
    state.blocks.push(inst);
  });
  (state.routineChains || []).forEach((c) => {
    if (c.deleted || c.anchor !== anchorId) return;
    const run = ensureChainRun(c.id);
    if (!run.completedAt) run.scheduledStartAt = `${today}T${startTime}`;
  });
}

// 指定期間に繰り返し Block を実体化(既存があれば温存)。
// purge=true で「期間外 かつ 未編集」の繰り返し実体を破棄しファイルを小さく保つ。
// (元routine.js:786-826、逐語コピー。stateアクセスをgetState()経由に変更)
function maintainRecurrences({ purge = false } = {}) {
  const state = getState();
  state.recurrences ||= [];
  state.blocks ||= [];
  const rules = state.recurrences.filter((r) => !r.deleted);
  const today = todayISO();
  const from = addDays(today, -RECURRENCE_KEEP_PAST_DAYS);
  const to = addDays(today, RECURRENCE_FUTURE_DAYS);
  // 既存の (ruleId + date) を索引化(削除済みも含めて重複生成を防ぐ)
  const existing = new Set();
  for (const b of state.blocks) {
    if (b.recurrenceGroupId) existing.add(`${b.recurrenceGroupId}|${b.date}`);
  }
  // 期間内の発生日を実体化
  for (const rule of rules) {
    // v115: アンカー(提案G③)を持つルールは、通常のスケジュール実体化から除外する。
    //       このルールのBlockは「アンカーが完了した直後」にtriggerAnchorPlacementsだけが
    //       生成する(=事前に毎日分が生成されてしまうと「完了直後に配置」の意味が無くなるため)。
    if (rule.anchor) continue;
    let cur = from;
    let guard = 0;
    while (cur <= to && guard < 800) {
      guard++;
      if (recurrenceMatchesDate(rule, cur) && !existing.has(`${rule.id}|${cur}`)) {
        state.blocks.push(makeRecurrenceInstance(rule, cur));
        existing.add(`${rule.id}|${cur}`);
      }
      cur = addDays(cur, 1);
    }
  }
  // 破棄: 繰り返し実体 かつ 期間外 かつ 未編集 のものを取り除く
  if (purge) {
    const ruleIds = new Set(state.recurrences.map((r) => r.id));
    state.blocks = state.blocks.filter((b) => {
      const isRecInstance = b.recurrenceGroupId && ruleIds.has(b.recurrenceGroupId);
      if (!isRecInstance) return true;                   // 通常 Block は残す
      if (b.date >= from && b.date <= to) return true;   // 期間内は残す
      if (isTouchedBlock(b)) return true;                // 実績ありは履歴として残す
      return false;                                      // 期間外・未編集は破棄
    });
  }
}

// アンカー候補(既存の繰り返しルール+他の連続ルーティン)。excludeIdで自分自身を除外する
// (idはルール・チェーンで衝突しないUUIDのため、両方まとめて1つの除外引数でよい)。
// v219: buildBlockModal(Timeline Block編集モーダルのアンカー選択、app.js残留)から呼ばれる。
// (元routine.js:1081-1089、逐語コピー。stateアクセスをgetState()経由に変更)
function anchorCandidateOptions(excludeId) {
  const state = getState();
  const ruleOpts = (state.recurrences || [])
    .filter((r) => !r.deleted && r.id !== excludeId)
    .map((r) => ({ id: r.id, label: `↻ ${r.title}` }));
  const chainOpts = (state.routineChains || [])
    .filter((c) => !c.deleted && c.id !== excludeId)
    .map((c) => ({ id: c.id, label: `🔗 ${c.title}` }));
  return [...ruleOpts, ...chainOpts];
}

export {
  configureRecurrence,
  routineRate,
  recurrenceMatchesDate,
  makeRecurrenceInstance,
  findActiveDuplicateRecurrenceRule,
  createRecurrenceRule,
  triggerAnchorPlacements,
  maintainRecurrences,
  anchorCandidateOptions
};
