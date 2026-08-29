// v75回帰 + v299 Test-Reduction:
// v75のpersonal-data API経路と「明日への提案」自動取り込みは維持する。
// v299で削除したAIプランの0秒思考テーマUIは、実行シナリオではなくソース不存在を固定する。
const fs = require("fs");
const path = require("path");
const {
  chromium,
  launchOptions,
  startServer,
  blockGithubApiByDefault,
  passGithubGate,
  randomPort
} = require("./helpers");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const timelineSource = fs.readFileSync(path.join(__dirname, "..", "src", "features", "timeline.js"), "utf8");
const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  console.log("[v299] 削除済み0秒思考テーマ提案UIのソース不存在");
  check("zeroSecThemeBarHTML本体が存在しない", !appSource.includes("zeroSecThemeBarHTML"));
  check("AIプラン内のzeroSecThemes読込経路が存在しない", !appSource.includes("plan?.zeroSecThemes"));
  check("zerosec-theme-add actionが存在しない", !appSource.includes('"zerosec-theme-add"'));
  check("zerosec-theme-skip actionが存在しない", !appSource.includes('"zerosec-theme-skip"'));
  check("timelineからzeroSecThemeBarHTMLを呼ばない", !timelineSource.includes("zeroSecThemeBarHTML"));
  check("E側のautoIngestFeedbackは維持", appSource.includes("function autoIngestFeedback"));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ✗ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const PREV = addDaysStr(TODAY, -1);
  const FEEDBACK_FIXTURE = {
    [TODAY]: "# AIフィードバック本文TODAY_v75\n\n本日分のテスト本文です。",
    [PREV]: "# AIフィードバック本文PREV_v75\n\n前日分のテスト本文です。"
  };
  const feedbackApiRequests = [];
  const sameOriginPersonalRequests = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) &&
        /AIフィードバック_|AIプラン_|週次レビュー_|AI作業結果_|Vision\.md|Daily_Affirmation\.md/.test(decodeURIComponent(url))) {
      sameOriginPersonalRequests.push(url);
    }
  });

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const fbMatch = p.match(/\/contents\/taskchute\/AIフィードバック_(.+)\.md$/);
    if (fbMatch) {
      feedbackApiRequests.push(p);
      const body = FEEDBACK_FIXTURE[fbMatch[1]];
      if (!body) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  }

  async function seed({ feedbackFiles = [], resetFeedbackIngest = false } = {}) {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ key, today, prev, feedbackFiles, resetFeedbackIngest }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.blocks = [];
      state.feedbackFiles = feedbackFiles;
      state.feedback = {};
      if (resetFeedbackIngest) {
        state.feedbackIngestedDates = [];
        state.journalMeta[prev] = { ...(state.journalMeta[prev] || {}), aiTaskCandidates: [] };
      }
      state.selectedDate = today;
      state.currentView = "today";
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, today: TODAY, prev: PREV, feedbackFiles, resetFeedbackIngest });
    await page.goto(`http://localhost:${PORT}/`);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1-2] personal-data API経路とsame-origin漏れ防止");
    await seed({ feedbackFiles: [TODAY] });
    await page.waitForFunction(({ key, today, prev }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.feedbackFiles.includes(today) && state.feedbackFiles.includes(prev);
    }, { key: KEY, today: TODAY, prev: PREV });
    const feedbackState = await stateNow();
    check("当日フィードバックを登録", feedbackState.feedbackFiles.includes(TODAY));
    check("前日フィードバックを登録", feedbackState.feedbackFiles.includes(PREV));
    check("当日をapi.github.com経由で取得", feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${TODAY}.md`)), JSON.stringify(feedbackApiRequests));
    check("前日をapi.github.com経由で取得", feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${PREV}.md`)), JSON.stringify(feedbackApiRequests));
    check("公開Pages同一オリジンへの個人データfetchなし", sameOriginPersonalRequests.length === 0, JSON.stringify(sameOriginPersonalRequests));

    console.log("[7] 『タスク名: 理由』形式の明日への提案をタスク名だけ保存");
    FEEDBACK_FIXTURE[PREV] = "## 明日への提案\n\n- タスクA_v75: 理由A_v75の説明\n- タスクB_v75\n";
    await seed({ feedbackFiles: [], resetFeedbackIngest: true });
    await page.waitForFunction(({ key, prev }) => {
      return (JSON.parse(localStorage.getItem(key)).journalMeta?.[prev]?.aiTaskCandidates || []).length === 2;
    }, { key: KEY, prev: PREV });
    const candidateState = await stateNow();
    const candidateTexts = candidateState.journalMeta?.[PREV]?.aiTaskCandidates || [];
    check("コロン付き候補は理由を除いたタスク名だけ保存", candidateTexts.includes("タスクA_v75") && !candidateTexts.some((text) => text.includes("理由A_v75")), JSON.stringify(candidateTexts));
    check("コロンなし候補は全文を保存", candidateTexts.includes("タスクB_v75"), JSON.stringify(candidateTexts));
    check("廃止済み採用ボタンを描画しない", await page.locator('[data-action="ai-task-adopt"]').count() === 0);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
