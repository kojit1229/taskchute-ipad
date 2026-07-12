// v80 検証: 月間プランニングボードのレイアウト改善(CHANGES_v80.md参照)。
// K報告「月カードが小さくて、入れるとやりたいことが見切れてしまう」への対応。
// v79の固定グリッド(auto-fill minmax(150px,1fr))を、1〜12月を縦一列に並べる
// リスト型に変更した。本スイートはiPhone想定の狭幅ビューポート(390px)で、
//   (1) タイトルが省略記号(1行ellipsis)ではなく2行clampで全文を保持していること
//   (2) 空の月はヘッダのみ(is-empty)に縮小され、カード一覧DOM自体が無いこと
//   (3) 月割当(タップ代替=カード上の月選択)がレイアウト変更後も回帰なく機能すること
//   (4) 現在月ジャンプ(ボタン+表示切替時の自動スクロール)がscrollIntoViewを呼ぶこと
// を検証する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4217;
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const LONG_TITLE = "家族みんなで屋久島に行って縄文杉を見て、帰りに温泉宿でゆっくり過ごす";

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  // 主端末=iPhone縦持ち想定(幅約390px)。旧グリッドが2列に潰れて見切れていた条件を再現する。
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
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
  check("Wish Project が既定で存在する", !!wishProjectId);

  // ---- セットアップ: 長いタイトルのWishを6月に、7月は0件のまま、他に未定プールへ1件 ----
  await page.evaluate(({ KEY, wishProjectId, LONG_TITLE }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks.push({
      id: "wish-v80-long", projectId: wishProjectId, parentTaskId: "", title: LONG_TITLE,
      category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: 6, realized: false, realizedDate: "",
      createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false
    });
    s.tasks.push({
      id: "wish-v80-pool", projectId: wishProjectId, parentTaskId: "", title: "未定プールのWish",
      category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
      targetYear: null, targetMonth: null, realized: false, realizedDate: "",
      createdAt: "2026-01-01T09:00:00", updatedAt: "2026-01-01T09:00:00", deleted: false
    });
    s.currentView = "wish";
    s.wishViewMode = "list";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId, LONG_TITLE });
  await page.reload();
  await page.waitForTimeout(500);

  // ---- [1] 表示切替の瞬間に現在月へ自動スクロールが呼ばれる(scrollIntoViewをスパイして検証) ----
  console.log("[1] ボード表示に切り替えた瞬間、現在月の行へ自動スクロールする(scrollIntoViewのspy検証)");
  await page.evaluate(() => {
    window.__scrollCalls = [];
    const proto = Element.prototype;
    const orig = proto.scrollIntoView;
    proto.scrollIntoView = function (...args) {
      window.__scrollCalls.push({ monthRow: this.dataset ? this.dataset.monthRow : null, args });
      return orig.apply(this, args);
    };
  });
  await page.click('[data-action="wish-view-mode"][data-mode="board"]');
  await page.waitForTimeout(400);
  const boardVisible = await page.locator(".wish-board").count();
  check("ボード表示に切り替わる(.wish-boardが描画される)", boardVisible === 1);

  const currentMonth = new Date().getMonth() + 1;
  const scrollCallsAfterSwitch = await page.evaluate(() => window.__scrollCalls || []);
  check(
    "表示切替時に現在月の行(data-month-row)へscrollIntoViewが呼ばれる",
    scrollCallsAfterSwitch.some((c) => Number(c.monthRow) === currentMonth),
    JSON.stringify(scrollCallsAfterSwitch)
  );

  // ---- [2] 「今月へ」ジャンプボタンが存在し、クリックでも同じ行へscrollIntoViewが呼ばれる ----
  console.log("[2] 「今月へ」ジャンプボタン: クリックで現在月の行へscrollIntoViewが呼ばれる");
  const jumpBtn = page.locator('[data-action="wish-board-jump-current"]');
  check("「今月へ」ジャンプボタンが描画されている", await jumpBtn.count() === 1);
  await page.evaluate(() => { window.__scrollCalls = []; });
  await jumpBtn.click();
  await page.waitForTimeout(200);
  const scrollCallsAfterJump = await page.evaluate(() => window.__scrollCalls || []);
  check(
    "ジャンプボタンのクリックで現在月の行へscrollIntoViewが呼ばれる",
    scrollCallsAfterJump.some((c) => Number(c.monthRow) === currentMonth),
    JSON.stringify(scrollCallsAfterJump)
  );

  // ---- [3] 空の月(7月)はヘッダのみ(is-empty)、カード一覧DOM自体が存在しない ----
  console.log("[3] 空の月はヘッダのみに縮小され、.wish-board-month-bodyがDOMに存在しない");
  const julyRow = page.locator('.wish-board-month-row[data-month-row="7"]');
  check("7月の行が存在する", await julyRow.count() === 1);
  check("7月の行にis-emptyクラスが付いている(0件のため)", await julyRow.evaluate((el) => el.classList.contains("is-empty")));
  check("7月の行の中に.wish-board-month-bodyが存在しない(ヘッダのみ)", await julyRow.locator(".wish-board-month-body").count() === 0);

  // ---- [4] 6月(1件割当済み)はis-emptyが外れ、.wish-board-month-bodyが出現する ----
  console.log("[4] Wishが割り当てられた月はis-emptyが外れ、.wish-board-month-bodyが出現する");
  const juneRow = page.locator('.wish-board-month-row[data-month-row="6"]');
  check("6月の行にis-emptyクラスが付いていない(1件割当済みのため)", !(await juneRow.evaluate((el) => el.classList.contains("is-empty"))));
  check("6月の行の中に.wish-board-month-bodyが存在する", await juneRow.locator(".wish-board-month-body").count() === 1);

  // ---- [5] タイトルの見切れ対策: 単一行ellipsisではなく2行line-clampで、全文がDOM上に残る ----
  console.log("[5] 長いタイトルのカード: 単一行ellipsisではなく2行line-clampで描画され、全文がDOM textContentとして保持される");
  const longCard = juneRow.locator('.wish-board-card[data-wish-drag-id="wish-v80-long"]');
  check("6月枠に対象カードが存在する", await longCard.count() === 1);
  const titleEl = longCard.locator(".wish-board-card-title");
  const titleText = await titleEl.textContent();
  check("カードのタイトルは省略されずDOM上に全文が保持されている", titleText === LONG_TITLE, titleText);
  const titleStyle = await titleEl.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { lineClamp: cs.webkitLineClamp, whiteSpace: cs.whiteSpace, overflow: cs.overflow };
  });
  check("タイトルのCSSが2行line-clampになっている(単一行ellipsisに戻っていない)", titleStyle.lineClamp === "2", JSON.stringify(titleStyle));
  check("タイトルのCSSがnowrap(単一行固定)ではない(折り返しを許可している)", titleStyle.whiteSpace !== "nowrap", JSON.stringify(titleStyle));

  // ---- [6] 月割当の回帰: タップ代替(カード上の月選択)で未定プール→9月へ移動できる ----
  console.log("[6] 月割当の回帰確認: 未定プールのカードをタップ代替(月選択)で9月へ移動できる");
  const poolCard = page.locator('.month-zone[data-month=""] .wish-board-card[data-wish-drag-id="wish-v80-pool"]');
  check("移動前は未定プールにカードがある", await poolCard.count() === 1);
  await poolCard.locator("select.wish-board-card-month").selectOption("9");
  await page.waitForTimeout(300);

  const afterAssign = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.tasks.find((t) => t.id === "wish-v80-pool").targetMonth;
  }, KEY);
  check("state.targetMonth=9が保存される", afterAssign === 9, String(afterAssign));

  const septRow = page.locator('.wish-board-month-row[data-month-row="9"]');
  check("9月の行にカードが移動している(reload無しの即時反映)", await septRow.locator('.wish-board-card[data-wish-drag-id="wish-v80-pool"]').count() === 1);
  check("未定プールからは消えている", await page.locator('.month-zone[data-month=""] .wish-board-card[data-wish-drag-id="wish-v80-pool"]').count() === 0);
  check("9月の行のis-emptyは外れている", !(await septRow.evaluate((el) => el.classList.contains("is-empty"))));

  console.log(failures === 0 ? "\n✅ v80 ALL PASS" : `\n❌ v80: ${failures} 件失敗`);
  await browser.close();
  server.close();
  process.exit(failures === 0 ? 0 : 1);
})();
