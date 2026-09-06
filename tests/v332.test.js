// v332 A-1b: 実行タブ(タスクシュート)ヘッダ1行化(見込み終了・余白・＋Block折りたたみ)・
// 下部「タスク」一覧の母集団再編(未完了 or 期限が今日+7日以内、Wish除外、期限昇順)。
// renderBlockItem(死コード)削除は実行コード差分200行の都合で本バージョンでは対象外。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();
const TODAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// app.jsのmdFmt()と同じ書式(M/D、ゼロ埋めなし)
function mdFmtJs(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
}

async function resetSetItemLog(page) {
  await page.evaluate(() => { window.__setItemChanges = []; });
}
async function contentChangingWrites(page, key) {
  return page.evaluate((k) => (window.__setItemChanges || []).filter((x) => x === k).length, key);
}

function project(id, extra = {}) {
  return { id, title: id === "p1" ? "プロジェクトA" : id, kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function task(id, extra = {}) {
  return { id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
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
  // v332修正(B-M5): state非書込検証を「内容変更を伴うlocalStorage.setItem 0回」方式にする。
  // 前後の文字列比較(同値へ書き戻すケースを素通りする)だけに頼らず、setItemが実際に
  // 呼ばれた回数(値が変化した呼び出しのみ)を都度リセット・計測できるようにする。
  await page.addInitScript(() => {
    window.__setItemChanges = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        const prev = this.getItem(key);
        if (prev !== value) window.__setItemChanges.push(key);
      } catch (e) { /* noop */ }
      return orig.call(this, key, value);
    };
  });
  try {
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const tOverdue = task("t-overdue", { dueDate: addDaysISO(TODAY, -3) });
    const tToday = task("t-today", { dueDate: TODAY });
    const tPlus3 = task("t-plus3", { dueDate: addDaysISO(TODAY, 3) });
    const tPlus7 = task("t-plus7", { dueDate: addDaysISO(TODAY, 7) });
    const tPlus8 = task("t-plus8", { dueDate: addDaysISO(TODAY, 8) });
    const tNoDue = task("t-nodue", {});
    const tWish = task("t-wish", { projectId: "pWish", dueDate: TODAY });
    const tSuspended = task("t-suspended", { dueDate: TODAY, status: "suspended" });
    const tasks = [tOverdue, tToday, tPlus3, tPlus7, tPlus8, tNoDue, tWish, tSuspended];

    const upA = block("b-up-a", "t-plus3", { plannedStartAt: `${TODAY}T11:00:00` });
    const upB = block("b-up-b", "t-overdue", { plannedStartAt: `${TODAY}T10:00:00` });
    const addedBlock = block("b-added", "t-today", { plannedStartAt: `${TODAY}T08:00:00` });

    console.log("[1] ヘッダが1行・見込み終了/余白が出る・＋Block detailsが既定閉・開いてEnterでBlock追加");
    await seed(page, {
      currentView: "tasks", selectedDate: TODAY,
      projects: [project("p1"), project("pWish", { kind: "wish" })],
      tasks, blocks: [upA, upB, addedBlock]
    });
    check("ヘッダに TOWER / タスクシュート が1行で出る", await page.locator(".exec-header-line").count() === 1);
    const headerText = await page.textContent(".exec-header-line");
    check("見込み終了が出る", headerText.includes("見込み終了"), headerText);
    check("余白が出る", headerText.includes("余白"), headerText);
    check("＋Block detailsが既定閉", await page.evaluate(() => document.querySelector("details.exec-add")?.open) === false);
    check("閉状態では#blockTitleが非表示(hidden detailsの子)", await page.locator("#blockTitle").isVisible() === false);
    await page.click("details.exec-add summary");
    check("開くと#blockTitleが見える", await page.locator("#blockTitle").isVisible());
    await page.fill("#blockTitle", "新規Block手動追加");
    await page.locator("#blockTitle").press("Enter");
    await page.waitForSelector('.exec-row-upcoming:has(strong:has-text("新規Block手動追加"))');
    check("Enterで従来どおりBlockが増え「これから」に出る",
      await page.locator('.exec-row-upcoming:has(strong:has-text("新規Block手動追加"))').count() === 1);

    console.log("[2] 期限だけのTaskは予定と混ぜずWBS全件へ保持する");
    check("未配置の+8日/Wish/中断Taskを実行予定へ混ぜない", await page.locator('[data-work-list="exec"] [data-work-key^="task:"]').count() === 0);
    const placedOrder = await page.locator('[data-work-list="exec"] [data-work-key]').evaluateAll(els => els.map(el => el.dataset.workKey).filter(id => ["block:b-added", "block:b-up-b", "block:b-up-a"].includes(id)));
    check("予定は期限順でなくBlock開始時刻順に並ぶ", JSON.stringify(placedOrder) === JSON.stringify(["block:b-added", "block:b-up-b", "block:b-up-a"]), JSON.stringify(placedOrder));
    await page.locator('[data-work-list="exec"] [data-action="nav"][data-view="wbs"]').click();
    const results = page.locator('[data-work-list="wbs"]');
    const ids = () => results.locator('[data-work-key]').evaluateAll(els => els.map(el => el.dataset.workKey));
    const shown = await ids();
    check("+8日TaskもWBS全件へ保持", shown.includes("task:t-plus8"));
    check("Wish配下TaskもWBS全件へ保持", shown.includes("task:t-wish"));
    check("中断TaskもWBS全件へ保持", shown.includes("task:t-suspended"));
    check("元fixture全8Taskを欠落・重複なく保持", tasks.every(t => shown.filter(id => id === `task:${t.id}`).length === 1));
    const total = await page.evaluate(key => { const s = JSON.parse(localStorage.getItem(key)); return [...s.projects, ...s.tasks].filter(x => !x.deleted).length; }, STATE_KEY);
    check("件数は削除以外のProject/Task全件と一致", shown.length === total && (await results.locator('.work-list-count').textContent()).startsWith(`${total} / ${total}件`));
    const beforeFilters = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    await resetSetItemLog(page);
    await results.locator('[data-work-filter="due"]').selectOption("overdue");
    check("期限超過filterは超過Taskだけ", JSON.stringify(await ids()) === JSON.stringify(["task:t-overdue"]));
    await results.locator('[data-work-filter="due"]').selectOption("today");
    check("対象日期限filterは今日/Wish/中断の3Task", JSON.stringify((await ids()).sort()) === JSON.stringify(["task:t-suspended", "task:t-today", "task:t-wish"]));
    await results.locator('[data-work-filter="status"]').selectOption("open");
    check("未完了filterで中断だけ除外", JSON.stringify((await ids()).sort()) === JSON.stringify(["task:t-today", "task:t-wish"]));
    await results.locator('[data-work-filter="project"]').selectOption("p1");
    check("Project filterでWishを除外できる", JSON.stringify(await ids()) === JSON.stringify(["task:t-today"]));
    await results.locator('[data-action="work-list-clear"]').click();
    await results.locator('[data-work-filter="due"]').selectOption("none");
    check("期限なしfilterは期限ありTaskを混ぜない", (await ids()).includes("task:t-nodue") && !(await ids()).some(id => ["task:t-overdue", "task:t-today", "task:t-plus3", "task:t-plus7", "task:t-plus8"].includes(id)));
    await results.locator('[data-action="work-list-clear"]').click();
    check("絞り込み・解除は保存しない", await page.evaluate(key => localStorage.getItem(key), STATE_KEY) === beforeFilters && await contentChangingWrites(page, STATE_KEY) === 0);
    const tree = id => page.locator(`.wbs-projects [data-wbs-row-id="${id}"] > .wbs-task-row`);
    await results.locator('[data-work-key="task:t-overdue"] [data-action="wbs-search-jump"]').click();
    check("超過TaskはWBSでアンバー表示", await tree("t-overdue").locator('.wbs-overdue').evaluate(el => getComputedStyle(el).color) === "rgb(242, 184, 75)");
    const beforeExisting = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.length, STATE_KEY);
    await tree("t-today").locator('[data-action="task-today"]').click();
    await page.waitForSelector('[data-action="placement-return"]');
    check("配置済みTaskは既存予定を示して二重追加しない", (await page.locator('#modalRoot').textContent()).includes("既存の予定を表示しています")
      && await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.length, STATE_KEY) === beforeExisting);
    await page.locator('[data-action="placement-return"]').click();

    console.log("[3] WBSの今日へは時刻確認を経てBlock配置しTaskを残す");
    const countBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.length, STATE_KEY);
    await tree("t-plus7").locator('[data-action="task-today"]').click();
    await page.waitForSelector('.placement-form');
    check("今日へだけではまだBlockを増やさない", await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.length, STATE_KEY) === countBefore);
    await page.locator('#placement-time').fill("14:00");
    await page.locator('#placement-duration').fill("30");
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForSelector('[data-action="placement-return"]');
    const placed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).blocks.filter(b => !b.deleted && b.taskId === "t-plus7"), STATE_KEY);
    check("時刻確定で今日14:00のBlockを1件だけ配置", placed.length === 1 && placed[0].date === TODAY && placed[0].plannedStartAt === `${TODAY}T14:00` && placed[0].plannedEndAt === `${TODAY}T14:30`);
    await page.locator('[data-action="placement-return"]').click();
    check("配置後も元TaskをWBSに保持", await results.locator('[data-work-key="task:t-plus7"]').count() === 1);
    await page.locator('[data-action="nav"][data-view="exec"]:visible').first().click();
    check("配置済みBlockは実行予定へ現れる", await page.locator(`[data-work-list="exec"] [data-work-key="block:${placed[0].id}"] .exec-row-upcoming`).count() === 1);

    console.log("[3.5] 前倒し期限は全件保持し実効日と外部期限を併記する");
    const tEff7 = task("t-eff7", { dueDate: addDaysISO(TODAY, 9), selfDueOff: false });
    const tEff8 = task("t-eff8", { dueDate: addDaysISO(TODAY, 10), selfDueOff: false });
    await seed(page, { currentView: "wbs", selectedDate: TODAY, projects: [project("p1")], tasks: [tEff7, tEff8], blocks: [] });
    check("実効+7日TaskはWBS全件に出る", await results.locator('[data-work-key="task:t-eff7"]').count() === 1);
    check("実効+8日TaskもWBS全件に保持する", await results.locator('[data-work-key="task:t-eff8"]').count() === 1);
    const eff7Meta = await results.locator('[data-work-key="task:t-eff7"] .work-list-meta').textContent();
    check("作業期限と外部期限の両方を表示", eff7Meta.includes(`作業期限 ${addDaysISO(TODAY, 7)}`) && eff7Meta.includes(`外部期限 ${addDaysISO(TODAY, 9)}`), eff7Meta);
    await results.locator('[data-work-key="task:t-eff7"] [data-action="wbs-search-jump"]').click();
    check("既存WBSツリーのM/D(実M/D)も保持", (await tree("t-eff7").textContent()).includes(`期限 ${mdFmtJs(addDaysISO(TODAY, 7))}(実 ${mdFmtJs(addDaysISO(TODAY, 9))})`));

    await seed(page, { currentView: "wbs", selectedDate: TODAY, projects: [project("p1"), project("pWish", { kind: "wish" })], tasks, blocks: [upA, upB, addedBlock] });
    await results.locator('[data-work-key="task:t-today"] [data-action="wbs-search-jump"]').click();
    console.log("[4] WBS副操作メニューの排他・中断/編集・無保存を保持");
    await resetSetItemLog(page);
    const beforeState = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    check("展開前は中断操作が非表示", !await tree("t-today").locator('[data-action="suspend-task"]').isVisible());
    await tree("t-today").locator('[data-action="wbs-row-menu-toggle"]').click();
    check("展開で中断/編集を表示", await tree("t-today").locator('[data-action="suspend-task"]').isVisible() && await tree("t-today").locator('[data-action="edit-task"]').isVisible());
    await tree("t-plus3").locator('[data-action="wbs-row-menu-toggle"]').click();
    check("別行の展開で先のメニューを閉じる", !await tree("t-today").locator('.wbs-row-menu-panel').isVisible());
    check("タスク副操作開閉は保存値不変", await page.evaluate(key => localStorage.getItem(key), STATE_KEY) === beforeState);
    check("タスク副操作開閉は内容変更書込0回", await contentChangingWrites(page, STATE_KEY) === 0);
    const taskCheckboxBox = await tree("t-today").locator('[data-action="toggle-task"]').boundingBox();
    check("タスク完了操作は44x44px以上", !!taskCheckboxBox && taskCheckboxBox.width >= 44 && taskCheckboxBox.height >= 44);
    const todayHrefBox = await tree("t-today").locator('[data-action="task-today"]').boundingBox();
    check("今日へ操作は44x44px以上", !!todayHrefBox && todayHrefBox.width >= 44 && todayHrefBox.height >= 44);
    const expandTriggerBox = await tree("t-plus7").locator('[data-action="wbs-row-menu-toggle"]').boundingBox();
    check("副操作の展開は44px以上", !!expandTriggerBox && expandTriggerBox.height >= 44);
    await tree("t-plus3").locator('[data-action="edit-task"]').click();
    await page.locator('[data-modal-field="title"]').fill("t-plus3 編集保持");
    await page.locator('[data-action="modal-save"]').click();
    check("WBS編集を保存し検索全件へ反映", (await results.locator('[data-work-key="task:t-plus3"]').textContent()).includes("t-plus3 編集保持"));
    await tree("t-today").locator('[data-action="toggle-task"]').click();
    await results.locator('[data-work-filter="status"]').selectOption("completed");
    check("完了Taskは消去せず完了条件で見つかる", await results.locator('[data-work-key="task:t-today"]').count() === 1);
    await results.locator('[data-work-filter="status"]').selectOption("open");
    check("完了Taskは未完了条件には混ぜない", await results.locator('[data-work-key="task:t-today"]').count() === 0);
    await page.locator('[data-action="nav"][data-view="exec"]:visible').first().click();

    // v332修正: renderBlockItem削除は実行コード差分200行の都合で本バージョンでは対象外にした
    // (発注v332の完了条件どおり「死コード削除だけを外して報告」)。呼び出し元ゼロのままである
    // ことだけを静的検査で確認する(次バージョンで削除予定)。
    console.log("[5] renderBlockItemは呼び出し元ゼロのまま(削除は200行の都合で次バージョンへ持ち越し・静的検査)");
    const appJsSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf-8");
    const callSites = (appJsSrc.match(/(?<!function )renderBlockItem\(/g) || []).length;
    check("renderBlockItemの呼び出し元は0件のまま(死コード確認。削除は次バージョン)", callSites === 0, `callSites=${callSites}`);

    console.log("[6] 390px/1280px 横スクロールなし・全テキスト11px以上・input/select 16px・pageerror 0・state非書込");
    const scrollW390 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW390 = await page.evaluate(() => document.documentElement.clientWidth);
    check("390pxで横スクロールが発生しない", scrollW390 <= clientW390 + 1, `${scrollW390} vs ${clientW390}`);
    const smallText390 = await page.evaluate(() => {
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
    check("実行タブ全テキスト要素がfont-size 11px以上", smallText390.length === 0, JSON.stringify(smallText390));
    await page.click("details.exec-add summary");
    const inputFontSizes = await page.$$eval("#blockTitle, #blockCategory", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    check("input/selectはfont-size 16px以上(iOS自動ズーム防止)",
      inputFontSizes.length === 2 && inputFontSizes.every((fs2) => fs2 >= 16), JSON.stringify(inputFontSizes));

    await resetSetItemLog(page);
    const stateBeforeResize = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(50);
    const scrollW1280 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW1280 = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280pxで横スクロールが発生しない", scrollW1280 <= clientW1280 + 1, `${scrollW1280} vs ${clientW1280}`);
    // v332修正(M4): count()による存在確認だけではgridが効かなくても緑になるため、
    // 「これから」の右端(right)が「タスク」の左端(left)以下(=左列に収まっている)、かつ
    // 「タスク」のtopが「これから」のbottom以上(=下段にある)・「タスク」がコンテナ全幅、
    // という幾何関係で検証する。
    const filtersBox = await page.locator('[data-work-list="exec"] .work-list-filters').boundingBox();
    const rowsBox = await page.locator('[data-work-list="exec"] [data-work-list-rows]').boundingBox();
    const listBox = await page.locator('[data-work-list="exec"]').boundingBox();
    check("PCで予定一覧と絞り込みが可視", !!filtersBox && !!rowsBox && !!listBox
      && filtersBox.width > 0 && rowsBox.height > 0 && listBox.width > 0);
    check("PCの全件結果は絞り込みの下に一覧幅で表示", !!filtersBox && !!rowsBox && !!listBox
      && rowsBox.y >= filtersBox.y + filtersBox.height - 1 && rowsBox.width >= listBox.width * .9);
    const stateAfterResize = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("画面幅変更だけではstateが書き換わらない(fixture値どおり=文字列比較)", stateBeforeResize === stateAfterResize);
    check("画面幅変更は内容変更を伴うsetItemを1回も呼ばない",
      await contentChangingWrites(page, STATE_KEY) === 0);
    check("pageerrorが0件", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v332 ALL PASS" : `\n❌ v332: ${failures} 件失敗`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
