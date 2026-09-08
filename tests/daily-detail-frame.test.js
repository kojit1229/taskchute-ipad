// 詳細枠: 全欄型、安全な値表示、保存副作用なし、dirty/busy/失敗、DOM実測。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, randomPort } = require("./helpers");
const root = path.resolve(__dirname, "..");
const modulePath = path.join(root, "src/ui/daily-parts/detail-frame.js");
const field = (type, value, extra = {}) => ({ key: type, label: `架空 ${type}`, type, value,
  options: [], required: false, readonly: false, help: "入力の説明", error: "", ...extra });
const model = (extra = {}) => ({ kind: "block", id: "fake-block", draftId: "fake-draft", origin: "today",
  title: "架空の詳細", dateLabel: "今日", dirty: false, busy: false, errors: [], saveLabel: "保存", canDelete: true,
  sections: [{ title: "全項目", fields: [field("text", "架空の名前"), field("textarea", "1行目\n2行目"),
    field("date", "2026-09-08"), field("time", "09:05"), field("datetime-local", "2026-09-08T09:05"),
    field("number", 0), field("select", "b", { options: [["a", "選択A"], ["b", "選択B"]] }), field("checkbox", true)] }], ...extra });
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`PASS ${label}`); }
(async () => {
  const { renderDetailFrame: render } = await import(pathToFileURL(modulePath).href);
  check("全欄型と既存の通知属性、時刻5分刻み", () => {
    const html = render(model());
    for (const type of ["text", "date", "time", "datetime-local", "number", "checkbox"])
      assert.ok(html.includes(`type="${type}"`));
    assert.match(html, /<textarea/); assert.match(html, /<select/);
    assert.equal([...html.matchAll(/data-modal-field=/g)].length, 8);
    assert.equal([...html.matchAll(/step="300"/g)].length, 2);
    for (const action of ["modal-save", "modal-close", "modal-delete"]) assert.ok(html.includes(`data-action="${action}"`));
    assert.match(html, /value="0"/); assert.match(html, /value="b" selected/); assert.match(html, / checked/);
    assert.doesNotMatch(render(model({ canDelete: false })), /modal-delete/);
  });
  check("dirty/busy/保存失敗を明示し入力を保持、描画は保存しない", () => {
    const frozen = freeze(model({ dirty: true, errors: ["模擬保存失敗"] }));
    const html = render(frozen);
    assert.equal(html, render(frozen)); assert.match(html, /未保存の変更があります/);
    assert.match(html, /role="alert">模擬保存失敗/); assert.match(html, /架空の名前/);
    const busy = render(model({ busy: true }));
    assert.match(busy, /aria-busy="true"/); assert.match(busy, /保存中/);
    for (const match of busy.matchAll(/<button[^>]*>/g)) assert.match(match[0], / disabled/);
    assert.match(busy, /<fieldset[^>]* disabled/);
    const source = fs.readFileSync(modulePath, "utf8");
    assert.doesNotMatch(source, /\b(?:import |fetch\(|localStorage|sessionStorage|addEventListener|saveState\(|new Date)/);
    assert.equal(fs.readFileSync(path.join(root, "sw.js"), "utf8").split('"./src/ui/daily-parts/detail-frame.js"').length - 1, 1);
  });
  check("不正なモデル/欄型/値/重複キー/生HTMLを拒否", () => {
    for (const bad of [null, {}, model({ kind: "unknown" }), model({ dirty: "yes" }), model({ errors: [3] }),
      model({ sections: [{ title: "x", fields: [field("file", "x")] }] }),
      model({ sections: [{ title: "x", fields: [field("checkbox", "false")] }] }),
      model({ sections: [{ title: "x", fields: [field("text", "a"), field("text", "b")] }] }),
      model({ sections: [{ title: "x", fields: [field("number", NaN)] }] }),
      model({ sections: [{ title: "x", fields: [field("select", "a", { options: ["a"] })] }] }),
      model({ sections: [{ title: "x", fields: [], html: "<img src=x>" }] })]) assert.throws(() => render(bad), TypeError);
    let calls = 0; const accessor = model();
    Object.defineProperty(accessor, "title", { get() { calls++; throw Error("injected getter"); } });
    assert.throws(() => render(accessor), TypeError); assert.equal(calls, 0);
  });
  check("明示slotだけ受理、未知slot/文字列/失敗注入を検出", () => {
    const input = model({ sections: [{ title: "特殊欄", fields: [], slot: "progress" }] });
    assert.match(render(input, { slots: { progress: e => `<p>${e('<架空>')}</p>` } }), /&lt;架空&gt;/);
    assert.throws(() => render(input), TypeError);
    assert.throws(() => render(input, { slots: { progress: "<p>unsafe</p>" } }), TypeError);
    assert.throws(() => render(input, { slots: Object.create({ progress: () => "" }) }), TypeError);
    assert.throws(() => render(input, { slots: { progress: () => 1 } }), TypeError);
    assert.throws(() => render(input, { slots: { progress() { throw Error("injected render failure"); } } }), /injected render failure/);
  });
  const port = randomPort(); const server = startServer(port); let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ ...defaultContextOptions(), locale: "ja-JP", serviceWorkers: "block" });
    const page = await context.newPage();
    const now = fixedClock(1788829200000); await page.clock.install({ time: now() });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== `http://localhost:${port}`) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body:
        '<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/src/ui/daily-parts/daily-parts.css"><body><main id="fixture"></main></body></html>' });
      return route.continue();
    });
    await page.goto(`http://localhost:${port}/`);
    await page.evaluate(() => {
      window.effects = { saved: 0, deleted: 0, storage: 0, network: 0 };
      window.saveState = () => { window.effects.saved++; };
      window.deleteItem = () => { window.effects.deleted++; };
      Storage.prototype.setItem = () => { window.effects.storage++; };
      window.fetch = () => { window.effects.network++; throw Error("unexpected request"); };
    });
    const malicious = '\"><img src=x onerror="window.injected=1">&\'悪意';
    const input = model({ title: malicious, id: malicious, draftId: malicious, origin: malicious, dateLabel: malicious,
      errors: [malicious], saveLabel: malicious });
    input.sections[0].title = malicious;
    for (const f of input.sections[0].fields) { f.label = malicious; f.help = malicious; f.error = malicious; }
    input.sections[0].fields[0].value = malicious;
    input.sections[0].fields[1].value = `</textarea>${malicious}`;
    input.sections[0].fields[6].value = malicious;
    input.sections[0].fields[6].options = [[malicious, malicious]];
    const mount = async data => {
      await page.locator("#fixture").evaluate(async (el, data) => {
        const { renderDetailFrame } = await import("/src/ui/daily-parts/detail-frame.js");
        el.innerHTML = renderDetailFrame(data);
        // Measure the settled layout after the modal's scale animation, without a fixed wait.
        await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished));
      }, data);
    };
    await mount(input);
    const dom = await page.locator(".daily-detail-frame").evaluate(el => ({ title: el.querySelector("h2").textContent,
      attrs: { ...el.dataset }, text: el.querySelector('[data-modal-field="text"]').value,
      textarea: el.querySelector("textarea").value, option: el.querySelector("select").value,
      unsafe: el.querySelectorAll("img,script,[onerror],[data-injected]").length,
      effects: window.effects, injected: Boolean(window.injected) }));
    check("実DOMで本文/属性/textarea/selectの注入なし、副作用0", () => {
      assert.equal(dom.title, malicious); assert.equal(dom.attrs.id, malicious); assert.equal(dom.attrs.draftId, malicious);
      assert.equal(dom.attrs.origin, malicious); assert.equal(dom.text, malicious);
      assert.equal(dom.textarea, `</textarea>${malicious}`); assert.equal(dom.option, malicious);
      assert.equal(dom.unsafe, 0); assert.equal(dom.injected, false);
      assert.deepEqual(dom.effects, { saved: 0, deleted: 0, storage: 0, network: 0 });
    });
    await mount(model({ busy: true }));
    const busyControls = await page.locator("input,select,textarea,button").evaluateAll(els => els.map(el => el.matches(":disabled") || el.readOnly));
    check("busy中は全欄と操作が編集不能", () => assert.ok(busyControls.every(Boolean)));
    const readonly = model(); readonly.sections[0].fields.forEach(f => { f.readonly = true; f.required = true; });
    await mount(readonly);
    const locked = await page.locator("input,select,textarea").evaluateAll(els => els.map(el => ({ locked: el.disabled || el.readOnly, required: el.required })));
    check("readonlyとrequiredは8欄すべてへ反映", () => assert.ok(locked.length === 8 && locked.every(f => f.locked && f.required)));
    const long = model({ title: "長い架空の詳細ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(12), dirty: true });
    long.sections[0].fields.forEach(f => { f.label = long.title; f.help = long.title; });
    await mount(long);
    for (const width of [320, 390, 768, 1024]) for (const zoom of [1, 2]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, zoom);
      const metrics = await page.locator(".daily-detail-frame").evaluate(el => ({
        scrollable: el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto",
        elements: [el, ...el.querySelectorAll("*")].map(node => { const rect = node.getBoundingClientRect();
          return { tag: node.tagName, left: rect.left, right: rect.right, width: rect.width, height: rect.height,
            font: parseFloat(getComputedStyle(node).fontSize) }; })
      }));
      check(`DOM実測 ${width}px/${zoom * 100}%: 横溢れなし/16px/44px/縦スクロール`, () => {
        assert.ok(metrics.scrollable);
        for (const m of metrics.elements) {
          assert.ok(m.left >= -1 && m.right <= width + 1, JSON.stringify(m));
          if (["INPUT", "TEXTAREA", "SELECT"].includes(m.tag)) assert.ok(m.font >= 16);
          if (m.tag === "BUTTON") assert.ok(m.width >= 44 && m.height >= 44, JSON.stringify({ width, zoom, ...m }));
        }
      });
    }
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`daily-detail-frame: ${checks} checks passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
