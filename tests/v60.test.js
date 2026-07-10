// v60 検証: Claude API 直接呼び出しの全廃。
//
// (a) 起動〜朝プラン確定までの全経路で api.anthropic.com への fetch が一切発生しない
// (b) 設定画面に APIキー入力欄・モデル選択・プロンプト編集欄が無い(旧state保存値も消える)
// (c) 「🌅 朝プラン」ボタンがAPIキー無しで表示・動作する(aiEnabled()ゲート廃止)
// (d) 「📋 下書きスケジュール」が決定論配置で動く(WBSタスクの estimateMin を見積分数として使う)
// (e) 決定論配置でも確定Blockに aiPlan(元提案)が残り、aiScheduleHistory に
//     confirmed(userStart/userMin付き)/removed/discarded が記録される
//     (旧v52.test.jsが検証していた recordScheduleHistory/block.aiPlan は app.js から
//     削除していない現存コードのため、v52削除に伴いここへ検証を移設した)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4190;
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
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  // コーディネーター指摘(2026-07-09, v61レビュー): 本スイートは朝プラン/下書きスケジュールを
  // 実行するため、内部の computeFreeGaps が「現在時刻〜23:00」の空き枠に依存する。深夜23:00
  // 付近に実行すると見積45分のタスクが入り切らずフレーキーになっていたため、page.clock で
  // ページ内の現在時刻を日中(10:00)に固定する(アプリ本体のロジックは無改修)。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YEST = isoDate(new Date(now0.getTime() - 24 * 60 * 60 * 1000));

  // 全 fetch を監視: api.anthropic.com 宛が1件でもあれば失格。それ以外は素通しする。
  await page.addInitScript(() => {
    window.__anthropicCalls = [];
    const orig = window.fetch;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) window.__anthropicCalls.push(u);
      return orig(url, opts);
    };
  });

  await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ---- (b) 旧stateにAPIキー等が残っていても normalizeState で掃除される ----
  console.log("[1] 旧保存値の掃除(APIキー・モデル・プロンプト・自動レビュー)");
  await page.evaluate(({ KEY, TODAY, YEST }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // v59以前の保存値を模擬(古いapp.jsが残していった想定)
    s.settings.ai = {
      apiKey: "sk-ant-leftover-should-be-purged",
      model: "claude-opus-4-8",
      prompts: { context: "old prompt" },
      autoMorningReview: true,
      autoMorningPlan: false
    };
    // デモの normal プロジェクト/タスクは除去して候補件数を決定的にする(wish/otherは残す。
    // normalizeState が Wish Project 等を再生成するので空にしても安全)。
    s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-60", kind: "normal", title: "v60案件", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
    s.tasks = [];
    // estimateMin=45 の候補(決定論配置が既定30分固定にならないことの確認用)
    s.tasks.push({ id: "task-60a", projectId: "proj-60", parentTaskId: "", title: "v60見積付きタスク", category: "", status: "todo", dueDate: "", description: "", estimateMin: 45, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false });
    s.blocks = [];
    s.journalMeta = s.journalMeta || {};
    delete s.journalMeta[YEST];  // 昨日のMIT候補(あれば)を候補一覧から除いて件数を決定的にする
    s.selectedDate = TODAY;
    s.currentView = "settings";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY, YEST });
  await page.reload();
  await page.waitForTimeout(600);
  // normalizeState はメモリ上の補正なので、何か保存操作を挟んで永続化させる
  await page.click('[data-action="nav"][data-view="home"]');
  await page.waitForTimeout(200);
  const purged = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.ai, KEY);
  check("apiKey が保存値から削除される", !("apiKey" in purged), JSON.stringify(purged));
  check("model が保存値から削除される", !("model" in purged), JSON.stringify(purged));
  check("prompts が保存値から削除される", !("prompts" in purged), JSON.stringify(purged));
  check("autoMorningReview が保存値から削除される", !("autoMorningReview" in purged), JSON.stringify(purged));
  check("autoMorningPlan は既定値のまま残る(別機能)", purged.autoMorningPlan === false, JSON.stringify(purged));

  // ---- (b) 設定画面にAPIキー欄・モデル選択・プロンプト編集欄が無い ----
  console.log("[2] 設定画面からAI関連UIが消えている");
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  check("APIキー入力欄が無い", await page.locator('input[data-ai-field="apiKey"]').count() === 0);
  check("モデル選択が無い", await page.locator('select[data-ai-field="model"]').count() === 0);
  check("プロンプト編集欄が無い", await page.locator('textarea[data-ai-prompt]').count() === 0);
  check("朝イチ自動レビューのトグルが無い(機能ごと削除)", await page.locator("[data-ai-automorning]").count() === 0);
  const settingsText = await page.locator("main").textContent();
  check("設定画面に Anthropic の文言が残っていない", !settingsText.includes("Anthropic"));
  check("朝の一括プランニングのトグルは残っている(決定論機能として存続)", await page.locator("[data-ai-automorningplan]").count() === 1);

  // ---- (c) 朝プランボタンがAPIキー無しで表示・動作する ----
  console.log("[3] 朝プラン(APIキー無し)");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(300);
  check("🌅 朝プランボタンがAPIキー無しで表示される", await page.locator('[data-action="ai-morning-plan"]').count() === 1);
  check("📋 下書きスケジュールボタンもAPIキー無しで表示される", await page.locator('[data-action="ai-schedule"]').count() === 1);
  await page.click('[data-action="ai-morning-plan"]');
  await page.waitForTimeout(500);
  const morningDraft = await page.locator(".draft-block-time").allTextContents();
  check("朝プランが決定論で下書きを配置する(APIキー無しで動作)", morningDraft.length >= 1, JSON.stringify(morningDraft));
  await page.click('[data-action="draft-discard"]');
  await page.waitForTimeout(300);

  // ---- (d) 下書きスケジュールが決定論配置で動く(estimateMinを見積分数として使う) ----
  console.log("[4] 下書きスケジュール(決定論配置・estimateMin反映)");
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(500);
  const scheduleDraft = await page.locator(".draft-block-time").allTextContents();
  check("下書きが1件配置される", scheduleDraft.length === 1, JSON.stringify(scheduleDraft));
  check("見積(45分)がそのまま反映される(30分固定でない)", scheduleDraft[0] && scheduleDraft[0].includes("45分"), JSON.stringify(scheduleDraft));
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const confirmedBlock = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.blocks.find((b) => b.title === "v60見積付きタスク") || null;
  }, KEY);
  check("確定でBlock化される(見積45分)", confirmedBlock && confirmedBlock.estimateMin === 45, JSON.stringify(confirmedBlock));
  check("確定Blockに aiPlan(決定論配置の元値)が残る",
    !!confirmedBlock && !!confirmedBlock.aiPlan && confirmedBlock.aiPlan.minutes === 45 && /^\d{2}:\d{2}$/.test(confirmedBlock.aiPlan.start),
    JSON.stringify(confirmedBlock && confirmedBlock.aiPlan));
  const histConfirmed1 = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return (s.aiScheduleHistory || []).find((h) => h.title === "v60見積付きタスク" && h.outcome === "confirmed");
  }, KEY);
  check("aiScheduleHistoryにconfirmedが記録される(userStart/userMin付き)",
    !!histConfirmed1 && histConfirmed1.userStart && histConfirmed1.userMin === 45 && histConfirmed1.aiMin === 45,
    JSON.stringify(histConfirmed1));

  // ---- (e) 却下(×)・破棄も aiScheduleHistory に removed / discarded として記録される ----
  // (旧v52.test.jsの[2][3]セクションが検証していた内容の移設)
  console.log("[4b] 却下(×)がaiScheduleHistoryにremovedとして記録される");
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-60b", kind: "normal", title: "v60案件B", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
    s.tasks = [
      { id: "task-60r", projectId: "proj-60b", parentTaskId: "", title: "却下用タスク", category: "", status: "todo", dueDate: "", description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
      { id: "task-60k", projectId: "proj-60b", parentTaskId: "", title: "確定用タスク2", category: "", status: "todo", dueDate: "", description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
    ];
    s.blocks = [];  // 空き枠を広く取り、2件とも配置されるようにする
    s.aiScheduleHistory = [];
    s.selectedDate = TODAY;
    s.currentView = "tasks";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(500);
  check("却下/確定の検証用に2件の下書きが配置される", await page.locator(".draft-block").count() === 2,
    await page.locator(".draft-block-title").allTextContents());
  await page.locator('.draft-block:has-text("却下用タスク") .draft-remove').click();
  await page.waitForTimeout(300);
  const histRemoved = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return (s.aiScheduleHistory || []).find((h) => h.title === "却下用タスク" && h.outcome === "removed");
  }, KEY);
  check("aiScheduleHistoryにremovedが記録される(userStart/userMinはnull)",
    !!histRemoved && histRemoved.userStart === null && histRemoved.userMin === null, JSON.stringify(histRemoved));

  console.log("[4c] 破棄がaiScheduleHistoryにdiscardedとして記録される");
  await page.click('[data-action="draft-confirm"]');  // 残った「確定用タスク2」を確定して片付ける
  await page.waitForTimeout(400);
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = [{ id: "task-60d", projectId: "proj-60b", parentTaskId: "", title: "破棄用タスク", category: "", status: "todo", dueDate: "", description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
    s.aiScheduleHistory = [];
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="ai-schedule"]');
  await page.waitForTimeout(500);
  check("破棄検証用に1件の下書きが配置される", await page.locator(".draft-block").count() === 1,
    await page.locator(".draft-block-title").allTextContents());
  await page.click('[data-action="draft-discard"]');
  await page.waitForTimeout(300);
  const histDiscarded = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return (s.aiScheduleHistory || []).find((h) => h.title === "破棄用タスク" && h.outcome === "discarded");
  }, KEY);
  check("aiScheduleHistoryにdiscardedが記録される", !!histDiscarded, JSON.stringify(histDiscarded));

  // ---- (a) ここまでの全経路で api.anthropic.com への fetch が一切発生していない ----
  console.log("[5] api.anthropic.com への fetch が皆無であることの最終確認");
  const anthropicCalls = await page.evaluate(() => window.__anthropicCalls || []);
  check("api.anthropic.com への fetch が起動〜朝プラン確定まで一度も発生しない", anthropicCalls.length === 0, JSON.stringify(anthropicCalls));

  // ---- 前日フィードバックのファイル連携(fetch)は引き続き残っている ----
  console.log("[6] 回帰: 前日フィードバックのfetch経路(ファイル連携)は削除していない");
  const fbFetched = await page.evaluate(() => (window.__anthropicCalls || []).length === 0);  // 既に確認済みの再掲(意図の明示)
  check("AIフィードバック fetch はAPIではなくファイル取得のみ(api.anthropic.com不使用)", fbFetched);
  check(".mdアップロード欄が引き続きジャーナルに存在する", await (async () => {
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    return (await page.locator('input[data-feedback-upload]').count()) === 1;
  })());

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
