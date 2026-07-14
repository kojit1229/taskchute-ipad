// v72 検証: 個人データの読み書きを「同一オリジンfetch」から「GitHub Contents API
// (PAT認証・privateリポジトリ)」へ全面切替 + トークンゲート。
//
// (a) トークン/個人データリポジトリ未設定の端末は、起動時に全画面セットアップ画面(ゲート)が
//     出て、サイドバー・ボトムナビ・タイムライン等アプリの中身は一切表示されない
// (b) ゲート画面でOwner/Repository/Tokenを入力して「設定してはじめる」を押すと、通常のアプリ
//     (サイドバーのタブ一覧等)が表示される
// (c) 設定済み状態での起動時、Vision/Daily_Affirmation/AIフィードバックがGitHub Contents API
//     (https://api.github.com/repos/{owner}/{repo}/contents/taskchute/{path}、
//     Accept: application/vnd.github.raw+json、Authorization: Bearer <token>)経由で取得され、
//     取得内容が画面に反映される。同一オリジンへのフォールバックは無い
// (d) API 401時、「トークンにpersonal-data リポジトリの権限が必要です」の具体的な案内バナーが
//     表示され、タップで設定画面へ遷移する
// (e) 「今すぐGitHubへ保存」(app-state.json)のPUT先が
//     https://api.github.com/repos/{dataOwner}/{dataRepo}/contents/taskchute/app-state.json になる
//     (旧owner/repoフィールドの値ではなく、dataOwner/dataRepoの値が使われることを確認)
//
// 方針: 他スイートと同じく、app.js は type="module" のため内部関数は window に露出しない。
// ブラウザ操作 + localStorage 状態の直接注入 + page.route(api.github.com の偽装)で観測する。
// このスイートは意図的に tests/helpers.js の passGithubGate/blockGithubApiByDefault を
// (ゲート自体を検証するため)使わず、個々のシナリオで必要な分だけ page.route を組む。
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");

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

  // 個々のシナリオで書き換える可変フィクスチャ(既定は全て404/仮成功)
  const fixtures = {
    visionText: null,
    affirmText: null,
    feedbackStatus: 404,   // 404 | 401 | 200
    puts: []               // { url, method, body } の記録(save-github検証用)
  };

  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    const p = decodeURIComponent(u.pathname);
    if (method === "PUT" || method === "DELETE") {
      fixtures.puts.push({ url: u.toString(), method, body: route.request().postData() });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-test" } }) });
    }
    if (p.endsWith("/contents/taskchute/content/Vision.md")) {
      if (fixtures.visionText === null) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body: fixtures.visionText });
    }
    if (p.endsWith("/contents/taskchute/content/Daily_Affirmation.md")) {
      if (fixtures.affirmText === null) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body: fixtures.affirmText });
    }
    if (/\/contents\/taskchute\/AIフィードバック_.*\.md$/.test(p)) {
      if (fixtures.feedbackStatus === 401) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Bad credentials" }) });
      return route.fulfill({ status: 404, body: "not found" });
    }
    // それ以外(AIプラン/週次レビュー/AI作業結果/app-state.jsonのGET等)は既定404
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(600);

    // ============================================================
    // (a) 未設定端末はセットアップ画面(ゲート)のみが表示される
    // ============================================================
    console.log("[1] トークン/個人データリポジトリ未設定 → セットアップ画面(ゲート)が出て、中身は表示されない");
    check("サイドバーのタブが1件も表示されない(ゲート中)", await page.locator(".nav-button").count() === 0);
    check("ボトムナビも表示されない(ゲート中)", await page.locator("#bottomNav button").count() === 0);
    const gateText = await page.locator("main").textContent();
    check("セットアップ画面の案内文が表示される", gateText.includes("個人データの保護設定"), gateText.slice(0, 200));
    check("Owner欄が既定値kojit1229でプリフィルされる",
      await page.locator('[data-github-field="dataOwner"]').inputValue() === "kojit1229");
    check("Repository欄が既定値personal-dataでプリフィルされる",
      await page.locator('[data-github-field="dataRepo"]').inputValue() === "personal-data");
    check("「設定してはじめる」ボタンがある", await page.locator('[data-action="gate-continue"]').count() === 1);

    console.log("[2] トークン未入力のまま「設定してはじめる」を押しても解除されない");
    await page.click('[data-action="gate-continue"]');
    await page.waitForTimeout(200);
    check("トークン未入力ならまだゲートのまま", await page.locator(".nav-button").count() === 0);

    // ============================================================
    // (b) トークン入力 → ゲート解除
    // ============================================================
    console.log("[3] Owner/Repository/Tokenを入力して「設定してはじめる」→ 通常のアプリが表示される");
    await page.fill('[data-github-field="token"]', "ghp_test_token_v72");
    await page.click('[data-action="gate-continue"]');
    await page.waitForTimeout(400);
    check("ゲート解除後、サイドバーのタブが表示される", await page.locator(".nav-button").count() > 0);
    check("設定にトークンが保存されている",
      (await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.github.token, KEY)) === "ghp_test_token_v72");

    console.log("[4] リロード後も設定済みなのでゲートは出ない(localStorageの設定有無だけで判定)");
    await page.reload();
    await page.waitForTimeout(500);
    check("リロード後もゲートは出ずアプリが表示される", await page.locator(".nav-button").count() > 0);

    // ============================================================
    // (c) 読み込みのGitHub API化(Vision/Affirmation)
    // ============================================================
    console.log("[5] Vision/Daily_AffirmationがGitHub Contents API経由で取得され、ビジョン画面に反映される");
    fixtures.visionText = "# v72テスト用Vision\n\nAPI経由取得の確認マーカー_Vision";
    fixtures.affirmText = "# v72テスト用Affirmation\n\nAPI経由取得の確認マーカー_Affirmation";
    await page.reload();
    await page.waitForTimeout(700);
    await page.click('[data-action="nav"][data-view="vision"]');
    await page.waitForTimeout(300);
    const visionMain = await page.locator("main").textContent();
    check("Vision.mdの内容(API経由)がビジョン画面に反映される", visionMain.includes("確認マーカー_Vision"), visionMain.slice(0, 300));

    // ============================================================
    // (d) 401時の具体的なエラーバナー
    // ============================================================
    console.log("[6] AIフィードバックfetchが401 → 具体的な案内バナーが出て、タップで設定へ遷移する");
    fixtures.feedbackStatus = 401;
    // feedbackFiles に「今日から見た昨日」を登録し、無条件fetch対象にする(hydrateStaticMarkdownの仕様)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const d = new Date();
      const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
      s.feedbackFiles = [iso(yesterday)];
      s.feedback = {};
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    const bannerCount = await page.locator(".pd-auth-banner").count();
    check("401時に案内バナーが表示される", bannerCount === 1, `count=${bannerCount}`);
    const bannerText = await page.locator(".pd-auth-banner").textContent().catch(() => "");
    check("バナー文言にpersonal-dataリポジトリの権限案内が含まれる", bannerText.includes("personal-data リポジトリの権限"), bannerText);
    await page.click(".pd-auth-banner");
    await page.waitForTimeout(300);
    check("バナーをタップすると設定画面へ遷移する", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY) === "settings");

    // ============================================================
    // (e) 書き込み先URL(app-state.json の PUT 先)
    // ============================================================
    console.log("[7] 「今すぐGitHubへ保存」のPUT先が https://api.github.com/repos/{dataOwner}/{dataRepo}/contents/taskchute/app-state.json になる");
    fixtures.feedbackStatus = 404;  // これ以降のバナーは邪魔なので静める
    fixtures.puts.length = 0;
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);
    const statePut = fixtures.puts.find((p) => p.url.includes("/contents/taskchute/app-state.json") && p.method === "PUT");
    check("app-state.jsonがPUTされる", !!statePut, JSON.stringify(fixtures.puts.map((p) => p.url)));
    check("PUT先がdataOwner(既定kojit1229)/dataRepo(既定personal-data)になっている",
      !!statePut && statePut.url === "https://api.github.com/repos/kojit1229/personal-data/contents/taskchute/app-state.json",
      statePut && statePut.url);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
