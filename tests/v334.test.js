// v334(§B): 実行タブ PC 2ペイン(1280px以上)。左=一覧(計画=renderTasks本体/実績=やったこと=
// 完了Block一覧)・右=時間軸(renderTimelineView本体、_execModeに連動)。§C(PCサイドバー統合・
// 旧setView寄せ)は既存E2E多数がPCサイドバー経由で旧tasks/timelineビューへ直接到達する前提で
// seedしており(today-core/tower-core/v50/v307等)、v333と同じ理由で本バージョンでも見送り、
// v335へ持ち越し(発注書「超えるならB=2ペインのみ、まずBだけ実装して報告」に該当。ただし今回の
// 実行コード差分はB単独で200行以内に収まったため分割理由は行数超過ではなく、PCナビ・旧setView
// 寄せに伴う既存E2Eの改修範囲がB単体より一桁大きく、密結合な一括改修は本バージョンの検証時間内で
// 安全に検証しきれないと判断したため)。
//
// v334レビュー(A-H1/A-H2/A-M1/A-M2/A-M3/B-H1/B-H2/B-M1〜M3)対応で以下を追加/修正した:
// [2] 実績モードの右ペインは_execModeに連動し実績のみ(予定Blockは出ない)。
// [2] 「やったこと」の母集団は選択日の完了Block全件(ルーティン・単発・非Project紐づけ含む)。
// [3] 計画モードでも📅予定/✅実績セグメントが右ペインに出て切替できる(既定は予定)。
// [5] 1280↔1279pxの1列⇄2列切替はsetViewportSizeだけ(クリック等の再描画を挟まない)で成立する。
// [6] 横スクロールなしの検査を計画モード・実績モード両方の1280pxで行う。
// [7] 計画モードの2ペインでもエネルギーカーブ(.energy-graph-overlay)がtickで更新される(H-2修正)。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return { id, title: id === "p1" ? "プロジェクトA" : id, kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function task(id, extra = {}) {
  return { id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function block(id, taskId, extra = {}) {
  return { id, taskId, date: TODAY, title: id, category: "仕事",
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false, isMIT: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}

async function resetSetItemLog(page) {
  await page.evaluate(() => { window.__setItemChanges = []; });
}
async function contentChangingWrites(page, key) {
  return page.evaluate((k) => (window.__setItemChanges || []).filter((x) => x === k).length, key);
}

async function seed(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    Object.assign(current, values);
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

// settings配下の一部フィールドだけをマージしてreloadする(既存settingsを壊さないため)。
async function seedSettingsPatch(page, patch) {
  await page.evaluate(({ key, patch }) => {
    const current = JSON.parse(localStorage.getItem(key));
    current.settings = { ...(current.settings || {}), ...patch };
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, patch });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__setItemChanges = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        const prev = this.getItem(key);
        if (prev !== value) window.__setItemChanges.push(key);
      } catch (e) { /* noop */ }
      return orig.call(this, key, value);
    };
  });
  try {
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const tToday = task("t-today", { dueDate: TODAY });
    const upA = block("b-up-a", "t-today", { plannedStartAt: `${TODAY}T11:00:00` });
    const done1 = block("b-done-1", "t-today", {
      completed: true, plannedStartAt: `${TODAY}T08:00:00`, plannedEndAt: `${TODAY}T08:30:00`,
      actualStartAt: `${TODAY}T08:02:00`, actualEndAt: `${TODAY}T08:28:00`, charge: 3, discharge: 2
    });
    // v334レビュー(A-M2/M-3)対応: 「やったこと」の母集団検査用に、execTargetBlocksなら
    // 除外されるはずの完了Block(ルーティン・単発=taskId無し)も混ぜてseedする。
    const doneRoutine = block("b-done-routine", "", {
      completed: true, category: "ルーティン",
      plannedStartAt: `${TODAY}T06:00:00`, plannedEndAt: `${TODAY}T06:10:00`,
      actualStartAt: `${TODAY}T06:01:00`, actualEndAt: `${TODAY}T06:09:00`
    });
    const doneNoProject = block("b-done-noproj", "", {
      completed: true, category: "私用",
      plannedStartAt: `${TODAY}T07:00:00`, plannedEndAt: `${TODAY}T07:20:00`,
      actualStartAt: `${TODAY}T07:02:00`, actualEndAt: `${TODAY}T07:18:00`
    });
    const incomplete1 = block("b-incomplete-1", "t-today", { completed: false, plannedStartAt: `${TODAY}T13:00:00` });
    const incomplete2 = block("b-incomplete-2", "", { completed: false, category: "ルーティン", plannedStartAt: `${TODAY}T14:00:00` });

    console.log("[1] 1280px以上: execは左=一覧+右=時間軸が左右に並ぶ(boundingBox)。計画モードは左にrenderTasks本体(exec-lower)");
    await seed(page, {
      currentView: "exec", selectedDate: TODAY,
      projects: [project("p1")], tasks: [tToday],
      blocks: [upA, done1, doneRoutine, doneNoProject, incomplete1, incomplete2]
    });
    check("1280px以上でexec-two-paneが出る", await page.locator(".exec-two-pane").count() === 1);
    const leftBox = await page.locator(".exec-pane-left").boundingBox();
    const rightBox = await page.locator(".exec-pane-right").boundingBox();
    check("左右ペインが両方可視", !!leftBox && !!rightBox && leftBox.width > 0 && rightBox.width > 0,
      JSON.stringify({ leftBox, rightBox }));
    check("左ペインが右ペインより左にある(2ペインが横に並ぶ・重なりなし)",
      leftBox.x + leftBox.width <= rightBox.x, JSON.stringify({ leftBox, rightBox }));
    check("左右ペインのY方向も重なる(同じ行に並ぶ)", leftBox.y < rightBox.y + rightBox.height && rightBox.y < leftBox.y + leftBox.height);
    check("計画モードの左ペインにrenderTasks本体(exec-lower)が出る", await page.locator(".exec-pane-left .exec-lower").count() === 1);
    check("計画モードの右ペインに時間軸(TIMELINE RADAR)が出る", await page.locator(".exec-pane-right .tl-radar-panel").count() === 1);
    check("右ペインの時間軸に開始済みBlockが表示される(既存Block描画は無改変・既定=予定モード)",
      await page.locator(".exec-pane-right .timeline-card[data-id=\"b-up-a\"]").count() === 1);
    check("計画モードでも右ペインにDRIFT/TIME COMBの折りたたみが時間軸の下に出る(§B M-3対応、embedded時は常に出す)",
      await page.locator(".exec-pane-right .tl-radar-panel ~ .exec-analysis-fold").count() === 1);

    console.log("[2] 実績モード(_execMode=actual): 右ペインは実績のみ(予定Blockは出ない)。左は「やったこと」=完了Block全件(母集団拡大)");
    await resetSetItemLog(page);
    const beforeToggle = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-pane-left .exec-done-section");
    check("実績モードの左ペインに「やったこと」見出しが出る", (await page.textContent(".exec-pane-left .exec-done-section h2")).includes("やったこと"));
    const doneRows = await page.locator(".exec-pane-left .exec-row-done").count();
    check("「やったこと」の行数が完了Block数(3件: 通常/ルーティン/単発)と一致する", doneRows === 3, doneRows);
    const doneIds = await page.locator(".exec-pane-left .exec-row-done .exec-row-copy strong")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
    check("やったことにルーティン完了Blockが含まれる(execTargetBlocksの除外を適用しない)",
      doneIds.includes("b-done-routine"), JSON.stringify(doneIds));
    check("やったことに単発(taskId無し)完了Blockが含まれる", doneIds.includes("b-done-noproj"), JSON.stringify(doneIds));
    check("未完了Blockはやったことに出ない", !doneIds.includes("b-incomplete-1") && !doneIds.includes("b-incomplete-2"), JSON.stringify(doneIds));
    check("「やったこと」行(b-done-1)に実績時刻(08:02–08:28)が出る(3件中の該当行を特定して検査)",
      (await page.locator('.exec-pane-left .exec-row-done:has(strong[data-id="b-done-1"]) .exec-row-meta').textContent()).includes("08:02–08:28"));
    check("実績モードでも左ペインに計画一覧(exec-lower)は出ない", await page.locator(".exec-pane-left .exec-lower").count() === 0);
    check("実績モードの右ペインに時間軸(TIMELINE RADAR)が出る", await page.locator(".exec-pane-right .tl-radar-panel").count() === 1);
    check("実績モードの右ペインは実績のみ(予定だけのBlock b-up-a のカードは出ない)",
      await page.locator(".exec-pane-right .timeline-card[data-id=\"b-up-a\"]").count() === 0);
    check("実績モードの右ペインに完了Blockのカード(b-done-1)が出る",
      await page.locator(".exec-pane-right .timeline-card[data-id=\"b-done-1\"]").count() === 1);
    check("実績モードのヘッダに予定/実績セグメントは出ない(state.timelineModeを読み書きしないため)",
      await page.locator(".exec-header-actions .segmented").count() === 0);
    check("実績モードでDRIFT/TIME COMBの折りたたみが右ペインの時間軸の下に出る(§B M-3対応)",
      await page.locator(".exec-pane-right .tl-radar-panel ~ .exec-analysis-fold").count() === 1);
    const afterToggle = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("モード切替はlocalStorage(state)を書き換えない(文字列比較、2ペインでも非永続)", beforeToggle === afterToggle);
    check("モード切替は内容変更を伴うsetItemを1回も呼ばない", await contentChangingWrites(page, STATE_KEY) === 0);

    console.log("[3] 計画モード: 右ペインに📅予定/✅実績セグメントが出て切替できる(既定は予定)");
    await page.click('[data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForSelector(".exec-lower");
    check("計画モードのヘッダに予定/実績セグメントが出る", await page.locator(".exec-header-actions .segmented").count() === 1);
    check("既定(未操作時)は予定が選択されている", await page.locator('.exec-header-actions [data-action="timeline-mode"][data-mode="planned"].active').count() === 1);
    check("計画モードの右ペインは既定で予定表示(b-up-aのカードが出る)",
      await page.locator(".exec-pane-right .timeline-card[data-id=\"b-up-a\"]").count() === 1);
    await page.click('.exec-header-actions [data-action="timeline-mode"][data-mode="actual"]');
    await page.waitForSelector('.exec-header-actions [data-action="timeline-mode"][data-mode="actual"].active');
    check("計画モードのセグメントで実績へ切替できる(右ペインが実績のみへ変わる)",
      await page.locator(".exec-pane-right .timeline-card[data-id=\"b-up-a\"]").count() === 0);
    check("計画モードのままなので左ペインは一覧(exec-lower)のまま(_execModeは変化しない)",
      await page.locator(".exec-pane-left .exec-lower").count() === 1);
    await page.click('.exec-header-actions [data-action="timeline-mode"][data-mode="planned"]');
    await page.waitForSelector('.exec-header-actions [data-action="timeline-mode"][data-mode="planned"].active');
    check("計画モードのセグメントで予定へ戻せる", await page.locator(".exec-pane-right .timeline-card[data-id=\"b-up-a\"]").count() === 1);

    console.log("[4] 「やったこと」行の編集導線(既存edit-block、data-actionは無改変)");
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-pane-left .exec-done-section");
    await page.click('.exec-pane-left .exec-row-done button[data-action="edit-block"]');
    await page.waitForSelector('.modal-card [data-modal-field="title"]');
    check("「やったこと」行の編集ボタンで既存のBlock編集モーダルが開く(既存edit-block、ロジック無改変)",
      await page.locator('.modal-card [data-modal-field="title"]').count() === 1);
    await page.click('.modal-card .modal-footer [data-action="modal-close"]');
    await page.waitForSelector(".modal-card", { state: "detached" });

    console.log("[5] 1280↔1279pxの1列⇄2列切替はsetViewportSizeだけ(クリックを挟まない)で成立する(A-M1/B-H1対応)");
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.waitForTimeout(150);
    check("1279pxではexec-two-paneが出ない(1列、resizeイベントだけで再描画される)", await page.locator(".exec-two-pane").count() === 0);
    check("1279px実績モードは埋め込み時間軸のみ(従来のv333a単一列)", await page.locator(".tl-radar-panel").count() === 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    check("1280pxへ戻すとexec-two-paneが復活する(クリック無し)", await page.locator(".exec-two-pane").count() === 1);
    await page.click('[data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForSelector(".exec-lower");
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.waitForTimeout(150);
    check("計画モードでも1279pxでexec-two-paneが消える(resizeだけで反映)", await page.locator(".exec-two-pane").count() === 0);
    check("1279px計画モードは一覧のみ(exec-pane-leftは無い)", await page.locator(".exec-pane-left").count() === 0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    check("計画モードで1280pxへ戻すとexec-two-paneが復活する", await page.locator(".exec-two-pane").count() === 1);

    console.log("[6] 1280pxの横スクロールなし・pageerror 0(計画モード・実績モード両方で検査、B-M2対応)");
    const scrollWPlan = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWPlan = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280px計画モードで横スクロールが発生しない", scrollWPlan <= clientWPlan + 1, `${scrollWPlan} vs ${clientWPlan}`);
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-two-pane");
    const scrollWActual = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWActual = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280px実績モードで横スクロールが発生しない", scrollWActual <= clientWActual + 1, `${scrollWActual} vs ${clientWActual}`);
    check("pageerrorが0件(ここまでの全体)", pageErrors.length === 0, JSON.stringify(pageErrors));

    console.log("[7] 計画モードの2ペインでもエネルギーカーブ(.energy-graph-overlay)がtickで更新される(A-H2対応)");
    await seedSettingsPatch(page, { timelineEnergyGraphMode: "battery" });
    await page.waitForSelector(".exec-two-pane");
    check("計画モードの右ペインにエネルギーカーブ(.energy-graph-overlay)が出る(前提)",
      await page.locator(".exec-pane-right .energy-graph-overlay").count() === 1);
    await page.waitForTimeout(700);  // 500ms周期のティッカーを最低1回は通す(_lastBatteryTickAtの基準を作る)
    await page.evaluate(() => {
      document.querySelector(".exec-pane-right .energy-graph-overlay")?.setAttribute("data-wiring-marker", "before-tick-v334");
    });
    const markerBefore = await page.evaluate(() =>
      document.querySelector(".exec-pane-right .energy-graph-overlay")?.getAttribute("data-wiring-marker") === "before-tick-v334");
    check("(準備)markerが付与されている", markerBefore);
    const tickBase = await page.evaluate(() => Date.now());
    await page.clock.setFixedTime(new Date(tickBase + 60 * 60 * 1000));  // 60分進める(reload・クリックなし)
    await page.waitForTimeout(800);  // 500ms周期のticker+1分スロットルを1回は通す
    const markerGoneAfterTick = await page.evaluate(() =>
      document.querySelector(".exec-pane-right .energy-graph-overlay")?.getAttribute("data-wiring-marker") !== "before-tick-v334");
    check("計画モードでもtick後にmarkerが消える(=outerHTMLで実際に差し替わった証拠。v144/v333の凍結退行がv334計画モードで再発していない)",
      markerGoneAfterTick);
    check("計画モードの右ペイン(TIMELINE RADAR)は引き続き表示されている", await page.locator(".exec-pane-right .tl-radar-panel").count() === 1);
    check("pageerrorが0件(全体)", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v334 ALL PASS" : `\n❌ v334: ${failures} 件失敗`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
