// v118 検証: 起動時pull(autoSync=false旧経路、syncFromGitHubOnStartup)のGET待ち中編集ロスト競合の修正。
// 指摘(taskchute-notes/review.md severity: high、対象: app.js): GET待ち中に編集すると、
// 起動時localよりremoteが新しいという古い比較結果のままremote全量を採用し、待ち中の編集を消す。
// v135追補: tasks/projectsがマージ可能コレクションに昇格した(SYNC_CORE_COMPARE_KEYSから除外)ため、
// 「GET待ち中にProjectを追加」だけの分岐は今はコア一致とみなされ自動解消される(バナー無しで
// 両方のProjectが合流する)。これはv135の意図した改善(以前は無条件で人間判断行きだった)。
// 本スイートの本来の目的=「state = adopted による全置換が起きていない」ことの検証は失われて
// いない: (a)はマージ経路である証拠として、ローカル編集とremote限定Projectの両方が生き残る
// (全置換ならローカル編集は消える)ことで確認する。(a2)は依然マージ不能なコア(questions)が
// divergentな場合、banner(人間判断)は残ることを確認する。
// (a) GET待ち中に編集(Project追加)が入ったケース → 全置換ではなくマージ経路に入り、
//     ローカルProject・remote限定Projectの両方が残る(コア一致のため自動解消・バナー無し)。
// (a2) 同時にquestions(マージ未対応のコア)もremoteで分岐している場合は、Project同士は
//      同様に合流しつつ、questionsの不一致は残るため競合バナーは出る(人間判断へ)。
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
    console.log("[1] 起動pull(legacy)のGET待ち中にProjectを追加 → 全置換ではなくマージ経路に入り、ローカル編集・remote限定Projectとも残る(v135: コア一致のため自動解消・バナー無し)");
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
    check("GET待ち中に追加したローカルProjectが消えずに残る(全置換なら消えるはず)",
      sA.projects.some((p) => p.title === "GET待ち編集マーカー_v118"),
      JSON.stringify(sA.projects.map((p) => p.title)));
    check("remote限定Projectもv135マージで取り込まれる(全置換ではなく和集合)",
      sA.projects.some((p) => p.title === "REMOTE_ONLY_PROJECT_v118"),
      JSON.stringify(sA.projects.map((p) => p.title)));
    check("Project差分のみはコア一致とみなされ自動解消、競合バナーは出ない",
      await page.locator(".sync-banner").count() === 0);

    // ============================================================
    // (a2) 同時にquestions(マージ未対応のコア)も分岐 → Projectは合流しつつバナーは出る
    // ============================================================
    console.log("[1b] questions(マージ未対応のコア)も同時に分岐している場合、Projectは合流するがバナーは残る");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-01-01T12:00:00";  // これから使うremoteより古い
      s.questions = [{ id: "q-local-1", text: "ローカル限定の問い_v118", origin: "manual", status: "open", settledNote: "", settledAt: null, lastTouchedAt: null, linkedProjectId: null, linkedTaskId: null }];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-01T13:00:00";
      remote.questions = [{ id: "q-remote-1", text: "リモート限定の問い_v118", origin: "manual", status: "open", settledNote: "", settledAt: null, lastTouchedAt: null, linkedProjectId: null, linkedTaskId: null }];
      remote.projects = [...(base.projects || []), project("remote-only-1b", "REMOTE_ONLY_PROJECT_v118b")];
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.delayGetMs = 1200;
    }
    const reloadA2 = page.reload();
    await page.waitForTimeout(300);
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(150);
    await page.fill("#projectTitle", "GET待ち編集マーカー_v118b");
    await page.click('[data-action="add-project"]');
    await reloadA2;
    await page.waitForTimeout(1800);

    const sA2 = await stateNow();
    check("[1b] ローカル編集Projectは消えない", sA2.projects.some((p) => p.title === "GET待ち編集マーカー_v118b"),
      JSON.stringify(sA2.projects.map((p) => p.title)));
    check("[1b] remote限定Projectも合流する(questionsの不一致はProjectマージを妨げない)",
      sA2.projects.some((p) => p.title === "REMOTE_ONLY_PROJECT_v118b"),
      JSON.stringify(sA2.projects.map((p) => p.title)));
    check("[1b] questions(マージ未対応)が分岐しているため競合バナーは出る",
      await page.locator(".sync-banner").count() === 1);
    const bannerText2 = await page.locator(".sync-banner").textContent().catch(() => "");
    check("[1b] バナー文言に「編集中に取得したため」の案内が含まれる", bannerText2.includes("編集中に取得したため"), bannerText2);

    // ============================================================
    // (b) 編集が無い正常ケース → remoteをベースに採用するが、v135以降はProjectもマージ可能なので
    //     採用直前にローカル限定分がremoteへ合流する(既存のjournals/blocksと同じ仕組み、
    //     v106以来「採用前にローカル限定の記録を合流させる」既存パターンにProjectも乗った)。
    // ============================================================
    console.log("[2] 起動pull(legacy)でGET待ち中の編集が無い → remoteベースで採用しつつ、v135マージでローカル限定Projectも合流する");
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
    check("remoteが採用され、remote限定Projectが反映される",
      sB.projects.some((p) => p.title === "REMOTE_ADOPTED_MARKER_v118"),
      JSON.stringify(sB.projects.map((p) => p.title)));
    check("v135: ローカル限定だったProjectもremote採用時に合流して消えない(旧仕様=消えるから変更)",
      sB.projects.some((p) => p.title === "GET待ち編集マーカー_v118"),
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
