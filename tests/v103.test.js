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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
