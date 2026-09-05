// v94 検証: 個人リポジトリ設定「保存先パス」に taskchute/ が混入し(例: taskchute/app-state.json)、
// 実リクエストが taskchute/taskchute/... の二重プレフィックスになりデータが読めなくなる不具合の修正。
// K報告(2026-07-14)。CHANGES_v94.md参照。
//
// 根本原因: loadFromGitHub()(「GitHubから読込」ボタン)が、リモート採用後の
// state.settings.github の復元に requireGitHubConfig() の変換済みconfig
// (owner/repoキー・personalDataPath()でtaskchute/付与済みのpath)をそのまま使っていた。
// 変換済みconfigを書き戻すと dataOwner/dataRepo が失われ、path が taskchute/ 付きのまま
// 永続化されて次回以降 personalDataPath() が taskchute/taskchute/... と二重付与してしまう。
// syncFromGitHubOnStartup()/runAutoSyncPull()/restoreBackup() は元から生の設定(cfg/
// currentGithubSettings、state上書き前に退避済み)を使っており対象外(現物調査で確認)。
//
// 対策: (1) loadFromGitHub() を生の設定(rawSettings)で復元するよう修正
//       (2) normalizeState() に settings.github.path 先頭の taskchute/ 剥がし(自己修復)を追加。
//           どの経路から汚染されても読込のたびに直り、同期で伝播した汚染stateも直る。
//
// [1] path="taskchute/app-state.json" を持つstateをロード → 保存リクエストURLが単一
//     taskchute/app-state.json プレフィックスになる(正規化されている)
// [2] path="taskchute/taskchute/app-state.json"(二重汚染)も同様に単一プレフィックスへ復旧
// [3] 正常値 path="app-state.json" は不変(回帰なし)
// [4] 混入経路の再現: 「GitHubから読込」を押しても dataOwner/dataRepo が失われず、
//     path も taskchute/ 付きに汚染されない(loadFromGitHub修正の直接検証)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

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

  const requestLog = [];  // { method, path }
  // v136追補: saveToGitHub()がfail-closed化され、sha!==lastSyncedの時は必ずGETでリモート本文を
  // 取得・マージしてから初めてPUTする(取得できなければ保存を中止する)。このテストは元々
  // 「保存先パス正規化」だけを見るためGETを常に404にしていたが、1回目の保存でlastSyncedSha
  // (この端末が最後に同期したSHA)が確定した後、404を返し続けると「リモートが読めない」
  // 扱いでfail-closed発動しPUTされなくなり、以降のシナリオの前提が崩れる。実際のGitHubと
  // 同じく「pushした内容が次のGETで読める」状態を模して、直近のPUT/GET応答を憶えておく。
  const fixtures = { getResponder: null, remoteSha: null, remoteContent: null };

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const req = route.request();
    const method = req.method();
    const p = decodeURIComponent(new URL(req.url()).pathname);
    requestLog.push({ method, path: p });
    if (method === "PUT") {
      try {
        const body = JSON.parse(req.postData());
        fixtures.remoteContent = body.content;  // 既にbase64
        fixtures.remoteSha = "sha-put-ok";
      } catch { /* noop */ }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-put-ok" } }) });
    }
    if (method === "GET" && fixtures.getResponder) {
      const r = fixtures.getResponder(p);
      if (r) {
        // この応答を「現在のリモート状態」として以降のGETにも一貫させる
        try {
          const body = JSON.parse(r.body);
          if (body.sha) { fixtures.remoteSha = body.sha; fixtures.remoteContent = body.content; }
        } catch { /* noop */ }
        return route.fulfill(r);
      }
    }
    if (method === "GET" && fixtures.remoteContent) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ sha: fixtures.remoteSha, content: fixtures.remoteContent, encoding: "base64" })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });  // 既存ファイル無し扱い
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function setDirtyPath(path) {
    await page.evaluate(({ KEY, path }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.path = path;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, path });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function clickSaveGithub() {
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    // v148(UI改善計画Phase3-2)以降、save-githubは「データと同期」群のdetails内にあり既定closed。
    // 直前にpage.reload()を挟むことが多いファイルのため、毎回<summary>を実クリックして開く。
    await openSettingsGroup(page, "settings-sync");
    requestLog.length = 0;
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(400);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);  // token/dataOwner/dataRepo投入 + reload(path はデフォルト app-state.json のまま)

    // ============================================================
    // [1] path="taskchute/app-state.json"(単一混入)→ 保存時のリクエストURLが単一プレフィックスになる
    // ============================================================
    console.log("[1] 保存先パスに taskchute/ が混入(単一)しても、保存リクエストは taskchute/app-state.json 一本になる");
    await setDirtyPath("taskchute/app-state.json");
    const healedAfterLoad1 = await stateNow();
    check("reload直後(normalizeState通過後)にlocalStorage上のpathも剥がれている",
      healedAfterLoad1.settings.github.path === "app-state.json", healedAfterLoad1.settings.github.path);
    await clickSaveGithub();
    const put1 = requestLog.find((r) => r.method === "PUT");
    check("PUT先が単一 taskchute/app-state.json になる(二重prefixではない)",
      !!put1 && put1.path === "/repos/kojit1229/personal-data/contents/taskchute/app-state.json",
      JSON.stringify(requestLog));
    check("taskchute/taskchute/ への二重プレフィックスリクエストは発生していない",
      !requestLog.some((r) => r.path.includes("taskchute/taskchute")), JSON.stringify(requestLog));

    // ============================================================
    // [2] path="taskchute/taskchute/app-state.json"(二重混入)も同様に復旧する
    // ============================================================
    console.log("[2] 保存先パスに taskchute/taskchute/ が混入(二重)しても、単一プレフィックスに復旧する");
    await setDirtyPath("taskchute/taskchute/app-state.json");
    const healedAfterLoad2 = await stateNow();
    check("二重混入もlocalStorage上で app-state.json まで剥がれている",
      healedAfterLoad2.settings.github.path === "app-state.json", healedAfterLoad2.settings.github.path);
    await clickSaveGithub();
    const put2 = requestLog.find((r) => r.method === "PUT");
    check("PUT先が単一 taskchute/app-state.json になる(二重混入からの復旧)",
      !!put2 && put2.path === "/repos/kojit1229/personal-data/contents/taskchute/app-state.json",
      JSON.stringify(requestLog));

    // 大文字小文字混在の混入も剥がれることを軽く確認(TaskChute/表記)
    await setDirtyPath("TaskChute/app-state.json");
    const healedCase = await stateNow();
    check("大文字小文字が混在した taskchute/ 混入も剥がれる",
      healedCase.settings.github.path === "app-state.json", healedCase.settings.github.path);

    // ============================================================
    // [3] 正常値 path="app-state.json" は不変(回帰なし)
    // ============================================================
    console.log("[3] 正常値 app-state.json は変化せず、保存リクエストも従来どおり単一プレフィックス");
    await setDirtyPath("app-state.json");
    const healedNormal = await stateNow();
    check("正常値は書き換わらない", healedNormal.settings.github.path === "app-state.json", healedNormal.settings.github.path);
    await clickSaveGithub();
    const put3 = requestLog.find((r) => r.method === "PUT");
    check("正常値でもPUT先は従来どおり taskchute/app-state.json",
      !!put3 && put3.path === "/repos/kojit1229/personal-data/contents/taskchute/app-state.json",
      JSON.stringify(requestLog));

    // ============================================================
    // [4] 混入経路の再現: 「GitHubから読込」を押しても settings.github が壊れない
    //     (修正前は requireGitHubConfig() の変換済みconfigをそのまま書き戻し、
    //      dataOwner/dataRepoの消失 と pathへのtaskchute/焼き込みが起きていた)
    // ============================================================
    console.log("[4] 「GitHubから読込」後も dataOwner/dataRepo が保持され、path も taskchute/ で汚染されない");
    await setDirtyPath("app-state.json");  // クリーンな状態から開始
    // 修正フェーズ単位14手直し(2026-09-05): settings:{}のままだと、単位14でSYNC_CORE_COMPARE_KEYSに
    // 追加したsettings.vision等がローカルの実データ(seedStateの既定Vision本文等)と食い違い、
    // syncCoreEqualがfalseになって「GitHub側に別の変更があります」でsave-githubがPUTせず中断する
    // (このテストの本来の検証対象であるpath正規化とは無関係な差分)。本ステップの目的はpath汚染の
    // 再現に限定されるため、settingsはローカルの現在値をそのまま複製し、無関係な差分を作らない。
    const localSettingsSnapshot = (await stateNow()).settings;
    const remoteState = {
      dataModifiedAt: `${TODAY}T23:59:59`, currentView: "timeline", selectedDate: TODAY,
      blocks: [], projects: [], tasks: [], settings: { ...localSettingsSnapshot }
    };
    const remoteJSON = JSON.stringify(remoteState);
    const remoteB64 = Buffer.from(remoteJSON, "utf-8").toString("base64");
    fixtures.getResponder = (p) => {
      if (p === "/repos/kojit1229/personal-data/contents/taskchute/app-state.json") {
        return { status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-remote-v94", content: remoteB64, encoding: "base64" }) };
      }
      return null;
    };
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await openSettingsGroup(page, "settings-sync");
    requestLog.length = 0;
    await page.click('[data-action="load-github"]');
    await page.waitForTimeout(500);

    const afterLoadGithub = await stateNow();
    check("load-github後もdataOwnerが失われていない(kojit1229のまま)",
      afterLoadGithub.settings.github.dataOwner === "kojit1229", JSON.stringify(afterLoadGithub.settings.github));
    check("load-github後もdataRepoが失われていない(personal-dataのまま)",
      afterLoadGithub.settings.github.dataRepo === "personal-data", JSON.stringify(afterLoadGithub.settings.github));
    check("load-github後もpathがtaskchute/で汚染されていない(app-state.jsonのまま)",
      afterLoadGithub.settings.github.path === "app-state.json", afterLoadGithub.settings.github.path);

    // 読込直後の状態でもう一度保存 → PUT先が引き続き単一プレフィックスであることを確認
    // (読み込んだremoteStateのcurrentView="timeline"に画面遷移しているため、設定タブへ戻ってから押す)
    fixtures.getResponder = null;  // 以降のGET(SHAチェック)は404扱いに戻す
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await openSettingsGroup(page, "settings-sync");
    requestLog.length = 0;
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(400);
    const put4 = requestLog.find((r) => r.method === "PUT");
    check("load-github直後の保存でもPUT先は単一 taskchute/app-state.json のまま",
      !!put4 && put4.path === "/repos/kojit1229/personal-data/contents/taskchute/app-state.json",
      JSON.stringify(requestLog));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
