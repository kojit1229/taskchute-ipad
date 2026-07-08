// v52 検証: AIスケジュール学習ループ(aiPlan保存 / 採否記録 / 傾向ダイジェスト注入)
const { chromium, ROOT, launchOptions, startServer } = require("./helpers");

const PORT = 4195;
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

  // ---- seed: APIキー + タスク2件 + 過去の実績Block(午前=着手良/夜=着手悪) + 既存学習履歴 ----
  await page.evaluate(({ TODAY, KEY, past }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.ai = { apiKey: "sk-ant-test", model: "claude-opus-4-8" };
    s.projects.push({ id: "proj-1", kind: "normal", title: "P", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false });
    s.tasks.push(
      { id: "task-A", projectId: "proj-1", parentTaskId: "", title: "資料作成", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false },
      { id: "task-B", projectId: "proj-1", parentTaskId: "", title: "レビュー返信", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-03T00:00", updatedAt: "2026-01-03T00:00", deleted: false }
    );
    // 過去8週の実績: 午前(10:00)はほぼ着手・夜(20:00)は不着手、というパターンを作る
    const mk = (id, date, hh, started) => ({
      id, taskId: "", date, title: `過去${id}`, category: "作業",
      plannedStartAt: `${date}T${hh}:00`, plannedEndAt: `${date}T${hh}:45`,
      actualStartAt: started ? `${date}T${hh}:10` : "", actualEndAt: started ? `${date}T${hh}:50` : "",
      completed: started, charge: started ? 2 : 0, discharge: started ? 1 : 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false
    });
    past.forEach((d, i) => {
      s.blocks.push(mk(`am-${i}`, d, "10", true));
      s.blocks.push(mk(`ev-${i}`, d, "20", i % 3 === 0));  // 夜は1/3しか着手しない
      if (i < 5) s.blocks.push(mk(`noon-${i}`, d, "13", true));  // 昼バンド(エネルギー集計用)
    });
    // 既存のAI提案履歴(早朝提案は却下されがち、というシグナル)
    s.aiScheduleHistory = past.slice(0, 4).map((d, i) => ({
      date: d, title: `朝提案${i}`, category: "", aiStart: "06:00", aiMin: 30,
      outcome: i === 0 ? "confirmed" : "removed", userStart: i === 0 ? "09:00" : null, userMin: i === 0 ? 30 : null, at: `${d}T08:00`
    }));
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { TODAY, KEY, past: [7, 10, 14, 17, 21, 24, 28, 31].map(daysAgo) });
  await page.reload();
  await page.waitForTimeout(600);

  // fetch モック
  await page.evaluate(() => {
    window.__aiPrompts = [];
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      const prompt = String(JSON.parse(opts.body).messages[0].content);
      window.__aiPrompts.push(prompt);
      let text = "";
      if (prompt.includes("タイムボックス計画")) {
        text = '```json\n{"plan":[{"id":"task-A","start":"13:00","minutes":45},{"id":"task-B","start":"16:00","minutes":30}]}\n```';
      } else if (prompt.includes("今日やるべきタスク")) {
        text = '```json\n{"suggestions":[{"title":"x","taskId":"","minutes":30,"reason":"r"}]}\n```';
      }
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 }));
    };
  });

  // ---- [1] 傾向ダイジェストがプロンプトに注入される ----
  console.log("[1] 学習ダイジェストの注入");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(700);
  const sp = await page.evaluate(() => window.__aiPrompts.find((p) => p.includes("タイムボックス計画")) || "");
  check("傾向セクションが含まれる", sp.includes("過去の実績から自動集計した傾向"));
  check("時間帯別の着手率(午前=高)", /午前\(9-12時\)の計画Block: 着手率100%/.test(sp), sp.split("\n").filter((l) => l.includes("計画Block")).join(" | "));
  check("時間帯別の着手率(夜=低)", /夜\(18-23時\)の計画Block: 着手率(2[0-9]|3[0-9])%/.test(sp));
  check("開始ズレ(平均+10分)が含まれる", sp.includes("+10分"));
  check("AI提案の採否実績(4件提案→採用1/却下3)", sp.includes("4件提案 → 採用1 / 却下3"));
  check("曜日の傾向が含まれる", sp.includes("曜の過去8週"));
  check("エネルギー収支の傾向が含まれる", sp.includes("平均エネルギー収支"));

  // ---- [2] 確定時: aiPlan保存 + confirmed記録(D&D後のユーザ値も) ----
  console.log("[2] 確定時の記録");
  check("下書き2件が配置される", await page.locator(".draft-block").count() === 2);
  // 1件目(13:00 資料作成)を60px下へドラッグ(=+60分 → 14:00)
  const first = page.locator('.draft-block:has-text("資料作成")');
  let box = await first.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  // 2件目(レビュー返信)は×で却下
  await page.locator('.draft-block:has-text("レビュー返信") .draft-remove').click();
  await page.waitForTimeout(300);
  check("却下で1件になる", await page.locator(".draft-block").count() === 1);
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const result = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const b = s.blocks.find((x) => x.title === "資料作成" && !x.deleted);
    const hist = s.aiScheduleHistory.slice(-2);
    return { block: b ? { start: b.plannedStartAt, aiPlan: b.aiPlan } : null, hist };
  }, KEY);
  check("確定Blockに aiPlan(元提案13:00/45分)が残る", result.block && result.block.aiPlan && result.block.aiPlan.start === "13:00" && result.block.aiPlan.minutes === 45, JSON.stringify(result.block));
  check("確定はユーザ調整後の14:00", result.block && result.block.start.endsWith("T14:00"));
  const confirmedH = result.hist.find((h) => h.outcome === "confirmed" && h.title === "資料作成");
  const removedH = result.hist.find((h) => h.outcome === "removed" && h.title === "レビュー返信");
  check("履歴: confirmed(ai 13:00 → user 14:00)", confirmedH && confirmedH.aiStart === "13:00" && confirmedH.userStart === "14:00" && confirmedH.aiMin === 45, JSON.stringify(result.hist));
  check("履歴: removed(却下シグナル)", removedH && removedH.aiStart === "16:00" && removedH.userStart === null);

  // ---- [3] 次回の提案に「AI下書き経由のBlock」「採否更新」が反映される ----
  console.log("[3] ループ2周目");
  // 確定したBlockに実績を付けて過去日に移す(実績突き合わせを発火させる)
  await page.evaluate(({ KEY, d }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const b = s.blocks.find((x) => x.title === "資料作成" && x.aiPlan);
    b.date = d; b.plannedStartAt = `${d}T14:00`; b.plannedEndAt = `${d}T15:15`;
    b.actualStartAt = `${d}T14:05`; b.actualEndAt = `${d}T15:00`; b.completed = true;
    // AI経由Blockのしきい値(n>=3)を満たすため、過去の完了Blockにも aiPlan を付与
    s.blocks.find((x) => x.id === "am-0").aiPlan = { start: "10:00", minutes: 45 };
    s.blocks.find((x) => x.id === "am-1").aiPlan = { start: "10:00", minutes: 45 };
    // 2周目用の候補タスクを補充
    s.tasks.push({ id: "task-C", projectId: "proj-1", parentTaskId: "", title: "次の作業", category: "", status: "todo", dueDate: "", description: "", createdAt: "2026-01-04T00:00", updatedAt: "2026-01-04T00:00", deleted: false });
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, d: daysAgo(2) });
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__aiPrompts = [];
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      window.__aiPrompts.push(String(JSON.parse(opts.body).messages[0].content));
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: '```json\n{"plan":[{"id":"task-C","start":"10:00","minutes":30}]}\n```' }] }), { status: 200 }));
    };
  });
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(700);
  const sp2 = await page.evaluate(() => window.__aiPrompts[0] || "");
  check("AI下書き経由Blockの着手率が注入される", sp2.includes("AI下書き経由のBlock: ") && sp2.includes("着手率100%"), sp2.split("\n").filter((l) => l.includes("AI下書き")).join(" | "));
  check("採否が更新される(6件提案 → 採用2 / 却下4)", sp2.includes("6件提案 → 採用2 / 却下4"), sp2.split("\n").filter((l) => l.includes("件提案")).join(" | "));
  // 破棄も記録される(v57: 破棄は理由メモ付きモーダル → 理由を入れて submit)
  await page.click('[data-action="draft-discard"]');
  await page.waitForTimeout(200);
  await page.fill('[data-modal-field="reason"]', "午前は会議で埋まっている");
  await page.click('[data-action="draft-discard-submit"]');
  await page.waitForTimeout(300);
  const lastH = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).aiScheduleHistory.slice(-1)[0], KEY);
  check("破棄が discarded として記録される", lastH && lastH.outcome === "discarded" && lastH.title === "次の作業", JSON.stringify(lastH));
  check("却下理由メモが記録される", lastH && lastH.reason === "午前は会議で埋まっている", lastH && lastH.reason);

  // ---- [4] 今日のタスク提案にもダイジェスト注入 / 後方互換 ----
  console.log("[4] 今日のタスク提案への注入 / 後方互換");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ai-today-suggest"]');
  await page.waitForTimeout(800);
  const tp = await page.evaluate(() => window.__aiPrompts.find((p) => p.includes("今日やるべきタスク")) || window.__aiPrompts[1] || "");
  check("今日の提案にも傾向が注入される", tp.includes("過去の実績から自動集計した傾向"));
  await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());
  // v51以前のstate(aiScheduleHistoryなし)でも壊れない
  const compat = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    delete s.aiScheduleHistory;
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  }, KEY);
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('[data-action="nav"][data-view="home"]');  // normalizeState後の状態を永続化させる
  await page.waitForTimeout(300);
  const compatOk = await page.evaluate((KEY) => Array.isArray(JSON.parse(localStorage.getItem(KEY)).aiScheduleHistory), KEY);
  check("旧stateから aiScheduleHistory が補完される", compat && compatOk);

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
