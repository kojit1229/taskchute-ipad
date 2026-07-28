// v159 検証: AI機能第3弾「未来の自分からの手紙」(K発注仕様
// workbench/out/2026-07-27-taskchute-ai5/spec.md 機能3)。CHANGES_v159.md参照。
//
// [1] AIレポート画面の種類タブに「未来からの手紙」が追加され、選択すると
//     未来からの手紙_*.md の履歴一覧(月次=YYYY-MM形式)と本文が表示される(report-index.json経由)
// [2] 当月分の未来からの手紙_<当月>.mdが存在する日は、ホーム(内省側)タブの「AIから」近くに
//     導線(✉️ 未来からの手紙が届いています)が表示される
// [3] 当月分が存在しない日(404)は導線が表示されない(フェイルソフト)
// [4] 導線をタップするとAIレポート画面へ遷移し「未来からの手紙」タブが選択された状態になる
//     (kind判定〈AI_REPORT_TYPESのprefix〉の実質確認を兼ねる)
// [5] 公開Pages側(同一オリジン)への未来からの手紙_*.mdへのfetchは一切発生しない
//     (同一オリジンfetch回帰の防止、v157/v158と同じ観点)
//
// 方針: v138.test.js(AIレポートindex経由の一覧・本文)+ v157/v158.test.js
// (ホームカードの表示/非表示・同一オリジンfetch無し)と同じ作法。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const toUtcIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const freshGeneratedAt = () => toUtcIso(new Date());

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const MONTH = TODAY.slice(0, 7);
  const LETTER_NAME = `未来からの手紙_${MONTH}.md`;
  // v157/v158.test.jsと同じ流儀: 実際のバッチ生成物(private/personal-data)の逐語ではなく、
  // 完全に架空・テスト専用の本文にする(公開repoにprivate生成物の文面を置かない原則)。
  const LETTER_BODY = "配線検証用の架空の手紙本文_v159テスト。実際のバッチ生成物とは無関係。";

  // [5]用: 公開Pages側(同一オリジン)への未来からの手紙_*.mdへのリクエストを全て記録する
  const sameOriginRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) && /未来からの手紙_/.test(decodeURIComponent(url))) {
      sameOriginRequests.push(url);
    }
  });

  let letterFixture = null;       // null=404、文字列=当月分の本文
  let reportIndexFixture = null;  // null=404、オブジェクト=report-index.jsonの中身
  const letterApiRequests = [];
  const reportIndexRequests = [];
  const bodyRequests = [];
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);

    if (/\/contents\/taskchute\/report-index\.json$/.test(p)) {
      reportIndexRequests.push(p);
      if (reportIndexFixture === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportIndexFixture) });
    }

    const letterMatch = p.match(/\/contents\/taskchute\/未来からの手紙_(.+)\.md$/);
    if (letterMatch) {
      letterApiRequests.push(p);
      if (letterMatch[1] !== MONTH || letterFixture === null) {
        return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      }
      return route.fulfill({ status: 200, contentType: "text/markdown", body: letterFixture });
    }

    // その他(過去分の本文取得等): bodyRequestsに記録し、letterFixtureがあれば当月分だけ返す
    const anyMdMatch = p.match(/\/contents\/taskchute\/([^/]+\.md)$/);
    if (anyMdMatch) {
      bodyRequests.push(anyMdMatch[1]);
      if (anyMdMatch[1] === LETTER_NAME && letterFixture !== null) {
        return route.fulfill({ status: 200, contentType: "text/markdown", body: letterFixture });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  // v159の導線はホームの「ホーム(内省側)」タブ(homeTab==="home")にある。K指定「起動時は
  // 常に今日」により homeTab はセッション非永続でリロードのたび"today"へ戻るため
  // (renderHomeReflectTab/homeTabの定義参照)、毎回シードの直後に実際のタブ切替クリックで
  // 「ホーム」サブタブへ移動してから導線を確認する。
  async function seedHome({ selectedDate = TODAY } = {}) {
    await page.evaluate(({ KEY, selectedDate }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.selectedDate = selectedDate;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, selectedDate });
    await page.reload();
    await page.waitForTimeout(700);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
  }

  async function seedAiReports(typeId = "letter") {
    await page.evaluate(({ KEY, typeId }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = typeId;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, typeId });
    await page.reload();
    await page.waitForTimeout(600);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] AIレポート画面の種類タブに「未来からの手紙」が追加され、選択すると
    //     未来からの手紙_*.md の履歴一覧(月次=YYYY-MM)と本文が表示される
    // ============================================================
    console.log("[1] AIレポート画面の『未来からの手紙』タブでreport-index.json経由の履歴一覧・本文が表示される");
    reportIndexFixture = {
      generatedAt: freshGeneratedAt(),
      files: [
        { name: `未来からの手紙_${MONTH}.md`, date: MONTH, kind: "letter" },
        { name: "未来からの手紙_2026-01.md", date: "2026-01", kind: "letter" },
        { name: "コンテンツ総括_2026-07-14.md", date: "2026-07-14", kind: "content" }
      ]
    };
    letterFixture = LETTER_BODY;
    await seedAiReports("letter");

    const tabLabels = await page.$$eval(".segmented button", (els) => els.map((e) => e.textContent.trim()));
    check("種類タブに『未来からの手紙』が存在する", tabLabels.includes("未来からの手紙"), JSON.stringify(tabLabels));

    let options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
