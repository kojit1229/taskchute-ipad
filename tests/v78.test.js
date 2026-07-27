// v78 検証: 「日報生成でパスが違う趣旨のエラーが出る」不具合の原因調査+修正の回帰確認。
// CHANGES_v78.md参照。
//
// 【原因分析まとめ】現物調査の結果、pushFileToGitHub等のURL組み立て(personalDataPath +
// セグメント単位encode)自体には二重プレフィックス等の不具合は無かった(v76で疑われた懸念は
// この環境の現物コードには存在しない)。一方 repos/personal-data の実コミット履歴を全数確認した
// ところ、v72移行(2026-07-10)の初回移行コミット以降、アプリ自身が生成するはずのコミット
// (`chore: update <file> <ISO>`)が1件も無く、日報・app-state.json自動保存とも一度も成功して
// いない実態が見えた。CHANGES_v72.mdの移行手順2「既存Fine-grained PATの Repository access に
// personal-data を追加し、Contents: Read and write権限を付与する」が未実施/不足のまま新
// リポジトリ設定へ切り替わった状態と整合する。GitHubはfine-grained tokenがアクセス権を持たない
// privateリポジトリに対して404を返す(403ではなく、存在の有無を隠すため)ため、実際の原因が
// 「トークンの権限不足」であっても、旧ヒント文言は「パス/Owner/Repoの綴りを確認」としか案内
// しておらず誤誘導になっていた(K報告の「パスが違う」という体感はここに由来する)。
//
// v76のテスト([5])はPlaywrightのroute()で常に201を返すモックのため、実際のGitHub APIが
// 権限不足時に404を返す挙動そのものを一切踏んでおらず、この誤誘導ヒントが出るケースを
// 検出できなかった(URL構築の回帰だけを見ていたため)。本スイートでは
// (1) PUT先パスの厳格アサーション(taskchute/日報_*.md・app-state.jsonそれぞれ完全一致。
//     %2F・taskchute二重・root直下を明示的に否定)と、
// (2) 実際にGitHubがトークン権限不足で404を返すケースを模擬し、案内文言とバナー表示が
//     「パスの綴り」だけでなく「トークンの権限」も指し示すことを検証する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";
const OWNER = "kojit1229";
const REPO = "personal-data";

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

  // PUTリクエストを全部記録しつつ、次に返すべきstatusを差し替え可能にする
  let nextPutStatus = 201;
  const pushApiRequests = [];
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === "PUT") {
      pushApiRequests.push({ rawPath: u.pathname, decodedPath: decodeURIComponent(u.pathname) });
      if (nextPutStatus === 201) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ content: { sha: "test-sha" } }) });
      }
      // 実際のGitHubが「private repoにfine-grained tokenのアクセス権が無い」場合と同じ形の404
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) 日報push: PUT先パスの厳格アサーション
    // ============================================================
    console.log("[1] 日報push: PUT先パスが taskchute/日報_<date>.md に完全一致する(厳格アサーション)");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.reports = s.reports || {};
      s.reports[TODAY] = `# 日報 ${TODAY}\n\nv78テスト用の日報本文です。`;
      s.selectedDate = TODAY;
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(700);
    nextPutStatus = 201;
    await page.click('[data-action="push-report"]');
    await page.waitForTimeout(500);
    const reportPush = pushApiRequests.find((r) => r.decodedPath.includes(`日報_${TODAY}.md`));
    const expectedReportPath = `/repos/${OWNER}/${REPO}/contents/taskchute/日報_${TODAY}.md`;
    check("日報pushのPUTが実際に発生している", Boolean(reportPush), JSON.stringify(pushApiRequests));
    check("PUT先(decode後)が taskchute/日報_<date>.md に完全一致する(root直下・二重taskchuteではない)",
      Boolean(reportPush) && reportPush.decodedPath === expectedReportPath,
      JSON.stringify({ actual: reportPush?.decodedPath, expected: expectedReportPath }));
    check("PUT先の生パスに%2F/%2fが含まれない(サブディレクトリ区切りが壊れていない)",
      Boolean(reportPush) && !/%2f/i.test(reportPush.rawPath), JSON.stringify(reportPush));
    check("PUT先に taskchute/taskchute の二重プレフィックスが無い",
      Boolean(reportPush) && !reportPush.decodedPath.includes("taskchute/taskchute"), JSON.stringify(reportPush));
    check("PUT先が root直下(taskchuteサブディレクトリ無し)になっていない",
      Boolean(reportPush) && reportPush.decodedPath !== `/repos/${OWNER}/${REPO}/contents/日報_${TODAY}.md`, JSON.stringify(reportPush));
    const pushToastOk = await page.locator("#toast").textContent().catch(() => "");
    check("pushトーストが成功メッセージになっている(push失敗トーストではない)",
      /GitHubへpushしました/.test(pushToastOk || ""), pushToastOk);

    // ============================================================
    // (2) app-state.json保存(save-github): PUT先パスの厳格アサーション
    // ============================================================
    console.log("[2] app-state.json保存: PUT先パスが taskchute/app-state.json に完全一致する(厳格アサーション)");
    pushApiRequests.length = 0;
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(300);
    // v148(UI改善計画Phase3-2)以降、save-githubは「データと同期」群のdetails内にあり既定closed。
    // <summary>を実クリックして開く。
    await openSettingsGroup(page, "settings-sync");
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);
    const statePush = pushApiRequests.find((r) => r.decodedPath.includes("app-state.json"));
    const expectedStatePath = `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`;
    check("app-state.json保存のPUTが実際に発生している", Boolean(statePush), JSON.stringify(pushApiRequests));
    check("PUT先(decode後)が taskchute/app-state.json に完全一致する",
      Boolean(statePush) && statePush.decodedPath === expectedStatePath,
      JSON.stringify({ actual: statePush?.decodedPath, expected: expectedStatePath }));
    check("PUT先が root直下(taskchuteサブディレクトリ無し)になっていない",
      Boolean(statePush) && statePush.decodedPath !== `/repos/${OWNER}/${REPO}/contents/app-state.json`, JSON.stringify(statePush));

    // ============================================================
    // (3) トークンがrepoにアクセスできない場合と同じ形の404を実際に模擬し、
    //     案内文言・バナーが「パスの綴り」だけでなく「トークンの権限」も指し示すことを確認
    // ============================================================
    console.log("[3] 権限不足による404(実際のGitHub挙動を模擬)で、案内が『パス』だけでなく『トークンの権限』も示す");
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    pushApiRequests.length = 0;
    nextPutStatus = 404;
    await page.click('[data-action="push-report"]');
    await page.waitForTimeout(500);
    const failToast = await page.locator("#toast").textContent().catch(() => "");
    check("失敗トーストにパスの案内が含まれる(既存文言の維持)", /パス/.test(failToast || ""), failToast);
    check("失敗トーストにトークン権限(Repository access)の案内も含まれる(新規追加分)",
      /Repository access|権限/.test(failToast || ""), failToast);
    const banner = await page.locator(".pd-auth-banner").count();
    check("設定画面への誘導バナー(.pd-auth-banner)が表示される(読み込み失敗401と同じ導線に統一)", banner === 1, String(banner));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
