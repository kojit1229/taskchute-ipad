// tests/instruments-e2e.test.js(先行執筆・結線前) — P4 新計器盤(INSTRUMENTS)のE2E契約。
// 正典: p4-interface.md §3(instruments.js界面凍結)、slim-spec.md §3(EARLY BIRD/IRON LOGサマリ仕様)。
// 前提(結線後の姿。p4-parallel/e2e/notes.mdに詳細): nav id "instruments" が allowedViews に
// 登録され、renderMain() が renderInstruments() を描画する。early-bird-check(既存v229実装済み)は
// state.earlyBird.logs を書くだけで instruments.js 側は関知しないため、GATEチェック後の
// 再描画でストリークへ反映されることを固定する。
//
// v233で画面結線後に適用し、ブラウザE2Eとして実行する。
// tower-core.test.js / helpers.js の書式・helpers利用・seed流儀をそのまま踏襲する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 700, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const fixedTime = (h = 12, m = 0, s = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, s, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  // offsetDays: 0=今日、-1=昨日、… 数値コンストラクタのみ使用(iOS Safari対策・文字列パース禁止)。
  const iso = (offsetDays) => isoOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays));
  const today = iso(0);
  const atMinute = (date, minute) => `${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00`;

  async function seed({ view = "instruments", earlyBirdLogs = {}, gym, reload = true } = {}) {
    await page.evaluate(({ KEY, view, earlyBirdLogs, gym, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = view;
      s.blocks = [];
      s.earlyBird = { logs: earlyBirdLogs };
      s.condition = s.condition || {};
      s.condition.logs = s.condition.logs || {};
      if (gym !== undefined) {
        s.condition.logs[today] = s.condition.logs[today] || {};
        s.condition.logs[today].gym = gym;
      }
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, view, earlyBirdLogs, gym, today });
    if (reload) {
      await page.reload();
      await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
    }
  }

  async function readState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  const checkedLog = (offsetDays) => ({ checkedAt: `${iso(offsetDays)}T06:00` });

  try {
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    console.log("[1] 当日未チェックはストリーク進行中扱いで前日以前を数える(凍結ストリーク定義)");
    const logsCase1 = {
      [iso(-1)]: checkedLog(-1), [iso(-2)]: checkedLog(-2), [iso(-3)]: checkedLog(-3), // 3連続(直近)
      [iso(-5)]: checkedLog(-5), [iso(-6)]: checkedLog(-6), // 2連続(過去、-4は欠損で切断)
      "2025-01-01": { checkedAt: "2025-01-01T06:00" }
    };
    await seed({ earlyBirdLogs: logsCase1 });
    check("ヘッダは計器盤/INSTRUMENTS", (await page.locator(".eyebrow").textContent()) === "計器盤"
      && (await page.locator(".view-header h1").textContent()) === "INSTRUMENTS");
    check("当日未チェックの現在ストリークは3(前日以前の連続)", (await page.locator(".instr-streak-hero strong").textContent()) === "3日連続");
    const stats1 = await page.locator(".instr-stat-cell strong").allTextContents();
    check("自己ベストは3・今年5・累計6", stats1[0] === "3日" && stats1[1] === "5回" && stats1[2] === "6回", JSON.stringify(stats1));

    console.log("[2] 当日チェック済みは当日を含めて連続日数を数える");
    const logsCase2 = { [today]: checkedLog(0), [iso(-1)]: checkedLog(-1), [iso(-2)]: checkedLog(-2) };
    await seed({ earlyBirdLogs: logsCase2 });
    check("当日込みで現在ストリーク3", (await page.locator(".instr-streak-hero strong").textContent()) === "3日連続");
    const stats2 = await page.locator(".instr-stat-cell strong").allTextContents();
    check("自己ベストも3(進行中ストリークが最長)", stats2[0] === "3日", stats2[0]);

    console.log("[3] 過去の最長ランが現在ストリークを上回れば自己ベストとして残る");
    const logsCase3 = {};
    for (let i = 5; i <= 9; i++) logsCase3[iso(-i)] = checkedLog(-i); // 5連続(-9〜-5)、直近は欠損
    logsCase3["2025-01-01"] = { checkedAt: "2025-01-01T06:00" };
    await seed({ earlyBirdLogs: logsCase3 });
    check("当日・前日とも未チェックで現在ストリーク0", (await page.locator(".instr-streak-hero strong").textContent()) === "0日連続");
    const stats3 = await page.locator(".instr-stat-cell strong").allTextContents();
    check("自己ベストは過去の5連続を維持", stats3[0] === "5日", stats3[0]);
    check("今年5回・累計6回", stats3[1] === "5回" && stats3[2] === "6回", JSON.stringify(stats3));

    console.log("[4] 直近28日ドットは達成日にis-checkedが付く");
    await seed({ earlyBirdLogs: logsCase1 });
    check("ドットは28個描画される", await page.locator(".instr-dot").count() === 28);
    for (const offset of [-1, -2, -3, -5, -6]) {
      check(`${iso(offset)}のドットはis-checked`, await page.locator(`.instr-dot[title="${iso(offset)}"]`).evaluate((el) => el.classList.contains("is-checked")));
    }
    check("当日(未チェック)のドットはis-checkedなし", await page.locator(`.instr-dot[title="${today}"]`).evaluate((el) => !el.classList.contains("is-checked")));
    check("欠損日(-4)のドットはis-checkedなし", await page.locator(`.instr-dot[title="${iso(-4)}"]`).evaluate((el) => !el.classList.contains("is-checked")));

    console.log("[5] 筋トレの記録は今週総重量・今年トン表記・週回数を表示する");
    const gymSets = [
      { exercise: "ベンチプレス", weight: 125, reps: 10, at: atMinute(today, 9 * 60) },
      { exercise: "ベンチプレス", weight: 125, reps: 10, at: atMinute(today, 9 * 60 + 10) }
    ]; // 2,500kg(既定目標2,000kg超過)
    await seed({ earlyBirdLogs: {}, gym: gymSets });
    check("当日総重量2,500kgを表示", ((await page.locator(".instr-iron-today strong").textContent()) || "").includes("2,500"));
    check("今年はトン表記(2.5t)", ((await page.locator(".instr-iron-stats .instr-stat-cell").nth(1).textContent()) || "").includes("2.5t"));
    check("目標バーを撤去", await page.locator(".instr-iron-bar,.instr-iron-goal").count() === 0);
    check("同日の2セットを今週1回として表示", ((await page.locator(".instr-iron-stats .instr-stat-cell").nth(2).textContent()) || "").includes("1回"));

    console.log("[6] ☀早起きゲートのチェック(既存v229実装)が翌描画でストリークに反映される");
    await seed({ view: "today", earlyBirdLogs: {} });
    await page.waitForSelector('.tower-gate-fixed[data-action="early-bird-check"]');
    await page.locator('.tower-gate-fixed[data-action="early-bird-check"]').click();
    await page.waitForFunction(({ KEY, today }) => Boolean(JSON.parse(localStorage.getItem(KEY)).earlyBird?.logs?.[today]), { KEY, today });
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "instruments";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForSelector('#app[data-view="instruments"]', { state: "attached" });
    check("GATEチェック直後の計器盤で現在ストリーク1", (await page.locator(".instr-streak-hero strong").textContent()) === "1日連続");
    check("当日ドットがis-checkedへ切り替わる", await page.locator(`.instr-dot[title="${today}"]`).evaluate((el) => el.classList.contains("is-checked")));

    console.log("[7] IRON LOGサマリ枠タップでinstruments-open-iron-log遷移する");
    await seed({ earlyBirdLogs: {}, gym: [] });
    await page.locator('[data-action="instruments-open-iron-log"]').first().click();
    await page.waitForSelector('#app[data-view="iron-log"]', { state: "attached" });
    check("遷移後はcurrentView=iron-log", (await readState()).currentView === "iron-log");
    check("IRON LOG画面のPAYLOADパネルが描画される", await page.locator(".iron-payload").count() === 1);

    console.log("[8] 「その他」ナビからiron-log/instrumentsへ到達できる(nav結線の存在確認)");
    await seed({ view: "more", earlyBirdLogs: {} });
    check("その他画面が開く", await page.locator('#app[data-view="more"]').count() === 1);
    await page.locator('.more-tower-grid [data-action="nav"][data-view="instruments"]').click();
    await page.waitForSelector('#app[data-view="instruments"]', { state: "attached" });
    check("その他 › 計器盤(instruments)へ遷移できる", await page.locator(".instr-early-bird").count() === 1);
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.waitForSelector('#app[data-view="more"]', { state: "attached" });
    await page.locator('.more-tower-grid [data-action="nav"][data-view="iron-log"]').click();
    await page.waitForSelector('#app[data-view="iron-log"]', { state: "attached" });
    check("その他 › IRON LOG(iron-log)へ遷移できる", await page.locator(".iron-payload").count() === 1);
    await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
    await page.waitForSelector('#app[data-view="more"]', { state: "attached" });
    check("IRON LOGからその他へ戻れる", await page.locator(".more-tower-grid").count() === 1);

    console.log("[9] 390px幅では画面全体をはみ出さず、グラフ内だけ横スクロールできる");
    await page.setViewportSize({ width: 390, height: 844 });
    await seed({ earlyBirdLogs: {}, gym: gymSets });
    const widths = await page.evaluate(() => {
      const chart = document.querySelector(".instr-chart-scroll");
      const inner = chart?.querySelector(".instr-chart");
      return {
        pageClient: document.documentElement.clientWidth,
        pageScroll: document.documentElement.scrollWidth,
        chartClient: chart?.clientWidth || 0,
        chartScroll: chart?.scrollWidth || 0,
        innerWidth: inner?.getBoundingClientRect().width || 0,
        innerMinWidth: inner ? getComputedStyle(inner).minWidth : ""
      };
    });
    check("画面全体に横スクロールなし", widths.pageScroll <= widths.pageClient, JSON.stringify(widths));
    check("棒グラフ内包コンテナは横スクロール可能", widths.chartScroll > widths.chartClient, JSON.stringify(widths));

    // v265: 幅依存の導線欠落の再発防止。720px超はボトムナビが消えサイドバーだけになるため、
    // サイドバー側にも「その他」入口が実在することをPC幅で固定する。
    console.log("[10] PC幅(1280px)ではサイドバー「その他」経由で計器盤へ到達できる");
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed({ view: "today", earlyBirdLogs: {} });
    check("PC幅でサイドバーの「その他」ボタンが見える", await page.locator('#sidebar [data-action="nav"][data-view="more"]').isVisible());
    check("PC幅でサイドバーのINSTRUMENTS直通ボタンも見える", await page.locator('#sidebar [data-action="nav"][data-view="instruments"]').isVisible());
    check("PC幅でボトムナビは非表示", !(await page.locator("#bottomNav").isVisible()));
    await page.locator('#sidebar [data-action="nav"][data-view="more"]').click();
    await page.waitForSelector('#app[data-view="more"]', { state: "attached" });
    check("サイドバー › その他グリッドが開く", await page.locator(".more-tower-grid").count() === 1);
    await page.locator('.more-tower-grid [data-action="nav"][data-view="instruments"]').click();
    await page.waitForSelector('#app[data-view="instruments"]', { state: "attached" });
    check("サイドバー › その他 › 計器盤へ到達できる", await page.locator(".instr-early-bird").count() === 1);
    check("計器盤表示中はサイドバー直通INSTRUMENTSがactive", await page.locator('#sidebar [data-view="instruments"].active').count() === 1);
    check("計器盤表示中に「設定」等がactiveにならない", await page.locator("#sidebar .nav-button.active").count() === 1);

    console.log(failures === 0 ? "[instruments-e2e] 全PASS" : `[instruments-e2e] ${failures}件失敗`);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
})();
