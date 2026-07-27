// v152 検証: ADHD支援「①仕分けモード S1(ボタン版)」(CHANGES_v152.md参照)。
// Wishタブに第3の表示モード「🃏 仕分け」を追加し、前日先送りBlock(carryableBlocks)+
// 未実現Wish(updatedAt昇順)を1枚ずつ「今日やる/手放す/延期(来月)」の三択ボタンで処理する。
//
// 2系統レビュー(FAIL判定)への対応を含む:
//  (1) キュー終端性: セッション内処理済みセット(_triageSessionDone)+
//      「status=doingかつ当日Block済み」Wishの永続除外により、キューは必ず0件へ収束する
//  (2) Wish「今日やる」は過去日を閲覧中でも常に実時計の今日(todayISO())基準でBlockを作る
//  (3) Block「延期」もmigrationRitualLog(release)へ記録する(集計源の統一)
//  (4) 12月延期でtargetYearが未設定なら翌年を設定する(月間ボードの見かけ上の逆行防止)
//  (6) 二重タップガード(現在カードid不一致 or 350msクールダウン以内は無視)
//  (7) swipeTriageLogは行動成功後にのみpushする
//  (8) Wish「手放す」は子孫サブタスクもカスケードでsoft-delete
// swipeTriageLogのcomputeSyncMerge対応(5)はE2Eでは検証しにくいためapp.js側のコメント参照。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const now = new Date();
const YESTERDAY = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const TODAY = isoDate(now);
const REAL_YEAR = now.getFullYear();

// アプリ側のTRIAGE_ACTION_COOLDOWN_MS(350ms)より確実に長い待機。二重タップガードのテストでは
// 意図的にこの待機を入れない。
const COOLDOWN_WAIT = 500;

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  // ============================================================
  // Part A: メインフロー(全8件を順に処理してキューが0件へ収束すること + 各三択の効果)
  // ============================================================
  const ctxA = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log("  ❌ [A] pageerror:", e.message); });
  pageA.on("dialog", async (d) => { failures++; console.log("  ❌ [A] 予期しないネイティブダイアログ:", d.message()); await d.dismiss(); });
  await blockGithubApiByDefault(pageA);

  await pageA.goto(`http://localhost:${PORT}/`);
  await pageA.waitForTimeout(600);
  await passGithubGate(pageA);

  const wishProjectId = await pageA.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);
  check("Wish Project が既定で存在する", !!wishProjectId);

  await pageA.evaluate(({ KEY, wishProjectId, YESTERDAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // seedState()の初期デモWish(「気分が上がる散歩コースを試す」)を除去し、
    // 以降のキュー枚数アサーションをこのスイートのフィクスチャだけに揃える。
    s.tasks = s.tasks.filter((t) => t.projectId !== wishProjectId);

    s.blocks.push(
      { id: "block-v152-today", taskId: "", date: YESTERDAY, title: "先送りBlock(今日やる)", category: "仕事", estimateMin: 30, carryCount: 1, migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false, createdAt: "2026-07-20T09:00:00", updatedAt: "2026-07-20T09:00:00" },
      { id: "block-v152-drop", taskId: "", date: YESTERDAY, title: "先送りBlock(手放す)", category: "仕事", estimateMin: 20, carryCount: 0, migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false, createdAt: "2026-07-20T09:00:00", updatedAt: "2026-07-20T09:00:00" },
      { id: "block-v152-defer", taskId: "", date: YESTERDAY, title: "先送りBlock(延期)", category: "仕事", estimateMin: 15, carryCount: 0, migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false, createdAt: "2026-07-20T09:00:00", updatedAt: "2026-07-20T09:00:00" }
    );

    const wish = (id, title, updatedAt, extra) => ({
      id, projectId: wishProjectId, parentTaskId: "", title, category: "", status: "todo",
      dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: null, realized: false, realizedDate: "",
      createdAt: updatedAt, updatedAt, deleted: false, ...extra
    });
    s.tasks.push(wish("wish-v152-cascade", "カスケード削除対象Wish", "2026-01-01T09:00:00"));
    s.tasks.push(wish("wish-v152-cascade-sub-a", "完了済みサブタスク", "2026-01-01T09:00:00", { parentTaskId: "wish-v152-cascade", status: "completed" }));
    s.tasks.push(wish("wish-v152-cascade-sub-b", "未完了サブタスク", "2026-01-01T09:00:00", { parentTaskId: "wish-v152-cascade" }));
    s.tasks.push(wish("wish-v152-withsub", "サブタスク持ちWish", "2026-01-02T09:00:00"));
    s.tasks.push(wish("wish-v152-sub", "先頭サブタスク", "2026-01-02T09:00:00", { parentTaskId: "wish-v152-withsub" }));
    s.tasks.push(wish("wish-v152-defer-year", "延期(年あり)対象Wish", "2026-01-03T09:00:00", { targetMonth: 12, targetYear: 2026 }));
    s.tasks.push(wish("wish-v152-defer-noyear", "延期(年なし)対象Wish", "2026-01-04T09:00:00", { targetMonth: 12, targetYear: null }));
    s.tasks.push(wish("wish-v152-defer-none", "延期(未定)対象Wish", "2026-01-05T09:00:00"));
    s.tasks.push(wish("wish-v152-realized", "実現済みWish(対象外)", "2026-01-06T09:00:00", { realized: true, status: "completed" }));

    s.currentView = "wish";
    s.wishViewMode = "triage";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId, YESTERDAY });
  await pageA.reload();
  await pageA.waitForTimeout(500);

  const cardTitle = () => pageA.locator(".triage-card-title").textContent();
  const remainCount = async () => {
    const txt = await pageA.locator(".triage-panel > .muted").first().textContent();
    return Number((txt || "").match(/\d+/)?.[0]);
  };
  const stateNow = () => pageA.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const clickChoice = (choice) => pageA.locator(`.triage-actions [data-choice="${choice}"]`).click();

  console.log("[1] モード出入り: segmentedの「🃏 仕分け」でtriage-panelが表示される");
  check("triage-panelが表示される", await pageA.locator(".triage-panel").count() === 1);
  check("「🃏 仕分け」がactive", await pageA.locator('[data-action="wish-view-mode"][data-mode="triage"]').evaluate((el) => el.classList.contains("active")));

  console.log("[2] 初期キュー: Blockが先頭、残枚数8枚(実現済みWishは対象外)");
  check("残枚数が8枚", await remainCount() === 8, String(await remainCount()));
  check("先頭カードはBlock(今日やる用)", (await cardTitle()) === "先送りBlock(今日やる)", await cardTitle());

  // ============================================================
  // [3] 二重タップガード: 同じ「今日やる」を待機無しで連続クリックしても1回しか処理されない
  // ============================================================
  console.log("[3] 二重タップガード: 待機無しの連続クリックは2件目が無視され、1件だけ処理される");
  await clickChoice("today");
  await clickChoice("today");  // 直前の処理から350ms未満 → 無視されるはず(2枚目を誤爆しない)
  let snap = await stateNow();
  const migratedBlocks = snap.blocks.filter((b) => b.title === "先送りBlock(今日やる)" && b.migratedTo);
  check("元Blockのmigrated化は1件だけ", migratedBlocks.length === 1, JSON.stringify(migratedBlocks.map((b) => b.id)));
  const newBlocksToday = snap.blocks.filter((b) => b.title === "先送りBlock(今日やる)" && b.date === TODAY);
  check("今日への複製Blockも1件だけ(2件作られていない)", newBlocksToday.length === 1, JSON.stringify(newBlocksToday.map((b) => b.id)));
  let log = snap.swipeTriageLog || [];
  check("swipeTriageLogも1件だけ追加される(2件目はログすら残らない=行動成功後push)",
    log.filter((l) => l.targetId === "block-v152-today").length === 1, JSON.stringify(log));
  check("残枚数は8→7の1減のみ(2減していない)", await remainCount() === 7, String(await remainCount()));
  check("次に処理すべきBlock(手放す用)はまだ未処理のまま残っている",
    snap.blocks.find((b) => b.id === "block-v152-drop").deleted === false);

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [4] Block「手放す」: deleted化+migrationRitualLog(avoid)記録
  // ============================================================
  console.log("[4] Blockの「手放す」: deleted化され、migrationRitualLogにもavoidとして記録される");
  check("次のカードは「手放す」用Block", (await cardTitle()) === "先送りBlock(手放す)", await cardTitle());
  await clickChoice("drop");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const dropBlock = snap.blocks.find((b) => b.id === "block-v152-drop");
  check("Blockがdeleted化される", dropBlock.deleted === true, JSON.stringify(dropBlock));
  check("migrationRitualLogにavoidとして記録される",
    (snap.migrationRitualLog || []).some((l) => l.blockId === "block-v152-drop" && l.choice === "avoid"),
    JSON.stringify(snap.migrationRitualLog));
  log = snap.swipeTriageLog || [];
  check("swipeTriageLogにblock/drop記録がある", log.some((l) => l.targetId === "block-v152-drop" && l.kind === "block" && l.action === "drop"));
  check("残枚数が6枚に減る", await remainCount() === 6, String(await remainCount()));

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [5] Block「延期」: deleted化+Wishへ移動+migrationRitualLog(release)記録。
  //     新規に作られるWishは同セッションのキューへ即再浮上しない(終端性)
  // ============================================================
  console.log("[5] Blockの「延期」: Wishへ移動+deleted化+migrationRitualLog(release)記録。新規Wishは同セッション中は再浮上しない");
  check("次のカードは「延期」用Block", (await cardTitle()) === "先送りBlock(延期)", await cardTitle());
  const wishCountBefore = (await stateNow()).tasks.filter((t) => t.projectId === wishProjectId && !t.deleted).length;
  await clickChoice("defer");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const deferBlock = snap.blocks.find((b) => b.id === "block-v152-defer");
  check("Blockがdeleted化される", deferBlock.deleted === true, JSON.stringify(deferBlock));
  check("migrationRitualLogにreleaseとして記録される(設計書§④の記録漏れ修正)",
    (snap.migrationRitualLog || []).some((l) => l.blockId === "block-v152-defer" && l.choice === "release"),
    JSON.stringify(snap.migrationRitualLog));
  const newWish = snap.tasks.find((t) => t.title === "先送りBlock(延期)" && t.projectId === wishProjectId && !t.deleted);
  check("Wishへの新規タスクが作られる(moveBlockToWish相当)", !!newWish, JSON.stringify(snap.tasks.map((t) => t.title)));
  const wishCountAfter = snap.tasks.filter((t) => t.projectId === wishProjectId && !t.deleted).length;
  check("Wishタスク総数が+1される", wishCountAfter === wishCountBefore + 1, `${wishCountBefore}->${wishCountAfter}`);
  log = snap.swipeTriageLog || [];
  check("swipeTriageLogにblock/defer記録がある", log.some((l) => l.targetId === "block-v152-defer" && l.kind === "block" && l.action === "defer"));
  check("残枚数は6→5の1減のみ(新規Wishが即座に加算されて相殺されていない=終端性の要)", await remainCount() === 5, String(await remainCount()));

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [6] Wish「手放す」: 本体+子孫サブタスクをカスケードでsoft-delete(裁定事項)
  // ============================================================
  console.log("[6] Wishの「手放す」: 本体だけでなく子孫サブタスク(完了済み含む)もカスケードでdeleted化される");
  check("次のカードはカスケード削除対象Wish", (await cardTitle()) === "カスケード削除対象Wish", await cardTitle());
  await clickChoice("drop");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const cascadeParent = snap.tasks.find((t) => t.id === "wish-v152-cascade");
  const cascadeSubA = snap.tasks.find((t) => t.id === "wish-v152-cascade-sub-a");
  const cascadeSubB = snap.tasks.find((t) => t.id === "wish-v152-cascade-sub-b");
  check("本体がdeleted化される", cascadeParent.deleted === true);
  check("完了済みサブタスクもdeleted化される(カスケード)", cascadeSubA.deleted === true, JSON.stringify(cascadeSubA));
  check("未完了サブタスクもdeleted化される(カスケード)", cascadeSubB.deleted === true, JSON.stringify(cascadeSubB));
  check("残枚数が4枚に減る", await remainCount() === 4, String(await remainCount()));

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [7] Wish「今日やる」(サブタスクあり): 先頭サブタスクがBlock化(todayISO基準)。
  //     本体は削除されずキューに残るが、同セッション中は即再出現しない
  // ============================================================
  console.log("[7] サブタスク持ちWishの「今日やる」: 先頭サブタスクがtodayISO基準でBlock化され、本体は同セッション中は再浮上しない");
  check("次のカードはサブタスク持ちWish", (await cardTitle()) === "サブタスク持ちWish", await cardTitle());
  await clickChoice("today");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const subBlock = snap.blocks.find((b) => b.title === "先頭サブタスク");
  const sub = snap.tasks.find((t) => t.id === "wish-v152-sub");
  const parentWish = snap.tasks.find((t) => t.id === "wish-v152-withsub");
  check("サブタスクのタイトルでBlockが作られる(本体ではなくサブタスクをBlock化)", !!subBlock, JSON.stringify(snap.blocks.map((b) => b.title)));
  check("複製Blockの日付は実時計の今日(TODAY)", !!subBlock && subBlock.date === TODAY, JSON.stringify(subBlock));
  check("サブタスクのstatusがdoingになる", sub.status === "doing", JSON.stringify(sub));
  check("Wish本体は削除されずに残る", parentWish.deleted === false);
  check("残枚数が3枚のまま(削除ではないが即再出現しない=終端性)", await remainCount() === 3, String(await remainCount()));
  check("次のカードは「サブタスク持ちWish」ではない(即再出現しない)", (await cardTitle()) !== "サブタスク持ちWish", await cardTitle());
  check("次のカードは延期(年あり)対象Wish", (await cardTitle()) === "延期(年あり)対象Wish", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [8] Wish「延期」: targetYearありは+1(12月→翌年1月)
  // ============================================================
  console.log("[8] targetYearありのWishを延期: targetMonth=1・targetYearは2026→2027");
  await clickChoice("defer");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const deferYear = snap.tasks.find((t) => t.id === "wish-v152-defer-year");
  check("targetMonthが12→1になる", deferYear.targetMonth === 1, String(deferYear.targetMonth));
  check("targetYearが2026→2027になる(既存値+1)", deferYear.targetYear === 2027, String(deferYear.targetYear));
  check("残枚数が2枚に減る", await remainCount() === 2, String(await remainCount()));
  check("次のカードは延期(年なし)対象Wish", (await cardTitle()) === "延期(年なし)対象Wish", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [9] Wish「延期」: targetYearがnullのときは todayISO()年+1 を設定(月間ボードの逆行防止)
  // ============================================================
  console.log("[9] targetYearがnullのWishを延期: targetMonth=1・targetYearは(実行年+1)が新規設定される");
  await clickChoice("defer");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const deferNoYear = snap.tasks.find((t) => t.id === "wish-v152-defer-noyear");
  check("targetMonthが12→1になる", deferNoYear.targetMonth === 1, String(deferNoYear.targetMonth));
  check(`targetYearがnullから${REAL_YEAR + 1}に設定される`, deferNoYear.targetYear === REAL_YEAR + 1, String(deferNoYear.targetYear));
  check("残枚数が1枚に減る", await remainCount() === 1, String(await remainCount()));
  check("次のカードは延期(未定)対象Wish", (await cardTitle()) === "延期(未定)対象Wish", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [10] Wish「延期」: targetMonth未設定は据え置き(updatedAtのみbump) → 全件処理完了
  // ============================================================
  console.log("[10] targetMonth未設定のWishを延期: targetMonthは変わらずupdatedAtだけ進み、最後の1枚が処理されて仕分け完了になる");
  await clickChoice("defer");
  await pageA.waitForTimeout(150);
  snap = await stateNow();
  const deferNone = snap.tasks.find((t) => t.id === "wish-v152-defer-none");
  check("targetMonthはnullのまま", deferNone.targetMonth === null, String(deferNone.targetMonth));
  check("updatedAtは進む(2026-01-05から更新される)", deferNone.updatedAt !== "2026-01-05T09:00:00", deferNone.updatedAt);
  check("残枚数が0枚になる(全8件処理完了=キューが終端する)", await pageA.locator(".triage-actions").count() === 0);
  check("「仕分け完了 🎉」が表示される", (await pageA.locator(".triage-panel").textContent() || "").includes("仕分け完了"));

  await ctxA.close();

  // ============================================================
  // Part B: 過去日を閲覧中でも「今日やる」は実時計の今日基準でBlockを作る(必須2)。
  //         かつ「status=doingかつ当日Block済み」のWishは新規ページでも最初から対象外(必須1後段)
  // ============================================================
  console.log("[Part B] 過去日閲覧中の「今日やる」は実時計の今日基準/ status=doing+当日Block済みWishは最初から対象外");
  // v152レビュー対応注記: サイドバーnav(data-action="nav")はモバイル幅では非表示になり
  // ボトムナビ側の限定メニューに切り替わるため、ここではデスクトップ幅を使いサイドバーの
  // data-action="nav"ボタンをそのままクリックできるようにする(モバイル幅の検証はPart Aで実施済み)。
  const ctxB = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1000 } });
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log("  ❌ [B] pageerror:", e.message); });
  pageB.on("dialog", async (d) => { failures++; console.log("  ❌ [B] 予期しないネイティブダイアログ:", d.message()); await d.dismiss(); });
  await blockGithubApiByDefault(pageB);
  await pageB.goto(`http://localhost:${PORT}/`);
  await pageB.waitForTimeout(600);
  await passGithubGate(pageB);

  const wishProjectIdB = await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);

  await pageB.evaluate(({ KEY, wishProjectId, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = s.tasks.filter((t) => t.projectId !== wishProjectId);
    const wish = (id, title, extra) => ({
      id, projectId: wishProjectId, parentTaskId: "", title, category: "", status: "todo",
      dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: null, realized: false, realizedDate: "",
      createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false, ...extra
    });
    // 対象1: 過去日基準テスト用(サブタスク無し=本体そのものがBlock化対象)
    s.tasks.push(wish("wish-v152-pastdate", "過去日確認用Wish"));
    // 対象2: 「既に当日Block済み」を模したWish(status:doing+当日日付のBlockが既存)。
    //         セッション内除外(_triageSessionDone)はページリロードで空になるため、これが
    //         無いと新規ページ・新規セッションでも毎回再出現してしまう(必須1の後段要件)。
    s.tasks.push(wish("wish-v152-already-done", "既に当日Block済みのWish", { status: "doing" }));
    s.blocks.push({
      id: "block-v152-already-done", taskId: "wish-v152-already-done", date: TODAY,
      title: "既に当日Block済みのWish", category: "回復", estimateMin: 20, carryCount: 0,
      migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false,
      createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`
    });
    s.currentView = "home";
    s.wishViewMode = "triage";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId: wishProjectIdB, TODAY });
  await pageB.reload();
  await pageB.waitForTimeout(500);

  console.log("[B1] 「既に当日Block済み」のWishは新規セッションでも最初からキューに出ない");
  await pageB.click('[data-action="nav"][data-view="wish"]');
  await pageB.waitForTimeout(300);
  await pageB.click('[data-action="wish-view-mode"][data-mode="triage"]');
  await pageB.waitForTimeout(300);
  const remainCountB = async () => {
    const txt = await pageB.locator(".triage-panel > .muted").first().textContent();
    return Number((txt || "").match(/\d+/)?.[0]);
  };
  check("残枚数は1枚のみ(既に当日Block済みのWishは除外される)", await remainCountB() === 1, String(await remainCountB()));
  check("表示される唯一のカードは過去日確認用Wish", (await pageB.locator(".triage-card-title").textContent()) === "過去日確認用Wish");

  console.log("[B2] 過去日(3日前)を閲覧した直後でも、「今日やる」で作られるBlockは実時計の今日日付になる");
  await pageB.click('[data-action="nav"][data-view="home"]');
  await pageB.waitForTimeout(300);
  await pageB.click('[data-action="date-prev"]');
  await pageB.click('[data-action="date-prev"]');
  await pageB.click('[data-action="date-prev"]');
  await pageB.waitForTimeout(200);
  const selectedDateAfterNav = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).selectedDate, KEY);
  check("selectedDateが実時計の今日より過去になっている(前提確認)", selectedDateAfterNav < TODAY, selectedDateAfterNav);

  await pageB.click('[data-action="nav"][data-view="wish"]');
  await pageB.waitForTimeout(300);
  check("過去日閲覧中でもtriage-panelが表示される(selectedDateに関わらずWishタブは独立)", await pageB.locator(".triage-panel").count() === 1);
  await pageB.locator('.triage-actions [data-choice="today"]').click();
  await pageB.waitForTimeout(300);
  const snapB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const pastDateBlock = snapB.blocks.find((b) => b.title === "過去日確認用Wish");
  check("過去日を閲覧中でも作られたBlockの日付は実時計の今日(TODAY)になる(選択中の過去日ではない)",
    !!pastDateBlock && pastDateBlock.date === TODAY, JSON.stringify(pastDateBlock));
  check("selectedDate(過去日)はそのまま残っている(この修正がナビゲーション自体を変えていない確認)",
    snapB.selectedDate === selectedDateAfterNav, snapB.selectedDate);

  await ctxB.close();

  console.log(failures === 0 ? "\n✅ v152 ALL PASS" : `\n❌ v152: ${failures} 件失敗`);
  await browser.close();
  server.close();
  process.exit(failures === 0 ? 0 : 1);
})();
