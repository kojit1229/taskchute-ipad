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
    // v230: home完全撤去。旧2タブ/内省カード/専用スクロール契約は同等UIがない。
    // 不存在・today移行・現行TOWERへの置換で削除仕様の復活を防ぐ。
    console.log("[1-11] v230: home専用UIの不存在とtoday/TOWERへの移行");
    await seed({ blocks: seedBlocks, view: "home", dailyDeclarations: {} });
    check("旧homeナビ・タブ・hero・zoneは描画されない",
      await page.locator('[data-view="home"], .home-tabbar, .home-hero, [id^="homezone-"]').count() === 0);
    check("旧home内省カード群は描画されない",
      await page.locator('.home-creed, .home-lifespan, .home-vision-card, .home-today-status, [data-declaration-date]').count() === 0);
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
    check("現行のTOWER/ATISが表示される",
      await page.locator(".sec-atis").count() === 1
      && await page.locator('[data-action="ai-morning-plan"]').count() === 1);
    const persisted = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
    check("homeTab相当のセッション値をstateへ永続化しない", !JSON.stringify(persisted).includes("homeTab"));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v149 ALL PASS" : `\n❌ v149: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
