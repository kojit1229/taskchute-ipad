// v355a: 「空き時間を補う」シート(TIME COMB「補う」/実行ヘッダ「＋Block」→タスクから選ぶ/
// 分割して置く/新しいBlockを作る)。
// v355a独立レビュー(review-v355-claude-a/b)対応でスコープを見直した: 「新しいBlockを作る」
// 最小パネル(長さ/カテゴリ)はシート内に戻した(H-1/H-2。タイムライン描画・PC CSSに触れず
// 持ち越す理由が無いため)。タイムラインの空き時間タップ(タイムライン上への新規分岐)・
// PC左列差し替え+選択中ハイライト・Project select/ルーティン雛形プリフィルは、タイムライン
// 配置計算への追加分岐やCodex実機検証が必要なCSS差し替えという別カテゴリのリスクのため
// 引き続き v355b へ持ち越す。
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

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function project(id, extra = {}) {
  return { id, title: "決算ナビ12WY", kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function task(id, extra = {}) {
  return { id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, dueDate: "", progressNum: 0, progressDen: 10, estimateMin: null,
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

    // fixture: 実績07:10-09:00(110分)が空き。タスク6件(見積45/60/90/25/150/30・
    // 期限=今日/明日/超過(昨日)/+3日/+2日/なし)
    const tToday = task("t-today", { title: "週次レビューまとめ", dueDate: TODAY, estimateMin: 45 });
    const tTomorrow = task("t-tomorrow", { title: "9Wジム②ベンチ", dueDate: addDaysISO(TODAY, 1), estimateMin: 60 });
    const tOverdue = task("t-overdue", { title: "UIレビュー指摘の反映", dueDate: addDaysISO(TODAY, -1), estimateMin: 90 });
    const tPlus3 = task("t-plus3", { title: "ウイスキー勉強コマ", dueDate: addDaysISO(TODAY, 3), estimateMin: 25 });
    const tPlus2 = task("t-plus2", { title: "決算ナビ修正レビュー", dueDate: addDaysISO(TODAY, 2), estimateMin: 150 });
    const tNoDue = task("t-nodue", { title: "Kindleハイライト整理", dueDate: "", estimateMin: 30 });
    // M-4: 見積未設定タスク。期限は全タスク中もっとも早い(超過)が、見積が無いぶん
    // 「収まる」側の末尾に回ることを検証する(期限の近さより見積の有無を優先しない=事実表示)。
    const tNoEstimate = task("t-noest", { title: "物置整理メモ", dueDate: addDaysISO(TODAY, -5), estimateMin: null });
    const tasks = [tToday, tTomorrow, tOverdue, tPlus3, tPlus2, tNoDue, tNoEstimate];
    const morning = actualBlock("b-morning", { actualStartAt: `${TODAY}T06:00:00`, actualEndAt: `${TODAY}T07:10:00` });
    const later = actualBlock("b-later", { actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T10:00:00` });

    async function seedFixture(extra = {}) {
      await seed(page, {
        currentView: "exec", selectedDate: TODAY,
        projects: [project("p1")], tasks, blocks: [morning, later], ...extra
      });
    }

    console.log("[1] TIME COMB「補う」/ 実行ヘッダ「＋Block」がどちらも「空き時間を補う」シート(state.modal.type=fillGap)を開く(3導線目=タイムラインの空き時間タップはv355bへ持ち越し・既存timeline-new-block挙動は無改変)");
    await seedFixture();
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const headingTC = await page.textContent(".fill-gap-sheet .modal-title");
    check("TIME COMBの「補う」で空き時間を補うシートが開く", headingTC.includes("空き時間を補う"), headingTC);
    check("見出しに時刻(07:10 – 09:00)とN分(110分)が入る", headingTC.includes("07:10") && headingTC.includes("09:00") && headingTC.includes("110分"), headingTC);
    check("見出しに「置くと07:10開始のBlock」の文言が入る", headingTC.includes("07:10 開始"), headingTC);
    // state.modalはUI一時状態のため他モーダル(block/task等)と同じくlocalStorageへ永続化されない
    // (openBlockEditor等と同型)。.fill-gap-sheetのDOM出現自体がstate.modal.type="fillGap"経路を
    // 通った証跡(buildFillGapModalしか出さないclass名)であるため、それで代替する。
    check("modalRootが開いた状態(.fill-gap-sheet経由=state.modal.type=fillGap)になる",
      await page.evaluate(() => document.querySelector("#modalRoot")?.classList.contains("open")));
    await page.click('.fill-gap-sheet [data-action="modal-close"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });

    await page.click('[data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForSelector(".exec-header-actions");
    await page.click('.exec-header-actions [data-action="fill-gap-open"]');
    await page.waitForSelector(".fill-gap-sheet");
    const headingHdr = await page.textContent(".fill-gap-sheet .modal-title");
    check("実行ヘッダ「＋Block」でも同じ「空き時間を補う」シートが開く(いま以降の最初の空き時間)", headingHdr.includes("空き時間を補う"), headingHdr);
    // M-2対応: ＋Blockも TIME COMB と同じ「実績間の空き時間」(actualGaps)を使う。fixtureは
    // 実績のみの日(06:00-07:10 / 09:00-10:00、FIXED_NOW=10:00)で、10:00以降の実績間隙間は
    // 無いため「現在時刻直後30分」にフォールバックする(=10:00-10:30・30分)。旧
    // computeFreeGaps(計画ベース・05:00-23:00既定窓)のままなら「10:00 – 23:00・780分」の
    // ような事実に反する枠になっていた(独立レビューM-2で指摘)ため、その負例も併せて pin する。
    check("見出しの時刻/N分がactualGapsベースで正しい(10:00 – 10:30・30分)",
      headingHdr.includes("10:00") && headingHdr.includes("10:30") && headingHdr.includes("30分"), headingHdr);
    check("旧computeFreeGapsベースの誤った780分にはならない(負例)", !headingHdr.includes("780分"), headingHdr);
    await page.click('.fill-gap-sheet [data-action="modal-close"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });

    console.log("[2] タスクから選ぶ: 見積<=110が上(期限順・無期限は最後)・>110は「分割して置く」");
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const rowTitles = await page.$$eval(".fill-gap-row strong", (els) => els.map((el) => el.textContent));
    check("見積が収まる5件が期限順(超過→今日→明日→+3→無期限)で先頭に並ぶ",
      JSON.stringify(rowTitles.slice(0, 5)) === JSON.stringify(["UIレビュー指摘の反映", "週次レビューまとめ", "9Wジム②ベンチ", "ウイスキー勉強コマ", "Kindleハイライト整理"]),
      JSON.stringify(rowTitles));
    check("M-4: 見積未設定タスクは期限が最も早くても「収まる」側の末尾(6番目)に回る",
      rowTitles[5] === "物置整理メモ", JSON.stringify(rowTitles));
    check("見積150(空き時間超過)は最後に来る", rowTitles[6] === "決算ナビ修正レビュー", JSON.stringify(rowTitles));
    const rowButtons = await page.$$eval(".fill-gap-row button", (els) => els.map((el) => el.textContent.trim()));
    check("先頭6件は「ここに置く」・最後の1件は「分割して置く」",
      rowButtons.slice(0, 6).every((t) => t === "ここに置く") && rowButtons[6] === "分割して置く",
      JSON.stringify(rowButtons));
    const rowMetas = await page.$$eval(".fill-gap-row", (els) => els.map((el) => el.querySelector(".exec-row-meta")?.textContent || ""));
    check("M-4: 見積未設定タスクの行は「見積30分」と偽らず「見積なし」と表示する",
      rowMetas[5]?.includes("見積なし") && !rowMetas[5]?.includes("見積 30分"), rowMetas[5]);
    check("見積が設定されているタスクは従来どおり「見積N分」表示のまま", rowMetas[0]?.includes("見積 90分"), rowMetas[0]);

    console.log("[3] 「ここに置く」: 07:10開始・見積どおりの計画Blockが増え、シートが閉じ、Taskは不変");
    await resetSetItemLog(page);
    const beforeBlocksLen = (await stateNow(page)).blocks.length;
    await page.click('.fill-gap-row:has-text("週次レビューまとめ") [data-action="fill-gap-place"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    const stAfterPlace = await stateNow(page);
    check("シートが閉じる(state.modal=null)", stAfterPlace.modal === null);
    check("Blockが1件増える", stAfterPlace.blocks.length === beforeBlocksLen + 1, `${stAfterPlace.blocks.length} vs ${beforeBlocksLen}`);
    const placedBlock = stAfterPlace.blocks.find((b) => b.taskId === "t-today");
    check("07:10開始の計画Blockになる", (placedBlock?.plannedStartAt || "").includes("T07:10"), placedBlock?.plannedStartAt);
    check("見積どおり45分のBlock(plannedEndAt=07:55)になる", (placedBlock?.plannedEndAt || "").includes("T07:55"), placedBlock?.plannedEndAt);
    const taskAfterPlace = stAfterPlace.tasks.find((t) => t.id === "t-today");
    check("Taskの進捗/見積/statusは不変", taskAfterPlace.progressNum === 0 && taskAfterPlace.estimateMin === 45 && taskAfterPlace.status === "todo",
      JSON.stringify(taskAfterPlace));
    check("トーストに開始時刻が入る", (await page.locator(".toast").last().textContent().catch(() => "")).includes("07:10"));

    console.log("[3b] M-2復元: 同じ空き時間に同じTaskをもう一度「ここに置く」しても重複せず、既存Blockの編集モーダルが開く");
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const beforeDupLen = (await stateNow(page)).blocks.length;
    await page.click('.fill-gap-row:has-text("週次レビューまとめ") [data-action="fill-gap-place"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    const stAfterDup = await stateNow(page);
    check("Blockは増えない(冪等)", stAfterDup.blocks.length === beforeDupLen, `${stAfterDup.blocks.length} vs ${beforeDupLen}`);
    // state.modalはUI一時状態でsaveState()を経由しないと即座にlocalStorageへ反映されない
    // (openBlockEditor自体はsaveAndRenderを呼ばない=通常のBlock編集モーダル開閉と同型)ため、
    // DOM側(Block編集モーダル特有の見出し文言)で判定する。
    const dupModalTitle = await page.evaluate(() => document.querySelector(".modal-title")?.textContent || "");
    check("既存Blockの編集モーダルが開く(新規作成せず既存Blockを開く=冪等化)",
      dupModalTitle.includes("Block を編集"), dupModalTitle);
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector(".modal-title", { state: "detached" }).catch(() => {});

    console.log("[4] 「分割して置く」: 110分のBlockが増え、Taskの見積は不変");
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const beforeSplitLen = (await stateNow(page)).blocks.length;
    await page.click('.fill-gap-row:has-text("決算ナビ修正レビュー") [data-action="fill-gap-place"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    const stAfterSplit = await stateNow(page);
    check("Blockが1件増える(分割)", stAfterSplit.blocks.length === beforeSplitLen + 1);
    const splitBlock = stAfterSplit.blocks.find((b) => b.taskId === "t-plus2");
    check("分割Blockは07:10開始・110分(plannedEndAt=09:00)ちょうど", (splitBlock?.plannedStartAt || "").includes("T07:10") && (splitBlock?.plannedEndAt || "").includes("T09:00"),
      `${splitBlock?.plannedStartAt} - ${splitBlock?.plannedEndAt}`);
    check("分割Blockのestimateminは空き時間分(110)", splitBlock?.estimateMin === 110, splitBlock?.estimateMin);
    const taskAfterSplit = stAfterSplit.tasks.find((t) => t.id === "t-plus2");
    check("元Taskの見積(150)は変更されない(残見積の自動控除はしない仕様)", taskAfterSplit.estimateMin === 150, taskAfterSplit.estimateMin);

    console.log("[4b] H-1/H-2対応: 「新しいBlockを作る」(長さ選択+カテゴリ)で開始時刻=空き時間の頭・長さ=選択値のBlockができる");
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    check("候補一覧の下に「新しいBlockを作る」パネルが常に出る(候補が0件の行き止まりを解消)",
      (await page.locator(".fill-gap-new").count()) === 1);
    await page.fill("#fillGapTitle", "自由作業ブロック");
    await page.selectOption("#fillGapLength", "45");
    const beforeCreateLen = (await stateNow(page)).blocks.length;
    await page.click('[data-action="fill-gap-create"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    const stAfterCreate = await stateNow(page);
    check("Blockが1件増える", stAfterCreate.blocks.length === beforeCreateLen + 1, `${stAfterCreate.blocks.length} vs ${beforeCreateLen}`);
    const createdBlock = stAfterCreate.blocks.find((b) => b.title === "自由作業ブロック");
    check("開始時刻は空き時間の頭(07:10)", (createdBlock?.plannedStartAt || "").includes("T07:10"), createdBlock?.plannedStartAt);
    check("長さは選択値45分(plannedEndAt=07:55)", (createdBlock?.plannedEndAt || "").includes("T07:55"), createdBlock?.plannedEndAt);
    check("トーストに開始時刻が入る", (await page.locator(".toast").last().textContent().catch(() => "")).includes("07:10"));

    console.log("[4c] M-1対応: シート下部ヒントは実装済みの2導線だけを案内する(未実装の空き時間タップは書かない)");
    // v355修正: 直前のfill-gap-create保存で全再描画が起き、.exec-analysis-fold(<details>)は
    // 既定閉に戻る(状態を保持していない)ため、[4]/[4b]と同様に開き直してから隙間を開く。
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const hintText = await page.textContent(".fill-gap-hint");
    // v357追随: タイムラインの空き時間タップ(exec内)をfill-gap-openへ配線したため、
    // v355時点の「未実装なので載せない」という前提が変わった。ヒントは3導線すべてを案内する。
    check("ヒントはタイムラインの空き時間タップの案内を含む(v357で実装)", hintText.includes("タイムラインの空き時間タップ"), hintText);
    check("ヒントは実装済みのTIME COMB/＋Blockの案内を残す", hintText.includes("TIME COMB") && hintText.includes("＋Block"), hintText);

    console.log("[4d] M-3対応: 1280px(PC)でもシート表示中に横スクロールが発生しない");
    await page.setViewportSize({ width: 1280, height: 900 });
    const scrollW1280 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW1280 = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280pxで横スクロールが発生しない(シート表示中)", scrollW1280 <= clientW1280 + 1, `${scrollW1280} vs ${clientW1280}`);
    await page.click('.fill-gap-sheet [data-action="modal-close"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    await page.setViewportSize({ width: 390, height: 844 });

    console.log("[5] 390px横スクロールなし・pageerror 0・state書込は「置く」以外で発生しない");
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".exec-analysis-fold");
    await page.click(".exec-analysis-fold summary");
    await page.waitForSelector(".time-comb-gap");
    await resetSetItemLog(page);
    await page.click(".time-comb-gap");
    await page.waitForSelector(".fill-gap-sheet");
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    check("390pxで横スクロールが発生しない(シート表示中)", scrollW <= clientW + 1, `${scrollW} vs ${clientW}`);
    await page.click('.fill-gap-sheet [data-action="modal-close"]');
    await page.waitForSelector(".fill-gap-sheet", { state: "detached" });
    check("シートを開いて閉じるだけではcontent-changing setItemが0回", await contentChangingWrites(page, STATE_KEY) === 0);
    check("pageerrorが0件(全体)", pageErrors.length === 0, JSON.stringify(pageErrors));

    console.log("[6] iOS Safari禁則: new Date(\"文字列\")パース無し(静的grep、v355で触ったコード範囲)");
    // コメント中の言及(例: weekRange()の「new Date("...T00:00:00")はiOSで誤解釈」という注意書き)を
    // 誤検知しないよう、各行の "//" 以降を落としてからコードだけを検査する。
    // 行末が\r(CRLF)だと`.`が\rを跨げず`\/\/.*$`が丸ごとマッチ失敗する(=何も消えない)ため、
    // $アンカーを使わず素朴に「//以降の残り」を落とす(.は既定でも\rの手前までは食う)。
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

  console.log(failures === 0 ? "\n✅ v355 ALL PASS" : `\n❌ v355: ${failures} 件失敗`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
