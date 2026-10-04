// Order 79 / M2: one scroll page, weekly counts, folded review and responsive placement.
// playwright-core browser and startServer() are provided by shared setup().
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { setup, nav } = require("./remaining-twelveweek-layout.test");
const { STATE_KEY, fixedClock, setViewportAndWaitForStableLayout } = require("./helpers");
(async () => {
  const { addDaysISO, weekStartOfISO } = await import("../src/core/plan.js");
  const now = new Date(), date = [now.getFullYear(), String(now.getMonth()+1).padStart(2,"0"), String(now.getDate()).padStart(2,"0")].join("-");
  const saturday = weekStartOfISO(date), friday = addDaysISO(saturday, 6), week = addDaysISO(saturday, 7);
  const { page, browser, server } = await setup();
  try {
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.clock.setFixedTime(fixedClock(`${friday}T10:00:00+09:00`)());
    await page.evaluate(({ key, week, saturday, friday, monday }) => {
      const s = JSON.parse(localStorage.getItem(key)), stamp = `${saturday}T08:00:00`;
      s.currentView = "twelveweek"; s.selectedDate = friday; s.settings.twelveWeekStartDate = saturday;
      s.projects = [...s.projects.filter(p => ["wish","other"].includes(p.kind)), ...["a","b"].map(id => ({ id, title:`目標${id}`, kind:"normal", status:"active", twelveWeekStartDate:saturday, deleted:false, createdAt:stamp, updatedAt:stamp }))];
      s.tasks = [...s.tasks.filter(t => t.kind === "other"), ...["a","b","off","deleted"].map(id => ({ id, projectId:id === "b" ? "b" : "a", title:`目標${id}`, kind:"normal", status:"todo", selfDueOff:true, deleted:id === "deleted", createdAt:stamp, updatedAt:stamp, twyPlan:{perWeek:id === "off" ? 0 : 7, fromWeek:1, toWeek:12} }))];
      s.blocks = Array.from({length:19}, (_,i) => ({ id:`m2-${i}`, taskId:i < 10 ? "a" : "b", title:`コマ${i}`, date:i < 2 ? monday : week, plannedStartAt:`${week}T07:00:00`, plannedEndAt:`${week}T07:25:00`, completed:i < 12, deleted:false, createdAt:stamp, updatedAt:stamp }));
      s.blocks.push(...["off","deleted","missing"].map(taskId => ({id:taskId, taskId, date:week, completed:true, deleted:false, createdAt:stamp, updatedAt:stamp})));
      s.recurrences = []; s.weeklyCommitments = []; s.tracks = []; s.trackMeasurements = []; s.twyWeeklyReviews = [];
      localStorage.setItem(key, JSON.stringify(s));
    }, { key:STATE_KEY, week, saturday, friday, monday:addDaysISO(week,2) });
    await page.reload(); await nav(page, "twelveweek");
    const root = page.locator(".twy-tower");
    // M2-1
    assert.deepEqual(await root.locator(":scope > section > h2, :scope > details > summary > h2").evaluateAll(els => els.map(el => el.firstChild.textContent.split(" — ")[0].trim())), ["今週を決める", "今週のできた", "積み上げ", "ふりかえる", "12週の目標と進み具合"]);
    assert.equal(await root.locator("[data-face], .twy-face-segmented").count(), 0);
    console.log("PASS M2-1: five sections in DOM order, no faces");
    // M2-2
    assert.equal(await root.locator(".twy-done").getAttribute("data-week"), week);
    assert.match(await root.locator(".twy-done").innerText(), /できた 12\/19/);
    assert.equal(await root.locator("[data-done-percent]").innerText(), "63%");
    assert.deepEqual(await root.locator(".twy-done-days small").allTextContents(), ["10回","0回","2回","0回","0回","0回","0回"]);
    assert.deepEqual(await root.locator("[data-done-project]").allTextContents(), ["目標a · できた 10/10", "目標b · できた 2/9"]);
    assert.doesNotMatch(await root.innerText(), /今日のコマ|落ちたコマ/);
    console.log("PASS M2-2: block score, seven days, goal rows");
    // M2-3 (calculation boundaries live in twy-stack-core)
    assert.equal(await root.locator(".twy-stack-bars [role=img]").count(), 7);
    assert.equal(await root.locator('.twy-stack-bars [aria-label="月曜 2 回"]').count(), 1);
    assert.equal(await root.locator(".twy-stack-ring strong").innerText(), "12/19");
    console.log("PASS M2-3: accessible bars and count ring");
    // M2-4
    const review = root.locator(".twy-review-fold");
    assert.equal(await review.getAttribute("open"), null);
    assert.match(await review.locator(":scope > summary").innerText(), /未記録/);
    await review.locator(":scope > summary").click();
    for (const selector of [".twy-review-score", ".twy-review-results", ".twy-review-finish"]) assert.equal(await review.locator(selector).isVisible(), true);
    await review.locator(":scope > summary").click();
    console.log("PASS M2-4: review closed by default, all existing sections retained");
    // M2-9: cycle starts closed and preserves its open state across rendering.
    const cycle = root.locator(".twy-cycle-fold");
    assert.equal(await cycle.getAttribute("open"), null);
    await cycle.locator(":scope > summary").click();
    await page.evaluate(async () => {
      document.querySelector(".twy-tower").outerHTML = (await import("/src/features/twelve-week.js")).renderTwelveWeek();
    });
    assert.equal(await cycle.evaluate(el => el.open), true);
    await cycle.locator(":scope > summary").click();
    console.log("PASS M2-9: cycle initially closed, stays open after rendering");
    // M2-5 / M2-7
    for (const committed of [true, false]) {
      const label = committed ? "通常週" : "未確定週";
      const before = await page.evaluate(async ({ key, week, saturday, committed }) => {
        const { state } = await import("/src/state/store.js");
        const stamp = `${saturday}T08:00:00`;
        state.weeklyCommitments = committed ? [{ id:`wcw_${week}`, recordType:"week", weekStart:week,
          cycleStartDate:saturday, committedAt:stamp, createdAt:stamp, updatedAt:stamp, deleted:false }] : [];
        localStorage.setItem(key, JSON.stringify(state));
        window.__m2SetItemCalls = [];
        window.__m2OriginalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, v) {
          if (this === localStorage) window.__m2SetItemCalls.push(k);
          return window.__m2OriginalSetItem.call(this, k, v);
        };
        return { state:JSON.stringify(state), storage:JSON.stringify(Object.entries(localStorage).sort()) };
      }, { key:STATE_KEY, week, saturday, committed });
      try {
        await page.evaluate(async () => {
          document.querySelector(".twy-tower").outerHTML = (await import("/src/features/twelve-week.js")).renderTwelveWeek();
        });
        assert.equal(await review.getAttribute("open"), null);
        await review.locator(":scope > summary").click();
        assert.equal(await review.locator(".twy-review-score").isVisible(), true);
        await review.locator(":scope > summary").click();
        assert.equal(await review.getAttribute("open"), null);
        for (const width of [375,768,1280]) {
          await setViewportAndWaitForStableLayout(page, {width,height:1000}, ".twy-tower > *");
          const bounds = await root.evaluate(el => ({ scroll:document.documentElement.scrollWidth, width:innerWidth, decide:el.querySelector(".twy-decide").getBoundingClientRect().toJSON(), stack:el.querySelector(".twy-stack").getBoundingClientRect().toJSON(), lower:[".twy-done",".twy-review-fold",".twy-cycle-fold"].map(selector=>el.querySelector(selector).getBoundingClientRect().toJSON()) }));
          assert.ok(bounds.scroll <= width, `${width}: no overflow`);
          if (width === 1280) { assert.ok(bounds.stack.left >= bounds.decide.right); assert.equal(bounds.stack.top,bounds.decide.top); assert.ok(bounds.lower.every(box=>box.top >= Math.max(bounds.decide.bottom,bounds.stack.bottom)), "M2-5: done/review/cycle below decide and stack"); }
          else assert.ok(bounds.stack.top >= bounds.decide.bottom);
        }
        const after = await page.evaluate(async () => ({
          state:JSON.stringify((await import("/src/state/store.js")).state),
          storage:JSON.stringify(Object.entries(localStorage).sort()), writes:window.__m2SetItemCalls
        }));
        assert.equal(after.state, before.state, `${label}: 描画・開閉・リサイズでstate不変`);
        assert.equal(after.storage, before.storage, `${label}: 保存領域不変`);
        assert.deepEqual(after.writes, [], `${label}: localStorage.setItem呼出なし`);
      } finally {
        await page.evaluate(() => {
          Storage.prototype.setItem = window.__m2OriginalSetItem;
          delete window.__m2OriginalSetItem; delete window.__m2SetItemCalls;
        });
      }
      console.log(`PASS M2-5 / M2-7: ${label}, responsive placement, no state/storage writes`);
    }
    // M2-6
    const source = fs.readFileSync(path.join(__dirname,"../src/features/twelve-week.js"),"utf8");
    assert.doesNotMatch(source, /twyWeek(?:FaceHTML|TodayHTML|MissedHTML|ScoreHTML|ProjectTag|ThemeCardHTML)|twy-face-select|twyDefaultFace|_twyActiveFace|TWY_FACES/);
    const css = fs.readFileSync(path.join(__dirname,"../styles.css"),"utf8");
    assert.doesNotMatch(css, /\.twy-face-|\.twy-week-(?:today|missed|theme|cols|task|short|days|outlook|commit|legend)/);
    assert.deepEqual(errors, []);
    console.log("PASS M2-6: obsolete rendering and CSS removed");
    for (let n=1;n<=10;n++) await require("./twy-decide-face.test").runCardAcceptance(page,n);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
