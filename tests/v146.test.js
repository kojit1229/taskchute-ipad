// v146 検証: UI改善計画Phase1(毎日の摩擦を消す)。CHANGES_v146.md参照。
// 入力: workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md(承認済み計画)。
//
// (1) ホーム折りたたみ既定値: 信条/寿命/AIからは既定closed(参照系)、今日のリズム(zone2、
//     非縮退時)は既定open。長い弧(zone3)/足あと(zone4)は既定closedのまま(既存仕様維持)
// (2) ホームの並び順: いま、これ→今日の主役(MIT)→今日、すすめる→今日のリズム→
//     参照系(信条/寿命/AIから/スコアボード)→長い弧→足あと
// (3) ホームは着手中(無ければ次の未着手)Blockへレンダー後自動スクロールする。
//     検索入力にフォーカス中は発火しない
// (4) タスクシュートも同様に自動スクロールする
// (5) 🏁(タスク完了)はタスクシュート行から撤去され、Block編集モーダルへ移設されている
//     (詳細な状態遷移の回帰はtests/v107.test.jsが担当。本ファイルは配置のみ確認)
// (6) 誤タップ対策の44px当たり判定: .checkbox-button / .tl-start-btn / .modal-close
// (7) バッファ残量帯は「今日を扱う」画面(home/tasks/timeline/journal/reports)だけに出る
// (8) ジャーナルは720px以下で当日編集パネルが先頭(CSS order)。前日パネルは既定closedのdetails
// (9) 設定画面から内部バージョン表記(vNNN)が消え、「現在のファイル構成」はdetails化(既定closed)
// (10) バッテリー回復下書き(v145、source:"battery-recovery")の下書きバーラベルが
//      「🔋 回復候補」になる(旧「⚙ 決定論配置」から変更)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const FOLD_KEY = "taskchute-journal-home-fold-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 30, taskId = "", category = "", completed = false }) {
    return {
      id, taskId, date: TODAY, title, category,
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "v146-proj", kind: "normal", title: "v146テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v146-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({ blocks = [], tasks = [], projects = [], view = "home", settings = {} } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      Object.assign(s.settings, settings);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function mainHTML() {
    return page.evaluate(() => document.querySelector("#main")?.innerHTML || "");
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) ホーム折りたたみ既定値
    // ============================================================
    console.log("[1] ホーム折りたたみ既定値: 信条/寿命/AIからは既定closed、今日のリズムは既定open");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({
      blocks: [planBlock({ id: "b-fold-1", title: "既定値確認Block", startMin: 9 * 60 })],
      view: "home"
    });
    check("信条(creed)は既定closed", await page.locator('details[data-fold-id="creed"]').evaluate((el) => el.open) === false);
    check("寿命(lifespan)は既定closed", await page.locator('details[data-fold-id="lifespan"]').evaluate((el) => el.open) === false);
    check("AIから(ai-hub)は既定closed", await page.locator('details[data-fold-id="ai-hub"]').evaluate((el) => el.open) === false);
    check("今日のリズム(zone2)は既定open", await page.locator('details[data-fold-id="zone2"]').evaluate((el) => el.open) === true);
    check("長い弧(zone3)は既定closedのまま(既存仕様維持)", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open) === false);
    check("今日の足あと(zone4)は既定closedのまま(既存仕様維持)", await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open) === false);
    check("スコアボードは既定closedのまま(既存仕様維持)", await page.locator('details[data-fold-id="home-scoreboard"]').evaluate((el) => el.open) === false);

    // ============================================================
    // (2) ホームの並び順
    // ============================================================
    console.log("[2] ホームの並び順: いま、これ→今日の主役→今日、すすめる→今日のリズム→参照系→長い弧→足あと");
    const html = await mainHTML();
    const idx = (marker) => html.indexOf(marker);
    const order = {
      hero: idx('class="panel home-hero'),
      mit: idx('id="home-mit-anchor"'),
      zone1: idx('id="homezone-1"'),
      zone2: idx('id="homezone-2"'),
      creed: idx('data-fold-id="creed"'),
      lifespan: idx('data-fold-id="lifespan"'),
      aiHub: idx('data-fold-id="ai-hub"'),
      scoreboard: idx('data-fold-id="home-scoreboard"'),
      zone3: idx('id="homezone-3"'),
      zone4: idx('id="homezone-4"')
    };
    check("すべてのマーカーが見つかる(-1が無い)", Object.values(order).every((v) => v >= 0), JSON.stringify(order));
    check("hero < mit", order.hero < order.mit, JSON.stringify(order));
    check("mit < zone1(今日、すすめる)", order.mit < order.zone1, JSON.stringify(order));
    check("zone1 < zone2(今日のリズム)", order.zone1 < order.zone2, JSON.stringify(order));
    check("zone2 < creed(参照系の先頭)", order.zone2 < order.creed, JSON.stringify(order));
    check("creed < lifespan < aiHub < scoreboard(参照系の並び)",
      order.creed < order.lifespan && order.lifespan < order.aiHub && order.aiHub < order.scoreboard, JSON.stringify(order));
    check("scoreboard < zone3 < zone4(参照系のあとに長い弧・足あと)",
      order.scoreboard < order.zone3 && order.zone3 < order.zone4, JSON.stringify(order));

    // ============================================================
    // (3) ホームの自動スクロール + 検索入力フォーカス中は非発火 + 同一view/dateでは再発火しない
    // ============================================================
    console.log("[3] ホームへのビュー切替(view変化)時に.home-heroへ自動スクロールする");
    await seed({
      blocks: [
        planBlock({ id: "b-scroll-home", title: "自動スクロール確認Block", startMin: 14 * 60 }),
        planBlock({ id: "b-scroll-home-2", title: "スクロール位置確認用デコイBlock", startMin: 16 * 60, completed: true })
      ],
      view: "wbs"
    });
    await page.evaluate(() => {
      window.__scrollCalls = [];
      const proto = Element.prototype;
      const orig = proto.scrollIntoView;
      proto.scrollIntoView = function (...args) {
        window.__scrollCalls.push({ tag: this.tagName, cls: this.className || "", id: this.id || "" });
        return orig.apply(this, args);
      };
    });
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    const scrollCallsHome = await page.evaluate(() => window.__scrollCalls || []);
    check("wbs→home(ビュー変化)で.home-heroへscrollIntoViewが呼ばれる",
      scrollCallsHome.some((c) => String(c.cls).includes("home-hero")), JSON.stringify(scrollCallsHome));

    console.log("[3b] 検索入力にフォーカス中は、ビュー変化があっても自動スクロールが発火しない");
    // wbsは日付バー(🔍検索ボタン)を持たないため、検索ボタンがある"tasks"を経由地点にする。
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="open-search"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector("#cross-search-input")?.focus());
    const activeBefore = await page.evaluate(() => document.activeElement?.id);
    check("検索入力にフォーカスしている", activeBefore === "cross-search-input", activeBefore);
    await page.evaluate(() => { window.__scrollCalls = []; });
    // プログラム的click(要素.click())はmousedown由来のフォーカス移動を起こさないため、
    // フォーカスを維持したままtasks→home(ビュー変化)を発火できる(実ユーザークリックの
    // Playwright .click()は対象ボタンへフォーカスが移り検証にならないため使わない)。
    await page.evaluate(() => document.querySelector('[data-action="nav"][data-view="home"]')?.click());
    await page.waitForTimeout(200);
    const activeAfter = await page.evaluate(() => document.activeElement?.id);
    const scrollCallsFocused = await page.evaluate(() => window.__scrollCalls || []);
    check("検索入力へのフォーカスは維持される(プログラム的clickのため)", activeAfter === "cross-search-input", activeAfter);
    check("検索入力フォーカス中は、tasks→home(ビュー変化)でも.home-heroへのスクロールが発火しない",
