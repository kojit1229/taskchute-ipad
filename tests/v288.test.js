// v288: WBS内Project/Task検索と、新規Projectの既定collapsed=true。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault,
  passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-28";
const OLD_MODIFIED = "2026-08-01T00:00:00";
const FIXED_NOW = new Date(2026, 7, 28, 10, 0, 0);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, title, extra = {}) {
  return {
    id, kind: "normal", title, category: "仕事", status: "active", priority: "中",
    description: "", dueDate: "", twelveWeekStartDate: "", showProgress: false,
    collapsed: false, createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`,
    deleted: false, ...extra
  };
}

function task(id, projectId, title, extra = {}) {
  return {
    id, projectId, parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", progressNum: 0, progressDen: 10, collapsed: false,
    createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`,
    deleted: false, ...extra
  };
}

async function stateNow(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

async function seed(page, values = {}) {
  await page.evaluate(({ key, values, today, oldModified }) => {
    const state = JSON.parse(localStorage.getItem(key));
    Object.assign(state, {
      projects: values.projects || [], tasks: values.tasks || [], blocks: [], recurrences: [],
      tracks: values.tracks || [], trackMeasurements: values.trackMeasurements || [],
      currentView: "wbs", selectedDate: today, dataModifiedAt: oldModified
    });
    state.settings = {
      ...state.settings, showSuspended: false, wbsHideCompleted: false,
      wbsCategoryFilter: "", wbsEditMode: false, twelveWeekStartDate: "",
      ...(values.settings || {})
    };
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, values, today: TODAY, oldModified: OLD_MODIFIED });
  await page.reload();
  await page.locator('[data-work-list="wbs-projects"]').waitFor();
}

async function installSpies(page) {
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    window.__v288StateWrites = 0;
    Storage.prototype.setItem = function patchedSetItem(k, value) {
      if (k === key) window.__v288StateWrites += 1;
      return original.call(this, k, value);
    };
    window.__v288Scrolled = null;
    Element.prototype.scrollIntoView = function scrollSpy(options) {
      window.__v288Scrolled = { id: this.dataset.wbsRowId || "", options };
    };
  }, STATE_KEY);
}

const rootSelector = '[data-work-list="wbs"]';
const taskKeys = page => page.locator(rootSelector + ' [data-work-key]').evaluateAll(els => els.map(el => el.dataset.workKey));
const search = (page, query) => page.locator(rootSelector + ' [data-work-filter="query"]').fill(query);
const selectProject = async (page, id) => {
  const chip = page.locator(rootSelector + ` [data-action="wbs-select-project"][data-id="${id}"]`);
  if(await chip.getAttribute('aria-pressed') !== 'true') await chip.click();
};
async function verifySearchAndDebounce(page) {
  const p = project('p-search', 'ALPHA project');
  await seed(page, { projects: [p, project('p-xss', '<img src=x onerror=alert(1)>', {category:''}), project('p-deleted', 'Deleted', { deleted: true })],
    tasks: [task('t-alpha', p.id, 'alpha title'), task('t-deleted', p.id, 'Deleted', { deleted: true }), task('t-orphan', 'p-deleted', 'Deleted parent')] });
  await selectProject(page, p.id);
  check('Empty query retains live task and excludes deleted tasks/projects', JSON.stringify(await taskKeys(page)) === '["task:t-alpha"]' && await page.locator('[data-action="wbs-select-project"][data-id="p-deleted"]').count() === 0);
  for (const query of ['a', 'ALPHA', 'alpha']) {
    await search(page, query);
    check('Case-insensitive partial title query: ' + query, JSON.stringify(await taskKeys(page)) === '["task:t-alpha"]');
  }
  const xss = page.locator('[data-action="wbs-select-project"][data-id="p-xss"]');
  check('Project title escaped as text', (await xss.textContent()).includes('<img') && await xss.locator('img').count() === 0);
  for (const [id,category] of [['p-search',p.category],['p-xss','']]) {
    await search(page,''); await selectProject(page,id);
    await page.locator(`[data-work-group="${id}"] > summary [data-action="edit-project"]`).click();
    check('Project category retained in editor: '+id,await page.locator('[data-modal-field="category"]').inputValue()===category);
    await page.locator('#modalRoot [data-action="modal-close"]').first().click();
  }
  await search(page, 'absent');
  check('Zero matches retain input and show no task rows', (await taskKeys(page)).length === 0 && await page.locator(rootSelector + ' [data-work-filter="query"]').inputValue() === 'absent');
  check('Zero-match guidance remains visible',(await page.locator(rootSelector+' [data-work-list-rows]').textContent()).includes('\u8a72\u5f53\u3059\u308b\u30bf\u30b9\u30af\u306f\u3042\u308a\u307e\u305b\u3093\u3002'));
  await page.locator('#bottomNav [data-view="exec"]').click();
  check('Live task under deleted project remains reachable from execution candidates',await page.locator('[data-work-list="exec-candidates"] [data-work-key="task:t-orphan"]').count()===1 && await page.locator('[data-work-list="exec-candidates"] [data-work-key="task:t-deleted"]').count()===0);
  const projects = Array.from({length:51}, (_,i) => project('p-limit-' + i, 'Project ' + i));
  await seed(page, {projects, tasks: projects.map((p,i) => task('t-limit-' + i, p.id, 'limit task ' + i))});
  await search(page, 'limit');
  check('All 51 matching task rows in original order', JSON.stringify(await taskKeys(page)) === JSON.stringify(projects.map((_,i) => 'task:t-limit-' + i)));
  check('All 51 projects retain one chip', await page.locator('[data-action="wbs-select-project"][data-id^="p-limit-"]').count() === 51);
  await installSpies(page);
  const before = await stateNow(page);
  await page.evaluate(() => {
    const input = document.querySelector('#wbs-projects-query'); window.__v288InputNode = input; input.focus();
    for (const text of ['limit', 'limit task']) { input.value = text; input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text})); }
  });
  check('Continuous input preserves node/focus', await page.evaluate(() => document.activeElement === window.__v288InputNode && document.querySelector('#wbs-projects-query') === window.__v288InputNode));
  check('Search makes no storage write or state change', await page.evaluate(() => window.__v288StateWrites) === 0 && JSON.stringify(await stateNow(page)) === JSON.stringify(before));
}
async function verifyJumpPaths(page) {
  const p = project('p-tree', 'Tree', {collapsed:true});
  const tasks = [task('root',p.id,'Root',{collapsed:true}), task('child',p.id,'Child',{parentTaskId:'root',collapsed:true}), task('grand',p.id,'Grand',{parentTaskId:'child'})];
  await seed(page,{projects:[p],tasks});
  await selectProject(page,p.id); await installSpies(page); const before = await stateNow(page);
  for (const [query,expected] of [['Root',['root']],['Child',['root','child']],['Grand',['root','child','grand']]]) {
    await search(page,query);
    check('Matching row retains only required ancestors: '+query, JSON.stringify(await taskKeys(page)) === JSON.stringify(expected.map(id=>'task:'+id)));
    const target=page.locator(`[data-work-key="task:${expected.at(-1)}"]`); await target.scrollIntoViewIfNeeded();
    check('Target is visible: '+query, await target.isVisible());
  }
  check('Search and selection preserve collapsed/timestamps and all saved state', await page.evaluate(()=>window.__v288StateWrites)===0 && JSON.stringify(await stateNow(page))===JSON.stringify(before));
  const paused=project('p-paused','Paused',{status:'paused'});
  await seed(page,{projects:[paused],tasks:[task('paused-task',paused.id,'Paused task')]});
  await selectProject(page,paused.id);
  check('Paused project initially hides its task',await page.locator('[data-work-key="task:paused-task"]').count()===0);
  const pausedMenu=page.locator(rootSelector+' details').filter({has:page.locator('[data-action="toggle-show-suspended"]')});
  await pausedMenu.locator('summary').click(); await pausedMenu.locator('[data-action="toggle-show-suspended"]').click();
  check('Explicit suspended display restores paused project task',await page.locator('[data-work-key="task:paused-task"]').count()===1);
  for (const own of [false,true]) {
    const suspended = task('suspended',p.id,'Suspended',{status:'suspended'});
    const target = task('target',p.id,'Target',own?{status:'suspended'}:{parentTaskId:'suspended'});
    await seed(page,{projects:[p],tasks:own?[target]:[suspended,target]});
    const menu=page.locator(rootSelector+' details').filter({has:page.locator('[data-action="toggle-show-suspended"]')});
    await menu.locator('summary').click(); await menu.locator('[data-action="toggle-show-suspended"]').click();
    await selectProject(page,p.id); await search(page,'Target');
    check('Suspended row/ancestor can be reached explicitly', JSON.stringify(await taskKeys(page))===JSON.stringify(own?['task:target']:['task:suspended','task:target']));
  }
  await seed(page,{projects:[project('p-a','A'),project('p-b','B'),project('p-deleted','Deleted',{deleted:true})],tasks:[task('t-a','p-a','Task A'),task('t-b','p-b','Task B')]});
  await selectProject(page,'p-b'); await search(page,'Task B'); await installSpies(page);
  const snapshot=()=>page.evaluate(()=>({selected:[...document.querySelectorAll('[data-work-list="wbs"] [data-action="wbs-select-project"][aria-pressed="true"]')].map(el=>el.dataset.id),rows:document.querySelector('[data-work-list="wbs"] [data-work-list-rows]').innerHTML,query:document.querySelector('#wbs-projects-query').value}));
  const beforeSelection=await snapshot(),beforeStorage=await page.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort()));
  check('Negative case starts from B and its matching task', JSON.stringify(beforeSelection.selected)==='["p-b"]' && JSON.stringify(await taskKeys(page))==='["task:t-b"]');
  for (const id of ['missing','p-deleted']) {
    const button=page.locator('[data-work-list="wbs"] [data-action="wbs-select-project"][data-value="p-a"]');
    const handle=await button.elementHandle(); await handle.evaluate((el,id)=>{el.dataset.id=id;el.dataset.value=id;},id); await handle.click();
    check(id+': invalid selection preserves query, selected project and rows', JSON.stringify(await snapshot())===JSON.stringify(beforeSelection));
    check(id+': invalid selection makes no storage changes',await page.evaluate(()=>window.__v288StateWrites)===0 && await page.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort()))===beforeStorage);
    await button.evaluate(el=>{el.dataset.id='p-a';el.dataset.value='p-a';});
  }
}
async function verifyRegressionAndProjectDefault(page) {
  const cycle='2026-08-15',p=project('p-plan','Plan',{twelveWeekStartDate:cycle});
  const tasks=[task('parent',p.id,'Parent',{planTarget:true}),task('step',p.id,'Step',{parentTaskId:'parent',owner:'ai',aiWork:true,order:1000})];
  const track={id:'track-v288',ownerType:'project',ownerId:p.id,cycleStartDate:cycle,kind:'numeric',name:'KPI',unit:'items',startDate:cycle,deadline:'2026-09-30',baselineValue:0,goalValue:10,valueStep:1,milestones:[],status:'active',deleted:false};
  await seed(page,{projects:[p],tasks,tracks:[track],settings:{twelveWeekStartDate:cycle}});
  await selectProject(page,p.id); const before=await stateNow(page);
  const group=page.locator('[data-work-group="p-plan"]');
  check('Project summary carries cycle week', /12\u9031\u8a08\u753b \u7b2c\d+\u9031/.test(await group.locator('summary').textContent()));
  check('Track editing and owner/move/insert absent from WBS',await group.locator('[data-twy-track-id],[data-action="toggle-plan-owner"],[data-action="move-plan-step"],[data-action="add-plan-step-below"]').count()===0);
  const original=await group.innerHTML(); await search(page,'Step'); await search(page,'');
  check('Search reset retains tree DOM and complete state',await group.innerHTML()===original && JSON.stringify(await stateNow(page))===JSON.stringify(before));
  await page.locator('#bottomNav [data-action="nav"][data-view="today"]').click();
  await page.locator('#sidebar [data-action="nav"][data-view="wbs"]').evaluate(el=>el.click());
  check('Returning to WBS keeps the project/task DOM',await group.innerHTML()===original);
  await page.locator('#sidebar [data-action="nav"][data-view="twelveweek"]').evaluate(el=>el.click());
  console.log('Twelve-week navigation',await page.locator('#app').getAttribute('data-view'),await page.locator('.twy-tower').count());
  await page.locator('.twy-cycle-fold > summary').click();
  check('Track is available in the twelve-week tab',await page.locator('.twy-goals-panel [data-twy-track-id="track-v288"]').count()===1);
  await seed(page,{projects:[]}); await installSpies(page);
  await page.locator('.wbs-add-menu > summary').click(); await page.locator('#projectTitle').fill('New project'); await page.locator('[data-action="add-project"]').click();
  const state=await stateNow(page),added=state.projects.find(p=>p.title==='New project');
  check('Project addition saves collapsed=true once and advances timestamp',added?.collapsed===true && await page.evaluate(()=>window.__v288StateWrites)===1 && state.dataModifiedAt!==OLD_MODIFIED);
  check('New project has a chip',await page.locator(`[data-action="wbs-select-project"][data-id="${added.id}"]`).count()===1);
  await page.reload(); await page.locator(`[data-action="wbs-select-project"][data-id="${added.id}"]`).waitFor();
  check('Reload retains collapsed default', (await stateNow(page)).projects.find(p=>p.id===added.id).collapsed===true);
}
async function verifyResponsive(page) {
  await page.setViewportSize({width:390,height:844}); const p=project('mobile','Mobile project');
  await seed(page,{projects:[p],tasks:[task('mobile-task',p.id,'Mobile title '.repeat(12))]}); await selectProject(page,p.id); await search(page,'Mobile');
  const metrics=await page.evaluate(()=>{
    const root=document.querySelector('[data-work-list="wbs"]'),input=root.querySelector('[data-work-filter="query"]');
    const boxes=[input,root.querySelector('[data-work-list-rows]'),root.querySelector('[data-work-key="task:mobile-task"]'),root.querySelector('[data-action="wbs-select-project"][data-id="mobile"]')].map(el=>el.getBoundingClientRect());
    const buttons=[root.querySelector('[data-action="wbs-select-project"][data-id="mobile"]'),root.querySelector('[data-action="edit-task"][data-id="mobile-task"]')];
    return {fits:document.documentElement.scrollWidth<=innerWidth+1&&boxes.every(b=>b.left>=-1&&b.right<=innerWidth+1),font:parseFloat(getComputedStyle(input).fontSize),heights:buttons.map(el=>el.getBoundingClientRect().height)};
  });
  check('390px query/results fit viewport',metrics.fits,JSON.stringify(metrics));
  check('Input >=16px and both tap targets >=44px',metrics.font>=16&&metrics.heights.length===2&&metrics.heights.every(h=>h>=44),JSON.stringify(metrics));
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => { pageErrors.push(error.message); console.error("PAGEERROR",error.message); });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await verifySearchAndDebounce(page);
    await verifyJumpPaths(page);
    await verifyRegressionAndProjectDefault(page);
    await verifyResponsive(page);
    const unexpectedConsoleErrors = consoleErrors.filter((message) =>
      !message.startsWith("Failed to load resource: the server responded with a status of 404"));
    check("全経路でpageerror/予期しないconsole errorなし", pageErrors.length === 0 && unexpectedConsoleErrors.length === 0,
      JSON.stringify({ pageErrors, unexpectedConsoleErrors, expectedBlockedApi404s: consoleErrors.length - unexpectedConsoleErrors.length }));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? "\n✅ v288: 全テスト成功" : `\n❌ v288: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
