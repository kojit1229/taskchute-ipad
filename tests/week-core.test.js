const assert = require("node:assert/strict");
const { pathToFileURL } = require("url");
const path = require("path");
const WEEK = "2026-07-25", TODAY = "2026-07-31";
const meta = { id: "week", recordType: "week", weekStart: WEEK, committedVia: "auto" };
const item = (id, extra = {}) => ({ id, blockId: id, taskId: "t", projectId: "p", title: id,
  recordType: "item", lane: "cycle", weekStart: WEEK, plannedDate: TODAY, ...extra });
const blocks = ["a", "b", "c"].map((id, i) => ({ id, plannedStartAt: `${TODAY}T${["21:00", "07:00", "07:00"][i]}`, estimateMin: 25 }));

(async () => {
  const { weekOutlook, weekDayStrip, todayTwyBlocks, missedTwyItems, projectWeekScore, taskDayChips } =
    await import(pathToFileURL(path.join(__dirname, "../src/core/week.js")).href);
  const fixtures = [
    { name: "未確定", records: [item("a")], counts: [0, 0, 0, 0, 0], today: [], missed: [], chips: [], status: "uncommitted" },
    { name: "免除あり", records: [meta, item("a", { completedAt: `${TODAY}T08:00` }), item("x", { excused: true })],
      counts: [2, 1, 1, 0, 0], today: ["a"], missed: [], chips: ["done", "excused"], status: "scored" },
    { name: "今日3件・落ちた1件", records: [meta, item("a"), item("c"), item("b"), item("m", { plannedDate: "2026-07-28" })],
      counts: [4, 0, 0, 3, 1], today: ["b", "c", "a"], missed: ["m"], chips: ["missed", "today", "today", "today"], status: "scored" },
    { name: "手動確定", records: [{ ...meta, committedVia: "manual", selectedBlockIds: ["b"] }, item("a"), item("b"), item("m", { source: "added", plannedDate: "2026-07-28" })],
      counts: [2, 0, 0, 1, 1], today: ["b"], missed: ["m"], chips: ["missed", "today"], status: "scored" },
    { name: "total=0", records: [meta, item("x", { excused: true, completedAt: `${TODAY}T08:00` })],
      counts: [1, 1, 0, 0, 0], today: [], missed: [], chips: ["excused"], status: "na" }
  ];
  for (const f of fixtures) {
    const before = JSON.stringify([f.records, blocks]);
    const outlook = weekOutlook(f.records, WEEK, TODAY);
    const [committed, excused, done, todayPlanned, missed] = f.counts;
    const total = committed - excused;
    const needed = Math.max(0, Math.ceil(total * .85) - done);
    assert.deepEqual(outlook, { status: f.status, committed, excused, total, done, todayPlanned, missed,
      pct: total ? Math.round(done / total * 100) : null,
      pctIfTodayDone: total ? Math.round((done + todayPlanned) / total * 100) : null,
      needTodayForTarget: total && needed <= todayPlanned ? needed : null,
      pctIfRecovered: total ? Math.round((done + todayPlanned + missed) / total * 100) : null }, f.name);
    const strip = weekDayStrip(f.records, WEEK, TODAY);
    assert.deepEqual(strip.map((x) => x.label), ["土", "日", "月", "火", "水", "木", "金"]);
    assert.deepEqual(strip.map((x) => x.dateISO), ["2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", TODAY]);
    assert.equal(strip[6].isToday, true);
    assert.equal(strip[5].isPast, true);
    assert.equal(strip[6].isPast, false);
    assert.equal(strip.reduce((sum, x) => sum + x.total, 0), total);
    assert.equal(strip.reduce((sum, x) => sum + x.done, 0), done);
    assert.equal(strip.reduce((sum, x) => sum + x.excused, 0), excused);
    assert.equal(strip[3].missed, missed);
    assert.deepEqual(todayTwyBlocks(f.records, blocks, WEEK, TODAY).map((x) => x.blockId), f.today);
    assert.deepEqual(missedTwyItems(f.records, WEEK, TODAY).map((x) => x.id), f.missed);
    assert.deepEqual(projectWeekScore(f.records, WEEK, "p"), { done, total, pct: outlook.pct });
    assert.deepEqual(projectWeekScore(f.records, WEEK, "other"), { done: 0, total: 0, pct: null });
    assert.deepEqual(taskDayChips(f.records, blocks, WEEK, "t", TODAY).map((x) => x.state), f.chips);
    assert.deepEqual(taskDayChips(f.records, blocks, WEEK, "other", TODAY), []);
    assert.equal(JSON.stringify([f.records, blocks]), before, "入力を変更しない");
    console.log(`PASS ${f.name}: 6関数`);
  }
  const scope = [meta, item("a"), item("b", { completedAt: `${TODAY}T08:00` }), item("z"), item("empty", { plannedDate: "" })];
  assert.deepEqual(todayTwyBlocks(scope, blocks, WEEK, TODAY), [
    { blockId: "b", taskId: "t", projectId: "p", title: "b", plannedStartAt: `${TODAY}T07:00`, time: "07:00", estimateMin: 25, done: true },
    { blockId: "a", taskId: "t", projectId: "p", title: "a", plannedStartAt: `${TODAY}T21:00`, time: "21:00", estimateMin: 25, done: false },
    { blockId: "z", taskId: "t", projectId: "p", title: "z", plannedStartAt: "", time: "", estimateMin: null, done: false }
  ]);
  assert.equal(weekOutlook(scope, WEEK, TODAY, 50).needTodayForTarget, 1);
  assert.equal(weekOutlook(scope, WEEK, TODAY, 100).needTodayForTarget, null);
  assert.deepEqual(missedTwyItems(scope, WEEK, TODAY), [], "日付なしを落ちたコマにしない");
  assert.equal(taskDayChips(scope, blocks, WEEK, "t", TODAY)[0].time, "07:00");
  assert.equal(taskDayChips([meta, item("f", { plannedDate: TODAY })], [], WEEK, "t", "2026-07-30")[0].state, "planned");
  assert.equal(weekDayStrip([meta, item("x", { plannedDate: "" })], WEEK, TODAY).reduce((sum, x) => sum + x.total, 0), 0);
  console.log("PASS 並び順・時刻・欠損Block・予定・日付なし・目標");
})().catch((error) => { console.error(error); process.exitCode = 1; });
