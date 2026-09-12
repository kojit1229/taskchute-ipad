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

const projectRoot = '[data-work-list="wbs-projects"]';
const taskRoot = '[data-work-list^="wbs-tasks-"]';
async function search(page, query, scope = 'projects') {
  const root = page.locator(scope === 'projects' ? projectRoot : taskRoot);
  await root.locator('[data-work-filter="query"]').fill(query);
  await page.waitForFunction(({ selector, query }) => {
    const root = document.querySelector(selector);
    return root.querySelector('[data-work-filter="query"]').value === query && root.dataset.workComposing !== '1';
  }, { selector: scope === 'projects' ? projectRoot : taskRoot, query });
}
async function selectProject(page, id) {
  await page.locator('[data-action="wbs-select-project"]').filter({ has: page.locator('strong') }).evaluateAll((els, id) => {
    if (!els.some(el => el.dataset.id === id)) throw Error('Project choice is missing: ' + id);
  }, id);
  await page.locator('[data-action="wbs-select-project"][data-id="' + id + '"]').click();
}
async function clickResult(page, id) {
  const row = page.locator('[data-wbs-row-id="' + id + '"]');
  await row.scrollIntoViewIfNeeded();
  if (await row.getAttribute('data-action') === 'wbs-select-project') await row.click();
}
const taskKeys = page => page.locator(taskRoot + ' [data-work-key]').evaluateAll(els => els.map(el => el.dataset.workKey));
async function verifySearchAndDebounce(page) {
  console.log('[1] 独立検索: 空検索・1文字・部分一致・削除/XSS・全51件');
  const p = project('p-search', 'ALPHA案件');
  await seed(page, { projects: [p, project('p-uncat', '危険<img src=x onerror=alert(1)>', { category: '' }), project('p-deleted', '削除済みProject', { deleted: true })],
    tasks: [task('t-alpha', p.id, 'alpha設計'), task('t-deleted', p.id, '削除済みTask', { deleted: true }), task('t-live-under-deleted', 'p-deleted', '削除配下の生Task')] });
  await selectProject(page, p.id);
  check('空検索は未削除Project/Taskを表示し削除済みを除外',
    await page.locator(projectRoot + ' [data-work-filter="query"]').inputValue() === '' && await page.locator(taskRoot + ' [data-work-filter="query"]').inputValue() === ''
    && await page.locator('[data-action="wbs-select-project"][data-id="p-search"]').count() === 1
    && await page.locator('[data-action="wbs-select-project"][data-id="p-uncat"]').count() === 1
    && JSON.stringify(await taskKeys(page)) === '["task:t-alpha"]'
    && await page.locator('[data-action="wbs-select-project"][data-id="p-deleted"], [data-work-key="task:t-deleted"]').count() === 0);
  await search(page, '設', 'tasks');
  check('1文字でも一致Taskだけを表示', JSON.stringify(await taskKeys(page)) === '["task:t-alpha"]');
  await search(page, 'alpha'); await search(page, 'alpha', 'tasks');
  const alphaTitles = [await page.locator(projectRoot + ' .wbs-project-choice strong').textContent(), await page.locator(taskRoot + ' .wbs-task-title').textContent()];
  check('大文字小文字を区別せずProject/Taskを独立部分一致', JSON.stringify(alphaTitles) === '["ALPHA案件","alpha設計"]'
    && (await page.locator('.wbs-project-detail header h2').textContent()).includes('ALPHA案件') && await page.locator('.wbs-project-detail').getAttribute('data-wbs-detail-id') === p.id);
  await page.locator('.wbs-detail-actions [data-action="edit-project"]').click();
  check('所属カテゴリはProject詳細から読める', await page.locator('[data-modal-field="category"]').inputValue() === '仕事');
  await page.locator('#modalRoot [data-action="modal-close"]').first().click();
  await search(page, '危険');
  check('タイトルをescapeHTMLしてタグを生成しない', await page.locator(projectRoot + ' img').count() === 0
    && (await page.locator('[data-id="p-uncat"] strong').textContent()).includes('<img'));
  await selectProject(page, 'p-uncat');
  await page.locator('.wbs-detail-actions [data-action="edit-project"]').click();
  check('未分類Projectは詳細でもカテゴリ未設定', await page.locator('[data-modal-field="category"]').inputValue() === '');
  await page.locator('#modalRoot [data-action="modal-close"]').first().click();
  // 削除Projectは選択肢にない。生Taskの検索・保持は新設された実行候補から確認する。
  await page.locator('#bottomNav [data-view="exec"]').click();
  const candidates = page.locator('[data-work-list="exec-candidates"]');
  await candidates.locator('[data-work-filter="query"]').fill('削除');
  check('削除Project配下の生Taskも新候補検索で保持し削除Taskは除外',
    JSON.stringify(await candidates.locator('[data-work-key]').evaluateAll(els => els.map(el => el.dataset.workKey))) === '["task:t-live-under-deleted"]'
    && await candidates.locator('[data-action="wbs-search-jump"]').count() === 0);
  await page.locator('#bottomNav [data-view="wbs"]').click();
  await search(page, '存在しない');
  check('0件案内と検索入力を保持し結果を作らない',
    (await page.locator(projectRoot + ' [data-work-list-rows]').textContent()).trim() === '条件に一致する項目はありません。'
    && await page.locator(projectRoot + ' [data-work-filter="query"]').inputValue() === '存在しない' && await page.locator(projectRoot + ' .wbs-project-choice').count() === 0);
  await seed(page, { projects: Array.from({ length: 51 }, (_, i) => project('p-limit-' + i, '上限対象' + String(i).padStart(2, '0'))) });
  const total = (await stateNow(page)).projects.filter(p => !p.deleted).length + 1;
  await search(page, '上限');
  check('51件を元順で全件表示しProject母集団の件数も一致',
    JSON.stringify(await page.locator(projectRoot + ' .wbs-project-choice').evaluateAll(els => els.map(el => el.dataset.id))) === JSON.stringify(Array.from({ length: 51 }, (_, i) => 'p-limit-' + i))
    && await page.locator(projectRoot + ' .wbs-project-choice').count() === 51
    && (await page.locator(projectRoot + ' .work-list-count').textContent()).trim() === '51 / ' + total + '件 ・ 全件スクロール');
  console.log('[2] 連続入力は同じinput・focus・保存時刻を保持');
  await seed(page, { projects: [project('p-focus', '連続入力検索対象')] });
  await page.evaluate(() => {
    const input = document.querySelector('#wbs-projects-query'); window.__v288InputNode = input; input.focus();
    for (const text of ['連続', '連続入力']) { input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
  });
  await page.locator('[data-action="wbs-select-project"][data-id="p-focus"]').waitFor();
  const focus = await page.evaluate(key => ({ sameNode: window.__v288InputNode === document.querySelector('#wbs-projects-query'), focused: document.activeElement === window.__v288InputNode, modified: JSON.parse(localStorage.getItem(key)).dataModifiedAt }), STATE_KEY);
  check('連続入力後も同じinputがfocus中', focus.sameNode && focus.focused, JSON.stringify(focus));
  check('検索入力だけでは保存時刻を変更しない', focus.modified === OLD_MODIFIED);
}
async function verifyJumpPaths(page) {
  console.log('[3] Project選択・Task depth 0/1/2の検索と到達・保存なし');
  const p = project('p-tree', '階層Project', { collapsed: true });
  const root = task('t-root', p.id, 'ルート対象', { collapsed: true });
  const child = task('t-child', p.id, '中間対象', { parentTaskId: root.id, collapsed: true });
  const grand = task('t-grand', p.id, '末端対象', { parentTaskId: child.id, collapsed: true });
  for (const [id, query] of [[p.id, '階層'], [root.id, 'ルート'], [child.id, '中間'], [grand.id, '末端']]) {
    await seed(page, { projects: [p], tasks: [root, child, grand], settings: { wbsCategoryFilter: '仕事' } });
    await installSpies(page); const before = await stateNow(page);
    if (id === p.id) { await search(page, query); await clickResult(page, id); }
    else { await selectProject(page, p.id); await search(page, query, 'tasks'); await clickResult(page, id); }
    const state = await stateNow(page);
    check(query + ': 選択Projectの必要な祖先・未完了の子へ到達', JSON.stringify(await taskKeys(page)) === JSON.stringify(id === p.id ? ['task:t-root'] : ['task:t-root','task:t-child','task:t-grand']));
    check(query + ': 対象がスクロール表示内にある', await page.locator('[data-wbs-row-id="' + id + '"]').evaluate(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }));
    check(query + ': 検索と選択は保存0回・collapsed/updatedAt/全体時刻を変更しない', await page.evaluate(() => window.__v288StateWrites) === 0 && JSON.stringify(state) === JSON.stringify(before));
    check(query + ': Project/Task updatedAtは全て不変', state.projects.find(x => x.id === p.id).updatedAt === p.updatedAt && [root,child,grand].every(t => state.tasks.find(x => x.id === t.id).updatedAt === t.updatedAt));
    check(query + ': 不要なカテゴリ・中断条件の変更なし', state.settings.wbsCategoryFilter === '仕事' && state.settings.showSuspended === false);
  }
  console.log('[4] 非表示条件を明示解除し、中断Project/祖先/Taskへ到達');
  const paused = project('p-paused', '中断Project対象', { category: '仕事', status: 'paused', collapsed: true });
  await seed(page, { projects: [paused], settings: { wbsCategoryFilter: '学び', showSuspended: false } });
  await page.locator('.wbs-view-menu > summary').click();
  await page.locator('[data-action="wbs-category-filter"]').selectOption('');
  if (!(await page.locator('.wbs-view-menu').evaluate(el => el.open))) await page.locator('.wbs-view-menu > summary').click();
  await page.locator('[data-action="toggle-show-suspended"]').click();
  await search(page, '中断Project'); await selectProject(page, paused.id);
  let state = await stateNow(page);
  check('カテゴリ不一致と中断条件を解除して対象Projectを表示', state.settings.wbsCategoryFilter === '' && state.settings.showSuspended === true && await page.locator('[data-wbs-detail-id="p-paused"]').count() === 1);
  const active = project('p-susp-task', '中断Task案件', { collapsed: true });
  for (const own of [false, true]) {
    const suspended = task('t-susp-root', active.id, '中断祖先', { status: 'suspended', collapsed: true });
    const target = task('t-target', active.id, '祖先配下対象', own ? { status: 'suspended' } : { parentTaskId: suspended.id });
    await seed(page, { projects: [active], tasks: own ? [target] : [suspended,target] });
    await page.locator('.wbs-view-menu > summary').click(); await page.locator('[data-action="toggle-show-suspended"]').click();
    await selectProject(page, active.id); await search(page, '祖先配下', 'tasks'); await clickResult(page, target.id);
    check(own ? '中断Task自身へ到達' : '中断祖先を含めて子へ到達', (await stateNow(page)).settings.showSuspended === true
      && JSON.stringify(await taskKeys(page)) === JSON.stringify(own ? ['task:t-target'] : ['task:t-susp-root','task:t-target']));
  }
  // 新導線はkindを受け取らないため旧不正kind負例は廃止。不正idは選択・詳細・条件・保存の不変を検査する。
  await seed(page, { projects: [project('p-a', '比較案件A'), project('p-b', '比較案件B'), project('p-deleted', '削除案件', { deleted: true })],
    tasks: [task('t-a', 'p-a', '比較作業A'), task('t-b', 'p-b', '比較作業B')] });
  await selectProject(page, 'p-b'); await search(page, '比較'); await search(page, '比較作業B', 'tasks');
  const selectionSnapshot = () => page.evaluate(() => ({
    selected: [...document.querySelectorAll('[data-work-list="wbs-projects"] .wbs-project-choice.selected')].map(el => el.dataset.id),
    detail: document.querySelector('.wbs-project-detail')?.outerHTML,
    taskList: document.querySelector('[data-work-list^="wbs-tasks-"]')?.dataset.workList,
    conditions: [...document.querySelectorAll('[data-work-list] [data-work-filter]')].map(el => [el.closest('[data-work-list]').dataset.workList, el.dataset.workFilter, el.value])
  }));
  const beforeSelection = await selectionSnapshot();
  check('負例の開始時はp-b選択・右Task一覧・検索語が設定済み', JSON.stringify(beforeSelection.selected) === '["p-b"]'
    && beforeSelection.taskList === 'wbs-tasks-p-b' && JSON.stringify(await taskKeys(page)) === '["task:t-b"]'
    && await page.locator(taskRoot + ' [data-work-filter="query"]').inputValue() === '比較作業B');
  const beforeStorage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await installSpies(page);
  for (const id of ['missing', 'p-deleted']) {
    const button = page.locator('[data-action="wbs-select-project"][data-wbs-row-id="p-a"]');
    await button.evaluate((el, id) => { el.dataset.id = id; }, id); await button.click();
    check(`${id}: 選択・右Task一覧・検索条件が不変`, JSON.stringify(await selectionSnapshot()) === JSON.stringify(beforeSelection)
      && await page.locator('[data-work-list="wbs-tasks-p-b"]').count() === 1
      && JSON.stringify(await taskKeys(page)) === '["task:t-b"]');
    check(`${id}: 保存0回・localStorage不変`, await page.evaluate(() => window.__v288StateWrites) === 0
      && await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())) === beforeStorage);
  }
}

async function verifyRegressionAndProjectDefault(page) {
  console.log("[5] 12WYトラック/週次実行計画は検索・ジャンプでstate/UI/並び順不変");
  const cycle = "2026-08-15";
  const p = project("p-plan", "計画Project", { twelveWeekStartDate: cycle });
  const parent = task("t-plan-parent", p.id, "計画親", { planTarget: true, order: 1000 });
  const stepA = task("t-plan-a", p.id, "検索する計画A", { parentTaskId: parent.id, owner: "k", order: 1000 });
  const stepB = task("t-plan-b", p.id, "計画B", { parentTaskId: parent.id, owner: "ai", aiWork: true, order: 2000 });
  const track = {
    id: "track-v288", ownerType: "project", ownerId: p.id, cycleStartDate: cycle,
    kind: "numeric", name: "週次KPI", unit: "件", startDate: cycle, deadline: "2026-09-30",
    baselineValue: 0, goalValue: 10, valueStep: 1, milestones: [], status: "active",
    closedAt: "", closedReason: "", supersedesTrackId: "", carriedFromTrackId: "",
    createdAt: `${cycle}T00:00:00`, updatedAt: `${cycle}T00:00:00`, deleted: false
  };
  await seed(page, { projects: [p], tasks: [parent, stepA, stepB], tracks: [track], settings: { twelveWeekStartDate: cycle } });
  await selectProject(page, p.id);
  const initialWbsTreeSnapshot = await page.locator('#app[data-view="wbs"] section.section.grid')
    .evaluate((tree) => tree.innerHTML);
  const initialSearchValue = await page.locator("#wbs-projects-query").inputValue();
  await page.locator('#bottomNav [data-action="nav"][data-view="today"]').click();
  await page.waitForSelector('#app[data-view="today"]');
  await page.locator('#bottomNav [data-action="nav"][data-view="more"]').click();
  await page.waitForSelector('#app[data-view="more"]');
  await page.locator('.more-tower-grid [data-action="nav"][data-view="wbs"]').click();
  await page.locator('[data-work-list="wbs-projects"]').waitFor();
  const rerenderedWbsTreeSnapshot = await page.locator('#app[data-view="wbs"] section.section.grid')
    .evaluate((tree) => tree.innerHTML);
  const rerenderedSearchValue = await page.locator("#wbs-projects-query").inputValue();
  check("検索未使用の再render後も12WY Project/Task行DOM断片は完全一致",
    initialSearchValue === "" && rerenderedSearchValue === ""
    && rerenderedWbsTreeSnapshot === initialWbsTreeSnapshot,
    JSON.stringify({
      initialSearchValue, rerenderedSearchValue,
      initialLength: initialWbsTreeSnapshot.length, rerenderedLength: rerenderedWbsTreeSnapshot.length
    }));
  const snapshot = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const taskFields = state.tasks.filter((item) => item.id.startsWith("t-plan"))
      .map(({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }) => ({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }));
    const order = [...document.querySelectorAll('.wbs-task-title[data-id^="t-plan"]')].map((el) => el.dataset.id);
    const actions = [...document.querySelectorAll('[data-action="toggle-plan-owner"],[data-action="move-plan-step"],[data-action="add-plan-step-below"]')]
      .map((el) => `${el.dataset.action}:${el.dataset.id}:${el.dataset.direction || ""}:${el.textContent.trim()}`);
    return { tracks: state.tracks, taskFields, order, actions, trackRows: document.querySelectorAll('[data-twy-track-id="track-v288"]').length };
  }, STATE_KEY);
  await installSpies(page);
  await selectProject(page, p.id);
  await search(page, "検索する計画", 'tasks');
  await clickResult(page, stepA.id);
  await search(page, "", 'tasks');
  const after = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const taskFields = state.tasks.filter((item) => item.id.startsWith("t-plan"))
      .map(({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }) => ({ id, parentTaskId, planTarget, owner, aiWork, order, status, updatedAt }));
    const order = [...document.querySelectorAll('.wbs-task-title[data-id^="t-plan"]')].map((el) => el.dataset.id);
    const actions = [...document.querySelectorAll('[data-action="toggle-plan-owner"],[data-action="move-plan-step"],[data-action="add-plan-step-below"]')]
      .map((el) => `${el.dataset.action}:${el.dataset.id}:${el.dataset.direction || ""}:${el.textContent.trim()}`);
    return { tracks: state.tracks, taskFields, order, actions, trackRows: document.querySelectorAll('[data-twy-track-id="track-v288"]').length };
  }, STATE_KEY);
  check("12WY track state/row数は不変", JSON.stringify(after.tracks) === JSON.stringify(snapshot.tracks)
    && snapshot.trackRows === 1 && after.trackRows === 1, JSON.stringify({ before: snapshot.trackRows, after: after.trackRows }));
  check("週次実行計画のstate・操作UI・Task並び順は不変", JSON.stringify(after.taskFields) === JSON.stringify(snapshot.taskFields)
    && JSON.stringify(after.actions) === JSON.stringify(snapshot.actions)
    && JSON.stringify(after.order) === JSON.stringify(snapshot.order));

  console.log("[6] 新規Projectは既定collapsed=trueで保存・再読込後も折りたたみ");
  await seed(page, { projects: [] });
  await installSpies(page);
  await page.locator('.wbs-add-menu > summary').click();
  await page.locator("#projectTitle").fill("新規closed案件");
  await page.locator('[data-action="add-project"]').click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).projects.some((item) => item.title === "新規closed案件"), STATE_KEY);
  let state = await stateNow(page);
  const added = state.projects.find((item) => item.title === "新規closed案件");
  check("add-project直後collapsed=true・saveState 1回・dataModifiedAt更新", added?.collapsed === true
    && await page.evaluate(() => window.__v288StateWrites) === 1 && state.dataModifiedAt !== OLD_MODIFIED, JSON.stringify(added));
  check("新規Projectを選択肢として表示", await page.locator(`[data-action="wbs-select-project"][data-id="${added.id}"]`).count() === 1);
  await page.reload();
  await page.waitForSelector(`[data-wbs-row-id="${added.id}"]`);
  state = await stateNow(page);
  check("リロード後もcollapsed=trueを保持", state.projects.find((item) => item.id === added.id)?.collapsed === true
    && await page.locator(`[data-action="wbs-select-project"][data-id="${added.id}"]`).count() === 1);
}

async function verifyResponsive(page) {
  console.log("[7] 390px: 検索input/結果/既存WBS行に横スクロールなし、input 16px・結果44px以上");
  await page.setViewportSize({ width: 390, height: 844 });
  const p = project("p-mobile", "モバイル対象Project");
  const longTitle = `モバイル対象${"長いタイトル".repeat(12)}`;
  await seed(page, { projects: [p], tasks: [task("t-mobile", p.id, longTitle)] });
  await selectProject(page, p.id);
  await search(page, "モバイル対象");
  await search(page, "モバイル対象", 'tasks');
  const metrics = await page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    const input = document.querySelector("#wbs-projects-query");
    const results = document.querySelector("#wbs-projects-search-results");
    const row = document.querySelector('[data-wbs-row-id="p-mobile"]');
    const taskInput = document.querySelector('[data-work-list^="wbs-tasks-"] [data-work-filter="query"]');
    const taskResults = document.querySelector('[data-work-list^="wbs-tasks-"] [data-work-list-rows]');
    const rects = [input, results, row, taskInput, taskResults, document.querySelector('[data-work-key="task:t-mobile"]')].map((el) => el.getBoundingClientRect());
    const heights = [...document.querySelectorAll('.wbs-project-choice, [data-work-list^="wbs-tasks-"] .wbs-task-title')].map((el) => el.getBoundingClientRect().height);
    return {
      noDocOverflow: doc.scrollWidth <= doc.clientWidth + 1,
      rectsInside: rects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1),
      fontSize: parseFloat(getComputedStyle(input).fontSize), taskFontSize: parseFloat(getComputedStyle(taskInput).fontSize), heights
    };
  });
  check("390pxでdocument/input/結果/Project行に横スクロールなし", metrics.noDocOverflow && metrics.rectsInside, JSON.stringify(metrics));
  check("検索input 16px以上・全結果タップ標的44px以上", metrics.fontSize >= 16 && metrics.taskFontSize >= 16
    && metrics.heights.length === 2 && metrics.heights.every((height) => height >= 44), JSON.stringify(metrics));
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
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
