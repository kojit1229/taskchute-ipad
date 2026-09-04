// sync-load-confirm-snapshot.test.js — unit15(A2-H4/D-K6)回帰テスト。
//
// loadFromGitHub()(src/sync/github.js)は「GitHubから読込」ボタンでリモートを無条件に採用し、
// この端末にしか無い未push編集(dataModifiedAt !== settings.lastPushedAt)を確認なしに破棄していた
// (第1回コードレビュー area-2-freshness-conflict.md A2-H4)。K裁定D-K6により、
// (1) 未push編集があるときはwindow.confirmで破棄内容(コア差分件数・最終編集時刻)を示し、
// (2) キャンセルならstateを一切変更せず中断し、
// (3) OKなら採用直前に既存の世代バックアップ機構(backups/app-state-YYYY-MM-DD.json、
//     restoreBackupから復元可能)へ強制スナップショットを書く、
// という3点を固定する。
//
// state操作の注意: localStorageを直接書き換えても、既に起動済みのページのin-memory `state`
// には反映されない(app.jsはstateを起動時に一度だけlocalStorageから読む)。そのためlocalStorage
// を書き換えるたびに page.reload() で反映させる(v49/v93等の既存スイートと同じ作法)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const LOCAL_MARKER = "ローカル未push編集_v15test";
  const REMOTE_MARKER = "リモート編集_v15test";

  function remoteStateJSON(dataModifiedAt, todayForOpen) {
    // currentViewは"settings"のまま(採用でsettings画面から遷移しないようにし、
    // 次の操作でも[data-action="load-github"]がそのまま押せるようにする)。
    // settings.lastOpenedDateは実行環境の実日付を入れておく(空だとrunDailyOpen()の
    // 日跨ぎ処理が誤って走り、ensureJournal+saveState()でdataModifiedAtが実時刻へ
    // 上書きされてしまい、後続テストの前提が崩れるため)。
    return JSON.stringify({
      dataModifiedAt, currentView: "settings", selectedDate: "2026-07-28",
      blocks: [{
        id: "remote-block-v15", taskId: "", date: "2026-07-28", title: REMOTE_MARKER, category: "",
        plannedStartAt: "2026-07-28T09:00:00", plannedEndAt: "2026-07-28T09:30:00",
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0,
        createdAt: dataModifiedAt, updatedAt: dataModifiedAt, deleted: false
      }],
      projects: [], tasks: [], settings: { lastOpenedDate: todayForOpen }
    });
  }

  async function setLocalState({ withLocalMarker, dataModifiedAt, lastPushedAt }) {
    await page.evaluate(({ KEY, LOCAL_MARKER, withLocalMarker, dataModifiedAt, lastPushedAt }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = (s.blocks || []).filter((b) => b.title !== LOCAL_MARKER);
      if (withLocalMarker) {
        s.blocks.push({
          id: "local-block-v15", taskId: "", date: "2026-07-28", title: LOCAL_MARKER, category: "",
          plannedStartAt: "2026-07-28T08:00:00", plannedEndAt: "2026-07-28T08:30:00",
          actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
          pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0,
          createdAt: "2026-07-28T08:00:00", updatedAt: "2026-07-28T08:00:00", deleted: false
        });
      }
      s.currentView = "settings";
      s.dataModifiedAt = dataModifiedAt;
      s.settings.lastPushedAt = lastPushedAt;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_MARKER, withLocalMarker, dataModifiedAt, lastPushedAt });
    // localStorageの書き換えを起動中ページのin-memory stateへ反映させるため再読込する。
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await openSettingsGroup(page, "settings-sync");
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function installFetchMock({ remoteDataModifiedAt }) {
    const todayForOpen = await page.evaluate(() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
    const remoteBody = remoteStateJSON(remoteDataModifiedAt, todayForOpen);
    await page.evaluate(({ remoteBody }) => {
      window.__ghCalls = [];
      window.__confirmCalls = [];
      window.__confirmReturn = true;
      window.confirm = (msg) => { window.__confirmCalls.push(msg); return window.__confirmReturn; };
      window.fetch = (url, opts = {}) => {
        const u = String(url); const method = opts.method || "GET";
        window.__ghCalls.push({ url: u, method, body: opts.body || "" });
        if (u.includes("/contents/taskchute/app-state.json") && method === "GET") {
          const content = btoa(unescape(encodeURIComponent(remoteBody)));
          return Promise.resolve(new Response(JSON.stringify({ sha: "sha-remote-1", content, encoding: "base64" }), { status: 200 }));
        }
        if (u.includes("/contents/taskchute/backups/app-state-") && method === "GET") {
          // 今日の世代スナップショットはまだ無い(sha確認は404)
          return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
        }
        if (u.includes("/contents/taskchute/backups/app-state-") && method === "PUT") {
          return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-bk-1" } }), { status: 200 }));
        }
        if (u.match(/\/contents\/taskchute\/backups\?/) && method === "GET") {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      };
    }, { remoteBody });
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);

    // ===================== [1] 未push編集あり + confirmキャンセル =====================
    console.log("[1] 未push編集があり、confirmをキャンセルするとstateが一切変わらない");
    await setLocalState({ withLocalMarker: true, dataModifiedAt: "2026-07-28T08:00:00", lastPushedAt: "2026-07-27T00:00:00" });
    await installFetchMock({ remoteDataModifiedAt: "2026-07-29T00:00:00" });
    await page.evaluate(() => { window.__confirmReturn = false; });
    const beforeCancel = await stateNow();
    await page.click('[data-action="load-github"]');
    await page.waitForTimeout(500);
    const afterCancel = await stateNow();
    const callsAfterCancel = await page.evaluate(() => window.__ghCalls);
    const confirmCallsAfterCancel = await page.evaluate(() => window.__confirmCalls);

    check("confirmが呼ばれている", confirmCallsAfterCancel.length === 1, JSON.stringify(confirmCallsAfterCancel));
    check("confirm文言に最終編集時刻が含まれる", confirmCallsAfterCancel[0]?.includes("2026-07-28T08:00:00"), confirmCallsAfterCancel[0]);
    check("confirm文言に件数(コア項目N件)が含まれる", /コア項目\s*\d+件/.test(confirmCallsAfterCancel[0] || ""), confirmCallsAfterCancel[0]);
    check("キャンセル後もローカルのBlockが残る(state不変)",
      Array.isArray(afterCancel.blocks) && afterCancel.blocks.some((b) => b.title === LOCAL_MARKER),
      JSON.stringify((afterCancel.blocks || []).map((b) => b.title)));
    check("キャンセル後、リモートのBlockは取り込まれていない",
      !afterCancel.blocks.some((b) => b.title === REMOTE_MARKER), JSON.stringify((afterCancel.blocks || []).map((b) => b.title)));
    check("キャンセル後、dataModifiedAtは変化しない(state不変)", afterCancel.dataModifiedAt === beforeCancel.dataModifiedAt,
      `${beforeCancel.dataModifiedAt} -> ${afterCancel.dataModifiedAt}`);
    check("キャンセル時はバックアップPUTを書かない",
      !callsAfterCancel.some((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/")),
      JSON.stringify(callsAfterCancel.map((c) => `${c.method} ${c.url}`)));

    // ===================== [2] 未push編集あり + confirmでOK =====================
    console.log("[2] 未push編集があり、confirmでOKするとスナップショットを書いてからリモートを採用する");
    await installFetchMock({ remoteDataModifiedAt: "2026-07-29T00:00:00" });
    await page.evaluate(() => { window.__confirmReturn = true; });
    await page.click('[data-action="load-github"]');
    await page.waitForTimeout(700);
    const afterAdopt = await stateNow();
    const callsAfterAdopt = await page.evaluate(() => window.__ghCalls);

    const snapshotPut = callsAfterAdopt.find((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/app-state-"));
    check("OK後にバックアップPUTが1件ある(既存の世代バックアップ機構=restoreBackupから復元可能な保存先)",
      !!snapshotPut, JSON.stringify(callsAfterAdopt.map((c) => `${c.method} ${c.url}`)));
    const snapshotBody = snapshotPut ? JSON.parse(snapshotPut.body) : null;
    const snapshotStateText = snapshotBody
      ? decodeURIComponent(escape(atob(snapshotBody.content)))
      : "";
    check("スナップショットの中身は採用直前(=破棄される側)のローカルstate",
      snapshotStateText.includes(LOCAL_MARKER) && !snapshotStateText.includes(REMOTE_MARKER),
      snapshotStateText.slice(0, 300));
    const snapshotPutIndex = callsAfterAdopt.indexOf(snapshotPut);
    const remoteGetIndex = callsAfterAdopt.findIndex((c) => c.url.includes("/contents/taskchute/app-state.json") && c.method === "GET");
    check("スナップショットPUTはリモート採用より前に発生する(採用直前の保存)",
      snapshotPutIndex > remoteGetIndex, `snapshot@${snapshotPutIndex} remoteGet@${remoteGetIndex}`);
    check("OK後はリモートのBlockが取り込まれている(採用そのものは従来どおり実行される)",
      Array.isArray(afterAdopt.blocks) && afterAdopt.blocks.some((b) => b.title === REMOTE_MARKER),
      JSON.stringify((afterAdopt.blocks || []).map((b) => b.title)));

    // ===================== [3] 未push編集なし =====================
    console.log("[3] 未push編集がなければconfirmを出さずに従来どおり読み込む");
    await setLocalState({ withLocalMarker: false, dataModifiedAt: "2026-07-27T00:00:00", lastPushedAt: "2026-07-27T00:00:00" });
    await installFetchMock({ remoteDataModifiedAt: "2026-07-30T00:00:00" });
    await page.click('[data-action="load-github"]');
    await page.waitForTimeout(700);
    const confirmCallsNoUnpushed = await page.evaluate(() => window.__confirmCalls);
    check("未push編集なしのときconfirmは呼ばれない", confirmCallsNoUnpushed.length === 0, JSON.stringify(confirmCallsNoUnpushed));
    const callsNoUnpushed = await page.evaluate(() => window.__ghCalls);
    check("未push編集なしのときスナップショットPUTも書かない(既存挙動どおり)",
      !callsNoUnpushed.some((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/")),
      JSON.stringify(callsNoUnpushed.map((c) => `${c.method} ${c.url}`)));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
