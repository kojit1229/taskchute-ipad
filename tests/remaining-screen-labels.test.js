// playwright-core via shared setup. Remaining screen labels: twelve-week controls and Japanese guidance; responsive browser coverage.
const assert = require("node:assert/strict");
const { setup, nav } = require("./remaining-twelveweek-layout.test");
async function twelveWeek(page) {
  await nav(page, "twelveweek");
  const root = page.locator(".twy-tower");
  assert.ok((await root.innerText()).includes("12週間実行サイクル"));
  assert.equal(await root.locator("h1").innerText(), "12週計画");
  assert.equal(await root.locator(".twy-face-segmented").getAttribute("aria-label"), "12週計画の面切替");
  assert.deepEqual(await root.locator(".twy-face-segmented button").evaluateAll(nodes => nodes.map(n => n.firstChild.textContent)),
    ["サイクル", "計画", "今週", "振り返り"]);
  assert.deepEqual(await root.locator(".twy-face-segmented button:disabled small").allTextContents(), ["準備中", "準備中"]);
  assert.deepEqual(await root.locator("h2").evaluateAll(nodes => nodes.map(n => n.firstChild.textContent)),
    ["ビジョン", "12週の目標", "12週と振り返り週"]);
  assert.equal(await root.locator(".twy-goal-no-track").innerText(), "進捗の記録が未設定");
  assert.ok((await root.locator(".twy-goal-act").innerText()).includes("★ 重要な行動: 毎週の作業"));
  assert.deepEqual(await root.locator(".twy-week-lab").allTextContents(), Array.from({ length: 13 }, (_, i) => `${i + 1}週`));
  assert.ok((await root.locator(".twy-week-lab").last().getAttribute("title")).startsWith("13週・振り返り("));
  assert.equal(await root.locator('[data-action="twy-face-select"]').count(), 2);
  assert.equal(await root.locator(".twy-face-segmented button:disabled").count(), 2);
  for (const [action, text] of [["twy-vision-open", "架空の3年ビジョン"], ["twy-open-commit", "今週を確定"]]) {
    assert.ok((await root.locator('[data-action="' + action + '"]').innerText()).includes(text));
  }
  await root.locator('[data-action="twy-vision-open"]').click();
  assert.equal(await page.locator('[role="dialog"] .modal-title').innerText(), "ビジョン");
  assert.ok(await page.locator('[data-action="twy-vision-save"]').isVisible());
  const closeButtons = page.locator('[data-action="modal-close"]');
  assert.equal(await closeButtons.count(), 2);
  for (const button of await closeButtons.all()) assert.ok(await button.isVisible());
  await page.locator('[data-action="modal-close"]').first().click();
  await root.locator('[data-action="twy-open-commit"]').click();
  assert.ok(await page.getByText(/^今週の確定分 /).isVisible());
  assert.equal(await page.locator(".twy-commit-meta").innerText(), "今週の12週のプロジェクトに確定できる予定がありません。");
  await page.locator('[data-action="modal-close"]').first().click();
  await root.locator('[data-action="twy-face-select"][data-face="plan"]').click();
  assert.deepEqual(await root.locator("h2").allTextContents(), ["計画と記録のつながり", "12週の計画", "目安なし"]);
  assert.deepEqual(await root.locator(".twy-plan-link-label").allTextContents(),
    ["12週のプロジェクト", "タスク", "予定・実行記録", "今週の確定分", "今週の進み具合"]);
  assert.deepEqual(await root.locator(".twy-plan-link-edit").allTextContents(),
    ["作業一覧", "作業一覧", "タイムライン", "今週を確定", "サイクル"].map(label => `編集する画面: ${label} ›`));
  assert.deepEqual(await root.locator(".twy-plan-grid thead th").allTextContents(),
    ["行動", ...Array.from({ length: 12 }, (_, i) => `${i + 1}週`), "累計/残"]);
  assert.equal(await root.locator(".twy-plan-task-name").innerText(), "★ 重要な行動: 毎週の作業");
  assert.equal(await root.locator(".twy-plan-link-edit").count(), 5);
  for (const [selector, count] of [
    ['.twy-plan-link-edit[data-action="nav"][data-view="wbs"]', 2],
    ['.twy-plan-link-edit[data-action="nav"][data-view="timeline"]', 1],
    ['.twy-plan-link-edit[data-action="twy-open-commit"]', 1],
    ['.twy-plan-link-edit[data-action="twy-face-select"][data-face="cycle"]', 1]
  ]) assert.equal(await root.locator(selector).count(), count);
  assert.equal(await root.locator(".twy-plan-grid th").count(), 14);
  assert.equal(await root.locator(".twy-plan-cell").count(), 12);
  assert.ok((await root.locator(".twy-plan-none-panel").innerText()).includes("目安なし"));
  assert.equal(await root.locator('[data-action="edit-task"][data-id="layout-no-plan"]').innerText(), "目安を設定 ›");
  console.log("PASS twelve-week: headings, both faces, all existing controls and 12 columns");
}

async function healthJapanese(page) {
  const days = Array.from({ length: 8 }, (_, i) => ({
    date: "2026-07-" + String(18 + i), sleep_min: i === 7 ? 450 : 420,
    bed_time: "22:00", wake_time: "05:30", resting_hr: i === 7 ? 73 : 60,
    hrv_sdnn: i === 7 ? 80 : 100, steps: 7000, exercise_min: 30,
    active_kcal: 400, weight_kg: null
  }));
  let failFetch = false;
  await page.route(url => url.pathname.endsWith("/karada/health-daily.json"), route =>
    route.fulfill({ status: failFetch ? 500 : 200, contentType: "application/json",
      body: failFetch ? "{}" : JSON.stringify({ schema: 1, generated_at: "2026-07-25T08:00:00", days }) }));
  const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith("/karada/health-daily.json"));
  await page.reload(); await response;
  await nav(page, "instruments");
  await page.waitForFunction(() => document.querySelectorAll(".instr-kpi").length === 6);
  const root = page.locator(".instr-view");
  assert.equal(await root.locator("h1").innerText(), "健康");
  const text = await root.innerText();
  for (const expected of ["7時間30分", "安静時心拍数", "拍/分", "心拍変動", "ミリ秒", "キロカロリー",
    "直近7日", "欠測 0日", "早起き(06:00まで)", "月別の積み上げ", "記録した日時が今年のセットのみ"]) assert.ok(text.includes(expected), expected);
  assert.ok((await root.locator(".instr-condition-text").innerText()).includes("心拍変動 −20% が低めです。"));
  assert.ok(await root.locator('[data-action="karada-import"]').isVisible());
  assert.equal(await root.locator('button[data-action="instruments-open-iron-log"]').innerText(), "筋トレの記録を開く ›");
  const checks = await page.evaluate(async days => {
    const health = await import("/src/features/health.js");
    const cond = health.conditionFromHealth(days, "2026-07-25");
    return { reasons: cond.reasons, level: cond.level,
      summary: health.healthSummaryHTML("2026-07-25", true),
      stale: health.healthSummaryHTML("2026-07-27"),
      missing: health.healthSummaryHTML("2026-07-26", true),
      comment: health.conditionCommentText({ ...cond, reasons: ["HR +13bpm"] }),
      low: health.conditionCommentText({ ...cond, level: "low", sleepMin: 380 }),
      unknown: health.conditionCommentText({ level: "unknown" }) };
  }, days);
  assert.equal(checks.level, "deficit");
  assert.ok(checks.reasons.includes("HRV −20%"));
  assert.ok(checks.reasons.includes("HR +13bpm"));
  for (const expected of ["安静時心拍数 73拍/分", "心拍変動 80ミリ秒", "歩数 7,000歩", "体重 —kg", "07-25時点"])
    assert.ok(checks.summary.includes(expected), expected);
  assert.ok(checks.stale.includes("07-25時点 (古い)"));
  assert.ok(checks.missing.includes("健康データ 未取得"));
  assert.ok(checks.comment.startsWith("安静時心拍数 +13拍/分 が高めです。"));
  assert.ok(checks.low.includes("睡眠 6時間20分。") && checks.low.includes("最も大切なことを優先"));
  assert.equal(checks.unknown, "今朝の睡眠データはまだありません");
  failFetch = true;
  const failed = await page.evaluate(async () => {
    const health = await import("/src/features/health.js");
    const result = await health.forceHealthData();
    return { ok: result.ok, summary: health.healthSummaryHTML("2026-07-25", true) };
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.summary, checks.summary, "failed fetch retains the previous values");
  await root.locator('button[data-action="instruments-open-iron-log"]').click();
  await page.waitForSelector('#app[data-view="iron-log"]', { state: "attached" });
  await nav(page, "instruments");
  assert.equal(await page.locator(".instr-view h1").innerText(), "健康");
  await nav(page, "today");
  // 4回-08 日本語化の契約追随(監督者決定 2026-09-10)
  assert.equal(await page.locator(".tower-condition").count(), 1, "Today condition panel count matches the baseline");
  assert.equal(await page.locator(".tower-condition > .tower-condition-label").count(), 1);
  assert.equal(await page.locator(".tower-condition > .tower-condition-text").count(), 1);
  assert.equal(await page.locator(".tower-condition > .tower-condition-meta").count(), 1);
  console.log("PASS health: Japanese labels/units/reasons, raw HR/HRV reasons, missing/stale/failed values and controls");
}

async function fundJapanese(page) {
  const date = "2026-07-25", previous = "2026-07-24", generatedAt = "2026-07-25T00:00:00Z";
  const individual = engine => ({ version: 1, generatedAt, engine: { id: engine, actualModel: "fixture", costUsd: null },
    start: { date: previous, capital: 100 }, nav: { current: engine === "fable" ? 90 : 110, dayChangePct: 0,
      totalReturnPct: engine === "fable" ? -10 : 10, series: [{ date: previous, nav: 100, n225: null, spx: null },
        { date, nav: engine === "fable" ? 90 : 110, n225: null, spx: null }] }, cash: 50,
    benchmark: { n225ReturnPct: null, spxReturnPct: null, excessVsN225: null, excessVsSpx: null },
    positions: [], openOrders: [], recentTrades: [], journal: { date, markdown: "架空の" + engine + "日誌" } });
  const files = new Map([
    ["dashboard/fund.json", individual("fable")], ["dashboard/fund-codex.json", individual("codex")],
    ["dashboard/fund-codex-status.json", { version: 1, engine: "codex", status: "not_started", checkedAt: generatedAt, lastAttemptAt: null, lastSuccessAt: null }],
    ["dashboard/fund-comparison.json", { version: 1, generatedAt, status: "ready", startDate: previous, valuationDate: date,
      series: [{ date: previous, fable: 100, codex: 100 }, { date, fable: 90, codex: 110 }],
      metrics: { fable: { returnPct: -10, maxDrawdownPct: -10 }, codex: { returnPct: 10, maxDrawdownPct: 0 } }, codexMinusFablePctPoints: 20 }]
  ]);
  for (const engine of ["FABLE", "CODEX"]) for (const day of [previous, date]) {
    files.set(engine + " FUND日誌_" + day + ".md", engine + "の架空日誌 " + day);
    files.set("朝の投資ブリーフ_" + (engine === "CODEX" ? "CODEX_" : "") + day + ".md", engine + "の架空ブリーフ " + day);
  }
  files.set("report-index.json", { generatedAt, files: [...files.keys()].filter(name => name.endsWith(".md")).map(name => ({ name })) });
  await page.route(url => url.hostname === "api.github.com", route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname).split("/contents/taskchute/")[1];
    if (!name) return route.fallback();
    assert.equal(route.request().method(), "GET", "synthetic fund reads never write");
    const value = files.get(name);
    return route.fulfill({ status: value === undefined ? 404 : 200,
      contentType: typeof value === "string" ? "text/plain" : "application/json",
      body: typeof value === "string" ? value : JSON.stringify(value ?? {}) });
  });
  // 4回-10 追記2: fund-integration-e2eと同じ保存前提・可視ナビ・取得完了条件を使う。
  await page.evaluate(({ key, date }) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.currentView = s.view = "journal";
    s.selectedDate = date;
    s.journals[date] = "架空の日報";
    s.settings.autoSync = false;
    Object.assign(s.settings.github, { token: "synthetic-only", dataOwner: "fixture-owner",
      dataRepo: "fixture-repo", branch: "main", autoSave: false });
    localStorage.setItem(key, JSON.stringify(s));
  }, { key: require("./helpers").STATE_KEY, date });
  await page.reload();
  await page.locator('[data-action="nav"]:visible').first().waitFor();
  let fundButton = page.locator('[data-action="nav"][data-view="fund"]:visible').first();
  if (!await fundButton.count()) {
    await page.locator('[data-action="nav"][data-view="more"]:visible').first().click();
    fundButton = page.locator('[data-action="nav"][data-view="fund"]:visible').first();
  }
  await fundButton.click();
  await page.waitForFunction(() => document.getElementById("app").dataset.view === "fund");
  await page.locator(".fund-content").getByText("+20.00ポイント", { exact: false }).waitFor();
  const root = page.locator(".fund-view");
  assert.equal(await root.locator("h1").innerText(), "資産");
  assert.equal(await root.locator(".eyebrow").innerText(), "模擬運用");
  assert.equal(await root.locator(".fund-switches").getAttribute("aria-label"), "資産の表示");
  assert.deepEqual(await root.locator(".fund-switches button").allTextContents(), ["比較", "FABLE", "CODEX"]);
  assert.equal(await root.locator('[data-action="fund-refresh"]').innerText(), "再取得");
  assert.equal(await root.locator('.fund-compare-cards [data-action="fund-select"]').count(), 2);
  assert.equal(await root.locator('.fund-compare-cards [data-action="fund-report-open"]').count(), 2);
  assert.equal(await root.locator(".fund-chart summary").innerText(), "評価日ごとの値を見る");
  for (const engine of ["fable", "codex"]) {
    await root.locator('.fund-switches [data-engine="' + engine + '"]').click();
    assert.equal(await root.locator(".fund-status h2").innerText(), engine.toUpperCase() + " FUND");
    assert.ok((await root.innerText()).includes("成績の正常取得時刻（協定世界時・UTC）"));
    assert.ok((await root.innerText()).includes("保有銘柄はありません"));
    assert.equal(await root.locator('.fund-report-links [data-action="fund-report-open"]').count(), 3);
    assert.equal(await root.locator('.fund-report-links [data-family="brief"]').innerText(), date + "の朝ブリーフ");
    assert.equal(await root.locator('.fund-report-links [data-history="true"]').innerText(), "過去の日誌を選ぶ");
  }
  await root.locator('.fund-report-links [data-family="journal"]:not([data-history])').click();
  const report = page.locator(".fund-report-view");
  await page.waitForSelector('.fund-report-view [data-report-loaded="1"]');
  for (const [action, label] of [["fund-report-previous", "前の日"], ["fund-report-next", "次の日"],
    ["fund-report-refresh", "再取得"], ["fund-report-back", "戻る"]]) assert.equal(await report.locator('[data-action="' + action + '"]').innerText(), label);
  assert.deepEqual(await report.locator('[data-action="fund-report-engine"]').allTextContents(), ["FABLE", "CODEX"]);
  assert.deepEqual(await report.locator('[data-action="fund-report-family"]').allTextContents(), ["日誌", "朝の投資ブリーフ"]);
  assert.equal(await report.locator("[data-fund-report-date]").inputValue(), date);
  assert.ok((await report.innerText()).includes("正常取得時刻（協定世界時・UTC）"));
  // 4回-10 追記3（監督者決定 2026-09-10）: 本文保持・IME・戻り先は既存回帰で検査する。
  console.log("PASS fund: Japanese headings/time explanations, proper names and all comparison/individual/report/refresh controls");
}

async function wishJapanese(page) {
  const { STATE_KEY } = require("./helpers");
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key));
    const project = s.projects.find(p => p.kind === "wish" && !p.deleted);
    if (!project) throw new Error("fixture wish project missing");
    s.tasks = s.tasks.filter(t => t.projectId !== project.id);
    s.wishFilter = { area: "", showRealized: false };
    s.wishOpenId = "";
    localStorage.setItem(key, JSON.stringify(s));
  }, STATE_KEY);
  await page.reload();
  await nav(page, "wish");
  const root = page.locator(".wish-tower");
  assert.equal(await root.locator("h1").innerText(), "やりたいこと");
  assert.deepEqual(await root.locator("h2").evaluateAll(nodes => nodes.map(n => n.firstChild.textContent)), ["実現の状況", "追加・絞り込み"]);
  assert.ok((await root.innerText()).includes("やりたいことを追加してみましょう（大きな夢でも大丈夫）"));
  assert.equal(await root.locator("#wishTitle").getAttribute("placeholder"), "やりたいこと（大きな夢でも大丈夫）");
  await root.locator("#wishTitle").fill("架空の旅行");
  await root.locator('[data-action="add-wish"]').click();
  await root.locator(".wish-detail").waitFor();
  assert.equal(await root.locator(".wish-group-panel h2").evaluate(n => n.firstChild.textContent), "時期別の一覧");
  assert.ok((await root.innerText()).includes("最初の一歩を1〜3個書いてみましょう。完璧でなくて大丈夫。"));
  const wishId = await root.locator('[data-action="open-wish"]').getAttribute("data-id");
  page.once("dialog", dialog => {
    assert.equal(dialog.message(), "サブタスク（次の一歩）を入力してください");
    return dialog.accept("架空の次の一歩");
  });
  await root.locator('[data-action="add-wish-subtask"]').click();
  await root.locator('[data-action="wish-subtask-title"]').waitFor();
  for (const action of ["add-wish", "wish-filter-area", "wish-toggle-realized", "open-wish",
    "wish-set-year", "wish-set-area", "wish-set-duedate", "wish-set-motivation", "add-wish-subtask",
    "toggle-wish-subtask", "wish-subtask-title", "wish-subtask-to-tasks", "delete-task", "wish-realize", "delete-wish"]) {
    assert.ok(await root.locator('[data-action="' + action + '"]').first().isVisible(), action);
  }
  assert.equal(await root.locator('[data-action="wish-set-duedate"]').getAttribute("type"), "date");
  await root.locator('[data-action="wish-toggle-realized"]').check();
  page.once("dialog", dialog => {
    assert.equal(dialog.message(), "このやりたいことを「実現済み」にしますか?");
    return dialog.accept();
  });
  await root.locator('button[data-action="wish-realize"]').click();
  await root.locator('button[data-action="wish-unrealize"]').waitFor();
  assert.equal(await root.locator('button[data-action="wish-unrealize"]').getAttribute("data-id"), wishId);
  assert.ok((await root.innerText()).includes("実現済み"));
  await root.locator('button[data-action="wish-unrealize"]').click();
  await root.locator('button[data-action="wish-realize"]').waitFor();
  assert.equal(await root.locator('[data-action="open-wish"]').getAttribute("data-id"), wishId);
  assert.ok(!/WISH RADAR|WISH DECK|FLIGHT PLAN|Wish Project/.test(await root.innerText()));
  console.log("PASS wish: Japanese headings/empty states, all controls, realization and existing IDs");
}

async function run() {
  const { page, browser, server } = await setup();
  try { await twelveWeek(page); await healthJapanese(page); await fundJapanese(page); await wishJapanese(page); }
  finally { await page.context().close(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
