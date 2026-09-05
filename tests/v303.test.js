// v303 検証: GitHubトークンの文字検証エラーを既存の認証バナーへ通知し、
// save/load/startup/autoSyncの成功時に残留バナーを解除する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, randomPort, openSettingsGroup
} = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const PUSH_AT_KEY = "taskchute-journal-last-sync-push-at";
const PULL_AT_KEY = "taskchute-journal-last-sync-pull-at";
const API_HOST = "api.github.com";
const INVALID_TOKEN = "github_pat_test_日本語";
const INVALID_MESSAGE = "GitHubトークンに使用できない文字が含まれています。設定画面で貼り直してください";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  return source.slice(start, end);
}

(async () => {
  const root = path.join(__dirname, "..");
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const githubSource = fs.readFileSync(path.join(root, "src", "sync", "github.js"), "utf8");
  const ownSource = fs.readFileSync(__filename, "utf8");

  console.log("[1] 実装契約: 検出条件は不変、通知はthrow直前、成功解除は共通経路");
  const headersBlock = functionBlock(appSource, "githubHeaders", "gitHubErrorMessage");
  const setterAt = headersBlock.indexOf("setPersonalDataAuthError(message)");
  const throwAt = headersBlock.indexOf("throw new Error(message)");
  check("非Latin-1の既存検出条件を変更していない", headersBlock.includes("/[^\\x00-\\xFF]/.test(clean)"));
  check("認証バナー設定がinvalid-character throwの直前にある", setterAt >= 0 && throwAt > setterAt);
  check("案内文言が不正文字と設定への導線を示す", headersBlock.includes(INVALID_MESSAGE));
  check("案内文言に責める表現『未記入』を含めない", !headersBlock.includes("未記入"));
  check("フォーム側へ同じ文字検証を重複追加していない",
    (appSource.match(/\[\^\\x00-\\xFF\]/g) || []).length === 1);

  const saveBlock = functionBlock(githubSource, "saveToGitHub", "scheduleAutoSave");
  const downloadBlock = functionBlock(githubSource, "downloadGitHubStateText", "loadFromGitHub");
  check("push成功点で認証バナーを解除する", saveBlock.includes("clearPersonalDataAuthError()"));
  check("load/startup/autoSync共通pull成功点で認証バナーを解除する",
    downloadBlock.includes("clearPersonalDataAuthError()"));
  for (const fn of ["loadFromGitHub", "syncFromGitHubOnStartup", "runAutoSyncPull", "runAutoSyncPush"]) {
    check(`${fn}は共通downloadGitHubStateText経路へ到達する`,
      functionBlock(githubSource, fn, fn === "loadFromGitHub" ? "syncFromGitHubOnStartup" : undefined)
        .includes("downloadGitHubStateText"));
  }
  check("新規固定waitを追加していない", !ownSource.includes("waitFor" + "Timeout"));

  console.log("[2] 負例: trim対象・Latin-1制御文字・正常Fine-grained tokenを誤検知しない");
  const invalidGuard = /[^\x00-\xFF]/;
  check("前後の半角/全角空白と改行はtrimで除去される",
    "\n　 github_pat_valid_123 \r\n".trim() === "github_pat_valid_123");
  check("改行のみは現行の非Latin-1判定対象外", !invalidGuard.test("\n"));
  check("空白混入は現行の非Latin-1判定対象外", !invalidGuard.test("github pat valid"));
  check("タブ等の制御文字は現行仕様どおり判定対象外", !invalidGuard.test("github_pat_\tvalid"));
  check("正常なFine-grained tokenを誤検知しない", !invalidGuard.test("github_pat_valid_ABC123"));
  check("全角文字は検出対象", invalidGuard.test(INVALID_TOKEN));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  // unit15追従: 手動読込はローカルに未push差分があると確認ダイアログ(window.confirm)を出す。
  // Playwrightの既定はdismiss(=中止)なので、実ユーザーと同じく「読み込む」を選ぶ。
  page.on("dialog", (dialog) => dialog.accept());

  const api = { mode: "not-found", requests: [], pullGate: null };
  function remoteContentsBody() {
    const remote = {
      dataModifiedAt: "2000-01-01T00:00:00", currentView: "settings",
      selectedDate: "2000-01-01", blocks: [], projects: [], tasks: [], settings: {}
    };
    return JSON.stringify({
      sha: "sha-v303", encoding: "base64",
      content: Buffer.from(JSON.stringify(remote), "utf8").toString("base64")
    });
  }

  await page.route((url) => url.hostname === API_HOST, async (route) => {
    const request = route.request();
    const decodedPath = decodeURIComponent(new URL(request.url()).pathname);
    api.requests.push({ method: request.method(), path: decodedPath, mode: api.mode });
    if (request.method() === "PUT" && api.mode === "push-success") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-pushed-v303" } }) });
    }
    // unit15追従: 確認OK後の読込前スナップショット(backups/app-state-*-preload-*.json への PUT)は
    // fail-close(失敗なら読込中止)なので、pull成功モードでは成功させる。
    if (request.method() === "PUT" && decodedPath.includes("/contents/taskchute/backups/")
      && (api.mode === "pull-success" || api.mode === "pull-pending")) {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-preload-v303" } }) });
    }
    if (decodedPath.endsWith("/contents/taskchute/app-state.json")) {
      if (request.method() === "GET" && api.mode === "pull-success") {
        return route.fulfill({ status: 200, contentType: "application/json", body: remoteContentsBody() });
      }
      if (request.method() === "GET" && api.mode === "pull-pending") {
        await api.pullGate;
        return route.fulfill({ status: 200, contentType: "application/json", body: remoteContentsBody() });
      }
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function waitForBanner() {
    await page.locator(".pd-auth-banner").waitFor({ state: "visible" });
    return page.locator(".pd-auth-banner").textContent();
  }
  async function waitForToast(text) {
    await page.waitForFunction((expected) => (document.querySelector("#toast")?.textContent || "").includes(expected), text);
  }
  async function storedState() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  }
  async function setStoredGithub(mutator) {
    await page.evaluate(({ KEY, PUSH_AT_KEY, PULL_AT_KEY, values }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      Object.assign(state.settings.github, values.github || {});
      Object.assign(state.settings, values.settings || {});
      if (values.dataModifiedAt !== undefined) state.dataModifiedAt = values.dataModifiedAt;
      localStorage.setItem(KEY, JSON.stringify(state));
      if (values.clearSyncTimes) {
        localStorage.removeItem(PUSH_AT_KEY);
        localStorage.removeItem(PULL_AT_KEY);
      }
    }, { KEY, PUSH_AT_KEY, PULL_AT_KEY, values: mutator });
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('[data-action="gate-continue"]').waitFor({ state: "visible" });
    const initialKeys = (await storedState()) && Object.keys(await storedState()).sort();

    console.log("[3] gate/startup・手動push/loadの不正文字エラーをpd-auth-bannerへ表示");
    await page.fill('[data-github-field="token"]', INVALID_TOKEN);
    await page.click('[data-action="gate-continue"]');
    const gateBanner = await waitForBanner();
    check("gate→syncFromGitHubOnStartupで認証バナーが表示される", gateBanner.includes("使用できない文字"), gateBanner);
    await page.click('[data-action="nav"][data-view="today"]');
    check("メイン画面の再描画後も認証バナーが残る", await page.locator(".pd-auth-banner").count() === 1);

    await page.click('[data-action="nav"][data-view="settings"]');
    await openSettingsGroup(page, "settings-sync");
    await page.click('[data-action="save-github"]');
    await waitForToast("GitHub保存失敗");
    check("手動pushでもtoastに加えて認証バナーが表示される", await page.locator(".pd-auth-banner").count() === 1);
    await page.click('[data-action="load-github"]');
    await waitForToast("GitHub読込失敗");
    check("手動loadでもtoastに加えて認証バナーが表示される", await page.locator(".pd-auth-banner").count() === 1);

    const invalidState = await storedState();
    const syncTimesAfterInvalid = await page.evaluate(({ PUSH_AT_KEY, PULL_AT_KEY }) => ({
      push: localStorage.getItem(PUSH_AT_KEY), pull: localStorage.getItem(PULL_AT_KEY)
    }), { PUSH_AT_KEY, PULL_AT_KEY });
    check("バナー表示でstateのトップレベル形状を増やさない",
      JSON.stringify(Object.keys(invalidState).sort()) === JSON.stringify(initialKeys));
    check("バナー文言をstateへ永続化しない", !JSON.stringify(invalidState).includes(INVALID_MESSAGE));
    check("失敗時にpush/pull成功時刻を更新しない", !syncTimesAfterInvalid.push && !syncTimesAfterInvalid.pull,
      JSON.stringify(syncTimesAfterInvalid));

    console.log("[4] 正常push/load成功で残留バナーを解除し、成功時刻を記録");
    api.mode = "push-success";
    await page.fill('[data-github-field="token"]', "\n　 github_pat_valid_303 \r\n");
    await page.click('[data-action="save-github"]');
    await waitForToast("GitHubへ保存しました");
    await page.waitForFunction(() => !document.querySelector(".pd-auth-banner"));
    const pushedState = await storedState();
    check("正常tokenはtrimされて保存され、誤検知しない", pushedState.settings.github.token === "github_pat_valid_303",
      pushedState.settings.github.token);
    check("push成功後に認証バナーが消える", await page.locator(".pd-auth-banner").count() === 0);
    check("push成功時刻が更新される", Boolean(await page.evaluate((key) => localStorage.getItem(key), PUSH_AT_KEY)));

    await page.fill('[data-github-field="token"]', INVALID_TOKEN);
    await page.click('[data-action="load-github"]');
    await waitForBanner();
    api.mode = "pull-success";
    await page.fill('[data-github-field="token"]', "github_pat_valid_pull_303");
    await page.click('[data-action="load-github"]');
    await waitForToast("GitHubから読み込みました");
    await page.waitForFunction(() => !document.querySelector(".pd-auth-banner"));
    check("load成功後に認証バナーが消える", await page.locator(".pd-auth-banner").count() === 0);
    check("pull成功時刻が更新される", Boolean(await page.evaluate((key) => localStorage.getItem(key), PULL_AT_KEY)));

    console.log("[5] 進行中pullの成功後も、現在tokenが不正なら認証バナーを解除しない");
    api.mode = "pull-pending";
    let releasePull;
    api.pullGate = new Promise((resolve) => { releasePull = resolve; });
    await openSettingsGroup(page, "settings-sync");
    await page.fill('[data-github-field="token"]', "github_pat_valid_race_303");
    const pendingPullRequest = page.waitForRequest((request) =>
      request.method() === "GET"
      && decodeURIComponent(new URL(request.url()).pathname).endsWith("/contents/taskchute/app-state.json"));
    await page.click('[data-action="load-github"]');
    await pendingPullRequest;
    await page.fill('[data-github-field="token"]', INVALID_TOKEN);
    await page.click('[data-action="load-github"]');
    const raceBanner = await waitForBanner();
    check("進行中pull中の不正token差し替えで認証バナーが表示される",
      raceBanner.includes("使用できない文字"), raceBanner);
    releasePull();
    await waitForToast("GitHubから読み込みました");
    check("旧tokenのpull成功後も現在tokenの認証バナーが残る",
      await page.locator(".pd-auth-banner").count() === 1);
    check("旧tokenのpull成功後も不正token設定を維持する",
      (await storedState()).settings.github.token === INVALID_TOKEN);

    console.log("[6] autoSync pull/pushの各不正文字経路でも認証バナーを表示");
    await setStoredGithub({
      github: { token: INVALID_TOKEN }, settings: { autoSync: true },
      dataModifiedAt: "2026-08-30T10:00:00", clearSyncTimes: true
    });
    api.mode = "pull-success";
    api.requests.length = 0;
    await page.reload();
    const autoPullBanner = await waitForBanner();
    check("autoSync pullの不正文字で認証バナーが表示される", autoPullBanner.includes("使用できない文字"), autoPullBanner);
    check("autoSync pull失敗時もpull成功時刻を更新しない",
      !(await page.evaluate((key) => localStorage.getItem(key), PULL_AT_KEY)));

    await setStoredGithub({
      github: { token: "github_pat_valid_auto_303" }, settings: { autoSync: true },
      dataModifiedAt: "2026-08-30T10:00:00", clearSyncTimes: true
    });
    api.mode = "pull-success";
    await page.reload();
    await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), PULL_AT_KEY);
    await page.waitForFunction(() => !document.querySelector(".pd-auth-banner"));
    await page.clock.install({ time: new Date(2026, 7, 30, 12, 0, 0) });
    await page.click('[data-action="nav"][data-view="settings"]');
    await openSettingsGroup(page, "settings-sync");
    api.requests.length = 0;
    await page.fill('[data-github-field="token"]', INVALID_TOKEN);
    await page.clock.fastForward(3 * 60 * 1000);
    const autoPushBanner = await waitForBanner();
    check("autoSync pushの不正文字で認証バナーが表示される", autoPushBanner.includes("使用できない文字"), autoPushBanner);
    check("autoSync pushは不正headerをfetch前に拒否する", api.requests.length === 0, JSON.stringify(api.requests));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
