// v76 検証: 「ホームのAIからで昨日のフィードバックが読めない」不具合の原因調査+回帰確認
// と、ジャーナルタブでの前日AIフィードバック閲覧機能の追加。CHANGES_v76.md参照。
//
// 調査結果(詳細はCHANGES_v76.md): ホーム側の不具合は v75(同日, f7e90f6)の
// homeAiFeedbackReadHTML() 追加により既に修正済みで、本スイートでは
// (1) 実際の personal-data/taskchute/AIフィードバック_*.md と同じ見出し構造(「## 明日への提案」)
//     を取得しても廃止済み候補stateへ書かない回帰確認、(4) fetch失敗を「以後ずっと再fetchしない」形でキャッシュしていないことの検証
// を行う。(3) フィードバックファイルが404でもクラッシュしない(フェイルソフト)ことを検証する。
// (5) pushFileToGitHub(日報push等)のURL組み立てをpushGitHubPathと同じセグメント単位encodeに
//     統一したことの回帰(PUT先パスに%2Fが混入しないこと)。
// v141メモ: (2)のジャーナルタブ側details(.journal-yesterday-feedback)はAIフィードバック列の
//     UI撤去に伴い削除された。今日基準の前日フィードバックを読む機能自体は(1)/(1b)のHome
//     「AIから」カードで引き続き回帰確認している(詳細は当該箇所のコメント参照)。
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
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const PREV = addDaysStr(TODAY, -1);
  const PREV2 = addDaysStr(TODAY, -2);

  // 実際の AIフィードバック_2026-07-09.md と同じ見出し構造(「## 明日への提案」+ チェックボックス箇条書き)
  const REAL_SHAPED_FEEDBACK = `# AIコーチングフィードバック ${PREV}\n\n## 良かった点\n\n- テスト用の良かった点_v76\n\n## 気づき(データから)\n\n- テスト用の気づき_v76\n\n## 明日への提案\n\n- [ ] 提案1_v76\n- [ ] 提案2_v76\n\n## 明日への問い\n\n問い_v76\n`;

  let feedbackFixture = { [PREV]: REAL_SHAPED_FEEDBACK };
  const feedbackApiRequests = [];
  // (5)用: pushFileToGitHub(日報push等)が実際に叩いたPUT先の生パス(%2Fの有無を見るためdecodeしない)を記録
  const pushApiRequests = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = decodeURIComponent(u.pathname);
    const fbMatch = p.match(/\/contents\/taskchute\/AIフィードバック_(.+)\.md$/);
    if (fbMatch) {
      feedbackApiRequests.push(p);
      const body = feedbackFixture[fbMatch[1]];
      if (!body) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body });
    }
    if (req.method() === "PUT") {
      pushApiRequests.push({ rawPath: u.pathname, decodedPath: p });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ content: { sha: "test-sha" } }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function seed({ feedbackFiles = [], view = "home", selectedDate = TODAY } = {}) {
    // v185フレーク修正(v75/v140と同根): アプリJSが動いていない静的ページ上でseedを書き、
    // 起動時hydrateStaticMarkdownの非同期saveStateがseedを上書きする競合を構造的に排除する
    // (詳細: workbench/out/2026-07-29-today-cockpit-impl/ci-flaky-diagnosis.md)
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ KEY, feedbackFiles, selectedDate, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.feedbackFiles = feedbackFiles;
      s.feedback = {};
      s.selectedDate = selectedDate;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, feedbackFiles, selectedDate, view });
    await page.goto(`http://localhost:${PORT}/`);
    // v85: 起動処理に selectedDate強制リセット等が加わりわずかに重くなったぶん、
    // 起動時hydrateStaticMarkdown完了までの待ち時間を少し余裕を持たせる(700→900ms)。
    await page.waitForTimeout(900);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) 回帰: ホーム「AIから」で、実データと同じ見出し構造の前日フィードバック本文が読める
    // ============================================================
    // v149(UI改善計画Phase4a): 「AIから」(home-ai-feedback-readを含む)はホームの2タブ分割で
    // ホームタブへ移動した(既定は今日タブ)。reload/seedのたびにタブは既定へ戻るため、
    // ホームを見る箇所ごとに切り替える。
    const gotoHomeTab = async () => {
      if (await page.locator('#app[data-view="today"]').count() === 0) await page.click('[data-action="nav"][data-view="today"]');
      await page.waitForTimeout(150);
    };

    console.log("[1] 実データと同じ見出し構造の前日フィードバックを取得し、候補stateへは書かない");
    await seed({ view: "home" });
    check("api.github.comへ前日分のfetchが実際に飛んでいる", feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${PREV}.md`)), JSON.stringify(feedbackApiRequests));
    await gotoHomeTab();
    const feedbackCandidates = await page.evaluate(({ KEY, PREV }) => JSON.parse(localStorage.getItem(KEY)).journalMeta?.[PREV]?.aiTaskCandidates || [], { KEY, PREV });
    check("実データ構造の提案2件を候補stateへ書き込まない", feedbackCandidates.length === 0, JSON.stringify(feedbackCandidates));
    check("旧ATISフィードバック要素をtodayへ戻さない", await page.locator(".tower-atis-feedback, .tower-atis-summary").count() === 0);

    // v85メモ: 「各タブは基本的に今日を表示」導入で起動時(reload)は必ずselectedDate=今日に
    // 強制される。2日前を見ている状態は、reload後にセッション中の日付ピッカー操作で再現する
    // (以前のように selectedDate をlocalStorageへ仕込んでreloadでは今日に上書きされてしまう)。
    console.log("[1b] 根本原因の回帰: Home で state.selectedDate が『今日』以外(=セッション中に過去日へ移動した状態)でも読める");
    await seed({ view: "home" });
    await page.click('[data-action="nav"][data-view="exec"]'); // v230: 日付ピッカーの現行配置
    await page.waitForTimeout(150);
    await page.evaluate((d) => {
      const el = document.querySelector("[data-date-picker]");
      el.value = d;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, PREV2);
    await page.waitForTimeout(300);
    await gotoHomeTab();
    check("selectedDateが2日前でも今日基準の前日だけを取得する(selectedDate依存バグの回帰)",
      feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${PREV}.md`))
      && !feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${PREV2}.md`)), JSON.stringify(feedbackApiRequests));
    await seed({ view: "home" });  // 以降の検証のため selectedDate を今日へ戻す

    // ============================================================
    // (2) v141メモ: ジャーナルタブの「昨日のAIフィードバックを見る」折りたたみ
    //     (.journal-yesterday-feedback)は、AIフィードバック列そのもののUI撤去に伴い
    //     v141で削除された(CHANGES_v141.md参照)。今日基準の前日フィードバックを読む機能自体は
    //     Homeの「AIから」カード(.home-ai-feedback-read)に一本化されており、(1)/(1b)で
    //     引き続き回帰確認済み(selectedDateに依存しない挙動も含む)。
    // ============================================================

    // ============================================================
    // (3) フィードバックファイルが無い(404)日でも壊れない(フェイルソフト)
    // ============================================================
    console.log("[3] 前日分のAIフィードバックファイルが存在しない(404)日は、Homeがクラッシュせずdetails自体が出ない");
    feedbackFixture = {};  // 全部404
    await seed({ view: "home" });
    await gotoHomeTab();
    check("前日分が無くてもtoday/TOWERを描画する(フェイルソフト)", await page.locator(".today-tower").count() === 1);
    check("404が続いてもクラッシュしていない(pageerror無し。ここまで到達していれば正常)", true);

    // ============================================================
    // (4) 失敗した/空だったfetchを「以後ずっと再fetchしない」形でキャッシュしていないことの確認
    //     (前日分が404だった直後に本文を用意しても、再読み込みすれば正しく取得できることを見る)
    // ============================================================
    console.log("[4] 404直後に前日分が用意されても、次回起動時には再fetchされて読める(失敗を永続キャッシュしていない)");
    feedbackFixture = { [PREV]: REAL_SHAPED_FEEDBACK };  // ここで初めて用意する
    const recoveryRequestsBefore = feedbackApiRequests.filter((p) => p.endsWith(`AIフィードバック_${PREV}.md`)).length;
    await seed({ view: "home" });
    await gotoHomeTab();
    const recoveryRequestsAfter = feedbackApiRequests.filter((p) => p.endsWith(`AIフィードバック_${PREV}.md`)).length;
    check("直前は404でも、ファイル用意後の再起動で同じ前日分を再取得する(失敗の永続キャッシュなし)",
      recoveryRequestsAfter > recoveryRequestsBefore, `${recoveryRequestsBefore} -> ${recoveryRequestsAfter}`);

    // ============================================================
    // (5) 日報push(pushFileToGitHub)のPUT先URLパスに %2F が含まれず、taskchute/日報_*.md
    //     形式であることの確認(v74で発覚した「filenameに"/"を含む場合は壊れる」欠陥の
    //     本体側修正の回帰。日報_*.mdのfilename自体には"/"を含まないため旧実装でも
    //     このケース自体は壊れていなかったが、pushGitHubPathと生成規則を統一したことの確認)
    // ============================================================
    console.log("[5] 日報push(GitHubに日報push)のPUT先URLパスに%2Fが含まれず、taskchute/日報_*.md形式である");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.reports = s.reports || {};
      s.reports[TODAY] = `# 日報 ${TODAY}\n\nv76テスト用の日報本文です。`;
      s.selectedDate = TODAY;
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(700);
    await page.click('[data-action="push-report"]');
    await page.waitForTimeout(500);
    const reportPush = pushApiRequests.find((r) => r.decodedPath.includes(`日報_${TODAY}.md`));
    check("日報pushのPUTが実際に発生している", Boolean(reportPush), JSON.stringify(pushApiRequests));
    check("PUT先の生パスに%2Fが含まれない(サブディレクトリ区切りが壊れていない)",
      Boolean(reportPush) && !reportPush.rawPath.includes("%2F") && !reportPush.rawPath.includes("%2f"), JSON.stringify(reportPush));
    check("PUT先が taskchute/日報_<date>.md 形式になっている(taskchuteサブディレクトリを正しく指せている)",
      Boolean(reportPush) && reportPush.decodedPath.endsWith(`/contents/taskchute/日報_${TODAY}.md`), JSON.stringify(reportPush));
    const pushToast = await page.locator("#toast").textContent().catch(() => "");
    check("pushトーストが成功メッセージになっている(push失敗トーストではない)",
      /GitHubへpushしました/.test(pushToast || ""), pushToast);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
