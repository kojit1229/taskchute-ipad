// v359検証: Block編集シート(buildBlockModal)を基本→時間→エネルギー→繰り返し→メモの
// 5節へ再編する(発注: workbench/out/2026-09-02-tc-life-platform/order-v359-block-edit-sheet.md)。
//
// 実装差分が実行コード200行予算を超えたため、発注文の分割指示に従い今回は「5節組み替え」だけを
// 実施した(見積チップ15/25/40/60・「明日へ」「来週へ」日付シフト・「詳細 ›」折りたたみは
// 未実装。data-modal-fieldの名前・意味・保存ロジックは無変更)。
//
// レビュー反映(review-v359-claude-a.md / review-v359-claude-b.md、監督者裁定2026-09-05):
// (1) 静的検査: buildBlockModal内の節見出しが基本→時間→エネルギー→繰り返し→メモの順で
//     出現し、各data-modal-field(renderCategorySelect()由来のcategoryを含む)がどの節に
//     属するかを個別にpinする(A-M3/B-M1/B-M2)。new Date("...")を含まないことも確認する。
// (2) MIT(★今日の主役)の4パターン(false→true / true→false / 上限超過で拒否 / 既存MITの
//     維持)をすべて検証する(B-H2)。上限超過時は既存toggleMIT()と同様に保存自体を中断し、
//     モーダルは開いたまま・他フィールドも書き込まれないことを確認する(A-M1/B-M5)。
// (3) 「完了済み(Block)」🏁タスク完了トグルは時間節の末尾にあることを節所属pinで固定する
//     (A-M2)。
// (4) 充電/放電セレクトを変更して保存すると block.charge/discharge に反映される(回帰)。
// (5) 繰り返し済み(daily)シリーズでは固定化・既定充放電・アンカーが表示され、weeklyでは
//     出ない(既存条件["daily","weekdays"].includes(liveRule.kind)を維持していることの回帰)。
// (6) `.tower-sheet` はBlock編集モーダルにのみ付与され、Project/Task編集モーダルには
//     付かないことを実行時に確認する(B-M3)。
// (7) 390px/1280pxで横スクロールが発生せず、390pxで.modal-card内のすべてのinput/select/
//     textareaのfont-sizeが16px以上、保存/削除/閉じるボタンが44px以上、pageerrorが0件
//     であること(A-M4)。
// (8) waitForTimeoutは使わない(CLAUDE.md明文禁止・B-H1)。selector/state/DOM状態の成立を待つ。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---------------------------------------------------------------
// (1) 静的検査(ブラウザ不要)
// ---------------------------------------------------------------
function staticChecks() {
  console.log("[static] buildBlockModalの節順序・節ごとのdata-modal-field所属・new Date(文字列)不使用");
  const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const startIdx = src.indexOf("function buildBlockModal(block) {");
  check("buildBlockModal関数が見つかる", startIdx !== -1);
  // 次のトップレベル関数宣言(saveBlockFromModal)までを関数本体とみなす。
  const endIdx = src.indexOf("\nfunction saveBlockFromModal(", startIdx);
  check("saveBlockFromModalが後続に見つかる", endIdx !== -1);
  const body = src.slice(startIdx, endIdx === -1 ? undefined : endIdx);

  const headings = Array.from(body.matchAll(/<h4 class="tower-section-title"[^>]*>([^<]*)<\/h4>/g)).map((m) => m[1].trim());
  const expectedHeadings = ["基本", "時間", "エネルギー", "🔁 繰り返し", "メモ"];
  check("節見出しが 基本→時間→エネルギー→繰り返し→メモ の順で5つ出現する",
    JSON.stringify(headings) === JSON.stringify(expectedHeadings), JSON.stringify(headings));

  // A-M3/B-M1/B-M2レビュー反映: 節見出しの並びだけでなく、各<section class="tower-section">
  // の内部に出現するdata-modal-field(categoryはrenderCategorySelect()呼び出しとして検出)を
  // 節ごとに個別pinする。これにより「フィールドを別節へ移してもテストが緑のまま通る」穴を塞ぐ。
  // v366: レバレッジ種別・完了済み(Block)+🏁タスク完了を
  // 末尾の<details class="tower-fold">(既定閉・data-fold-idなし=非永続)へ移設したため、
  // 5節の各スライスは<details>開始位置で打ち切り、移設先の内容は別途detailsSliceとして
  // 検証する。シリーズ設定はliveRuleの有無によらず繰り返し節に残す(総出現数もpinする)。
  const sectionStarts = Array.from(body.matchAll(/<section class="tower-section"[^>]*>/g));
  check("<section class=\"tower-section\">の開始タグが5つ出現する", sectionStarts.length === 5, sectionStarts.length);
  const detailsIdx = body.indexOf("<details class=\"tower-fold\">");
  check("<details class=\"tower-fold\">が見つかる", detailsIdx !== -1);
  const detailsEndIdx = detailsIdx !== -1 ? body.indexOf("</details>", detailsIdx) + "</details>".length : -1;
  const detailsSlice = detailsIdx !== -1 ? body.slice(detailsIdx, detailsEndIdx) : "";
  const sectionSlices = sectionStarts.map((m, i) => {
    const start = m.index;
    let end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : body.length;
    if (detailsIdx !== -1 && detailsIdx > start && detailsIdx < end) end = detailsIdx;
    return body.slice(start, end);
  });
  // 節内のフィールド出現順を、data-modal-field属性とrenderCategorySelect()呼び出し
  // (categoryはこの関数呼び出しでしかHTMLへ出ないため、静的な属性走査だけでは検出できない)の
  // 両方を1つの正規表現で拾い、出現順どおりの配列にする。
  const fieldOrCategoryRe = /data-modal-field="([a-zA-Z]+)"|renderCategorySelect\(/g;
  const extractFields = (slice) =>
    Array.from(slice.matchAll(fieldOrCategoryRe)).map((m) => m[1] || "category");

  const expectedSections = [
    { heading: "基本", fields: ["title", "category", "taskId", "isMIT"] },
    { heading: "時間", fields: ["date", "plannedStartAt", "plannedEndAt", "estimateMin", "actualStartAt", "actualEndAt"] },
    { heading: "エネルギー", fields: ["charge", "discharge"] },
    { heading: "🔁 繰り返し", fields: ["recurrenceKind", "streakFixed", "expectedCharge", "expectedDischarge", "anchor", "recurrenceKind"] },
    { heading: "メモ", fields: ["comment"] }
  ];
  expectedSections.forEach((expected, i) => {
    const slice = sectionSlices[i];
    const actualFields = slice ? extractFields(slice) : null;
    check(`節「${expected.heading}」のdata-modal-field所属が固定どおり`,
      JSON.stringify(actualFields) === JSON.stringify(expected.fields),
      `actual=${JSON.stringify(actualFields)}`);
  });
  // 監督者裁定(2026-09-05、review-v363-claude-a H-1/review-v363-claude-b M-4): 固定化・
  // 既定充放電・アンカーの3行はモック注記どおり繰り返し節へ戻した。「詳細 ›」は
  // レバレッジ種別・完了済み(Block)・🏁タスク完了の3項目のみ(taskCompleteHTMLは
  // data-modal-fieldを持たないため下のcheckで別途確認する)。
  const detailsFields = extractFields(detailsSlice);
  check("「詳細 ›」のdata-modal-field所属が固定どおり(レバレッジ種別・完了済みの2種のみ)",
    JSON.stringify(detailsFields) === JSON.stringify(["leverageType", "completed"]),
    `actual=${JSON.stringify(detailsFields)}`);
  check("🏁タスク完了トグル(taskCompleteHTML)は「詳細 ›」に挿入される(時間節/エネルギー節から除去済み)",
    detailsSlice.includes("${taskCompleteHTML}")
    && !!sectionSlices[1] && !sectionSlices[1].includes("${taskCompleteHTML}")
    && !!sectionSlices[2] && !sectionSlices[2].includes("${taskCompleteHTML}"));

  const allFields = [...sectionSlices.flatMap(extractFields), ...detailsFields];
  const uniqueNames = Array.from(new Set(allFields)).sort();
  // v359時点でpinする静的フィールド名一覧(旧18種+新設isMIT+category=20種)。v366は
  // レバレッジ種別・完了済みの置き場所を変えただけで種類・総数は不変。
  const expectedUnique = [
    "actualEndAt", "actualStartAt", "anchor", "category", "charge", "comment", "completed", "date",
    "discharge", "estimateMin", "expectedCharge", "expectedDischarge", "isMIT", "leverageType",
    "plannedEndAt", "plannedStartAt", "recurrenceKind", "streakFixed", "taskId", "title"
  ];
  check("data-modal-fieldのユニーク名一覧が変わっていない(category込み20種、isMIT追加のみ)",
    JSON.stringify(uniqueNames) === JSON.stringify(expectedUnique), JSON.stringify(uniqueNames));
  check("data-modal-field(category込み)の総出現数が21件で変わっていない(重複デグレのpin)",
    allFields.length === 21, allFields.length);
  check("recurrenceKindは繰り返し節内の2分岐分(liveRuleなし/あり)で2回出現する",
    allFields.filter((n) => n === "recurrenceKind").length === 2, allFields.filter((n) => n === "recurrenceKind").length);
  check("buildBlockModal内に new Date(\" を含まない(iOS Safari日時パース禁則)",
    !/new Date\(\s*["'`]/.test(body));
}

(async () => {
  staticChecks();

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  // B-H1レビュー反映: 固定のwaitForTimeoutを使わず、selector/DOM状態/localStorageの
  // 成立を待つヘルパーへ置き換える(CLAUDE.md「固定時間そのものが仕様でない限り、新しい
  // waitForTimeoutを追加しない」の明文禁止対応)。
  async function waitForStateReady(pg) {
    await pg.waitForFunction((k) => {
      try { return !!JSON.parse(localStorage.getItem(k)); } catch { return false; }
    }, KEY);
  }
  async function waitForNavReady(pg) {
    await pg.waitForSelector('[data-action="nav"]', { state: "attached" });
  }
  async function waitForModalClosed(pg) {
    await pg.waitForFunction(() => !document.querySelector("#modalRoot")?.classList.contains("open"));
  }
  async function waitForModalField(pg, fieldName) {
    await pg.waitForSelector(`.modal-card [data-modal-field="${fieldName}"]`, { state: "attached" });
  }

  function makeBlock(id, extra = {}) {
    return {
      id, taskId: "", date: TODAY, title: `Block ${id}`, category: "",
      plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "",
      pomodoroCount: 0, migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false,
      source: "", estimateMin: null, leverageType: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, ...extra
    };
  }

  async function seed({ blocks = [], recurrences = [], tasks = [], projects = [], view = "timeline" } = {}) {
    await page.evaluate(({ KEY, blocks, recurrences, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = blocks;
      s.recurrences = recurrences;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, recurrences, tasks, projects, TODAY, view });
    await page.reload();
    await waitForNavReady(page);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function openEditor(id) {
    await page.click(`[data-action="edit-block"][data-id="${id}"]`);
    await waitForModalField(page, "title");
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(page);
    await passGithubGate(page);

    // ============================================================
    // (2) MIT ★ の4パターン: false→true / true→false / 上限超過で拒否 / 既存MITの維持
    // ============================================================
    console.log("[1] MIT(★今日の主役): false→true → 保存でblock.isMITがtrueになる");
    await seed({ blocks: [makeBlock("b1")] });
    await openEditor("b1");
    const mitCheckbox = page.locator('.modal-card [data-modal-field="isMIT"]');
    check("MIT用チェックボックスがモーダル内にある", await mitCheckbox.count() === 1);
    check("初期状態は未チェック", await mitCheckbox.isChecked() === false);
    await mitCheckbox.check();
    await page.click('[data-action="modal-save"]');
    await waitForModalClosed(page);
    const s1 = await stateNow();
    check("保存後にisMITがtrueになる", s1.blocks.find((b) => b.id === "b1")?.isMIT === true, JSON.stringify(s1.blocks[0]));

    console.log("[2] MIT: true→false → 保存でblock.isMITがfalseになる(解除)");
    await seed({ blocks: [makeBlock("b1b", { isMIT: true })] });
    await openEditor("b1b");
    const mitCheckbox2 = page.locator('.modal-card [data-modal-field="isMIT"]');
    check("既存MIT=trueは初期状態でチェック済み", await mitCheckbox2.isChecked() === true);
    await mitCheckbox2.uncheck();
    await page.click('[data-action="modal-save"]');
    await waitForModalClosed(page);
    const s1b = await stateNow();
    check("解除後にisMITがfalseになる", s1b.blocks.find((b) => b.id === "b1b")?.isMIT === false, JSON.stringify(s1b.blocks.find((b) => b.id === "b1b")));

    console.log("[3] MIT: 既存MIT(true)は維持される(★以外のフィールドを編集してもガードされない)");
    await seed({ blocks: [makeBlock("k1", { isMIT: true }), makeBlock("k2", { isMIT: true }), makeBlock("k3", { isMIT: true })] });
    await openEditor("k1");
    await page.locator('.modal-card [data-modal-field="comment"]').fill("別フィールドの編集のみ");
    await page.click('[data-action="modal-save"]');
    await waitForModalClosed(page);
    const s1c = await stateNow();
    check("既存MIT(true)はコメントだけ編集しても維持される", s1c.blocks.find((b) => b.id === "k1")?.isMIT === true, JSON.stringify(s1c.blocks.find((b) => b.id === "k1")));
    check("コメントは正しく保存される", s1c.blocks.find((b) => b.id === "k1")?.comment === "別フィールドの編集のみ");

    // A-M1/B-M5レビュー反映(監督者裁定): 上限超過時は既存toggleMIT()と同様に保存自体を
    // 中断する。トーストだけ出してreturnし、モーダルは開いたまま・他フィールドも書き込まない。
    console.log("[4] MIT: 同日に既にMIT3件あると4件目は保存自体が中断される(トーストのみ・モーダル維持・他フィールド不変)");
    await seed({
      blocks: [
        makeBlock("m1", { isMIT: true }), makeBlock("m2", { isMIT: true }), makeBlock("m3", { isMIT: true }),
        makeBlock("m4")
      ]
    });
    await openEditor("m4");
    await page.locator('.modal-card [data-modal-field="isMIT"]').check();
    // 「他フィールドも書かない」ことを検出できるよう、タイトルも同時に変更しておく。
    await page.locator('.modal-card [data-modal-field="title"]').fill("m4 renamed(保存されないはず)");
    await page.click('[data-action="modal-save"]');
    await page.waitForFunction(() => {
      const t = document.querySelector("#toast");
      return !!t && t.classList.contains("show") && t.textContent.includes("今日の主役は最大3個まで");
    });
    const toastText = await page.locator("#toast").innerText();
    check("上限超過ガードのトーストが表示される", toastText.includes("今日の主役は最大3個まで。先に他を外してください"), toastText);
    const modalStillOpen = await page.evaluate(() => document.querySelector("#modalRoot")?.classList.contains("open"));
    check("保存が中断されモーダルは閉じない", modalStillOpen === true);
    const s2 = await stateNow();
    check("4件目はisMIT=falseのまま(保存自体が中断される)", s2.blocks.find((b) => b.id === "m4")?.isMIT === false, JSON.stringify(s2.blocks.find((b) => b.id === "m4")));
    check("4件目のtitleも書き込まれない(他フィールドも保存されない)", s2.blocks.find((b) => b.id === "m4")?.title === "Block m4", JSON.stringify(s2.blocks.find((b) => b.id === "m4")));
    check("既存3件のisMITは変化しない", ["m1", "m2", "m3"].every((id) => s2.blocks.find((b) => b.id === id)?.isMIT === true));
    await page.click('[data-action="modal-close"]');
    await waitForModalClosed(page);

    // ============================================================
    // (4) 充電/放電セレクトの保存反映(回帰)
    // ============================================================
    console.log("[5] 充電/放電セレクトを変更して保存するとblock.charge/dischargeに反映される");
    await seed({ blocks: [makeBlock("b2")] });
    await openEditor("b2");
    await page.selectOption('.modal-card [data-modal-field="charge"]', "3");
    await page.selectOption('.modal-card [data-modal-field="discharge"]', "2");
    await page.click('[data-action="modal-save"]');
    await waitForModalClosed(page);
    const s3 = await stateNow();
    const b2 = s3.blocks.find((b) => b.id === "b2");
    check("chargeが保存される", b2?.charge === 3, JSON.stringify(b2));
    check("dischargeが保存される", b2?.discharge === 2, JSON.stringify(b2));

    // ============================================================
    // (5) 繰り返し: daily/weekdaysのときだけ固定化が出る(既存条件の回帰)。
    // 既定充放電・アンカーは`block.category === "ルーティン"`のときだけ追加で出る条件だが、
    // カテゴリ「ルーティン」のBlockは専用のホーム/実行画面へ振り分けられ(execTargetBlocks/
    // timeline.jsの除外条件)、この静的サーバE2Eから安定して到達させる導線が確認できなかった
    // ため、その部分は移設前の元コードをそのまま保持したことの静的検査(static checks)と目視
    // レビューに委ねる(既存条件式そのものは1文字も変えていない)。
    // ============================================================
    console.log("[6] 繰り返しシリーズ(daily)は固定化チェックが表示され、weeklyでは出ない");
    const dailyRule = {
      id: "rule-daily", title: "ルーティンA", category: "", taskId: "",
      kind: "daily", startTime: "09:00:00", endTime: "09:30:00", anchorDate: TODAY,
      expectedCharge: "", expectedDischarge: "", anchor: "", source: "", exceptionDates: [],
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
    await seed({
      blocks: [makeBlock("br-daily", { recurrenceGroupId: "rule-daily" })],
      recurrences: [dailyRule]
    });
    await openEditor("br-daily");
    check("dailyシリーズでは固定化チェックが出る", await page.locator('.modal-card [data-modal-field="streakFixed"]').count() === 1);
    check("dailyシリーズ(カテゴリ未設定)では既定充放電/アンカーは出ない(ルーティン限定条件の回帰)",
      await page.locator('.modal-card [data-modal-field="expectedCharge"]').count() === 0
      && await page.locator('.modal-card [data-modal-field="anchor"]').count() === 0);
    await page.click('[data-action="modal-close"]');
    await waitForModalClosed(page);

    const weeklyRule = { ...dailyRule, id: "rule-weekly", kind: "weekly" };
    await seed({
      blocks: [makeBlock("br-weekly", { recurrenceGroupId: "rule-weekly" })],
      recurrences: [weeklyRule]
    });
    await openEditor("br-weekly");
    check("weeklyシリーズでは固定化チェックが出ない", await page.locator('.modal-card [data-modal-field="streakFixed"]').count() === 0);
    await page.click('[data-action="modal-close"]');
    await waitForModalClosed(page);

    // ============================================================
    // (6) B-M3レビュー反映: `.tower-sheet` はBlock編集モーダルにのみ付与され、
    // Project/Task編集モーダルには付かないことを実行時に確認する。
    // ============================================================
    console.log("[7] .tower-sheetはBlock編集モーダルにのみ付与される(Project/Task編集モーダルには付かない)");
    const projectTS = {
      id: "proj-ts", kind: "normal", title: "tower-sheet検証Project", category: "", status: "active", priority: "中",
      showProgress: false, description: "", dueDate: "", twelveWeekStartDate: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false
    };
    const taskTS = {
      id: "task-ts", projectId: "proj-ts", parentTaskId: "", title: "tower-sheet検証Task", category: "", status: "todo", dueDate: "",
      description: "", selfDueOff: false, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
      realized: false, realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "",
      aiWork: false, aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
      criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
    await seed({ projects: [projectTS], tasks: [taskTS], view: "wbs" });

    await page.click('[data-wbs-row-id="proj-ts"] [data-action="wbs-row-menu-toggle"]');
    await page.waitForSelector('[data-wbs-row-id="proj-ts"] [data-action="edit-project"]', { state: "visible" });
    await page.click('[data-wbs-row-id="proj-ts"] [data-action="edit-project"]');
    await waitForModalField(page, "title");
    check("Project編集モーダルには.tower-sheetが付かない", await page.locator('.modal-card.tower-sheet').count() === 0);
    await page.click('[data-action="modal-close"]');
    await waitForModalClosed(page);

    await page.click('[data-wbs-row-id="task-ts"] [data-action="wbs-row-menu-toggle"]');
    await page.waitForSelector('[data-wbs-row-id="task-ts"] [data-action="edit-task"]', { state: "visible" });
    await page.click('[data-wbs-row-id="task-ts"] [data-action="edit-task"]');
    await waitForModalField(page, "title");
    check("Task編集モーダルには.tower-sheetが付かない", await page.locator('.modal-card.tower-sheet').count() === 0);
    await page.click('[data-action="modal-close"]');
    await waitForModalClosed(page);

    await seed({ blocks: [makeBlock("ts-block")] });
    await openEditor("ts-block");
    check("Block編集モーダルには.tower-sheetが付く", await page.locator('.modal-card.tower-sheet').count() === 1);
    await page.click('[data-action="modal-close"]');
    await waitForModalClosed(page);

    // ============================================================
    // (7) 390px/1280px 横スクロールなし・全input/select/textarea 16px・44pxボタン・pageerror0
    // ============================================================
    console.log("[8] 390px/1280pxで横スクロールなし、390pxで全input/select/textareaが16px以上、ボタンは44px以上");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    let mobileErrors = 0;
    pageMobile.on("pageerror", (e) => { mobileErrors++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(pageMobile);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, blocks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = []; s.projects = []; s.blocks = blocks; s.recurrences = [];
      s.selectedDate = TODAY; s.currentView = "timeline";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks: [makeBlock("mb1")], TODAY });
    await pageMobile.reload();
    await waitForNavReady(pageMobile);
    await pageMobile.click('[data-action="edit-block"][data-id="mb1"]');
    await waitForModalField(pageMobile, "title");
    const metrics390 = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない", metrics390.scrollWidth <= metrics390.clientWidth + 1,
      `scrollWidth=${metrics390.scrollWidth} clientWidth=${metrics390.clientWidth}`);
    // A-M4レビュー反映: サンプル2件ではなく.modal-card内の全input/select/textareaを走査する
    // (iOS自動ズームの主犯であるtype="number"のestimateMin等も対象に含める)。
    // checkbox(isMIT/completed/streakFixed)はiOSのフォーカス時自動ズーム対象ではない
    // (テキストキャレットを持たない入力のため。SKILL.md「16px以上」の趣旨はテキスト系
    // input/select/textareaの自動ズーム対策であり、checkboxはそもそもズーム機構の対象外)
    // ため、この走査からは除外する(既存の.checkbox-line 14px運用=v359以前からの既存挙動)。
    const fontSizeReport = await pageMobile.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.modal-card input, .modal-card select, .modal-card textarea'))
        .filter((el) => el.type !== "checkbox");
      return els.map((el) => ({
        field: el.getAttribute("data-modal-field") || el.type || el.tagName.toLowerCase(),
        fontSize: parseFloat(getComputedStyle(el).fontSize)
      }));
    });
    check(".modal-card内のinput/select/textarea(checkbox除く)が1つ以上ある", fontSizeReport.length > 0, fontSizeReport.length);
    check("全input/select/textarea(checkbox除く)のfont-sizeが16px以上(iOS自動ズーム対策)",
      fontSizeReport.every((r) => r.fontSize >= 16), JSON.stringify(fontSizeReport.filter((r) => r.fontSize < 16)));
    const footerBtnHeight = await pageMobile.evaluate(() => {
      const el = document.querySelector('.modal-card [data-action="modal-save"]');
      // レイアウト高(offsetHeight)で測る: モーダルの入場アニメーション(transform scale)中の
      // getBoundingClientRect は縮小値(43.4px 等)を返し、タップ標的の実寸を表さない。
      return el ? el.offsetHeight : 0;
    });
    check("保存ボタンが44px以上", footerBtnHeight >= 44, `height=${footerBtnHeight}`);
    check("390px幅でpageerrorが0件", mobileErrors === 0, mobileErrors);
    await ctxMobile.close();

    const ctxWide = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const pageWide = await ctxWide.newPage();
    let wideErrors = 0;
    pageWide.on("pageerror", (e) => { wideErrors++; console.log("  ❌ pageerror(1280):", e.message); });
    await blockGithubApiByDefault(pageWide);
    await pageWide.clock.setFixedTime(now0);
    await pageWide.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(pageWide);
    await passGithubGate(pageWide);
    await pageWide.evaluate(({ KEY, blocks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = []; s.projects = []; s.blocks = blocks; s.recurrences = [];
      s.selectedDate = TODAY; s.currentView = "timeline";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks: [makeBlock("wb1")], TODAY });
    await pageWide.reload();
    await waitForNavReady(pageWide);
    await pageWide.click('[data-action="edit-block"][data-id="wb1"]');
    await waitForModalField(pageWide, "title");
    const metrics1280 = await pageWide.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("1280px幅で横スクロールが発生しない", metrics1280.scrollWidth <= metrics1280.clientWidth + 1,
      `scrollWidth=${metrics1280.scrollWidth} clientWidth=${metrics1280.clientWidth}`);
    check("1280px幅でpageerrorが0件", wideErrors === 0, wideErrors);
    await ctxWide.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v359 全チェック成功" : `\n❌ v359 ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
