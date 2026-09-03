// v326: 計器盤A-1の4指標・事実表示・TOWER可読性を固定する。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
function addDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function logMap(dates, field = "checkedAt") {
  return Object.fromEntries(dates.map((date) => [date, { [field]: `${date}T06:00` }]));
}
function conditionLog(gym) {
  return { sleepHours: null, meds: null, capacity: "", morningRecordedAt: "",
    eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym };
}

(async () => {
  const earlyDates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05",
    ...Array.from({ length: 30 }, (_, i) => addDays("2026-01-10", i * 7)),
    "2026-08-10", "2026-08-20", "2026-08-25", "2026-09-02", "2026-09-03", TODAY,
    ...Array.from({ length: 172 }, (_, i) => addDays("2025-12-30", i * -2))];
  const habit1Dates = Array.from({ length: 12 }, (_, i) => addDays("2026-08-24", i));
  const fixture = {
    earlyBird: { logs: logMap(earlyDates) },
    recurrences: [
      { anchor: "", fallbackTitle: "", fallbackMinutes: null, protection: false,
        id: "habit-12", title: "0秒思考(朝)", kind: "daily", streakSince: "2026-08-24", deleted: false, order: 0 },
      { anchor: "", fallbackTitle: "", fallbackMinutes: null, protection: false,
        id: "habit-2", title: "書く瞑想(夜)", kind: "daily", streakSince: "2026-08-26", deleted: false, order: 1 },
      { anchor: "", fallbackTitle: "", fallbackMinutes: null, protection: false,
        id: "habit-today-open", title: "前日から継続中", kind: "daily", streakSince: "2026-09-03", deleted: false, order: 2 }
    ],
    habitStreaks: {
      "habit-12": { logs: logMap(habit1Dates, "doneAt") },
      "habit-2": { logs: logMap(["2026-08-26", "2026-08-27", "2026-09-03", TODAY], "doneAt") },
      "habit-today-open": { logs: logMap(["2026-09-03"], "doneAt") }
    },
    condition: { logs: {
      "2026-08-25": conditionLog([{ id: "old", exercise: "デッドリフト", weight: 100, reps: 5, at: "2026-08-25T18:00" }]),
      "2026-08-30": conditionLog([{ id: "sq", exercise: "スクワット", weight: 80, reps: 10, at: "2026-08-30T18:00" }]),
      "2026-09-02": conditionLog([{ id: "bp", exercise: "ベンチプレス", weight: 60, reps: 10, at: "2026-09-02T18:00" }])
    } }, habitPinHistory: {}
  };
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  const seed = async (data) => {
    const expected = await page.evaluate(({ key, today, data }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, data, { currentView: "instruments", selectedDate: today });
      localStorage.setItem(key, JSON.stringify(state));
      window.__v326StorageWrites = [];
      return localStorage.getItem(key);
    }, { key: STATE_KEY, today: TODAY, data });
    await page.reload();
    await page.waitForSelector(".instr-view");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return {
      expected,
      actual: await page.evaluate((key) => localStorage.getItem(key), STATE_KEY),
      changedWrites: await page.evaluate((key) => window.__v326StorageWrites
        .filter((item) => item.key === key && item.changed).length, STATE_KEY)
    };
  };
  try {
    await page.addInitScript(() => {
      window.__v326StorageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage) window.__v326StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
        return originalSetItem.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(new Date(2026, 8, 4, 12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const renderedState = await seed(fixture);

    const headings = await page.locator(".instr-panel-box > h2").evaluateAll((nodes) => nodes.map((node) => node.childNodes[0].textContent.trim()));
    check("日本語見出しを指定順で表示", JSON.stringify(headings.slice(0, 3)) === JSON.stringify(["継続の記録", "筋トレの記録", "月別の積み上げ"]), JSON.stringify(headings));
    check("旧英語コードネームを主見出しにしない", !headings.some((text) => /^(EARLY BIRD|HABIT|IRON LOG|ANNUAL PAYLOAD)$/.test(text)));
    check("旧目標バーCSSを撤去", !CSS.includes(".instr-iron-bar"));

    const earlyMetrics = await page.locator(".instr-early-bird .instr-metric strong").allTextContents();
    check("早起き4指標は3日・5日・今年41回・累計213回", JSON.stringify(earlyMetrics) === JSON.stringify(["3日連続", "5日", "41回", "213回"]), JSON.stringify(earlyMetrics));
    const dots = await page.locator(".instr-early-bird .instr-dot").evaluateAll((nodes) => nodes.map((node) => ({ checked: node.classList.contains("is-checked"), color: getComputedStyle(node).backgroundColor })));
    check("早起きストリップは28個・達成6個", dots.length === 28 && dots.filter((dot) => dot.checked).length === 6, JSON.stringify(dots));
    check("ストリップはアンバー/濃紺の2色だけ", new Set(dots.map((dot) => dot.color)).size === 2
      && dots.filter((dot) => dot.checked).every((dot) => dot.color === "rgb(242, 184, 75)")
      && dots.filter((dot) => !dot.checked).every((dot) => dot.color === "rgb(26, 42, 59)"), JSON.stringify([...new Set(dots.map((dot) => dot.color))]));

    const habitMetrics = await page.locator(".instr-habit-panel").evaluateAll((panels) => panels.map((panel) => ({
      name: panel.querySelector(".instr-record-label > strong").textContent,
      metrics: [...panel.querySelectorAll(".instr-metric strong")].map((node) => node.textContent)
    })));
    check("固定化3件の4指標に実施率を含む", JSON.stringify(habitMetrics) === JSON.stringify([
      { name: "0秒思考(朝)", metrics: ["12日連続", "12日", "12回", "100%"] },
      { name: "書く瞑想(夜)", metrics: ["2日連続", "2日", "4回", "40%"] },
      { name: "前日から継続中", metrics: ["1日連続", "1日", "1回", "100%"] }
    ]), JSON.stringify(habitMetrics));
    const currentFonts = await page.locator(".instr-habit-panel .instr-streak-hero strong").evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).fontSize));
    check("固定化3件の「いま」は同じ24px", currentFonts.length === 3
      && currentFonts.every((size) => size === "24px"), JSON.stringify(currentFonts));

    check("目標バー・達成色・週ストリークをDOMへ出さない", await page.locator(".instr-iron-bar,.instr-iron-goal,.instr-achieved,.instr-goal-hit").count() === 0
      && !(await page.locator(".instr-iron-log").textContent()).includes("週ストリーク"));
    check("筋トレは今週kg・今年t・回数と内訳・自己ベスト", (await page.locator(".instr-iron-log").textContent()).includes("1,400kg")
      && (await page.locator(".instr-iron-log").textContent()).includes("1.9t")
      && (await page.locator(".instr-iron-log").textContent()).includes("2回")
      && (await page.locator(".instr-iron-log").textContent()).includes("スクワット 800kg")
      && (await page.locator(".instr-iron-log").textContent()).includes("デッドリフト 100kg×5 (8/25)"));

    const typeAndHit = await page.evaluate(() => ({
      minFont: Math.min(...[...document.querySelectorAll(".instr-view *")].map((node) => parseFloat(getComputedStyle(node).fontSize))),
      openHeight: document.querySelector(".instr-open-btn").getBoundingClientRect().height
    }));
    check("計器盤内11px以上・遷移44px以上", typeAndHit.minFont >= 11 && typeAndHit.openHeight >= 44, JSON.stringify(typeAndHit));
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const size = await page.evaluate(() => {
        const root = document.querySelector(".instr-view");
        const rootStyle = getComputedStyle(root);
        const contentWidth = root.clientWidth - parseFloat(rootStyle.paddingLeft) - parseFloat(rootStyle.paddingRight);
        const panelWidths = [...root.querySelectorAll(":scope > .instr-continuation, :scope > .instr-iron-log, :scope > .instr-iron-chart")]
          .map((panel) => panel.getBoundingClientRect().width);
        return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, contentWidth, panelWidths };
      });
      check(`${width}pxで横スクロールなし`, size.scroll <= size.inner + 1, JSON.stringify(size));
      if (width >= 768) check(`${width}pxで履歴なしの各パネルは親の全幅`, size.panelWidths.length === 3
        && size.panelWidths.every((panelWidth) => Math.abs(panelWidth - size.contentWidth) <= 1), JSON.stringify(size));
    }
    const expectedState = JSON.parse(renderedState.expected);
    const actualState = JSON.parse(renderedState.actual);
    const changedKeys = [...new Set([...Object.keys(expectedState), ...Object.keys(actualState)])]
      .filter((key) => JSON.stringify(expectedState[key]) !== JSON.stringify(actualState[key]));
    check("fixture保存直後から描画・リフロー後までstate不変・内容変更setItem 0回・pageerror 0",
      renderedState.expected === renderedState.actual && renderedState.changedWrites === 0 && pageErrors.length === 0,
      JSON.stringify({ unchanged: renderedState.expected === renderedState.actual,
        changedWrites: renderedState.changedWrites, changedKeys, pageErrors }));

    await seed({ ...fixture, recurrences: [], habitStreaks: {} });
    check("固定化0件は指定の1行だけを表示", await page.locator(".instr-habit-panel").count() === 0
      && (await page.locator(".instr-empty-row").textContent()) === "固定化したルーティンはありません(ルーティンタブで固定化すると連続記録がここに出ます)");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(failures ? `\nv326: ${failures}件失敗` : "\nv326: 全件成功");
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
