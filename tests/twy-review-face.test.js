// Orders 53/54: review summary, measurements, optional prose, completion and responsive layout.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { setup, nav } = require("./remaining-twelveweek-layout.test");
const { STATE_KEY, setViewportAndWaitForStableLayout } = require("./helpers");
let assertions = 0;
const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const week = "2026-08-29", today = "2026-09-05", cycle = "2026-07-11";
const stamp = "2026-08-29T08:00:00";
const item = (id, plannedDate, extra = {}) => ({ id, recordType: "item", weekStart: week, taskId: "t1",
  projectId: "p1", blockId: id, title: `予定${id}`, lane: "cycle", source: "auto", plannedDate, completedAt: "",
  excused: false, deleted: false, createdAt: stamp, updatedAt: stamp, ...extra });
const records = [
  { id: `wcw_${week}`, recordType: "week", weekStart: week, cycleStartDate: cycle, committedAt: stamp, committedVia: "auto",
    deleted: false, createdAt: stamp, updatedAt: stamp },
  item("done", "2026-08-29", { completedAt: stamp }), item("tue", "2026-09-01"),
  item("fri1", "2026-09-04"), item("fri2", "2026-09-04"),
  item("excused", "2026-09-04", { excused: true }), item("deleted", "2026-09-04", { deleted: true }),
  item("life", "2026-09-04", { lane: "life" }), item("otherWeek", today, { weekStart: today })
];
const projects = [{ id: "p1", title: "検定", kind: "normal", status: "active", twelveWeekStartDate: cycle,
  deleted: false, createdAt: stamp, updatedAt: stamp }];
const savedReview = { id: `wr_${week}_p1`, weekStart: week, projectId: "p1", cycleStartDate: cycle,
  aim: "目標を維持", wentWell: "朝にできた", obstacles: "雨", reviewedAt: "", deleted: false,
  createdAt: stamp, updatedAt: stamp };

async function nodeChecks() {
  const store = await import("../src/state/store.js");
  const feature = await import("../src/features/twelve-week.js");
  const { weekStartOfISO } = await import("../src/core/plan.js");
  const { dispatchAction } = await import("../src/ui/actions.js");
  const escapeHTML = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  let clock = today, saves = 0;
  store.setState({ settings: { twelveWeekStartDate: cycle }, projects, tasks: [], tracks: [], blocks: [],
    weeklyCommitments: records, twyWeeklyReviews: [{ ...savedReview }] });
  feature.configureTwelveWeek({ escapeHTML, renderHeader: () => "", todayISO: () => clock,
    weekRange: date => ({ weekStart: weekStartOfISO(date) }), nowDateTime: () => `${clock}T10:00:00`,
    renderTwyTrackReadOnly: () => "", twyTrackIsDone: () => false, candidateBlocksForWeek: () => [],
    render: () => {}, saveAndRender: () => { saves++; } });
  for (const date of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
    clock = date;
    ok(feature.renderTwelveWeek().includes('class="twy-review-fold" '), `${date}: review remains folded on the page`);
  }
  clock = today;
  const before = JSON.stringify(store.state), html = feature.renderTwelveWeek();
  ok(html.includes('class="twy-review-fold" >'), "Saturday review is closed by default");
  eq(JSON.stringify(store.state), before, "render does not save or mutate state");
  ok(html.includes("① W8を見る"), "previous week number, not current week");
  ok(html.includes("25%"), "score is 1/4; excused/life/deleted/other week excluded");
  ok(html.includes("予定 5回のうち できた 1 · まだ 3 · 点数に含めない 1"));
  ok(html.includes("金曜が各2回"), "weekday bias is calculated from missed items");
  ok(!html.includes("予定life") && !html.includes("予定deleted") && !html.includes("予定otherWeek"));
  store.state.twyWeeklyReviews[0].reviewedAt = today;
  ok(!feature.renderTwelveWeek().includes('(未記録)'), "reviewed Saturday has no reminder");
  store.state.twyWeeklyReviews[0].deleted = true;
  ok(feature.renderTwelveWeek().includes('(未記録)'), "deleted review does not mark finished");
  store.state.twyWeeklyReviews[0] = { ...savedReview, reviewedAt: "2026-09-04" };
  ok(feature.renderTwelveWeek().includes('(未記録)'), "last week's confirmation does not mark this week");
  for (const [fixture, expected] of [[[], "—"], [[records[0], records[5]], "—"]]) {
    store.state.weeklyCommitments = fixture;
    ok(feature.renderTwelveWeek().includes(`twy-week-score-big">${expected}</div>`), "empty/all-excused is not zero percent");
  }
  store.state.weeklyCommitments = records;
  ok(html.includes(`data-review-week="${week}"`));
  clock = "2026-09-12";
  dispatchAction("twy-review-finish", { target: { closest: () => ({ dataset: { reviewWeek: week } }) } });
  eq(saves, 1, "finish uses existing save path once");
  eq(store.state.twyWeeklyReviews[0], { ...savedReview, reviewedAt: `${clock}T10:00:00`, updatedAt: `${clock}T10:00:00` });
  ok(feature.renderTwelveWeek().includes('class="twy-decide"'));
  eq(store.state.weeklyCommitments, records, "finishing never edits commitments");
  store.state.twyWeeklyReviews[0].deleted = true;
  dispatchAction("twy-review-finish", { target: { closest: () => ({ dataset: { reviewWeek: week } }) } });
  eq(store.state.twyWeeklyReviews.length, 1, "finish restores the same tombstoned review id");
  eq(store.state.twyWeeklyReviews[0].deleted, false);
  store.state.projects = [];
  dispatchAction("twy-review-finish", { target: { closest: () => ({ dataset: { reviewWeek: week } }) } });
  eq(store.state.twyWeeklyReviews.find(r => r.projectId === "").reviewedAt, `${clock}T10:00:00`, "empty goals can finish without a new state key");
}

async function browserChecks() {
  const { page, browser, server } = await setup();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const evidence = process.env.ORDER54_EVIDENCE_DIR || process.env.ORDER53_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "twy-review-face-"));
  fs.mkdirSync(evidence, { recursive: true });
  try {
    await page.clock.setFixedTime(new Date(2026, 8, 5, 10));
    await page.evaluate(({ key, records, projects, savedReview, cycle }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "twelveweek";
      s.settings.twelveWeekStartDate = cycle;
      s.projects = [...s.projects.filter(p => ["wish", "other"].includes(p.kind)), ...projects];
      s.tasks = s.tasks.filter(t => t.kind === "other");
      s.blocks = []; s.tracks = []; s.trackMeasurements = [];
      s.weeklyCommitments = records; s.twyWeeklyReviews = [savedReview];
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, records, projects, savedReview, cycle });
    await page.reload();
    await page.waitForSelector('.twy-tower');
    const seeded = await page.evaluate(async () => {
      const s = (await import("/src/state/store.js")).state;
      return { records: s.weeklyCommitments, reviews: s.twyWeeklyReviews, date: new Date().toString() };
    });
    eq(seeded.records.map(r => r.id).sort(), records.map(r => r.id).sort(), JSON.stringify(seeded));
    eq(await page.locator(".twy-face-segmented, [data-face]").count(), 0);
    eq(await page.locator(".twy-review-fold").getAttribute("open"), null);
    await page.locator(".twy-review-fold > summary").click();
    eq(await page.locator(".twy-review-score .twy-week-score-big").innerText(), "25%", JSON.stringify(seeded));
    ok((await page.locator(".twy-review-score").innerText()).includes("予定 5回のうち できた 1 · まだ 3 · 点数に含めない 1"));
    ok((await page.locator('[data-review-project="p1"]').innerText()).includes("まだ物差しが無い"));
    eq(await page.locator(".twy-review-score li").count(), 3);
    eq((await page.locator(".twy-review-score li").allTextContents()).map(s => s.trim()),
      ["火 予定tue検定", "金 予定fri1検定", "金 予定fri2検定"]);
    await page.evaluate(async ({ cycle, today }) => {
      const s = (await import("/src/state/store.js")).state;
      for (const [id, title] of [["p2", "体重"], ["p3", "新しい目標"]]) s.projects.push({ ...s.projects.find(p => p.id === "p1"), id, title });
      const track = (id, ownerId, name, extra = {}) => ({ id, ownerId, ownerType: "project", kind: "numeric", name,
        baselineValue: 0, goalValue: 8, unit: "回", valueStep: 1, startDate: cycle, deadline: "2026-10-02",
        cycleStartDate: cycle, status: "active", deleted: false, createdAt: `${cycle}T08:00:00`, updatedAt: `${cycle}T08:00:00`, ...extra });
      s.tracks = [track("num2", "p1", "復習", { goalValue: 10 }),
        track("done", "p1", "テキスト", { goalValue: 27, unit: "章", status: "closed", closedReason: "superseded" }),
        track("weight", "p2", "体重", { baselineValue: 75, goalValue: 72, valueStep: 0.1, unit: "kg" }),
        track("closed", "p1", "終了済み", { status: "closed" }), track("deleted", "p1", "削除済み", { deleted: true }),
        track("milestone", "p3", "提出", { kind: "milestone", milestones: [{ id: "ms1", label: "下書き", plannedDate: "2026-09-10", doneAt: "", deleted: false }] })];
      s.trackMeasurements = [{ id: "done-measurement", trackId: "done", value: 27, observedAt: `${today}T09:00:00`, deleted: false },
        { id: "weight-measurement", trackId: "weight", value: 72.8, observedAt: `${today}T09:00:00`, deleted: false }];
    }, { cycle, today });
    await nav(page, "twelveweek");
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    eq(await page.locator("[data-review-project]").count(), 3, "one group per goal");
    eq(await page.locator('[data-review-project="p1"] [data-review-track]').count(), 2, "one active plus achieved closed track");
    eq(await page.locator('[data-review-project="p3"] [data-twy-track-id="milestone"]').count(), 1, "milestone uses existing readonly renderer");
    ok(!(await page.locator('.twy-review-results').innerText()).includes("終了済み"));
    ok(!(await page.locator('.twy-review-results').innerText()).includes("削除済み"));
    eq(await page.locator('[data-review-track="done"] input').count(), 0);
    ok((await page.locator('[data-review-track="done"]').innerText()).includes(`✓ 達成(${today})`));
    await page.locator('.twy-review-notes summary').click();
    for (const width of [1280, 390]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".twy-tower");
      const metrics = await page.locator("[data-review-week]").evaluate(root => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        targets: [...root.querySelectorAll("button,summary")].filter(el => el.getClientRects().length)
          .map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        inputs: [...root.querySelectorAll("input,select,textarea")].map(el => ({ font: parseFloat(getComputedStyle(el).fontSize), width: el.getBoundingClientRect().width }))
      }));
      eq(metrics.overflow, false, `${width}: no horizontal overflow`);
      eq(metrics.targets.length, 14, `${width}: finish, 4 recording actions, 3 visible editors, 3 additions, 3 summaries`);
      ok(metrics.targets.every(m => m.width >= 44 && m.height >= 44), JSON.stringify(metrics.targets));
      eq(metrics.inputs.length, 8, "two number fields and two note fields per goal");
      ok(metrics.inputs.every(m => m.font >= 16 && m.width >= 120), `${width}: ${JSON.stringify(metrics.inputs)}`);
      await page.screenshot({ path: path.join(evidence, `review-${width}.png`), fullPage: true });
    }
    const snapshot = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import("/src/state/store.js")).state)));
    const row = id => page.locator(`[data-review-track="${id}"]`);
    const initial = await snapshot();
    await row("num2").locator("input").fill("");
    await row("num2").locator('[data-action="twy-review-record"]').click();
    eq((await snapshot()).trackMeasurements, initial.trackMeasurements, "empty number never records zero");
    ok((await row("num2").innerText()).includes("数字を入れてください"));
    await row("weight").locator("input").fill("72.4");
    await row("done").locator("summary").click();
    await row("num2").locator("input").fill("4.5");
    await row("num2").locator('[data-action="twy-review-record"]').click();
    eq(await row("weight").locator("input").inputValue(), "72.4", "other row draft survives recording");
    eq(await row("done").getAttribute("open"), "", "fold state survives recording");
    eq(await page.locator(".twy-review-notes").getAttribute("open"), "");
    ok((await row("num2").locator("[data-review-message]").innerText()).includes(today));
    const recorded = await snapshot();
    eq(recorded.trackMeasurements.length, initial.trackMeasurements.length + 1);
    eq(recorded.trackMeasurements.at(-1).trackId, "num2");
    eq(recorded.trackMeasurements.at(-1).value, 4.5);
    eq(recorded.trackMeasurements.at(-1).sourceKind, "twy-review");
    ok((await row("num2").innerText()).includes("復習 · いま 4.5 / 目標 10 回"));
    eq(recorded.tracks, initial.tracks, "recording preserves definitions");
    eq(recorded.twyWeeklyReviews, initial.twyWeeklyReviews, "recording does not finish the review");
    await row("num2").locator('[data-action="twy-review-same"]').click();
    const same = await snapshot();
    eq(same.twyWeeklyReviews[0], { ...savedReview, reviewedAt: `${today}T10:00:00`, updatedAt: `${today}T10:00:00` });
    for (const key of ["tracks", "trackMeasurements", "weeklyCommitments", "projects", "tasks", "blocks"]) eq(same[key], recorded[key], `same preserves ${key}`);
    const well = page.locator('[data-review-field="wentWell"][data-id="p1"]');
    const obstacles = page.locator('[data-review-field="obstacles"][data-id="p1"]');
    await well.fill("朝に3回できた <継続>");
    await obstacles.click();
    await obstacles.fill("雨で移動が大変");
    await well.click();
    eq(await well.inputValue(), "朝に3回できた <継続>", "change saves without replacing the focused form");
    eq((await snapshot()).twyWeeklyReviews[0].wentWell, "朝に3回できた <継続>");
    eq((await snapshot()).twyWeeklyReviews[0].obstacles, "雨で移動が大変");
    await nav(page, "twelveweek");
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    await page.locator('.twy-review-notes summary').click();
    eq(await well.inputValue(), "朝に3回できた <継続>");
    eq(await obstacles.inputValue(), "雨で移動が大変");
    await row("weight").locator("input").fill("72");
    await row("weight").locator('[data-action="twy-review-record"]').click();
    eq(await row("weight").locator("input").inputValue(), "72", "record only patches its row");
    await nav(page, "twelveweek");
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    eq(await row("weight").locator("input").count(), 0, "decreasing goal is achieved on next render");
    ok((await row("weight").innerText()).includes(`✓ 達成(${today})`));
    await row("milestone").locator('[data-action="twy-review-edit"]').click();
    eq(await page.locator('[data-modal-field="twyName"]').inputValue(), "提出", "milestone opens existing editor");
    await page.locator('[data-action="modal-save"]').click();
    await row("num2").locator('[data-action="twy-review-edit"]').click();
    eq(await page.locator('[data-modal-field="twyName"]').inputValue(), "復習");
    await page.locator('[data-modal-field="twyName"]').fill("復習の回数");
    await page.locator('[data-action="modal-save"]').click();
    eq((await snapshot()).tracks.find(t => t.id === "num2").name, "復習の回数");
    await page.locator('[data-review-project="p2"] [data-action="twy-review-add"]').click();
    eq(await page.locator('[data-modal-field="twyName"]').inputValue(), "体重", "addition edits the one active track");
    for (const [field, value] of [["twyName", "次の物差し"], ["twyBaseline", "0"], ["twyGoal", "5"], ["twyUnit", "回"]])
      await page.locator(`[data-modal-field="${field}"]`).fill(value);
    page.once("dialog", dialog => dialog.accept());
    await page.locator('[data-action="modal-save"]').click();
    const added = await snapshot();
    const newTrack = added.tracks.find(t => t.name === "次の物差し");
    ok(newTrack && newTrack.id !== "weight" && newTrack.status === "active");
    eq(added.tracks.filter(t => !t.deleted && t.ownerId === "p2" && t.status === "active").length, 1);
    eq(added.tracks.find(t => t.id === "weight").closedReason, "superseded");
    eq(newTrack.supersedesTrackId, "weight");
    eq(added.trackMeasurements.slice(0, recorded.trackMeasurements.length), recorded.trackMeasurements, "switching preserves history");
    eq(await row("weight").evaluate(el => el.tagName), "DETAILS", "achieved superseded track remains folded");
    await row(newTrack.id).locator('[data-action="twy-review-edit"]').click();
    await page.locator('[data-action="twy-kind-none"]').click();
    page.once("dialog", dialog => dialog.accept());
    await page.locator('[data-action="modal-save"]').click();
    const archived = await snapshot();
    eq(archived.tracks.find(t => t.id === newTrack.id).closedReason, "manual");
    eq(archived.tracks.filter(t => !t.deleted && t.ownerId === "p2" && t.status === "active").length, 0);
    eq(archived.trackMeasurements, added.trackMeasurements, "archive preserves measurements");
    await page.locator('.twy-review-notes summary').click();
    const secondNote = page.locator('[data-review-field="wentWell"][data-id="p2"]');
    await secondNote.fill("歩けた");
    await well.click();
    eq((await snapshot()).twyWeeklyReviews.find(r => r.projectId === "p2").wentWell, "歩けた");
    eq(await well.inputValue(), "朝に3回できた <継続>", "goal notes remain independent");
    const before = await snapshot();
    await page.locator('[data-action="twy-review-finish"]').click();
    await page.waitForSelector('.twy-tower');
    const after = await snapshot();
    eq(after.twyWeeklyReviews[0], { ...savedReview, wentWell: "朝に3回できた <継続>", obstacles: "雨で移動が大変", reviewedAt: `${today}T10:00:00`, updatedAt: "2026-09-05T10:00:00" });
    for (const key of ["tracks", "trackMeasurements", "weeklyCommitments", "projects", "tasks", "blocks"])
      eq(after[key], before[key], `finish preserves ${key}`);
    await page.waitForFunction(({ key, today }) => JSON.parse(localStorage.getItem(key)).twyWeeklyReviews[0].reviewedAt === `${today}T10:00:00`,
      { key: STATE_KEY, today });
    await page.reload();
    await page.waitForSelector('.twy-tower');
    eq(await page.locator(".twy-cycle-fold").getAttribute("open"), null);
    await page.locator(".twy-cycle-fold > summary").click();
    ok(await page.locator(".twy-vision-panel").isVisible(), "old cycle remains reachable inside plan");
    await nav(page, "twelveweek");
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    ok((await page.locator(".twy-review-finish").innerText()).includes("✓ ふりかえり済み"));
    eq(await well.inputValue(), "朝に3回できた <継続>", "prose survives reload");
    eq(await obstacles.inputValue(), "雨で移動が大変", "obstacles survive reload");
    for (const width of [1280, 390]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, ".twy-tower");
      await page.screenshot({ path: path.join(evidence, `review-after-${width}.png`), fullPage: true });
    }
    await page.evaluate(async () => {
      (await import("/src/state/store.js")).state.trackMeasurements.find(m => m.id === "done-measurement").observedAt = "2026-09-04T09:00:00";
    });
    await nav(page, "twelveweek");
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    eq(await row("done").evaluate(el => el.tagName), "DETAILS", "achievements from the previous week fold");
    eq(await row("done").getAttribute("open"), null);
    ok((await row("done").locator("summary").innerText()).includes("✓ 達成(2026-09-04)"));
    eq(await row("done").locator("input").count(), 0);
    await page.clock.setFixedTime(new Date(2026, 8, 11, 23, 59));
    await nav(page, "twelveweek");
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    eq(await page.locator('[data-review-week]').getAttribute('data-review-week'), week);
    await page.clock.setFixedTime(new Date(2026, 8, 12, 0, 1));
    // 日跨ぎ再描画(A3-H2)が入力の途中で走らないよう、時計を進めた直後に分 tick を先に消化してから操作する(独立検証 67 med 1)
    await page.clock.runFor(61_000);
    await page.locator('[data-review-week]').waitFor({ state: "attached" });
    if (!await page.locator(".twy-review-fold").evaluate(el => el.open)) await page.locator(".twy-review-fold > summary").click();
    // 再描画後に画面が示している週(土曜 0 時を越えたので次の週の「先週」)を読み、操作はその週へ保存されることを確かめる(裁定 R2-3: 操作時の today ではなく表示中の週)
    const shownWeek = await page.locator('[data-review-week]').getAttribute('data-review-week');
    await row("num2").locator('[data-action="twy-review-same"]').click();
    await page.locator('.twy-review-notes summary').click();
    await well.fill("週をまたいだメモ");
    await obstacles.click();
    await page.locator('[data-action="twy-review-finish"]').click();
    const rollover = await snapshot();
    eq(rollover.twyWeeklyReviews.find(r => r.projectId === "p1" && r.weekStart === shownWeek).wentWell, "週をまたいだメモ", "note saved to the displayed week");
    eq(rollover.twyWeeklyReviews.filter(r => r.weekStart !== week && r.weekStart !== shownWeek).length, 0, "same/note/finish never write to a week other than the displayed one");
    await page.clock.setFixedTime(new Date(2026, 8, 7, 10));
    await page.reload();
    await page.waitForSelector('.twy-tower');
    eq(await page.locator(".twy-review-fold").getAttribute("open"), null);
    eq(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  await nodeChecks();
  await browserChecks();
  console.log(`PASS twy-review-face: ${assertions} assertions (Orders 53/54, R2b a-e)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
