// v331 A-1a: 実行タブ(タスクシュート)Block行の1段化・「いま/これから」2段・
// 「やったこと」(完了Block)非表示・展開行(充放電/25分/編集/☆)。
// タスク一覧+ヘッダ統合(A-1b)は実行コード差分200行の都合で本バージョンでは対象外。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id = "p1") {
  return { id, title: "プロジェクトA", kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00` };
}
function task(id, extra = {}) {
  return { id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    dueDate: TODAY, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function block(id, taskId, extra = {}) {
  return { id, taskId, date: TODAY, title: id, category: "仕事",
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false, isMIT: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}

async function seed(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    Object.assign(current, values);
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const doing = block("b-doing", "t-doing", { actualStartAt: `${TODAY}T09:05:00` });
    const upA = block("b-up-a", "t-up-a", { plannedStartAt: `${TODAY}T11:00:00`, plannedEndAt: `${TODAY}T11:30:00`, isMIT: true });
    const upB = block("b-up-b", "t-up-b", { plannedStartAt: `${TODAY}T10:00:00`, plannedEndAt: `${TODAY}T10:20:00` });
    const done = block("b-done", "t-done", { completed: true, actualStartAt: `${TODAY}T08:00:00`, actualEndAt: `${TODAY}T08:30:00` });
    const tasks = [task("t-doing"), task("t-up-a"), task("t-up-b"), task("t-done")];

    console.log("[1] いま→これから(開始予定昇順)の並び順・件数、完了Blockが出ない");
    await seed(page, {
      currentView: "tasks", selectedDate: TODAY,
      projects: [project()], tasks, blocks: [doing, upA, upB, done]
    });
    const rowIds = await page.$$eval(".exec-row", (els) => els.map((el) => {
      const checkbox = el.querySelector("[data-action='toggle-block']");
      return checkbox ? checkbox.getAttribute("data-id") : null;
    }));
    check("行順は いま(b-doing) → これから(b-up-b→b-up-a、開始予定昇順)",
      JSON.stringify(rowIds) === JSON.stringify(["b-doing", "b-up-b", "b-up-a"]), JSON.stringify(rowIds));
    const bodyText = await page.textContent("body");
    check("完了Block(b-done)のタイトルはDOMに出ない", !bodyText.includes("b-done"));
    check("いまセクションの見出しがある", bodyText.includes("いま"));
    check("これからセクションの見出しがある", bodyText.includes("これから"));

    console.log("[2] 常時要素は☐/タイトル/meta/▶開始のみ、行タップで展開、別行タップで前が閉じる、state非書込");
    const upARow = page.locator(".exec-row-upcoming", { has: page.locator('[data-id="b-up-a"]') }).first();
    check("展開前は充放電selectが無い", await page.locator('.exec-row-expand[data-id]').count() === 0);
    check("▶開始ボタンがある(b-up-a行)",
      await page.locator('.exec-row-upcoming:has([data-id="b-up-a"]) [data-action="now-start"]').count() > 0);
    const beforeState = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.click('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-copy');
    await page.waitForSelector('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-expand');
    check("b-up-a行の展開に充電/放電select・25分・編集・☆がある",
      await page.locator('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-expand [data-block-field="charge"]').count() === 1
      && await page.locator('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-expand [data-action="start-pomodoro"]').count() === 1
      && await page.locator('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-expand [data-action="edit-block"]').count() === 1
      && await page.locator('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-expand [data-action="toggle-mit"]').count() === 1);
    await page.click('.exec-row-upcoming:has(strong:has-text("b-up-b")) .exec-row-copy');
    await page.waitForSelector('.exec-row-upcoming:has(strong:has-text("b-up-b")) .exec-row-expand');
    check("別行(b-up-b)をタップするとb-up-aの展開は閉じる",
      await page.locator('.exec-row-upcoming:has(strong:has-text("b-up-a")) .exec-row-expand').count() === 0);
    const afterState = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("展開トグルはlocalStorage(state)を書き換えない", beforeState === afterState);

    console.log("[2.5] フォントサイズ: 実行タブ全テキスト11px以上(展開行を開いた状態を含む)・展開行の充放電select 16px以上");
    // v331修正(発注D-(6)(2)の機械的検証を追加): この時点でb-up-b行が展開済み(直前のクリックで開いた)。
    const smallText = await page.evaluate(() => {
      // #appはapp-shell全体(サイドバー・timeline-railを含む)なので、実行タブの描画先
      // #main(.main-pane)だけをスコープにする(サイドバー等は本発注の対象外)。
      const root = document.querySelector("#main") || document.querySelector("#app") || document.body;
      const out = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        const hasDirectText = Array.from(node.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim().length > 0);
        if (hasDirectText) {
          const fontSize = parseFloat(getComputedStyle(node).fontSize);
          if (Number.isFinite(fontSize) && fontSize < 11) {
            out.push({ tag: node.tagName, cls: node.className, fontSize, text: node.textContent.trim().slice(0, 30) });
          }
        }
        node = walker.nextNode();
      }
      return out;
    });
    check("実行タブ(展開行を開いた状態を含む)の全テキスト要素がfont-size 11px以上", smallText.length === 0, JSON.stringify(smallText));
    const expandSelectFontSizes = await page.$$eval(".exec-row-expand .mini-select", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    check("展開行の充放電selectはfont-size 16px以上(iOS自動ズーム防止)",
      expandSelectFontSizes.length > 0 && expandSelectFontSizes.every((fontSize) => fontSize >= 16), JSON.stringify(expandSelectFontSizes));

    console.log("[3] ▶開始で「いま」へ移り、完了ボタンで消える");
    await page.click('.exec-row-upcoming:has(strong:has-text("b-up-b")) [data-action="now-start"]');
    await page.waitForSelector('[data-action="declare-skip"]');
    await page.click('[data-action="declare-skip"]');
    await page.waitForSelector('.exec-row-now:has(strong:has-text("b-up-b"))');
    check("b-up-bが「いま」に移動した",
      await page.locator('.exec-row-now [data-id="b-up-b"]').count() > 0);
    await page.click('.exec-row-now:has(strong:has-text("b-doing")) [data-action="toggle-block"]');
    await page.waitForFunction(() => !document.body.textContent.includes("見つからないダミー_v331"));
    const stillThere = await page.locator('.exec-row-now:has(strong:has-text("b-doing"))').count();
    check("完了操作したb-doingは「いま」から消える(実行中ではなくなる)", stillThere === 0);

    console.log("[4] 390px/1280px 横スクロールなし・pageerror 0");
    const scrollW390 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW390 = await page.evaluate(() => document.documentElement.clientWidth);
    check("390pxで横スクロールが発生しない", scrollW390 <= clientW390 + 1, `${scrollW390} vs ${clientW390}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(50);
    const scrollW1280 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW1280 = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280pxで横スクロールが発生しない", scrollW1280 <= clientW1280 + 1, `${scrollW1280} vs ${clientW1280}`);
    check("pageerrorが0件", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v331 ALL PASS" : `\n❌ v331: ${failures} 件失敗`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
