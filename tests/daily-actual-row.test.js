// 実績行: 終了未完了・時刻未記録・計測0分、通知、失敗注入、各幅のDOM実測。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const acorn = require("acorn");
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort } = require("./helpers");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/ui/daily-parts/actual-row.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const escapeNode = acorn.parse(app, { ecmaVersion: "latest", sourceType: "module" }).body
  .find((node) => node.type === "FunctionDeclaration" && node.id.name === "escapeHTML");
const escapeHTML = vm.runInNewContext(`(${app.slice(escapeNode.start, escapeNode.end)})`);
const display = (extra = {}) => ({ key: "actual:fake-block", kind: "actual", id: "fake-block",
  dateLabel: "架空の日", title: "架空の実績", subtitle: "試験用作業", statusLabel: "", busy: false,
  error: "", actions: {}, ...extra });
const actual = (extra = {}) => ({ blockId: "fake-block", taskId: "fake-task", actualStartText: "09:00",
  actualEndText: "09:30", durationText: "30分", planCompleted: false, taskCompleted: false,
  chargeText: "3", dischargeText: "2", commentText: "架空のコメント", missingTimeLabel: "", ...extra });
const connected = () => display({ actions: { "daily-actual-edit": true, "daily-task-complete": true,
  "edit-block": true, "daily-plan-complete": true, "daily-block-duplicate": true, "daily-plan-times-save": true } });
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
(async () => {
  const { renderActualRow } = await import(pathToFileURL(path.join(root, "src/ui/daily-parts/actual-row.js")).href);
  const render = (d = display(), a = actual()) => renderActualRow(d, a, escapeHTML);
  check("終了未完了・予定完了とTask完了を独立表示", () => {
    for (const planCompleted of [false, true]) for (const taskCompleted of [false, true]) {
      const html = render(display(), actual({ planCompleted, taskCompleted }));
      assert.ok(html.includes(`data-daily-status="plan">${planCompleted ? "予定完了" : "終了・未完了"}`));
      assert.ok(html.includes(`data-daily-status="task">${taskCompleted ? "Task完了" : "Task未完了"}`));
    }
    assert.match(render(display(), actual({ actualEndText: "" })), /data-daily-status="plan">予定未完了/);
  });
  check("開始/終了/両方欠落・空白・不足説明あり: 0分を出さない", () => {
    for (const extra of [{ actualStartText: "" }, { actualEndText: "" },
      { actualStartText: "", actualEndText: "" }, { actualStartText: "  " },
      { missingTimeLabel: "旧記録の時刻が不足しています" }]) {
      const html = render(display(), actual({ durationText: "0分", ...extra }));
      assert.match(html, /data-daily-duration>時刻未記録/); assert.doesNotMatch(html, /0分/);
    }
    assert.match(render(display(), actual({ durationText: "" })), /data-daily-duration>時刻未記録/);
    assert.match(render(display(), actual({ missingTimeLabel: "開始が未記録" })), /時刻未記録：開始が未記録/);
  });
  check("計測0分を保持、予定時間による補完なし、翌日表示を保持", () => {
    assert.match(render(display(), actual({ actualEndText: "09:00", durationText: "0分" })), /data-daily-duration>0分/);
    const html = render(display(), actual({ actualStartText: "23:55", actualEndText: "翌日 00:05", durationText: "10分" }));
    assert.match(html, /終了 翌日 00:05/); assert.match(html, /data-daily-duration>10分/);
  });
  check("TaskなしはTask状態と操作なし、予定編集/複製/予定完了は出さない", () => {
    const html = render(connected(), actual({ taskId: null }));
    assert.doesNotMatch(html, /Task|daily-task-complete/);
    assert.doesNotMatch(html, /data-action="(?:daily-plan-|daily-block-)/);
    assert.match(html, /data-action="daily-actual-edit"/);
    assert.doesNotMatch(render(), /data-action=/);
    assert.doesNotMatch(render(display({ actions: { "daily-actual-edit": false } })), /data-action=/);
  });
  check("Task完了通知はトグル要求ではなく希望状態", () => {
    for (const taskCompleted of [false, true]) {
      const html = render(connected(), actual({ taskCompleted }));
      assert.ok(html.includes(`data-desired-completed="${!taskCompleted}"`));
    }
    assert.doesNotMatch(render(connected()), /data-request-id|data-base-fingerprint/);
  });
  check("不正入力・異種/異なるBlock参照・HTML・未知操作を拒否", () => {
    for (const d of [null, { ...display(), kind: "block", key: "block:fake-block" },
      { ...display(), title: "<img src=x>" }, { ...display(), actions: { injected: true } }])
      assert.throws(() => render(d), TypeError);
    for (const a of [null, {}, actual({ blockId: "other" }), actual({ taskId: " " }),
      actual({ taskId: null, taskCompleted: true }), actual({ planCompleted: "true" }),
      actual({ actualStartText: null }), actual({ durationText: 0 }), actual({ commentText: "<script>x</script>" })])
      assert.throws(() => render(display(), a), TypeError);
    assert.throws(() => renderActualRow(display(), actual(), null), TypeError);
  });
  check("getter/escape失敗注入を検出、入力のBlock参照表示データを変更しない", () => {
    let calls = 0; const a = actual();
    Object.defineProperty(a, "durationText", { get() { calls++; throw Error("injected getter"); } });
    assert.throws(() => render(display(), a), TypeError); assert.equal(calls, 0);
    assert.throws(() => renderActualRow(display(), actual(), () => { throw Error("injected escape"); }), /injected escape/);
    const d = freeze(connected()); const frozen = freeze(actual());
    assert.equal(render(d, frozen), render(d, frozen));
  });
  check("保存失敗を表示し値を維持、busy中は全操作無効", () => {
    const html = render({ ...connected(), busy: true, error: "模擬保存失敗" });
    assert.match(html, /role="alert">模擬保存失敗/); assert.match(html, /aria-busy="true"/);
    assert.match(html, /架空のコメント/); assert.match(html, /開始 09:00/);
    for (const match of html.matchAll(/<button[^>]+>/g)) assert.match(match[0], / disabled/);
  });
  check("契約以外の依存・保存・計算・独自イベントなし、SW登録1件", () => {
    const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
    assert.deepEqual(ast.body.filter((n) => n.type === "ImportDeclaration").map((n) => n.source.value), ["./contract.js"]);
    assert.doesNotMatch(source, /\b(?:new Date|fetch\(|localStorage|addEventListener|registerActions\(|saveState\()/);
    assert.equal(fs.readFileSync(path.join(root, "sw.js"), "utf8").split('"./src/ui/daily-parts/actual-row.js"').length - 1, 1);
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
    const d = connected(); d.id = 'fake-" data-injected="yes'; d.key = `actual:${d.id}`;
    d.title = '長い実績名と空白なしABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12) + ' & "引用"';
    const a = actual({ blockId: d.id, taskId: 'task-" data-injected="yes', commentText: d.title + "\n2行目" });
    await page.locator("#fixture").evaluate((el, html) => { el.innerHTML = html; }, render(d, a));
    const attrs = await page.locator("[data-action]").evaluateAll((els) => els.map((el) => ({ ...el.dataset })));
    check("DOM通知はBlock/Taskの正しい対象ID、属性注入なし", () => {
      assert.deepEqual(attrs, [
        { action: "daily-actual-edit", kind: "block", id: a.blockId },
        { action: "daily-task-complete", kind: "task", id: a.taskId, desiredCompleted: "true" },
        { action: "edit-block", kind: "block", id: a.blockId }
      ]);
    });
    for (const width of [320, 390, 768, 1024, 1280, 1440]) for (const zoom of [1, 2]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, zoom);
      const metrics = await page.locator(".daily-actual-row").evaluate((row) => ({
        title: row.querySelector(".daily-actual-title").textContent,
        comment: row.querySelector(".daily-actual-comment").textContent,
        elements: [row, ...row.querySelectorAll("*")].map((el) => {
          const r = el.getBoundingClientRect(); const css = getComputedStyle(el);
          return { tag: el.tagName, left: r.left, right: r.right, width: r.width, height: r.height, display: css.display };
        })
      }));
      check(`DOM実測 ${width}px / ${zoom * 100}%: 長名・コメント保持、横溢れなし、操作44px`, () => {
        assert.equal(metrics.title, d.title); assert.equal(metrics.comment, a.commentText);
        for (const m of metrics.elements) {
          assert.notEqual(m.display, "none"); assert.ok(m.left >= -1 && m.right <= width + 1, JSON.stringify(m));
          if (m.tag === "BUTTON") assert.ok(m.width >= 44 && m.height >= 44);
        }
      });
    }
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`daily-actual-row: ${checks} checks passed, 0 failed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
