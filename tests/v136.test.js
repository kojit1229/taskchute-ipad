// v136 検証: Claude reviewer + Codexレビューで検出されたHigh3件・Med4件への対応。
// (1) High: saveToGitHubのfail-open修正。SHA不一致検知後、リモート本文取得失敗/マージ不能の
//     場合は保存を中止する(fail-closed)。読めなかったリモート変更をローカル全量で上書きしない。
// (2) High: mergeByIdPreferNewerにtieWinner("local"|"remote")を追加。呼び出し分岐の文脈
//     (ローカルを基準に残す経路=local、リモートを採用する経路=remote)で明示する。
// (3) High: 同秒タイでは削除(トゥームストーン)側を優先する(同じ秒にlocal削除・remote編集→復活を防ぐ)。
// (6) Med: 手動保存・legacy自動保存の成功時にもlastPushedAtを更新し、v134赤帯の偽陽性を解消。
// (7) Med: remote SHAが空(ファイル消失)の場合も、初回セットアップと区別して競合経路へ送る
//     (fail-closedとして(1)と同じ経路で保存を中止する)。
// (5) Med: kind:"other"シングルトン(Project/Task)の重複防止をwishと同様にガードする。
// シナリオ(2)(3)(5)は本ファイル後続コミットで追記する(node tests/v136.test.js で通しで実行される)。
// 方式: v106/v118/v135と同じくpage.routeでapi.github.comを偽装し、localStorageを直接注入して観測する。
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const LAST_SYNCED_SHA_KEY = "taskchute-journal-last-synced-sha";
const LAST_SYNC_PUSH_KEY = "taskchute-journal-last-sync-push-at";
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

  // fixtures.getMode: "normal"(remoteJson/remoteSha返す) | "blob-fail"(sha付き・content無しで
  // blob API経由を強制し、blob APIは未モックのため404で失敗させる) | "404"(GET自体を404にする)
  const fixtures = { remoteJson: null, remoteSha: "remote-sha-1", getMode: "normal", puts: [] };
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    if (u.pathname.endsWith("/contents/taskchute/app-state.json")) {
      if (method === "PUT") {
        fixtures.puts.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-after-put" } }) });
      }
      if (fixtures.getMode === "404") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      if (fixtures.getMode === "blob-fail") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: fixtures.remoteSha }) });
      }
      if (fixtures.remoteJson === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: Buffer.from(fixtures.remoteJson, "utf-8").toString("base64"), encoding: "base64", sha: fixtures.remoteSha })
      });
    }
    // /git/blobs/... は意図的に未モック(404) → blob-fail経路の取得失敗を再現する
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
      s.settings.github.token = "test-token-v136";
      s.settings.github.dataOwner = "kojit1229";
      s.settings.github.dataRepo = "personal-data";
      s.settings.autoSync = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);

    // ============================================================
    // [1] High-1: fail-closed。リモート本文の取得に失敗した場合、保存を中止しローカルを温存する
    // ============================================================
    console.log("[1] SHA不一致検知後、リモート取得が失敗 → 保存を中止(fail-closed)。PUTは送られずローカルも変わらない");
    await page.evaluate(({ KEY, LAST_SYNCED_SHA_KEY, t }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [...s.tasks, t];
      s.dataModifiedAt = "2026-01-03T00:00:00";
      s.settings.lastPushedAt = "2020-01-01T00:00:00";  // 未push変更あり
      localStorage.setItem(KEY, JSON.stringify(s));
      localStorage.setItem(LAST_SYNCED_SHA_KEY, "sha-before-1");
    }, { KEY, LAST_SYNCED_SHA_KEY, t: task("t-1", "ローカルのタスク(温存されるべき)") });
    // localStorageへの直接注入は、reloadしないと実行中ページのメモリ上state(loadState()は
    // 起動時1回しか走らない)に反映されない。reload無しだと、バックグラウンドの何らかの保存が
    // 古いメモリ上stateでlocalStorageを上書きし、注入した値が消えて見える偽陽性/偽陰性の
    // リスクがある(v135(a)で実際に踏んだ)。この時点ではremoteフィクスチャ未設定=GET 404の
    // ため、このreloadはstateのハイドレートのみが目的で無害。
    await page.reload();
    await page.waitForTimeout(600);
    fixtures.getMode = "blob-fail";
    fixtures.remoteSha = "sha-remote-1";  // lastSyncedSha("sha-before-1")と異なる
    fixtures.puts.length = 0;
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);
    check("[1] PUTは送られない(fail-closed)", fixtures.puts.length === 0, `puts=${fixtures.puts.length}`);
    const s1 = await stateNow();
    check("[1] ローカルのタスクは変わらず残る", s1.tasks.find((t) => t.id === "t-1")?.title === "ローカルのタスク(温存されるべき)",
      JSON.stringify(s1.tasks.find((t) => t.id === "t-1")));
    const banner1 = await page.locator(".sync-banner").textContent().catch(() => "");
    check("[1] 「取得できなかった」旨のバナーが出る", banner1.includes("取得できなかった"), banner1);

    // ============================================================
    // [7] Med-7: remote SHAが空(404、ファイル消失)でも初回セットアップと区別し保存を中止する
    // ============================================================
    console.log("[7] 既に同期済みの端末でremoteが404(消失) → 暗黙のSHA無しPUTで再作成せず保存を中止する");
    fixtures.getMode = "404";
    fixtures.puts.length = 0;
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);
    check("[7] remote消失でもPUTは送られない(暗黙の再作成をしない)", fixtures.puts.length === 0, `puts=${fixtures.puts.length}`);

    // ============================================================
    // [6] Med-6: 手動保存成功後、lastPushedAtが更新され、v134の赤帯偽陽性が出ない
    // ============================================================
    console.log("[6] 手動保存が成功すればlastPushedAtが更新され、後で赤帯(同期停止アラート)の偽陽性が出ない");
    fixtures.getMode = "normal";
    fixtures.remoteJson = null;  // GET 404(新規作成扱い)。lastSynced="sha-before-1"と食い違うが…
    // 直前の[1][7]でGETが失敗し続けたため、この端末はまだ一度も同期成功していない状態
    // (lastSyncedSha相当は"sha-before-1"のまま)。ここでは「一度も同期していない」前提を
    // 明示的に作り直すため、lastSyncedSha自体をクリアして純粋な初回保存として検証する。
    await page.evaluate((k) => localStorage.removeItem(k), LAST_SYNCED_SHA_KEY);
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = "2026-02-01T00:00:00";
      s.settings.lastPushedAt = "2020-01-01T00:00:00";  // 未push変更あり
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    fixtures.puts.length = 0;
    await page.click('[data-action="save-github"]');
    await page.waitForTimeout(500);
    check("[6] 手動保存が成功する(PUTが送られる)", fixtures.puts.length === 1, `puts=${fixtures.puts.length}`);
    const s6 = await stateNow();
    check("[6] 保存成功後、lastPushedAtがdataModifiedAtに揃う", s6.settings.lastPushedAt === s6.dataModifiedAt,
      `lastPushedAt=${s6.settings.lastPushedAt} dataModifiedAt=${s6.dataModifiedAt}`);
    // 「push成功から7時間経過」を人為的に作り、未push変更が無いので赤帯が出ないことを確認する
    await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: LAST_SYNC_PUSH_KEY, v: hoursAgoIso(7) });
    await page.reload();
    await page.waitForTimeout(600);
    check("[6] 変更なしで6時間以上経過しても赤帯は出ない(偽陽性の解消)", await page.locator(".sync-alert-banner").count() === 0);
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v136: ${failures}件失敗`); process.exit(1); }
  console.log("v136: 全チェック通過");
})();
