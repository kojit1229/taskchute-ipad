// v329 A-1b: WBS Project/Task行再構成と排他的な副操作メニュー。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-02";
const FIXED_NOW = new Date(2026, 8, 2, 10, 0, 0, 0);
async function tokenColor(page, selector, token) {
  return page.locator(selector).first().evaluate((root, name) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(root).getPropertyValue(name).trim();
    root.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}
function project(id, title, extra = {}) {
  return { id, kind: "normal", title, category: "開発", status: "active", priority: "中",
    description: "", dueDate: "", twelveWeekStartDate: "", showProgress: false, collapsed: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, deleted: false, ...extra };
}
function task(id, projectId, title, extra = {}) {
  return { id, projectId, parentTaskId: "", title, category: "開発", status: "todo",
    dueDate: "", selfDueOff: true, description: "", progressNum: 0, progressDen: 10, collapsed: false,
    criteriaRequest: false, planTarget: false, owner: "k", order: null,
    createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`, deleted: false, ...extra };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);
  const row = (id) => page.locator(`[data-work-key="task:${id}"]`);
  const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const cycle = project("p-cycle", "12WY Project", { twelveWeekStartDate: "2026-08-15" });
    const other = project("p-other", "その他 Project", { category: "仕事" });
    const wish = project("p-wish", "Wish", { kind: "wish", category: "回復" });
    const active = task("t-active", cycle.id, "期限超過 active", { status: "doing", dueDate: "2026-09-01", progressNum: 4 });
    const suspended = task("t-suspended", other.id, "中断 Task", { status: "suspended", description: "今週の内容: 非12WYでは表示しない" });
    const planParent = task("t-plan", cycle.id, "未着手 plan", { planTarget: true, dueDate: "2026-09-05" });
    const tasks = [
      task("t-done", cycle.id, "完了 Task", { status: "completed", dueDate: TODAY, progressNum: 10 }),
      active, suspended, planParent,
      task("t-sub", cycle.id, "サブ Task", { parentTaskId: active.id, description: `今週の内容： <b>${"今週の作業".repeat(15)}\r\n固定の手順` }),
      task("t-step", cycle.id, "12WY Step", { parentTaskId: planParent.id, owner: "k", order: 1000 })
    ];
    await page.evaluate(({ key, projects, tasks, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, { projects, tasks, tracks: [], trackMeasurements: [], blocks: [], currentView: "wbs", selectedDate: today });
      Object.assign(state.settings, { twelveWeekStartDate: "2026-08-15", showSuspended: true,
        wbsHideCompleted: false, wbsHideDoneProjects: false, wbsCompactMode: false,
        wbsCategoryFilter: "", wbsEditMode: false });
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, projects: [cycle, other, wish], tasks, today: TODAY });
    await page.reload();
    await page.waitForSelector('[data-work-key="task:t-active"]');

    const activeRow=row('t-active'),doneRow=row('t-done');
    check('Task row exposes completion, title, information, due/estimate and placement',
      await activeRow.locator('[data-action="toggle-task"]').isVisible() && await activeRow.locator('[data-action="edit-task"]').isVisible()
      && (await activeRow.locator('.work-list-meta').textContent()).includes('4/10') && await activeRow.locator('.work-task-due').isVisible()
      && await activeRow.locator('[data-action="placement-add-today"]').isVisible());
    check('Completed task retains completed checkbox and no placement',await doneRow.locator('[data-action="toggle-task"].done').count()===1 && await doneRow.locator('[data-action="placement-add-today"]').count()===0);
    check('Completed title keeps strikethrough',await doneRow.locator('[data-action="edit-task"]').evaluate(el=>getComputedStyle(el).textDecorationLine.includes('line-through')));
    const amber=await tokenColor(page,'.wbs-tower','--tower-amber');
    check('Overdue information retains amber treatment',await activeRow.locator('.work-list-meta').evaluate((el,amber)=>getComputedStyle(el).color===amber&&!/red|danger|error/i.test(el.className),amber));
    check('No obsolete status badges',await page.locator('.wbs-status-badge').count()===0);
    await page.setViewportSize({width:375,height:844});
    const memo=await row('t-sub').locator('.task-twy-memo').evaluateAll(els=>els.map(el=>{
      const css=getComputedStyle(el),box=el.getBoundingClientRect(),title=el.previousElementSibling.getBoundingClientRect();
      return {text:el.textContent,safe:!el.querySelector('b'),ellipsis:css.textOverflow==='ellipsis',singleLine:css.whiteSpace==='nowrap'&&box.height<20,belowTitle:box.top>=title.bottom,fits:box.right<=innerWidth,clipped:el.scrollWidth>el.clientWidth};
    }));
    check('12-week memo retains safe single-line ellipsis below title at 375px',memo.length===1&&memo[0].text===tasks.find(t=>t.id==='t-sub').description.split('\uff1a')[1].split('\r\n')[0].trim().slice(0,59)+'\u2026'&&['safe','ellipsis','singleLine','belowTitle','fits','clipped'].every(k=>memo[0][k]),JSON.stringify(memo));
    await page.setViewportSize({width:390,height:844});
    check('Empty/non-cycle memo remains absent',await row('t-active').locator('.task-twy-memo').count()===0&&await row('t-suspended').locator('.task-twy-memo').count()===0);
    check('Suspended row text opacity stays >= .7',await row('t-suspended').evaluate(root=>[...root.querySelectorAll('*')].filter(el=>el.getClientRects().length&&[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).every(el=>{
      let opacity=1;for(let current=el;current&&root.contains(current);current=current.parentElement)opacity*=Number(getComputedStyle(current).opacity);return opacity>=.7-Number.EPSILON;
    })));
    const before=await stored();
    for(const id of ['t-active','t-step']) {
      check('Direct subtask and edit entries: '+id,await row(id).locator('[data-action="add-subtask"]').isVisible()&&await row(id).locator('[data-action="edit-task"]').isVisible());
      check('Deferred/removed row actions absent: '+id,await row(id).locator('[data-action="toggle-criteria-request"],[data-action="toggle-plan-owner"],[data-action="move-plan-step"],[data-action="add-plan-step-below"],[data-wbs-progress],[data-wbs-edit]').count()===0);
    }
    check('Reading controls does not write state',JSON.stringify(await stored())===JSON.stringify(before));
    await activeRow.locator('[data-action="add-subtask"]').click();
    await page.locator('[data-modal-field="title"]').fill('Added subtask');await page.locator('[data-action="modal-save"]').click();
    check('Subtask saves parent and project through restored entry',(await stored()).tasks.filter(t=>t.parentTaskId==='t-active').length===2&&(await stored()).tasks.some(t=>t.title==='Added subtask'&&t.parentTaskId==='t-active'&&t.projectId==='p-cycle'));
    await activeRow.locator('[data-action="edit-task"]').click();await page.locator('[data-modal-field="status"]').selectOption('suspended');await page.locator('[data-action="modal-save"]').click();
    check('Task suspension persists through its editor',(await stored()).tasks.find(t=>t.id==='t-active').status==='suspended');
    check('Absent AI/owner/order actions leave values unchanged',(await stored()).tasks.find(t=>t.id==='t-active').criteriaRequest===false&&(await stored()).tasks.find(t=>t.id==='t-step').owner==='k'&&(await stored()).tasks.find(t=>t.id==='t-step').order===1000);
    for(const id of ['t-plan','t-suspended']) check('Cycle and non-cycle tasks have no inline input: '+id,await row(id).locator('input,select').count()===0);
    const cycleSummary=await page.locator('[data-work-group="p-cycle"] > summary').textContent();
    check('Cycle summary retains week, task count and progress',cycleSummary.includes('12\u9031\u8a08\u753b \u7b2c3\u9031')&&cycleSummary.includes('6/6')&&cycleSummary.includes('\u9032\u6357'));
    const shapes=[];
    for(const id of ['p-cycle','p-other']) {
      const chip=page.locator(`[data-action="wbs-select-project"][data-id="${id}"]`);if(await chip.getAttribute('aria-pressed')!=='true')await chip.click();
      const button=page.locator(`[data-work-group="${id}"] > summary [data-action="edit-project"]`);shapes.push(await button.boundingBox());
      await button.click();check('Project editor reached: '+id,await page.locator('[data-modal-field="title"]').inputValue()===[cycle,other].find(p=>p.id===id).title);await page.locator('#modalRoot [data-action="modal-close"]').first().click();
    }
    check('Cycle/non-cycle project edit has equal width and >=44px',shapes.every(b=>b&&b.width>=44&&b.height>=44)&&Math.abs(shapes[0].width-shapes[1].width)<.5,JSON.stringify(shapes));
    await page.locator('[data-work-group="p-other"] > summary [data-action="edit-project"]').click();
    await page.locator('[data-modal-field="status"]').selectOption('paused');await page.locator('[data-action="modal-save"]').click();
    check('Project suspension remains available via editor',(await stored()).projects.find(p=>p.id==='p-other').status==='paused');
    await page.locator('.wbs-add-menu > summary').click();
    check('Project task addition available through restored panel',await page.locator('#taskTitle').isVisible()&&await page.locator('#taskProject').isVisible()&&await page.locator('[data-action="add-task"]').isVisible());
    await page.locator('.wbs-add-menu > summary').click();

    async function quality(width) {
      await page.setViewportSize({ width, height: 900 });
      return page.locator(".wbs-tower").evaluate((root) => {
        const doc = document.scrollingElement || document.documentElement;
        const visible = [...root.querySelectorAll("*")].filter((el) => el instanceof HTMLElement && el.getClientRects().length
          && getComputedStyle(el).visibility !== "hidden");
        const textTooSmall = visible.filter((el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
          && parseFloat(getComputedStyle(el).fontSize) < 11).map((el) => el.className);
        const tapTooSmall = visible.filter((el) => el.matches("button, summary, input, select")
          && (el.getBoundingClientRect().height < 44 || (el.matches("button, summary") && el.getBoundingClientRect().width < 44)))
          .map((el) => { const box = el.getBoundingClientRect(); return `${el.tagName}.${el.className}:${box.width}x${box.height}`; });
        const widthOf = (selector) => root.querySelector(selector)?.getBoundingClientRect().width || 0;
        return { noOverflow: doc.scrollWidth <= innerWidth + 1, textTooSmall, tapTooSmall,
          layout: { header: widthOf(".wbs-header"), toolbar: widthOf(".wbs-toolbar"), menu: widthOf(".wbs-view-menu"), popover: widthOf(".wbs-view-popover"), options: widthOf(".wbs-view-options") } };
      });
    }
    const mobile = await quality(390);
    const desktop = await quality(1280);
    check("390px/1280pxで横スクロールなし", mobile.noOverflow && desktop.noOverflow, JSON.stringify({ mobile, desktop }));
    check("可視文字11px以上・タップ要素44px以上", !mobile.textTooSmall.length && !desktop.textTooSmall.length
      && !mobile.tapTooSmall.length && !desktop.tapTooSmall.length, JSON.stringify({ mobile, desktop }));
    check("pageerror 0", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (failures) { console.error(`\n❌ v329 A-1b: ${failures} failure(s)`); process.exit(1); }
  console.log("\n✅ v329 A-1b: all checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
