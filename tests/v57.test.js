// v57 検証: ローカルAIコーチングがリポジトリ直下に直接pushした前日フィードバックの自動読込
//            (feedbackFiles未登録でも「今日から見た昨日」1日分だけは fetch する)
//            + F1: その無条件fetchは過去日ブラウズ時には出さない(前日ノイズ回避の回帰確認)
const path = require("path");
const fs = require("fs");
const { chromium, launchOptions, startServer, ROOT } = require("./helpers");

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

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const TODAY = iso(now);
  const YESTERDAY = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  // 実「昨日」と隣接しない過去日(前日=6日前になり、実「昨日」とは一致しない)
  const PAST = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5));
  const FEEDBACK_MARKER = "v57テスト用マーカー_" + Date.now();
  const feedbackPath = path.join(ROOT, `AIフィードバック_${YESTERDAY}.md`);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(600);

    // fetch監視: 実fetchは素通しし、AIフィードバック_*.md への要求だけ記録する(v56と同様の手法)
    await page.addInitScript(() => {
      window.__fbReqs = [];
      const orig = window.fetch;
      window.fetch = (url, opts) => {
        const u = String(url);
        if (u.includes("AIフィードバック_")) window.__fbReqs.push(u);
        return orig(url, opts);
      };
    });

    // ---- [1] F1回帰: 過去日ブラウズ中は前日分の無条件fetchを出さない ----
    console.log("[1] 過去日ブラウズでは前日分の無条件fetchを出さない(F1)");
    await page.evaluate(({ KEY, PAST }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.feedbackFiles = [];
      s.selectedDate = PAST;
      if (s.feedback) delete s.feedback[PAST];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, PAST });
    await page.reload();
    await page.waitForTimeout(700);
    const reqsPast = await page.evaluate(() => (window.__fbReqs || []).slice());
    check("過去日表示中は AIフィードバック fetch を一切出さない(前日分含む)",
      reqsPast.length === 0, JSON.stringify(reqsPast));

    // ---- [2] 直push検知: feedbackFiles未登録でも「今日から見た昨日」分はリポジトリ直下から読み込む ----
    console.log("[2] 直push検知: feedbackFiles未登録でも昨日分を読み込み、提案に反映される");
    fs.writeFileSync(feedbackPath, `# 昨日のAIフィードバック\n\n${FEEDBACK_MARKER}\n`, "utf8");

    // callClaude(api.anthropic.com宛)だけモックし、それ以外は素通しする(md/manifest等の実fetchは維持)
    await page.addInitScript(() => {
      window.__aiPrompts = [];
      const orig = window.fetch;
      window.fetch = (url, opts = {}) => {
        const u = String(url);
        if (!u.includes("api.anthropic.com")) return orig(url, opts);
        const prompt = String(JSON.parse(opts.body).messages[0].content);
        window.__aiPrompts.push(prompt);
        return Promise.resolve(new Response(JSON.stringify({
          content: [{ type: "text", text:
            '```json\n{"suggestions":[{"title":"テスト提案","minutes":30,"reason":"テスト"}]}\n```' }]
        }), { status: 200 }));
      };
    });

    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.feedbackFiles = [];
      s.selectedDate = TODAY;
      s.settings.ai = { apiKey: "sk-ant-test", model: "claude-opus-4-8" };
      s.currentView = "tasks";
      if (s.feedback) delete s.feedback[TODAY];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(700);

    const reqsToday = await page.evaluate(() => (window.__fbReqs || []).slice());
    check("当日表示時は「今日から見た昨日」分のみ fetch する(ちょうど1件)",
      reqsToday.length === 1 && reqsToday[0].includes(`AIフィードバック_${YESTERDAY}.md`),
      JSON.stringify(reqsToday));

    const ffAfter = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).feedbackFiles, KEY);
    check("直push検知した前日分が feedbackFiles に登録される(以後は正規ルート)",
      Array.isArray(ffAfter) && ffAfter.includes(YESTERDAY), JSON.stringify(ffAfter));

    check("「今日のタスク提案」ボタンが表示される(当日表示+APIキー設定済み)",
      await page.locator('[data-action="ai-today-suggest"]').count() === 1);
    await page.click('[data-action="ai-today-suggest"]');
    await page.waitForTimeout(700);

    const prompts = await page.evaluate(() => window.__aiPrompts || []);
    check("AI提案が実行される(callClaudeが呼ばれる)", prompts.length === 1, JSON.stringify(prompts.length));
    const prompt = prompts[0] || "";
    check("プロンプトに「昨日のAIフィードバック」節が含まれる", prompt.includes("----- 昨日のAIフィードバック -----"));
    check("プロンプトに直push分のフィードバック本文が反映されている(マーカー一致)",
      prompt.includes(FEEDBACK_MARKER));
  } finally {
    // リポジトリ直下に書いたテスト用ファイルは必ず削除する
    try { if (fs.existsSync(feedbackPath)) fs.unlinkSync(feedbackPath); } catch { /* ignore */ }
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
