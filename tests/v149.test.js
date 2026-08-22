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
    // 2026-08-22 CI切り分け対応: #homezone-3(12週サイクルの常時表示カード)はv217で
    // 仕様削除済み(slim-spec.md §1-1/§4-2、CHANGES_v217.md「ホーム12週サイクルカードも
    // 仕様どおり削除」)。DOM上に該当要素が存在しないためこの観点は削除する。
    // なお homeScoreboard() 内の「12週 今週」セルは data-id="homezone-3" のジャンプ先を
    // 今も参照しており(app.js:3556)、タップしても着地先が存在しないダングリング参照に
    // なっている可能性がある(実装側の欠陥候補。別途報告)。

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

    console.log("[4b] 「前日」で移動すると独立の「今日へ」ボタンが1個だけ出る(重複しない)");
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    check("非当日では「今日へ」ボタンが1個だけ", await page.locator('[data-action="today"]').count() === 1);
    await page.click('[data-action="today"]');
    await page.waitForTimeout(200);
    check("当日に戻ると「今日へ」ボタンは0個(非表示)", await page.locator('[data-action="today"]').count() === 0);

    // ============================================================
    // (5) 375px幅で横スクロールが発生しない・ヘッダー要素が重ならない・縦幅を実測する
    // ============================================================
    console.log("[5] 375px幅でホームのヘッダー(▶Now/日付ナビ/タブバー)が折り返し、横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 375, height: 812 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    // v149レビュー対応: 同期異常バナー(.pd-auth-banner)はGitHub APIモックが常に401/404の
    // このテスト環境特有のアーティファクトで、実運用の縦幅とは無関係に約86px上乗せしてしまう。
    // app-state.jsonの起動時GETを成功応答でモックし、実運用(同期正常時)と同条件で計測する。
    await pageMobile.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"),
      (route) => {
        const body = JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", currentView: "home", selectedDate: "2000-01-01", blocks: [], projects: [], tasks: [], settings: {} });
        const content = Buffer.from(body, "utf-8").toString("base64");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-mock", content, encoding: "base64" }) });
      });
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, blocks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks: seedBlocks, TODAY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("375px幅(今日タブ)で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    // ヘッダー内の要素(▶Now・日付ナビ・検索)が互いに重ならないことをbounding boxで確認する
    const overlapCheck = await pageMobile.evaluate(() => {
      const els = Array.from(document.querySelectorAll(
        '.view-header [data-action="now-mode-open"], .view-header [data-action="date-prev"], .view-header [data-date-picker], .view-header [data-action="date-next"], .view-header [data-action="open-search"]'
      ));
      const rects = els.map((el) => el.getBoundingClientRect());
      const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (overlaps(rects[i], rects[j])) return { overlap: true, i, j };
        }
      }
      return { overlap: false, count: rects.length };
    });
    check("375px幅でヘッダー内の▶Now・日付ナビ要素どうしが重ならない(折り返しで回避)",
      overlapCheck.overlap === false && overlapCheck.count >= 4, JSON.stringify(overlapCheck));

    console.log("[5b] 375px幅: ヘッダー〜「いま、これ」までの縦幅を実測する(2系統レビュー対応、必須2)");
    await pageMobile.evaluate(() => window.scrollTo(0, 0));
    const vMetrics = await pageMobile.evaluate(() => {
      const datebar = document.querySelector(".datebar");
      const hero = document.querySelector(".home-hero");
      return {
        datebarHeight: datebar ? Math.round(datebar.getBoundingClientRect().height) : null,
        heroOffsetTop: hero ? hero.offsetTop : null
      };
    });
    check("375px幅で.datebarが1行に収まる(高さ<=45px。修正前の実測は87px)",
      vMetrics.datebarHeight !== null && vMetrics.datebarHeight <= 45, JSON.stringify(vMetrics));
    check("375px幅で.home-heroのoffsetTopが200px以下(修正前の実測は328px、v148は224px)",
      vMetrics.heroOffsetTop !== null && vMetrics.heroOffsetTop <= 200, JSON.stringify(vMetrics));

    await pageMobile.click('[data-action="home-tab"][data-tab="home"]');
    await pageMobile.waitForTimeout(300);
    const metricsMobileHomeTab = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("375px幅(ホームタブ)でも横スクロールが発生しない",
      metricsMobileHomeTab.scrollWidth <= metricsMobileHomeTab.clientWidth + 1,
      `scrollWidth=${metricsMobileHomeTab.scrollWidth} clientWidth=${metricsMobileHomeTab.clientWidth}`);

    console.log("[5c] 375px幅・非当日(「今日へ」ボタンが加わる)でも1行に収まり横スクロールしない");
    await pageMobile.click('[data-action="home-tab"][data-tab="today"]');
    await pageMobile.waitForTimeout(150);
    await pageMobile.click('[data-action="date-prev"]');
    await pageMobile.waitForTimeout(200);
    const metricsNonToday = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      const datebar = document.querySelector(".datebar");
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, datebarHeight: datebar ? Math.round(datebar.getBoundingClientRect().height) : null };
    });
    check("非当日でも横スクロールが発生しない", metricsNonToday.scrollWidth <= metricsNonToday.clientWidth + 1, JSON.stringify(metricsNonToday));
    check("非当日(今日へボタン込み5個)でも.datebarが1行に収まる", metricsNonToday.datebarHeight !== null && metricsNonToday.datebarHeight <= 45, JSON.stringify(metricsNonToday));
    await ctxMobile.close();

    // ============================================================
    // (6) タブ選択は非永続(リロードで「今日」に戻る)
    // ============================================================
    console.log("[6] ホームタブを選んだ状態でリロードすると、常に「今日」タブに戻る(非永続)");
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    check("(前提)ホームタブがactiveになっている", await page.locator('.home-tabbar [data-action="home-tab"][data-tab="home"]').evaluate((el) => el.classList.contains("active")));
    await page.reload();
    await page.waitForTimeout(400);
    check("リロード後は「今日」タブに戻る(state保存されていない)",
      await page.locator('.home-tabbar [data-action="home-tab"][data-tab="today"]').evaluate((el) => el.classList.contains("active")));
    check("リロード後、localStorageのstateにはhomeTab相当のキーが保存されていない",
      !JSON.stringify(await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY)).includes("homeTab"));
    const htmlAfterReload = await mainHTML();
    check("リロード後のDOMも今日タブの内容(いま、これ)になっている", htmlAfterReload.includes("いま、これ"));

    // ============================================================
    // (7) 80歳ビジョン導線カード(必須3)
    // ============================================================
    console.log("[7] ホームタブの「80歳ビジョン」カードをタップするとビジョンボード(80歳ページ)へ遷移する");
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    check("「80歳ビジョン」カードが表示される", await page.locator(".home-vision-card").count() === 1);
    await page.click(".home-vision-card");
    await page.waitForTimeout(300);
    const s7 = await stateNow();
    check("タップでcurrentViewがvisionへ遷移する", s7.currentView === "vision", s7.currentView);
    check("visionSectionがboard(ビジョンボード)になる", s7.settings.visionSection === "board", s7.settings.visionSection);
    check("visionBoardIndexが2(80歳)になる", s7.settings.visionBoardIndex === 2, s7.settings.visionBoardIndex);
    const visionTabsText = await page.locator(".vision-pdf-tabs").textContent().catch(() => "");
    check("ビジョンボード画面に実際に80歳タブがactiveで表示される", (visionTabsText || "").includes("80歳"), visionTabsText);

    // ============================================================
    // (8) ホームタブ滞在中は電池残量低下でも毎分の全再描画が起きない(必須1)
    // ============================================================
    console.log("[8] ホームタブ滞在中は電池残量が低くても毎分の全再描画(renderDeferringForFocus)が起きない");
    await seed({
      blocks: [],
      view: "home",
      battery: { start: { deficit: 30, low: 40, normal: 5 }, decayPerHour: 0, decayStartMinutes: 420, max: 50, recoveryDraft: false, recoveryThresholdPct: 40 }
    });
    // sleepLogなし→budgetLevel="none"→normal扱いのstart(5)が採用され、pct=5/50=10%<40%(not ok)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleepLog = {};
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);  // 500ms周期のティッカーを最低1回通し、_lastBatteryTickAtの基準を作る
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    // 「今日の理想」入力欄(ホームタブに存在)へフォーカスし、全再描画が起きればDOM入れ替えで
    // フォーカスが失われることを検知の手がかりにする。未入力日は既定closedの折りたたみ
    // (v81仕様)のため、まず開く。
    const idealFoldSummary = page.locator('details[data-fold-id="home-ideal-empty"] summary');
    if (await idealFoldSummary.count()) {
      await idealFoldSummary.click();
      await page.waitForTimeout(150);
    }
    await page.click('[data-ideal-date]');
    const focusedBefore = await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("data-ideal-date") || ""));
    check("(前提)理想入力欄にフォーカスできている", focusedBefore.startsWith("INPUT:"), focusedBefore);
    await page.clock.setFixedTime(new Date(now0.getTime() + 70 * 1000));  // 70秒進める(60秒スロットルを超えさせる)
    await page.waitForTimeout(800);  // 実時間で500ms周期のティッカーが新しい固定時刻を検知するのを待つ
    const focusedAfter = await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("data-ideal-date") || ""));
    check("70秒後もホームタブ滞在中は全再描画が起きず、入力欄のフォーカスが保たれる(必須1の修正確認)",
      focusedAfter === focusedBefore, `before=${focusedBefore} after=${focusedAfter}`);
    await page.clock.setFixedTime(now0);

    // ============================================================
    // (9) ホームタブ滞在中に別ビューへ行き来してもスクロールが取り残されない(必須4、Codex指摘)
    // ============================================================
    console.log("[9] ホームタブ滞在中に別ビューへ移動して戻ると、.home-heroが無いため.home-tabbarへフォールバックスクロールする");
    await seed({ blocks: seedBlocks, view: "wbs" });
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__scrollTargets = [];
      window.__origSIV9 = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        window.__scrollTargets.push(this.className || this.id || this.tagName);
        return window.__origSIV9.apply(this, args);
      };
    });
    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    const scrollTargets9 = await page.evaluate(() => window.__scrollTargets || []);
    await page.evaluate(() => { if (window.__origSIV9) Element.prototype.scrollIntoView = window.__origSIV9; });
    check("ホームタブ滞在中の復帰では.home-tabbarへフォールバックスクロールする(.home-heroは無いため)",
      scrollTargets9.some((c) => String(c).includes("home-tabbar")), JSON.stringify(scrollTargets9));
    check("存在しない.home-heroへは(見つからないため)スクロールしていない",
      !scrollTargets9.some((c) => String(c).includes("home-hero")), JSON.stringify(scrollTargets9));

    // ============================================================
    // (10) 宣言入力→直接タブをタップ(1回のクリック)でタブが切り替わる(必須5)
    // ============================================================
    console.log("[10] 宣言入力の直後にタブを直接タップ(1回のクリック)しても確実に切り替わる");
    await seed({ blocks: seedBlocks, view: "home" });
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    await page.fill('[data-declaration-date]', "v149宣言直タップ確認");
    await page.click('[data-action="home-tab"][data-tab="today"]');
    await page.waitForTimeout(250);
    check("宣言入力の直後、タブを1回タップしただけで今日タブへ切り替わる(2回目クリック不要)",
      await page.locator('.home-tabbar [data-action="home-tab"][data-tab="today"]').evaluate((el) => el.classList.contains("active")));
    const s10 = await stateNow();
    check("宣言内容も保存されている(全再描画をやめても保存自体は失われない)",
      s10.dailyDeclarations?.[TODAY]?.text === "v149宣言直タップ確認", JSON.stringify(s10.dailyDeclarations));

    // ============================================================
    // (11) 「宣言未入力」警告にホームタブへのワンタップ導線がある(推奨7)
    // ============================================================
    console.log("[11] 今日タブの「今日の状態」カードの宣言未入力警告に、ホームタブへ切り替えるボタンがある");
    await seed({ blocks: seedBlocks, view: "home", dailyDeclarations: {} });
    const declWarnRow = page.locator(".home-today-status-item", { hasText: "今日の宣言が未入力です" });
    check("宣言未入力の警告行が表示される", await declWarnRow.count() === 1);
    // 「今日の状態」カード自体が既定closedの折りたたみ(homeTodayStatusCard)のため、
    // ボタンをクリックするにはまず開く。
    const statusFold = page.locator('details[data-fold-id="today-status"]');
    if (await statusFold.count() && !(await statusFold.evaluate((el) => el.open))) {
      await statusFold.locator("summary").click();
      await page.waitForTimeout(150);
    }
    const jumpBtn = declWarnRow.locator('[data-action="home-tab"][data-tab="home"]');
    check("警告行にホームタブへ切り替えるボタンがある", await jumpBtn.count() === 1);
    await jumpBtn.click();
    await page.waitForTimeout(200);
    check("クリックでホームタブへ切り替わる(宣言入力欄が見える)", await page.locator('[data-declaration-date]').count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v149 ALL PASS" : `\n❌ v149: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
