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

  // v230: home撤去後は旧viewからtodayへフォールバックする。
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
    check("未来からの手紙タブの履歴がindex由来で月次(YYYY-MM)2件・新しい順に並ぶ(コンテンツ総括は混ざらない)",
      JSON.stringify(options) === JSON.stringify([MONTH, "2026-01"]), `(実際: ${JSON.stringify(options)})`);

    const mdText = await page.textContent("#main .md-render");
    check("既定選択(最新=当月)の本文が表示される", mdText.includes(LETTER_BODY), `(実際: ${mdText.slice(0, 120)})`);

    // ============================================================
    // [1b] report-index.jsonに当月分がまだ載っていない(coach-dailyの日次再生成がまだ新着を
    //      反映していない状態を再現)場合でも、hydrateStaticMarkdown()の直接fetch成功分が
    //      _aiReportDirCacheへunionされ、タブが空にならない(2026-07-28レビュー対応・必須修正2)
    // ============================================================
    console.log("[1b] report-index.jsonに未来からの手紙_当月.mdが載っていなくても、直接fetch成功分がunionされタブに表示される");
    reportIndexFixture = {
      generatedAt: freshGeneratedAt(),
      files: [
        // 意図的に 未来からの手紙_<当月>.md を含めない(index側の新着未反映を再現)
        { name: "コンテンツ総括_2026-07-14.md", date: "2026-07-14", kind: "content" }
      ]
    };
    letterFixture = LETTER_BODY;
    await seedAiReports("letter");

    const options1b = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("indexに未来からの手紙が1件も載っていなくても、直接fetch成功分が選択肢に出る(union)",
      JSON.stringify(options1b) === JSON.stringify([MONTH]), `(実際: ${JSON.stringify(options1b)})`);
    const mdText1b = await page.textContent("#main .md-render");
    check("indexに載っていなくても本文が表示される(タブが空にならない)",
      mdText1b.includes(LETTER_BODY), mdText1b.slice(0, 120));

    // ============================================================
    // [2] 当月分が存在する日は、ホーム(内省側)タブで導線が表示される
    // ============================================================
    // v230: home導線は描画ごと削除。AIレポート内の履歴/本文検証は[1][1b]で維持する。
    console.log("[2-4] v230: 未来からの手紙の旧home導線は描画されない");
    letterFixture = LETTER_BODY;
    await seedHome({ selectedDate: TODAY });
    check("旧home viewはtodayへフォールバックしTOWERを表示する",
      await page.locator('#app[data-view="today"] .sec-atis').count() === 1);

    // [5] 公開Pages側(同一オリジン)への未来からの手紙_*.mdのfetchは一切発生しない
    // ============================================================
    console.log("[5] 公開Pages側(同一オリジン)への未来からの手紙_*.mdへのfetchは一度も発生しない");
    check("同一オリジンでの未来からの手紙_*.mdへのリクエストが0件(すべてapi.github.com経由)",
      sameOriginRequests.length === 0, JSON.stringify(sameOriginRequests));

    // ============================================================
    // [6] GitHub(personal-data)未設定→セットアップ完了(gate-continue)の流れで、設定完了後の
    //     hydrateStaticMarkdown()再実行で未来からの手紙が正しくfetchされる(2026-07-28レビュー
    //     対応・必須修正3。「未設定時にcachedFutureLetterMdへundefinedを書き込まない」の直接検証)
    // ============================================================
    console.log("[6] GitHub未設定→gate-continueの流れで、設定完了後に未来からの手紙が正しくfetchされる(失敗キャッシュの固着防止)");
    letterFixture = LETTER_BODY;
    reportIndexFixture = null;
    letterApiRequests.length = 0;
    // トークンだけを空にしてゲート(トークン未設定画面)を再表示させる(v72.test.jsと同じ手法。
    // Owner/Repositoryは既定値のままでよい)。
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "";
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    check("前提: ゲート画面(トークン未設定)が表示されている", await page.locator('[data-action="gate-continue"]').count() === 1);
    check("ゲート中は(GitHub未設定のため)未来からの手紙_当月.mdへの実fetchはまだ発生しない",
      letterApiRequests.length === 0, JSON.stringify(letterApiRequests));
    await page.fill('[data-github-field="token"]', "test-token-v159");
    await page.click('[data-action="gate-continue"]');
    await page.waitForTimeout(700);
    check("設定完了後、未来からの手紙_当月.mdへの実fetchが行われる(修正前は失敗キャッシュが固着し二度とfetchされなかった)",
      letterApiRequests.some((p) => p.endsWith(`未来からの手紙_${MONTH}.md`)), JSON.stringify(letterApiRequests));
    const linkCount6 = await page.locator('[data-action="open-future-letter"]').count();
    check("v230: 設定完了後も削除済みhome導線は描画されない", linkCount6 === 0);
    check("設定完了後はtoday/TOWERへ復帰する", await page.locator('#app[data-view="today"] .sec-atis').count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
