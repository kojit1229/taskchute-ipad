// 共通予定行: 状態・操作引数・不正入力・失敗注入・長名と各幅/200%拡大のDOM実測。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const acorn = require("acorn");
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort } = require("./helpers");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/ui/daily-parts/plan-row.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const escapeNode = acorn.parse(app, { ecmaVersion: "latest", sourceType: "module" }).body
  .find((node) => node.type === "FunctionDeclaration" && node.id.name === "escapeHTML");
// Exercise the existing helper, rather than a test-only approximation of escaping.
const escapeHTML = vm.runInNewContext(`(${app.slice(escapeNode.start, escapeNode.end)})`);
const actions = ["daily-plan-times-save", "daily-plan-times-cancel", "daily-plan-complete",
  "daily-block-start", "daily-block-end", "daily-block-duplicate", "daily-duplicate-undo", "edit-block", "daily-schedule-edit"];
const display = (extra = {}) => ({ key: "block:fake-1", kind: "block", id: "fake-1", dateLabel: "架空の日",
  title: "試験用の予定", subtitle: "架空の作業", statusLabel: "", busy: false, error: "", actions: {}, ...extra });
const plan = (extra = {}) => ({ plannedStartText: "", plannedEndText: "", endNextDay: false,
  estimateText: "見積30分", overlapLabel: "", planCompleted: false, taskCompleted: false, running: false,
  canDuplicate: false, canStart: false, canEnd: false, highlighted: false, saving: false, undoAvailable: false,
  draftId: null, draft: null, ...extra });
const editable = (extra = {}) => plan({ draftId: "fake-draft", draft: {
  start: "03:01", end: "03:02", endNextDay: false, dirty: true, errors: [] }, ...extra });
const allConnected = () => display({ actions: Object.fromEntries(actions.map((action) => [action, true])) });
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
(async () => {
  const { renderPlanRow } = await import(pathToFileURL(path.join(root, "src/ui/daily-parts/plan-row.js")).href);
  const render = (d = display(), p = plan()) => renderPlanRow(d, p, escapeHTML);
  check("未定と未接続: 操作印・入力0", () => {
    const html = render();
    assert.match(html, /開始 未定/); assert.match(html, /終了 未定/);
    assert.doesNotMatch(html, /data-action=|data-daily-field=/);
    assert.doesNotMatch(render(display({ actions: { "edit-block": false } }), editable()), /data-action=|data-daily-field=/);
  });
  check("予定完了・Task完了・実行中は8通りを独立表示", () => {
    for (const planCompleted of [false, true]) for (const taskCompleted of [false, true]) for (const running of [false, true]) {
      const html = render(display(), plan({ planCompleted, taskCompleted, running }));
      assert.ok(html.includes(`data-daily-status="plan">${planCompleted ? "予定完了" : "予定未完了"}`));
      assert.ok(html.includes(`data-daily-status="task">${taskCompleted ? "Task完了" : "Task未完了"}`));
      assert.ok(html.includes(`data-daily-status="running">${running ? "実行中" : "停止中"}`));
      assert.equal(html.includes("is-plan-completed"), planCompleted);
    }
  });
  check("単発予定は計測・複製・Task状態なし", () => {
    const d = { ...allConnected(), kind: "schedule", key: "schedule:fake-1" };
    const html = render(d, editable({ canDuplicate: true, canStart: true, canEnd: true, undoAvailable: true }));
    assert.match(html, /単発予定/); assert.match(html, /data-action="daily-schedule-edit"/);
    assert.doesNotMatch(html, /data-action="(?:daily-block-|daily-duplicate-undo|edit-block)|data-daily-status="(?:running|task)"/);
  });
  check("閲覧用Blockは許可フラグfalseで複製不可、操作ごとの権限を区別", () => {
    assert.doesNotMatch(render(allConnected()), /data-action="daily-block-(?:duplicate|start|end)"/);
    assert.match(render(allConnected(), plan({ canStart: true })), /data-action="daily-block-start"/);
    assert.match(render(allConnected(), plan({ canEnd: true })), /data-action="daily-block-end"/);
  });
  check("保存時刻と入力下書きは別、4時/15分制限を追加しない", () => {
    const html = render(allConnected(), editable({ plannedStartText: "23:55", plannedEndText: "00:00", endNextDay: true }));
    assert.match(html, /開始 23:55/); assert.match(html, /終了 翌日 00:00/);
    assert.match(html, /value="03:01"/); assert.match(html, /value="03:02"/);
    assert.doesNotMatch(html, /\smin=|\smax=/);
    assert.doesNotMatch(render(allConnected(), editable({ draft: { start: "", end: "", endNextDay: true, dirty: false, errors: [] } })),
      /data-action="daily-plan-times-(?:save|cancel)"/);
  });
  check("不正入力: 型・未知操作・HTML・時刻・識別子を拒否", () => {
    for (const d of [null, { ...display(), title: "<img src=x>" }, { ...display(), kind: "task", key: "task:fake-1" },
      { ...display(), actions: { "injected-action": true } }]) assert.throws(() => render(d), TypeError);
    for (const p of [null, {}, plan({ running: "true" }), plan({ estimateText: "<b>x</b>" }),
      editable({ draftId: "" }), editable({ draft: { start: "24:00", end: "10:00", endNextDay: false, dirty: true, errors: [] } }),
      editable({ draft: { start: "09:60", end: "", endNextDay: false, dirty: true, errors: [] } }),
      editable({ draft: { start: "", end: "", endNextDay: false, dirty: true, errors: [1] } })]) {
      assert.throws(() => render(display(), p), TypeError);
    }
    assert.throws(() => renderPlanRow(display(), plan(), null), TypeError);
  });
  check("getter・文字変換の失敗注入を検出、凍結入力を変更しない", () => {
    let calls = 0; const p = plan();
    Object.defineProperty(p, "running", { get() { calls++; throw Error("injected getter"); } });
    assert.throws(() => render(display(), p), TypeError); assert.equal(calls, 0);
    assert.throws(() => renderPlanRow(display(), plan(), () => { throw Error("injected escape"); }), /injected escape/);
    const d = freeze(allConnected()); const frozen = freeze(editable());
    assert.equal(render(d, frozen), render(d, frozen));
  });
  check("保存失敗を表示し下書きを維持、保存中は入力/操作を無効化", () => {
    const html = render(display({ ...allConnected(), error: "模擬保存失敗" }), editable({ saving: true }));
    assert.match(html, /role="alert">模擬保存失敗/); assert.match(html, /value="03:01" disabled/);
    assert.match(html, /aria-busy="true"/);
    for (const button of html.matchAll(/<button[^>]+>/g)) assert.match(button[0], / disabled/);
  });
  check("依存は契約のみ、副作用APIなし、新規ファイル配信登録", () => {
    const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
    assert.deepEqual(ast.body.filter((n) => n.type === "ImportDeclaration").map((n) => n.source.value), ["./contract.js"]);
    assert.doesNotMatch(source, /\b(?:new Date|fetch\(|localStorage|addEventListener|registerActions\(|saveState\()/);
    const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    for (const file of ["plan-row.js", "daily-parts.css"]) assert.equal(sw.split(`"./src/ui/daily-parts/${file}"`).length - 1, 1);
  });
  const port = randomPort(); const server = startServer(port); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), locale: "ja-JP", serviceWorkers: "block" });
    const page = await context.newPage();
    const now = fixedClock(1788829200000); await page.clock.install({ time: now() });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== `http://localhost:${port}`) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body:
        '<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/src/ui/daily-parts/daily-parts.css"><body><main id="fixture"></main></body></html>' });
      return route.continue();
    });
    await page.goto(`http://localhost:${port}/`);
    const d = allConnected(); d.id = 'fake-" data-injected="yes'; d.key = `block:${d.id}`;
    d.title = '長い作業名と空白なしABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12) + ' & "引用"';
    const p = editable({ canDuplicate: true, canStart: true, canEnd: true, undoAvailable: true });
    await page.locator("#fixture").evaluate((el, html) => { el.innerHTML = html; }, render(d, p));
    const attrs = await page.locator("[data-action]").evaluateAll((els) => els.map((el) => ({ ...el.dataset })));
    check("DOMから全操作の引数を取得、属性注入0、完了は希望状態", () => {
      assert.equal(attrs.length, 8);
      for (const data of attrs) {
        assert.ok(actions.includes(data.action)); assert.equal(data.kind, "block");
        assert.equal(data.id, d.id); assert.equal(data.draftId, "fake-draft");
        assert.equal(data.injected, undefined); assert.equal(data.requestId, undefined);
      }
      assert.equal(attrs.find((data) => data.action === "daily-plan-complete").desiredCompleted, "true");
    });
    const fields = await page.locator("[data-daily-field]").evaluateAll((els) => els.map((el) => ({
      field: el.dataset.dailyField, draftId: el.dataset.draftId, type: el.type, step: el.step, value: el.value })));
    check("入力はネイティブtime/5分刻み、引数に生入力を埋めない", () => {
      assert.deepEqual(fields.map((f) => f.field), ["start", "end", "endNextDay"]);
      for (const f of fields.slice(0, 2)) { assert.equal(f.type, "time"); assert.equal(f.step, "300"); assert.equal(f.draftId, "fake-draft"); }
      assert.equal(fields[0].value, "03:01"); assert.equal(fields[2].type, "checkbox");
    });
    for (const width of [320, 390, 768, 1024, 1280, 1440]) for (const zoom of [1, 2]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, zoom);
      const metrics = await page.locator(".daily-plan-row").evaluate((row) => ({
        title: row.querySelector(".daily-plan-title").textContent,
        elements: [row, ...row.querySelectorAll("*")].map((el) => {
          const rect = el.getBoundingClientRect(); const css = getComputedStyle(el);
          return { tag: el.tagName, right: rect.right, left: rect.left, width: rect.width, height: rect.height,
            font: parseFloat(css.fontSize), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        })
      }));
      check(`DOM実測 ${width}px / ${zoom * 100}%: 長名・横溢れ・入力16px・操作44px`, () => {
        assert.equal(metrics.title, d.title);
        for (const m of metrics.elements) {
          assert.ok(m.left >= -1 && m.right <= width + 1, JSON.stringify(m));
          if (m.tag === "INPUT") assert.ok(m.font >= 16);
          if (m.tag === "BUTTON") assert.ok(m.width >= 44 && m.height >= 44);
        }
      });
    }
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`daily-plan-row: ${checks} checks passed, 0 failed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
