// v147 検証: UI改善計画Phase2(数字と警告の信頼回復)。CHANGES_v147.md参照。
// 入力: workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md(承認済み計画)。
//
// (1) ホーム「今日のタスクシュート」見出しに「(Project紐づき)」が付き、「X/Yブロック」の
//     Yは実際に一覧表示されるProject紐づきBlock数と一致する(母数をヒートマップ等と同じ
//     「当日の全Block」へ統一すると一覧件数とズレて別の混乱を生むため、見出しで明示する
//     代替案を採った。taskchute-notes/decisions.md 2026-07-27参照)
// (2) 12週サイクル残り日数の基準日をtodayISO()へ統一(ホーム/週次で一致。selectedDateを
//     動かしても値が変わらない)
// (3) 「今日の状態」1枚化: 宣言・体力予算・電池残量・週Wishの4つとも良好なら非表示。
//     いずれか要対応なら1〜2行summary+detailsに内訳(体力予算チップ/電池チップ/
//     宣言未入力/週Wish未設定)が揃う。過去日は体力予算チップの単独表示のみ(既存仕様維持)
// (4) orange/green/tealの文字色AAトークン(--orange-text等)が定義され4.5:1以上を満たす。
//     「充/放」「着手中/未着手」ラベルが10px→11.5pxになる
// (5) Block編集モーダル: レバレッジ3問クイズが既定closedで、判定済み(leverageType設定済み)
//     ならsummaryに判定結果が出る。フッタの削除ボタンがmargin-right:autoで左端に分離される
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const TODAY = "2026-07-27";
const YESTERDAY = "2026-07-26";

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
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

  // app.js の weekRange() (土曜起点)をテスト側でも再現し、期待する週キーを算出する(v121と同じ手法)
  function weekStartOf(dateISO) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = (dt.getDay() + 1) % 7; // Sat=0
    dt.setDate(dt.getDate() - dow);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  const WEEK_KEY = weekStartOf(TODAY);

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
    id: "v147-proj", kind: "normal", title: "v147テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v147-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({
    blocks = [], tasks = [], projects = [], view = "home", settings = {},
    dailyDeclarations = undefined, weeklyWishes = undefined
  } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings, dailyDeclarations, weeklyWishes }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      Object.assign(s.settings, settings);
      if (dailyDeclarations !== undefined) s.dailyDeclarations = dailyDeclarations;
      if (weeklyWishes !== undefined) s.weeklyWishes = weeklyWishes;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings, dailyDeclarations, weeklyWishes });
    await page.reload();
    await page.waitForTimeout(400);
  }

  try {
    // 06:00固定(既定decayStartMinutes=07:00より前 → 電池残量は満タン=100%でbatteryOKが安定する)
    await page.clock.setFixedTime(new Date(2026, 6, 27, 6, 0, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) 今日のタスクシュート見出し+分母(Project紐づき維持)
    // ============================================================
    console.log("[1] 「今日のタスクシュート」見出しに(Project紐づき)が付き、分母は一覧件数と一致する");
    await seed({
      blocks: [
        planBlock({ id: "b-linked", title: "Project紐づきBlock", startMin: 9 * 60, taskId: "v147-task" }),
        planBlock({ id: "b-routine", title: "ルーティンBlock(母数から除外されるはず)", startMin: 7 * 60, category: "ルーティン" })
      ],
      tasks: [testTask("v147-task", "v147テストタスク")],
      projects: [testProject()],
      view: "home"
    });
    const tcHeadingEl = page.locator(".home-plabel.orange", { hasText: "今日のタスクシュート" }).first();
    const tcHeadingText = await tcHeadingEl.textContent();
    check("見出しに(Project紐づき)が付く", tcHeadingText.includes("(Project紐づき)"), tcHeadingText);
    const tcSection = tcHeadingEl.locator("xpath=ancestor::section[1]");
    const fracText = await tcSection.locator(".home-rate-frac").textContent();
    check("分母(Y)は一覧表示件数(1件)と一致する(全Blockの2件ではない)", fracText.includes("/ 1 ブロック"), fracText);
    const rowCount = await tcSection.locator(".home-tc").count();
    check("一覧行数も1件(ルーティンBlockは対象外)", rowCount === 1, String(rowCount));

    // ============================================================
    // (2) 12週サイクル残り日数: 基準日をtodayISO()へ統一
    // ============================================================
    console.log("[2] 12週サイクル Week N + 残り日数: ホーム/週次で一致し、selectedDateを動かしても不変");
    await seed({ settings: { twelveWeekStartDate: "2026-07-13" }, view: "home" });
    const daysLeftBefore = await page.locator(".home-wk-days").first().textContent();
    const weekNBefore = await page.locator(".home-wk strong").first().textContent();
    await page.click('[data-action="date-next"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="date-next"]');
    await page.waitForTimeout(150);
    const daysLeftAfterNav = await page.locator(".home-wk-days").first().textContent();
    const weekNAfterNav = await page.locator(".home-wk strong").first().textContent();
    check("selectedDateを2日進めても残り日数は変わらない(todayISO基準)",
      daysLeftBefore === daysLeftAfterNav, `${daysLeftBefore} vs ${daysLeftAfterNav}`);
    // v147レビュー対応: Week N(旧: selectedDate基準)も残り日数と同じtodayISO()基準に統一した。
    // 統一しないと、同じウィジェット内で「Week N」だけ動き「残りX日」は動かないという
    // 新たな不整合を生むため、Week Nもここで不変であることを確認する。
    check("selectedDateを2日進めてもWeek Nも変わらない(todayISO基準に統一)",
      weekNBefore === weekNAfterNav, `${weekNBefore} vs ${weekNAfterNav}`);
    await page.click('[data-action="today"]');
    await page.waitForTimeout(150);

    await page.click('[data-action="nav"][data-view="weekly"]');
    await page.waitForTimeout(250);
    const weeklyText = await page.locator(".weekly-12wy").first().textContent();
    const weeklyWeekNText = await page.locator(".weekly-12wy b").first().textContent();
    const homeNum = (daysLeftBefore.match(/残り\s*(\d+)\s*日/) || [])[1];
    const weeklyNum = (weeklyText.match(/残り\s*(\d+)\s*日/) || [])[1];
    check("ホームと週次の残り日数が同じ値になる(基準日統一)",
      !!homeNum && homeNum === weeklyNum, `home=${daysLeftBefore} weekly=${weeklyText}`);
    check("ホームと週次のWeek Nが同じ値になる(基準日統一。同一ウィジェット内の整合も兼ねる)",
      !!weekNBefore && weekNBefore === weeklyWeekNText, `home=${weekNBefore} weekly=${weeklyWeekNText}`);

    // ============================================================
    // (3) 「今日の状態」1枚化
    // ============================================================
    console.log("[3a] 4つ(宣言/体力予算/電池/週Wish)とも良好なら「今日の状態」カードは非表示");
    await seed({
      dailyDeclarations: { [TODAY]: { text: "今日はv147の検証をする", updatedAt: `${TODAY}T06:00:00` } },
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["dummy-wish-task"], updatedAt: `${TODAY}T06:00:00` } },
      view: "home"
    });
    check("4つとも良好なら.home-today-statusが出ない", await page.locator(".home-today-status").count() === 0);

    console.log("[3b] 何も揃っていなければ表示され、summaryに1〜2行の要約+detailsに内訳が揃う");
    await seed({ view: "home", dailyDeclarations: {}, weeklyWishes: {} });
    const statusCard = page.locator(".home-today-status");
    check(".home-today-statusが表示される", await statusCard.count() === 1);
    const summaryText = await statusCard.locator("summary").first().textContent();
    check("summaryに「エネルギー」表記が出る", summaryText.includes("エネルギー"), summaryText);
    check("summaryに「準備」表記が出る", summaryText.includes("準備"), summaryText);
    check("summaryに「宣言未入力」が出る", summaryText.includes("宣言未入力"), summaryText);
    check("summaryに「週Wish未設定」が出る", summaryText.includes("週Wish未設定"), summaryText);
    // detailsは既定closed(bodyHTMLはtextContentなら未展開でも読める)
    check("details要素は既定closed", await statusCard.evaluate((el) => el.open) === false);
    const bodyText = await statusCard.textContent();
    check("details内に体力予算チップが含まれる(未展開でもtextContentで読める)",
      bodyText.includes("体力予算"), bodyText);
    check("details内に電池残量チップが含まれる", bodyText.includes("残量"), bodyText);
