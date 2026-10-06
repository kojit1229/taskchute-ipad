// v55 / B-1: WBSの期日・見積は行内で編集・保存する。
const { chromium, launchOptions, defaultContextOptions, fixedClock, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ ...defaultContextOptions(), serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const now = fixedClock(new Date().setHours(12, 0, 0, 0));
  await page.clock.setFixedTime(new Date(now()));
  const today = new Date(now());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(today);
  const NEXTWK = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));

  await page.goto(`http://localhost:${PORT}/`);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ---- seed: プロジェクト + タスク3件 + カテゴリ ----
  await page.evaluate(({ KEY, TODAY, NEXTWK }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.categories = [{ id: "c1", name: "開発", color: "#007aff" }, { id: "c2", name: "学習", color: "#2fb96d" }];
    // デモの normal プロジェクトは除去して件数を決定的に(wish/other は残す)
    s.projects = s.projects.filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-1", kind: "normal", title: "英語学習", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: TODAY, createdAt: TODAY+'T00:00', updatedAt: TODAY+'T00:00', deleted: false, collapsed: false });
    const mkTask = (id, title, due) => ({ id, projectId: "proj-1", parentTaskId: "", title, category: "", status: "todo", dueDate: due, description: "", createdAt: TODAY+'T00:00', updatedAt: TODAY+'T00:00', deleted: false });
    s.tasks = [mkTask("task-A", "単語帳", ""), mkTask("task-B", "模試", ""), mkTask("task-C", "リスニング", "")];
    s.tasks[0].dueDate = NEXTWK; s.tasks[0].estimateMin = 45;
    s.currentView = "wbs";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY, NEXTWK });
  await page.reload();
  await page.locator('[data-work-group="proj-1"]').waitFor();

  // B-1: native editors save through the existing task path; no status select.
  const rows = page.locator('[data-work-group="proj-1"] .work-task-row');
  check("3件のタスクを表示", await rows.count() === 3);
  const due = page.locator('[data-work-key="task:task-A"] .work-task-due');
  const dateInput = due.locator('input[type="date"][data-work-edit="dueDate"]');
  const estimateInput = due.locator('input[type="number"][data-work-edit="estimateMin"]');
  check("期日・見積の入力欄がある", await dateInput.count() === 1 && await estimateInput.count() === 1);
  check("状態selectが無い", await rows.locator('select').count() === 0);
  check("全行に期日・見積の入力欄がある", await rows.locator('[data-work-edit]').count() === 6);
  if (!(await dateInput.count()) || !(await estimateInput.count())) {
    await browser.close(); server.close();
    throw new Error('B-1: 期日・見積の入力欄が未実装');
  }
  {
    check("期日・見積の既存値を表示", await dateInput.inputValue() === NEXTWK && await estimateInput.inputValue() === '45');
    const emptyDue = page.locator('[data-work-key="task:task-B"] .work-task-due');
    check("期日なし・見積0を表示", await emptyDue.locator('[data-work-edit="dueDate"]').inputValue() === '' && await emptyDue.locator('[data-work-edit="estimateMin"]').inputValue() === '0');
    await dateInput.fill(TODAY); await dateInput.dispatchEvent('change');
    await estimateInput.fill('60'); await estimateInput.dispatchEvent('change');
    const saved = await page.evaluate(KEY=>JSON.parse(localStorage.getItem(KEY)).tasks.find(t=>t.id==='task-A'),KEY);
    check("期日・見積を変えると保存される", saved.dueDate === TODAY && saved.estimateMin === 60);
  }
  check("検索入力は16px以上", parseFloat(await page.locator('[data-work-list="wbs"] #wbs-projects-query').evaluate(el => getComputedStyle(el).fontSize)) >= 16);

  // ---- [2] 後方互換 ----
  console.log("[2] 後方互換");
  await page.evaluate((KEY) => { const s = JSON.parse(localStorage.getItem(KEY)); delete s.settings.wbsEditMode; localStorage.setItem(KEY, JSON.stringify(s)); }, KEY);
  await page.reload();
  await page.locator('[data-work-group="proj-1"]').waitFor();
  await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
  check("旧stateから wbsEditMode が補完される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.wbsEditMode === false, KEY));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
