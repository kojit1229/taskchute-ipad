// v77回帰 + v299 Test-Reduction:
// 削除された朝プラン決定論エンジンの配置テストはソース不存在へ更新する。
// visibilitychange再取得とAIフィードバック自動取り込み(E)は実動作で維持する。
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
const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  console.log("[1-3,5,6b] v299で削除した朝プラン経路のソース不存在");
  check("fallbackMorningPlanが存在しない", !appSource.includes("fallbackMorningPlan"));
  check("aiScheduleCandidatesが存在しない", !appSource.includes("aiScheduleCandidates"));
  check("runAiMorningPlanが存在しない", !appSource.includes("runAiMorningPlan"));
  check("ai-morning-plan actionが存在しない", !appSource.includes('"ai-morning-plan"'));
  check("AIプラン由来のzeroSecThemes選定UIが存在しない", !appSource.includes("zeroSecThemeBarHTML"));
  check("D側ai-schedule actionは維持", appSource.includes('"ai-schedule": () => runAiSchedule()'));
  check("D側runAiScheduleは維持", appSource.includes("function runAiSchedule"));
  check("D側_scheduleDraftは維持", appSource.includes("_scheduleDraft"));

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
  const YEST = addDaysStr(TODAY, -1);
  let feedbackFixture = {};
  const feedbackApiRequests = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const fbMatch = p.match(/\/contents\/taskchute\/AIフィードバック_(.+)\.md$/);
    if (fbMatch) {
      feedbackApiRequests.push(p);
      const body = feedbackFixture[fbMatch[1]];
      if (!body) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function seed({ zeroThinkingThemes = [], feedbackIngestedDates = [] } = {}) {
    await page.evaluate(({ key, today, zeroThinkingThemes, feedbackIngestedDates }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.blocks = [];
      state.tasks = [];
      state.projects = [];
      state.selectedDate = today;
      state.currentView = "home";
      state.feedback = {};
      state.feedbackFiles = [];
      state.zeroThinking = { themes: zeroThinkingThemes, entries: [] };
      state.feedbackIngestedDates = feedbackIngestedDates;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, today: TODAY, zeroThinkingThemes, feedbackIngestedDates });
    await page.reload();
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[4] visibilitychangeで前日フィードバックを再取得・自動取り込み");
    delete feedbackFixture[YEST];
    await seed();
    const beforeCandidates = await page.evaluate(({ key, yest }) => {
      return JSON.parse(localStorage.getItem(key)).journalMeta?.[yest]?.aiTaskCandidates || [];
    }, { key: KEY, yest: YEST });
    check("起動直後は新着候補なし", !beforeCandidates.includes("新着提案_v77"));

    await page.clock.setFixedTime(new Date(now0.getTime() + 5 * 60 * 1000));
    feedbackFixture[YEST] = "# AIフィードバック本文_v77\n\n## 明日への提案\n\n- [ ] 新着提案_v77\n";
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(({ key, yest }) => {
      return (JSON.parse(localStorage.getItem(key)).journalMeta?.[yest]?.aiTaskCandidates || []).includes("新着提案_v77");
    }, { key: KEY, yest: YEST });
    const afterCandidates = await page.evaluate(({ key, yest }) => {
      return JSON.parse(localStorage.getItem(key)).journalMeta?.[yest]?.aiTaskCandidates || [];
    }, { key: KEY, yest: YEST });
    check("復帰時に前日候補へ反映", afterCandidates.includes("新着提案_v77"), JSON.stringify(afterCandidates));
    check("api.github.comへ前日分を再fetch", feedbackApiRequests.filter((p) => p.endsWith(`AIフィードバック_${YEST}.md`)).length >= 2, JSON.stringify(feedbackApiRequests));

    console.log("[6a] フィードバックの0秒思考テーマと明日への提案を自動取り込み");
    await page.clock.setFixedTime(now0);
    feedbackFixture = {
      [YEST]: "# AIフィードバック本文YEST_v77\n\n## 0秒思考テーマ\n\n- [ ] テーマFB1_v77: 理由FB1_v77\n- [ ] テーマFB2_v77: 理由FB2_v77\n\n## 明日への提案\n\n- [ ] 提案1_v77\n"
    };
    await seed();
    await page.waitForFunction(({ key, yest }) => {
      const state = JSON.parse(localStorage.getItem(key));
      return (state.zeroThinking?.themes || []).some((theme) => theme.text === "テーマFB2_v77") &&
        (state.journalMeta?.[yest]?.aiTaskCandidates || []).includes("提案1_v77");
    }, { key: KEY, yest: YEST });
    const state6a = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    check("FB由来テーマ2件を自動登録",
      state6a.zeroThinking.themes.some((theme) => theme.text === "テーマFB1_v77" && theme.source === "ai-feedback") &&
      state6a.zeroThinking.themes.some((theme) => theme.text === "テーマFB2_v77" && theme.source === "ai-feedback"),
      JSON.stringify(state6a.zeroThinking));
    check("明日への提案をtasksへ直接登録しない", !(state6a.tasks || []).some((task) => task.title === "提案1_v77"));
    check("明日への提案を前日の候補へ登録", (state6a.journalMeta?.[YEST]?.aiTaskCandidates || []).includes("提案1_v77"));
    check("取り込み済み日付を記録", (state6a.feedbackIngestedDates || []).includes(YEST));

    console.log("[6c] 見出しのない旧形式フィードバックはフェイルソフト");
    feedbackFixture = { [YEST]: "# AIフィードバック本文_v77(旧形式)\n\n所感のみで見出し構造が無い本文です。\n" };
    await seed();
    const state6c = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    check("見出しなしで新規タスクを増やさない", (state6c.tasks || []).every((task) => task.kind === "other"), JSON.stringify(state6c.tasks));
    check("見出しなしで新規テーマを増やさない", (state6c.zeroThinking?.themes || []).length === 0, JSON.stringify(state6c.zeroThinking));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
