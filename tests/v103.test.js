// v103 検証: 0秒思考(zeroThinking.entries[]/suggestedThemes[])のpull時双方向マージ。
// CHANGES_v103.md参照。
//
// 実害: iPhoneで書いた0秒思考entryがサーバー(app-state.json)へ到達済みでも、PC側の
// dataModifiedAtの方が新しいと「remoteは古い」と判定して起動時pullが全量スキップし、
// iPhoneの記録がPCで見えなくなる(K報告 2026-07-15)。このままPCが保存するとサーバー側の
// iPhone分ごと上書きされ消えるリスクがあった。
//
// (a) 本命: ローカルが新しい状態での起動pull → リモート限定のentriesがローカルへ合流して
//     表示される(dataModifiedAtも更新され、次回pushで届く状態になる)
// (b) リモート採用時(remoteが新しい)にローカル限定のentriesが失われない(union)
// (c) 同一idの重複が生じない(新しい方のupdatedAtが勝つ)
// (d) themesはマージされない(ローカルで削除したテーマがリモートから復活しない)
// (e) 期限切れsuggestedThemesが合流してもTTL剪定で即座に消える
// (f) リモート取得失敗時に既存動作(マージなし・ローカル保持)を維持する
// 補足: runAutoSyncPull(自動同期ON)/手動loadFromGitHub(GitHubから読込ボタン)でも
//       同じ合流が働くことを1ケースずつ追加確認する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  // v103注記: 固定時刻は「本日中に使う全ての合成タイムスタンプ(07:00〜20:00台)より後」に
  // 置く必要がある。マージ時のdataModifiedAtの「今」への更新(nowDateTime())がこの固定時刻を
  // 使うため、固定時刻が合成タイムスタンプより前だと「更新されたのに古い値に見える」誤検知になる。
  now0.setHours(22, 0, 0, 0);  // 日中固定(深夜跨ぎ回避、他スイートと同じ理由)
  const TODAY = isoDate(now0);

  // Contents API の小サイズ応答(base64、GitHub実挙動と同じく60文字ごとに改行を挟む)
  function contentsBodyFor(obj) {
    const jsonText = JSON.stringify(obj);
    const b64 = Buffer.from(jsonText, "utf-8").toString("base64");
    const chunked = (b64.match(/.{1,60}/g) || []).join("\n");
    return JSON.stringify({ name: "app-state.json", path: "taskchute/app-state.json", sha: "sha-v103", content: chunked, encoding: "base64" });
  }

  // 最小限だが normalizeState を安全に通せるリモートstateの骨格
  function remoteState(dataModifiedAt, ztOverrides) {
    return {
      dataModifiedAt,
      currentView: "zero",
      selectedDate: TODAY,
      blocks: [], projects: [], tasks: [], settings: {},
      zeroThinking: { themes: [], entries: [], groups: [], suggestedThemes: [], ...ztOverrides }
    };
  }

  const fixtures = { status: 404, body: null };  // status: 404=未設定 | 200=正常 | 500=取得失敗
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`) {
      if (fixtures.status === 200) return route.fulfill({ status: 200, contentType: "application/json", body: fixtures.body });
      if (fixtures.status === 500) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "internal error (test-fixture)" }) });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);  // token/dataOwner/dataRepo投入 + reload(この時点のsyncは404で何もしない)

    // ============================================================
    // (a) 本命 + (c) 同一idの重複無し: ローカルが新しい状態での起動pull
    // ============================================================
    console.log("[1] ローカルが新しい状態の起動pullで、リモート限定のentriesが合流し表示される(重複なし・dataModifiedAt更新)");
    const LOCAL_ONLY = { id: "e-local-only", date: TODAY, theme: "ローカル限定テーマ", body: "ローカルだけにあるentry_v103", questionId: null, createdAt: `${TODAY}T09:00:00`, updatedAt: null };
    const DUP_LOCAL_OLD = { id: "e-dup", date: TODAY, theme: "重複テーマ", body: "ローカルの古い内容_v103", questionId: null, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00` };
    const LOCAL_T = `${TODAY}T12:00:00`;  // ローカルの方が新しい

    await page.evaluate(({ KEY, LOCAL_T, LOCAL_ONLY, DUP_LOCAL_OLD }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = LOCAL_T;
      s.zeroThinking = { themes: [], entries: [LOCAL_ONLY, DUP_LOCAL_OLD], groups: [], suggestedThemes: [] };
      s.settings.lastPushedAt = LOCAL_T;  // 未push変更なし(まっさらな同期済み状態から始める)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_T, LOCAL_ONLY, DUP_LOCAL_OLD });

    const REMOTE_ONLY = { id: "e-remote-only", date: TODAY, theme: "リモート限定テーマ", body: "サーバー到達済みentry_v103_マーカー", questionId: null, createdAt: `${TODAY}T07:00:00`, updatedAt: null };
    const DUP_REMOTE_NEW = { id: "e-dup", date: TODAY, theme: "重複テーマ", body: "リモートの新しい内容_v103", questionId: null, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T11:00:00` };
    const REMOTE_T = `${TODAY}T09:00:00`;  // ローカルより古い(=(b)スキップ判定パス)
    fixtures.status = 200;
    fixtures.body = contentsBodyFor(remoteState(REMOTE_T, { entries: [REMOTE_ONLY, DUP_REMOTE_NEW] }));

    await page.reload();
    await page.waitForTimeout(700);

    const after1 = await stateNow();
    const entries1 = (after1.zeroThinking && after1.zeroThinking.entries) || [];
    check("ローカル限定entryが保持されている", entries1.some((e) => e.id === "e-local-only"), JSON.stringify(entries1.map((e) => e.id)));
    check("リモート限定entryが合流している", entries1.some((e) => e.id === "e-remote-only"), JSON.stringify(entries1.map((e) => e.id)));
    check("同一id(e-dup)は1件のみ(重複していない)", entries1.filter((e) => e.id === "e-dup").length === 1, JSON.stringify(entries1));
    const dupEntry1 = entries1.find((e) => e.id === "e-dup");
    check("同一idはupdatedAtが新しいリモート側の内容が採用される", !!dupEntry1 && dupEntry1.body === "リモートの新しい内容_v103", JSON.stringify(dupEntry1));
    check("マージで変化が生じたためdataModifiedAtがローカル時刻より更新されている(次回pushで届く)",
      after1.dataModifiedAt > LOCAL_T, `dataModifiedAt=${after1.dataModifiedAt} LOCAL_T=${LOCAL_T}`);

    await page.click('[data-action="nav"][data-view="zero"]');
    await page.waitForTimeout(200);
    const zeroText1 = await page.locator("main").textContent();
    check("画面にもリモート限定entryのテーマが表示される", zeroText1.includes("リモート限定テーマ"), zeroText1.slice(0, 300));

    // ============================================================
    // (b) リモート採用時にローカル限定entriesが失われない
    // ============================================================
    console.log("[2] リモートが新しい状態での起動pull(リモート採用)でも、ローカル限定entriesが失われない");
    const LOCAL_ONLY_2 = { id: "e-local-only-2", date: TODAY, theme: "採用時ローカル限定", body: "採用されても残るべきentry_v103", questionId: null, createdAt: `${TODAY}T09:30:00`, updatedAt: null };
    const LOCAL_T2 = `${TODAY}T10:00:00`;
    await page.evaluate(({ KEY, LOCAL_ONLY_2, LOCAL_T2 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = LOCAL_T2;
      s.zeroThinking = { themes: [], entries: [LOCAL_ONLY_2], groups: [], suggestedThemes: [] };
      s.settings.lastPushedAt = LOCAL_T2;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_ONLY_2, LOCAL_T2 });

    const REMOTE_ONLY_2 = { id: "e-remote-only-2", date: TODAY, theme: "採用時リモート限定", body: "リモート採用で入るentry_v103", questionId: null, createdAt: `${TODAY}T13:00:00`, updatedAt: null };
    const REMOTE_T2 = `${TODAY}T14:00:00`;  // ローカルより新しい(=(a)採用パス)
    fixtures.body = contentsBodyFor(remoteState(REMOTE_T2, { entries: [REMOTE_ONLY_2] }));

    await page.reload();
    await page.waitForTimeout(700);
    const after2 = await stateNow();
    const entries2 = (after2.zeroThinking && after2.zeroThinking.entries) || [];
    check("リモート採用後もローカル限定entryが失われていない", entries2.some((e) => e.id === "e-local-only-2"), JSON.stringify(entries2.map((e) => e.id)));
    check("リモートのentryも取り込まれている", entries2.some((e) => e.id === "e-remote-only-2"), JSON.stringify(entries2.map((e) => e.id)));
    check("採用+合流でdataModifiedAtがリモート時刻より新しく進んでいる(合流分を次回pushで届けるため)",
      after2.dataModifiedAt > REMOTE_T2, `dataModifiedAt=${after2.dataModifiedAt} REMOTE_T2=${REMOTE_T2}`);

    // ============================================================
    // (d) themesはマージされない(ローカルで削除したテーマがリモートから復活しない)
    // ============================================================
    console.log("[3] themesはマージ対象外: ローカルで削除済みのテーマは、リモートにまだ存在してもローカルへ復活しない");
    const LOCAL_T3 = `${TODAY}T15:00:00`;
    await page.evaluate(({ KEY, LOCAL_T3 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = LOCAL_T3;
      s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };  // テーマは削除済み(空)
      s.settings.lastPushedAt = LOCAL_T3;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_T3 });

    const DELETED_THEME = { id: "t-deleted", text: "削除済みだがリモートにはまだ残るテーマ_v103", fav: false, questionId: null, groupId: null, source: null, createdAt: `${TODAY}T06:00:00` };
    const REMOTE_T3 = `${TODAY}T09:00:00`;  // ローカルより古い((b)スキップ判定パス。entriesマージのみ発生)
    fixtures.body = contentsBodyFor(remoteState(REMOTE_T3, { themes: [DELETED_THEME] }));

    await page.reload();
    await page.waitForTimeout(700);
    const after3 = await stateNow();
    const themes3 = (after3.zeroThinking && after3.zeroThinking.themes) || [];
    check("リモートにまだ存在するテーマは復活していない(themesはマージ対象外)", themes3.length === 0, JSON.stringify(themes3));

    // ============================================================
    // (e) 期限切れsuggestedThemesが合流してもTTL剪定で即座に消える
    // ============================================================
    console.log("[4] 期限切れ(pending 3日超)のsuggestedThemesがリモートから合流しても、TTL剪定で即座に消える");
    const LOCAL_T4 = `${TODAY}T16:00:00`;
    await page.evaluate(({ KEY, LOCAL_T4 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = LOCAL_T4;
      s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
      s.settings.lastPushedAt = LOCAL_T4;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_T4 });

    const oldDate = new Date(now0.getTime() - 10 * 24 * 60 * 60 * 1000);  // 10日前(pending TTL=3日を超過)
    const oldCreatedAt = `${isoDate(oldDate)}T09:00:00`;
    const EXPIRED_SUGGESTION = { id: "s-expired", text: "期限切れAI提案お題_v103", source: "daily", reason: "", status: "pending", adoptedThemeId: null, createdAt: oldCreatedAt };
    const FRESH_SUGGESTION = { id: "s-fresh", text: "新しいAI提案お題_v103", source: "daily", reason: "", status: "pending", adoptedThemeId: null, createdAt: `${TODAY}T08:00:00` };
    const REMOTE_T4 = `${TODAY}T09:00:00`;  // ローカルより古い
    fixtures.body = contentsBodyFor(remoteState(REMOTE_T4, { suggestedThemes: [EXPIRED_SUGGESTION, FRESH_SUGGESTION] }));

    await page.reload();
    await page.waitForTimeout(700);
    const after4 = await stateNow();
    const suggested4 = (after4.zeroThinking && after4.zeroThinking.suggestedThemes) || [];
    check("期限切れのsuggestedThemeは合流後すぐに剪定されて残らない", !suggested4.some((s) => s.id === "s-expired"), JSON.stringify(suggested4));
    check("期限内のsuggestedThemeは合流して残る", suggested4.some((s) => s.id === "s-fresh"), JSON.stringify(suggested4));

    // ============================================================
    // (f) リモート取得失敗時は既存動作(マージなし・ローカル保持)を維持する
    // ============================================================
    console.log("[5] リモート取得が失敗(500)しても、ローカルのentriesは変化せず安全にフォールバックする");
    const LOCAL_ONLY_5 = { id: "e-local-only-5", date: TODAY, theme: "取得失敗時ローカル", body: "取得失敗でも残るべきentry_v103", questionId: null, createdAt: `${TODAY}T09:00:00`, updatedAt: null };
    const LOCAL_T5 = `${TODAY}T09:00:00`;
    await page.evaluate(({ KEY, LOCAL_ONLY_5, LOCAL_T5 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = LOCAL_T5;
      s.zeroThinking = { themes: [], entries: [LOCAL_ONLY_5], groups: [], suggestedThemes: [] };
      s.settings.lastPushedAt = LOCAL_T5;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_ONLY_5, LOCAL_T5 });

    fixtures.status = 500;
    await page.reload();
    await page.waitForTimeout(700);
    const after5 = await stateNow();
    const entries5 = (after5.zeroThinking && after5.zeroThinking.entries) || [];
    check("取得失敗時、ローカルのentriesはそのまま(1件・変化なし)", entries5.length === 1 && entries5[0].id === "e-local-only-5", JSON.stringify(entries5));
    check("取得失敗時、dataModifiedAtも変化していない(マージ処理自体が走っていない)", after5.dataModifiedAt === LOCAL_T5, `dataModifiedAt=${after5.dataModifiedAt}`);
    check("pageerrorが発生していない(取得失敗を握りつぶして継続動作)", await page.locator(".nav-button").count() > 0);

    // ============================================================
    // 補足1: runAutoSyncPull(自動同期ON)でも同じ合流が働く
    // ============================================================
    console.log("[6] 自動同期ON時のrunAutoSyncPull(remoteが古い)でも、リモート限定entriesが合流する");
    const LOCAL_T6 = `${TODAY}T17:00:00`;
    await page.evaluate(({ KEY, LOCAL_T6 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.dataModifiedAt = LOCAL_T6;
      s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
      s.settings.autoSync = true;
      s.settings.lastPushedAt = LOCAL_T6;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_T6 });

    const REMOTE_ONLY_6 = { id: "e-remote-only-6", date: TODAY, theme: "自動同期経由リモート限定", body: "runAutoSyncPullで合流するentry_v103", questionId: null, createdAt: `${TODAY}T07:00:00`, updatedAt: null };
    fixtures.status = 200;
    fixtures.body = contentsBodyFor(remoteState(`${TODAY}T09:00:00`, { entries: [REMOTE_ONLY_6] }));
    await page.reload();
    await page.waitForTimeout(1200);  // runAutoSyncPullの起動を待つ
    const after6 = await stateNow();
    const entries6 = (after6.zeroThinking && after6.zeroThinking.entries) || [];
    check("自動同期ON時のrunAutoSyncPullでもリモート限定entryが合流する", entries6.some((e) => e.id === "e-remote-only-6"), JSON.stringify(entries6.map((e) => e.id)));
    await page.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); s.settings.autoSync = false; localStorage.setItem(KEY, JSON.stringify(s)); }, KEY);

    // ============================================================
    // 補足2: 手動「GitHubから読込」(loadFromGitHub)でもローカル限定entriesが失われない
    // ============================================================
    console.log("[7] 手動「GitHubから読込」でも、ローカル限定entriesが失われずリモートと合流する");
    const LOCAL_ONLY_7 = { id: "e-local-only-7", date: TODAY, theme: "手動読込時ローカル限定", body: "手動読込後も残るべきentry_v103", questionId: null, createdAt: `${TODAY}T09:00:00`, updatedAt: null };
    await page.evaluate(({ KEY, LOCAL_ONLY_7 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = { themes: [], entries: [LOCAL_ONLY_7], groups: [], suggestedThemes: [] };
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_ONLY_7 });
    const REMOTE_ONLY_7 = { id: "e-remote-only-7", date: TODAY, theme: "手動読込時リモート限定", body: "手動読込で合流するentry_v103", questionId: null, createdAt: `${TODAY}T07:00:00`, updatedAt: null };
    fixtures.body = contentsBodyFor(remoteState(`${TODAY}T20:00:00`, { entries: [REMOTE_ONLY_7] }));
    await page.reload();
    await page.waitForTimeout(700);
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="load-github"]');
    await page.waitForTimeout(500);
    const after7 = await stateNow();
    const entries7 = (after7.zeroThinking && after7.zeroThinking.entries) || [];
    check("手動読込後もローカル限定entryが失われていない", entries7.some((e) => e.id === "e-local-only-7"), JSON.stringify(entries7.map((e) => e.id)));
    check("手動読込でリモートのentryも取り込まれている", entries7.some((e) => e.id === "e-remote-only-7"), JSON.stringify(entries7.map((e) => e.id)));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
