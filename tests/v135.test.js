// v135 検証: tasks/projectsのマージ保護。
// 背景(実際に起きた事故、2026-07-20〜21): リモート側でtasksを外部修正(wish期日99件のNULL化)
// した30分後、端末が古いローカル状態を丸ごとpushして修正が消えた(2回発生)。tasks/projectsは
// v106のマージ可能コレクションに含まれず、同期は常に「どちらかの丸ごと採用」だったため。
// v135はidキー和集合+updatedAt比較のマージへ切り替え、push系フロー(saveToGitHub)にも
// 同じ保護を組み込んだ(旧コードはremoteの方が全体として新しい時だけ合流しており、ローカルが
// 全体として新しい時にリモートの外部修正を合流せず上書きしていた)。
// (a) リモート側でtaskのdueDateを外部修正(updatedAt付き)→端末が古いローカル(該当taskの
//     updatedAtが古い)を持ったままpush系フローに入る→修正が生き残る
// (b) 端末ローカルで編集したtask(updatedAt新)がリモート採用時に消えない
// (c) 削除(deleted=true、updatedAt新)が復活しない
// (d) updatedAt両方空の従来データ同士で従来挙動(リモート採用)と一致する後方互換
// (e) wishシングルトンProject(kind:"wish")の重複が発生しない(両端末が同期前に別々に作った場合)
// 方式: v106/v118と同じくpage.routeでapi.github.comを偽装し、localStorageを直接注入して観測する。
const { chromium, launchOptions, startServer, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const LAST_SYNCED_SHA_KEY = "taskchute-journal-last-synced-sha";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const task = (id, title, extra = {}) => ({
  id, projectId: "", parentTaskId: "", title, category: "", status: "todo",
  dueDate: "", description: "", leverageType: "", aiWork: false, aiWorkBrief: "",
  progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "", criteriaRequest: false,
  selfDueOff: false, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
  realized: false, realizedDate: "", nextRoutineId: "",
  createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00", deleted: false, ...extra
});
const project = (id, title, extra = {}) => ({
  id, kind: "normal", title, category: "", status: "active", priority: "中", showProgress: false,
  twelveWeekStartDate: "", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00",
  deleted: false, ...extra
});

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const fixtures = { remoteJson: null, remoteSha: "remote-sha-1", puts: [] };
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
        body: JSON.stringify({ content: Buffer.from(fixtures.remoteJson, "utf-8").toString("base64"), encoding: "base64", sha: fixtures.remoteSha })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() { return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY); }
  function lastPut() {
    const raw = fixtures.puts[fixtures.puts.length - 1];
    if (!raw) return null;
    const body = JSON.parse(raw);
    return JSON.parse(Buffer.from(body.content, "base64").toString("utf-8"));
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "test-token-v135";
      s.settings.github.dataOwner = "kojit1229";
      s.settings.github.dataRepo = "personal-data";
      s.settings.autoSync = false;  // push系フロー(手動save-github)を素直に検証するためOFF
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);

    // ============================================================
    // (a) push系フロー: リモートの外部修正(updatedAt付き)が、ローカルが全体として新しくても
    //     生き残る(2026-07-20〜21事故の直接再現)
    // ============================================================
    console.log("[a] リモート外部修正(dueDate、updatedAt付き) → ローカルが全体として新しくてもpushで消えない");
    await page.evaluate(({ KEY, LAST_SYNCED_SHA_KEY, t }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [...s.tasks, t];
      s.dataModifiedAt = "2026-01-03T00:00:00";  // ローカルが全体としては新しい(旧コードだとここで合流が起きない)
      s.settings.lastPushedAt = "2026-01-03T00:00:00";  // 未push変更なし(pushガードに引っかからないように)
      localStorage.setItem(KEY, JSON.stringify(s));
      localStorage.setItem(LAST_SYNCED_SHA_KEY, "sha-before-a");  // 既に一度同期済みという体
    }, { KEY, LAST_SYNCED_SHA_KEY, t: task("t-a", "外部修正されるタスク", { dueDate: "2026-01-10", updatedAt: "2026-01-01T00:00:00" }) });
    // v136追補: localStorageへの直接注入は、reloadしないと実行中ページのメモリ上state(loadState()は
    // 起動時1回しか走らない)に反映されない。reloadせずクリックだけすると、pushされる内容は
    // 「ローカルにt-aが無く、remoteのt-aだけ和集合で追加された」偽陽性になり、本来検証したい
    // 「同一idで新旧が競合し、新しい方が勝つ」ケースを検証できていなかった(この時点ではremote
    // フィクスチャ未設定=GET 404のため、このreloadはstateのハイドレートのみが目的で無害)。
    await page.reload();
    await page.waitForTimeout(600);
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-02T12:00:00";  // 全体としてはローカルより古い
      remote.tasks = remote.tasks.map((t) => t.id === "t-a"
        ? { ...t, dueDate: "2026-01-20", updatedAt: "2026-01-02T00:00:00" }  // 外部修正。updatedAtはローカルより新しい
        : t);
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.remoteSha = "sha-external-edit-a";  // lastSyncedSha("sha-before-a")と異なる = リモートが動いた
    }
    fixtures.puts.length = 0;
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    // v148(UI改善計画Phase3-2)以降、save-githubは「データと同期」群のdetails内にあり既定closed。
    // <summary>を実クリックして開く。
    await openSettingsGroup(page, "settings-sync");
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);

    const pushedA = lastPut();
    check("[a] pushされた内容にリモートの外部修正(dueDate=2026-01-20)が反映されている",
      !!pushedA && pushedA.tasks.find((t) => t.id === "t-a")?.dueDate === "2026-01-20",
      JSON.stringify(pushedA && pushedA.tasks.find((t) => t.id === "t-a")));
    const sA = await stateNow();
    check("[a] ローカルstateにも外部修正が取り込まれている", sA.tasks.find((t) => t.id === "t-a")?.dueDate === "2026-01-20",
      JSON.stringify(sA.tasks.find((t) => t.id === "t-a")));

    // ============================================================
    // (b) pull(remote採用)時: ローカルで編集したtask(updatedAt新)が消えない
    // ============================================================
    console.log("[b] リモート採用(remoteが全体として新しい)でも、ローカル編集(updatedAt新)のtaskは消えない");
    await page.evaluate(({ KEY, t }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [...s.tasks, t];
      s.dataModifiedAt = "2026-02-01T00:00:00";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, t: task("t-b", "ローカルで編集したタスク", { title: "ローカルで編集したタスク(新)", updatedAt: "2026-02-01T00:00:00" }) });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-02-02T00:00:00";  // 全体としてはremoteが新しい → adopt経路
      remote.tasks = remote.tasks.map((t) => t.id === "t-b"
        ? { ...t, title: "リモートの古い内容", updatedAt: "2026-01-25T00:00:00" }  // ローカルより古い
        : t);
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.remoteSha = "sha-b";
    }
    await page.reload();
    await page.waitForTimeout(1000);
    const sB = await stateNow();
    check("[b] リモート採用後もローカルの新しい編集内容が残る(古いremote内容で上書きされない)",
      sB.tasks.find((t) => t.id === "t-b")?.title === "ローカルで編集したタスク(新)",
      JSON.stringify(sB.tasks.find((t) => t.id === "t-b")));

    // ============================================================
    // (c) 削除(deleted:true、updatedAt新)は復活しない
    // ============================================================
    console.log("[c] ローカルで削除した(deleted:true, updatedAt新)taskは、remoteの古い生存コピーで復活しない");
    await page.evaluate(({ KEY, t }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [...s.tasks, t];
      s.dataModifiedAt = "2026-03-01T00:00:00";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, t: task("t-c", "削除されるタスク", { deleted: true, updatedAt: "2026-03-01T00:00:00" }) });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-03-02T00:00:00";
      remote.tasks = remote.tasks.map((t) => t.id === "t-c"
        ? { ...t, deleted: false, updatedAt: "2026-02-25T00:00:00" }  // 削除より古い生存コピー
        : t);
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.remoteSha = "sha-c";
    }
    await page.reload();
    await page.waitForTimeout(1000);
    const sC = await stateNow();
    check("[c] 新しい削除(tombstone)が古い生存コピーに復活させられない",
      sC.tasks.find((t) => t.id === "t-c")?.deleted === true,
      JSON.stringify(sC.tasks.find((t) => t.id === "t-c")));

    // ============================================================
    // (d) 後方互換: updatedAt両方空の従来データ同士は remote 採用(従来挙動)と一致する
    // ============================================================
    console.log("[d] updatedAt両方空(レガシーデータ)の同一idは、従来どおりremote側の値を採用する");
    await page.evaluate(({ KEY, t }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [...s.tasks, t];
      s.dataModifiedAt = "2026-04-01T00:00:00";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, t: task("t-d", "ローカルのレガシータスク", { updatedAt: "" }) });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-04-02T00:00:00";
      remote.tasks = remote.tasks.map((t) => t.id === "t-d"
        ? { ...t, title: "リモートのレガシータスク", updatedAt: "" }  // 両方空
        : t);
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.remoteSha = "sha-d";
    }
    await page.reload();
    await page.waitForTimeout(1000);
    const sD = await stateNow();
    check("[d] updatedAt両方空はremote側の値が採用される(従来のremote全量採用と一致)",
      sD.tasks.find((t) => t.id === "t-d")?.title === "リモートのレガシータスク",
      JSON.stringify(sD.tasks.find((t) => t.id === "t-d")));

    // ============================================================
    // (e) wishシングルトンの重複防止: 両端末が別々にWish Projectを作っていた場合、
    //     マージ後も1つに保たれ、子Taskは正本へ付け替えられる
    // ============================================================
    console.log("[e] 両端末が別々に作ったWish Project(kind:wish)がマージ後も重複しない");
    await page.evaluate(({ KEY, wishLocal, taskUnderLocal }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      // 既存のWish Project(normalizeStateが保証する分)を、より古いcreatedAtの専用Wishへ差し替える
      s.projects = s.projects.map((p) => p.kind === "wish"
        ? { ...wishLocal, id: p.id }  // 既存の唯一のwish idはそのまま(正本として残ってほしい)
        : p);
      s.tasks = [...s.tasks, { ...taskUnderLocal, projectId: s.projects.find((p) => p.kind === "wish").id }];
      s.dataModifiedAt = "2026-05-01T00:00:00";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, {
      KEY,
      wishLocal: project("wish-local-placeholder", "Wish", { kind: "wish", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00" }),
      taskUnderLocal: task("t-wish-local", "ローカルWishの子タスク", { updatedAt: "2026-01-01T00:00:00" })
    });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-05-02T00:00:00";
      const localWishId = base.projects.find((p) => p.kind === "wish").id;
      // remoteは同期前に別々に自分のWish Projectを作っていた体(別id、createdAtが新しい=非正本)
      remote.projects = [
        ...remote.projects.filter((p) => p.id !== localWishId),  // remote視点ではローカルのwish idは知らない
        project("wish-remote-dup", "Wish", { kind: "wish", createdAt: "2026-04-01T00:00:00", updatedAt: "2026-04-01T00:00:00" })
      ];
      remote.tasks = [...remote.tasks, task("t-wish-remote", "リモートWishの子タスク", { projectId: "wish-remote-dup", updatedAt: "2026-04-01T00:00:00" })];
      fixtures.remoteJson = JSON.stringify(remote);
      fixtures.remoteSha = "sha-e";
    }
    await page.reload();
    await page.waitForTimeout(1000);
    const sE = await stateNow();
    const liveWishes = sE.projects.filter((p) => p.kind === "wish" && !p.deleted);
    check("[e] マージ後もWish Projectは1つだけ(重複しない)", liveWishes.length === 1, JSON.stringify(liveWishes.map((p) => ({ id: p.id, createdAt: p.createdAt }))));
    check("[e] 正本は最も古いcreatedAtの方(ローカル側)", liveWishes[0]?.createdAt === "2026-01-01T00:00:00", JSON.stringify(liveWishes[0]));
    const canonicalId = liveWishes[0]?.id;
    const localChild = sE.tasks.find((t) => t.id === "t-wish-local");
    const remoteChild = sE.tasks.find((t) => t.id === "t-wish-remote");
    check("[e] ローカルWishの子タスクは正本projectIdのまま", localChild?.projectId === canonicalId, JSON.stringify(localChild));
    check("[e] リモートWishの子タスクは正本へ付け替えられる(消えない)", remoteChild?.projectId === canonicalId, JSON.stringify(remoteChild));
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v135: ${failures}件失敗`); process.exit(1); }
  console.log("v135: 全チェック通過");
})();
