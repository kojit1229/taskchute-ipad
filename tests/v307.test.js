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

// 各日付: 開始済み・終了報告済みだが未完了(completed:false)の40件(06:00〜19:00台、20分刻み)
// + 未着手1件(20:00、plannedStartAt最遅)。
// v331以降、完了Blockは実行タブに描画されない(実績はタイムライン)ため、旧fixtureの完了40件では
// 対象Blockが先頭に来て自動スクロール量が0になる。40件は「これから」に描画される未完了Blockとして
// ページ全体(document.scrollingElement)を確実にスクロール可能な高さにする(意図は不変)。
// 実体(レビュー指摘): FIXED_NOW=10:00固定のため、currentOrNextTaskchuteBlockIdの
// current分岐が10:00〜10:20台の未完了Block(b12)を拾う。20:00の未着手1件(-target)は
// 「次の未着手Block」候補ではあるが、既にcurrent(進行時間帯に該当するb12)が先に
// マッチするため実際のスクロール対象にはならない。検査したいのは「自動スクロールが
// 発火しスクロール量が0でない」ことであり、対象が-targetでもb12でもこの検査は成立する。
function blocksForDate(date) {
  const blocks = [];
  for (let i = 0; i < 40; i++) {
    const startMin = 6 * 60 + i * 20;
    blocks.push(planBlock({
      id: `${date}-b${i}`, date, startMin, completed: false,
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

// v333: 実行タブ統合でモバイル下部ナビの「タイムライン」単独項目が無くなったため、
// このスイートのモバイルシナリオはexec(実行ラッパー)⇔todayでも同じ観点(view切替時の
// スクロールリセット・既存自動スクロールとの共存)を検証できるようinitialViewを可変にする。
async function seedPage(context, initialView = "tasks") {
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await blockGithubApiByDefault(page);
  await page.goto(`http://localhost:${PORT}/`);
  await passGithubGate(page);
  const items = seedItems();
  await page.evaluate(({ key, itemsValue, today, view }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      blocks: itemsValue.blocks, tasks: [itemsValue.task], projects: [itemsValue.project],
      recurrences: [], selectedDate: today, currentView: view
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, itemsValue: items, today: TODAY, view: initialView });
  await page.reload();
  await page.locator(`#app[data-view="${initialView}"]`).waitFor();
  return { page, pageErrors };
}

// v333: v146(既存自動スクロール)の配線があるビューだけがtransition後にscrollTop>0を
// 生む対象。"today"のようにこの配線が無いビューへの着地を「まだ発火していないタイマーを
// 消化する待機」の対象にすると、発火しないまま2秒でタイムアウトし例外になる
// (search-jump経路のstep[4]参照)。
const VIEWS_WITH_AUTOSCROLL = new Set(["tasks", "timeline", "exec"]);

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

// v333: viewA/viewBを外側から渡せるようパラメタ化(デスクトップ=tasks⇄timeline、
// モバイル=exec⇄today)。
// v335(§C追随): #sidebarも「タスクシュート」「タイムライン」を「実行」1項目へ統合したため、
// tasks/timelineは直接クリックできる導線が無くなった(内部の分岐render()自体は残っており
// 直接setViewしても壊れない旨は他スイートで別途検証する)。デスクトップも#bottomNavと同じ
// exec⇄別ビューの組で「view切替でのスクロールリセット」という本テストの観点自体は維持する。
async function runScenario(browser, { width, height, navContainer, viewA, viewB }) {
  console.log(`\n=== 幅${width}px(${navContainer}、${viewA}⇄${viewB}) ===`);
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
  const { page, pageErrors } = await seedPage(context, viewA);
  try {
    const scrollable = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight);
    check(`${width}px: ページ全体がスクロール可能な高さになる(コンテンツ40件超)`, scrollable);

    // [1] viewA→viewB: nav経路でのリセット(クリックと同時に読み取る)
    await setScrollPos(page, 500);
    let before = await scrollPos(page);
    check(`${width}px: 切替前にdocument.scrollingElement.scrollTopが実際に動く`, before.page > 100, JSON.stringify(before));

    let after = await clickAndReadImmediately(page, `${navContainer} [data-action="nav"][data-view="${viewB}"]`);
    check(`${width}px: ${viewA}→${viewB}切替直後にpageスクロールが0にリセットされる`,
      after.page === 0 && after.view === viewB, JSON.stringify(after));
    check(`${width}px: 同時にmain.scrollTopも0のまま(内部スクロールは発生しない前提の確認)`,
      after.main === 0, JSON.stringify(after));

    // [2] viewB→viewA: 逆方向
    await setScrollPos(page, 400);
    before = await scrollPos(page);
    check(`${width}px: ${viewB}側でも切替前にpageスクロールが動く`, before.page > 100, JSON.stringify(before));

    after = await clickAndReadImmediately(page, `${navContainer} [data-action="nav"][data-view="${viewA}"]`);
    check(`${width}px: ${viewB}→${viewA}切替直後にpageスクロールが0にリセットされる(逆方向)`,
      after.page === 0 && after.view === viewA, JSON.stringify(after));

    // 既存自動スクロール(v146)との共存確認: 今日表示中は次の未着手Blockへ(またはタイムライン/exec実績
    // モードなら現在時刻ラインへ)50ms後にscrollIntoViewする。リセット(0)の直後にこの既存挙動が
    // 上書きされずに発火し続けることを確認する(条件待ち、固定sleepなし)。viewAは両シナリオとも
    // この配線を持つビュー(tasks/exec)を使う。
    await page.waitForFunction(() => document.scrollingElement.scrollTop > 0, null, { timeout: 2000 });
    const afterAutoScroll = await scrollPos(page);
    check(`${width}px: リセット後も既存の自動スクロール(v146)が従来どおり発火する`,
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
    await page.evaluate((view) => {
      const btn = document.createElement("button");
      btn.id = "v307-search-jump-probe";
      btn.dataset.action = "search-jump";
      btn.dataset.view = view;
      document.body.appendChild(btn);
    }, viewB);
    after = await clickAndReadImmediately(page, "#v307-search-jump-probe");
    check(`${width}px: search-jump経路でもpageスクロールが0にリセットされる(setView()を経由しない切替の網羅)`,
      after.page === 0 && after.view === viewB, JSON.stringify(after));

    // search-jump後、着地したviewBがv146配線を持つビュー(tasks/timeline/exec)なら今日表示中に
    // 50ms後の既存自動スクロールが発火する。context.close()より前にこのタイマーを消化して
    // おかないと、close後にコールバックが破棄済みページへアクセスして例外になり、テスト
    // プロセス全体が不安定終了しうるため(条件待ちで消化する。固定sleepではない)。
    // viewBがv146配線を持たない(例: today)場合はタイマー自体が存在しないため待たない
    // (待つと発火せずタイムアウト例外になる)。
    if (VIEWS_WITH_AUTOSCROLL.has(viewB)) {
      await page.waitForFunction(() => document.scrollingElement.scrollTop > 0, null, { timeout: 2000 });
    }

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
    // v335: #sidebarは「実行」1項目のみになったため、tasks⇄timelineの代わりにexec⇄todayで検証する
    // (viewA=execはVIEWS_WITH_AUTOSCROLLに含まれ、リセット後の既存自動スクロール共存確認も従来どおり効く。
    // viewB=wbsは本テストのフィクスチャでは十分な高さが出ずscrollTop>100を満たせなかったため、
    // モバイルと同じtodayに揃えた)。
    console.log("[1] デスクトップ幅(1280x900、サイドバーnav。#sidebarは実行1項目に統合済み)");
    await runScenario(browser, { width: 1280, height: 900, navContainer: "#sidebar", viewA: "exec", viewB: "today" });

    // v333: #bottomNavは実行1項目(exec)のみになったため、モバイルはexec⇄todayで同じ観点を検証する。
    console.log("\n[2] モバイル幅(390x844、720px未満・ボトムnav。exec⇄today)");
    await runScenario(browser, { width: 390, height: 844, navContainer: "#bottomNav", viewA: "exec", viewB: "today" });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v307: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
