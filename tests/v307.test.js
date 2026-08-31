// v307: タスクシュート⇔タイムライン等のタブ(ビュー)切替でスクロール位置が引き継がれ、
// 新しいタブの表示上部に空白が見える不具合(dogfooding#4)の回帰テスト。
//
// 実機調査で判明した事実: .app-shellはmin-height:100dvh(固定heightではない)のグリッドで、
// .main-pane(#main)にoverflow:autoが付いていても、コンテンツが長いと.app-shell自体が
// その高さまで伸びる(main.scrollHeight === main.clientHeightのまま)。つまり#mainは
// 幅を問わず内部スクロールコンテナには一切ならず、実際に動くのは常にページ全体
// (document.scrollingElement)である。renderMain()の修正はmain.scrollTopと
// document.scrollingElement.scrollTopの両方を0に戻すが、本テストは実際に効果が観測できる
// document.scrollingElement.scrollTopを軸に検証する。
//
// クリックはPlaywrightのlocator.click()ではなくpage.evaluate内でel.click()を直接呼ぶ
// (a) 事前にpageをスクロールした状態でlocator.click()を使うと、Playwrightの
//     actionability確認(「scrolling into view if needed」)がクリック対象を可視化するために
//     ページを勝手にスクロールし直してしまい、リセット検証そのものを汚染する
// (b) 今日表示中のタブ切替は50ms後に既存の自動スクロール(v146)が発火するため、
//     クリックと直後の読み取りを同一のpage.evaluate呼び出し内(同期JS)で行わないと、
//     ラウンドトリップの間に50msが経過して「リセット直後の値」を観測できない
// の2点を避けるため。
//
// タスクシュート⇔タイムラインの両方向・nav経路/search-jump経路で検証し、
// 「日付だけの切替ではリセットしない」「今日表示中の既存自動スクロール
// (次の未着手Block/現在時刻ライン)がリセット後も従来どおり機能する」ことも併せて確認する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, STATE_KEY, randomPort } = require("./helpers");
const fs = require("fs");

const PORT = randomPort();
const TODAY = "2026-08-30";
const TOMORROW = "2026-08-31";
const FIXED_NOW = new Date(2026, 7, 30, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

function planBlock({ id, date, startMin, minutes = 20, completed = true, actualStartAt = "", actualEndAt = "" }) {
  return {
    id, taskId: "v307-task", date, title: `v307 Block ${id}`, category: "仕事",
    plannedStartAt: `${date}T${hhmm(startMin)}`, plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
    actualStartAt, actualEndAt, completed, charge: 0, discharge: 0, comment: "",
    recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, carryCount: 0,
    isMIT: false, source: "", estimateMin: minutes, leverageType: "",
    createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
  };
}

// 各日付: 完了済み40件(06:00〜19:00台、20分刻み) + 未完了1件(20:00、plannedStartAt最遅)。
// 40件はページ全体(document.scrollingElement)を確実にスクロール可能な高さにする。
// 未完了1件はcurrentOrNextTaskchuteBlockIdの対象(次の未着手Block)になる。
function blocksForDate(date) {
  const blocks = [];
  for (let i = 0; i < 40; i++) {
    const startMin = 6 * 60 + i * 20;
    blocks.push(planBlock({
      id: `${date}-b${i}`, date, startMin, completed: true,
      actualStartAt: `${date}T${hhmm(startMin)}`, actualEndAt: `${date}T${hhmm(startMin + 20)}`
    }));
  }
  blocks.push(planBlock({ id: `${date}-target`, date, startMin: 20 * 60, completed: false }));
  return blocks;
}

function seedItems() {
  return {
    project: {
      id: "v307-project", title: "v307 Project", kind: "normal", status: "active",
      deleted: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`
    },
    task: {
      id: "v307-task", projectId: "v307-project", title: "v307 Task", kind: "normal",
      status: "doing", deleted: false, dueDate: TODAY,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`
    },
    blocks: [...blocksForDate(TODAY), ...blocksForDate(TOMORROW)]
  };
}

async function seedPage(context) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await blockGithubApiByDefault(page);
  await page.goto(`http://localhost:${PORT}/`);
  await passGithubGate(page);
  const items = seedItems();
  await page.evaluate(({ key, itemsValue, today }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      blocks: itemsValue.blocks, tasks: [itemsValue.task], projects: [itemsValue.project],
      recurrences: [], selectedDate: today, currentView: "tasks"
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, itemsValue: items, today: TODAY });
  await page.reload();
  await page.locator('#app[data-view="tasks"]').waitFor();
  return { page, pageErrors };
}

async function scrollPos(page) {
  return page.evaluate(() => ({
    page: document.scrollingElement.scrollTop,
    main: document.querySelector("#main").scrollTop
  }));
}

async function setScrollPos(page, value) {
  await page.evaluate((v) => {
    document.scrollingElement.scrollTop = v;
    document.querySelector("#main").scrollTop = v;
  }, value);
}

// クリックと直後の状態読み取りを同一のpage.evaluate呼び出し内(同期JS)で行う。
// 50ms後の既存自動スクロール(v146)やPlaywrightのscroll-into-view副作用より前の値を捕まえるため。
async function clickAndReadImmediately(page, selector) {
  return page.evaluate((sel) => {
    document.querySelector(sel).click();
    return {
      page: document.scrollingElement.scrollTop,
      main: document.querySelector("#main").scrollTop,
      view: document.querySelector("#app").dataset.view
    };
  }, selector);
}

async function runScenario(browser, { width, height, navContainer }) {
  console.log(`\n=== 幅${width}px(${navContainer}) ===`);
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
  const { page, pageErrors } = await seedPage(context);
  try {
    const scrollable = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight);
    check(`${width}px: ページ全体がスクロール可能な高さになる(コンテンツ40件超)`, scrollable);

    // [1] タスクシュート→タイムライン: nav経路でのリセット(クリックと同時に読み取る)
    await setScrollPos(page, 500);
    let before = await scrollPos(page);
    check(`${width}px: 切替前にdocument.scrollingElement.scrollTopが実際に動く`, before.page > 100, JSON.stringify(before));

    let after = await clickAndReadImmediately(page, `${navContainer} [data-action="nav"][data-view="timeline"]`);
    check(`${width}px: タスクシュート→タイムライン切替直後にpageスクロールが0にリセットされる`,
      after.page === 0 && after.view === "timeline", JSON.stringify(after));
    check(`${width}px: 同時にmain.scrollTopも0のまま(内部スクロールは発生しない前提の確認)`,
      after.main === 0, JSON.stringify(after));

    // [2] タイムライン→タスクシュート: 逆方向
    await setScrollPos(page, 400);
    before = await scrollPos(page);
    check(`${width}px: タイムライン側でも切替前にpageスクロールが動く`, before.page > 100, JSON.stringify(before));

    after = await clickAndReadImmediately(page, `${navContainer} [data-action="nav"][data-view="tasks"]`);
    check(`${width}px: タイムライン→タスクシュート切替直後にpageスクロールが0にリセットされる(逆方向)`,
      after.page === 0 && after.view === "tasks", JSON.stringify(after));

    // 既存自動スクロール(v146)との共存確認: 今日表示中は次の未着手Blockへ50ms後にscrollIntoViewする。
    // リセット(0)の直後にこの既存挙動が上書きされずに発火し続けることを確認する(条件待ち、固定sleepなし)。
    await page.waitForFunction(() => document.scrollingElement.scrollTop > 0, null, { timeout: 2000 });
    const afterAutoScroll = await scrollPos(page);
    check(`${width}px: リセット後も既存の「次の未着手Blockへ自動スクロール」(v146)が従来どおり発火する`,
      afterAutoScroll.page > 0, JSON.stringify(afterAutoScroll));

    // [3] 同一ビュー内の日付だけの切替では、リセットが発火しない(スコープを超えない回帰防止)
    await setScrollPos(page, 300);
    before = await scrollPos(page);
    check(`${width}px: 日付切替前にpageスクロールを300へ設定できる`, before.page === 300, JSON.stringify(before));

    after = await clickAndReadImmediately(page, '[data-action="date-next"]');
    check(`${width}px: view不変・日付のみ変化ではpageスクロールが0へ強制リセットされない`,
      after.page === 300, JSON.stringify(after));
    await page.waitForFunction((tomorrow) =>
      document.querySelector('[data-date-picker]')?.value === tomorrow, TOMORROW, { timeout: 2000 });

    // 翌日表示から今日表示へ戻す(以降のsearch-jumpテストのため今日へ復帰)
    await page.evaluate(() => document.querySelector('[data-action="date-prev"]').click());
    await page.waitForFunction((today) =>
      document.querySelector('[data-date-picker]')?.value === today, TODAY, { timeout: 2000 });

    // [4] search-jump経路(setView()を経由しないもう一つのview切替入口)でもリセットされる
    await setScrollPos(page, 350);
    await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.id = "v307-search-jump-probe";
      btn.dataset.action = "search-jump";
      btn.dataset.view = "timeline";
      document.body.appendChild(btn);
    });
    after = await clickAndReadImmediately(page, "#v307-search-jump-probe");
    check(`${width}px: search-jump経路でもpageスクロールが0にリセットされる(setView()を経由しない切替の網羅)`,
      after.page === 0 && after.view === "timeline", JSON.stringify(after));

    // search-jump後も今日表示中なので既存自動スクロール(v146)が50ms後に発火する。
    // context.close()より前にこのタイマーを消化しておかないと、close後にコールバックが
    // 破棄済みページへアクセスして例外になり、テストプロセス全体が不安定終了しうるため
    // (条件待ちで消化する。固定sleepではない)。
    await page.waitForFunction(() => document.scrollingElement.scrollTop > 0, null, { timeout: 2000 });

    check(`${width}px: 一連の操作でpageerrorなし`, pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
  }
}

(async () => {
  const testSource = fs.readFileSync(__filename, "utf8");
  check("新規固定waitなし", !testSource.includes(["waitFor", "Timeout"].join("")));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    console.log("[1] デスクトップ幅(1280x900、サイドバーnav)");
    await runScenario(browser, { width: 1280, height: 900, navContainer: "#sidebar" });

    console.log("\n[2] モバイル幅(390x844、720px未満・ボトムnav)");
    await runScenario(browser, { width: 390, height: 844, navContainer: "#bottomNav" });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v307: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
