// v335(§C): 実行タブ — PCサイドバー/「その他」メニューの「タスクシュート」「タイムライン」を
// 「実行」1項目へ統合し、残っていた旧setView("tasks"/"timeline")呼び出し元
// (energy-open-category・AI下書きスケジュール確定)をexecへ寄せる。v333/v334で2版連続持ち越し
// だった§Cの回収版(review-v333-claude-a.md M-4)。
//
// (1) PCサイドバー「実行」1項目・旧2項目なし。「その他」メニューにも「タスクシュート」
//     「タイムライン」が無い(単独項目としては元々moreItemsに含まれていなかったことも確認する)
// (2) 寄せた導線(energy-open-category・rail「開く」・AI下書きスケジュール確定)がexecに着地し、
//     モードが仕様どおり(energy-open-categoryは実績、AI下書きスケジュール確定は計画)になる
// (3) 旧setView("tasks"/"timeline")を直接呼んでもpageerror 0で、ナビの「実行」がアクティブになる
//     (どのボタンもアクティブでない画面を作らない、review-v333-claude-a.md M-4対応)
// (4) 1280px/390px横スクロールなし・state非書込(内容変更0回方式)
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, dispatchRegisteredAction
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return {
    id, title: "プロジェクトA", kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}
function task(id, extra = {}) {
  return {
    id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}
function block(id, taskId, extra = {}) {
  return {
    id, taskId, date: TODAY, title: id, category: "仕事",
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false, isMIT: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}

async function resetSetItemLog(page) {
  await page.evaluate(() => { window.__setItemChanges = []; });
}
async function contentChangingWrites(page, key) {
  return page.evaluate((k) => (window.__setItemChanges || []).filter((x) => x === k).length, key);
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
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__setItemChanges = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        const prev = this.getItem(key);
        if (prev !== value) window.__setItemChanges.push(key);
      } catch (_e) { /* noop */ }
      return orig.call(this, key, value);
    };
  });

  try {
    await page.clock.setFixedTime(FIXED_NOW);
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    await seed(page, {
      selectedDate: TODAY,
      projects: [project("p1")],
      tasks: [task("t1"), task("t2")],
      blocks: [block("b1", "t1"), block("b2", "t2", {
        plannedStartAt: `${TODAY}T10:00:00`, plannedEndAt: `${TODAY}T10:30:00`
      })],
      currentView: "exec"
    });

    // ============================================================
    // [1] PCサイドバー「実行」1項目・旧2項目なし。「その他」メニューにも旧2項目が無い
    // ============================================================
    console.log("[1] PCサイドバー「実行」1項目・旧2項目なし、「その他」メニューにも旧2項目が無い");
    check("サイドバーに「実行」ナビ項目がある",
      await page.locator('#sidebar [data-action="nav"][data-view="exec"]').count() === 1);
    check("サイドバーに旧「タスクシュート」項目が無い",
      await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').count() === 0);
    check("サイドバーに旧「タイムライン」項目が無い",
      await page.locator('#sidebar [data-action="nav"][data-view="timeline"]').count() === 0);
    await page.click('#sidebar [data-action="nav"][data-view="more"]');
    await page.waitForTimeout(150);
    const moreText = await page.locator("main").textContent();
    check("「その他」グリッドに「タスクシュート」ラベルが無い", !moreText.includes("タスクシュート"));
    check("「その他」グリッドに単独の「タイムライン」ラベルが無い", !moreText.includes("タイムライン"));
    check("「その他」グリッドから旧tasks/timeline直接navは無い",
      await page.locator('.more-tower-item[data-view="tasks"], .more-tower-item[data-view="timeline"]').count() === 0);

    // ============================================================
    // [2] 寄せた導線がexecに着地し、モードが仕様どおりになる
    // ============================================================
    console.log("[2] 寄せた導線(energy-open-category・rail開く・AI下書きスケジュール確定)がexecへ着地する");
    await seed(page, { currentView: "today" });
    await dispatchRegisteredAction(page, "energy-open-category", { cat: "仕事" });
    await page.waitForTimeout(150);
    check("energy-open-category実行後はexecへ着地する(app.js:1064付近)",
      await page.evaluate(() => document.querySelector("#app").dataset.view) === "exec");
    check("energy-open-categoryは実績モードで開く(執行§Cの寄せ先仕様)",
      await page.locator(".exec-mode-segmented .active").textContent().then((t) => t.includes("実績")));

    await seed(page, { currentView: "exec" });
    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForTimeout(100);
    await page.click('[data-action="nav"][data-view="exec"][data-mode="actual"]').catch(() => {});
    // タイムラインrail(1020px超・execの計画モードでは非表示のまま。§C対応外)からの「開く」は
    // v333で既にdata-view="exec" data-mode="actual"へ更新済み。ここでは同じdata-action="nav"の
    // 動作契約(mode指定つきnavが即座に反映される)をrailと同一のマークアップで直接検証する。
    await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.dataset.action = "nav"; btn.dataset.view = "exec"; btn.dataset.mode = "actual";
      btn.hidden = true;
      document.body.appendChild(btn);
      btn.click();
      btn.remove();
    });
    await page.waitForTimeout(100);
    check("data-mode=\"actual\"付きnav(railと同型)は実績モードでexecへ着地する",
      await page.evaluate(() => document.querySelector("#app").dataset.view) === "exec"
      && (await page.locator(".exec-mode-segmented .active").textContent()).includes("実績"));

    await seed(page, { currentView: "today" });
    await dispatchRegisteredAction(page, "ai-schedule");
    await page.waitForTimeout(300);
    check("AI下書きスケジュール確定後はexecへ着地する(app.js:3898付近)",
      await page.evaluate(() => document.querySelector("#app").dataset.view) === "exec");
    check("AI下書きスケジュール確定は計画モードで開く(state.timelineMode=\"planned\"のドラッグ調整UIを活かすため)",
      await page.locator(".exec-mode-segmented .active").textContent().then((t) => t.includes("計画")));
    check("AI下書きスケジュール確定直後、state.timelineModeは\"planned\"のまま",
      await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).timelineMode, STATE_KEY) === "planned");

    // ============================================================
    // [3] 旧setView("tasks"/"timeline")を直接呼んでも壊れず、ナビの「実行」がアクティブになる
    // ============================================================
    console.log("[3] 旧tasks/timelineビューへ直接setViewしても壊れず、ナビ「実行」がアクティブになる");
    for (const oldView of ["tasks", "timeline"]) {
      await seed(page, { currentView: oldView });
      check(`旧${oldView}ビューへ直接着地してもpageerrorが増えない`, pageErrors.length === 0, JSON.stringify(pageErrors));
      check(`旧${oldView}ビュー滞在中、サイドバー「実行」がactiveになる(M-4対応)`,
        await page.locator('#sidebar [data-action="nav"][data-view="exec"].active').count() === 1);
      const mainHTML = await page.locator("#main").innerHTML();
      check(`旧${oldView}ビュー自体はrender()の分岐に残っており描画される`, mainHTML.trim().length > 0);
    }
    // モバイル幅でも同じ契約(bottom-nav側)を確認する。
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, { currentView: "tasks" });
    check("モバイル幅でも旧tasksビュー滞在中はbottom-navの「実行」がactiveになる",
      await page.locator('#bottomNav [data-action="nav"][data-view="exec"].active').count() === 1);
    check("モバイル幅で旧ビュー滞在中にpageerrorが増えない", pageErrors.length === 0, JSON.stringify(pageErrors));

    // ============================================================
    // [4] 横スクロールなし・state非書込
    // ============================================================
    console.log("[4] 1280px/390px横スクロールなし・state非書込(内容変更0回方式)");
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page, { currentView: "exec" });
    const scrollW1280 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW1280 = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280pxで横スクロールが発生しない", scrollW1280 <= clientW1280 + 1, `${scrollW1280} vs ${clientW1280}`);

    await resetSetItemLog(page);
    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForTimeout(100);
    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForTimeout(100);
    check("計画⇔実績モード切替はstateへ書き込まない(内容変更0回)",
      await contentChangingWrites(page, STATE_KEY) === 0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const scrollW390 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW390 = await page.evaluate(() => document.documentElement.clientWidth);
    check("390pxで横スクロールが発生しない", scrollW390 <= clientW390 + 1, `${scrollW390} vs ${clientW390}`);

    check("一連の操作でpageerrorが発生しない(最終確認)", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
