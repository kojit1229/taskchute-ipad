// v118 検証: 起動時pull(autoSync=false旧経路、syncFromGitHubOnStartup)のGET待ち中編集ロスト競合の修正。
// 指摘(taskchute-notes/review.md severity: high、対象: app.js): GET待ち中に編集すると、
// 起動時localよりremoteが新しいという古い比較結果のままremote全量を採用し、待ち中の編集を消す。
// (a) GET待ち中に編集(Project追加=コア不一致)が入ったケース
//     → remote全量採用は中止され、編集(ローカルProject)は消えず、remote限定のProjectも
//        取り込まれない(=state = adopted による全置換が起きていない)。既存の競合バナー
//        (.sync-banner)へ送られる。
// (b) 編集が無い正常ケース → 従来どおりremoteが全量採用される(ローカル限定Projectは消え、
//     remote限定Projectが反映される)。
// 方式: v106と同じくpage.routeでapi.github.comを偽装し、app-state.jsonのGETだけ意図的に
// 遅延応答させ、遅延中にUI操作(Project追加)を注入する。
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const fixtures = { remoteJson: null, delayGetMs: 0, puts: [] };
  await page.route((url) => url.hostname === API_HOST, async (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    if (u.pathname.endsWith("/contents/taskchute/app-state.json")) {
      if (method === "PUT") {
        fixtures.puts.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-after-put" } }) });
      }
      // GET: 意図的に遅延させ、待ち中にテスト側からUI操作を注入できる隙を作る
      if (fixtures.delayGetMs) await sleep(fixtures.delayGetMs);
      if (fixtures.remoteJson === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: Buffer.from(fixtures.remoteJson, "utf-8").toString("base64"), encoding: "base64", sha: "remote-sha-1" })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  const project = (id, title, extra = {}) => ({
    id, kind: "normal", title, category: "", status: "active", priority: "中",
    twelveWeekStartDate: "", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00",
    deleted: false, ...extra
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // ゲート通過(トークン設定のみ。route偽装済みなので実APIには出ない)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "test-token-v118";
      s.settings.github.dataOwner = "kojit1229";
      s.settings.github.dataRepo = "personal-data";
      s.settings.autoSync = false;  // このスイートの対象は旧経路(autoSync=false)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);

    // ============================================================
    // (a) GET待ち中に編集 → remote全量採用が中止され競合フローに入る
    // ============================================================
    console.log("[1] 起動pull(legacy)のGET待ち中にProjectを追加 → remote全量採用が中止され、編集は消えず、remote限定Projectも取り込まれない");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-01-01T00:00:00";  // リモートより古い(比較で「remote採用」判定になる値)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-02T00:00:00";  // ローカル起動時スナップショットより新しい
      remote.projects = [...(base.projects || []), project("remote-only-1", "REMOTE_ONLY_PROJECT_v118")];
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.delayGetMs = 1200;  // この間にUI操作を注入する
    }
    const reloadA = page.reload();
    await page.waitForTimeout(300);  // GETが飛んで待機中であろうタイミング
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(150);
    await page.fill("#projectTitle", "GET待ち編集マーカー_v118");
    await page.click('[data-action="add-project"]');
    await reloadA;
    await page.waitForTimeout(1800);  // delayGetMs(1200) + 同期処理の余裕

    const sA = await stateNow();
    check("GET待ち中に追加したローカルProjectが消えずに残る",
      sA.projects.some((p) => p.title === "GET待ち編集マーカー_v118"),
      JSON.stringify(sA.projects.map((p) => p.title)));
    check("remote限定Projectは(remote全量採用が起きていないので)取り込まれない",
      !sA.projects.some((p) => p.title === "REMOTE_ONLY_PROJECT_v118"),
      JSON.stringify(sA.projects.map((p) => p.title)));
    check("既存の競合バナー(.sync-banner)へ送られる",
      await page.locator(".sync-banner").count() === 1);
    const bannerText = await page.locator(".sync-banner").textContent().catch(() => "");
    check("バナー文言に「編集中に取得したため」の案内が含まれる", bannerText.includes("編集中に取得したため"), bannerText);

    // ============================================================
    // (b) 編集が無い正常ケース → 従来どおりremoteが採用される
    // ============================================================
    console.log("[2] 起動pull(legacy)でGET待ち中の編集が無い → 従来どおりremote全量が採用される");
    fixtures.delayGetMs = 0;
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-01-03T00:00:00";  // これから使うremoteより古い
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-04T00:00:00";
      // 「GET待ち編集マーカー_v118」を含まない全量に置き換え、remote限定Projectだけを持たせる
      remote.projects = [project("remote-only-2", "REMOTE_ADOPTED_MARKER_v118")];
      fixtures.remoteJson = JSON.stringify(remote);
    }
    await page.reload();
    await page.waitForTimeout(1000);

    const sB = await stateNow();
    check("remoteが全量採用され、remote限定Projectが反映される",
      sB.projects.some((p) => p.title === "REMOTE_ADOPTED_MARKER_v118"),
      JSON.stringify(sB.projects.map((p) => p.title)));
    check("remote全量採用によりローカル限定だったProjectは(remoteに無いので)消える",
      !sB.projects.some((p) => p.title === "GET待ち編集マーカー_v118"),
      JSON.stringify(sB.projects.map((p) => p.title)));
    check("正常ケースでは競合バナーは出ない", await page.locator(".sync-banner").count() === 0);
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v118: ${failures}件失敗`); process.exit(1); }
  console.log("v118: 全チェック通過");
})();
