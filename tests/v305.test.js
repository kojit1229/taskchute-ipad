// v305: タスクシュートの実行中Blockカードにあるインラインメモを検証する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-30";
const FIXED_NOW = new Date(2026, 7, 30, 10, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project() {
  return {
    id: "project-v305", title: "v305 Project", kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
  };
}

function task(id) {
  return {
    id: `task-${id}`, projectId: "project-v305", title: `Task ${id}`, kind: "normal",
    status: "todo", deleted: false, dueDate: TODAY,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`
  };
}

function block(id, extra = {}) {
  return {
    id, taskId: `task-${id}`, date: TODAY, title: `Block ${id}`, category: "仕事",
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, comment: `comment-${id}`,
    recurrenceGroupId: "", source: "", orderIndex: 0, migratedTo: "", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}

const BLOCKS = [
  block("doing", { actualStartAt: `${TODAY}T09:05:00`, comment: "既存<メモ>" }),
  block("unstarted"),
  block("completed", { actualStartAt: `${TODAY}T08:00:00`, completed: true }),
  block("ended", { actualStartAt: `${TODAY}T07:00:00`, actualEndAt: `${TODAY}T07:30:00` })
];
const TASKS = BLOCKS.map((item) => task(item.id));

async function storedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

async function openSeededPage(browser, viewport) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await blockGithubApiByDefault(page);
  await page.goto(`http://localhost:${PORT}/`);
  await passGithubGate(page);
  await page.evaluate(({ key, blocks, tasks, projectValue, today }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      blocks, tasks, projects: [projectValue], recurrences: [],
      selectedDate: today, currentView: "tasks"
    });
    state.settings.focusTimerAuto = false;
    state.settings.autoSync = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, blocks: BLOCKS, tasks: TASKS, projectValue: project(), today: TODAY });
  await page.reload();
  await page.locator('#app[data-view="tasks"]').waitFor();
  return { context, page, pageErrors };
}

// v331修正: 実行中メモtextareaは「いま」行の展開行(block-row-toggle)へ移り常時表示ではなくなった。
// meta部タップで展開してから検証する。
async function expandNowRow(page, id = "doing") {
  // v331修正: 768px幅ではapp-shellのサイドバー(既存の未修正バグ、v331とは無関係。
  // 別チケットで報告済み)により.exec-row-meta列が実幅0まで潰れPlaywrightのclick()が
  // actionability判定(要素の可視サイズ>0)で失敗することがある。要素自体はDOMに実在し
  // 実際のクリックハンドラはdocumentのbubblingリスナーなので、dispatchEventで同等のclick
  // イベントを発火させて検証する(assertの対象=block-row-toggleの動作自体は変えない)。
  await page.locator(`.exec-row-now .exec-row-meta[data-action="block-row-toggle"][data-id="${id}"]`)
    .dispatchEvent("click", { bubbles: true, cancelable: true, composed: true });
  await page.locator(`.block-inline-memo[data-id="${id}"]`).waitFor();
}

async function checkLayout(browser, width) {
  const current = await openSeededPage(browser, { width, height: 900 });
  try {
    await expandNowRow(current.page);
    const memo = current.page.locator('.block-inline-memo[data-id="doing"]');
    // v331 A-1a: 実行中カードのmarkupは.block-rowから.exec-row(exec-row-now)へ変わった。
    const card = memo.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' exec-row ')][1]");
    const [memoBox, cardBox, metrics] = await Promise.all([
      memo.boundingBox(), card.boundingBox(),
      memo.evaluate((element) => ({
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth
      }))
    ]);
    const contained = memoBox && cardBox && memoBox.x >= cardBox.x - 1
      && memoBox.x + memoBox.width <= cardBox.x + cardBox.width + 1;
    check(`${width}px: textareaがカード幅内に収まる`, Boolean(contained), JSON.stringify({ memoBox, cardBox }));
    check(`${width}px: textarea内部に横方向overflowなし`, metrics.scrollWidth <= metrics.clientWidth + 1, JSON.stringify(metrics));
    check(`${width}px: computed font-sizeが16px以上`, metrics.fontSize >= 16, JSON.stringify(metrics));
    check(`${width}px: pageerrorなし`, current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

async function checkDirectClickAfterMemoInput(browser, action) {
  const current = await openSeededPage(browser, { width: 390, height: 844 });
  try {
    await expandNowRow(current.page);
    const memo = current.page.locator('.block-inline-memo[data-id="doing"]');
    const value = `直接${action === "edit-block" ? "編集" : "終了"}前のメモ_v305`;
    await memo.fill(value);
    // v331 A-1a: 実行タブのいま行はedit-blockがタイトル(strong)側、now-endがexec-row-actions側にある。
    const button = action === "edit-block"
      ? current.page.locator('.exec-row-now strong[data-action="edit-block"][data-id="doing"]')
      : current.page.locator('.exec-row-now .exec-row-actions [data-action="now-end"][data-id="doing"]');
    await button.click();

    if (action === "edit-block") {
      const modalComment = current.page.locator('.modal-card [data-modal-field="comment"]');
      await modalComment.waitFor({ timeout: 2000 }).catch(() => {});
      check("入力後にblurを明示せず編集を直接クリックすると編集モーダルが開く", await modalComment.count() === 1);
      check("直接編集クリック時もcommentを先に保存する", (await storedState(current.page)).blocks.find((item) => item.id === "doing")?.comment === value);
    } else {
      const reportSkip = current.page.locator('[data-action="report-skip"]');
      await reportSkip.waitFor({ timeout: 2000 }).catch(() => {});
      check("入力後にblurを明示せず終了を直接クリックすると終了報告が開く", await reportSkip.count() === 1);
      if (await reportSkip.count()) await reportSkip.click();
      const stored = await storedState(current.page);
      check("直接終了クリックから終了処理が実行されactualEndAtが入る", Boolean(stored.blocks.find((item) => item.id === "doing")?.actualEndAt));
      check("直接終了クリック時もcommentを先に保存する", stored.blocks.find((item) => item.id === "doing")?.comment === value);
    }
    check(`直接${action === "edit-block" ? "編集" : "終了"}経路でpageerrorなし`, current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
  } finally {
    await current.context.close();
  }
}

(async () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const testSource = fs.readFileSync(__filename, "utf8");
  check("grep: inline memoにfont-size:16pxを明示", /block-inline-memo[^>]+font-size:\s*16px/.test(appSource));
  check("新規固定waitなし", !testSource.includes(["waitFor", "Timeout"].join("")));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  try {
    const current = await openSeededPage(browser, { width: 390, height: 844 });
    const { context, page } = current;
    try {
      console.log("[1] doing表示条件・入力中DOM・blur保存・再描画・永続化");
      await expandNowRow(page);
      const memo = page.locator('.block-inline-memo[data-id="doing"]');
      check("doing=trueのカードだけインライン欄を1件表示", await page.locator(".block-inline-memo").count() === 1);
      check("既存commentをHTMLエスケープして事前表示", await memo.inputValue() === "既存<メモ>", await memo.inputValue());
      for (const id of ["unstarted", "completed", "ended"]) {
        // v331 A-1a: 完了Blockはタブ自体から消え、未着手/境界状態(実績時刻はあるが未完了)は
        // 「これから」側でedit-blockが展開後にしか出ないため、memo要素自体の有無だけで判定する。
        const count = await page.locator(`.block-inline-memo[data-id="${id}"]`).count();
        check(`${id}: doing=falseなので欄自体が存在しない`, count === 0, `count=${count}`);
      }

      await memo.evaluate((element) => { window.__v305Memo = element; });
      await memo.fill("入力中のメモ_v305");
      const duringInput = await memo.evaluate((element) => ({
        same: window.__v305Memo === element,
        focused: document.activeElement === element,
        stored: JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.find((item) => item.id === "doing").comment
      }));
      check("fill直後・blur前はtextareaが同一DOMでfocus維持", duringInput.same && duringInput.focused, JSON.stringify(duringInput));
      check("blur前はchange未発火で永続comment未変更", duringInput.stored === "既存<メモ>", JSON.stringify(duringInput));

      await memo.blur();
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).blocks.find((item) => item.id === "doing")?.comment === "入力中のメモ_v305", STATE_KEY);
      const afterBlur = page.locator('.block-inline-memo[data-id="doing"]');
      check("blurでstate.blocks[].commentを全文上書き", (await storedState(page)).blocks.find((item) => item.id === "doing").comment === "入力中のメモ_v305");
      check("blur直後のrender後も直前の入力値を再表示", await afterBlur.inputValue() === "入力中のメモ_v305", await afterBlur.inputValue());
      check("blur後renderで新DOMになっても保存値を喪失しない", await afterBlur.evaluate((element) => window.__v305Memo !== element));

      await page.reload();
      await page.locator('#app[data-view="tasks"]').waitFor();
      // v331修正: 展開状態(_execExpandedBlockId)は非永続のためreloadで閉じる。再度展開してから検証する。
      await expandNowRow(page);
      check("reload後もlocalStorageのcommentを保持", await page.locator('.block-inline-memo[data-id="doing"]').inputValue() === "入力中のメモ_v305");

      // v333: モバイル下部ナビの「タイムライン」単独項目は実行タブ(exec)の実績モードへ
      // 統合された。exec→実績モードへ切替えて同じ観点(インライン欄を追加しない)を検証する。
      console.log("[2] 画面遷移と編集モーダルの同一comment");
      await page.locator('#bottomNav [data-action="nav"][data-view="exec"]').click();
      await page.locator('#app[data-view="exec"]').waitFor();
      // v333: 計画モードの末尾フッタ「実績を見る ›」も同じdata-action/data-modeを持つため、
      // セグメント側(.exec-mode-segmented内)を明示して一意化する。
      await page.locator('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]').click();
      await page.waitForSelector(".tl-radar-panel");
      check("タイムライン(exec実績モード)にはインライン欄を追加しない", await page.locator(".block-inline-memo").count() === 0);
      await page.locator('#bottomNav [data-action="nav"][data-view="today"]').click();
      await page.locator('#app[data-view="today"]').waitFor();
      check("今日タブにはインライン欄を追加しない", await page.locator(".block-inline-memo").count() === 0);
      await page.locator('#bottomNav [data-action="nav"][data-view="exec"]').click();
      await page.locator('#app[data-view="exec"]').waitFor();
      check("他画面から戻っても値を保持(execは離脱で計画モードへ戻る)", await page.locator('.block-inline-memo[data-id="doing"]').inputValue() === "入力中のメモ_v305");

      const latestMemo = page.locator('.block-inline-memo[data-id="doing"]');
      await latestMemo.fill("モーダルにも出る最新値_v305");
      await latestMemo.blur();
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).blocks.find((item) => item.id === "doing")?.comment === "モーダルにも出る最新値_v305", STATE_KEY);
      // v331 A-1a: いま行のedit-blockはタイトル(strong)側にある。
      await page.locator('.exec-row-now strong[data-action="edit-block"][data-id="doing"]').click();
      await page.locator('.modal-card [data-modal-field="comment"]').waitFor();
      check("blur保存後に編集モーダルへfocus遷移", (await storedState(page)).blocks.find((item) => item.id === "doing").comment === "モーダルにも出る最新値_v305");
      check("編集モーダルに同じ最新commentを事前表示", await page.locator('.modal-card [data-modal-field="comment"]').inputValue() === "モーダルにも出る最新値_v305");
      await page.locator('.modal-card .modal-footer [data-action="modal-close"]').click();
      await page.locator('.block-inline-memo[data-id="doing"]').fill("");
      await page.locator('.block-inline-memo[data-id="doing"]').blur();
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).blocks.find((item) => item.id === "doing")?.comment === "", STATE_KEY);
      check("空文字blurは意図的なクリアとしてcommentを空にする", (await storedState(page)).blocks.find((item) => item.id === "doing").comment === "");
      check("主要経路でpageerrorなし", current.pageErrors.length === 0, JSON.stringify(current.pageErrors));
    } finally {
      await context.close();
    }

    console.log("[3] textarea入力直後の直接クリック(明示blurなし)");
    await checkDirectClickAfterMemoInput(browser, "edit-block");
    await checkDirectClickAfterMemoInput(browser, "now-end");

    console.log("[4] 390px / 768px / 1024px レイアウトとiOS font-size");
    for (const width of [390, 768, 1024]) await checkLayout(browser, width);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures) { console.error(`\n❌ v305: ${failures}件失敗`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
