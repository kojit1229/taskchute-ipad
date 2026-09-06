// v118 検証: 起動時pull(autoSync=false旧経路、syncFromGitHubOnStartup)のGET待ち中編集ロスト競合の修正。
// 指摘(taskchute-notes/review.md severity: high、対象: app.js): GET待ち中に編集すると、
// 起動時localよりremoteが新しいという古い比較結果のままremote全量を採用し、待ち中の編集を消す。
// v135追補: tasks/projectsがマージ可能コレクションに昇格した(SYNC_CORE_COMPARE_KEYSから除外)ため、
// 「GET待ち中にProjectを追加」だけの分岐は今はコア一致とみなされ自動解消される(バナー無しで
// 両方のProjectが合流する)。これはv135の意図した改善(以前は無条件で人間判断行きだった)。
// 本スイートの本来の目的=「state = adopted による全置換が起きていない」ことの検証は失われて
// いない: (a)はマージ経路である証拠として、ローカル編集とremote限定Projectの両方が生き残る
// (全置換なら消えるはず)を(a)で維持する。質問は現在ID和集合なので(a2)で両側保全を測る。
// 控え保存失敗(a3)と一次設定vision競合(a4)では全体保全・本体PUT0・案内を検査する。
// 全GitHub通信はrouteで模擬し、backup PUTとapp-state PUTを分ける。
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

  const fixtures = { remoteJson: null, remoteSha: "remote-sha-1", holdGet: false, pendingGetReleases: [], heldGetStarted: null, puts: [], backups: [], backupStatus: 200, holdBackup: false, releaseBackup: null };
  await page.route((url) => url.hostname === API_HOST, async (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    if (method === "PUT" && /app-state-\d{4}-\d{2}-\d{2}-preload-\d{6}\.json$/.test(u.pathname)) {
      fixtures.backups.push(JSON.parse(Buffer.from(JSON.parse(route.request().postData()).content, "base64").toString("utf8")));
      if (fixtures.holdBackup) await new Promise(resolve => { fixtures.releaseBackup = resolve; });
      return route.fulfill({ status: fixtures.backupStatus, contentType: "application/json",
        body: JSON.stringify(fixtures.backupStatus === 200 ? { content: { sha: "backup-sha" } } : { message: "fixture backup denied" }) });
    }
    if (u.pathname.endsWith("/contents/taskchute/app-state.json")) {
      if (method === "PUT") {
        fixtures.puts.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-after-put" } }) });
      }
      // GET: テスト側が編集を終えるまで応答を保留し、固定時間に依存せず競合窓を作る。
      if (fixtures.holdGet) await new Promise((resolve) => {
        fixtures.pendingGetReleases.push(resolve);
        fixtures.heldGetStarted?.(); fixtures.heldGetStarted = null;
      });
      if (fixtures.remoteJson === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: Buffer.from(fixtures.remoteJson, "utf-8").toString("base64"), encoding: "base64", sha: fixtures.remoteSha })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function waitForAppStateGet() {
    // requestイベントはroute保留より先に届く。実際に保留した時点を待つ。
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fixtures.heldGetStarted = null;
        reject(new Error("app-state GETが30秒以内に保留されませんでした"));
      }, 30000);
      fixtures.heldGetStarted = () => { clearTimeout(timer); resolve(); };
    });
  }

  function releaseHeldGets() {
    fixtures.holdGet = false;
    fixtures.pendingGetReleases.splice(0).forEach((resolve) => resolve());
  }

  async function addProjectDuringPendingGet(title) {
    // v328: 追加フォームは既定closed。実際の＋追加導線で開いてから保存する。
    check("Project操作は保留GETの競合窓内で行う", fixtures.holdGet && fixtures.pendingGetReleases.length > 0);
    const beforeOpen = await stateNow();
    const input = page.locator("#projectTitle");
    await input.waitFor({ state: "attached" });
    check("追加前はProject入力が折りたたまれている", !await input.isVisible());
    await page.locator(".wbs-add-menu > summary").click();
    check("追加パネルを開くだけではProjectを変更しない",
      JSON.stringify((await stateNow()).projects) === JSON.stringify(beforeOpen.projects));
    await input.waitFor({ state: "visible" });
    await input.fill(title);
    await page.locator('[data-action="add-project"]').click();
    await page.waitForFunction(({ KEY, title }) => JSON.parse(localStorage.getItem(KEY)).projects
      .some((entry) => entry.title === title), { KEY, title });
    const created = (await stateNow()).projects.filter(entry => entry.title === title);
    check("1回の追加でProjectが1件だけ永続化される", created.length === 1 && Boolean(created[0].id)
      && created[0].kind === "normal" && created[0].status === "active");
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
      // v278: reload後の遅延GET中にProject入力だけを競合させ、無関係なタブ遷移競合を混ぜない。
      s.currentView = "wbs";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-02T00:00:00";  // ローカル起動時スナップショットより新しい
      remote.projects = [...(base.projects || []), project("remote-only-1", "REMOTE_ONLY_PROJECT_v118")];
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.holdGet = true;
    }
    const getA = waitForAppStateGet();
    const reloadA = page.reload();
    await getA;  // 遅延GETが実際に始まり、編集を差し込む窓が成立したことを待つ
    await addProjectDuringPendingGet("GET待ち編集マーカー_v118");
    releaseHeldGets();
    await reloadA;
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).projects
      .some((entry) => entry.title === "REMOTE_ONLY_PROJECT_v118"), KEY);

    const sA = await stateNow();
    check("GET待ち中に追加したローカルProjectが消えずに残る(全置換なら消えるはず)",
      sA.projects.some((p) => p.title === "GET待ち編集マーカー_v118"),
      JSON.stringify(sA.projects.map((p) => p.title)));
    check("remote限定Projectもv135マージで取り込まれる(全置換ではなく和集合)",
      sA.projects.some((p) => p.title === "REMOTE_ONLY_PROJECT_v118"),
      JSON.stringify(sA.projects.map((p) => p.title)));
    check("Project差分のみはコア一致とみなされ自動解消、競合バナーは出ない",
      await page.locator(".sync-error-banner").count() === 0);

    // (a2-a4) 同じGET中編集を成功/控え失敗/一次設定競合の各境界へ流す。
    for (const mode of ["success", "backup-failure", "vision-conflict"]) {
      console.log(`[1b/${mode}] questions ID和集合と採用前保護`);
      fixtures.remoteSha = `remote-sha-${mode}`;
      fixtures.backups = []; fixtures.puts = []; fixtures.backupStatus = mode === "backup-failure" ? 503 : 200;
      fixtures.holdBackup = mode === "success";
      await page.evaluate(({ KEY, mode }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.dataModifiedAt = "2026-01-01T12:00:00"; s.settings.lastPushedAt = "2026-01-01T11:00:00";
        s.settings.vision = "local vision"; s.currentView = "wbs";
        s.questions = [{ id: `q-local-${mode}`, text: "local question", origin: "manual", status: "open" }];
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, mode });
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-01T13:00:00";
      remote.questions = [{ id: `q-remote-${mode}`, text: "remote question", origin: "manual", status: "open" }];
      remote.projects.push(project(`remote-${mode}`, `REMOTE_${mode}`));
      if (mode === "vision-conflict") remote.settings.vision = "remote vision";
      fixtures.remoteJson = JSON.stringify(remote);
      const remoteBefore = fixtures.remoteJson;
      fixtures.holdGet = true;
      const held = waitForAppStateGet(); const reload = page.reload(); await held;
      await addProjectDuringPendingGet(`LOCAL_${mode}`);
      const rawBefore = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
      const stateBefore = await page.evaluate(async () => JSON.stringify((await import("./src/state/store.js")).state));
      releaseHeldGets(); await reload;
      if (mode === "success") {
        // The route remains held: poll a local flag with a bounded deadline, never a fixed success delay.
        const deadline = Date.now() + 30000;
        while (!fixtures.releaseBackup && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        if (!fixtures.releaseBackup) throw new Error("backup request not observed");
        check("控え成功前にRAWを変更しない", await page.evaluate(KEY => localStorage.getItem(KEY), KEY) === rawBefore);
        fixtures.holdBackup = false; fixtures.releaseBackup(); fixtures.releaseBackup = null;
        await page.waitForFunction(({ KEY, mode }) => JSON.parse(localStorage.getItem(KEY)).projects.some(p => p.id === `remote-${mode}`), { KEY, mode });
        const adopted = await stateNow();
        check("両側Projectを保持", adopted.projects.some(p => p.title === `LOCAL_${mode}`) && adopted.projects.some(p => p.id === `remote-${mode}`));
        check("両側questionsを一度だけ保持", ["local", "remote"].every(side => adopted.questions.filter(q => q.id === `q-${side}-${mode}`).length === 1));
        check("控えは採用前のlocal質問/Projectを保持", fixtures.backups.length === 1 && fixtures.backups[0].questions.some(q => q.id === `q-local-${mode}`)
          && !fixtures.backups[0].questions.some(q => q.id === `q-remote-${mode}`) && fixtures.backups[0].projects.some(p => p.title === `LOCAL_${mode}`));
        check("成功後は競合表示なし", await page.locator(".sync-error-banner").count() === 0);
      } else {
        await page.locator(".sync-error-banner").waitFor({ state: "visible" });
        check("失敗時RAW完全保持", await page.evaluate(KEY => localStorage.getItem(KEY), KEY) === rawBefore);
        check("失敗時live state完全保持", await page.evaluate(async () => JSON.stringify((await import("./src/state/store.js")).state)) === stateBefore);
        check("控え試行境界", fixtures.backups.length === (mode === "backup-failure" ? 1 : 0));
        await page.locator('.sync-banner-message [data-view="settings"]').click();
        const banner = await page.locator(".sync-error-detail").textContent();
        check("具体的な失敗/競合案内", mode === "vision-conflict" ? banner.includes("一次設定") : banner.includes("取り込みと保存を中止"), banner);
      }
      check("app-state PUT0", fixtures.puts.length === 0);
      check("remote原本不変", fixtures.remoteJson === remoteBefore);
    }

    // ============================================================
    // (b) 編集が無い正常ケース → remoteをベースに採用するが、v135以降はProjectもマージ可能なので
    //     採用直前にローカル限定分がremoteへ合流する(既存のjournals/blocksと同じ仕組み、
    //     v106以来「採用前にローカル限定の記録を合流させる」既存パターンにProjectも乗った)。
    // ============================================================
    console.log("[2] 起動pull(legacy)でGET待ち中の編集が無い → remoteベースで採用しつつ、v135マージでローカル限定Projectも合流する");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-01-03T00:00:00"; s.settings.lastPushedAt = s.dataModifiedAt;  // これから使うremoteより古い
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
    check("正常ケースでは競合バナーは出ない", await page.locator(".sync-error-banner").count() === 0);
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    releaseHeldGets();
    fixtures.releaseBackup?.();
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v118: ${failures}件失敗`); process.exit(1); }
  console.log("v118: 全チェック通過");
})();
