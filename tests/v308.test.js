// v308 block/task render表示: 中間幅のBlockカードタイトルを1行ellipsisに固定する。
// WBSプロジェクト行の同名.title-line strongは従来どおり折り返せることも検証する。
const fs = require("fs");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-31";
const FIXED_NOW = new Date(2026, 7, 31, 10, 0, 0);
const BLOCK_ID = "block-v308";
const PROJECT_ID = "project-v308";
const BLOCK_TITLE = "中間幅でも一文字ずつ縦に折れず末尾省略される、とても長いBlockタイトル \"確認\" & <安全> ".repeat(8);
const WBS_TITLE = "WBSプロジェクト行は今回のスコープ外なので従来どおり複数行へ折り返せる長いタイトル ".repeat(10);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function seedItems() {
  return {
    project: {
      id: PROJECT_ID, title: WBS_TITLE, kind: "normal", status: "active", category: "仕事",
      deleted: false, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    },
    task: {
      id: "task-v308", projectId: PROJECT_ID, title: "v308 Task", kind: "normal",
      status: "todo", deleted: false, dueDate: TODAY,
      createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    },
    block: {
      id: BLOCK_ID, taskId: "task-v308", date: TODAY, title: BLOCK_TITLE, category: "仕事",
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
      charge: 0, discharge: 0, estimateMin: 30, comment: "", recurrenceGroupId: "",
      source: "", orderIndex: 0, migratedTo: "", deleted: false,
      createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    }
  };
}

async function openSeededPage(browser, width) {
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width, height: 900 }
  });
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
      blocks: [itemsValue.block], tasks: [itemsValue.task], projects: [itemsValue.project],
      recurrences: [], selectedDate: today, currentView: "tasks"
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    state.settings.wbsHideDoneProjects = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, itemsValue: items, today: TODAY });
  await page.reload();
  await page.locator('#app[data-view="tasks"]').waitFor();
  return { context, page, pageErrors };
}

// v331 A-1a: 実行タブのカードmarkupが.block-rowから.exec-rowへ変わった。「これから」行の
// タイトルstrongはdata-action/data-idを持たず、親の.exec-row-copy(data-action="block-row-toggle")
// 側にdata-idがあるため、そちら経由で選ぶ(「いま」行のstrongはedit-block/data-idを従来どおり持つ)。
async function blockTitleMetrics(page, selector = `.exec-row-copy[data-id="${BLOCK_ID}"] strong`) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    // line-heightが"normal"だとparseFloatがNaNになるため、font-sizeから1行分の上限目安を作る。
    const parsedLineHeight = parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : parseFloat(style.fontSize) * 1.6;
    // 「4chという宣言どおりの最低幅が本当に効いているか」を、同じフォントで実際に4ch幅の
    // プローブ要素を作って比較する(1pxや1ch等の別の小さい値でも緩いレンジチェックだけでは
    // PASSしてしまう指摘への対応)。
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute; visibility:hidden; white-space:nowrap; width:4ch;";
    probe.style.font = style.font;
    element.parentElement.appendChild(probe);
    const fourChPx = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      title: element.getAttribute("title"), text: element.textContent,
      offsetHeight: element.offsetHeight, lineHeight,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      minWidth: style.minWidth, fourChPx, flexGrow: style.flexGrow, flexShrink: style.flexShrink,
      overflowX: style.overflowX, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow
    };
  });
}

async function checkBlockWidth(browser, width) {
  const current = await openSeededPage(browser, width);
  try {
    const metrics = await blockTitleMetrics(current.page);
    check(`${width}px: Blockタイトルは内容が実幅を超える条件`,
      metrics.clientWidth > 0 && metrics.scrollWidth > metrics.clientWidth + 1, JSON.stringify(metrics));
    check(`${width}px: Blockタイトルの高さは1行分以内`,
      Number.isFinite(metrics.lineHeight) && metrics.offsetHeight <= metrics.lineHeight + 1, JSON.stringify(metrics));
    check(`${width}px: Block専用ellipsisのcomputed styleが有効(min-widthが宣言どおり4chと一致)`,
      // min-width:0だと同じ行内の他バッジと場所を奪い合いタイトルが実幅0まで潰れて
      // 完全に見えなくなる実害があったため、常に数文字分(4ch)は読める最低幅を確保している。
      // 緩いレンジ(0<x<60)だけだと1pxや1chへの回帰も検出できないため、実測4ch幅そのものと突き合わせる。
      // v331 A-1a: 行レイアウトがflexからCSS grid(.exec-row)へ変わったため、flexGrow/flexShrinkの
      // 代わりに実効挙動(min-width一致・overflow hidden・折り返しなし・ellipsis)で判定する。
      Math.abs(parseFloat(metrics.minWidth) - metrics.fourChPx) < 1
        && metrics.overflowX === "hidden" && metrics.whiteSpace === "nowrap"
        && metrics.textOverflow === "ellipsis", JSON.stringify(metrics));
    check(`${width}px: Blockタイトルは常に最低4ch分の表示幅を確保(実幅0で完全消失しない)`,
      metrics.clientWidth > 0 && metrics.clientWidth >= metrics.fourChPx - 1, JSON.stringify(metrics));
    check(`${width}px: title属性と本文はエスケープ後も元タイトルを保持`,
      metrics.title === BLOCK_TITLE && metrics.text === BLOCK_TITLE, JSON.stringify({ title: metrics.title, text: metrics.text }));
    check(`${width}px: pageerrorなし`, current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

const DOING_BLOCK_ID = "block-v308-doing";

function seedDoingItems() {
  return {
    project: {
      id: PROJECT_ID, title: WBS_TITLE, kind: "normal", status: "active", category: "仕事",
      deleted: false, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    },
    task: {
      id: "task-v308-doing", projectId: PROJECT_ID, title: "v308 Doing Task", kind: "normal",
      status: "doing", deleted: false, dueDate: TODAY,
      createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    },
    block: {
      // 実際にoffsetWidth=0の実害が起きたのは「時刻バッジ+着手中バッジ+カテゴリバッジ」が
      // 同時に.title-line内に並ぶ、実行中(is-doing)Blockのケースだった。この構成を明示的に再現する。
      id: DOING_BLOCK_ID, taskId: "task-v308-doing", date: TODAY, title: BLOCK_TITLE, category: "仕事",
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: `${TODAY}T09:00:00`, everStartedAt: `${TODAY}T09:00:00`, actualEndAt: "",
      completed: false, charge: 0, discharge: 0, estimateMin: 30, comment: "", recurrenceGroupId: "",
      source: "", orderIndex: 0, migratedTo: "", deleted: false,
      createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
    }
  };
}

async function checkDoingBadgesWidth(browser, width) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const items = seedDoingItems();
    await page.evaluate(({ key, itemsValue, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, {
        blocks: [itemsValue.block], tasks: [itemsValue.task], projects: [itemsValue.project],
        recurrences: [], selectedDate: today, currentView: "tasks"
      });
      state.settings.focusTimerAuto = false;
      state.settings.autoSync = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, itemsValue: items, today: TODAY });
    await page.reload();
    await page.locator('#app[data-view="tasks"]').waitFor();
    // v331 A-1a: 実行中(doing)Blockは「いま」行に描画され、タイトルstrongは従来どおり
    // data-action="edit-block"を持つ。
    const metrics = await blockTitleMetrics(
      page, `.exec-row-now strong[data-action="edit-block"][data-id="${DOING_BLOCK_ID}"]`
    );
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth
    }));
    check(`${width}px 着手中+MIT対象外+カテゴリの複合バッジ: タイトルが実幅0で完全消失しない`,
      metrics.clientWidth > 0 && metrics.clientWidth >= metrics.fourChPx - 1, JSON.stringify(metrics));
    check(`${width}px 複合バッジ: ページ全体が横スクロールを起こしていない`,
      overflow.scrollWidth <= overflow.innerWidth + 1, JSON.stringify(overflow));
    check(`${width}px 複合バッジ: pageerrorなし`, pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
  }
}

async function checkWbsUnchanged(browser) {
  const current = await openSeededPage(browser, 745);
  try {
    await current.page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "wbs";
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await current.page.reload();
    await current.page.locator('#app[data-view="wbs"]').waitFor();
    const metrics = await current.page.locator(`[data-wbs-row-id="${PROJECT_ID}"] .wbs-project-copy strong[data-id="${PROJECT_ID}"]`).evaluate((element) => {
      const style = getComputedStyle(element);
      const parsedLineHeight = parseFloat(style.lineHeight);
      const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : parseFloat(style.fontSize) * 1.6;
      return {
        offsetHeight: element.offsetHeight, lineHeight,
        minWidth: style.minWidth, flexGrow: style.flexGrow, overflowX: style.overflowX,
        overflowWrap: style.overflowWrap, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow
      };
    });
    check("745px: WBSプロジェクトタイトルは従来どおり複数行へ折り返す",
      Number.isFinite(metrics.lineHeight) && metrics.offsetHeight > metrics.lineHeight + 1, JSON.stringify(metrics));
    check("745px: Block専用ellipsis指定がWBSプロジェクト行へ波及しない",
      // v328でWBS見出しがgridセル内の display:block になり、min-width:auto の算出値は "0px" になる(Block専用の4chではない)。
      (metrics.minWidth === "auto" || metrics.minWidth === "0px") && metrics.flexGrow === "0" && metrics.overflowX === "visible"
        && metrics.overflowWrap === "anywhere" && metrics.whiteSpace === "normal"
        && metrics.textOverflow === "clip", JSON.stringify(metrics));
    check("745px WBS表示: pageerrorなし", current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

(async () => {
  const source = fs.readFileSync(__filename, "utf8");
  const css = fs.readFileSync(require("path").join(__dirname, "..", "styles.css"), "utf8");
  check("先頭コメントがplanning-executionとui-responsiveのdomain語を含む",
    /block|task/i.test(source.split(/\r?\n/).slice(0, 2).join(" "))
      && /render|表示/i.test(source.split(/\r?\n/).slice(0, 2).join(" ")));
  // v331 A-1a: ellipsisセレクタが.block-row .title-line strongから.exec-row-copy strong
  // (実行タブ.exec-row系markupのタイトル要素)へ移った。
  check("ellipsisセレクタは.exec-row-copy配下だけにスコープされる",
    /\.exec-row-copy\s+strong\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/s.test(css));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    console.log("[1] 1024px幅(Blockタイトル列が約330pxへ狭まる中間幅)");
    await checkBlockWidth(browser, 1024);
    console.log("\n[2] 745px幅(iPad Split View相当の中間幅)");
    await checkBlockWidth(browser, 745);
    console.log("\n[3] WBSプロジェクト行は非対象");
    await checkWbsUnchanged(browser);
    console.log("\n[4] 着手中バッジが同居する実際の実害パターンを390/745/1024pxで再現");
    for (const width of [390, 745, 1024]) {
      await checkDoingBadgesWidth(browser, width);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v308: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
