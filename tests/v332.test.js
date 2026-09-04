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

    console.log("[2] タスク母集団: +8日・Wish・suspendedが出ない、超過が先頭、期限なしが末尾、超過がアンバー、追加済みバッジがmetaに出る、件数表示が一致");
    const bodyText = await page.textContent("body");
    check("+8日タスクは出ない", !bodyText.includes("t-plus8"));
    check("Wish配下タスクは出ない", !bodyText.includes("t-wish"));
    check("suspendedタスクは出ない", !bodyText.includes("t-suspended"));
    const taskRowIds = await page.$$eval(".exec-task-row", (els) => els.map((el) => {
      const cb = el.querySelector('[data-action="toggle-task"]');
      return cb ? cb.getAttribute("data-id") : null;
    }));
    check("超過が先頭・期限なしが末尾の期限順(超過→今日→+3→+7→期限なし)",
      JSON.stringify(taskRowIds) === JSON.stringify(["t-overdue", "t-today", "t-plus3", "t-plus7", "t-nodue"]),
      JSON.stringify(taskRowIds));
    const overdueRowClass = await page.locator('.exec-task-row:has([data-id="t-overdue"])').first().locator(".exec-row-meta").getAttribute("class");
    check("超過タスクのmetaにexec-task-overdueが付く(赤ではなくアンバー)", (overdueRowClass || "").includes("exec-task-overdue"));
    const todayMeta = await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) .exec-row-meta').textContent();
    check("当日Block追加済みタスクのmetaに追加済みバッジが出る", todayMeta.includes("本日 1 件 Block 追加済み"), todayMeta);
    const headingText = await page.locator(".exec-tasks-sub").textContent();
    check("見出しの件数がタスク行数(5件)と一致", headingText.includes("5件"), headingText);

    console.log("[3] 今日へ でBlockが増え「これから」に出る、Task行は残る(v112契約)");
    await page.click('.exec-task-row:has([data-action="toggle-task"][data-id="t-plus7"]) [data-action="task-today"]');
    await page.waitForSelector('.exec-row-upcoming:has(strong:has-text("t-plus7"))');
    check("今日へでBlockが「これから」に増える", await page.locator('.exec-row-upcoming:has(strong:has-text("t-plus7"))').count() === 1);
    check("Task行(t-plus7)はタスク一覧に残る(v112契約)",
      await page.locator('.exec-task-row [data-action="toggle-task"][data-id="t-plus7"]').count() === 1);

    console.log("[3.5] 期限表示: selfDueOff:falseの前倒し境界(+9日→実効+7日で出る/+10日→実効+8日で出ない)。WBSと同じM/D(実 M/D)併記");
    const tEff7 = task("t-eff7", { dueDate: addDaysISO(TODAY, 9), selfDueOff: false });
    const tEff8 = task("t-eff8", { dueDate: addDaysISO(TODAY, 10), selfDueOff: false });
    await seed(page, {
      currentView: "tasks", selectedDate: TODAY,
      projects: [project("p1")],
      tasks: [tEff7, tEff8], blocks: []
    });
    check("selfDueOff:false・dueDate+9日(実効+7日)は一覧に出る",
      await page.locator('.exec-task-row [data-action="toggle-task"][data-id="t-eff7"]').count() === 1);
    check("selfDueOff:false・dueDate+10日(実効+8日)は一覧に出ない",
      await page.locator('.exec-task-row [data-action="toggle-task"][data-id="t-eff8"]').count() === 0);
    const eff7Meta = await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-eff7"]) .exec-row-meta').first().textContent();
    const expectedEffDate = mdFmtJs(addDaysISO(TODAY, 7));
    const expectedRealDate = mdFmtJs(addDaysISO(TODAY, 9));
    check("期限表示はWBSと同じ「期限 M/D(実 M/D)」併記(前倒し日+実期日)",
      eff7Meta.includes(`期限 ${expectedEffDate}(実 ${expectedRealDate})`), eff7Meta);

    // [1]〜[3]のfixtureへ戻す(以降のstate非書込・44px検証は元のtasksセットで行う)
    await seed(page, {
      currentView: "tasks", selectedDate: TODAY,
      projects: [project("p1"), project("pWish", { kind: "wish" })],
      tasks, blocks: [upA, upB, addedBlock]
    });

    console.log("[4] 行タップで中断/編集が出て別行タップで閉じる、開閉がstate/localStorageに書かれない(内容変更を伴うsetItem0回)");
    await resetSetItemLog(page);
    const beforeState = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("展開前は中断/編集ボタンが無い(t-today行)",
      await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) [data-action="suspend-task"]').count() === 0);
    await page.click('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) .exec-row-copy');
    await page.waitForSelector('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) .exec-row-expand');
    check("t-today行に中断/編集が出る",
      await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) [data-action="suspend-task"]').count() === 1
      && await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) [data-action="edit-task"]').count() === 1);
    await page.click('.exec-task-row:has([data-action="toggle-task"][data-id="t-plus3"]) .exec-row-copy');
    await page.waitForSelector('.exec-task-row:has([data-action="toggle-task"][data-id="t-plus3"]) .exec-row-expand');
    check("別行(t-plus3)をタップするとt-todayの展開は閉じる",
      await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) .exec-row-expand').count() === 0);
    const afterState = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("タスク行の展開トグルはlocalStorage(state)を書き換えない(fixture値どおり=文字列比較)", beforeState === afterState);
    check("タスク行の展開トグルは内容変更を伴うsetItemを1回も呼ばない",
      await contentChangingWrites(page, STATE_KEY) === 0);

    console.log("[4.5] タスク行の☐(checkbox-button)が44x44px以上(タップ領域)");
    const taskCheckboxBox = await page.locator('.exec-task-row [data-action="toggle-task"][data-id="t-today"]').boundingBox();
    check("タスク行☐が44x44px以上", Boolean(taskCheckboxBox) && taskCheckboxBox.width >= 44 && taskCheckboxBox.height >= 44,
      JSON.stringify(taskCheckboxBox));
    const todayHrefBox = await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-today"]) [data-action="task-today"]').boundingBox();
    check("「今日へ」ボタンが44x44px以上", Boolean(todayHrefBox) && todayHrefBox.width >= 44 && todayHrefBox.height >= 44,
      JSON.stringify(todayHrefBox));
    const expandTriggerBox = await page.locator('.exec-task-row:has([data-action="toggle-task"][data-id="t-plus7"]) .exec-row-copy').boundingBox();
    check("展開トリガー(.exec-row-copy)の高さが44px以上", Boolean(expandTriggerBox) && expandTriggerBox.height >= 44,
      JSON.stringify(expandTriggerBox));

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
    const upcomingBox = await page.locator(".exec-lower .exec-upcoming-section").boundingBox();
    const tasksBox = await page.locator(".exec-lower .exec-tasks-section").boundingBox();
    const lowerBox = await page.locator(".exec-lower").boundingBox();
    check("PC(1280px)で「これから」セクションが左列にある(全幅の半分以下)",
      Boolean(upcomingBox) && Boolean(lowerBox) && upcomingBox.width <= lowerBox.width * 0.6,
      JSON.stringify({ upcomingBox, lowerBox }));
    check("PC(1280px)で「タスク」セクションが下段(これからのbottom以上)・全幅にある",
      Boolean(tasksBox) && Boolean(upcomingBox) && Boolean(lowerBox)
      && tasksBox.y >= upcomingBox.y + upcomingBox.height - 1
      && tasksBox.width >= lowerBox.width * 0.95,
      JSON.stringify({ tasksBox, upcomingBox, lowerBox }));
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
