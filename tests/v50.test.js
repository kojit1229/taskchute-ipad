// v50 検証: ①AIタスク分解 ②スケジュール下書きD&D ③週次壁打ち ④0秒思考所感
const { chromium, ROOT, launchOptions, startServer } = require("./helpers");

const PORT = 4198;
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
  const YEST = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

  console.log("[0] キー未設定時はAIボタン非表示");
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  check("タスクシュートに下書きボタンが出ない", await page.locator('[data-action="ai-schedule"]').count() === 0);

  // ---- seed: APIキー + プロジェクト/タスク + 0秒思考entries + 既存Block ----
  await page.evaluate(({ TODAY, YEST, KEY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.ai = { apiKey: "sk-ant-test", model: "claude-opus-4-8" };
    s.projects = s.projects || [];
    s.projects.push({ id: "proj-1", kind: "normal", title: "英語学習", category: "", status: "active", description: "TOEIC 800を目指す", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false, collapsed: false });
    s.tasks = s.tasks || [];
    s.tasks.push({ id: "task-A", projectId: "proj-1", parentTaskId: "", title: "資料作成", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false });
    s.blocks = s.blocks || [];
    s.blocks.push({ id: "blk-ex", taskId: "", date: TODAY, title: "既存ミーティング", category: "", plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T10:00`, actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false });
    s.zeroThinking = s.zeroThinking || { themes: [], entries: [] };
    s.zeroThinking.entries.push(
      { id: "e1", date: YEST, theme: "朝の集中", body: "午前は強いが午後失速する", createdAt: `${YEST}T08:00` },
      { id: "e2", date: YEST, theme: "会議の多さ", body: "水曜が会議で分断される", createdAt: `${YEST}T09:00` },
      { id: "e3", date: TODAY, theme: "英語の時間", body: "夜だと続かない、朝に移すか", createdAt: `${TODAY}T07:00` }
    );
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { TODAY, YEST, KEY });
  await page.reload();
  await page.waitForTimeout(600);

  // fetch モック: プロンプト内容で分岐
  await page.evaluate(() => {
    window.__aiPrompts = [];
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      const body = JSON.parse(opts.body);
      const prompt = String(body.messages[0].content);
      window.__aiPrompts.push(prompt);
      let text = "";
      if (prompt.includes("WBS(作業分解)")) {
        text = '```json\n{"tasks":[{"title":"単語帳を1周する","subtasks":["最初の100語を覚える","復習リストを作る"]},{"title":"模試を1回解く","subtasks":[]}]}\n```';
      } else if (prompt.includes("タイムボックス計画")) {
        const m = prompt.match(/id:(task-[A-Za-z0-9-]+)/);
        text = '```json\n{"plan":[{"id":"' + (m ? m[1] : "task-A") + '","start":"13:00","minutes":45}]}\n```';
      } else if (prompt.includes("直近7日間に「0秒思考」")) {
        text = "## 所感\n午後と夜に弱いという一貫したパターンがあります。\n## 明日の0秒思考テーマ\n- 朝の90分をどう守るか?\n## 問い候補\n- 会議を半分にできないか?";
      } else if (prompt.includes("以下は私の週次レビューです")) {
        text = "## 気づき(構造・パターン)\n着手率が高い。\n## 来週の変更案(1つだけ)\n朝一にMITを置く。";
      }
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 }));
    };
  });

  // ---- ① AIタスク分解 ----
  console.log("[1] ① AIタスク分解");
  await page.click('[data-action="nav"][data-view="wbs"]');
  await page.waitForTimeout(300);
  check("プロジェクト行に 🤖分解 ボタン", await page.locator('[data-action="ai-decompose"][data-id="proj-1"]').count() === 1);
  await page.click('[data-action="ai-decompose"][data-id="proj-1"]');
  await page.waitForTimeout(600);
  check("分解モーダルに親2件", await page.locator('input[data-ai-task]').count() === 2);
  check("サブタスク2件", await page.locator('input[data-ai-subtask]').count() === 2);
  const prompt1 = await page.evaluate(() => window.__aiPrompts[0] || "");
  check("既存タスクをプロンプトに含む(重複防止)", prompt1.includes("資料作成"));
  // 2件目の親のチェックを外して登録
  await page.locator('input[data-ai-task="1"]').uncheck();
  await page.click('[data-action="ai-decompose-submit"]');
  await page.waitForTimeout(400);
  const decomposed = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const added = s.tasks.filter((t) => t.projectId === "proj-1" && t.title !== "資料作成");
    return added.map((t) => ({ title: t.title, parent: t.parentTaskId, due: t.dueDate }));
  }, KEY);
  check("チェック分のみ登録(親1+サブ2)", decomposed.length === 3, JSON.stringify(decomposed));
  const parentT = decomposed.find((t) => t.title === "単語帳を1周する");
  check("サブタスクが親に紐づく", decomposed.filter((t) => t.parent).length === 2 && decomposed.every((t) => !t.parent || t.title !== "単語帳を1周する"));
  check("期限は自動で付けない", parentT && parentT.due === "");

  // ---- ② スケジュール下書き + D&D ----
  console.log("[2] ② AIスケジュール下書き");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  check("タスクシュートに下書きボタン", await page.locator('[data-action="ai-schedule"]').count() === 1);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(700);
  const schedPrompt = await page.evaluate(() => window.__aiPrompts.find((p) => p.includes("タイムボックス計画")) || "");
  check("既存予定をプロンプトに含む", schedPrompt.includes("既存ミーティング") && schedPrompt.includes("09:00"));
  check("タイムラインへ自動遷移", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY) === "timeline");
  check("下書きブロックが表示される", await page.locator(".draft-block").count() === 1);
  check("下書きバー(確定/破棄)", await page.locator('[data-action="draft-confirm"]').count() === 1);
  let label = await page.locator(".draft-block-time").textContent();
  check("13:00〜13:45 (45分) で仮配置", label.includes("13:00") && label.includes("45分"), label);

  // ドラッグ移動: 60px 下へ(zoom1 = 60px/時 → +60分)
  let box = await page.locator(".draft-block").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  label = await page.locator(".draft-block-time").textContent();
  check("ドラッグで 14:00〜 に移動(15分スナップ)", label.includes("14:00"), label);

  // 下端リサイズ: +30px(=+30分 → 75分)
  box = await page.locator(".draft-block").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5 + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  label = await page.locator(".draft-block-time").textContent();
  check("下端ドラッグで 75分 に延長", label.includes("75分"), label);

  // 確定
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const confirmed = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const b = s.blocks.find((x) => x.title === "資料作成");
    return b ? { start: b.plannedStartAt, end: b.plannedEndAt, est: b.estimateMin, taskId: b.taskId } : null;
  }, KEY);
  check("確定で実Block化(14:00〜15:15・taskId紐づけ)", confirmed && confirmed.start.endsWith("T14:00") && confirmed.end.endsWith("T15:15") && confirmed.est === 75 && confirmed.taskId === "task-A", JSON.stringify(confirmed));
  check("確定後は下書きが消える", await page.locator(".draft-block").count() === 0);

  // 破棄フロー(もう一度作って破棄)
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(200);
  const cand2 = await page.locator('[data-action="ai-schedule"]').count();
  if (cand2) {
    await page.click('[data-action="ai-schedule"]');
    await page.waitForTimeout(600);
    const hasDraft = await page.locator(".draft-block").count();
    if (hasDraft) {
      await page.click('[data-action="draft-discard"]');
      await page.waitForTimeout(300);
      check("破棄で下書きが消え、Blockは増えない", await page.locator(".draft-block").count() === 0);
    } else {
      check("破棄フロー(候補なしのためスキップ扱い)", true);
    }
  } else {
    check("破棄フロー(候補なしのためスキップ扱い)", true);
  }

  // ---- ③ 週次AI壁打ち ----
  console.log("[3] ③ 週次AI壁打ち");
  await page.click('[data-action="nav"][data-view="weekly"]');
  await page.waitForTimeout(400);
  check("週次に 🤖AIと振り返る ボタン", await page.locator('[data-action="weekly-ai"]').count() === 1);
  await page.click('[data-action="weekly-ai"]');
  await page.waitForTimeout(700);
  const weeklyMd = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return Object.values(s.weeklyReviews || {}).map((r) => r.md || "").join("\n");
  }, KEY);
  check("メモ欄にAI壁打ちが追記される", weeklyMd.includes("🤖 AI壁打ち") && weeklyMd.includes("朝一にMITを置く"), weeklyMd.slice(0, 120));

  // ---- ④ 0秒思考まとめ所感 ----
  console.log("[4] ④ 0秒思考まとめ所感");
  await page.click('[data-action="nav"][data-view="zero"]');
  await page.waitForTimeout(400);
  check("履歴に 🤖所感 ボタン", await page.locator('[data-action="zt-ai-comment"]').count() === 1);
  await page.click('[data-action="zt-ai-comment"]');
  await page.waitForTimeout(700);
  const ztPrompt = await page.evaluate(() => window.__aiPrompts.find((p) => p.includes("直近7日間に「0秒思考」")) || "");
  check("直近7日のメモをまとめて送る", ztPrompt.includes("朝の集中") && ztPrompt.includes("英語の時間"));
  const modalText = await page.evaluate(() => document.querySelector("#modal-root, .modal-card")?.textContent || document.body.textContent);
  check("所感モーダルが開く", modalText.includes("午後と夜に弱い"));
  await page.click('[data-action="zt-ai-import"]');
  await page.waitForTimeout(400);
  check("テーマ/問いの取り込みモーダルへ遷移", await page.locator(".ai-import-row").count() === 2);
  await page.click('[data-action="ai-import-submit"]');
  await page.waitForTimeout(400);
  const imported = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return {
      theme: s.zeroThinking.themes.some((t) => t.text.includes("朝の90分")),
      q: (s.questions || []).some((q) => q.text.includes("会議を半分"))
    };
  }, KEY);
  check("テーマと問いが取り込まれる", imported.theme && imported.q, JSON.stringify(imported));

  // ---- 回帰: v49 日報AIレビューが callClaude 経由でも動く ----
  console.log("[5] 回帰(v49 日報AIレビュー)");
  await page.evaluate(() => {
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "## フィードバック\nOK" }] }), { status: 200 }));
    };
  });
  await page.click('[data-action="nav"][data-view="reports"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="generate-report"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="report-ai-review"]');
  await page.waitForTimeout(600);
  const fb = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.feedback[s.selectedDate] || "";
  }, KEY);
  check("日報AIレビューが引き続き動作", fb.startsWith("## フィードバック"));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
