// v134 検証: 同期停止アラート。
// 背景(2026-07-20〜21実障害): 端末の自動push(30秒デバウンス)が約24時間無警告で停止し、
// 朝5時の日報バッチが古いリモート状態から不完全な日報を生成した。
// push/pull成功時刻を端末ローカルのlocalStorage(state本体とは別キー、他端末には同期されない)
// に記録し、閾値超過でホーム上部に赤帯の警告を出す。
// (a) 記録が無い初回状態では未push変更があってもバナーは出ない(後方互換)
// (b) push成功から6時間以上経過 かつ 未push変更あり → バナーが出る
// (c) push成功から6時間以上経過でも未push変更が無ければバナーは出ない
// (d) pull成功から24時間以上経過 → バナーが出る
// (e) 実際のpush成功(GitHubへ保存)でこの端末のpush成功時刻が記録され、設定タブにも表示される
// (f) 実際のpull成功(GitHubから読込)でこの端末のpull成功時刻が記録される
// 方式: v106と同じくpage.routeでapi.github.comを偽装し、localStorageを直接注入して観測する。
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const PUSH_KEY = "taskchute-journal-last-sync-push-at";
const PULL_KEY = "taskchute-journal-last-sync-pull-at";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// nowDateTime()と同じ "YYYY-MM-DDTHH:mm:ss" 形式(ローカル時刻、Zなし)
function isoLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function hoursAgoIso(h) { return isoLocal(new Date(Date.now() - h * 3600000)); }

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  // 既定: app-state.jsonのGETは404(remoteJson未設定時)。reloadのたびに起動pullが走るが、
  // 404はdownloadGitHubStateTextが例外を投げるため「pull失敗」扱いとなり、テストで注入した
  // PULL_KEY/PUSH_KEYの古い値が意図せず上書きされない(v106のfixtures.remoteJsonパターンを踏襲)。
  const fixtures = { remoteJson: null, puts: [] };
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    if (u.pathname.endsWith("/contents/taskchute/app-state.json")) {
      if (method === "PUT") {
        fixtures.puts.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-after-put" } }) });
      }
      if (fixtures.remoteJson === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: Buffer.from(fixtures.remoteJson, "utf-8").toString("base64"), encoding: "base64", sha: "remote-sha-1" })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() { return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY); }
  async function setLocalKV(map) {
    await page.evaluate((m) => { for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v); }, map);
  }
  async function removeKeys(keys) {
    await page.evaluate((ks) => { ks.forEach((k) => localStorage.removeItem(k)); }, keys);
  }
  async function bannerText() {
    const count = await page.locator(".sync-alert-banner").count();
    if (!count) return null;
    return page.locator(".sync-alert-banner").textContent();
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "test-token-v134";
      s.settings.github.dataOwner = "kojit1229";
      s.settings.github.dataRepo = "personal-data";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);

    console.log("[1] 記録なし(初回状態)では、未push変更があってもバナーは出ない(後方互換)");
    await removeKeys([PUSH_KEY, PULL_KEY]);
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-01-01T00:00:00";
      s.settings.lastPushedAt = "2020-01-01T00:00:00";  // dataModifiedAtと不一致=未push変更あり
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);
    check("初回状態ではバナーが出ない", await page.locator(".sync-alert-banner").count() === 0);

    console.log("[2] push成功から6時間以上 かつ 未push変更あり → 赤帯バナー");
    await setLocalKV({ [PUSH_KEY]: hoursAgoIso(7) });
    await page.reload();
    await page.waitForTimeout(600);
    const t2 = await bannerText();
    check("push停止バナーが出る", !!t2, t2);
    check("文言に「止まっています」が含まれる", !!t2 && t2.includes("止まっています"), t2);
    check("文言に経過時間(7時間)が含まれる", !!t2 && t2.includes("7時間"), t2);
    check("文言に「設定から手動保存」の案内が含まれる", !!t2 && t2.includes("手動保存"), t2);

    console.log("[3] push成功から6時間以上経過でも、未push変更が無ければバナーは出ない");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.lastPushedAt = s.dataModifiedAt;  // push済み扱いに揃える
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);
    check("未push変更が無ければバナーは出ない", await page.locator(".sync-alert-banner").count() === 0);

    console.log("[4] pull成功から24時間以上経過 → 赤帯バナー(push側は問題なし)");
    await removeKeys([PUSH_KEY]);
    await setLocalKV({ [PULL_KEY]: hoursAgoIso(25) });
    await page.reload();
    await page.waitForTimeout(600);
    const t4 = await bannerText();
    check("pull停止バナーが出る", !!t4, t4);
    check("文言に「止まっています」が含まれる", !!t4 && t4.includes("止まっています"), t4);
    check("文言に経過時間(25時間)が含まれる", !!t4 && t4.includes("25時間"), t4);

    console.log("[5] 実際のpush成功(GitHubへ保存)で、この端末のpush成功時刻が記録されバナーが消える");
    // [4]の状態のままだとpull停止バナーが残るため、pull側も許容範囲に戻す
    await setLocalKV({ [PULL_KEY]: hoursAgoIso(1) });
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-02-01T00:00:00";
      s.settings.lastPushedAt = "2020-01-01T00:00:00";  // 未push変更あり
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await setLocalKV({ [PUSH_KEY]: hoursAgoIso(7) });
    await page.reload();
    await page.waitForTimeout(600);
    check("push前提: バナーが出ている", await page.locator(".sync-alert-banner").count() === 1);
    const beforePush = Date.now();
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);
    const pushKeyVal = await page.evaluate((k) => localStorage.getItem(k), PUSH_KEY);
    const pushKeyMs = new Date(pushKeyVal).getTime();
    check("この端末のpush成功時刻が現在時刻付近に更新される", Math.abs(pushKeyMs - beforePush) < 60000, pushKeyVal);
    const settingsText = await page.locator("main").textContent();
    check("設定タブに「この端末」のpush/pull成功時刻が表示される", settingsText.includes("この端末:") && settingsText.includes("push成功"), settingsText.slice(0, 50));
    await page.click('[data-action="nav"][data-view="today"]');
    await page.waitForTimeout(200);
    check("push成功後、次の描画でバナーが消える", await page.locator(".sync-alert-banner").count() === 0);

    console.log("[6] 実際のpull成功(GitHubから読込)で、この端末のpull成功時刻が記録される");
    fixtures.remoteJson = JSON.stringify(await stateNow());
    await removeKeys([PULL_KEY]);
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    const beforePull = Date.now();
    await page.click('[data-action="load-github"]');
    await page.waitForTimeout(500);
    const pullKeyVal = await page.evaluate((k) => localStorage.getItem(k), PULL_KEY);
    check("この端末のpull成功時刻が記録される", !!pullKeyVal, pullKeyVal);
    const pullKeyMs = new Date(pullKeyVal || 0).getTime();
    check("記録時刻が現在時刻付近", !!pullKeyVal && Math.abs(pullKeyMs - beforePull) < 60000, pullKeyVal);
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v134: ${failures}件失敗`); process.exit(1); }
  console.log("v134: 全チェック通過");
})();
