// v293 検証: 身体スキャン復活(K裁定2026-08-29「復活だけど、block完了時に追加のみで」)。
// v129のモーダル本体(openBodyScanModal/buildBodyScanStep1/2Modal/bodyScanRecord*/
// bodyScanDiscard/closeBodyScanFlow)は無改修のまま、手動Block完了の各導線末尾から
// openBodyScanModal(完了したBlockのid)を呼ぶだけの最小追加。ポモドーロ経路
// (completePomodoro)は既存のv129フックのまま無改修(このテストでは触らない)。
//
// 接続点(現物コードで確認した手動完了の全導線→フック位置):
//   1. toggleBlock (data-action="toggle-block": 完了チェック✓/○/↺)
//        → 関数末尾、justCompleted時のみ
//   2. toggleTaskCompleteFromBlock (data-action="toggle-task-complete": Block編集モーダル内🏁)
//        → 関数末尾、Block新規完了時のみ
//   3. saveBlockFromModal (data-action="modal-save", state.modal.type==="block":
//        「完了」チェックボックスを付けて保存)
//        → 共有ヘルパーtrackSavedBlockTransitions内でフラグを立て、6分岐が合流する
//          try/finally のfinallyで1回だけ開く(closeModal()より後)
//   4. saveActualEntryFromModal (data-action="modal-save", state.modal.type==="actualEntry":
//        実績登録モーダル「完了として登録」。TOWERの「■ 完了」=complete-block-with-actualから開く)
//        → 関数末尾(saveAndRenderの直後。closeModal()は保存処理内で先に実行済み)
//   5. now-conveyor-complete (TOWER GATE「▶ 次へ」) はポモドーロ非実行時
//      nowConveyorComplete()内でtoggleBlock()へ委譲するだけなので#1でカバー(追加フック不要)。
//   ※ completePomodoro (ポモドーロ完了) は既存v129フックのまま無改修 — v129.test.jsが担保。
//   ※ bulkApproveAsPlanned (「予定通り」一括承認) はK裁定により対象外 — フックしない。
//
// v293レビュー対応(2026-08-29、Codexレビュー修正6点。app.js/sw.jsは無改修、本ファイルのみ):
//   1. 固定時間待ち(setTimeout系API)を全廃し、selector/state/networkの成立を待つ条件待機へ置換した。
//   2. dataModifiedAt比較の基準を「Block完了後・身体スキャン記録前」に取り直し、
//      toggle-block自身のsaveStateで偽陽性にならない構成にした([10])。
//   3. 同期由来の負例をlocalStorage直接seed+reloadではなく、page.routeでGitHub Contents APIを
//      偽装し、実際のsyncFromGitHubOnStartup→computeSyncMerge→applySyncMergeToLocalの
//      実経路を通して検証する([7])。
//   4. discard 3経路(× / 「記録せず閉じる」/ 背景タップ)を別々のfixtureで個別assertする([9])。
//   5. 5導線すべてでfatigue/part/pomodoroBlockIdの3点を検証するよう揃えた。
//   6. clickAction(合成button注入)のうちtoggle-block/toggle-task-complete/
//      bulk-approve-plannedは実UI要素(clickReal)へ置換した。complete-block-with-actual/
//      now-conveyor-completeは実UI(src/features/today-tower.js)にも存在するが、TOWERの
//      「実行中/次のGate」選定条件(runningBlockOf等、plannedStartAt/actualStartAtと
//      現在時刻の関係で決まる)を満たす実データ構築が必要で、このテストの目的
//      (openBodyScanModalの接続点検証)には過剰な複雑さのため合成注入のまま維持する
//      (下のclickAction定義のコメント参照)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  // ------------------------------------------------------------
  // (c) mergeById同期対象のまま(computeSyncMergeは無改修): ブラウザ不要の静的ソース確認。
  //     bodyScansのmergeById組み込み自体はv129で実装済み。今回の変更でsrc/sync/github.jsには
  //     一切触れていないことを、対象行の残存で確認する。
  // ------------------------------------------------------------
  console.log("[0] computeSyncMergeのbodyScans mergeById組み込みが無改修(静的確認)");
  {
    const githubSrc = fs.readFileSync(path.join(__dirname, "..", "src", "sync", "github.js"), "utf8");
    check("mergeById(state.bodyScans, remoteNorm.bodyScans)が残っている",
      githubSrc.includes("const bodyScans = mergeById(state.bodyScans, remoteNorm.bodyScans);"));
    check("bodyScansがcomputeSyncMergeのvalues集合に含まれる",
      /values:\s*\{[^}]*\bbodyScans\b/.test(githubSrc));
  }

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v117/v129等と同じ方針)
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

  function makeBlock({ id, title, startMin, taskId = "", completed = false, plannedOnly = false }) {
    return {
      id, taskId, date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`, plannedEndAt: `${TODAY}T${hhmm(startMin + 30)}`,
      actualStartAt: plannedOnly ? "" : (completed ? `${TODAY}T${hhmm(startMin)}` : ""),
      actualEndAt: plannedOnly ? "" : (completed ? `${TODAY}T${hhmm(startMin + 30)}` : ""),
      completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      carryCount: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false
    };
  }
  function makeTask(id, extra = {}) {
    return {
      id, title: id, status: "todo", progressNum: 0, progressDen: 1,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, ...extra
    };
  }

  async function seed({ blocks = [], tasks = [], bodyScans = [], view = "timeline" } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, bodyScans, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.bodyScans = bodyScans;
      s.selectedDate = TODAY;
      s.currentView = view;
      // v293レビュー対応: saveActualEntryFromModal([4])はstate.timelineMode="actual"を
      // 保存する副作用を持つ。seed()は毎回これを"planned"へ明示的に戻す(実UI要素の
      // toggle-blockは実績モードでは常に非表示になるため、以降のseedでtoggle-blockの
      // 実クリックが見つからず固定タイムアウトする不具合があった)。
      s.timelineMode = "planned";
      s.pomodoro = { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, bodyScans, TODAY, view });
    await page.reload();
    // render()はapp.dataset.view = state.currentViewを毎回セットする(app.js:2751)。
    // 指定view通りに再描画が終わったことをこれで確認する(固定waitの代わり)。
    await page.waitForSelector(`#app[data-view="${view}"]`);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  // 合成button注入: 実UI上に存在するが(TOWER GATE等)、そのDOM出現条件(runningBlockOf等、
  // 現在時刻とBlockの実開始/実終了の関係で決まる)を満たす実データ構築がこのテストの目的
  // (openBodyScanModalの接続点検証)に対して過剰な複雑さになる2導線(complete-block-with-actual/
  // now-conveyor-complete)だけに用いる。documentの既存イベントデリゲーション(registerActions)
  // を通すため、ハンドラ自体は実処理そのもの(state変更・render・openBodyScanModal呼び出しは
  // 一切モックしていない)。それ以外の3導線(toggle-block/toggle-task-complete/
  // bulk-approve-planned)は下のclickReal()で実DOM要素をクリックする。
  async function clickAction(action, dataset = {}) {
    await page.evaluate(({ action, dataset }) => {
      const button = document.createElement("button");
      button.dataset.action = action;
      Object.assign(button.dataset, dataset);
      document.body.appendChild(button);
      button.click();
    }, { action, dataset });
  }
  // 実UI由来のdata-action要素(app.js/src/features/*.jsが実際に描画したもの)を、
  // 要素自身の.click()経由でクリックする(座標クリックでの重なり誤爆を避けるための
  // 既存踏襲パターン。v252/v278等と同じ考え方)。
  async function clickReal(selector) {
    await page.locator(selector).evaluate((el) => el.click());
  }
  const bodyScanOpen = () => page.locator(".modal-title", { hasText: "いまの疲労感は?" }).count();
  async function recordBodyScan(fatigue, part) {
    await page.click(`[data-action="body-scan-fatigue"][data-value="${fatigue}"]`);
    await page.locator(".modal-title", { hasText: "どこが疲れていますか" }).waitFor();
    await page.click(`[data-action="body-scan-part"][data-part="${part}"]`);
    await page.locator(".modal-title", { hasText: "どこが疲れていますか" }).waitFor({ state: "detached" });
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    // 初回起動で既定stateがlocalStorageへ書き込まれるまで待つ(passGithubGateの
    // evaluateがKEYを読むため、無いとJSON.parse(null)で失敗する)。
    await page.waitForFunction((KEY) => !!localStorage.getItem(KEY), KEY);
    await passGithubGate(page);

    // ============================================================
    // (a) 全経路: 手動完了→身体スキャンモーダル→記録
    // ============================================================
    console.log("[1] toggleBlock(完了チェック)で身体スキャンモーダルが開き記録される");
    await seed({ blocks: [makeBlock({ id: "r1", title: "対象1", startMin: 9 * 60 })] });
    await clickReal('[data-action="toggle-block"][data-id="r1"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    check("身体スキャンモーダルが開く", await bodyScanOpen() === 1);
    await recordBodyScan(3, "肩");
    let s = await stateNow();
    check("bodyScansに1件、fatigue=3・part=肩・pomodoroBlockId=r1で記録される",
      s.bodyScans.length === 1 && s.bodyScans[0].pomodoroBlockId === "r1" && s.bodyScans[0].fatigue === 3 && s.bodyScans[0].part === "肩",
      JSON.stringify(s.bodyScans));

    console.log("[2] toggleTaskCompleteFromBlock(Block編集モーダル内🏁)で開き、スキップ記録(part=\"\")される");
    await seed({
      blocks: [makeBlock({ id: "r2", title: "対象2", startMin: 10 * 60, taskId: "t2" })],
      tasks: [makeTask("t2")]
    });
    await clickAction("edit-block", { id: "r2" });  // モーダルを開く導線自体はこの接続点の対象外
    await page.locator('[data-action="toggle-task-complete"][data-id="r2"]').waitFor();
    await clickReal('[data-action="toggle-task-complete"][data-id="r2"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    check("身体スキャンモーダルが開く", await bodyScanOpen() === 1);
    await recordBodyScan(1, "");
    s = await stateNow();
    check("bodyScansに1件、fatigue=1・part=\"\"・pomodoroBlockId=r2で記録される",
      s.bodyScans.length === 1 && s.bodyScans[0].pomodoroBlockId === "r2" && s.bodyScans[0].fatigue === 1 && s.bodyScans[0].part === "",
      JSON.stringify(s.bodyScans));

    console.log("[3] Block編集モーダルの「完了」チェック保存で開く(モーダルの掛け替えが正しい順序で起きる)");
    await seed({ blocks: [makeBlock({ id: "r3", title: "対象3", startMin: 11 * 60 })] });
    await clickAction("edit-block", { id: "r3" });
    await page.locator('[data-modal-field="completed"]').waitFor();
    await page.locator('[data-modal-field="completed"]').check();
    await page.locator('[data-action="modal-save"]').click();
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    check("Block編集モーダルは閉じている", await page.locator(".modal-title", { hasText: "対象3" }).count() === 0);
    check("身体スキャンモーダルが開く", await bodyScanOpen() === 1);
    await recordBodyScan(5, "頭");
    s = await stateNow();
    check("bodyScansに1件、fatigue=5・part=頭・pomodoroBlockId=r3で記録される",
      s.bodyScans.length === 1 && s.bodyScans[0].pomodoroBlockId === "r3" && s.bodyScans[0].fatigue === 5 && s.bodyScans[0].part === "頭",
      JSON.stringify(s.bodyScans));

    console.log("[4] 実績登録モーダル「完了として登録」(TOWERの■完了と同じ導線)で開く");
    await seed({ blocks: [makeBlock({ id: "r4", title: "対象4", startMin: 12 * 60, plannedOnly: true })] });
    await clickAction("complete-block-with-actual", { id: "r4" });  // TOWER実行中GATE限定のため合成注入を維持
    await page.locator(".modal-title", { hasText: "実績を登録" }).waitFor();
    await page.locator('[data-action="modal-save"]').click();
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    check("身体スキャンモーダルが開く", await bodyScanOpen() === 1);
    await recordBodyScan(2, "目");
    s = await stateNow();
    check("bodyScansに1件、fatigue=2・part=目・pomodoroBlockId=r4で記録される",
      s.bodyScans.length === 1 && s.bodyScans[0].pomodoroBlockId === "r4" && s.bodyScans[0].fatigue === 2 && s.bodyScans[0].part === "目",
      JSON.stringify(s.bodyScans));

    console.log("[5] now-conveyor-complete(TOWER GATE「▶ 次へ」・ポモドーロ非実行)はtoggleBlockへ委譲され開く");
    await seed({ blocks: [makeBlock({ id: "r5", title: "対象5", startMin: 13 * 60 })] });
    await clickAction("now-conveyor-complete", { id: "r5" });  // TOWER GATE選定条件のため合成注入を維持
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    check("身体スキャンモーダルが開く", await bodyScanOpen() === 1);
    await recordBodyScan(4, "");
    s = await stateNow();
    check("bodyScansに1件、fatigue=4・part=\"\"・pomodoroBlockId=r5で記録される",
      s.bodyScans.length === 1 && s.bodyScans[0].pomodoroBlockId === "r5" && s.bodyScans[0].fatigue === 4 && s.bodyScans[0].part === "",
      JSON.stringify(s.bodyScans));

    // ============================================================
    // (b) ガード負例
    // ============================================================
    console.log("[6] 完了取り消し(toggleBlockで完了→再度toggleBlockで解除)では発火しない");
    await seed({ blocks: [makeBlock({ id: "r6", title: "対象6", startMin: 14 * 60 })] });
    await clickReal('[data-action="toggle-block"][data-id="r6"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    await page.click('.modal-footer [data-action="body-scan-discard"]');  // 完了自体は記録せず閉じる
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor({ state: "detached" });
    // 完了解除(2回目のtoggle)。timeline(予定モード)は完了済みBlockを表示対象から除外する
    // (renderTimeline: !b.completedフィルタ、実績モードでもcompleteBtnHTMLは常に非表示)ため、
    // 完了直後の同じチェックボックスへ実クリックで再到達する経路はこのview構成では存在しない
    // (実UIで解除するには別途Project/Task紐付けを要するrenderTasksビューが必要で、この
    // テストの目的には過剰な複雑さ)。ここだけ合成注入を維持する。
    await clickAction("toggle-block", { id: "r6" });
    await page.waitForFunction(
      ({ KEY, id }) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === id)?.completed === false,
      { KEY, id: "r6" }
    );
    check("完了取り消しでは身体スキャンモーダルが開かない", await bodyScanOpen() === 0);
    s = await stateNow();
    check("bodyScansは追加されない", s.bodyScans.length === 0, JSON.stringify(s.bodyScans));

    console.log("[7] 同期由来の完了反映(computeSyncMerge→applySyncMergeToLocalの実経路)では発火しない");
    {
      // ローカルは未完了のまま、リモートのみ完了(updatedAtが新しい)というfixtureを
      // page.routeでGitHub Contents APIとして返し、実際のsyncFromGitHubOnStartup→
      // computeSyncMerge(remoteNorm,"local")→applySyncMergeToLocalの経路を通す
      // (localStorage直接書き込み+reloadでの疑似ではない)。mergeById(src/core/merge.js)は
      // レコード単位のupdatedAt比較で勝敗が決まるため、dataModifiedAt自体は空("")にして
      // else節(tieWinner="local")を通しても、block単位ではリモートのr7が採用される。
      const localR7 = makeBlock({ id: "r7", title: "対象7", startMin: 15 * 60 });
      await page.evaluate(({ KEY, TODAY, block }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = [block];
        s.tasks = [];
        s.bodyScans = [];
        s.selectedDate = TODAY;
        s.currentView = "timeline";
        s.pomodoro = { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        s.settings.autoSync = false;  // legacy起動pull(syncFromGitHubOnStartup)経路を通す
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, TODAY, block: localR7 });
      const remoteR7 = { ...makeBlock({ id: "r7", title: "対象7", startMin: 15 * 60, completed: true }), updatedAt: `${TODAY}T09:00` };
      const syncMatcher = (url) => url.hostname === "api.github.com";
      const syncHandler = async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        if (req.method() === "GET" && u.pathname.endsWith("/contents/taskchute/app-state.json")) {
          const base = await stateNow();
          const remote = { ...base, blocks: [remoteR7], dataModifiedAt: "" };
          return route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({
              content: Buffer.from(JSON.stringify(remote), "utf-8").toString("base64"),
              encoding: "base64", sha: "sync-remote-sha-r7"
            })
          });
        }
        return route.fallback();  // 他パス(PUT等)は既存のblockGithubApiByDefaultへ委ねる
      };
      await page.route(syncMatcher, syncHandler);
      await page.reload();
      await page.waitForFunction(
        ({ KEY, id }) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === id)?.completed === true,
        { KEY, id: "r7" }
      );
      await page.unroute(syncMatcher, syncHandler);
      check("同期適用の前提: リモート由来の完了が実際にcomputeSyncMerge経由でローカルへ反映されている",
        (await stateNow()).blocks.find((b) => b.id === "r7")?.completed === true);
      check("実同期経路の適用では身体スキャンモーダルが開かない(手動操作を経ていない)", await bodyScanOpen() === 0);
      s = await stateNow();
      check("bodyScansは追加されない", s.bodyScans.length === 0, JSON.stringify(s.bodyScans));
    }

    console.log("[8] 一括操作(bulkApproveAsPlanned「予定通り」)では発火しない");
    await seed({ blocks: [makeBlock({ id: "r8", title: "対象8", startMin: 16 * 60, plannedOnly: true })] });
    page.once("dialog", (dialog) => dialog.accept());
    await clickReal('[data-action="bulk-approve-planned"]');
    await page.waitForFunction(
      ({ KEY, id }) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === id)?.completed === true,
      { KEY, id: "r8" }
    );
    check("一括承認で対象Blockが完了する(前提の確認)", (await stateNow()).blocks.find((b) => b.id === "r8")?.completed === true);
    check("一括操作では身体スキャンモーダルが開かない", await bodyScanOpen() === 0);
    s = await stateNow();
    check("bodyScansは追加されない", s.bodyScans.length === 0, JSON.stringify(s.bodyScans));

    console.log("[9] discard(×/「記録せず閉じる」/背景タップ)はいずれもbodyScansに追加されない(3経路個別)");
    await seed({ blocks: [makeBlock({ id: "r9a", title: "対象9a", startMin: 17 * 60 })] });
    await clickReal('[data-action="toggle-block"][data-id="r9a"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    await page.click('.modal-close[data-action="body-scan-discard"]');  // ×
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor({ state: "detached" });
    check("×(modal-close)discardでは記録されない", (await stateNow()).bodyScans.length === 0);

    await seed({ blocks: [makeBlock({ id: "r9b", title: "対象9b", startMin: 17 * 60 + 20 })] });
    await clickReal('[data-action="toggle-block"][data-id="r9b"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    await page.click('.modal-footer [data-action="body-scan-discard"]');  // 記録せず閉じる
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor({ state: "detached" });
    check("「記録せず閉じる」(footer)discardでは記録されない", (await stateNow()).bodyScans.length === 0);

    await seed({ blocks: [makeBlock({ id: "r9c", title: "対象9c", startMin: 17 * 60 + 40 })] });
    await clickReal('[data-action="toggle-block"][data-id="r9c"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    await page.locator("#modalRoot").click({ position: { x: 5, y: 5 } });  // 背景タップ(v132と同じ手法)
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor({ state: "detached" });
    check("背景タップdiscardでは記録されない", (await stateNow()).bodyScans.length === 0);

    // ============================================================
    // (c) 永続化
    // ============================================================
    console.log("[10] 記録がsaveState経由でdataModifiedAtを更新する(toggle-block自身の保存とは分離)");
    await seed({ blocks: [makeBlock({ id: "r10", title: "対象10", startMin: 18 * 60 })] });
    await clickReal('[data-action="toggle-block"][data-id="r10"]');
    await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    // 比較基準はBlock完了後・身体スキャン記録前(toggle-block自身のsaveStateで偽陽性にしないため)。
    const before = (await stateNow()).dataModifiedAt;
    // 固定時刻(page.clock)のままだとnowDateTime()が変化せず「更新された」ことを検出できないため、
    // 記録直前に時刻を進める(実行時刻依存フレーク回避の方針=v117/v129等はそのまま維持)。
    await page.clock.setFixedTime(new Date(now0.getTime() + 5 * 60 * 1000));
    await recordBodyScan(3, "胃");
    const after = await stateNow();
    check("記録後にdataModifiedAtが更新される(身体スキャン記録由来。toggle-block自身の保存は基準から除外済み)",
      after.dataModifiedAt > before, JSON.stringify({ before, after: after.dataModifiedAt }));
    check("pomodoroBlockIdに完了BlockのIDが入る(フィールド名は凍結のまま流用)",
      after.bodyScans[0]?.pomodoroBlockId === "r10");

    // ============================================================
    // (d) 390px幅でも身体スキャンモーダルが表示・操作できる
    // ============================================================
    console.log("[11] 390px幅でも身体スキャンモーダルが操作できる");
    await ctx.close();
    const narrowCtx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const narrowPage = await narrowCtx.newPage();
    narrowPage.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(390px):", e.message); });
    await blockGithubApiByDefault(narrowPage);
    await narrowPage.clock.setFixedTime(now0);
    await narrowPage.goto(`http://localhost:${PORT}/`);
    await narrowPage.waitForFunction((KEY) => !!localStorage.getItem(KEY), KEY);
    await passGithubGate(narrowPage);
    await narrowPage.evaluate(({ KEY, blocks, TODAY }) => {
      const st = JSON.parse(localStorage.getItem(KEY));
      st.blocks = blocks;
      st.tasks = [];
      st.bodyScans = [];
      st.selectedDate = TODAY;
      st.currentView = "timeline";
      st.pomodoro = { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
      localStorage.setItem(KEY, JSON.stringify(st));
    }, { KEY, blocks: [makeBlock({ id: "r11", title: "対象11", startMin: 9 * 60 })], TODAY });
    await narrowPage.reload();
    await narrowPage.waitForSelector('#app[data-view="timeline"]');
    await narrowPage.locator('[data-action="toggle-block"][data-id="r11"]').evaluate((el) => el.click());
    await narrowPage.locator(".modal-title", { hasText: "いまの疲労感は?" }).waitFor();
    check("390px幅でも身体スキャンモーダル(疲労)が開く",
      await narrowPage.locator(".modal-title", { hasText: "いまの疲労感は?" }).count() === 1);
    const box = await narrowPage.locator(".modal-card").boundingBox();
    check("390px幅でモーダルが画面幅からはみ出さない", Boolean(box) && box.x >= 0 && box.x + box.width <= 390 + 1,
      JSON.stringify(box));
    await narrowPage.click('[data-action="body-scan-fatigue"][data-value="2"]');
    await narrowPage.locator(".modal-title", { hasText: "どこが疲れていますか" }).waitFor();
    await narrowPage.click('[data-action="body-scan-part"][data-part="肩"]');
    await narrowPage.locator(".modal-title", { hasText: "どこが疲れていますか" }).waitFor({ state: "detached" });
    const narrowState = await narrowPage.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
    check("390px幅でも2タップで記録できる",
      narrowState.bodyScans.length === 1 && narrowState.bodyScans[0].pomodoroBlockId === "r11",
      JSON.stringify(narrowState.bodyScans));
    await narrowCtx.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
