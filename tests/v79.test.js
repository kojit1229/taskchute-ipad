// v79 検証: Wishの実行性を上げる2機能 + Kフォローアップの小追加(CHANGES_v79.md参照)。
//   (1) Wishカード上のワンタップ実行チェック(realized トグル。既存 realizeWish/unrealizeWish を再利用)
//   (2) 月間プランニングボード(未定プール + 1〜12月枠。targetMonth新設。タップ代替=カード上の月選択)
//   (3) Wish編集(詳細展開)への期限(dueDate)入力欄追加(表示側は作らない。保存のみ検証)
//
// D&Dの実機タッチ操作(Pointer Events)はPlaywrightでの再現コストが高いため、本スイートは
// 指示どおり「タップ代替経路(カード上の<select>で月を選ぶ)」でtargetMonthが保存されることを
// 検証する。ドラッグ実装自体は目視確認(../taskchute-notes/handoff.mdに記載)に委ねる。
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  await passGithubGate(page);

  const wishProjectId = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);
  check("Wish Project が既定で存在する(normalizeState)", !!wishProjectId);

  // ---- [1] normalizeState 後方互換: targetMonth が無い旧データを補完する ----
  console.log("[1] normalizeState後方互換: targetMonthフィールドが無い旧Wishタスクにnullを補完する");
  await page.evaluate(({ KEY, wishProjectId }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = s.tasks || [];
    // v79以前の形状を模した「targetMonthキー自体が無い」旧データ
    s.tasks.push({
      id: "wish-legacy-no-month", projectId: wishProjectId, parentTaskId: "", title: "旧データWish(月フィールド無し)",
      category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, realized: false, realizedDate: "", createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false
    });
    // 既存値がある場合は上書きしない(既存値優先)ことも合わせて確認する対照データ
    s.tasks.push({
      id: "wish-legacy-has-month", projectId: wishProjectId, parentTaskId: "", title: "旧データWish(月5で設定済み)",
      category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: 5, realized: false, realizedDate: "", createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false
    });
    s.currentView = "wish";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId });
  await page.reload();
  await page.waitForTimeout(500);
  // normalizeState() はロード時にメモリ上で計算されるだけで、ここで明示的に保存操作を1つ
  // 挟まないと localStorage には反映されない(persistLocalNoSchedule は state 全体を書き出すため、
  // UI操作を1つ経由するだけで正規化結果ごと永続化される)。ボード表示切替がちょうどそれに該当する。
  await page.click('[data-action="wish-view-mode"][data-mode="board"]');
  await page.waitForTimeout(300);

  const normalized = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const noMonth = s.tasks.find((t) => t.id === "wish-legacy-no-month");
    const hasMonth = s.tasks.find((t) => t.id === "wish-legacy-has-month");
    return { noMonthField: noMonth ? noMonth.targetMonth : "MISSING_TASK", hasMonthField: hasMonth ? hasMonth.targetMonth : "MISSING_TASK" };
  }, KEY);
  check("targetMonthキーが無かった旧Wishはnullで補完される", normalized.noMonthField === null, JSON.stringify(normalized));
  check("既にtargetMonth=5だった旧Wishは上書きされず5のまま(既存値優先)", normalized.hasMonthField === 5, JSON.stringify(normalized));

  // ---- [2] カード上ワンタップ実行チェック(realized トグル) ----
  console.log("[2] Wishカード上のチェックボックスでrealizedがトグルされる(既存realizeWish/unrealizeWishを再利用)");
  await page.evaluate(({ KEY, wishProjectId }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks.push({
      id: "wish-checkme", projectId: wishProjectId, parentTaskId: "", title: "チェック対象Wish",
      category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: null, realized: false, realizedDate: "", createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false
    });
    s.currentView = "wish";
    s.wishViewMode = "list";  // 直前のテストでボード表示に切り替えた分をリセット
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId });
  await page.reload();
  await page.waitForTimeout(500);

  const card = page.locator(".wish-card", { hasText: "チェック対象Wish" }).first();
  const checkbox = card.locator('input.wish-check[data-id="wish-checkme"]');
  check("チェックボックスは初期状態で未チェック(realized=false)", !(await checkbox.isChecked()));

  // レビュー指摘(nit): confirmをキャンセルした場合、ネイティブcheckboxはクリック時点で
  // 見た目上先にチェック済みになるため、render()し忘れるとstateはfalseのままなのに
  // 見た目だけONに残ってしまう。キャンセル後にDOMがstateへ戻ることを検証する。
  page.once("dialog", (dialog) => dialog.dismiss());  // confirmをキャンセル
  await checkbox.click();
  await page.waitForTimeout(300);
  const afterCancel = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.tasks.find((x) => x.id === "wish-checkme").realized;
  }, KEY);
  check("confirmをキャンセルするとrealizedはfalseのまま(state)", afterCancel === false, String(afterCancel));
  check("confirmをキャンセルするとチェックボックスの見た目も未チェックに戻る(render()漏れの回帰ガード)",
    !(await checkbox.isChecked()));

  page.once("dialog", (dialog) => dialog.accept());  // realizeWishのwindow.confirm(既存挙動)
  await checkbox.click();
  await page.waitForTimeout(300);
  const afterRealize = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const t = s.tasks.find((x) => x.id === "wish-checkme");
    return { realized: t.realized, status: t.status, realizedDate: t.realizedDate };
  }, KEY);
  check("チェックでrealized=trueになる(既存realizeWishの挙動)", afterRealize.realized === true, JSON.stringify(afterRealize));
  check("既存挙動どおりstatusもcompletedになる", afterRealize.status === "completed", JSON.stringify(afterRealize));

  // 実現済みになったカードは既定フィルタ(showRealized=false)で一覧から消える(既存挙動)。
  // 外すには先に「実現済みも表示」をONにしてカードを再度出す必要がある。
  await page.click('[data-action="wish-toggle-realized"]');
  await page.waitForTimeout(200);
  // 再チェック(外す)。unrealizeWishはconfirm無し。
  const checkboxAfter = page.locator('input.wish-check[data-id="wish-checkme"]');
  await checkboxAfter.click();
  await page.waitForTimeout(300);
  const afterUnrealize = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const t = s.tasks.find((x) => x.id === "wish-checkme");
    return { realized: t.realized, status: t.status };
  }, KEY);
  check("再タップでrealized=falseに戻る(既存unrealizeWishの挙動)", afterUnrealize.realized === false, JSON.stringify(afterUnrealize));

  // ---- [3] 月間プランニングボード: タップ代替(カード上の月選択)でtargetMonthが保存される ----
  console.log("[3] 月間プランニングボード: カード上の月選択(タップ代替)でtargetMonthが保存される");
  await page.evaluate(({ KEY, wishProjectId }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks.push({
      id: "wish-board-target", projectId: wishProjectId, parentTaskId: "", title: "ボード割当対象Wish",
      category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: null, realized: false, realizedDate: "", createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false
    });
    s.currentView = "wish";
    s.wishViewMode = "list";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId });
  await page.reload();
  await page.waitForTimeout(500);

  await page.click('[data-action="wish-view-mode"][data-mode="board"]');
  await page.waitForTimeout(300);
  const boardVisible = await page.locator(".wish-board").count();
  check("ボード表示に切り替わる(.wish-boardが描画される)", boardVisible === 1);

  const boardCard = page.locator('.wish-board-card[data-wish-drag-id="wish-board-target"]').first();
  check("割当前はカードが「未定」プール(data-month=\"\")の中にある", await page.locator('.month-zone[data-month=""] .wish-board-card[data-wish-drag-id="wish-board-target"]').count() === 1);

  await boardCard.locator("select.wish-board-card-month").selectOption("8");
  await page.waitForTimeout(300);
  const afterMonthAssign = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.tasks.find((t) => t.id === "wish-board-target").targetMonth;
  }, KEY);
  check("カード上の月選択で targetMonth=8 が保存される", afterMonthAssign === 8, String(afterMonthAssign));

  // ---- [4] ボード表示の月別振り分け(select変更→即座に月枠へ移動。reloadを挟まない) ----
  // レビュー指摘(should-fix): wish-set-month後にrender()していなかったため、データは保存
  // されてもカードが視覚的には「未定」プールに残ったままだった。reloadで作り直した画面ではなく
  // 直前のselectOption直後のDOMをそのまま検証することで、この回帰を検知できるようにする。
  console.log("[4] ボード表示: select変更直後(reload無し)にtargetMonth=8のWishが8月枠へ移動する");
  const inAugust = await page.locator('.month-zone[data-month="8"] .wish-board-card[data-wish-drag-id="wish-board-target"]').count();
  const stillInPool = await page.locator('.month-zone[data-month=""] .wish-board-card[data-wish-drag-id="wish-board-target"]').count();
  const inOtherMonth = await page.locator('.month-zone[data-month="3"] .wish-board-card[data-wish-drag-id="wish-board-target"]').count();
  check("8月の月枠に表示される", inAugust === 1, String(inAugust));
  check("未定プールにはもう表示されない", stillInPool === 0, String(stillInPool));
  check("関係ない月(3月)には表示されない", inOtherMonth === 0, String(inOtherMonth));

  // ---- [5] 既存Wish編集モーダル(詳細展開)の回帰 + 新規dueDate入力欄 ----
  console.log("[5] Wish詳細展開(編集パネル)の既存フィールド回帰 + 新規dueDate保存(Kフォローアップ)");
  await page.click('[data-action="wish-view-mode"][data-mode="list"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="open-wish"][data-id="wish-board-target"]');
  await page.waitForTimeout(300);

  // 既存: 年セレクト
  await page.selectOption('select[data-action="wish-set-year"][data-id="wish-board-target"]', "2027");
  await page.waitForTimeout(200);
  // 既存: モチベーション欄
  const motivationBox = page.locator('textarea[data-action="wish-set-motivation"][data-id="wish-board-target"]');
  await motivationBox.fill("回帰確認用のモチベーション文");
  await page.waitForTimeout(200);
  // 新規: 期限(dueDate)
  const dueDateInput = page.locator('input[data-action="wish-set-duedate"][data-id="wish-board-target"]');
  await dueDateInput.fill("2026-12-24");
  await dueDateInput.dispatchEvent("change");
  await page.waitForTimeout(300);

  const afterEdit = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const t = s.tasks.find((x) => x.id === "wish-board-target");
    return { targetYear: t.targetYear, motivation: t.motivation, dueDate: t.dueDate };
  }, KEY);
  check("既存の年(targetYear)編集は引き続き保存される(回帰なし)", afterEdit.targetYear === 2027, JSON.stringify(afterEdit));
  check("既存のモチベーション編集は引き続き保存される(回帰なし)", afterEdit.motivation === "回帰確認用のモチベーション文", JSON.stringify(afterEdit));
  check("新規: 期限(dueDate)入力が保存される", afterEdit.dueDate === "2026-12-24", JSON.stringify(afterEdit));

  // ---- [6] 新規Wish作成時、dueDateが「今日」で汚染されない(makeTask既定の是正) ----
  console.log("[6] 新規Wish作成: dueDateが自動で今日の日付にならない(期限は任意のまま)");
  await page.fill("#wishTitle", "新規Wishの期限確認");
  await page.click('[data-action="add-wish"]');
  await page.waitForTimeout(300);
  const newWishDueDate = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const t = s.tasks.find((x) => x.title === "新規Wishの期限確認");
    return t ? t.dueDate : "MISSING";
  }, KEY);
  check("新規WishのdueDateは空のまま(makeTask既定の『今日』を引き継がない)", newWishDueDate === "", JSON.stringify(newWishDueDate));

  // ---- [6b] 同様に、Wishサブタスク作成(addWishSubtask)も dueDate が空のまま ----
  console.log("[6b] Wishサブタスク作成: dueDateが自動で今日の日付にならない(同じ経路の別バグを追加修正)");
  const newWishId = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.tasks.find((x) => x.title === "新規Wishの期限確認").id;
  }, KEY);
  // addWish() は追加直後に state.wishOpenId を新規Wishへ合わせて自動で開くため、
  // ここで open-wish を再クリックすると閉じてしまう(トグル)。既に開いている前提でよい。
  page.once("dialog", (dialog) => dialog.accept("最初の一歩"));  // addWishSubtaskのwindow.prompt
  await page.click(`[data-action="add-wish-subtask"][data-id="${newWishId}"]`);
  await page.waitForTimeout(300);
  const subDueDate = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const t = s.tasks.find((x) => x.title === "最初の一歩");
    return t ? t.dueDate : "MISSING";
  }, KEY);
  check("Wishサブタスクの期限(dueDate)も空のまま(addWishSubtaskの同種バグを追加修正)", subDueDate === "", JSON.stringify(subDueDate));

  await browser.close();
  server.close();

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
