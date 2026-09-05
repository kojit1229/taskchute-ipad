// v357: 空き時間を補うシート(b) — タイムライン本体の空き時間タップ(exec内は実績・計画いずれの
// モードもfill-gap-openへ配線。監督裁定A-H1)、シートにProject/Task select・ルーティンから選の
// プリフィルを追加(Task新規生成はしない。監督裁定A-H2)、PC(1280px以上)ではシートをexec左列
// (一覧の位置)に差し替え+右の時間軸に選択中の破線を表示する。
//
// 実装時の発見: v335で「旧timelineビュー」への直接navが削除されているため、tests/v108.test.js
// のヘルパー(openNewBlockModal)はexecの1280px2ペイン右列経由でtimeline-new-blockを検証していた。
// 本バージョンでexec内(embedded)は実績・計画いずれもfill-gap-openへ配線したため、v108側の
// ヘルパーを「旧timelineビューへ直接setView(このスイートの[1b]と同方式)」へ差し替えて
// v108/v254の契約(assertは1つも変更していない)を維持した。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();
const TODAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return { id, title: id === "p1" ? "決算ナビ12WY" : "サブProject", kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function actualBlock(id, extra = {}) {
  return { id, taskId: "", date: TODAY, title: id, category: "仕事",
    plannedStartAt: "", plannedEndAt: "",
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: true,
    charge: 0, discharge: 0, estimateMin: null, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
// H-1(計画モードも配線)/M-1(隙間算出)検証用: 計画Block(plannedStartAt/plannedEndAtのみ)。
function plannedBlock(id, extra = {}) {
  return { id, taskId: "", date: TODAY, title: id, category: "仕事",
    plannedStartAt: "", plannedEndAt: "",
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: null, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
// H-2(受け皿Task新規生成禁止)検証用: Project配下の既存todo Task。
function task(id, extra = {}) {
  return { id, projectId: "p2", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, dueDate: "", progressNum: 0, progressDen: 10, estimateMin: null,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function recurrenceRule(id, extra = {}) {
  return { id, title: "朝のルーティン", category: "開発", taskId: "", kind: "daily",
    startTime: "06:00", endTime: "06:25", anchorDate: TODAY, exceptionDates: [],
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, deleted: false, ...extra };
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
async function stateNow(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STATE_KEY);
}
// B-M2対応: state書込0回の確認だけでなく、blocks/tasks/projectsの中身自体が
// fixtureと1バイトも変わっていないことをJSON比較で確認する(setItem回数が0でも、
// 呼び出し側が誤って別経路でstateへ触っていないかまで潰す)。
async function dataSnapshot(page) {
  const s = await stateNow(page);
  return JSON.stringify({ blocks: s.blocks, tasks: s.tasks, projects: s.projects });
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
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

    // fixture: 実績06:00-07:10 / 09:00-10:00(07:10-09:00が空き・110分)。
    const morning = actualBlock("b-morning", { actualStartAt: `${TODAY}T06:00:00`, actualEndAt: `${TODAY}T07:10:00` });
    const later = actualBlock("b-later", { actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T10:00:00` });
    const rule = recurrenceRule("r1");

    async function seedFixture(extra = {}) {
      await seed(page, {
        currentView: "exec", selectedDate: TODAY,
        projects: [project("p1"), project("p2")], tasks: [], blocks: [morning, later],
        recurrences: [rule], ...extra
      });
    }

    console.log("[1] exec実績モードで空き時間タップ(.time-row)→fill-gap-openへ配線される(見出しの時刻が行の隙間と一致)");
    await seedFixture();
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".timeline");
    const blocksBeforeGapTap = (await stateNow(page)).blocks.length;
    const snapshotBeforeTap = await dataSnapshot(page);
    await resetSetItemLog(page);
    // 08:00-09:00の行は次Block(b-later, 09:00開始)が行末ちょうどのため丸ごと空き。
    await page.click('.time-row[data-action="fill-gap-open"][data-start="08:00"]', { position: { x: 20, y: 15 } });
    await page.waitForSelector(".fill-gap-sheet");
    const heading1 = await page.textContent(".fill-gap-sheet .modal-title");
    check("見出しの時刻がタップした行の隙間(08:00–09:00・60分)と一致する", heading1.includes("08:00") && heading1.includes("09:00") && heading1.includes("60分"), heading1);
    check("Blockはまだ増えない(シートを開いただけ)", (await stateNow(page)).blocks.length === blocksBeforeGapTap);
    await page.click(".fill-gap-sheet .modal-close");
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    check("開いて閉じるだけではcontent-changing setItemが0回(実績モードタイムラインタップ経路)",
      await contentChangingWrites(page, STATE_KEY) === 0);
    check("blocks/tasks/projectsの中身がfixtureと1バイトも変わらない(実績モードタイムラインタップ経路)",
      (await dataSnapshot(page)) === snapshotBeforeTap);

    console.log("[1a-neg] 占有済みの行(09:00、b-laterが行頭ちょうどに始まる)をタップしてもシートは開かない(A-M1/B-H1負例)");
    check("09:00行にはfill-gap-openが配線されない(行全体が既存Blockに占有されているため)",
      await page.locator('.time-row[data-action="fill-gap-open"][data-start="09:00"]').count() === 0);
    await page.click('.time-row[data-minute="540"]', { position: { x: 20, y: 15 } });
    await page.waitForTimeout(200);
    check("占有済みの09:00行タップではfill-gap-sheetは開かない", await page.locator(".fill-gap-sheet").count() === 0);
    check("占有済みの09:00行タップでは新規Block作成モーダルも開かない(何も起きない)",
      await page.locator(".modal-card").count() === 0);

    console.log("[1b] 旧timelineビュー(直接setView、execの計画モード右列ではない単体ビュー)ではtimeline-new-blockのまま(v108/v254の契約を壊さない)");
    await seed(page, { currentView: "timeline", timelineMode: "planned", selectedDate: TODAY, projects: [project("p1")], tasks: [], blocks: [], recurrences: [] });
    await page.waitForSelector(".time-row");
    await page.click('.time-row[data-action="timeline-new-block"][data-minute="480"]', { position: { x: 20, y: 15 } });
    await page.waitForSelector('.modal-card [data-modal-field="title"]');
    check("旧timelineビューの空き時間タップは従来どおりtimeline-new-block(新規Block作成モーダル)を開く",
      await page.locator('.modal-card [data-modal-field="title"]').count() === 1);
    check("fill-gap-sheetは開かない(旧ビューは無改変)", await page.locator(".fill-gap-sheet").count() === 0);
    await page.click('.modal-card [data-action="modal-close"]');
    await page.waitForSelector(".modal-card", { state: "detached" }).catch(() => {});

    console.log("[1c] exec計画モード(1280px右列)も空き時間タップがfill-gap-openへ配線される(監督裁定A-H1、K確定モックTcFillSheetPCと一致)");
    // 計画Block: 07:00-08:00 と 10:00-11:00(08:00-10:00が空き)。_execModeは既定"plan"のまま
    // (exec-mode-toggleを押さない)、timelineMode既定"planned"で右列は計画タイムラインになる。
    const planEarly = plannedBlock("p-early", { plannedStartAt: `${TODAY}T07:00:00`, plannedEndAt: `${TODAY}T08:00:00` });
    const planLater = plannedBlock("p-later", { plannedStartAt: `${TODAY}T10:00:00`, plannedEndAt: `${TODAY}T11:00:00` });
    await seed(page, {
      currentView: "exec", selectedDate: TODAY, timelineMode: "planned",
      projects: [project("p1"), project("p2")], tasks: [], blocks: [planEarly, planLater], recurrences: []
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".exec-two-pane");
    const snapshotBeforePlannedTap = await dataSnapshot(page);
    await resetSetItemLog(page);
    // 09:00-10:00の行は丸ごと空き(08:00-10:00の隙間のうち行区間分)。
    await page.click('.exec-pane-right .time-row[data-action="fill-gap-open"][data-start="09:00"]', { position: { x: 20, y: 15 } });
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    const headingPlanned = await page.textContent(".exec-pane-left .fill-gap-sheet .modal-title");
    check("計画モードでも見出しの時刻がタップした行の隙間(09:00–10:00・60分)と一致する",
      headingPlanned.includes("09:00") && headingPlanned.includes("10:00") && headingPlanned.includes("60分"), headingPlanned);
    await page.click(".exec-pane-left .fill-gap-sheet .modal-close");
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet", { state: "detached" });
    check("開いて閉じるだけではcontent-changing setItemが0回(計画モードPC左列経路)",
      await contentChangingWrites(page, STATE_KEY) === 0);
    check("blocks/tasks/projectsの中身がfixtureと1バイトも変わらない(計画モードPC左列経路)",
      (await dataSnapshot(page)) === snapshotBeforePlannedTap);

    console.log("[1c-neg] 計画モードでも占有済みの行(10:00、p-laterが行頭ちょうどに始まる)はfill-gap-openが配線されない(M-1負例、計画版)");
    check("計画モードの10:00行にはfill-gap-openが配線されない",
      await page.locator('.exec-pane-right .time-row[data-action="fill-gap-open"][data-start="10:00"]').count() === 0);
    await page.setViewportSize({ width: 390, height: 844 });

    console.log("[2] ルーティン雛形選択でプリフィル→作る→開始=隙間の頭・長さ=選択値・既存Task(Project配下)が紐づく(受け皿Task新規生成なし、監督裁定A-H2)");
    const taskP2 = task("t-p2", { projectId: "p2", title: "サブTaskP2" });
    await seedFixture({ tasks: [taskP2] });
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    check("Project/Task selectがある(既存todo/doing Taskをoptgroupで含む)", await page.locator("#fillGapProject").count() === 1);
    check("Project/Task selectに既存Task(t-p2)がoptionとして含まれる(Project直選択ではなく既存Taskから選ぶ)",
      await page.locator("#fillGapProject option[value='t-p2']").count() === 1);
    check("ルーティンから selectがある", await page.locator("#fillGapRoutine").count() === 1);
    await page.selectOption("#fillGapRoutine", "r1");
    const titleAfterPrefill = await page.inputValue("#fillGapTitle");
    const categoryAfterPrefill = await page.$eval("#fillGapCategory", (el) => el.value);
    const lengthAfterPrefill = await page.$eval("#fillGapLength", (el) => el.value);
    check("プリフィル: タイトルがルーティン雛形のタイトルになる", titleAfterPrefill === "朝のルーティン", titleAfterPrefill);
    check("プリフィル: カテゴリがルーティン雛形のカテゴリになる", categoryAfterPrefill === "開発", categoryAfterPrefill);
    check("プリフィル: 長さがルーティン雛形の所要(25分)になる", lengthAfterPrefill === "25", lengthAfterPrefill);
    await page.selectOption("#fillGapProject", "t-p2");
    // 注意: 「daily」ルーティン雛形自体が別途未来分の実体化Block(recurrenceGroupId=rule.id)を
    // 生成し続けるため、件数比較・Block特定ともfill-gap-create由来(recurrenceGroupId=""=
    // 通常Block)だけに絞り込む。
    const nonRecurBefore = (await stateNow(page)).blocks.filter((b) => b.recurrenceGroupId === "").length;
    const tasksBeforeCreate = (await stateNow(page)).tasks;
    await page.click('[data-action="fill-gap-create"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    const stAfterCreate = await stateNow(page);
    const nonRecurAfter = stAfterCreate.blocks.filter((b) => b.recurrenceGroupId === "").length;
    check("通常Block(ルーティン実体化を除く)が1件増える", nonRecurAfter === nonRecurBefore + 1, `${nonRecurAfter} vs ${nonRecurBefore}`);
    check("Task台帳は1件も増減・変更しない(受け皿Task新規生成なし、A-H2 pin)",
      JSON.stringify(stAfterCreate.tasks) === JSON.stringify(tasksBeforeCreate));
    const createdBlock = stAfterCreate.blocks.find((b) => b.title === "朝のルーティン" && b.recurrenceGroupId === "");
    check("開始時刻は空き時間の頭(07:10)", (createdBlock?.plannedStartAt || "").includes("T07:10"), createdBlock?.plannedStartAt);
    check("長さは選択値25分(plannedEndAt=07:35)", (createdBlock?.plannedEndAt || "").includes("T07:35"), createdBlock?.plannedEndAt);
    check("選んだ既存Task(t-p2、Project p2配下)がそのまま紐づく(新規Taskではない)", createdBlock?.taskId === "t-p2", createdBlock?.taskId);

    console.log("[3] 1280px: 左列がシートに差し替わり右の時間軸に選択中の破線、閉じると一覧に戻る");
    await seedFixture({ tasks: [taskP2] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".exec-two-pane");
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    check("1280pxではシートがexec左列(一覧の位置)に差し替わる", await page.locator(".exec-pane-left .fill-gap-sheet").count() === 1);
    check("1280pxではオーバーレイモーダルは開かない(#modalRoot.open無し)",
      await page.evaluate(() => !document.querySelector("#modalRoot")?.classList.contains("open")));
    await page.waitForSelector(".exec-pane-right .fill-gap-selected");
    const selectedLabel = await page.textContent(".exec-pane-right .fill-gap-selected span");
    check("右の時間軸に選択中の空き時間がアンバー破線+「← 選択中」で示される", selectedLabel.includes("← 選択中"), selectedLabel);
    await page.click(".exec-pane-left .fill-gap-sheet .modal-close");
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet", { state: "detached" });
    check("閉じると左列が一覧に戻る(.fill-gap-sheetが消える)", await page.locator(".exec-pane-left .fill-gap-sheet").count() === 0);
    check("右の時間軸の選択中破線も消える", await page.locator(".fill-gap-selected").count() === 0);
    check("閉じると左列に一覧の中身(実際のリスト、B-M4)が戻る", await page.locator(".exec-pane-left .exec-upcoming-section").count() === 1);

    console.log("[3c] PC左列: 「置く」でも左列が一覧に戻る(B-M4)");
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    await page.click(".exec-pane-left .fill-gap-list [data-action='fill-gap-place']");
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet", { state: "detached" });
    check("「ここに置く」後も左列が一覧に戻る", await page.locator(".exec-pane-left .exec-upcoming-section").count() === 1);
    check("「ここに置く」後、右の時間軸の選択中破線も消える", await page.locator(".fill-gap-selected").count() === 0);

    console.log("[3d] PC左列: 重複ガードでBlock編集モーダルへ抜けても、閉じると左列は一覧のまま残る(A-M2)");
    const placedBlock = (await stateNow(page)).blocks.find((b) => !b.deleted && b.taskId === "t-p2");
    check("直前の「ここに置く」でt-p2のBlockが1件作られている(前提)", Boolean(placedBlock), JSON.stringify(await stateNow(page)));
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    // 同じ隙間へ同じTaskをもう一度「ここに置く」→ 冪等ガードで既存Block編集モーダルへ抜ける。
    await page.click(".exec-pane-left .fill-gap-list [data-action='fill-gap-place']");
    await page.waitForSelector("#modalRoot.open .modal-card");
    check("2回目は重複検知でBlock編集モーダル(オーバーレイ)が開く", await page.locator("#modalRoot.open .modal-card").count() === 1);
    check("Block編集モーダル表示中、左列は死んだfillGapシートを残していない(A-M2)",
      await page.locator(".exec-pane-left .fill-gap-sheet").count() === 0);
    check("Block編集モーダル表示中、左列には一覧が(先に)戻っている(A-M2)",
      await page.locator(".exec-pane-left .exec-upcoming-section").count() === 1);
    await page.click("#modalRoot .modal-card .modal-close");
    await page.waitForSelector("#modalRoot.open", { state: "detached" }).catch(() => {});
    check("Block編集モーダルを閉じた後も左列は一覧のまま(壊れたfillGapシートが残留しない、A-M2)",
      await page.locator(".exec-pane-left .fill-gap-sheet").count() === 0);
    check("Block編集モーダルを閉じた後、左列に一覧の中身が見える", await page.locator(".exec-pane-left .exec-upcoming-section").count() === 1);

    console.log("[3e] PC左列⇔オーバーレイ: 1280px⇔1279pxの幅またぎで表示形態が切り替わる(選択中のstate.modalは維持、B-M5)");
    await seedFixture();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".exec-two-pane");
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    const modalBeforeCross = (await stateNow(page)).modal;
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.waitForSelector("#modalRoot.open .fill-gap-sheet");
    check("1280→1279へ幅を跨ぐと左列からオーバーレイモーダルへ切り替わる(B-M5)",
      await page.locator(".exec-pane-left").count() === 0 && await page.locator("#modalRoot.open .fill-gap-sheet").count() === 1);
    check("幅を跨いでも選択中の隙間(state.modal)は維持される", JSON.stringify((await stateNow(page)).modal) === JSON.stringify(modalBeforeCross));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    check("1279→1280へ戻すとオーバーレイから左列へ戻る(B-M5)",
      await page.evaluate(() => !document.querySelector("#modalRoot")?.classList.contains("open")) && await page.locator(".exec-pane-left .fill-gap-sheet").count() === 1);
    await page.click(".exec-pane-left .fill-gap-sheet .modal-close");
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet", { state: "detached" });
    await page.setViewportSize({ width: 390, height: 844 });

    console.log("[3b] 1279px以下ではモーダル(オーバーレイ)のまま");
    await page.setViewportSize({ width: 1279, height: 900 });
    // v357修正(B-M1レビュー対応): 固定waitではなくv334矩形リスナの再描画完了(.exec-two-pane
    // が消える=1280px境界のmatchMediaリスナがrender()を終えた)をDOM状態で待つ。
    await page.waitForFunction(() => !document.querySelector(".exec-two-pane"));
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector("#modalRoot.open .fill-gap-sheet");
    check("1279pxではオーバーレイモーダルとして開く", await page.locator("#modalRoot.open .fill-gap-sheet").count() === 1);
    check("1279pxではexec-pane-left自体が存在しない(PC2ペイン外)", await page.locator(".exec-pane-left").count() === 0);
    await page.click(".fill-gap-sheet .modal-close");
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    await page.setViewportSize({ width: 390, height: 844 });

    console.log("[4] 390px/1280px横スクロールなし・input/select 16px・pageerror 0・state書込は置く/作る以外0回・new Date(\"文字列\")なし");
    await seedFixture();
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await resetSetItemLog(page);
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const scrollW390 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW390 = await page.evaluate(() => document.documentElement.clientWidth);
    check("390pxで横スクロールが発生しない(シート表示中)", scrollW390 <= clientW390 + 1, `${scrollW390} vs ${clientW390}`);
    const fontSizes390 = await page.$$eval(".fill-gap-new input, .fill-gap-new select", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    check("390px: fill-gap-new内のinput/selectはすべて16px以上", fontSizes390.every((n) => n >= 16), JSON.stringify(fontSizes390));
    await page.click(".fill-gap-sheet .modal-close");
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    check("シートを開いて閉じるだけではcontent-changing setItemが0回", await contentChangingWrites(page, STATE_KEY) === 0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".exec-two-pane");
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet");
    const scrollW1280 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW1280 = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280pxで横スクロールが発生しない(シート表示中)", scrollW1280 <= clientW1280 + 1, `${scrollW1280} vs ${clientW1280}`);
    const fontSizes1280 = await page.$$eval(".fill-gap-new input, .fill-gap-new select", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    check("1280px: fill-gap-new内のinput/selectはすべて16px以上", fontSizes1280.every((n) => n >= 16), JSON.stringify(fontSizes1280));
    await page.click(".exec-pane-left .fill-gap-sheet .modal-close");
    await page.waitForSelector(".exec-pane-left .fill-gap-sheet", { state: "detached" });
    await page.setViewportSize({ width: 390, height: 844 });

    check("pageerrorが0件(全体)", pageErrors.length === 0, JSON.stringify(pageErrors));

    const stripLineComments = (src) => src.split("\n").map((line) => line.replace(/\/\/.*/, "")).join("\n");
    const appSrc = stripLineComments(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"));
    const timelineSrc = stripLineComments(fs.readFileSync(path.join(__dirname, "..", "src", "features", "timeline.js"), "utf8"));
    const badPattern = /new Date\(\s*["'`]/;
    check("app.jsにnew Date(\"文字列\")形の禁止パターンが無い(コード部分のみ)", !badPattern.test(appSrc));
    check("timeline.jsにnew Date(\"文字列\")形の禁止パターンが無い(コード部分のみ)", !badPattern.test(timelineSrc));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v357 ALL PASS" : `\n❌ v357: ${failures} 件失敗`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
