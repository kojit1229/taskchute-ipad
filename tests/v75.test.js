// v75 検証: AIフィードバック表示不具合の修正 + 前日フィードバック参照 + 0秒思考テーマ選定UI。
// CHANGES_v75.md参照。
//
// (1) ホーム「AIから」カードで、personal-data API(fetchGitHubRawText、v72/v74確立の経路)経由で
//     取得した当日/前日のAIフィードバック本文が、既定closedのdetailsから実際に読める
//     (旧来「鮮度表示+MIT候補抽出のみ」で本文を読む手段が無かった不具合の修正)
// (2) 上記の読み取りが、公開Pages側(アプリ自身の同一オリジン)への個人md/jsonのfetchを
//     一切発生させないことの否定アサーション(同一オリジンfetch回帰の防止)
// (3) 日報生成画面(renderReports)に、前日のAIフィードバックが既定closedのdetailsで表示される
//     (フェイルソフト: 前日分が無ければ何も出ない)
// (4) AIプラン_YYYY-MM-DD.json トップレベルの zeroSecThemes(0秒思考のテーマ提案)を
//     タイムラインの「AIプラン取り込みUI」(下書きバーの並び)にワンタップ選定カードとして表示し、
//     「追加」で state.zeroThinking.themes に、「見送り」で zeroSecThemeLog に記録して
//     カードから消えることを確認する
// (5) zeroSecThemesフィールドが無い(後方互換)AIプラン_*.jsonでもクラッシュせず、
//     テーマ提案カードが出ないことを確認する
// (6) should-fix1: 繰越/WBS候補が0件でzeroSecThemesだけの日でも、下書きが置けず終わる
//     従来挙動のまま埋もれさせず、タイムラインへ遷移してテーマ提案カードを見せる
// (7) should-fix2: 「タスク名: 理由」形式のMIT候補行(coach-daily.shの「明日への提案」実出力)は、
//     コロンより前のタスク名部分だけを候補にする(コロン無しの行は従来どおり全文を候補にする)
//
// 方針: 既存スイート(v62/v72/v74)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + page.route(api.github.com の偽装)+ localStorage 直接注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // computeFreeGapsが現在時刻〜23:00に依存するため日中に固定(v61〜v62と同じ理由)
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const PREV = addDaysStr(TODAY, -1);

  // (2)用: 公開Pages側(同一オリジン)への個人データファイルへのリクエストを全て記録する
  const sameOriginPersonalRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) &&
        /AIフィードバック_|AIプラン_|週次レビュー_|AI作業結果_|Vision\.md|Daily_Affirmation\.md/.test(decodeURIComponent(url))) {
      sameOriginPersonalRequests.push(url);
    }
  });

  // (4)(5)用: AIプラン_<TODAY>.json の応答本体を差し替え可能にする(null=404)
  let aiPlanFixture = null;
  const FEEDBACK_FIXTURE = {
    [TODAY]: "# AIフィードバック本文TODAY_v75\n\n本日分のテスト本文です。",
    [PREV]: "# AIフィードバック本文PREV_v75\n\n前日分のテスト本文です。"
  };
  // api.github.com へ実際に届いたAIフィードバックfetchのpathを記録(personal-data API経由の裏取り用)
  const feedbackApiRequests = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    const fbMatch = p.match(/\/contents\/taskchute\/AIフィードバック_(.+)\.md$/);
    if (fbMatch) {
      feedbackApiRequests.push(p);
      const body = FEEDBACK_FIXTURE[fbMatch[1]];
      if (!body) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body });
    }
    if (p.endsWith(`/contents/taskchute/AIプラン_${TODAY}.json`)) {
      if (aiPlanFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "application/json", body: aiPlanFixture });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  function planBlock({ id, date, title, startMin, endMin, taskId = "" }) {
    const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
    return {
      id, taskId, date, title, category: "",
      plannedStartAt: `${date}T${hhmm(startMin)}`, plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function seed({ blocks = [], feedbackFiles = [], view = "home" } = {}) {
    await page.evaluate(({ KEY, blocks, feedbackFiles, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.feedbackFiles = feedbackFiles;
      s.feedback = {};
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, feedbackFiles, TODAY, view });
    await page.reload();
    await page.waitForTimeout(700);
  }

  async function runMorningPlan() {
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(700);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) ホーム「AIから」で当日/前日のAIフィードバック本文が読める(personal-data API経由)
    // ============================================================
    console.log("[1] ホーム『AIから』カードに、personal-data API経由のAIフィードバック本文を読むdetailsが既定closedで出る");
    await seed({ feedbackFiles: [TODAY], view: "home" });
    // v149(UI改善計画Phase4a): 「AIから」(home-ai-hub、その中の.home-ai-feedback-read)は
    // ホームの2タブ分割でホームタブへ移動した(既定は今日タブ)。
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    check("api.github.comのAIフィードバック_TODAY.mdへリクエストが実際に飛んでいる(personal-data API経由の裏取り)",
      feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${TODAY}.md`)), JSON.stringify(feedbackApiRequests));
    check("api.github.comのAIフィードバック_PREV.mdへリクエストが実際に飛んでいる(前日1日分の無条件fetch仕様)",
      feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${PREV}.md`)), JSON.stringify(feedbackApiRequests));
    const detailsCount = await page.locator(".home-ai-feedback-read").count();
    check("「AIフィードバックを読む」detailsが1つ表示される", detailsCount === 1);
    const detailsOpenAttr = await page.locator(".home-ai-feedback-read").getAttribute("open").catch(() => null);
    check("detailsは既定closed(open属性が無い)", detailsOpenAttr === null, String(detailsOpenAttr));
    const homeText = await page.locator("main").textContent();
    check("当日のAIフィードバック本文が読める(DOM上に存在)", homeText.includes("本日分のテスト本文です。"), homeText.slice(0, 300));
    check("前日のAIフィードバック本文も読める(DOM上に存在)", homeText.includes("前日分のテスト本文です。"), homeText.slice(0, 300));

    // ============================================================
    // (2) 公開Pages側(同一オリジン)への個人md/jsonのfetchが一切発生しない
    // ============================================================
    console.log("[2] 公開Pages側(同一オリジン)へのAIフィードバック/AIプラン等のfetchは一度も発生しない");
    check("同一オリジンでの個人データファイルへのリクエストが0件(すべてapi.github.com経由)",
      sameOriginPersonalRequests.length === 0, JSON.stringify(sameOriginPersonalRequests));

    // ============================================================
    // (3) 日報生成画面(日報タブ)に前日のAIフィードバックが既定closedで表示される
    // ============================================================
    console.log("[3] 日報生成画面に前日のAIフィードバックが既定closedのdetailsで表示される");
    await page.click('[data-action="nav"][data-view="reports"]');
    await page.waitForTimeout(300);
    const reportDetailsCount = await page.locator(".report-prev-feedback").count();
    check("前日AIフィードバックのdetailsが1つ表示される", reportDetailsCount === 1);
    const reportOpenAttr = await page.locator(".report-prev-feedback").getAttribute("open").catch(() => null);
    check("前日AIフィードバックのdetailsは既定closed", reportOpenAttr === null, String(reportOpenAttr));
    const reportsText = await page.locator("main").textContent();
    check("前日のAIフィードバック本文が日報タブでも読める", reportsText.includes("前日分のテスト本文です。"), reportsText.slice(0, 300));

    console.log("[3b] 前日分が無ければ日報タブに前日フィードバックのdetails自体が出ない(フェイルソフト)");
    await seed({ feedbackFiles: [], view: "reports" });
    // PREVのfeedbackFilesが空でも「今日から見た昨日」は無条件fetchされ得るため、
    // ここではAPIフィクスチャ自体を空にして「前日分が本当に無い」状況を作る
    delete FEEDBACK_FIXTURE[PREV];
    await page.reload();
    await page.waitForTimeout(700);
    const reportDetailsCount2 = await page.locator(".report-prev-feedback").count();
    check("前日フィードバックが無い日はdetails自体が出ない", reportDetailsCount2 === 0);
    FEEDBACK_FIXTURE[PREV] = "# AIフィードバック本文PREV_v75\n\n前日分のテスト本文です。";  // 後続テストのため復元

    // ============================================================
    // (4) zeroSecThemes: テーマ提案の表示 → 「追加」「見送り」のワンタップ選定
    // ============================================================
    console.log("[4] AIプラン_*.jsonのzeroSecThemesが、タイムラインの下書きバー付近にテーマ提案として出る");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [{ title: "AIプラン下書きタスク_v75", taskId: null, blockId: null, start: "10:30", minutes: 30, category: "", reason: "", carryFromId: null }],
      skipped: [],
      zeroSecThemes: [
        { theme: "テーマ1_v75", reason: "理由1_v75" },
        { theme: "テーマ2_v75", reason: "理由2_v75" }
      ]
    });
    await seed({ blocks: [], view: "tasks" });
    await runMorningPlan();
    const timelineText1 = await page.locator("main").textContent();
    check("「0秒思考のテーマ提案」見出しが出る", timelineText1.includes("0秒思考のテーマ提案"), timelineText1.slice(0, 400));
    check("テーマ1と理由が表示される", timelineText1.includes("テーマ1_v75") && timelineText1.includes("理由1_v75"));
    check("テーマ2と理由が表示される", timelineText1.includes("テーマ2_v75") && timelineText1.includes("理由2_v75"));
    check("下書きバー(AIプラン由来のスケジュール)も同時に表示される", timelineText1.includes("AIプラン由来"));

    console.log("[4b] 「追加」を押すとzeroThinking.themesへ入り、カードから消え、zeroSecThemeLogに記録される");
    const row1 = page.locator(".home-ck", { hasText: "テーマ1_v75" });
    await row1.locator('[data-action="zerosec-theme-add"]').click();
    await page.waitForTimeout(300);
    const s4a = await stateNow();
    check("テーマ1がzeroThinking.themesに追加される",
      (s4a.zeroThinking?.themes || []).some((t) => t.text === "テーマ1_v75"), JSON.stringify(s4a.zeroThinking?.themes));
    check("zeroSecThemeLogにoutcome='added'で記録される",
      (s4a.zeroSecThemeLog || []).some((l) => l.theme === "テーマ1_v75" && l.outcome === "added" && l.date === TODAY),
      JSON.stringify(s4a.zeroSecThemeLog));
    const timelineText2 = await page.locator("main").textContent();
    check("追加済みのテーマ1はカードから消える", !timelineText2.includes("テーマ1_v75"));
    check("テーマ2はまだカードに残っている", timelineText2.includes("テーマ2_v75"));

    console.log("[4c] 「見送り」を押すとzeroThinking.themesには入らず、zeroSecThemeLogにskippedで記録され、カードごと消える");
    const row2 = page.locator(".home-ck", { hasText: "テーマ2_v75" });
    await row2.locator('[data-action="zerosec-theme-skip"]').click();
    await page.waitForTimeout(300);
    const s4b = await stateNow();
    check("テーマ2はzeroThinking.themesに追加されない",
      !(s4b.zeroThinking?.themes || []).some((t) => t.text === "テーマ2_v75"), JSON.stringify(s4b.zeroThinking?.themes));
    check("zeroSecThemeLogにoutcome='skipped'で記録される",
      (s4b.zeroSecThemeLog || []).some((l) => l.theme === "テーマ2_v75" && l.outcome === "skipped"),
      JSON.stringify(s4b.zeroSecThemeLog));
    const timelineText3 = await page.locator("main").textContent();
    check("両方選定し終えるとテーマ提案カード自体が消える", !timelineText3.includes("0秒思考のテーマ提案"), timelineText3.slice(0, 300));

    // ============================================================
    // (5) zeroSecThemesが無い(後方互換)AIプラン_*.jsonでもクラッシュせず、カードが出ない
    // ============================================================
    console.log("[5] zeroSecThemesフィールドが無いAIプラン_*.json(旧フォーマット)でもクラッシュせず、テーマ提案カードは出ない");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [{ title: "AIプラン下書きタスク2_v75", taskId: null, blockId: null, start: "11:00", minutes: 30, category: "", reason: "", carryFromId: null }],
      skipped: []
      // zeroSecThemes 無し(旧フォーマット。後方互換必須)
    });
    await seed({ blocks: [], view: "tasks" });
    await runMorningPlan();
    const timelineText4 = await page.locator("main").textContent();
    check("旧フォーマットでも下書きバーは通常どおり表示される", timelineText4.includes("AIプラン下書きタスク2_v75"), timelineText4.slice(0, 400));
    check("旧フォーマットではテーマ提案カードが出ない", !timelineText4.includes("0秒思考のテーマ提案"));
    check("クラッシュしていない(pageerror無し。ここまで到達していれば正常)", true);

    // ============================================================
    // (6) should-fix1: スケジュール0件(繰越・WBS候補なし)でも、zeroSecThemesがあれば
    //     タイムラインへ案内される(従来は「配置できる候補がありません」で終わり、
    //     テーマ提案があっても気づけなかった)
    // ============================================================
    console.log("[6] スケジュール0件(繰越・WBS候補なし)でもzeroSecThemesがあればタイムラインへ案内される(should-fix1)");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [],   // スケジュール側は空(下書きに置けるものが無い)
      skipped: [],
      zeroSecThemes: [{ theme: "テーマ0件テスト_v75", reason: "理由0件テスト_v75" }]
    });
    // 繰越/WBS候補も無いことを保証するため、tasks/projectsも明示的に空にする
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.tasks = [];
      s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(700);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(700);
    const s6 = await stateNow();
    check("候補0件でもタイムラインへ遷移する", s6.currentView === "timeline", s6.currentView);
    const toastText6 = await page.locator("#toast").textContent().catch(() => "");
    check("トーストが「0秒思考のテーマ提案があります」系になる(『候補がありません』ではない)",
      /0秒思考のテーマ提案があります/.test(toastText6 || ""), toastText6);
    const timelineText6 = await page.locator("main").textContent();
    check("テーマ提案カードが実際に表示される", timelineText6.includes("0秒思考のテーマ提案") && timelineText6.includes("テーマ0件テスト_v75"), timelineText6.slice(0, 400));
    check("下書きスケジュール(draft-block)は無い(候補0件だったため)", await page.locator(".draft-block").count() === 0);

    // ============================================================
    // (7) should-fix2: 「タスク名: 理由」形式のMIT候補行は、コロンより前のタスク名だけを候補にする
    // ============================================================
    console.log("[7] 「タスク名: 理由」形式のMIT候補行はタスク名のみを候補にする。コロン無しの行は従来どおり全文(should-fix2)");
    FEEDBACK_FIXTURE[PREV] = "## 明日への提案\n\n- タスクA_v75: 理由A_v75の説明文\n- タスクB_v75\n";
    await seed({ blocks: [], feedbackFiles: [], view: "home" });
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    // v75: 「AIから」カードには、生の本文をそのまま読めるdetails(homeAiFeedbackReadHTML、意図した
    // 仕様)と、抽出済みの候補リスト(aiFeedbackCandidatesHTML)が両方入っている。ここで検証したいのは
    // 「候補として抽出された文言」からコロン以降が除かれていることなので、判定は候補行(候補見出し
    // 「昨日のフィードバックからの候補」の直後、追加ボタンを含む行群)のテキストだけに絞る。
    const candidatesSectionText = await page.locator(".home-ai-hub .home-ai-sub", { hasText: "昨日のフィードバックからの候補" })
      .locator("xpath=following-sibling::div[contains(@class,'home-ck')]")
      .allTextContents();
    const candidatesText = candidatesSectionText.join(" / ");
    const homeText7 = await page.locator(".home-ai-hub").textContent();
    check("コロン付き候補は候補行にタスク名のみが表示される(理由部分は含まれない)",
      candidatesText.includes("タスクA_v75") && !candidatesText.includes("理由A_v75"), candidatesText);
    check("コロン無しの候補行は従来どおり全文がそのまま候補になる(旧フォーマット互換)",
      homeText7.includes("タスクB_v75"), homeText7);
    const addBtnTitle7 = await page.locator('.home-ai-hub [data-action="mit-candidate-add"]').first().getAttribute("data-title");
    check("追加ボタンのdata-titleにも理由が混入していない", addBtnTitle7 === "タスクA_v75", addBtnTitle7);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
