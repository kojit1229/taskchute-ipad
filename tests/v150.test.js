// v150 検証: UI改善計画Phase4b(残る構造課題、K指定2026-07-27)。CHANGES_v150.md参照。
// 2系統レビュー対応(初回実装後)の検証も本ファイルに追加している(A8〜A11、C1〜C4刷新、D3)。
//
// (A) 完了作法の統一(R3): ホーム今日タブのドット(タスクシュート/ながれ)・タスクシュートの✓・
//     タイムラインの○のいずれも、直接クリックでモーダルを介さず即完了する(実績開始/終了時刻を
//     未設定なら現在時刻ベースで自動記録、充放電はprefillEnergyで自動補完)。完了直後のトーストに
//     「実績を編集」ボタンが出て、既存の実績登録モーダル(complete-block-with-actual)を開ける。
//     完了解除(トグルOFF)は従来どおりプレーンなトースト(実績編集ボタンは出ない)。
//     ポモドーロ完了経路(completePomodoro)は対象外(現行維持)——既存tests/v87.test.jsの
//     全件成功で非破壊を別途確認済み(本ファイルでは再検証しない)。
//   レビュー対応追加分:
//     A8: 実績開始時刻はplannedStartAt優先(0分実績にならない)+開始>終了になる場合は
//         終了−予定所要ぶんに丸め込まれる(項目2)。
//     A9: 手入力済みの充放電はprefillEnergyで上書きされない(項目3)。
//     A10: 完了解除(同セッション)で自動記録した実績時刻・充放電が元へ復元される(項目4)。
//     A11: トースト消滅後、透明な当たり判定(pointer-events)が残留しない(項目1、elementFromPoint)。
// (B) タイポ・余白トークン(S4): :root に --text-xs/sm/md/lg と --space-1〜5 が定義され、
//     ホーム/今日タブ・ジャーナルCSSの一部(段階移行の第1弾)がそれを参照している。
// (C) 回復候補ドラフトの再構築(S7): PWA破棄相当(reload=モジュール再読込で_scheduleDraftは
//     リセットされるが、localStorage上のbatteryRecoveryDraftDatesは残る)からの起動時に、
//     新規stateフィールド無しで候補を再構築する。既に実Blockとして確定済みの候補は
//     再提案しない(未確定のものだけを対象にする)。
//   レビュー対応(項目5、Codex指摘): マーカーを{date, titles}へ拡張し、旧形式(文字列)は
//     normalizeStateで{date, titles:[]}へ後方互換マイグレーション(titles不明の日は再構築
//     スキップ)。再構築は記録済みタイトルのうち未解決のものだけを復元し、記録に無い次点候補
//     (computeChargeTopTitlesを素で再実行した場合の3番手)を繰り上げ提案しない(C1〜C4)。
// (D) タイムライン短時間Blockの重なり解消(R9): 実績モード・1xズームで連続する15分Block
//     (min-height 38pxで物理的に重なっていた)が、既存の横レーン分割(段差配置)により
//     重ならなくなる。離れた時刻のBlockは従来どおりレーン分割されない(regression)。
//   レビュー対応(項目6、監督者裁定): 分割対象は実所要20分未満のBlockに限定する。
//     連続する30分Block同士は全幅のまま(D3)——20分以上の数px食い込みはv149以前からの
//     既存挙動として許容する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(18, 0, 0, 0);  // 過去日側の候補には影響しない時刻(v145と同じ思想)
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
  const addDaysISO = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  };
  // "YYYY-MM-DDTHH:mm"から0時起点の分を取り出す(app.jsのminutesOfと同じ考え方、文字列パースのみ)。
  const minutesOfDateTime = (dateTime) => {
    const m = /T(\d{1,2}):(\d{2})/.exec(dateTime || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };

  function planBlock({ id, date = TODAY, title, startMin, minutes = 30, taskId = "", category = "",
    completed = false, actualStartAt = "", actualEndAt = "", charge = 0, discharge = 0 } = {}) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt, actualEndAt,
      completed, charge, discharge, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "v150-proj", kind: "normal", title: "v150テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v150-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({ blocks = [], tasks = [], projects = [], view = "home", settings = {}, batteryRecoveryDraftDates } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings, batteryRecoveryDraftDates }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.timelineMode = "planned";
      Object.assign(s.settings, settings);
      if (batteryRecoveryDraftDates !== undefined) s.batteryRecoveryDraftDates = batteryRecoveryDraftDates;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings, batteryRecoveryDraftDates });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (A) 完了作法の統一(R3)
    // ============================================================
    console.log("[A1] ホーム今日タブ: タスクシュートのドット(home-dot)を直接クリックすると即完了する(モーダルを介さない)");
    await seed({
      view: "home",
      tasks: [testTask("task-A", "A用タスク")],
      projects: [testProject()],
      blocks: [
        planBlock({ id: "block-hd", title: "即完了確認A", startMin: 9 * 60, minutes: 30, taskId: "task-A" }),
        planBlock({ id: "block-flow", title: "即完了確認B(ながれ)", startMin: 11 * 60, minutes: 15 })
      ]
    });
    // block-hdはtaskId付きなので「今日のタスクシュート」(.home-tc)と「今日のながれ」(.home-flow)
    // の両方に出る(homeFlowはtaskIdの有無を問わずルーティン以外の全Blockを表示するため)。
    // ここでは「タスクシュートのドット」に絞ってクリックする。
    // v150レビュー対応(項目2)確認用: normalizeStateは16文字("YYYY-MM-DDTHH:mm")の日時文字列に
    // ":00"を補って19文字へ揃えるため、クリック前の(正規化後の)plannedStartAtを控えておき、
    // これと比較する(自前でhhmm()から組み立てた無補正の文字列とは一致しないため)。
    const plannedStartAtNormalized = (await stateNow()).blocks.find((x) => x.id === "block-hd").plannedStartAt;
    await page.locator('.home-tc .home-dot[data-action="toggle-block"][data-id="block-hd"]').click();
    await page.waitForTimeout(200);
    check("モーダルは開かない(即完了)", await page.locator(".modal-card").count() === 0);
    let st = await stateNow();
    let b = st.blocks.find((x) => x.id === "block-hd");
    check("即完了でcompletedになる", b.completed === true);
    check("実績開始時刻が自動記録される", !!b.actualStartAt, b.actualStartAt);
    check("実績終了時刻が自動記録される", !!b.actualEndAt, b.actualEndAt);
    // v150レビュー対応(項目2、両レビュー一致): actualStartAt=actualEndAt(0分実績)にならない
    // ことを確認する。plannedStartAt(09:00)が現在時刻(18:00固定)より過去なので、
    // 実績開始時刻はplannedStartAtを優先して使うはず(単純な「現在時刻」ではない)。
    check("実績開始時刻はplannedStartAt(過去)を優先する(現在時刻に丸められない)",
      b.actualStartAt === plannedStartAtNormalized, `actualStartAt=${b.actualStartAt} planned=${plannedStartAtNormalized}`);
    check("実績開始時刻と終了時刻が異なる(0分実績にならない)", b.actualStartAt !== b.actualEndAt, JSON.stringify({ s: b.actualStartAt, e: b.actualEndAt }));
    check("完了直後のトーストに「実績を編集」ボタンが出る",
      await page.locator('.toast-action[data-action="complete-block-with-actual"][data-id="block-hd"]').count() === 1);
    check(".toastにhas-actionクラスが付く", await page.locator("#toast.has-action").count() === 1);

    console.log("[A2] ホーム今日タブ: ながれのチェック(home-dot)も同様に即完了する");
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-flow"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-flow");
    check("ながれのチェックも即完了する", b.completed === true);
    check("実績時刻が自動記録される(ながれ)", !!b.actualStartAt && !!b.actualEndAt);

    console.log("[A3] タスクシュート画面: ✓(checkbox-button)も同様に即完了する");
    await seed({
      view: "tasks",
      tasks: [testTask("task-B", "B用タスク")],
      projects: [testProject()],
      blocks: [planBlock({ id: "block-tc", title: "即完了確認C", startMin: 9 * 60, minutes: 30, taskId: "task-B" })]
    });
    await page.locator('.checkbox-button[data-action="toggle-block"][data-id="block-tc"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-tc");
    check("タスクシュートの✓も即完了する", b.completed === true);
    check("モーダルは開かない(タスクシュート✓)", await page.locator(".modal-card").count() === 0);
    check("完了直後のトーストに「実績を編集」ボタンが出る(タスクシュート)",
      await page.locator('.toast-action[data-action="complete-block-with-actual"][data-id="block-tc"]').count() === 1);

    console.log("[A4] タイムライン(予定モード): ○(tl-complete-btn)も同様に即完了する");
    await seed({
      view: "timeline",
      blocks: [planBlock({ id: "block-tl", title: "即完了確認D", startMin: 13 * 60, minutes: 20 })]
    });
    await page.locator('.tl-complete-btn[data-action="toggle-block"][data-id="block-tl"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-tl");
    check("タイムラインの○も即完了する", b.completed === true);
    check("モーダルは開かない(タイムライン○)", await page.locator(".modal-card").count() === 0);

    console.log("[A5] トーストの「実績を編集」から既存の実績登録モーダルが開き、保存できる");
    await page.click('.toast-action[data-action="complete-block-with-actual"]');
    await page.waitForTimeout(200);
    check("実績登録モーダルが開く", await page.locator('.modal-title:has-text("実績を登録")').count() === 1);
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(150);
    check("保存でモーダルが閉じる", await page.locator(".modal-card").count() === 0);

    console.log("[A6] 完了解除(トグルOFF)は従来どおりプレーンなトースト(実績編集ボタンは出ない)");
    await seed({
      view: "home",
      blocks: [planBlock({
        id: "block-done", title: "解除確認", startMin: 8 * 60, minutes: 30,
        completed: true, actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:30`
      })]
    });
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-done"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-done");
    check("再クリックで完了解除される", b.completed === false);
    check("解除時はトーストに実績編集ボタンが出ない", await page.locator(".toast-action").count() === 0);
    check(".toastにhas-actionクラスが付かない(解除時)", await page.locator("#toast.has-action").count() === 0);
    const toastText = await page.locator("#toast").textContent();
    check("解除時のトースト文言は従来どおり", (toastText || "").includes("Blockを更新しました"), toastText);

    console.log("[A7] 即完了時、充放電はprefillEnergy(過去実績の中央値)で自動補完される");
    const energyTitle = "v150エナジー確認Block";
    const pastEnergyBlocks = [10, 20, 30].map((n, i) => planBlock({
      id: `energy-past-${i}`, date: addDaysISO(TODAY, -n), title: energyTitle, startMin: 9 * 60, minutes: 20,
      completed: true, actualStartAt: `${addDaysISO(TODAY, -n)}T09:00`, actualEndAt: `${addDaysISO(TODAY, -n)}T09:20`,
      charge: 4, discharge: 1
    }));
    await seed({
      view: "home",
      blocks: [...pastEnergyBlocks, planBlock({ id: "block-energy", title: energyTitle, startMin: 9 * 60, minutes: 20 })]
    });
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-energy"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-energy");
    check("充電がprefillEnergyの中央値(4)で補完される(0のまま残らない)", b.charge === 4, String(b.charge));
    check("放電がprefillEnergyの中央値(1)で補完される", b.discharge === 1, String(b.discharge));

    console.log("[A8] plannedStartAtが未来(先取り完了)のときは、終了−予定所要ぶんに実績開始時刻が丸められる(開始>終了にならない)");
    await seed({
      view: "home",
      blocks: [planBlock({ id: "block-future", title: "先取り完了確認", startMin: 20 * 60, minutes: 30 })]  // 20:00〜(現在時刻18:00より未来)
    });
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-future"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-future");
    check("実績終了時刻は現在時刻(18:xx)で記録される", (b.actualEndAt || "").startsWith(`${TODAY}T18:`), b.actualEndAt);
    check("実績開始時刻は終了時刻以前に丸められる(開始>終了にならない)", b.actualStartAt <= b.actualEndAt, JSON.stringify({ s: b.actualStartAt, e: b.actualEndAt }));
    check("丸め込みは予定所要(30分)ぶん終了時刻から巻き戻した値になる",
      b.actualStartAt === `${TODAY}T${hhmm(minutesOfDateTime(b.actualEndAt) - 30)}`, JSON.stringify(b));

    console.log("[A9] 手入力済みの充放電はprefillEnergyで上書きされない(両レビュー一致の反例テスト)");
    const manualEnergyTitle = "v150手入力エナジー確認Block";
    const pastManualEnergyBlocks = [10, 20, 30].map((n, i) => planBlock({
      id: `manual-energy-past-${i}`, date: addDaysISO(TODAY, -n), title: manualEnergyTitle, startMin: 9 * 60, minutes: 20,
      completed: true, actualStartAt: `${addDaysISO(TODAY, -n)}T09:00`, actualEndAt: `${addDaysISO(TODAY, -n)}T09:20`,
      charge: 4, discharge: 1  // prefillEnergyが働けば中央値4/1になる(=このテストで検出したい値と紛れないよう手入力側は別値にする)
    }));
    await seed({
      view: "home",
      blocks: [...pastManualEnergyBlocks, planBlock({
        id: "block-manual-energy", title: manualEnergyTitle, startMin: 9 * 60, minutes: 20, charge: 2, discharge: 3
      })]
    });
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-manual-energy"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-manual-energy");
    check("手入力の充電(2)がprefillEnergyの中央値(4)で上書きされない", b.charge === 2, String(b.charge));
    check("手入力の放電(3)がprefillEnergyの中央値(1)で上書きされない", b.discharge === 3, String(b.discharge));

    console.log("[A10] 完了解除(同セッション)で自動記録した実績時刻・充放電が元(空/0)へ復元される");
    const snapEnergyTitle = "v150スナップショット確認Block";
    const pastSnapEnergyBlocks = [10, 20, 30].map((n, i) => planBlock({
      id: `snap-energy-past-${i}`, date: addDaysISO(TODAY, -n), title: snapEnergyTitle, startMin: 9 * 60, minutes: 20,
      completed: true, actualStartAt: `${addDaysISO(TODAY, -n)}T09:00`, actualEndAt: `${addDaysISO(TODAY, -n)}T09:20`,
      charge: 5, discharge: 2
    }));
    await seed({
      view: "home",
      blocks: [...pastSnapEnergyBlocks, planBlock({ id: "block-snap", title: snapEnergyTitle, startMin: 9 * 60, minutes: 20 })]
    });
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-snap"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-snap");
    check("(準備)即完了で実績・充放電が自動記録される", b.completed === true && !!b.actualStartAt && !!b.actualEndAt && b.charge === 5 && b.discharge === 2);
    // 同セッション内で完了解除する(toggle-block再クリック)
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-snap"]').click();
    await page.waitForTimeout(200);
    st = await stateNow();
    b = st.blocks.find((x) => x.id === "block-snap");
    check("完了解除でcompleted:falseに戻る", b.completed === false);
    check("自動記録された実績開始時刻が元(空)へ復元される", b.actualStartAt === "", JSON.stringify(b.actualStartAt));
    check("自動記録された実績終了時刻が元(空)へ復元される", b.actualEndAt === "", JSON.stringify(b.actualEndAt));
    check("自動記録された充電が元(0)へ復元される", b.charge === 0, String(b.charge));
    check("自動記録された放電が元(0)へ復元される", b.discharge === 0, String(b.discharge));

    console.log("[A11] トースト消滅後、透明な当たり判定がボトムナビ等の上に残留しない(elementFromPoint、項目1)");
    await page.setViewportSize({ width: 390, height: 844 });
    await seed({
      view: "home",
      blocks: [planBlock({ id: "block-toastcheck", title: "消滅確認Block", startMin: 9 * 60, minutes: 30 })]
    });
    await page.locator('.home-flow .home-dot[data-action="toggle-block"][data-id="block-toastcheck"]').click();
    await page.waitForTimeout(200);
    check("完了直後はhas-actionが付く(前提)", await page.locator("#toast.has-action").count() === 1);
    // トーストは画面下部中央に固定表示されるため、5個並ぶボトムナビの中央付近(index2、
    // 「実行」ボタン)を狙う——指摘原文の「ボトムナビ中央3ボタン」と同じ位置関係にするため、
    // 端(1番目)ではなく中央のボタンで実測する。
    const bottomNavBtnBox = await page.locator("#bottomNav button").nth(2).boundingBox();
    const beforeDismiss = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { isToast: !!(el && el.closest && el.closest("#toast")) };
    }, { x: bottomNavBtnBox.x + bottomNavBtnBox.width / 2, y: bottomNavBtnBox.y + bottomNavBtnBox.height / 2 });
    check("(前提)表示中はボトムナビ位置の当たり判定がトースト側にある(重なりの実在確認)", beforeDismiss.isToast, JSON.stringify(beforeDismiss));
    await page.waitForTimeout(4700);  // アクション付きトーストの消滅タイマー(4500ms)を跨ぐ
    check("タイマー満了後はhas-actionが外れる", await page.locator("#toast.has-action").count() === 0);
    const afterDismiss = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el ? el.tagName : null, isToast: !!(el && el.closest && el.closest("#toast")) };
    }, { x: bottomNavBtnBox.x + bottomNavBtnBox.width / 2, y: bottomNavBtnBox.y + bottomNavBtnBox.height / 2 });
    check("消滅後はelementFromPointがトースト(またはその子)を返さない(実測でモーダルが誤って開く事故の再発防止)",
      !afterDismiss.isToast, JSON.stringify(afterDismiss));
    await page.setViewportSize({ width: 1100, height: 1400 });

    // ============================================================
    // (B) タイポ・余白トークン(S4)
    // ============================================================
    console.log("[B1] :root にタイポ/余白トークンが定義されている");
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const names = ["--text-xs", "--text-sm", "--text-md", "--text-lg", "--space-1", "--space-2", "--space-3", "--space-4", "--space-5"];
      const out = {};
      names.forEach((n) => { out[n] = cs.getPropertyValue(n).trim(); });
      return out;
    });
    check("--text-xs = 12px", tokens["--text-xs"] === "12px", JSON.stringify(tokens));
    check("--text-sm = 14px", tokens["--text-sm"] === "14px", JSON.stringify(tokens));
    check("--text-md = 16px", tokens["--text-md"] === "16px", JSON.stringify(tokens));
    check("--text-lg = 20px", tokens["--text-lg"] === "20px", JSON.stringify(tokens));
    check("--space-1 = 4px", tokens["--space-1"] === "4px", JSON.stringify(tokens));
    check("--space-2 = 8px", tokens["--space-2"] === "8px", JSON.stringify(tokens));
    check("--space-3 = 12px", tokens["--space-3"] === "12px", JSON.stringify(tokens));
    check("--space-4 = 16px", tokens["--space-4"] === "16px", JSON.stringify(tokens));
    check("--space-5 = 24px", tokens["--space-5"] === "24px", JSON.stringify(tokens));

    console.log("[B2] ホーム/今日タブ・ジャーナルのCSSが実際にトークンを参照している(適用範囲の確認)");
    await seed({ view: "home", blocks: [] });
    const scoreLabFont = await page.evaluate(() => {
      const el = document.querySelector(".home-score-lab");
      return el ? getComputedStyle(el).fontSize : null;
    });
    check(".home-score-lab(今日タブ)のfont-sizeは--text-xs(12px)を参照", scoreLabFont === "12px", String(scoreLabFont));

    await page.setViewportSize({ width: 390, height: 844 });
    // 390px幅ではサイドバーのnavボタンが非表示になり、bottom-navと合わせて同一selectorが
    // 2件ヒットして曖昧になる(片方は非表示でクリック不可)ため、他のseed()呼び出しと同じく
    // state.currentView直接指定+reloadでジャーナル画面へ遷移する(nav操作の検証はこのテストの
