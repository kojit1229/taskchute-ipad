// recurrence-core.test.js — src/core/recurrence.js(移設予定モジュール)のcharacterization test。
// 自己完結Node実行(node:assert + 直import、npm/フレームワーク不要)。
// `node recurrence-core.test.js` で実行する。

import assert from "node:assert/strict";
import {
  configureRecurrence,
  routineRate,
  recurrenceMatchesDate,
  makeRecurrenceInstance,
  findActiveDuplicateRecurrenceRule,
  createRecurrenceRule,
  triggerAnchorPlacements,
  maintainRecurrences,
  anchorCandidateOptions
} from "../src/core/recurrence.js";

// ---- 決定論的な日付/時刻ヘルパー(app.js実装の慣習=数値コンストラクタのみ使用、を踏襲) ----
function pad2(n) { return String(n).padStart(2, "0"); }
function parseDateISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDaysISO(iso, delta) {
  const d = parseDateISO(iso);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function minutesOfDT(dt) {
  const time = dt.split("T")[1] || "00:00";
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ---- テスト用の可変state + getState() ----
// 「stateオブジェクトを1回だけ受け取ってキャッシュするとsetState()再代入に追従できない」
// という設計判断そのものをテストするため、currentStateを差し替え可能な変数にしておく。
let currentState;
function freshState() {
  return { recurrences: [], blocks: [], routineChains: [], chainRuns: [] };
}
function resetState() {
  currentState = freshState();
}

const toastLog = [];
function fakeShowToast(msg) { toastLog.push(msg); }

let TODAY = "2026-08-20";       // 2026-08-20は木曜日
let NOW_DT = "2026-08-20T09:00";

function fakeIsTouchedBlock(b) {
  return Boolean(b.actualStartAt || b.actualEndAt || b.comment);
}

configureRecurrence({
  todayISO: () => TODAY,
  addDays: addDaysISO,
  parseDate: parseDateISO,
  minutesOf: minutesOfDT,
  pad2,
  nowDateTime: () => NOW_DT,
  showToast: fakeShowToast,
  isTouchedBlock: fakeIsTouchedBlock,
  RECURRENCE_KEEP_PAST_DAYS: 3,
  RECURRENCE_FUTURE_DAYS: 3,
  getState: () => currentState
});

// ---- 簡易テストランナー ----
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

// =====================================================================
// recurrenceMatchesDate
// =====================================================================
test("recurrenceMatchesDate: daily は常にtrue(deleted/例外日以外)", () => {
  const rule = { kind: "daily" };
  assert.equal(recurrenceMatchesDate(rule, "2026-08-20"), true);
  assert.equal(recurrenceMatchesDate({ ...rule, deleted: true }, "2026-08-20"), false);
});

test("recurrenceMatchesDate: weekdays は土日を除外", () => {
  const rule = { kind: "weekdays" };
  assert.equal(recurrenceMatchesDate(rule, "2026-08-20"), true);   // 木曜
  assert.equal(recurrenceMatchesDate(rule, "2026-08-22"), false);  // 土曜
  assert.equal(recurrenceMatchesDate(rule, "2026-08-23"), false);  // 日曜
});

test("recurrenceMatchesDate: weekly はanchorDateと同じ曜日のみ", () => {
  const rule = { kind: "weekly", anchorDate: "2026-08-20" };  // 木曜起点
  assert.equal(recurrenceMatchesDate(rule, "2026-08-27"), true);   // 翌週木曜
  assert.equal(recurrenceMatchesDate(rule, "2026-08-26"), false);  // 水曜
});

test("recurrenceMatchesDate: monthly はanchorDateと同じ日のみ", () => {
  const rule = { kind: "monthly", anchorDate: "2026-08-05" };
  assert.equal(recurrenceMatchesDate(rule, "2026-09-05"), true);
  assert.equal(recurrenceMatchesDate(rule, "2026-09-06"), false);
});

test("recurrenceMatchesDate: anchorDateより前は常にfalse", () => {
  const rule = { kind: "daily", anchorDate: "2026-08-20" };
  assert.equal(recurrenceMatchesDate(rule, "2026-08-19"), false);
});

test("recurrenceMatchesDate: exceptionDatesに含まれる日はfalse", () => {
  const rule = { kind: "daily", exceptionDates: ["2026-08-20"] };
  assert.equal(recurrenceMatchesDate(rule, "2026-08-20"), false);
  assert.equal(recurrenceMatchesDate(rule, "2026-08-21"), true);
});

// =====================================================================
// makeRecurrenceInstance
// =====================================================================
test("makeRecurrenceInstance: ルーティンカテゴリはcharge/dischargeを引き継ぐ", () => {
  const rule = { id: "r1", title: "瞑想", category: "ルーティン", startTime: "07:00", endTime: "07:10",
    expectedCharge: 3, expectedDischarge: 1 };
  const inst = makeRecurrenceInstance(rule, "2026-08-20");
  assert.equal(inst.id, "rec_r1_2026-08-20");
  assert.equal(inst.plannedStartAt, "2026-08-20T07:00");
  assert.equal(inst.plannedEndAt, "2026-08-20T07:10");
  assert.equal(inst.charge, 3);
  assert.equal(inst.discharge, 1);
  assert.equal(inst.completed, false);
  assert.equal(inst.recurrenceGroupId, "r1");
});

test("makeRecurrenceInstance: ルーティン以外はcharge/dischargeを0にする", () => {
  const rule = { id: "r2", title: "MTG", category: "仕事", expectedCharge: 5, expectedDischarge: 5 };
  const inst = makeRecurrenceInstance(rule, "2026-08-20");
  assert.equal(inst.charge, 0);
  assert.equal(inst.discharge, 0);
});

// =====================================================================
// routineRate
// =====================================================================
test("routineRate: oneTapを除外して達成率を計算", () => {
  const blocks = [
    { category: "ルーティン", completed: true },
    { category: "ルーティン", completed: false },
    { category: "ルーティン", completed: true, oneTap: true },  // 除外される
    { category: "仕事", completed: true }                        // 除外される
  ];
  const rate = routineRate(blocks);
  assert.deepEqual(rate, { done: 1, total: 2, pct: 50 });
});

test("routineRate: 対象0件はpct 0", () => {
  assert.deepEqual(routineRate([]), { done: 0, total: 0, pct: 0 });
});

test("routineRate: protectionルールのBlockを分母から除外", () => {
  const blocks = [
    { category: "ルーティン", recurrenceGroupId: "normal", completed: true },
    { category: "ルーティン", recurrenceGroupId: "protected", completed: false }
  ];
  const rules = [{ id: "normal", protection: false }, { id: "protected", protection: true }];
  assert.deepEqual(routineRate(blocks, rules), { done: 1, total: 1, pct: 100 });
});

// =====================================================================
// findActiveDuplicateRecurrenceRule / createRecurrenceRule
// =====================================================================
test("createRecurrenceRule: 新規作成できる", () => {
  resetState();
  const block = { title: "朝の水分補給", category: "ルーティン", plannedStartAt: "2026-08-20T07:00",
    plannedEndAt: "2026-08-20T07:05", date: "2026-08-20" };
  const rule = createRecurrenceRule(block, "daily");
  assert.ok(rule);
  assert.equal(rule.title, "朝の水分補給");
  assert.equal(rule.kind, "daily");
  assert.equal(rule.startTime, "07:00");
  assert.equal(currentState.recurrences.length, 1);
});

test("createRecurrenceRule: 同タイトル・同開始時刻の重複はnullを返しshowToastする", () => {
  resetState();
  toastLog.length = 0;
  const block = { title: "朝の水分補給", category: "ルーティン", plannedStartAt: "2026-08-20T07:00",
    date: "2026-08-20" };
  createRecurrenceRule(block, "daily");
  const second = createRecurrenceRule(block, "daily");
  assert.equal(second, null);
  assert.equal(currentState.recurrences.length, 1);
  assert.equal(toastLog.length, 1);
  assert.match(toastLog[0], /既にあるため作成しませんでした/);
});

test("findActiveDuplicateRecurrenceRule: 削除済みルールは対象外", () => {
  resetState();
  currentState.recurrences.push({ id: "x1", title: "散歩", startTime: "18:00", deleted: true });
  const found = findActiveDuplicateRecurrenceRule("散歩", "18:00");
  assert.equal(found, undefined);
});

// =====================================================================
// maintainRecurrences
// =====================================================================
test("maintainRecurrences: weekly ルールをウィンドウ内に実体化する(重複なし)", () => {
  resetState();
  TODAY = "2026-08-20";  // 木曜、KEEP=3/FUTURE=3 → 2026-08-17〜2026-08-23
  currentState.recurrences.push({
    id: "w1", title: "週次レビュー", category: "ルーティン", kind: "weekly",
    anchorDate: "2026-08-20", startTime: "20:00", endTime: "20:30", deleted: false
  });
  maintainRecurrences();
  const created = currentState.blocks.filter((b) => b.recurrenceGroupId === "w1");
  assert.equal(created.length, 1);            // ウィンドウ内の木曜は8/20の1件のみ
  assert.equal(created[0].date, "2026-08-20");

  // 再実行しても重複生成しない
  maintainRecurrences();
  assert.equal(currentState.blocks.filter((b) => b.recurrenceGroupId === "w1").length, 1);
});

test("maintainRecurrences: anchor付きルールは通常実体化から除外される", () => {
  resetState();
  TODAY = "2026-08-20";
  currentState.recurrences.push({
    id: "a1", title: "アンカー後続", category: "ルーティン", kind: "daily",
    anchor: "someAnchorId", deleted: false
  });
  maintainRecurrences();
  assert.equal(currentState.blocks.filter((b) => b.recurrenceGroupId === "a1").length, 0);
});

test("maintainRecurrences: purge=trueで期間外・未編集の実体を破棄、実績ありは残す", () => {
  resetState();
  TODAY = "2026-08-20";  // ウィンドウ: 2026-08-17〜2026-08-23
  currentState.recurrences.push({ id: "d1", title: "日次タスク", category: "ルーティン", kind: "daily", deleted: false });
  // 期間外・未編集(破棄されるべき)
  currentState.blocks.push({
    id: "rec_d1_2026-08-01", recurrenceGroupId: "d1", date: "2026-08-01",
    actualStartAt: "", actualEndAt: "", comment: "", deleted: false
  });
  // 期間外・実績あり(残るべき)
  currentState.blocks.push({
    id: "rec_d1_2026-08-02", recurrenceGroupId: "d1", date: "2026-08-02",
    actualStartAt: "2026-08-02T09:00", actualEndAt: "2026-08-02T09:10", comment: "", deleted: false
  });
  // 通常Block(繰り返しに属さない、常に残るべき)
  currentState.blocks.push({ id: "b_manual", recurrenceGroupId: "", date: "2026-08-01", deleted: false });

  maintainRecurrences({ purge: true });

  const ids = currentState.blocks.map((b) => b.id);
  assert.ok(!ids.includes("rec_d1_2026-08-01"), "期間外・未編集は破棄されるべき");
  assert.ok(ids.includes("rec_d1_2026-08-02"), "実績ありは期間外でも残るべき");
  assert.ok(ids.includes("b_manual"), "繰り返し実体でない通常Blockは常に残るべき");
});

// =====================================================================
// triggerAnchorPlacements
// =====================================================================
test("triggerAnchorPlacements: アンカー完了1分後にルール側Blockを配置する", () => {
  resetState();
  TODAY = "2026-08-20";
  currentState.recurrences.push({
    id: "follow1", title: "後続ルーティン", category: "ルーティン", kind: "daily",
    anchor: "anchorRuleId", startTime: "", endTime: "", deleted: false
  });
  triggerAnchorPlacements("anchorRuleId", "2026-08-20T08:00");
  const placed = currentState.blocks.filter((b) => b.recurrenceGroupId === "follow1");
  assert.equal(placed.length, 1);
  assert.equal(placed[0].plannedStartAt, "2026-08-20T08:01");  // 完了時刻+1分
  // durMin未指定(startTime/endTimeなし)は既定10分
  assert.equal(placed[0].plannedEndAt, "2026-08-20T08:11");
});

test("triggerAnchorPlacements: 23:58完了時は開始・終了を23:59へクランプする", () => {
  resetState();
  TODAY = "2026-08-20";
  currentState.recurrences.push({
    id: "lateFollow", title: "夜のログ", category: "ルーティン", kind: "daily",
    anchor: "lateAnchor", startTime: "", endTime: "", deleted: false
  });
  triggerAnchorPlacements("lateAnchor", "2026-08-20T23:58");
  const placed = currentState.blocks.find((b) => b.recurrenceGroupId === "lateFollow");
  assert.equal(placed?.plannedStartAt, "2026-08-20T23:59");
  assert.equal(placed?.plannedEndAt, "2026-08-20T23:59");
});

test("triggerAnchorPlacements: 同日に既にBlockがあれば重複配置しない", () => {
  resetState();
  TODAY = "2026-08-20";
  currentState.recurrences.push({ id: "follow2", anchor: "anchorX", deleted: false });
  currentState.blocks.push({ id: "existing", recurrenceGroupId: "follow2", date: "2026-08-20", deleted: false });
  triggerAnchorPlacements("anchorX", "2026-08-20T08:00");
  assert.equal(currentState.blocks.filter((b) => b.recurrenceGroupId === "follow2").length, 1);
});

test("triggerAnchorPlacements: チェーン側はscheduledStartAtだけを記録する(未完了runのみ)", () => {
  resetState();
  TODAY = "2026-08-20";
  currentState.routineChains.push({ id: "chain1", title: "朝チェーン", anchor: "anchorY", deleted: false });
  triggerAnchorPlacements("anchorY", "2026-08-20T08:00");
  const run = currentState.chainRuns.find((r) => r.chainId === "chain1" && r.date === "2026-08-20");
  assert.ok(run);
  assert.equal(run.scheduledStartAt, "2026-08-20T08:01");
});

test("triggerAnchorPlacements: anchorId/completedAtが無ければ何もしない", () => {
  resetState();
  currentState.recurrences.push({ id: "noop", anchor: "x", deleted: false });
  triggerAnchorPlacements("", "2026-08-20T08:00");
  triggerAnchorPlacements("x", "");
  assert.equal(currentState.blocks.length, 0);
});

// =====================================================================
// anchorCandidateOptions
// =====================================================================
test("anchorCandidateOptions: ルール+チェーンを両方含み、除外idを外す", () => {
  resetState();
  currentState.recurrences.push(
    { id: "r1", title: "散歩", deleted: false },
    { id: "r2", title: "自分自身", deleted: false },
    { id: "r3", title: "削除済み", deleted: true }
  );
  currentState.routineChains.push(
    { id: "c1", title: "朝チェーン", deleted: false }
  );
  const opts = anchorCandidateOptions("r2");
  const ids = opts.map((o) => o.id);
  assert.ok(ids.includes("r1"));
  assert.ok(!ids.includes("r2"), "excludeIdは除外されるべき");
  assert.ok(!ids.includes("r3"), "削除済みルールは除外されるべき");
  assert.ok(ids.includes("c1"));
  const ruleOpt = opts.find((o) => o.id === "r1");
  const chainOpt = opts.find((o) => o.id === "c1");
  assert.equal(ruleOpt.label, "↻ 散歩");
  assert.equal(chainOpt.label, "🔗 朝チェーン");
});

// =====================================================================
// getState()の鮮度(setState()相当の再代入への追従) — 設計判断そのものの検証
// =====================================================================
test("getState: state再代入後もmaintainRecurrencesは最新のstateへ書き込む", () => {
  TODAY = "2026-08-20";
  const oldState = freshState();
  oldState.recurrences.push({ id: "old1", title: "旧state用", kind: "daily", deleted: false });
  currentState = oldState;

  // ここでstore.jsのsetState(next)相当の再代入が起きたと仮定する
  const newState = freshState();
  newState.recurrences.push({ id: "new1", title: "新state用", kind: "daily", deleted: false });
  currentState = newState;

  maintainRecurrences();

  assert.equal(oldState.blocks.length, 0, "古いstateオブジェクトには書き込まれないべき");
  assert.ok(newState.blocks.some((b) => b.recurrenceGroupId === "new1"), "新しいstateオブジェクトに書き込まれるべき");
});

// ---- 結果出力 ----
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} - ${r.name}`);
  if (!r.ok) {
    console.error(r.err);
  }
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  process.exitCode = 1;
}
