// v57 検証: ローカルAIコーチングがリポジトリ直下に直接pushした前日フィードバックの自動読込
//            (feedbackFiles未登録でも「今日から見た昨日」1日分だけは fetch する)
//            + F1: その無条件fetchは過去日ブラウズ時の「閲覧中の日付自身」のfetchノイズは出さない
//
// v60メモ: このfetch(AIフィードバック_日付.md)は自宅PCバッチ→ファイル連携の経路であり、
// アプリ内Claude API直接呼び出しとは別物なのでv60でも削除していない。
//
// v76メモ(仕様変更・[1]の期待値更新): 「今日から見た昨日」1日分の無条件fetchは、
// state.selectedDate に関わらず常に実行するよう変更した(CHANGES_v76.md参照)。旧実装は
// この無条件fetch自体が selectedDate===今日 のときしか発火せず、ホーム/ジャーナルで
// 過去日を閲覧している間(＝前回セッションの閲覧日が永続化されている場合を含む)は
// 「今日から見た昨日」のフィードバックが一切読めなくなる実バグがあった。F1が守りたかった
// 「過去日ブラウズ時のfetchノイズ回避」の対象は本来「閲覧中の(無関係な)日付自身」への
// fetchであり、「今日から見た昨日」1日分の無条件fetクトは対象外だったため、[1]の期待値を
// 「fetch 0件」から「実際の昨日分のみ1件・閲覧中の無関係な過去日自身へのfetchは無い」に更新する
// (検証意図であるノイズ回避そのものは弱めていない。閲覧中の日付自身へのfetch有無は
// [1]で引き続き確認する)。
// v72: 個人データはGitHub Contents API(personal-data リポジトリの taskchute/ 配下)経由に
//      なったため、リポジトリ直下への実ファイル書き込みをやめ、v62等と同じくpage.routeの
//      可変fixtureでモックする。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4193;
const KEY = "taskchute-journal-pwa-state-v1";

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

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  // v65レビュー対応: 深夜0時跨ぎで real new Date() が [1]/[2] 間にズレるとTODAY/YESTERDAY判定が
  // 食い違いフレーキーになるため、他スイート(v61/v63等)と同じく page.clock.setFixedTime で
  // ページ内の現在時刻を日中(10:00)に固定し、実行時刻に依存しないようにする(アプリ本体は無改修)。
  now.setHours(10, 0, 0, 0);
  const TODAY = iso(now);
  const YESTERDAY = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  // 実「昨日」と隣接しない過去日(前日=6日前になり、実「昨日」とは一致しない)
  const PAST = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5));
  const FEEDBACK_MARKER = "v57テスト用マーカー_" + Date.now();
  // v72: 実ファイルの代わりにこの変数をfetchのモック応答として使う(null=404)
  let feedbackFixture = null;

  try {
    // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策)
    await blockGithubApiByDefault(page);
    await page.route((url) =>
      url.hostname === "api.github.com" && decodeURIComponent(url.pathname).endsWith(`/taskchute/AIフィードバック_${YESTERDAY}.md`),
    (route) => {
      if (feedbackFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      route.fulfill({ status: 200, contentType: "text/markdown", body: feedbackFixture });
    });

    await page.clock.setFixedTime(now);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(600);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
    // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
    await passGithubGate(page);

    // fetch監視: 実fetchは素通しし、AIフィードバック_*.md への要求だけ記録する(v56と同様の手法)
    await page.addInitScript(() => {
      window.__fbReqs = [];
      const orig = window.fetch;
      window.fetch = (url, opts) => {
        // v72: fetch先がGitHub Contents API(パスがpercent-encodeされる)になったため、
        // 生のURL文字列には日本語ファイル名がそのまま現れない。decodeしてから判定する。
        let u = String(url);
        try { u = decodeURIComponent(u); } catch { /* デコード不能ならそのまま */ }
        if (u.includes("AIフィードバック_")) window.__fbReqs.push(u);
        return orig(url, opts);
      };
    });

    // ---- [1] F1回帰(v76で期待値更新): 過去日ブラウズ中も「閲覧中の日付自身」への
    //          fetchノイズは出さない。ただし「今日から見た昨日」1日分の無条件fetchは
    //          selectedDateに関わらず常に行う(v76の仕様変更。CHANGES_v76.md参照) ----
    // v85メモ: 「各タブは基本的に今日を表示」導入により、起動時(reload)は必ずselectedDate=今日に
    // 強制されるようになった。旧実装は localStorage に selectedDate=PAST を仕込んでからreloadし、
    // 起動時のhydrateStaticMarkdownがPASTを見た状態で走ることを期待していたが、v85後は
    // reload直後は常に「今日」から始まる。過去日ブラウズ中の検証は、reload後にセッション中の
    // 操作(日付ピッカー)でPASTへ移動して行う。setSelectedDate は「日付変更時にAIフィードバックを
    // 再fetchする」ラッパー(hydrateStaticMarkdown呼び出し)が既に掛かっているため、日付ピッカーの
    // change イベント自体がこのテストで検証したい再fetchの引き金になる(visibilitychangeの
    // 追加発火は不要)。
    console.log("[1] 過去日ブラウズ中でも『閲覧中の日付自身』へのfetchノイズは出ない(F1)。ただし今日から見た昨日分は常にfetchする(v76)");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.feedbackFiles = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(700);
    await page.evaluate(({ KEY, PAST }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s.feedback) delete s.feedback[PAST];
      localStorage.setItem(KEY, JSON.stringify(s));
      window.__fbReqs = [];  // 起動時hydrateぶんの記録はリセットし、これ以降(日付移動時のfetch)だけを見る
      const el = document.querySelector("[data-date-picker]");
      el.value = PAST;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, { KEY, PAST });
    await page.waitForTimeout(700);
    const reqsPast = await page.evaluate(() => (window.__fbReqs || []).slice());
    check("閲覧中の(無関係な)過去日自身へのfetchは出さない(ノイズ回避は維持)",
      !reqsPast.some((u) => u.includes(`AIフィードバック_${PAST}.md`)), JSON.stringify(reqsPast));
    check("『今日から見た昨日』1日分は、閲覧中の日付に関わらず常にfetchされる(v76仕様変更)",
      reqsPast.length === 1 && reqsPast[0].includes(`AIフィードバック_${YESTERDAY}.md`), JSON.stringify(reqsPast));

    // ---- [2] 直push検知: feedbackFiles未登録でも「今日から見た昨日」分はリポジトリ直下から読み込む ----
    // v60メモ: 元は fetch した前日フィードバックが「今日のタスク提案」(ai-today-suggest)の
    // callClaudeプロンプトへ反映されることまで確認していたが、v60でその機能はアプリ内AI呼び出し
    // 全廃に伴い削除した(朝の一括プランニングが上位互換のため)。ここでは fetch 経路自体
    // (feedbackFilesへの登録・回数)と、取得した本文がジャーナルの「前日のフィードバック」欄に
    // 実際に描画されることで代替確認する(詳細はCHANGES_v60.md)。
    console.log("[2] 直push検知: feedbackFiles未登録でも昨日分を読み込み、ジャーナルに反映される");
    feedbackFixture = `# 昨日のAIフィードバック\n\n${FEEDBACK_MARKER}\n`;

    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.feedbackFiles = [];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      if (s.feedback) delete s.feedback[TODAY];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(700);

    const reqsToday = await page.evaluate(() => (window.__fbReqs || []).slice());
    check("当日表示時は「今日から見た昨日」分のみ fetch する(ちょうど1件)",
      reqsToday.length === 1 && reqsToday[0].includes(`AIフィードバック_${YESTERDAY}.md`),
      JSON.stringify(reqsToday));

    const ffAfter = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).feedbackFiles, KEY);
    check("直push検知した前日分が feedbackFiles に登録される(以後は正規ルート)",
      Array.isArray(ffAfter) && ffAfter.includes(YESTERDAY), JSON.stringify(ffAfter));

    // ジャーナル(今日選択中)の「前日(昨日)のフィードバックも見る」欄に、直pushした本文が反映される
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(400);
    const journalText = await page.locator(".journal-grid").textContent();
    check("取得した前日フィードバックの本文がジャーナルに反映される(マーカー一致)",
      journalText.includes(FEEDBACK_MARKER), journalText.slice(0, 200));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
