// v57 検証: 計器盤ドリルダウン(#9)+ AI下書きの Undo/Redo・却下理由メモ(#10)
const { chromium, launchOptions, startServer } = require("./helpers");

const PORT = 4193;
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
  const daysAgo = (n) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);

  // ---- seed: APIキー + タスク2件 + 完了Block6件(計器盤ドリル用)----
  await page.evaluate(({ TODAY, KEY, devDates, learnDates }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.ai = { apiKey: "sk-ant-test", model: "claude-opus-4-8" };
    s.settings.categories = [{ id: "c1", name: "開発", color: "#007aff" }, { id: "c2", name: "学習", color: "#2fb96d" }];
    s.projects = s.projects.filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-1", kind: "normal", title: "P", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false });
    s.tasks = [
      { id: "task-A", projectId: "proj-1", parentTaskId: "", title: "資料作成", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false },
      { id: "task-B", projectId: "proj-1", parentTaskId: "", title: "レビュー返信", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-03T00:00", updatedAt: "2026-01-03T00:00", deleted: false }
    ];
    const mk = (id, date, cat, hh, mm, charge, discharge) => ({
      id, taskId: "", date, title: `${cat}作業${id}`, category: cat,
      plannedStartAt: `${date}T${hh}:00`, plannedEndAt: `${date}T${hh}:45`,
      actualStartAt: `${date}T${hh}:${mm}`, actualEndAt: `${date}T${Number(hh) + 1}:00`,
      completed: true, charge, discharge,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false
    });
    // 開発×4(10時台着手・充電源) / 学習×2(14時台着手・放電源)
    s.blocks = [
      ...devDates.map((d, i) => mk(`dev-${i}`, d, "開発", "10", "15", 3, 1)),
      ...learnDates.map((d, i) => mk(`lrn-${i}`, d, "学習", "14", "30", 1, 3))
    ];
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { TODAY, KEY, devDates: [2, 3, 4, 5].map(daysAgo), learnDates: [6, 7].map(daysAgo) });
  await page.reload();
  await page.waitForTimeout(500);

  // fetch モック(下書きスケジュール)
  await page.evaluate(() => {
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      const prompt = String(JSON.parse(opts.body).messages[0].content);
      let text = "";
      if (prompt.includes("タイムボックス計画") || prompt.includes('"plan"')) {
        text = '```json\n{"plan":[{"id":"task-A","start":"13:00","minutes":45},{"id":"task-B","start":"16:00","minutes":30}]}\n```';
      }
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 }));
    };
  });

  // ============ [1] AI下書きの Undo/Redo(#10)============
  console.log("[1] AI下書きの Undo/Redo");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(700);
  check("下書き2件が配置される", await page.locator(".draft-block").count() === 2);
  check("初期状態は Undo/Redo とも無効",
    await page.locator('[data-action="draft-undo"]').isDisabled()
    && await page.locator('[data-action="draft-redo"]').isDisabled());

  // 1件×で削除 → 1件、Undo有効
  await page.locator('.draft-block:has-text("レビュー返信") .draft-remove').click();
  await page.waitForTimeout(300);
  check("削除で1件になる", await page.locator(".draft-block").count() === 1);
  check("削除後 Undo が有効", !(await page.locator('[data-action="draft-undo"]').isDisabled()));

  // Undo → 2件に復元、Redo有効
  await page.click('[data-action="draft-undo"]');
  await page.waitForTimeout(300);
  check("Undo で2件に復元される", await page.locator(".draft-block").count() === 2);
  check("復元後 レビュー返信 が戻る", await page.locator('.draft-block:has-text("レビュー返信")').count() === 1);
  check("Undo 後 Redo が有効", !(await page.locator('[data-action="draft-redo"]').isDisabled()));

  // Redo → 再び1件
  await page.click('[data-action="draft-redo"]');
  await page.waitForTimeout(300);
  check("Redo で再び1件になる", await page.locator(".draft-block").count() === 1);

  // 破棄(理由メモ付き)
  await page.click('[data-action="draft-discard"]');
  await page.waitForTimeout(200);
  check("破棄モーダルに理由メモ欄がある", await page.locator('[data-modal-field="reason"]').count() === 1);
  await page.fill('[data-modal-field="reason"]', "この日は外出予定");
  await page.click('[data-action="draft-discard-submit"]');
  await page.waitForTimeout(300);
  check("破棄で下書きが消える", await page.locator(".draft-block").count() === 0);
  const hist = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).aiScheduleHistory || [], KEY);
  const lastDisc = hist.filter((h) => h.outcome === "discarded").slice(-1)[0];
  check("破棄が discarded として記録される", !!lastDisc, JSON.stringify(hist.slice(-1)));
  check("却下理由メモが記録される", lastDisc && lastDisc.reason === "この日は外出予定", lastDisc && lastDisc.reason);

  // ============ [2] 計器盤ドリルダウン(#9)============
  console.log("[2] 計器盤ドリルダウン");
  await page.click('[data-action="nav"][data-view="stats"]');
  await page.waitForTimeout(400);
  // カテゴリ別エネルギー収支の行がドリル可能
  const devRow = page.locator('.stats-div-row.is-drill[data-cat="開発"]');
  check("カテゴリ収支に 開発 のドリル行がある", await devRow.count() === 1);
  check("ドーナツ凡例にドリル行がある", (await page.locator('.stats-legend-row.is-drill').count()) >= 1);
  check("ヒストグラムにドリルセルがある", (await page.locator('.stats-hist-cell.is-drill').count()) >= 1);

  await devRow.click();
  await page.waitForTimeout(300);
  check("ドリル明細モーダルが開く", await page.locator('.stats-drill-list').count() === 1);
  check("開発カテゴリの完了Block4件が並ぶ", await page.locator('.stats-drill-row').count() === 4,
    String(await page.locator('.stats-drill-row').count()));
  const modalText = await page.evaluate(() => document.querySelector(".modal-card")?.textContent || "");
  check("モーダル見出しにカテゴリ名", modalText.includes("開発"));

  // 行タップでその日のタスクシュートへジャンプ(最新=daysAgo(2))
  await page.locator('.stats-drill-row').first().click();
  await page.waitForTimeout(300);
  const jumped = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return { view: s.currentView, date: s.selectedDate };
  }, KEY);
  check("ジャンプで タスクシュート に遷移", jumped.view === "tasks", jumped.view);
  check("ジャンプで対象日に移動", jumped.date === daysAgo(2), `${jumped.date} vs ${daysAgo(2)}`);
  check("ジャンプ後モーダルは閉じている", await page.locator('.stats-drill-list').count() === 0);

  // ヒストグラムの時間帯ドリル(10時台に着手した4件)
  await page.click('[data-action="nav"][data-view="stats"]');
  await page.waitForTimeout(400);
  await page.locator('.stats-hist-cell.is-drill[data-hour="10"]').click();
  await page.waitForTimeout(300);
  check("10時台ドリルで4件(開発の着手)", await page.locator('.stats-drill-row').count() === 4,
    String(await page.locator('.stats-drill-row').count()));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
