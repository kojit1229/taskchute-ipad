// v149 検証: UI改善計画Phase4a(基盤・K指定2026-07-27)。CHANGES_v149.md参照。
//
// (1) ホームは「今日」/「ホーム」の2タブに分割され、起動時・リロード直後の既定タブは「今日」
// (2) タブ切替で表示カードが入れ替わる(今日タブのカードがホームタブでは消え、逆も同様)
// (3) 信条(creed)/寿命(lifespan)はホームタブを開くたび既定open(K指定「折りたたまない」)。
//     セッション限定オーバーライド方式(_homeReflectFoldOverride、localStorageへは非永続)
// (4) 日付ナビ(前日/日付ピッカー/翌日)はホームビュー中に1回だけ存在する(ヘッダー統合、独立行の重複なし)
// (5) 375px幅で横スクロールが発生せず、ヘッダーの▶Now・日付ナビ・タブバーが重ならない。
//     ヘッダー〜「いま、これ」までの縦幅を実測する(2系統レビュー対応、v148の224pxより縮む・200px以下)
// (6) タブ選択は非永続(state外)。リロードすると常に「今日」に戻る
// (7) ホームタブに「80歳ビジョン」導線カードがあり、タップでビジョンボード(80歳ページ)へ遷移する
// (8) ホームタブ滞在中は電池残量低下でも毎分の全再描画(renderDeferringForFocus)が起きない
// (9) ホームタブ滞在中に別ビューへ行き来して戻ると、.home-heroが無いため.home-tabbarへ
//     フォールバックスクロールする(取り残されない)
// (10) 宣言入力→直接タブをタップ(1回のクリック)でタブが切り替わる(全再描画をやめた効果)
// (11) 「宣言未入力」警告(今日タブ)にホームタブへのワンタップ導線がある
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const FOLD_KEY = "taskchute-journal-home-fold-v1";

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
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 30, isMIT = false, completed = false }) {
    return {
      id, taskId: "", date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }

  async function seed({ blocks = [], view = "home", dailyDeclarations = {}, battery = null } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, dailyDeclarations, battery }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.dailyDeclarations = dailyDeclarations;
      if (battery) s.settings.battery = battery;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, dailyDeclarations, battery });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function mainHTML() {
    return page.evaluate(() => document.querySelector("#main")?.innerHTML || "");
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function foldMap() {
    return page.evaluate((FOLD_KEY) => JSON.parse(localStorage.getItem(FOLD_KEY) || "{}"), FOLD_KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    const seedBlocks = [
      planBlock({ id: "v149-mit", title: "v149主役確認Block", startMin: 8 * 60, isMIT: true }),
      planBlock({ id: "v149-tc", title: "v149タスクシュート確認Block", startMin: 9 * 60 })
    ];

    // ============================================================
    // (1) 既定タブは「今日」
    // ============================================================
    console.log("[1] 起動時・リロード直後の既定タブは「今日」");
    await seed({ blocks: seedBlocks, view: "home" });
    check("タブバーが表示される(今日/ホーム)",
      (await page.locator(".home-tabbar button").allTextContents()).join(",") === "今日,ホーム");
    check("「今日」タブがactive", await page.locator('.home-tabbar [data-action="home-tab"][data-tab="today"]').evaluate((el) => el.classList.contains("active")));
    check("「ホーム」タブはactiveでない", !(await page.locator('.home-tabbar [data-action="home-tab"][data-tab="home"]').evaluate((el) => el.classList.contains("active"))));
    check("今日タブの内容(いま、これ)が最初から見える", (await page.locator("main").textContent()).includes("いま、これ"));

    // ============================================================
    // (2) タブ切替で表示カードが入れ替わる
    // ============================================================
    console.log("[2] 「ホーム」タブに切替: 今日タブのカードが消え、ホームタブのカードが現れる");
    check("今日タブでは三つの信条が見えない(切替前)", await page.locator('details.home-creed').count() === 0);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    check("切替後は「ホーム」タブがactive", await page.locator('.home-tabbar [data-action="home-tab"][data-tab="home"]').evaluate((el) => el.classList.contains("active")));
    check("ホームタブでは三つの信条が見える", await page.locator('details.home-creed').count() === 1);
    check("ホームタブでは寿命カウントダウンが見える", await page.locator('details.home-lifespan').count() === 1);
    check("ホームタブでは「AIから」が見える", await page.locator('details[data-fold-id="ai-hub"]').count() === 1);
    check("ホームタブでは「長い弧をたしかめる」が見える", await page.locator('details[data-fold-id="zone3"]').count() === 1);
    check("ホームタブでは「いま、これ」が消える(今日タブのカード)", await page.locator("#home-mit-anchor").count() === 0);
    check("ホームタブでは今日のタスクシュート(homezone-1)が消える", await page.locator("#homezone-1").count() === 0);
    check("ホームタブでは12週サイクル(homezone-3)が消える", await page.locator("#homezone-3").count() === 0);

    console.log("[2b] 「今日」タブに戻す: ホームタブのカードが消え、今日タブのカードが戻る");
    await page.click('[data-action="home-tab"][data-tab="today"]');
    await page.waitForTimeout(200);
    check("「今日」タブがactiveに戻る", await page.locator('.home-tabbar [data-action="home-tab"][data-tab="today"]').evaluate((el) => el.classList.contains("active")));
    check("今日タブに戻ると三つの信条が消える", await page.locator('details.home-creed').count() === 0);
    check("今日タブに戻ると「いま、これ」が見える", await page.locator("#home-mit-anchor").count() === 1);
    check("今日タブに戻ると今日の主役MITの内容が保たれている(再描画で消えていない)",
      (await page.locator("#home-mit-anchor").textContent()).includes("v149主役確認Block"));
    // v149テスト注記: seedBlocksはtaskIdを持たない単発Blockのため、homeTaskchute()(Project紐づき
    // 限定)の一覧には載らない(homeTaskchute自体の絞り込み仕様であり本テストの対象外)。
    // ここではタブ切替でカード自体(#homezone-1)が再び存在することだけを確認する。
    check("今日タブに戻ると今日のタスクシュート(homezone-1)が見える", await page.locator("#homezone-1").count() === 1);
    check("今日タブに戻ると12週サイクル(homezone-3)が見える(常時表示・非foldable)",
      (await page.locator("#homezone-3").textContent()).includes("12週サイクル")
      && await page.locator("#homezone-3 details[data-fold-id]").count() === 0);

    // ============================================================
    // (3) 信条・寿命はホームタブで既定open + セッション限定オーバーライド(必須6)
    // ============================================================
    console.log("[3] 信条・寿命はホームタブを開くたび既定open(折りたたまない指定)。折りたたみ機構自体は残る");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    check("信条(creed)はホームタブで既定open", await page.locator('details.home-creed').evaluate((el) => el.open) === true);
    check("寿命(lifespan)はホームタブで既定open", await page.locator('details.home-lifespan').evaluate((el) => el.open) === true);
    check("AIから(ai-hub)は既定closedのまま(信条/寿命だけの変更)", await page.locator('details[data-fold-id="ai-hub"]').evaluate((el) => el.open) === false);
    // 折りたたみ機構自体は維持されている(その場で閉じられる)ことも確認する
    await page.click('details.home-creed summary');
    await page.waitForTimeout(150);
    check("summaryクリックでcreedを閉じられる(強制展開ではなく既定値の変更)",
      await page.locator('details.home-creed').evaluate((el) => el.open) === false);

    console.log("[3b] 信条を閉じた状態は、タブを行き来しても同じセッション中は維持される(localStorageには保存されない)");
    await page.click('[data-action="home-tab"][data-tab="today"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    check("タブを往復してもcreedは閉じたまま(セッション内オーバーライド)",
      await page.locator('details.home-creed').evaluate((el) => el.open) === false);
    const fmAfterClose = await foldMap();
    check("localStorage(HOME_FOLD_KEY)にはcreedの記録が残らない(非永続)",
      !("creed" in fmAfterClose), JSON.stringify(fmAfterClose));

    console.log("[3c] reloadすると信条は既定open(=セッション)へ戻る(K指定「タブを開くたび既定で展開」)");
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    check("reload後は信条(creed)が既定openへ戻る", await page.locator('details.home-creed').evaluate((el) => el.open) === true);
    await page.click('[data-action="home-tab"][data-tab="today"]');
    await page.waitForTimeout(150);

    // ============================================================
    // (4) 日付ナビはヘッダーに1回だけ
    // ============================================================
    console.log("[4] 日付ナビ(前日/日付ピッカー/翌日)がホームビュー中に1回だけ存在する");
    check("前日ボタンは1個だけ", await page.locator('[data-action="date-prev"]').count() === 1);
    check("日付ピッカーは1個だけ", await page.locator('[data-date-picker]').count() === 1);
    check("翌日ボタンは1個だけ", await page.locator('[data-action="date-next"]').count() === 1);
    check("日付ナビは.view-header内(ヘッダー統合済み)にある", await page.locator('.view-header [data-date-picker]').count() === 1);
    check(".datebar自体もページ中に1つだけ(独立行の重複が無い)", await page.locator('.datebar').count() === 1);

