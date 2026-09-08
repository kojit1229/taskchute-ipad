// Production Block display: shared plan/actual rows, registered actions, legacy controls,
// invalid input/failure injection, read-only state and responsive DOM measurements.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const acorn = require("acorn");
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort,
  passGithubGate, STATE_KEY } = require("./helpers");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const names = ["escapeHTML", "pad2", "timeFromDateTime", "minutesOf", "localDateTimeToMs", "estimateMinutesForBlock"];
const ast = acorn.parse(app, { ecmaVersion: "latest", sourceType: "module" });
const helpers = vm.runInNewContext(ast.body.filter(node => node.type === "FunctionDeclaration" && names.includes(node.id.name))
  .map(node => app.slice(node.start, node.end)).join("\n") + `\n({${names.join(",")}})`);
const now = fixedClock(Date.UTC(2026, 8, 9, 1));
const DAY = new Date(now()).toISOString().slice(0, 10);
const NEXT = new Date(Date.UTC(2026, 8, 10)).toISOString().slice(0, 10);
const block = (extra = {}) => ({ id: "fake-b", date: DAY, title: "架空の作業", category: "仕事", taskId: "fake-t",
  plannedStartAt: `${DAY}T09:00:00`, plannedEndAt: `${DAY}T09:30:00`, actualStartAt: "", actualEndAt: "",
  completed: false, estimateMin: 30, charge: 0, discharge: 2, comment: "架空メモ", ...extra });
const task = { id: "fake-t", projectId: "fake-p", title: "架空Task", status: "done" };
const deps = { ...helpers, getTask: id => id === task.id ? task : null, projectName: () => "架空Project", canEdit: true };
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }

(async () => {
  const { buildDailyViewModel: build, renderDailyBlockDetails: render } = await import(pathToFileURL(path.join(root, "src/features/daily-view-model.js")).href);
  const { DAILY_ACTIONS, validateDailyContract } = await import(pathToFileURL(path.join(root, "src/ui/daily-parts/contract.js")).href);
  check("saved Block fields map to the common contract, without state mutation", () => {
    const b = Object.freeze(block()); const before = JSON.stringify(b);
    const model = build(b, deps);
    assert.equal(validateDailyContract("display", model.display).valid, true);
    assert.deepEqual(model.display, { key: "block:fake-b", kind: "block", id: "fake-b", dateLabel: DAY,
      title: b.title, subtitle: "仕事 ・ 架空Project", statusLabel: "", busy: false, error: "", actions: { "edit-block": true } });
    assert.equal(model.plan.plannedStartText, "09:00"); assert.equal(model.plan.plannedEndText, "09:30");
    assert.equal(model.plan.estimateText, "見積30分"); assert.equal(model.plan.draft, null);
    assert.equal(JSON.stringify(b), before);
  });
  check("plan complete, running and Task complete remain independent in all eight combinations", () => {
    for (const completed of [false, true]) for (const running of [false, true]) for (const done of [false, true]) {
      const m = build(block({ completed, actualStartAt: running ? `${DAY}T09:05:00` : "" }),
        { ...deps, getTask: () => ({ ...task, status: done ? "done" : "todo" }) });
      assert.deepEqual([m.plan.planCompleted, m.plan.running, m.plan.taskCompleted], [completed, running, done]);
    }
  });
  check("unknown time stays unknown; no estimate becomes zero or a fake draft", () => {
    const m = build(block({ plannedStartAt: "", plannedEndAt: "", estimateMin: null }), deps);
    assert.equal(m.plan.estimateText, ""); assert.equal(m.plan.plannedStartText, "");
    assert.match(render(block({ plannedStartAt: "", plannedEndAt: "", estimateMin: null }), deps), /開始 未定/);
    assert.equal(m.actual.durationText, ""); assert.ok(m.actual.missingTimeLabel);
  });
  check("next-day midnight, short manual times, actual zero and midnight duration", () => {
    const b = block({ plannedStartAt: `${DAY}T23:55:00`, plannedEndAt: `${NEXT}T00:00:00`,
      actualStartAt: `${DAY}T23:50:00`, actualEndAt: `${NEXT}T00:10:00` });
    assert.equal(build(b, deps).plan.endNextDay, true);
    assert.equal(build(b, deps, true).actual.durationText, "20分");
    assert.match(render(b, deps), /終了 翌日 00:00/);
    const short = build(block({ plannedStartAt: `${DAY}T03:01:00`, plannedEndAt: `${DAY}T03:02:00`, estimateMin: null }), deps);
    assert.equal(short.plan.estimateText, "見積1分");
    assert.equal(build(block({ actualStartAt: `${DAY}T03:01:00`, actualEndAt: `${DAY}T03:01:00` }), deps, true).actual.durationText, "0分");
  });
  check("missing, malformed, impossible and reversed actual timestamps never fabricate duration", () => {
    for (const extra of [{ actualStartAt: "", actualEndAt: `${DAY}T10:00:00` },
      { actualStartAt: `badT09:00`, actualEndAt: `badT10:00` },
      { actualStartAt: "2026-02-30T09:00:00", actualEndAt: "2026-02-30T10:00:00" },
      { actualStartAt: `${DAY}T10:00:00`, actualEndAt: `${DAY}T09:00:00` }]) {
      const b = block({ completed: true, ...extra });
      assert.equal(build(b, deps, true).actual.durationText, "");
      assert.match(render(b, deps, true), /data-daily-duration>時刻未記録/);
    }
  });
  check("ended incomplete, zero energy and absent/deleted Task are explicit", () => {
    const b = block({ actualStartAt: `${DAY}T09:00:00`, actualEndAt: `${DAY}T09:10:00` });
    assert.match(render(b, deps, true), /終了・未完了/);
    assert.equal(build(b, deps, true).actual.chargeText, "0");
    for (const getTask of [() => null, () => ({ ...task, deleted: true })]) {
      const m = build(b, { ...deps, getTask }, true);
      assert.equal(m.actual.taskId, null); assert.equal(m.actual.taskCompleted, false);
    }
  });
  check("only connected edit is emitted; all future operations and duplicate on readonly Blocks are absent", () => {
    for (const title of ["通常", "アファメーション", "ビジョンボードを見る", "AIフィードバック"]) {
      const b = block({ title });
      for (const actual of [false, true]) {
        const html = render(b, deps, actual);
        assert.deepEqual([...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]), ["edit-block"]);
        assert.equal(build(b, deps).plan.canDuplicate, false);
        assert.doesNotMatch(render(b, { ...deps, canEdit: false }, actual), /data-action=|data-daily-field=/);
      }
    }
  });
  check("bad shapes and getters reject; legacy HTML-like text keeps a safe fallback", () => {
    for (const b of [null, [], block({ id: "" }), block({ title: 5 }), block({ charge: Infinity }), block({ estimateMin: -1 })])
      assert.throws(() => build(b, deps), { code: "DAILY_VIEW_MODEL_INVALID" });
    let calls = 0; const getter = block();
    Object.defineProperty(getter, "title", { get() { calls++; throw Error("getter executed"); } });
    assert.throws(() => build(getter, deps), { code: "DAILY_VIEW_MODEL_INVALID" }); assert.equal(calls, 0);
    const bad = block({ title: '<img src=x onerror="alert(1)">' });
    assert.throws(() => build(bad, deps), { code: "DAILY_VIEW_MODEL_INVALID" });
    assert.match(render(bad, deps), /role="status"/); assert.doesNotMatch(render(bad, deps), /<img/);
  });
  check("injected dependency and renderer failures propagate without writes or silent success", () => {
    assert.throws(() => render(block(), { ...deps, getTask: () => { throw Error("lookup failure"); } }), /lookup failure/);
    assert.throws(() => render(block(), { ...deps, escapeHTML: () => { throw Error("escape failure"); } }), /escape failure/);
    assert.throws(() => build(block(), { ...deps, estimateMinutesForBlock: () => NaN }), { code: "DAILY_VIEW_MODEL_INVALID" });
  });
  check("shared feature has no app import, storage, global listeners or registration; SW caches it once", () => {
    const source = fs.readFileSync(path.join(root, "src/features/daily-view-model.js"), "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*app\.js|\b(?:fetch\(|localStorage|sessionStorage|registerActions\(|addEventListener\()/);
    assert.equal(fs.readFileSync(path.join(root, "sw.js"), "utf8").split('"./src/features/daily-view-model.js"').length - 1, 1);
  });

  const listSource = fs.readFileSync(path.join(root, "src/features/work-list.js"), "utf8");
  const listAst = acorn.parse(listSource, { ecmaVersion: "latest", sourceType: "module" });
  const listHarness = vm.runInNewContext(listAst.body.filter(node => node.type === "VariableDeclaration"
    || node.type === "FunctionDeclaration" && ["configureWorkList", "listRow"].includes(node.id.name))
    .map(node => listSource.slice(node.start, node.end)).join("\n") + "\n({configureWorkList,listRow})",
    { registerActions: () => {} });
  const listDeps = { escapeHTML: helpers.escapeHTML, resolveEstimateMin: () => 30 };
  const listBlock = (b = block()) => ({ kind: "block", key: `block:${b.id}`, id: b.id, item: b,
    date: DAY, time: b.plannedStartAt, title: b.title, status: "open" });
  check("today Block rows render injected production plan and actual details", () => {
    const calls = [];
    listHarness.configureWorkList({ ...listDeps, dailyBlockDetails: (b, actual, canEdit) => {
      calls.push([b, actual, canEdit]); return render(b, { ...deps, canEdit }, actual);
    } });
    for (const extra of [{}, { completed: true }, { actualEndAt: `${DAY}T09:30:00` }]) {
      const b = block(extra), actual = Boolean(b.completed || b.actualEndAt);
      const html = listHarness.listRow(listBlock(b), "today");
      assert.ok(html.includes(render(b, { ...deps, canEdit: false }, actual)));
      assert.deepEqual(calls.at(-1), [b, actual, false]);
      assert.deepEqual([...html.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]), ["edit-block"]);
    }
  });
  check("Task rows and other scopes never call the today Block detail renderer", () => {
    listHarness.configureWorkList({ ...listDeps, renderBlock: () => "legacy-exec",
      dailyBlockDetails: () => { throw Error("unexpected Block details"); } });
    const row = { kind: "task", key: `task:${task.id}`, id: task.id, item: task, title: task.title, status: "open" };
    for (const scope of ["today", "wbs", "exec"])
      assert.doesNotMatch(listHarness.listRow(row, scope), /data-daily-key=/);
    assert.doesNotMatch(listHarness.listRow(listBlock(), "wbs"), /data-daily-key=/);
    assert.match(listHarness.listRow(listBlock(), "exec"), /legacy-exec/);
  });
  check("today Block rows keep the legacy edit when details are not injected", () => {
    listHarness.configureWorkList(listDeps);
    const html = listHarness.listRow(listBlock(), "today");
    assert.doesNotMatch(html, /data-daily-key=|undefined/);
    assert.match(html, /data-action="edit-block"/);
    assert.ok(html.includes(block().title));
  });

  const server = startServer(randomPort()); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), locale: "ja-JP", serviceWorkers: "block",
      viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); const errors = [], metrics = [];
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort());
    await page.clock.install({ time: now() }); await page.clock.setFixedTime(now());
    await page.goto(`http://localhost:${server.address().port}/`); await passGithubGate(page);
    await page.evaluate(({ key, day, blocks, task }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "exec"; s.selectedDate = day;
      Object.assign(s.settings, { lastOpenedDate: day, autoSync: false, autoArchive: false }); s.settings.github.autoSave = false;
      s.projects = [{ id: "fake-p", title: "架空Project", kind: "normal", status: "active" }];
      s.tasks = [task]; s.blocks = blocks; s.recurrences = [];
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day: DAY, task, blocks: [block({ id: "up", title: "架空これから", plannedStartAt: `${DAY}T11:00:00` }),
      block({ id: "running", title: "架空実行中", actualStartAt: `${DAY}T09:00:00` }),
      block({ id: "done", title: "架空完了", completed: true, actualStartAt: `${DAY}T08:00:00`, actualEndAt: `${DAY}T08:20:00` }),
      block({ id: "missing", title: "架空旧実績", completed: true, actualStartAt: "", actualEndAt: "" })] });
    await page.reload(); await page.locator('[data-work-list="exec"]').waitFor();
    const read = () => page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    const before = await read();
    await page.locator('.exec-row-upcoming:has([data-id="up"]) .exec-row-copy').click();
    await page.locator('[data-daily-key="block:up"]').waitFor();
    assert.match(await page.locator('[data-daily-key="block:up"]').innerText(), /開始 11:00/);
    await page.locator('.exec-row-now:has([data-id="running"]) .exec-row-meta').click();
    await page.locator('[data-daily-key="block:running"]').waitFor();
    assert.match(await page.locator('[data-daily-key="block:running"]').innerText(), /実行中/);
    assert.equal(await page.locator('.exec-row-now [data-action="now-end"]').count(), 1);
    for (const id of ["done", "missing"]) {
      await page.locator(`.exec-row-done:has([data-id="${id}"]) summary`).click();
      await page.locator(`[data-daily-key="actual:${id}"]`).waitFor();
    }
    assert.equal(await page.locator('[data-daily-key="actual:done"] [data-daily-duration]').innerText(), "20分");
    assert.equal(await page.locator('[data-daily-key="actual:missing"] [data-daily-duration]').innerText(), "時刻未記録");
    assert.equal(await read(), before, "expansion/projection must not write state");
    const registry = await page.evaluate(async () => (await import("/src/ui/actions.js")).__debugActionNames());
    const emitted = await page.locator('[data-daily-key] [data-action]').evaluateAll(els => els.map(el => el.dataset.action));
    check("production exec uses both common rows and only registered contract actions", () => {
      assert.ok(emitted.length >= 3); assert.ok(emitted.every(action => DAILY_ACTIONS.includes(action) && registry.includes(action)));
    });
    for (const width of [390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      // Measure each restored layout after navigation, not during the media-query rebuild.
      await page.reload(); await page.locator('[data-work-list="exec"]').waitFor();
      const runningMeta = page.locator('.exec-row-now:has([data-id="running"]) .exec-row-meta');
      await runningMeta.click(); await page.locator('[data-daily-key="block:running"]').waitFor();
      const summary = page.locator('.exec-row-done:has([data-id="done"]) summary');
      await summary.click(); await page.locator('[data-daily-key="actual:done"]').waitFor();
      const sample = await page.locator('[data-daily-key="actual:done"]').evaluate(el => {
        const row = el.getBoundingClientRect();
        return { width: innerWidth, row: { left: row.left, right: row.right, height: row.height },
          documentWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
          controls: [...document.querySelectorAll('.exec-row-expand input,.exec-row-expand select,.exec-row-expand textarea')]
            .map(control => parseFloat(getComputedStyle(control).fontSize)) };
      });
      metrics.push(sample);
      check(`production layout ${width}px, visible shared content and input fonts`, () => {
        assert.ok(sample.row.height > 0); assert.ok(sample.row.left >= 0 && sample.row.right <= width + 1);
        assert.ok(sample.documentWidth <= sample.clientWidth + 1); assert.ok(sample.controls.length > 0);
        assert.ok(sample.controls.every(size => size >= 16));
      });
    }
    await page.locator('[data-daily-key="actual:done"] [data-action="edit-block"]').click();
    await page.locator('#modalRoot .daily-detail-frame[data-id="done"]').waitFor();
    assert.equal(await page.locator('#modalRoot [data-modal-field="title"]').inputValue(), "架空完了");
    await page.locator('#modalRoot [data-action="modal-close"]').click();
    await page.locator('[data-action="nav"][data-view="today"]').first().click();
    await page.locator('[data-work-list="today"]').waitFor();
    // Today uses work-list.js's separate compact row (outside this card's edit scope).
    await page.locator('[data-work-list="today"] [data-work-key="block:up"] [data-action="edit-block"]').click();
    await page.locator('#modalRoot .daily-detail-frame[data-id="up"]').waitFor();
    assert.equal(await page.locator('#modalRoot [data-modal-field="title"]').inputValue(), "架空これから");
    await page.locator('#modalRoot [data-action="modal-close"]').click();
    check("common edit and the existing today row both open the correct legacy detail", () => assert.deepEqual(errors, []));
    const todayBefore = await read();
    for (const width of [390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const todayRow = page.locator('[data-work-list="today"] [data-work-key="block:up"]');
      await todayRow.locator('[data-daily-key="block:up"]').waitFor();
      assert.match(await todayRow.innerText(), /開始 11:00/);
      assert.equal(await todayRow.locator('[data-action="edit-block"]').count(), 1);
      assert.equal(await page.locator('[data-work-list="today"] [data-daily-key="actual:done"] [data-daily-duration]').innerText(), "20分");
      const actions = await page.locator('[data-work-list="today"] [data-work-key] [data-action]')
        .evaluateAll(els => els.map(el => el.dataset.action));
      assert.ok(actions.length >= 4 && actions.every(action => DAILY_ACTIONS.includes(action) && registry.includes(action)));
      const sample = await todayRow.locator('[data-daily-key]').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { scope: "today", width: innerWidth, left: rect.left, right: rect.right, height: rect.height,
          documentWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
      });
      metrics.push(sample);
      assert.ok(sample.height > 0 && sample.left >= 0 && sample.right <= width + 1);
      assert.ok(sample.documentWidth <= sample.clientWidth + 1);
    }
    check("production today connects shared details at four widths without writes or unregistered actions", () => {
      assert.deepEqual(errors, []);
    });
    assert.equal(await read(), todayBefore, "today projection must not write state");
    const literal = '<img src=x onerror="window.injected=1"> & 架空';
    await page.evaluate(({ key, literal }) => {
      const s = JSON.parse(localStorage.getItem(key)); s.currentView = "exec";
      s.blocks.find(b => b.id === "up").title = literal; localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, literal });
    await page.reload(); await page.locator('[data-work-list="exec"]').waitFor();
    const legacy = page.locator('.exec-row-upcoming:has([data-id="up"])');
    await legacy.locator('.exec-row-copy').click(); await legacy.locator('[role="status"]').waitFor();
    assert.equal(await legacy.locator('strong').innerText(), literal);
    assert.equal(await legacy.locator('img').count(), 0);
    await legacy.locator('[data-action="edit-block"]').click();
    await page.locator('#modalRoot .daily-detail-frame[data-id="up"]').waitFor();
    assert.equal(await page.locator('#modalRoot [data-modal-field="title"]').inputValue(), literal);
    check("legacy literal text remains escaped, unchanged and editable when the contract rejects it", () => assert.deepEqual(errors, []));
    if (process.env.DAILY_VIEW_MODEL_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.DAILY_VIEW_MODEL_EVIDENCE_DIR,
      "layout-metrics.json"), JSON.stringify(metrics, null, 2));
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`daily-view-model: ${checks} checks passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
