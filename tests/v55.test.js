// v55 検証: WBSのインライン編集 + AI一括編集
const { chromium, launchOptions, startServer } = require("./helpers");

const PORT = 4191;
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(today);
  const NEXTWK = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);

  // ---- seed: プロジェクト + タスク3件 + カテゴリ ----
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.ai = { apiKey: "sk-ant-test", model: "claude-opus-4-8" };
    s.settings.categories = [{ id: "c1", name: "開発", color: "#007aff" }, { id: "c2", name: "学習", color: "#2fb96d" }];
    // デモの normal プロジェクトは除去して件数を決定的に(wish/other は残す)
    s.projects = s.projects.filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-1", kind: "normal", title: "英語学習", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false, collapsed: false });
    const mkTask = (id, title, due) => ({ id, projectId: "proj-1", parentTaskId: "", title, category: "", status: "todo", dueDate: due, description: "", createdAt: `2026-01-0${id.slice(-1)}T00:00`, updatedAt: "2026-01-01T00:00", deleted: false });
    s.tasks = [mkTask("task-A", "単語帳", ""), mkTask("task-B", "模試", ""), mkTask("task-C", "リスニング", "")];
    s.currentView = "wbs";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);

  // ---- [1] インライン編集モード ----
  console.log("[1] インライン編集モード");
  check("編集モードトグルがある", await page.locator('[data-action="toggle-wbs-edit"]').count() === 1);
  check("通常時はインライン入力が出ない", await page.locator('[data-wbs-edit]').count() === 0);
  await page.click('[data-action="toggle-wbs-edit"]');
  await page.waitForTimeout(300);
  check("編集モードで各タスクに3項目(状態/期限/カテゴリ)の行内フォーム",
    await page.locator('[data-wbs-edit][data-id="task-A"]').count() === 3
    && await page.locator('[data-wbs-edit][data-id="task-B"]').count() === 3
    && await page.locator('[data-wbs-edit][data-id="task-C"]').count() === 3);
  // 入力の font-size 16px(iOSズーム防止)
  const fs = await page.locator('.wbs-inline-input').first().evaluate((el) => getComputedStyle(el).fontSize);
  check("インライン入力のfont-sizeが16px以上", parseFloat(fs) >= 16, fs);
  // task-A の期限を直接編集
  await page.locator('input[data-wbs-edit="dueDate"][data-id="task-A"]').fill(NEXTWK);
  await page.locator('input[data-wbs-edit="dueDate"][data-id="task-A"]').dispatchEvent("change");
  await page.waitForTimeout(300);
  check("期限がモーダルなしで保存される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).tasks.find((t) => t.id === "task-A").dueDate, KEY) === NEXTWK);
  // task-B の状態を中断に
  await page.selectOption('select[data-wbs-edit="status"][data-id="task-B"]', "suspended");
  await page.waitForTimeout(300);
  check("状態がその場で保存される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).tasks.find((t) => t.id === "task-B").status, KEY) === "suspended");
  // task-C のカテゴリを開発に
  await page.selectOption('select[data-wbs-edit="category"][data-id="task-C"]', "開発");
  await page.waitForTimeout(300);
  check("カテゴリがその場で保存される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).tasks.find((t) => t.id === "task-C").category, KEY) === "開発");
  check("dataModifiedAtが更新される(実データ変更)", await page.evaluate((KEY) => !!JSON.parse(localStorage.getItem(KEY)).dataModifiedAt, KEY));
  // 編集モードOFFで通常表示に戻る(中断表示のため中断を表示に)
  await page.click('[data-action="toggle-wbs-edit"]');
  await page.waitForTimeout(300);
  check("編集モードOFFでフォームが消える", await page.locator('[data-wbs-edit]').count() === 0);

  // ---- [2] AI一括編集 ----
  console.log("[2] AI一括編集");
  // [1] で変更した値をベースラインに戻す(AI提案が「変化なし」で除外されないように)
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks.forEach((t) => { if (t.id === "task-A") t.dueDate = ""; if (t.id === "task-C") t.status = "todo"; });
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__aiPrompts = [];
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      const prompt = String(JSON.parse(opts.body).messages[0].content);
      window.__aiPrompts.push(prompt);
      // task-A の期限を来週金曜(=NEXTWK相当)に、task-C を完了に
      const nw = (prompt.match(/id:task-A[^\n]*/) ? "" : "");
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text:
        '```json\n{"changes":[' +
        '{"taskId":"task-A","field":"dueDate","value":"' + window.__NEXTWK + '","reason":"指示"},' +
        '{"taskId":"task-C","field":"status","value":"completed","reason":"指示"},' +
        '{"taskId":"task-A","field":"status","value":"BOGUS","reason":"不正値は捨てられるはず"},' +
        '{"taskId":"nope","field":"dueDate","value":"2026-07-10","reason":"存在しないid"}' +
        ']}\n```' }] }), { status: 200 }));
    };
  });
  await page.evaluate((nw) => { window.__NEXTWK = nw; }, NEXTWK);
  check("WBSに まとめて編集 ボタン", await page.locator('[data-action="ai-bulk-edit"]').count() === 1);
  await page.click('[data-action="ai-bulk-edit"]');
  await page.waitForTimeout(300);
  check("指示入力モーダルが開く", await page.locator("#ai-bulk-instruction").count() === 1);
  await page.fill("#ai-bulk-instruction", "task-Aの期限を来週金曜に、task-Cを完了に");
  await page.click('[data-action="ai-bulk-edit-run"]');
  await page.waitForTimeout(700);
  const prompt = await page.evaluate(() => window.__aiPrompts[0] || "");
  check("プロンプトにタスク一覧(id付き)が入る", prompt.includes("id:task-A") && prompt.includes("英語学習"));
  const rows = await page.locator('input[data-ai-bulk]').count();
  check("有効な変更2件のみ確認に出る(不正値・存在しないidは除外)", rows === 2, `rows=${rows}`);
  const bodyText = await page.evaluate(() => document.querySelector(".modal-card").textContent);
  check("現在→新の表示", bodyText.includes("→") && bodyText.includes("完了"));
  // 2件目(task-C 完了)のチェックを外し、1件目だけ反映
  await page.locator('input[data-ai-bulk="1"]').uncheck();
  await page.click('[data-action="ai-bulk-edit-submit"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return { aDue: s.tasks.find((t) => t.id === "task-A").dueDate, cStatus: s.tasks.find((t) => t.id === "task-C").status };
  }, KEY);
  check("チェックした変更のみ反映(task-A期限)", after.aDue === NEXTWK);
  check("外した変更は反映されない(task-C未完了のまま)", after.cStatus !== "completed");

  // ---- [3] 後方互換 ----
  console.log("[3] 後方互換");
  await page.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); delete s.settings.wbsEditMode; localStorage.setItem(KEY, JSON.stringify(s)); }, KEY);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('[data-action="nav"][data-view="home"]');
  await page.waitForTimeout(200);
  check("旧stateから wbsEditMode が補完される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.wbsEditMode === false, KEY));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
