// 12週計画の今週面: タスクの採点・予定と表示・レスポンシブ・state保存なしを検証。
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, randomPort, STATE_KEY, fixedClock,
  blockGithubApiByDefault, passGithubGate, setViewportAndWaitForStableLayout } = require("./helpers");
const PORT = randomPort(), CYCLE_START = "2026-07-11", WEEK = "2026-07-25", TODAY = "2026-07-31";
const stamp = "2026-07-25T08:00:00";
const project = (id) => ({ id, title: `プロジェクト${id}`, kind: "normal", status: "active", deleted: false,
  twelveWeekStartDate: CYCLE_START, createdAt: stamp, updatedAt: stamp });
const task = (id, projectId, perWeek) => ({ id, projectId, title: `タスク${id}`, kind: "normal", status: "todo",
  deleted: false, selfDueOff: true, progressNum: 0, progressDen: 10, createdAt: stamp, updatedAt: stamp,
  twyPlan: { perWeek, fromWeek: 1, toWeek: 12, keystone: id === "t1" } });
const item = (id, taskId, projectId, plannedDate, extra = {}) => ({ id, blockId: id, taskId, projectId,
  title: `タスク${taskId}`, recordType: "item", weekStart: WEEK, lane: "cycle", source: "auto",
  plannedDate, completedAt: "", excused: false, deleted: false, createdAt: stamp, updatedAt: stamp, ...extra });
const meta = { id: `wcw_${WEEK}`, recordType: "week", weekStart: WEEK, committedVia: "auto",
  committedAt: stamp, cycleStartDate: CYCLE_START, selectedBlockIds: [], deleted: false, createdAt: stamp, updatedAt: stamp };
const records = [meta,
  ...["2026-07-25", "2026-07-26", "2026-07-27", "2026-07-30"].map((date, i) =>
    item(`done${i}`, "t1", "p1", date, { completedAt: `${date}T08:00:00` })),
  item("late", "t2", "p2", TODAY), item("early", "t1", "p1", TODAY),
  item("missed", "t3", "p2", "2026-07-28"), item("excused", "t3", "p2", "2026-07-27", { excused: true }),
  // 検証34 med: 同じ日に「免n 落n」が並ぶマスで小文字行がはみ出さないことを見る(火=落1+免1)。
  item("excused2", "t3", "p2", "2026-07-28", { excused: true })];
const blocks = [
  { id: "late", taskId: "t2", title: "タスクt2", date: TODAY, plannedStartAt: `${TODAY}T21:00`, estimateMin: 60 },
  { id: "early", taskId: "t1", title: "タスクt1", date: TODAY, plannedStartAt: `${TODAY}T07:00`, estimateMin: 25 }
].map((block) => ({ ...block, completed: false, deleted: false, createdAt: stamp, updatedAt: stamp }));
const fixture = { currentView: "twelveweek", selectedDate: TODAY,
  settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 }, projects: [project("p1"), project("p2")],
  tasks: [task("t1", "p1", 5), task("t2", "p2", 1), task("t3", "p2", 2)],
  tracks: [], blocks, weeklyCommitments: records };

async function seed(page, values) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(({ key, values }) => {
      const current = JSON.parse(localStorage.getItem(key)), { settings, ...rest } = values;
      Object.assign(current, rest);
      if (settings) Object.assign(current.settings, settings);
      localStorage.setItem(key, JSON.stringify(current));
    }, { key: STATE_KEY, values });
    await page.reload();
    await page.waitForSelector('.twy-face-segmented', { state: "attached" });
    if (await page.evaluate(async ({ key, values }) => {
      const stored = JSON.parse(localStorage.getItem(key)), live = (await import("/src/state/store.js")).state;
      return [stored, live].every((current) => Object.entries(values).every(([key, value]) => {
        if (key === "settings") return Object.entries(value).every(([k, v]) => current.settings[k] === v);
        if (Array.isArray(value)) return current[key].length === value.length && value.every((x) => current[key].some((y) => y.id === x.id));
        return current[key] === value;
      }));
    }, { key: STATE_KEY, values })) return;
  }
  const actual = await page.evaluate(async ({ key, values }) => {
    const stored = JSON.parse(localStorage.getItem(key)), live = (await import("/src/state/store.js")).state;
    return [stored, live].map((current) => Object.fromEntries(Object.keys(values).map((key) => [key,
      Array.isArray(current[key]) ? current[key].map((x) => x.id) : key === "settings"
        ? Object.fromEntries(Object.keys(values.settings).map((k) => [k, current.settings[k]])) : current[key]])));
  }, { key: STATE_KEY, values });
  throw new Error(`fixtureの投入が3回試行しても一致しない: ${JSON.stringify(actual)}`);
}
async function openWeek(page) {
  const chip = page.locator('[data-action="twy-face-select"][data-face="week"]');
  assert.equal(await chip.isEnabled(), true);
  await chip.click();
  await page.waitForSelector('.twy-tower[data-twy-face="week"]');
}
async function snapshot(page) {
  return page.evaluate(async () => JSON.stringify((await import("/src/state/store.js")).state));
}

(async () => {
  const server = startServer(PORT), browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 1000 }, timezoneId: "Asia/Tokyo" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__setItemChanges = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this.getItem(key) !== value) window.__setItemChanges.push(key);
        return original.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(fixedClock("2026-07-31T10:00:00+09:00")());
    await blockGithubApiByDefault(page);
    await page.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"), (route) => {
      const content = Buffer.from(JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", projects: [], tasks: [], settings: {} }), "utf8").toString("base64");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "r3-mock", content, encoding: "base64" }) });
    });
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    // normalizeStateが必須補完するWish/その他を保持。採点fixtureは2プロジェクト・3タスク。
    const system = await page.evaluate((key) => {
      const current = JSON.parse(localStorage.getItem(key));
      return { projects: current.projects.filter((p) => ["wish", "other"].includes(p.kind) && !p.deleted),
        tasks: current.tasks.filter((t) => t.kind === "other" && !t.deleted) };
    }, STATE_KEY);
    assert.equal(system.projects.length, 2);
    assert.equal(system.tasks.length, 1);
    fixture.projects.push(...system.projects);
    fixture.tasks.push(...system.tasks);
    await seed(page, fixture);
    const before = await snapshot(page);
    await page.evaluate(() => { window.__setItemChanges = []; });
    await openWeek(page);
    assert.equal(await page.locator('[data-action="twy-face-select"][data-face="week"]').innerText(), "今日やる\n毎日");
    assert.equal(await page.locator('.twy-face-segmented button:disabled').count(), 0);
    assert.equal(await page.locator('.twy-face-segmented [data-face="review"]').innerText(), "ふりかえる\n土曜の朝");
    assert.equal(await page.locator('.twy-week-score-big').innerText(), "57%");
    assert.equal(await page.locator('.twy-week-score-big').getAttribute("data-under"), "1");
    const scoreText = await page.locator('.twy-week-score').innerText();
    assert.match(scoreText, /今週決めたコマ 9\(免除 2 は数えない → 点数の対象 7\)/);
    assert.match(scoreText, /完了 4 · 今日の予定 2 · 落ちた 1 · 目標 85%/);
    assert.match(scoreText, /確定済み 2026-07-25 08:00/);
    assert.equal(await page.locator('.twy-week-score [data-action="twy-open-commit"]').count(), 1);
    assert.equal(await page.locator('.twy-week-strip > span').count(), 7);
    assert.match(await page.locator('.twy-week-strip [data-today="1"]').innerText(), /金\s*今日\s*0\/2/);
    assert.match(await page.locator('.twy-week-strip [data-missed="1"]').innerText(), /火\s*0\/1 免1 落1/);
    assert.equal(await page.locator('.twy-week-strip').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 7);
    assert.deepEqual(await page.locator('.twy-week-outlook p').allTextContents(), [
      "今日の2コマを終えると 86%", "目標85%には今日 あと2コマ でとどく", "落ちた1コマを取り戻せば 100%"]);
    assert.deepEqual(await page.locator('.twy-week-today-row time').allTextContents(), ["07:00", "21:00"]);
    assert.deepEqual(await page.locator('.twy-today-list [data-action="now-start"]').evaluateAll((els) => els.map((el) => el.dataset.id)), ["early", "late"]);
    assert.deepEqual(await page.locator('.twy-today-list .twy-proj-tag').allTextContents(), ["プロジェクトp1", "プロジェクトp2"]);
    assert.equal(await page.locator('.twy-week-sum').innerText(), "合計 2コマ · 85分 · 完了 0");
    assert.equal(await page.locator('.twy-week-missed-row').count(), 1);
    assert.match(await page.locator('.twy-week-missed-row').innerText(), /火 07\/28 · 未実施/);
    assert.equal(await page.locator('.twy-week-missed [data-action="twy-open-commit"]').count(), 1);
    assert.equal(await page.locator('.twy-week-missed [data-action="nav"][data-view="wbs"]').count(), 1);
    assert.match(await page.locator('.twy-week-score > :last-child').innerText(), /緑=済み.*琥珀=今日.*赤枠=落ちた.*取り消し線=免除.*枠だけ=予定.*★=要となる行動/s);
    assert.equal(await page.locator('.twy-week-theme').count(), 2);
    assert.deepEqual(await page.locator('.twy-week-theme-score').allTextContents(), ["80% (4/5)", "0% (0/2)"]);
    const t1 = page.locator('.twy-week-task[data-task-id="t1"]');
    const t2 = page.locator('.twy-week-task[data-task-id="t2"]');
    const t3 = page.locator('.twy-week-task[data-task-id="t3"]');
    assert.match(await t1.innerText(), /★ タスクt1/);
    assert.match(await t2.innerText(), /目安 1 · 今週決めた 1 · 完了 0/);
    assert.match(await t3.innerText(), /目安 2 · 今週決めた 3 · 完了 0/);
    assert.equal(await t3.locator('.twy-week-short').count(), 0);
    for (const [row, states] of [[t1, ["done", "done", "done", "done", "today"]],
      [t2, ["today"]], [t3, ["excused", "missed", "excused"]]]) {
      assert.deepEqual(await row.locator('.twy-day-chip').evaluateAll((els) => els.map((el) => el.dataset.state)), states);
    }
    assert.equal(await t1.locator('.twy-day-chip[data-state="today"] small').innerText(), "07:00");
    assert.equal(await t2.locator('.twy-day-chip small').innerText(), "21:00");
    assert.equal(await page.locator('.twy-week-cols .twy-goal-no-track').count(), 2);
    for (const width of [390, 1280]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 1000 }, '.twy-tower > *');
      const m = await page.locator('.twy-tower').evaluate((root) => ({
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        boxes: [...root.children].map((el) => el.getBoundingClientRect().toJSON()) }));
      const cols = await page.locator('.twy-week-cols').evaluateAll((els) => els.map((el) =>
        [...el.children].map((child) => child.getBoundingClientRect().y)));
      for (const [left, right] of cols) assert.equal(left === right, width === 1280, `${width}: テーマ左右の配置`);
      assert.ok(m.scrollWidth <= m.clientWidth + 1, `${width}: ページ横スクロールなし`);
      if (width === 390) {
        const cells = await page.locator('.twy-week-strip > span').evaluateAll((els) => els.map((el) => {
          const range = document.createRange();
          // 「今日」の札(absolute)は行の高さに数えない: 先頭の文字だけを測る
          range.selectNodeContents(el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : el);
          return { height: el.getBoundingClientRect().height, contentHeight: range.getBoundingClientRect().height,
            scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
            smallOverflow: (() => { const sm = el.querySelector("small"); return sm ? sm.scrollWidth - sm.clientWidth : 0; })() };
        }));
        assert.ok(cells.every((cell) => cell.height === cells[6].height), "390px: 今日マスと他マスは同じ高さ");
        assert.equal(cells[6].contentHeight, cells[0].contentHeight, "390px: 今日の文字が折れない");
        assert.ok(cells.every((cell) => cell.scrollWidth <= cell.clientWidth), "390px: 帯の文字がはみ出さない");
        assert.ok(cells.every((cell) => cell.smallOverflow <= 0), "390px: 小文字行(免n 落n)がマスをはみ出さない(検証34)");
      }
      for (let i = 0; i < m.boxes.length - 1; i++) assert.ok(m.boxes[i].bottom <= m.boxes[i + 1].top + 1, `${width}: 縦1列`);
    }
    await page.locator('.twy-face-segmented [data-face="plan"]').click();
    await page.locator(".twy-cycle-fold > summary").click();
    await openWeek(page);
    assert.equal(await snapshot(page), before, "面切替でstateを書き換えない");
    assert.equal(await page.evaluate((key) => window.__setItemChanges.filter((x) => x === key).length, STATE_KEY), 0);
    console.log("PASS W2 スコア・帯・見通し・今日・落ちた・レイアウト・非書込");

    await seed(page, { ...fixture, weeklyCommitments: [] });
    const uncommittedBefore = await snapshot(page);
    await page.evaluate(() => { window.__setItemChanges = []; });
    await openWeek(page);
    assert.match(await page.locator('.twy-week-score').innerText(), /今週はまだ確定していません · 候補 2コマ/);
    assert.equal(await page.locator('.twy-week-score [data-action="twy-open-commit"]').innerText(), "今週を確定する");
    assert.equal(await page.locator('.twy-week-score [data-action="twy-commit-week"]').count(), 0);
    assert.equal(await page.locator('.twy-week-score-big, .twy-week-outlook p, .twy-week-missed').count(), 0);
    assert.equal(await snapshot(page), uncommittedBefore);
    assert.equal(await page.evaluate((key) => window.__setItemChanges.filter((x) => x === key).length, STATE_KEY), 0);
    console.log("PASS 未確定週の候補一覧・確定導線・非書込");

    await seed(page, { ...fixture, weeklyCommitments: [...records, { ...meta, deleted: true, updatedAt: `${TODAY}T09:00:00` }] });
    await openWeek(page);
    assert.match(await page.locator('.twy-week-score').innerText(), /今週はまだ確定していません/);
    assert.equal(await page.locator('.twy-week-score-big, .twy-week-outlook p').count(), 0);
    console.log("PASS 同id週メタは最新の削除を優先");

    await seed(page, { ...fixture, weeklyCommitments: [meta, item("early", "t1", "p1", TODAY, { completedAt: `${TODAY}T08:00:00` })] });
    await openWeek(page);
    assert.equal(await page.locator('.twy-week-today-row .twy-week-done').innerText(), "済");
    assert.equal(await page.locator('.twy-today-list [data-action="now-start"], .twy-week-missed').count(), 0);
    assert.equal(await page.locator('.twy-week-score-big').getAttribute("data-under"), "0");
    assert.deepEqual(await page.locator('.twy-week-outlook p').allTextContents(), ["目標 85% に到達済み"]);
    await seed(page, { ...fixture, weeklyCommitments: [meta, item("early", "t1", "p1", TODAY, { excused: true })] });
    await openWeek(page);
    assert.equal(await page.locator('.twy-week-score-big').innerText(), "—");
    assert.equal(await page.locator('.twy-week-outlook p').count(), 0);
    assert.equal(await page.locator('.twy-today-list').innerText(), "今日の12週のコマはありません");
    await seed(page, { ...fixture, projects: system.projects, tasks: system.tasks, blocks: [], weeklyCommitments: [meta] });
    await openWeek(page);
    assert.equal(await page.locator('.twy-goal-empty').innerText(), "対象の12週のプロジェクトがありません");
    assert.equal(await page.locator('.twy-week-theme').count(), 0);
    await seed(page, { ...fixture, settings: { twelveWeekStartDate: "" } });
    await openWeek(page);
    assert.equal(await page.locator('.twy-tower .tower-panel-box').innerText(), "12週のサイクルが未設定です(設定 › サイクル開始日)");
    assert.deepEqual(errors, [], "pageerror 0");
    const source = fs.readFileSync(path.join(__dirname, '../src/features/twelve-week.js'), 'utf8');
    assert.ok(!/new Date\(/.test(source));
    console.log("PASS 完了・全件免除・サイクル未設定・pageerror 0");
    for (let n = 1; n <= 10; n++) await require("./twy-decide-face.test").runCardAcceptance(page, n);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
