// 回帰テスト(コード変更なし・調査結果の裏取り): K報告「PCで登録したタスクがiPhoneで見えない」の
// 仮説原因(GitHub Contents APIの1MB制限)をapp.jsの実装で検証する。
//
// 現物調査の結論: downloadGitHubStateText(app.js:9538〜)は既にBlob APIフォールバックを持つ
// (v22コメント「Contents API は 1MB 超のファイルの content を返さない → Blob API を使う」)。
// `git log -S downloadGitHubStateText` によれば最初のコミットから存在し、
// loadFromGitHub/syncFromGitHubOnStartup/runAutoSyncPullの3経路すべてがこれを共有する。
// データ消失ガード: いずれも失敗時は例外→catchでconsole.warn/showToastのみで`state`へは
// 代入しない(syncFromGitHubOnStartup:9583〜)。「読み込み失敗を空stateと誤認して
// remoteを空で上書きする」経路は存在しない。この分岐に回帰テストが従来ゼロだったため追加する。
//
// [1] app-state.json が1MB超(encoding:"none")で返っても、Blob API経由で正しく読み切り、
//     リモートのタスク(Block)が画面に表示される。
// [2] Blob API側が失敗した場合、ローカルの既存タスクが消えたり空stateで上書きされたりしない。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  // v335(§C追随): 旧timelineビューへの直接navが無くなったため、execの1280px以上2ペイン
  // (右列=renderTimelineView、計画モード既定で常時表示)経由でリモート/ローカルの
  // Block(未着手・非タスク紐づけの単発Block)を検証する。1100pxのままだと計画モードは
  // タスク一覧(未タスク紐づけBlockを描画しない)だけになり、実績モードもactualStartAt無しの
  // 計画中Blockを描画しないため、この回帰テストの検証対象(sync直後のBlock可視化)が
  // どちらの1カラム表示でも観測できなくなる。
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 日中固定(深夜跨ぎでTODAY判定がズレるのを防ぐ。他スイートと同じ理由)
  const TODAY = isoDate(now0);

  const STATE_SHA = "state-blob-sha-v93test";
  const REMOTE_MARKER = "PC同期マーカー_v93fallback";
  const LOCAL_MARKER = "ローカル既存タスク_v93fallback";

  // encoding:"none"(1〜100MBファイルの実際のGitHub Contents API応答を模したfixture)
  const stateContentsBody = JSON.stringify({
    name: "app-state.json", path: "taskchute/app-state.json", sha: STATE_SHA,
    size: 1785654, content: "", encoding: "none"  // 実際の app-state.json とほぼ同サイズ(1MB超)
  });

  function remoteStateJSON(dataModifiedAt) {
    const remote = {
      dataModifiedAt, currentView: "timeline",
      selectedDate: TODAY,  // 実際のapp-state.jsonには必ず含まれる(normalizeStateは補完しない)
      blocks: [{
        id: "remote-block-v93", taskId: "", date: TODAY, title: REMOTE_MARKER, category: "",
        plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0,
        createdAt: dataModifiedAt, updatedAt: dataModifiedAt, deleted: false
      }],
      projects: [], tasks: [], settings: {}
    };
    return JSON.stringify(remote);
  }

  const fixtures = { blobMode: "ok", remoteDataModifiedAt: "" };  // blobMode: "ok" | "fail"
  const requestedPaths = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    requestedPaths.push(p);
    if (p === "/repos/kojit1229/personal-data/contents/taskchute/app-state.json") {
      return route.fulfill({ status: 200, contentType: "application/json", body: stateContentsBody });
    }
    if (p === `/repos/kojit1229/personal-data/git/blobs/${STATE_SHA}`) {
      if (fixtures.blobMode === "fail") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "internal error (test-fixture)" }) });
      }
      const jsonText = remoteStateJSON(fixtures.remoteDataModifiedAt);
      const b64 = Buffer.from(jsonText, "utf-8").toString("base64");
      // 実際の Git Blobs API は 60 文字ごとに改行を挟んで返す → 空白除去ロジックの確認を兼ねる
      const chunked = (b64.match(/.{1,60}/g) || []).join("\n");
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ sha: STATE_SHA, size: jsonText.length, content: chunked, encoding: "base64" })
      });
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
    await passGithubGate(page);  // token/dataOwner/dataRepo投入 + reload。ここで初回起動sync(成功)が走る

    console.log("[1] app-state.jsonがencoding:\"none\"で返っても、Blob API経由でリモートのタスクが取り込まれ画面に表示される");
    fixtures.blobMode = "ok";
    // v93注記(現物調査): 初回起動時点で runDailyOpen 等がローカルの dataModifiedAt を
    // 既に「今」へ進めているため("" のままではない)、比較のため確実にローカルより新しい
    // 時刻(当日23:59:59)を使う。
    fixtures.remoteDataModifiedAt = `${TODAY}T23:59:59`;
    await page.reload();
    await page.waitForTimeout(700);  // syncFromGitHubOnStartup の完了を待つ

    check("Contents APIへ app-state.json のGETが実際に飛んでいる",
      requestedPaths.includes("/repos/kojit1229/personal-data/contents/taskchute/app-state.json"), JSON.stringify(requestedPaths));
    check("encoding:\"none\"を受けてGit Blobs APIへフォールバックしている",
      requestedPaths.includes(`/repos/kojit1229/personal-data/git/blobs/${STATE_SHA}`), JSON.stringify(requestedPaths));

    const afterPull = await stateNow();
    check("localStorageの state.blocks にリモートのBlockが取り込まれている",
      Array.isArray(afterPull.blocks) && afterPull.blocks.some((b) => b.title === REMOTE_MARKER),
      JSON.stringify((afterPull.blocks || []).map((b) => b.title)));

    // v335(§C追随): 旧timelineビューへの直接navは無くなったため、execへ遷移する
    // (1280px以上の2ペインなら右列に計画モードのtimelineが常時出るためモード切替は不要)。
    await page.click('[data-action="nav"][data-view="exec"]');
    await page.waitForTimeout(200);
    const timelineText = await page.locator("main").textContent();
    check("タイムライン画面にリモートから取り込んだタスクのタイトルが表示される",
      timelineText.includes(REMOTE_MARKER), timelineText.slice(0, 200));

    console.log("[2] Blob APIが失敗しても、ローカルの既存タスクを保持したまま安全に失敗する(空stateで上書きしない)");
    // 別端末を模す: ローカルに未同期の独自タスクがある状態を作る(直接注入)
    await page.evaluate(({ KEY, LOCAL_MARKER, REMOTE_MARKER, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = (s.blocks || []).filter((b) => b.title !== REMOTE_MARKER);  // 前段の取り込み分は除く
      s.blocks.push({
        id: "local-block-v93", taskId: "", date: TODAY, title: LOCAL_MARKER, category: "",
        plannedStartAt: `${TODAY}T14:00:00`, plannedEndAt: `${TODAY}T14:30:00`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0,
        createdAt: `${TODAY}T14:00:00`, updatedAt: `${TODAY}T14:00:00`, deleted: false
      });
      s.dataModifiedAt = "";  // この端末はまだ一度もpush/pullしていない体
      s.settings.lastPushedAt = null;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, LOCAL_MARKER, REMOTE_MARKER, TODAY });

    fixtures.blobMode = "fail";
    requestedPaths.length = 0;
    await page.reload();
    await page.waitForTimeout(700);

    check("Blob APIフォールバックが試みられている(失敗ケースでも呼び出し自体は発生)",
      requestedPaths.includes(`/repos/kojit1229/personal-data/git/blobs/${STATE_SHA}`), JSON.stringify(requestedPaths));

    const afterFail = await stateNow();
    check("Blob API失敗後もローカルの既存タスクが消えていない",
      Array.isArray(afterFail.blocks) && afterFail.blocks.some((b) => b.title === LOCAL_MARKER),
      JSON.stringify((afterFail.blocks || []).map((b) => b.title)));
    check("Blob API失敗後、state.blocksが空配列に上書きされていない(空stateでの誤上書きガード)",
      Array.isArray(afterFail.blocks) && afterFail.blocks.length > 0, JSON.stringify(afterFail.blocks));
    check("Blob API失敗時はリモートのタスクが取り込まれない(失敗=何もしないが正しい挙動)",
      !afterFail.blocks.some((b) => b.title === REMOTE_MARKER), JSON.stringify((afterFail.blocks || []).map((b) => b.title)));

    // v335(§C追随): 旧timelineビューへの直接navは無くなったため、execへ遷移する
    // (1280px以上の2ペインなら右列に計画モードのtimelineが常時出るためモード切替は不要)。
    await page.click('[data-action="nav"][data-view="exec"]');
    await page.waitForTimeout(200);
    const timelineTextAfterFail = await page.locator("main").textContent();
    check("Blob API失敗後もタイムライン画面にローカルの既存タスクが表示され続ける",
      timelineTextAfterFail.includes(LOCAL_MARKER), timelineTextAfterFail.slice(0, 200));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
