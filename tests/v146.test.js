// v146 検証: UI改善計画Phase1(毎日の摩擦を消す)。CHANGES_v146.md参照。
// 入力: workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md(承認済み計画)。
//
// (1) ホーム折りたたみ既定値: 信条/寿命/AIからは既定closed(参照系)、今日のリズム(zone2、
//     非縮退時)は既定open。長い弧(zone3)/足あと(zone4)は既定closedのまま(既存仕様維持)
// (2) ホームの並び順: いま、これ→今日の主役(MIT)→今日、すすめる→今日のリズム→
//     参照系(信条/寿命/AIから/スコアボード)→長い弧→足あと
// (3) ホームは着手中(無ければ次の未着手)Blockへレンダー後自動スクロールする。
//     検索入力にフォーカス中は発火しない
// (4) タスクシュートも同様に自動スクロールする
// (5) 🏁(タスク完了)はタスクシュート行から撤去され、Block編集モーダルへ移設されている
//     (詳細な状態遷移の回帰はtests/v107.test.jsが担当。本ファイルは配置のみ確認)
// (6) 誤タップ対策の44px当たり判定: .checkbox-button / .tl-start-btn / .modal-close
// (7) バッファ残量帯は「今日を扱う」画面(home/tasks/timeline/journal/reports)だけに出る
// (8) ジャーナルは720px以下で当日編集パネルが先頭(CSS order)。前日パネルは既定closedのdetails
// (9) 設定画面から内部バージョン表記(vNNN)が消え、「現在のファイル構成」はdetails化(既定closed)
// (10) バッテリー回復下書き(v145、source:"battery-recovery")の下書きバーラベルが
//      「🔋 回復候補」になる(旧「⚙ 決定論配置」から変更)
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

  function planBlock({ id, title, startMin, minutes = 30, taskId = "", category = "", completed = false }) {
    return {
      id, taskId, date: TODAY, title, category,
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "v146-proj", kind: "normal", title: "v146テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v146-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({ blocks = [], tasks = [], projects = [], view = "home", settings = {} } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      Object.assign(s.settings, settings);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function mainHTML() {
    return page.evaluate(() => document.querySelector("#main")?.innerHTML || "");
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) ホーム折りたたみ既定値
    // ============================================================
    console.log("[1] ホーム折りたたみ既定値: 信条/寿命/AIからは既定closed、今日のリズムは既定open");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({
      blocks: [planBlock({ id: "b-fold-1", title: "既定値確認Block", startMin: 9 * 60 })],
      view: "home"
    });
    check("信条(creed)は既定closed", await page.locator('details[data-fold-id="creed"]').evaluate((el) => el.open) === false);
    check("寿命(lifespan)は既定closed", await page.locator('details[data-fold-id="lifespan"]').evaluate((el) => el.open) === false);
    check("AIから(ai-hub)は既定closed", await page.locator('details[data-fold-id="ai-hub"]').evaluate((el) => el.open) === false);
    check("今日のリズム(zone2)は既定open", await page.locator('details[data-fold-id="zone2"]').evaluate((el) => el.open) === true);
    check("長い弧(zone3)は既定closedのまま(既存仕様維持)", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open) === false);
    check("今日の足あと(zone4)は既定closedのまま(既存仕様維持)", await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open) === false);
    check("スコアボードは既定closedのまま(既存仕様維持)", await page.locator('details[data-fold-id="home-scoreboard"]').evaluate((el) => el.open) === false);

    // ============================================================
    // (2) ホームの並び順
    // ============================================================
    console.log("[2] ホームの並び順: いま、これ→今日の主役→今日、すすめる→今日のリズム→参照系→長い弧→足あと");
    const html = await mainHTML();
    const idx = (marker) => html.indexOf(marker);
    const order = {
      hero: idx('class="panel home-hero'),
      mit: idx('id="home-mit-anchor"'),
      zone1: idx('id="homezone-1"'),
      zone2: idx('id="homezone-2"'),
      creed: idx('data-fold-id="creed"'),
      lifespan: idx('data-fold-id="lifespan"'),
      aiHub: idx('data-fold-id="ai-hub"'),
      scoreboard: idx('data-fold-id="home-scoreboard"'),
      zone3: idx('id="homezone-3"'),
      zone4: idx('id="homezone-4"')
    };
    check("すべてのマーカーが見つかる(-1が無い)", Object.values(order).every((v) => v >= 0), JSON.stringify(order));
    check("hero < mit", order.hero < order.mit, JSON.stringify(order));
    check("mit < zone1(今日、すすめる)", order.mit < order.zone1, JSON.stringify(order));
    check("zone1 < zone2(今日のリズム)", order.zone1 < order.zone2, JSON.stringify(order));
    check("zone2 < creed(参照系の先頭)", order.zone2 < order.creed, JSON.stringify(order));
    check("creed < lifespan < aiHub < scoreboard(参照系の並び)",
      order.creed < order.lifespan && order.lifespan < order.aiHub && order.aiHub < order.scoreboard, JSON.stringify(order));
    check("scoreboard < zone3 < zone4(参照系のあとに長い弧・足あと)",
      order.scoreboard < order.zone3 && order.zone3 < order.zone4, JSON.stringify(order));

    // ============================================================
    // (3) ホームの自動スクロール + 検索入力フォーカス中は非発火 + 同一view/dateでは再発火しない
    // ============================================================
    console.log("[3] ホームへのビュー切替(view変化)時に.home-heroへ自動スクロールする");
    await seed({
      blocks: [
        planBlock({ id: "b-scroll-home", title: "自動スクロール確認Block", startMin: 14 * 60 }),
        planBlock({ id: "b-scroll-home-2", title: "スクロール位置確認用デコイBlock", startMin: 16 * 60, completed: true })
      ],
      view: "wbs"
    });
    await page.evaluate(() => {
      window.__scrollCalls = [];
      const proto = Element.prototype;
      const orig = proto.scrollIntoView;
      proto.scrollIntoView = function (...args) {
        window.__scrollCalls.push({ tag: this.tagName, cls: this.className || "", id: this.id || "" });
        return orig.apply(this, args);
      };
    });
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    const scrollCallsHome = await page.evaluate(() => window.__scrollCalls || []);
    check("wbs→home(ビュー変化)で.home-heroへscrollIntoViewが呼ばれる",
      scrollCallsHome.some((c) => String(c.cls).includes("home-hero")), JSON.stringify(scrollCallsHome));

    console.log("[3b] 検索入力にフォーカス中は、ビュー変化があっても自動スクロールが発火しない");
    // wbsは日付バー(🔍検索ボタン)を持たないため、検索ボタンがある"tasks"を経由地点にする。
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="open-search"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector("#cross-search-input")?.focus());
    const activeBefore = await page.evaluate(() => document.activeElement?.id);
    check("検索入力にフォーカスしている", activeBefore === "cross-search-input", activeBefore);
    await page.evaluate(() => { window.__scrollCalls = []; });
    // プログラム的click(要素.click())はmousedown由来のフォーカス移動を起こさないため、
    // フォーカスを維持したままtasks→home(ビュー変化)を発火できる(実ユーザークリックの
    // Playwright .click()は対象ボタンへフォーカスが移り検証にならないため使わない)。
    await page.evaluate(() => document.querySelector('[data-action="nav"][data-view="home"]')?.click());
    await page.waitForTimeout(200);
    const activeAfter = await page.evaluate(() => document.activeElement?.id);
    const scrollCallsFocused = await page.evaluate(() => window.__scrollCalls || []);
    check("検索入力へのフォーカスは維持される(プログラム的clickのため)", activeAfter === "cross-search-input", activeAfter);
    check("検索入力フォーカス中は、tasks→home(ビュー変化)でも.home-heroへのスクロールが発火しない",
      !scrollCallsFocused.some((c) => String(c.cls).includes("home-hero")), JSON.stringify(scrollCallsFocused));
    await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());
    await page.waitForTimeout(150);

    console.log("[3c] 同一view+dateのままの再描画(チェック操作等)ではスクロール位置が保たれる(巻き戻らない)");
    // ここまでの[3b]で既にhomeビューにいる(_lastScrollView==="home"のはず)。
    // 手動で下部までスクロールしてから、同一画面内の操作(toggle-block)を行い、位置が動かないことを見る。
    await page.evaluate(() => window.scrollTo(0, 99999));
    await page.waitForTimeout(100);
    const scrollBefore3c = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
    check("スクロール位置がそれなりに下がっている(前提条件)", scrollBefore3c > 50, String(scrollBefore3c));
    await page.evaluate(() => { window.__scrollCalls = []; });
    await page.click('[data-action="toggle-block"][data-id="b-scroll-home-2"]');
    await page.waitForTimeout(200);
    const scrollAfter3c = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
    const scrollCalls3c = await page.evaluate(() => window.__scrollCalls || []);
    check("同一view+dateの再描画では.home-heroへの自動スクロールが再発火しない",
      !scrollCalls3c.some((c) => String(c.cls).includes("home-hero")), JSON.stringify(scrollCalls3c));
    check("スクロール位置が保たれる(巻き戻らない、許容誤差50px)",
      Math.abs(scrollAfter3c - scrollBefore3c) < 50, `before=${scrollBefore3c} after=${scrollAfter3c}`);

    // ============================================================
    // (4) タスクシュートの自動スクロール(renderTasks()が実際に描画するBlockに限定)
    // ============================================================
    console.log("[4] タスクシュートも着手中(無ければ次の未着手)Blockへ自動スクロールする(ビュー変化時)");
    await seed({
      blocks: [
        // v146レビュー対応: taskId無しの単発Blockはnormalize時に「その他」受け皿Task/Projectへ
        // 自動的に紐づけられる(実装確認済み)ため、実際にrenderTasks()から除外される確実な条件
        // (カテゴリ「ルーティン」)を使ってデコイを作る。選ばれてはいけない
        planBlock({ id: "b-scroll-tasks-decoy", title: "ルーティンBlock(描画されないはず)", startMin: 8 * 60, category: "ルーティン" }),
        planBlock({ id: "b-scroll-tasks", title: "タスクシュート自動スクロール確認", startMin: 15 * 60, taskId: "v146-task" })
      ],
      tasks: [testTask("v146-task", "v146テストタスク")],
      projects: [testProject()],
      view: "wbs"
    });
    await page.evaluate(() => {
      window.__scrollCalls = [];
      const proto = Element.prototype;
      const orig = proto.scrollIntoView;
      proto.scrollIntoView = function (...args) {
        window.__scrollCalls.push({ tag: this.tagName, id: this.dataset ? this.dataset.id : null, action: this.dataset ? this.dataset.action : null });
        return orig.apply(this, args);
      };
    });
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(200);
    const scrollCallsTasks = await page.evaluate(() => window.__scrollCalls || []);
    check("タスクシュート表示で対象Block行(strong[data-action=edit-block])へscrollIntoViewが呼ばれる",
      scrollCallsTasks.some((c) => c.action === "edit-block" && c.id === "b-scroll-tasks"), JSON.stringify(scrollCallsTasks));
    check("renderTasks()に描画されないルーティンBlockは選ばれない",
      !scrollCallsTasks.some((c) => c.id === "b-scroll-tasks-decoy"), JSON.stringify(scrollCallsTasks));

    // ============================================================
    // (5) 🏁はタスクシュート行から編集モーダルへ移設されている(詳細な状態遷移はv107.test.js)
    // ============================================================
    console.log("[5] 🏁(タスク完了)は行に無く、Block編集モーダルにある");
    check("行内に🏁ボタンは無い", await page.locator('[data-action="toggle-task-complete"][data-id="b-scroll-tasks"]').count() === 0);
    await page.click('[data-action="edit-block"][data-id="b-scroll-tasks"]');
    await page.waitForTimeout(200);
    check("Block編集モーダル内に🏁ボタンがある",
      await page.locator('.modal-card [data-action="toggle-task-complete"][data-id="b-scroll-tasks"]').count() === 1);
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(150);

    // ============================================================
    // (6) 44px当たり判定(::before/::after のinset)
    // ============================================================
    console.log("[6] 誤タップ対策の44px当たり判定: .checkbox-button / .tl-start-btn / .modal-close");
    async function getPseudoInset(selector, pseudo) {
      return page.locator(selector).first().evaluate((el, pseudo) => {
        const cs = getComputedStyle(el, pseudo);
        return { top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left };
      }, pseudo);
    }
    const cbBefore = await getPseudoInset('[data-action="toggle-block"][data-id="b-scroll-tasks"]', "::before");
    check(".checkbox-buttonの::beforeが44px相当のinset(-7px)を持つ(見た目30pxのまま)",
      cbBefore.top === "-7px" && cbBefore.left === "-7px" && cbBefore.right === "-7px" && cbBefore.bottom === "-7px",
      JSON.stringify(cbBefore));

    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(300);
    const tlStartCount = await page.locator(".tl-start-btn").count();
    if (tlStartCount > 0) {
      // v146レビュー対応: タイムラインは短時間Blockが物理的に隣接・重なるため、縦方向まで
      // -11pxで広げると隣接Blockの当たり判定を奪う(実測)。横方向(左右)は-11px(44px相当)
      // のまま、縦方向(上下)は-3pxに抑えている。
      const tlAfter = await getPseudoInset(".tl-start-btn", "::after");
      check(".tl-start-btnの::afterは横-11px/縦-3pxのinset(隣接Blockへの越境を抑制)",
        tlAfter.left === "-11px" && tlAfter.right === "-11px" && tlAfter.top === "-3px" && tlAfter.bottom === "-3px",
        JSON.stringify(tlAfter));
    } else {
      console.log("  (skip: .tl-start-btnが今回のfixtureでは描画されなかった)");
    }

    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="edit-block"][data-id="b-scroll-tasks"]');
    await page.waitForTimeout(200);
    const modalCloseBefore = await getPseudoInset(".modal-close", "::before");
    check(".modal-closeの::beforeが44px相当のinset(-6px)を持つ(見た目32pxのまま)",
      modalCloseBefore.top === "-6px" && modalCloseBefore.left === "-6px" && modalCloseBefore.right === "-6px" && modalCloseBefore.bottom === "-6px",
      JSON.stringify(modalCloseBefore));
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(150);

    // ============================================================
    // (7) バッファ残量帯の画面限定
    // ============================================================
    console.log("[7] バッファ残量帯は今日を扱う画面(home/tasks/timeline/journal/reports)だけに出る");
    await seed({ blocks: [], view: "home", settings: { dailyBufferMin: 100 } });
    check("homeでは出る", await page.locator(".buffer-meter").count() === 1);
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(200);
    check("tasksでは出る", await page.locator(".buffer-meter").count() === 1);
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(200);
    check("timelineでは出る", await page.locator(".buffer-meter").count() === 1);
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(200);
    check("journalでは出る", await page.locator(".buffer-meter").count() === 1);
    await page.click('[data-action="nav"][data-view="reports"]');
    await page.waitForTimeout(200);
    check("reportsでは出る", await page.locator(".buffer-meter").count() === 1);
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    check("settingsでは出ない", await page.locator(".buffer-meter").count() === 0);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(200);
    check("stats(計器盤)では出ない", await page.locator(".buffer-meter").count() === 0);
    // 「その他」(more)はモバイル下部ナビ専用のIDでデスクトップ幅のサイドバーには無いため、
    // state.currentViewを直接注入して確認する(既存スイートと同じ手法)。
    await seed({ blocks: [], view: "more", settings: { dailyBufferMin: 100 } });
    check("more(その他)では出ない", await page.locator(".buffer-meter").count() === 0);

    console.log("[7b] バッファ未設定(dailyBufferMin<=0)の日は、対象画面であっても帯自体が出ない(v146レビュー対応・計画1-4)");
    await seed({ blocks: [], view: "home", settings: { dailyBufferMin: 0 } });
    check("未設定時はhomeでも帯が出ない(空文字)", await page.locator(".buffer-meter").count() === 0);

    // ============================================================
    // (8) ジャーナルの当日優先表示
    // ============================================================
    console.log("[8] ジャーナル: 720px以下で当日編集パネルが先頭(CSS order)。前日パネルは既定closedのdetails");
    await seed({ blocks: [], view: "journal" });
    const prevPanel = page.locator("details.journal-panel-prev");
    check("前日パネルはdetailsで既定closed", await prevPanel.evaluate((el) => el.open) === false);
    check("当日編集パネルはdiv(details化していない)", await page.locator("div.journal-panel-today").count() === 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const orderToday = await page.locator(".journal-panel-today").evaluate((el) => getComputedStyle(el).order);
    const orderPrev = await page.locator(".journal-panel-prev").evaluate((el) => getComputedStyle(el).order);
    check("モバイル幅で当日編集パネルのorderが前日パネルより小さい(先頭)",
      Number(orderToday) < Number(orderPrev), `today=${orderToday} prev=${orderPrev}`);
    await page.setViewportSize({ width: 1100, height: 1400 });
    await page.waitForTimeout(200);

    // ============================================================
    // (9) 設定画面のvNNN非表示 + 現在のファイル構成のdetails化
    // ============================================================
    console.log("[9] 設定画面から内部バージョン表記(vNNN)が消え、「現在のファイル構成」はdetails既定closed");
    await seed({ blocks: [], view: "settings" });
    // 「見出しから削除」が対象であり、本文の技術的な移行経緯の説明(例: 「Contents API 経由で
    // 保存します(v72。...)」)まで削るのはスコープ外(過剰対応)。パネル見出し(h2/h3)+
    // 群summaryを検査する。v148で13パネルが4群のdetails内(h3、2階層ネスト)へ移動したため、
    // 「.settings-grid > .panel h2」(直下のみ)だと個々のパネル見出しに届かなくなっていた
    // (2系統レビュー指摘・回帰保護の空洞化)。h2/h3/summaryをスコープ全体から広く拾う形に
    // 直し、13パネル分の見出しへ回帰保護を回復する(closed details内でもtextContentは読める)。
    const panelHeadings = await page.locator("#main .settings-grid h2, #main .settings-grid h3, #main .settings-grid summary").allTextContents();
    check("パネル見出しに(vNNN)を含まない", panelHeadings.every((h) => !/\(v\d+/.test(h)), JSON.stringify(panelHeadings));
    const fileStructFold = page.locator("details:has-text('現在のファイル構成')").first();
    check("「現在のファイル構成」はdetails要素で既定closed",
      await fileStructFold.count() === 1 && await fileStructFold.evaluate((el) => el.open) === false);

    // ============================================================
    // (10) バッテリー回復下書きのラベルが「🔋 回復候補」になる
    // ============================================================
    console.log("[10] バッテリー回復下書き(source:battery-recovery)の下書きバーラベルが「🔋 回復候補」になる");
    const mk = (id, date, title, hStart, hEnd, charge, discharge) => ({
      id, date, title, category: "休息",
      plannedStartAt: `${date}T${hStart}`, plannedEndAt: `${date}T${hEnd}`,
      actualStartAt: `${date}T${hStart}`, actualEndAt: `${date}T${hEnd}`,
      completed: true, charge, discharge, estimateMin: 0, deleted: false
    });
    const recoveryBlocks = [
      mk("v146-str-1", "2026-07-20", "ストレッチ", "09:00", "09:20", 5, 1),
      mk("v146-str-2", "2026-07-21", "ストレッチ", "09:00", "09:20", 5, 1),
      mk("v146-str-3", "2026-07-22", "ストレッチ", "09:00", "09:20", 5, 1)
    ];
    await page.clock.setFixedTime(new Date(2026, 6, 27, 18, 0, 0, 0));  // 07:00起点decay想定で残量が閾値を下回る時刻
    await page.evaluate(({ KEY, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} }; s.sleep.logs = {};
      s.condition = s.condition || { logs: {} }; s.condition.logs = {};
      s.blocks = blocks; s.tasks = []; s.projects = [];
      s.selectedDate = "2026-07-27";
      s.currentView = "timeline";
      s.timelineMode = "planned";
      s.settings.battery = { ...(s.settings.battery || {}), recoveryDraft: true };
      s.batteryRecoveryDraftDates = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks: recoveryBlocks });
    await page.reload();
    await page.waitForTimeout(900);
    const draftBarText = await page.locator(".draft-bar").first().textContent().catch(() => "");
    check("下書きバーに「🔋 回復候補」ラベルが出る(旧「⚙ 決定論配置」ではない)",
      (draftBarText || "").includes("🔋 回復候補") && !(draftBarText || "").includes("⚙ 決定論配置"),
      draftBarText);

    console.log(failures === 0 ? "\n✅ v146 ALL PASS" : `\n❌ v146: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
