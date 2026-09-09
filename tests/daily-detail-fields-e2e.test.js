// Task/Project/Block detail UI: legacy fields, planning/AI, 12-week tracks, localStorage rollback,
// body scan transition, native date/time controls, responsive layout and escaped content.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort,
  STATE_KEY, passGithubGate, dispatchRegisteredAction } = require("./helpers");
const now = fixedClock(Date.UTC(2026, 8, 9, 1, 30));
const DAY = new Date(now()).toISOString().slice(0, 10);
const dateAt = offset => new Date(Date.UTC(2026, 8, 9 + offset)).toISOString().slice(0, 10);
const CYCLE = dateAt(-4), DUE = dateAt(30);
const payload = '架空 <img src=x onerror="window.__injected=1"> & メモ';
const TASK_FIELDS = ["title", "projectId", "status", "parentTaskId", "category", "dueDate", "selfDueEnabled",
  "doneCriteria", "firstStep", "leverageType", "aiWork", "aiWorkBrief", "planTarget", "aiBrief", "description",
  "twyPerWeek", "twyFromWeek", "twyToWeek", "twyKeystone"];
const PROJECT_FIELDS = ["title", "kind", "status", "priority", "category", "startDate", "dueDate", "is12WY",
  "showProgress", "description", "twyKind", "twyName", "twyStartDate", "twyBaseline", "twyGoal", "twyUnit", "twyDeadline", "twyStep"];
const BLOCK_FIELDS = ["title", "category", "taskId", "isMIT", "date", "plannedStartAt", "plannedEndAt", "estimateMin",
  "actualStartAt", "actualEndAt", "charge", "discharge", "recurrenceKind", "comment", "leverageType", "completed"];

(async () => {
  const server = startServer(randomPort());
  const browser = await chromium.launch(launchOptions());
  let cases = 0;
  try {
    const context = await browser.newContext({ ...defaultContextOptions(), locale: "ja-JP",
      viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], metrics = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort());
    await page.clock.install({ time: now() });
    await page.clock.setFixedTime(now());
    await page.goto(`http://localhost:${server.address().port}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, day, cycle, due }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "wbs"; s.selectedDate = day;
      Object.assign(s.settings, { lastOpenedDate: day, autoSync: false, autoArchive: false, twelveWeekStartDate: cycle });
      s.settings.github.autoSave = false;
      s.projects = ["p", "p2"].map(id => ({ id, title: `架空Project ${id}`, kind: "normal", status: "active",
        priority: "中", twelveWeekStartDate: cycle, description: "元メモ", category: "仕事" }));
      s.tasks = ["parent", "t", "linked"].map((id, i) => ({ id, projectId: "p", parentTaskId: "", title: `架空Task ${id}`,
        status: "todo", category: "仕事", owner: "ai", aiWork: true, aiBrief: "元指示", planTarget: false,
        estimateMin: 35, priority: "高", order: i * 1000, progressNum: 2, progressDen: 7, nextRoutineId: "keep-next",
        description: "元説明", twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 12, keystone: false } }));
      s.blocks = [{ id: "b", title: "架空Block", taskId: "linked", category: "仕事", date: day,
        plannedStartAt: day + "T11:00:00", plannedEndAt: day + "T12:00:00", estimateMin: 60,
        charge: 1, discharge: 2, completed: false, comment: "元コメント" }];
      s.recurrences = []; s.tracks = []; s.trackMeasurements = []; s.trackCheckins = [];
      s.journals[day] = "架空本文";
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day: DAY, cycle: CYCLE, due: DUE });
    const reload = async () => { await page.reload(); await page.locator('[data-work-list="wbs"]').waitFor(); };
    await reload();
    const action = (name, id) => dispatchRegisteredAction(page, name, id ? { id } : {});
    const field = name => page.locator(`#modalRoot [data-modal-field="${name}"]`);
    const modalAction = name => page.locator(`#modalRoot [data-action="${name}"]`).first().click();
    const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    const open = async (kind, id) => {
      await action(`edit-${kind}`, id);
      await page.locator(`#modalRoot .daily-detail-frame[data-kind="${kind}"][data-id="${id}"]`).waitFor();
      await page.locator("#modalRoot .daily-detail-frame").evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
      assert.equal(await page.locator('#modalRoot [role="dialog"]').count(), 1, "one common frame / one draft");
      assert.equal(await page.locator('#modalRoot [role="tab"]').count(), 0, "no detail tabs");
    };
    const save = async () => {
      await modalAction("modal-save");
      await page.waitForFunction(() => !document.querySelector("#modalRoot").classList.contains("open"));
    };
    const fieldsExactly = async expected => {
      const actual = await page.locator("#modalRoot [data-modal-field]").evaluateAll(els => els.map(el => el.dataset.modalField));
      assert.deepEqual(actual.sort(), [...expected].sort(), "all legacy fields, without duplicates");
    };
    const setFields = async values => {
      for (const [key, value] of Object.entries(values)) {
        const control = field(key), tag = await control.evaluate(el => el.tagName);
        if (typeof value === "boolean") await control.setChecked(value);
        else if (tag === "SELECT") await control.selectOption(String(value));
        else await control.fill(String(value));
      }
    };
    const expectValues = async values => {
      for (const [key, value] of Object.entries(values)) {
        assert.equal(typeof value === "boolean" ? await field(key).isChecked() : await field(key).inputValue(),
          typeof value === "boolean" ? value : String(value), `reopened field ${key}`);
      }
    };
    const subset = (record, expected) => {
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(record[key], value, `saved ${key}`);
    };
    const pass = name => { cases++; console.log(`PASS ${name}`); };

    await open("task", "t");
    await fieldsExactly(TASK_FIELDS);
    assert.equal(await page.locator('[data-action="plan-step-request"][data-id="t"]').count(), 1);
    const taskValues = { title: payload, projectId: "p", parentTaskId: "parent", status: "doing", category: "仕事",
      dueDate: DUE, selfDueEnabled: false, doneCriteria: "完了条件", firstStep: "最初の一歩", aiWork: true,
      aiWorkBrief: "架空作業依頼", planTarget: true, aiBrief: "架空ステップ指示", description: payload,
      twyPerWeek: 4, twyFromWeek: 2, twyToWeek: 9, twyKeystone: true };
    const leverage = await field("leverageType").locator("option").evaluateAll(els => els.find(el => el.value)?.value);
    taskValues.leverageType = leverage;
    await setFields(taskValues); await save(); await reload();
    const task = (await read()).tasks.find(row => row.id === "t");
    subset(task, { title: payload, projectId: "p", parentTaskId: "parent", status: "doing", category: "仕事", dueDate: DUE,
      selfDueOff: true, doneCriteria: "完了条件", firstStep: "最初の一歩", owner: "ai", aiWork: true,
      aiWorkBrief: "架空作業依頼", planTarget: true, aiBrief: "架空ステップ指示", description: payload, leverageType: leverage,
      estimateMin: 35, priority: "高", order: 1000, progressNum: 2, progressDen: 7, nextRoutineId: "keep-next",
      twyPlan: { perWeek: 4, fromWeek: 2, toWeek: 9, keystone: true } });
    await open("task", "t"); await expectValues(taskValues);
    assert.equal(await page.locator('#modalRoot img[src="x"]').count(), 0);
    // Category's dedicated rerender path must keep the whole draft.
    await field("description").fill("カテゴリ追加中の下書き");
    page.once("dialog", dialog => dialog.dismiss());
    await field("category").selectOption("__ADD_NEW__");
    assert.equal(await field("category").inputValue(), "仕事", "cancel restores data-prev-value");
    page.once("dialog", dialog => dialog.accept("架空追加カテゴリ"));
    await field("category").selectOption("__ADD_NEW__");
    await page.waitForFunction(() => document.querySelector('[data-modal-field="category"]').value === "架空追加カテゴリ");
    assert.equal(await field("description").inputValue(), "カテゴリ追加中の下書き");
    await save();
    subset((await read()).tasks.find(row => row.id === "t"), { category: "架空追加カテゴリ", description: "カテゴリ追加中の下書き" });
    pass("Task: all 19 fields, dedicated category/AI/12-week controls and untouched properties survive save/reload");

    await open("project", "p"); await fieldsExactly(PROJECT_FIELDS);
    await field("is12WY").setChecked(true);
    await modalAction("twy-kind-numeric");
    const projectValues = { title: payload, kind: "normal", status: "paused", priority: "低", category: "仕事",
      startDate: DAY, dueDate: DUE, is12WY: true, showProgress: true, description: payload,
      twyName: "架空数値目標", twyStartDate: DAY, twyBaseline: 3, twyGoal: 15, twyUnit: "章", twyDeadline: DUE, twyStep: 2 };
    await setFields(projectValues); await save(); await reload();
    const projectState = await read(), project = projectState.projects.find(row => row.id === "p");
    subset(project, { title: payload, kind: "normal", status: "paused", priority: "低", category: "仕事",
      startDate: DAY, dueDate: DUE, twelveWeekStartDate: CYCLE, showProgress: true, description: payload });
    subset(projectState.tracks.find(row => row.ownerId === "p" && row.status === "active" && !row.deleted),
      { kind: "numeric", name: "架空数値目標", startDate: DAY, baselineValue: 3, goalValue: 15, unit: "章", deadline: DUE, valueStep: 2 });
    await open("project", "p"); await expectValues(projectValues); assert.equal(await field("twyKind").inputValue(), "numeric");
    for (const attr of ["track", "details", "numeric", "milestone", "ms-list", "errors", "guard"]) {
      assert.equal(await page.locator(`#modalRoot [data-twy-${attr}]`).count(), 1, `track attribute ${attr}`);
    }
    await modalAction("modal-close");
    pass("Project: all 18 fields map to Project/settings/Track and reopen unchanged");

    await open("project", "p2"); await modalAction("twy-kind-milestone");
    await setFields({ twyName: "架空節目", twyStartDate: DAY });
    await modalAction("twy-ms-add");
    await page.locator("[data-twy-ms-label]").fill(payload);
    await page.locator("[data-twy-ms-date]").fill(DUE);
    await modalAction("twy-ms-add");
    await page.locator('[data-action="twy-ms-del"]').last().click();
    assert.equal(await page.locator(".twy-ms-edit-row").count(), 1);
    await modalAction("modal-close"); await page.locator('[data-action="draft-leave-stay"]').click();
    assert.equal(await page.locator("[data-twy-ms-label]").inputValue(), payload);
    await save(); await reload();
    const msTrack = (await read()).tracks.find(row => row.ownerId === "p2" && row.status === "active" && !row.deleted);
    assert.equal(msTrack.kind, "milestone"); assert.equal(msTrack.milestones.length, 1);
    subset(msTrack.milestones[0], { label: payload, plannedDate: DUE }); assert(msTrack.milestones[0].id);
    await open("project", "p2");
    assert.equal(await page.locator(".twy-ms-edit-row").getAttribute("data-twy-ms-id"), msTrack.milestones[0].id);
    assert.equal(await page.locator("[data-twy-ms-label]").inputValue(), payload);
    await modalAction("modal-close");
    pass("Project milestones: add/delete, leave/stay, dedicated values and IDs survive save/reload");

    await open("block", "b"); await fieldsExactly(BLOCK_FIELDS);
    assert.equal(await page.locator('[data-action="block-date-shift"][data-days="1"]').count(), 1);
    assert.equal(await page.locator('[data-action="block-date-shift"][data-days="7"]').count(), 1);
    await page.locator('[data-action="estimate-chip"][data-min="25"]').click();
    assert.equal(await field("estimateMin").inputValue(), "25");
    // The legacy estimate-chip changes only estimateMin; it never rewrites scheduled time.
    assert.equal(await field("plannedEndAt").inputValue(), DAY + "T12:00");
    assert.equal((await read()).blocks.find(row => row.id === "b").estimateMin, 60, "chip edits only the draft");
    await page.locator('[data-action="block-date-shift"][data-days="1"]').click();
    assert.equal(await field("date").inputValue(), dateAt(1));
    assert.equal(await field("plannedStartAt").inputValue(), dateAt(1) + "T11:00");
    const blockValues = { title: payload, category: "仕事", taskId: "linked", isMIT: true, date: dateAt(1),
      plannedStartAt: dateAt(1) + "T13:00", plannedEndAt: dateAt(1) + "T14:00", estimateMin: 45,
      actualStartAt: dateAt(1) + "T13:05", actualEndAt: dateAt(1) + "T13:50", charge: 4, discharge: 3, comment: payload };
    await setFields(blockValues);
    await page.locator("#modalRoot details.tower-fold > summary").click();
    await setFields({ leverageType: leverage, completed: false }); await save(); await reload();
    const block = (await read()).blocks.find(row => row.id === "b");
    subset(block, { ...blockValues, plannedStartAt: blockValues.plannedStartAt + ":00", plannedEndAt: blockValues.plannedEndAt + ":00",
      actualStartAt: blockValues.actualStartAt + ":00", actualEndAt: blockValues.actualEndAt + ":00",
      everStartedAt: blockValues.actualStartAt + ":00", leverageType: leverage, completed: false });
    await open("block", "b"); await expectValues(blockValues); await modalAction("modal-close");
    pass("Block: all single-item fields, numeric kinds, estimate/date buttons map to saved values");

    // Keep recurring fixtures isolated from the earlier single-item assertions.
    await page.evaluate(({ key, day }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.recurrences = ["r", "anchor"].map(id => ({ id, title: `架空系列 ${id}`, kind: "daily", category: "ルーティン",
        startDate: day, startTime: "15:00:00", endTime: "15:30:00", expectedCharge: 1, expectedDischarge: 2, exceptionDates: [] }));
      s.blocks.push({ id: "rb", title: "架空繰返し", date: day, category: "ルーティン", recurrenceGroupId: "r",
        plannedStartAt: day + "T15:00:00", plannedEndAt: day + "T15:30:00", completed: false });
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, day: DAY });
    await reload(); await open("block", "rb");
    await fieldsExactly([...BLOCK_FIELDS, "streakFixed", "expectedCharge", "expectedDischarge", "anchor"]);
    await setFields({ streakFixed: true, expectedCharge: 5, expectedDischarge: 4, anchor: "anchor" });
    await save(); await reload();
    const recurring = await read(), rule = recurring.recurrences.find(row => row.id === "r");
    subset(rule, { kind: "daily", expectedCharge: 5, expectedDischarge: 4, anchor: "anchor" });
    assert(rule.streakSince);
    subset(recurring.blocks.find(row => row.id === "rb"), { expectedCharge: 5, expectedDischarge: 4 });
    await open("block", "rb");
    await expectValues({ recurrenceKind: "__keep__", streakFixed: true, expectedCharge: 5, expectedDischarge: 4, anchor: "anchor" });
    await field("recurrenceKind").selectOption("weekdays"); await save();
    assert.equal((await read()).recurrences.find(row => row.id === "r").kind, "weekdays");
    await open("block", "rb"); await field("recurrenceKind").selectOption("__end__"); await save();
    const endedSeries = await read();
    assert.equal(endedSeries.recurrences.find(row => row.id === "r").deleted, true);
    assert(endedSeries.habitPinHistory.r.some(period => period.from === rule.streakSince));
    pass("Block recurrence: keep/change/end, fixed history, expected energy and anchor keep their save destinations");

    // Invalid input is rejected by the existing save boundary, with the same form still available.
    await open("block", "b"); const beforeInvalid = (await read()).blocks.find(row => row.id === "b");
    await field("plannedEndAt").fill(""); await field("comment").fill("不正入力でも保持");
    await modalAction("modal-save");
    assert.equal(await field("comment").inputValue(), "不正入力でも保持");
    assert.deepEqual((await read()).blocks.find(row => row.id === "b"), beforeInvalid);
    await modalAction("modal-close"); await page.locator('[data-action="draft-leave-discard"]').click();
    await open("project", "p"); const beforeTrack = (await read()).tracks;
    await field("twyStep").fill("0"); await modalAction("modal-save");
    assert(await page.locator("[data-twy-errors]").isVisible());
    assert.deepEqual((await read()).tracks, beforeTrack);
    await modalAction("modal-close"); await page.locator('[data-action="draft-leave-discard"]').click();
    pass("Invalid Block/Track inputs reject persistence and keep editable input/errors");

    for (const [kind, id, memo, collection] of [["task", "t", "description", "tasks"], ["project", "p", "description", "projects"], ["block", "b", "comment", "blocks"]]) {
      await open(kind, id); const before = (await read())[collection].find(row => row.id === id);
      await field(memo).fill(`失敗しても残る ${kind}`);
      await field(memo).evaluate(el => { window.__draftInput = el; el.setSelectionRange(1, 3); });
      await page.evaluate(key => {
        window.__set = Storage.prototype.setItem; window.__attempts = 0;
        Storage.prototype.setItem = function(k, v) {
          if (k === key) { window.__attempts++; throw new DOMException("fixture quota", "QuotaExceededError"); }
          return window.__set.call(this, k, v);
        };
      }, STATE_KEY);
      await modalAction("modal-close"); await page.locator('[data-action="draft-leave-save"]').click();
      assert.equal(await page.evaluate(() => window.__attempts), 1);
      assert.equal(await field(memo).inputValue(), `失敗しても残る ${kind}`);
      assert(await field(memo).evaluate(el => el === window.__draftInput && el === document.activeElement && el.selectionStart === 1 && el.selectionEnd === 3));
      assert.deepEqual((await read())[collection].find(row => row.id === id), before);
      assert.deepEqual(await page.evaluate(async ({ collection, id }) =>
        (await import("/src/state/store.js")).state[collection].find(row => row.id === id), { collection, id }), before);
      await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
      await save(); await reload();
      assert.equal((await read())[collection].find(row => row.id === id)[memo], `失敗しても残る ${kind}`);
      pass(`${kind}: injected storage failure rolls back state and keeps DOM, focus, selection; retry persists`);
    }

    await dispatchRegisteredAction(page, "add-subtask", { parentTask: "t" });
    await field("title").waitFor();
    await fieldsExactly([...TASK_FIELDS.filter(key => key !== "aiBrief"), "order"]);
    assert.equal(await page.locator('#modalRoot [data-action="modal-delete"]').count(), 0);
    assert.equal(await field("order").getAttribute("data-modal-kind"), "number");
    const nextOrder = Number(await field("order").inputValue());
    await field("title").fill("架空の新規サブTask"); await save();
    subset((await read()).tasks.find(row => row.title === "架空の新規サブTask"), { parentTaskId: "t", projectId: "p", order: nextOrder });
    await dispatchRegisteredAction(page, "timeline-new-block", { minute: "600" });
    assert.equal(await page.locator('#modalRoot [data-action="modal-delete"]').count(), 0);
    await field("title").fill("架空の新規Block"); await save();
    const newBlock = (await read()).blocks.find(row => row.title === "架空の新規Block");
    subset(newBlock, { date: DAY, plannedStartAt: DAY + "T10:00:00", plannedEndAt: DAY + "T11:00:00" });
    const wish = (await read()).projects.find(row => row.kind === "wish" && !row.deleted);
    assert(wish);
    await open("project", wish.id); assert(await field("kind").isDisabled());
    assert.equal(await page.locator('#modalRoot [data-action="modal-delete"]').count(), 0);
    await field("description").fill("Wishの保存先を保持"); await save();
    subset((await read()).projects.find(row => row.id === wish.id), { kind: "wish", description: "Wishの保存先を保持" });
    pass("New Task/Block modes and numeric order; Wish singleton kind/delete restrictions");

    await page.evaluate(({ key, oldCycle }) => {
      const s = JSON.parse(localStorage.getItem(key));
      for (const project of s.projects.filter(row => ["p", "p2"].includes(row.id))) project.twelveWeekStartDate = oldCycle;
      for (const track of s.tracks.filter(row => ["p", "p2"].includes(row.ownerId))) track.cycleStartDate = oldCycle;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, oldCycle: dateAt(-95) });
    await reload();
    for (const [id, kind] of [["p", "numeric"], ["p2", "milestone"]]) {
      const oldTrack = (await read()).tracks.find(row => row.ownerId === id && row.status === "active");
      await open("project", id);
      for (const attr of ["carry", "carry-form", "carry-numeric", "carry-milestones", "carry-errors"]) {
        assert.equal(await page.locator(`#modalRoot [data-twy-${attr}]`).count(), 1);
      }
      await modalAction("twy-carry-cycle");
      if (kind === "numeric") {
        await page.locator("[data-twy-carry-deadline]").fill(DUE);
        await page.locator("[data-twy-carry-goal]").fill("21");
      } else {
        assert.equal(await page.locator("[data-twy-carry-ms-id]").getAttribute("data-twy-carry-ms-id"), oldTrack.milestones[0].id);
        await page.locator("[data-twy-carry-ms-date]").fill(DUE);
      }
      page.once("dialog", dialog => dialog.accept());
      await modalAction("twy-carry-confirm");
      await page.waitForFunction(() => !document.querySelector("#modalRoot").classList.contains("open"));
      const after = await read(), carried = after.tracks.find(row => row.ownerId === id && row.status === "active");
      assert.equal(after.projects.find(row => row.id === id).twelveWeekStartDate, CYCLE);
      assert.equal(after.tracks.find(row => row.id === oldTrack.id).status, "closed");
      subset(carried, { kind, carriedFromTrackId: oldTrack.id, startDate: CYCLE });
      if (kind === "numeric") subset(carried, { goalValue: 21, deadline: DUE });
      else subset(carried.milestones[0], { label: payload, plannedDate: DUE });
    }
    pass("Project carry: numeric/milestone dedicated attributes and confirmation retain existing transitions");

    for (const width of [390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [kind, id] of [["task", "t"], ["project", "p"], ["block", "b"]]) {
        await open(kind, id);
        const measurement = await page.locator(".daily-detail-frame").evaluate(el => ({
          width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          fields: [...el.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(control => control.getClientRects().length)
            .map(control => ({ key: control.dataset.modalField, font: parseFloat(getComputedStyle(control).fontSize),
              type: control.type, step: control.getAttribute("step"), width: control.getBoundingClientRect().width }))
        }));
        assert(measurement.scrollWidth <= measurement.clientWidth + 1, `${kind} ${width}: no horizontal overflow`);
        assert(measurement.fields.length > 0);
        for (const control of measurement.fields) {
          assert(control.font >= 16 && control.width > 0, JSON.stringify(control));
          if (["time", "datetime-local"].includes(control.type)) assert.equal(control.step, "300");
          if (/^(date|dueDate|startDate|twyStartDate|twyDeadline)$/.test(control.key)) assert.equal(control.type, "date");
        }
        const button = page.locator('#modalRoot [data-action="modal-save"]');
        await button.scrollIntoViewIfNeeded();
        assert(await button.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight; }));
        metrics.push({ kind, viewport: width, ...measurement });
        await modalAction("modal-close");
      }
    }
    if (process.env.DAILY_DETAIL_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.DAILY_DETAIL_EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.DAILY_DETAIL_EVIDENCE_DIR, "layout-metrics.json"), JSON.stringify(metrics, null, 2));
    }
    assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.__injected), undefined);
    pass("Layout: all three frames measured at 390/768/1024/1280px; native date/time, 16px inputs and reachable actions");
    console.log(`RESULT daily-detail-fields-e2e: ${cases} cases passed; Chromium only`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
