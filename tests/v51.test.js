// v51 検証: プロンプト基盤(共通コンテキスト/カスタム指示/テンプレ) / 朝イチ自動レビュー / 今日のタスク提案
const { chromium, ROOT, launchOptions, startServer } = require("./helpers");

const PORT = 4197;
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

  // ---- seed ----
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  await page.evaluate(({ TODAY, YEST, KEY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.ai = { apiKey: "sk-ant-test", model: "claude-opus-4-8" };
    s.projects = s.projects || [];
    s.projects.push({ id: "proj-1", kind: "normal", title: "英語学習", category: "", status: "active", description: "TOEIC 800", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false, collapsed: false });
    s.tasks = s.tasks || [];
    s.tasks.push({ id: "task-A", projectId: "proj-1", parentTaskId: "", title: "資料作成", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false });
    // 昨日の実行データ + ジャーナル(朝イチ自動レビューの対象)
    s.blocks = s.blocks || [];
    s.blocks.push({ id: "blk-y", taskId: "", date: YEST, title: "昨日の作業", category: "", plannedStartAt: `${YEST}T10:00`, plannedEndAt: `${YEST}T11:00`, actualStartAt: `${YEST}T10:00`, actualEndAt: `${YEST}T11:00`, completed: true, charge: 2, discharge: 1, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false });
    s.journals = s.journals || {};
    s.journals[YEST] = "昨日は集中できた。";
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem("taskchute-auto-review-date");
  }, { TODAY, YEST, KEY });
  await page.reload();
  await page.waitForTimeout(400);

  // fetch モック(全プロンプト記録)
  await page.evaluate(() => {
    window.__aiPrompts = [];
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("api.anthropic.com")) return Promise.resolve(new Response("{}", { status: 200 }));
      const prompt = String(JSON.parse(opts.body).messages[0].content);
      window.__aiPrompts.push(prompt);
      let text = "## フィードバック\n自動レビューOK";
      if (prompt.includes("今日やるべきタスク")) {
        text = '```json\n{"suggestions":[{"title":"資料作成","taskId":"task-A","minutes":45,"reason":"期限が今日"},{"title":"ジムに行く","taskId":"","minutes":60,"reason":"放電が続いている"}]}\n```';
      } else if (prompt.includes("WBS(作業分解)") || prompt.includes("作業分解")) {
        text = '```json\n{"tasks":[{"title":"単語100語","subtasks":[]}]}\n```';
      }
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 }));
    };
  });

  // ---- [1] 設定: プロンプト設定UI ----
  console.log("[1] プロンプト設定UI");
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  check("朝イチ自動レビューのトグルがある", await page.locator("[data-ai-automorning]").count() === 1);
  // v59: 朝の一括プランニングの指示部(morningPlan)が追加され6つになった
  check("プロンプト編集欄が6つ", await page.locator("textarea[data-ai-prompt]").count() === 6);
  await page.locator('summary:has-text("プロンプト設定")').click();
  await page.waitForTimeout(200);
  const ctxDefault = await page.locator('textarea[data-ai-prompt="context"]').inputValue();
  check("共通コンテキストに既定の叩き台", ctxDefault.includes("着手率") && ctxDefault.includes("エネルギー会計"));
  const customDefault = await page.locator('textarea[data-ai-prompt="custom"]').inputValue();
  check("カスタム指示に既定の叩き台", customDefault.includes("忖度"));
  // 編集 → 保存される
  await page.fill('textarea[data-ai-prompt="custom"]', "回答は必ず箇条書き3点で。");
  await page.waitForTimeout(200);
  const savedCustom = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.ai.prompts.custom, KEY);
  check("編集が保存される", savedCustom === "回答は必ず箇条書き3点で。");
  // 既定に戻す
  await page.locator('[data-action="ai-prompt-reset"][data-key="custom"]').click();
  await page.waitForTimeout(300);
  const resetCustom = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.ai.prompts.custom, KEY);
  check("既定に戻すが機能する", resetCustom.includes("忖度"));

  // ---- [2] 共通コンテキストが全呼び出しに前置される ----
  console.log("[2] 共通コンテキストの注入");
  await page.locator('summary:has-text("プロンプト設定")').click();  // reset時のrenderで閉じるため再度開く
  await page.waitForTimeout(200);
  await page.fill('textarea[data-ai-prompt="custom"]', "テスト用カスタム指示XYZ");
  await page.waitForTimeout(200);
  await page.click('[data-action="nav"][data-view="wbs"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ai-decompose"][data-id="proj-1"]');
  await page.waitForTimeout(600);
  const p1 = await page.evaluate(() => window.__aiPrompts[0] || "");
  check("分解プロンプトに共通コンテキスト", p1.includes("着手率") && p1.startsWith("私について"));
  check("分解プロンプトに12週目標(動的)", p1.includes("現在の12週サイクルの目標プロジェクト") && p1.includes("英語学習"), p1.split("\n").find((l) => l.includes("12週サイクルの目標")) || "(行なし)");
  check("分解プロンプトにカスタム指示", p1.includes("テスト用カスタム指示XYZ"));
  check("テンプレ指示部が含まれる", p1.includes("30〜60分"));
  await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());
  await page.waitForTimeout(200);

  // ---- [3] 今日のタスク提案 ----
  console.log("[3] 今日のタスク提案");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  check("今日のタスク提案ボタンがある(今日表示)", await page.locator('[data-action="ai-today-suggest"]').count() === 1);
  await page.click('[data-action="ai-today-suggest"]');
  await page.waitForTimeout(800);
  const p2 = await page.evaluate(() => window.__aiPrompts.find((x) => x.includes("今日やるべきタスク")) || "");
  check("昨日の日報が素材に含まれる(quiet生成)", p2.includes(`# 日報 ${YEST}`), p2.slice(0, 80));
  check("WBS候補がtaskId付きで含まれる", p2.includes("taskId:task-A"));
  check("提案モーダルが開く(2件+理由)", await page.locator("input[data-ai-today]").count() === 2);
  const modalTxt = await page.evaluate(() => document.body.textContent);
  check("理由が表示される", modalTxt.includes("期限が今日") && modalTxt.includes("放電が続いている"));
  await page.click('[data-action="ai-today-submit"]');
  await page.waitForTimeout(400);
  const todayBlocks = await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.blocks.filter((b) => b.date === TODAY && !b.deleted).map((b) => ({ t: b.title, task: b.taskId, est: b.estimateMin, start: b.plannedStartAt }));
  }, { KEY, TODAY });
  const sug1 = todayBlocks.find((b) => b.t === "資料作成");
  const sug2 = todayBlocks.find((b) => b.t === "ジムに行く");
  check("選択分が今日のBlockに登録(taskId/見積継承・時間未定)", sug1 && sug1.task === "task-A" && sug1.est === 45 && !sug1.start && sug2 && sug2.est === 60, JSON.stringify(todayBlocks));

  // ---- [4] 朝イチ自動レビュー ----
  console.log("[4] 朝イチ自動レビュー");
  // OFF のままリロード → 実行されないこと
  await page.evaluate(() => { window.__aiPrompts = []; localStorage.removeItem("taskchute-auto-review-date"); });
  await page.reload();
  await page.waitForTimeout(5200);
  // リロードで fetch モックが消えるので、実呼び出しは craft: OFF なので何も起きないはず(実APIにも飛ばない: キーはあるがOFF)
  let fb = await page.evaluate(({ KEY, YEST }) => (JSON.parse(localStorage.getItem(KEY)).feedback || {})[YEST] || "", { KEY, YEST });
  check("OFF時は自動実行されない", fb === "");
  // ON にして再読込(モックをinitスクリプトで先に仕込む)
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.ai.autoMorningReview = true;
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem("taskchute-auto-review-date");
  }, KEY);
  await ctx.addInitScript(() => {
    const orig = window.fetch;
    window.__autoPrompts = [];
    window.fetch = (url, opts = {}) => {
      if (String(url).includes("api.anthropic.com")) {
        window.__autoPrompts.push(String(JSON.parse(opts.body).messages[0].content));
        return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "## フィードバック\n朝の自動レビュー" }] }), { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  await page.reload();
  await page.waitForTimeout(5800);
  fb = await page.evaluate(({ KEY, YEST }) => (JSON.parse(localStorage.getItem(KEY)).feedback || {})[YEST] || "", { KEY, YEST });
  check("ON時は起動後に昨日のレビューが自動取得される", fb.includes("朝の自動レビュー"), fb.slice(0, 60));
  const autoP = await page.evaluate(() => window.__autoPrompts[0] || "");
  check("自動レビューにも共通コンテキストが付く", autoP.startsWith("私について"));
  check("1日1回ガードが記録される", await page.evaluate(() => localStorage.getItem("taskchute-auto-review-date") !== null));
  // 再読込しても再実行されない(feedback 既存 + 日付ガード)
  await page.evaluate(() => { window.__autoPrompts = []; });
  await page.reload();
  await page.waitForTimeout(5200);
  const again = await page.evaluate(() => (window.__autoPrompts || []).length);
  check("2回目の起動では再実行されない", again === 0);

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
