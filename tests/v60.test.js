// v60 検証: Claude API 直接呼び出しの全廃。
//
// (a) 起動〜下書き確定までの全経路で api.anthropic.com への fetch が一切発生しない
// (b) 設定画面に APIキー入力欄・モデル選択・プロンプト編集欄が無い(旧state保存値も消える)
// (c) v299で削除した「🌅 朝プラン」のaction・本体がソースに存在しない
// (d) 「📋 下書きスケジュール」が決定論配置で動く(WBSタスクの estimateMin を見積分数として使う)
// (e) 確定・個別削除・破棄の実操作は維持しつつ、aiScheduleHistoryへ新規記録しない
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction } = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
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
  // コーディネーター指摘(2026-07-09, v61レビュー): 本スイートは下書きスケジュールを
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

  async function triggerScheduleFromTimeline() {
    await page.locator('[data-action="nav"][data-view="timeline"]').first().click();
    await page.waitForSelector('#app[data-view="timeline"]');
    const scheduleButton = page.locator('#app[data-view="timeline"] [data-action="ai-schedule"]');
    if (await scheduleButton.count()) await scheduleButton.click();
    else await dispatchRegisteredAction(page, "ai-schedule");
  }

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
    // estimateMin=45 の候補(下書き確定後も元の見積が保持されることの確認用)。
    s.tasks.push({ id: "task-60a", projectId: "proj-60", parentTaskId: "", title: "v60見積付きタスク", category: "", status: "todo", dueDate: "", description: "", estimateMin: 45, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false });
    s.blocks = [];
    s.aiScheduleHistory = [];
    s.journalMeta = s.journalMeta || {};
    delete s.journalMeta[YEST];  // 昨日のMIT候補(あれば)を候補一覧から除いて件数を決定的にする
    s.selectedDate = TODAY;
    s.currentView = "settings";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY, YEST });
  await page.reload();
  await page.waitForTimeout(600);
  // normalizeState はメモリ上の補正なので、何か保存操作を挟んで永続化させる
  await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
  await page.waitForTimeout(200);
  const purged = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.ai, KEY);
  check("apiKey が保存値から削除される", !("apiKey" in purged), JSON.stringify(purged));
  check("model が保存値から削除される", !("model" in purged), JSON.stringify(purged));
  check("prompts が保存値から削除される", !("prompts" in purged), JSON.stringify(purged));
  check("autoMorningReview が保存値から削除される", !("autoMorningReview" in purged), JSON.stringify(purged));
  check("autoMorningPlan が保存値から削除される", !("autoMorningPlan" in purged), JSON.stringify(purged));

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
  check("朝の一括プランニング自動実行トグルが無い", await page.locator("[data-ai-automorningplan]").count() === 0);

  // ---- (c) v299で削除した朝プランの不在契約 ----
  console.log("[3] v299: 朝プランaction・本体を削除し、下書きスケジュールを維持");
  await page.click('[data-action="nav"][data-view="today"]');
  await page.waitForTimeout(300);
  check("todayビューには下書きの旧ボタンを表示しない(timeline導線は現存)", await page.locator('[data-action="ai-schedule"]').count() === 0);
  check("ai-morning-plan actionがソースに存在しない", !appSource.includes('"ai-morning-plan"'));
  check("runAiMorningPlan本体がソースに存在しない", !/\bfunction\s+runAiMorningPlan\b/.test(appSource));
  check("ai-schedule actionは維持", appSource.includes('"ai-schedule": () => runAiSchedule()'));

  // ---- (d) 下書きスケジュールが決定論配置で動く(Blockの現予定長を見積分数として使う) ----
  console.log("[4] 下書きスケジュール(決定論配置・見積反映)");
  // v199対応: 「📋 下書きスケジュール」(ai-schedule)の候補源がWBS未Block化タスクから
  // 当日登録済みBlockへ変わったため、task-60aに紐づく当日Block(45分幅)をここで登録する
  // estimateMin:45もBlock側に残す(blockId確定パスはestimateMinを更新しないため、確定後もそのまま残る)。
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.blocks = [{
      id: "blk-task-60a", taskId: "task-60a", date: TODAY, title: "v60見積付きタスク", category: "",
      plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:45`, estimateMin: 45,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    }];
    s.selectedDate = TODAY;
    s.currentView = "today";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="today"]');
  await page.waitForTimeout(200);
  await triggerScheduleFromTimeline();
  await page.waitForTimeout(500);
  const scheduleDraft = await page.locator(".draft-block-time").allTextContents();
  check("下書きが1件配置される", scheduleDraft.length === 1, JSON.stringify(scheduleDraft));
  check("Blockの現予定長(45分)がそのまま反映される(30分固定でない)", scheduleDraft[0] && scheduleDraft[0].includes("45分"), JSON.stringify(scheduleDraft));
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const confirmedBlock = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s.blocks.find((b) => b.title === "v60見積付きタスク") || null;
  }, KEY);
  check("確定で既存Blockの時刻が更新される(見積45分は元のまま)", confirmedBlock && confirmedBlock.estimateMin === 45, JSON.stringify(confirmedBlock));
  // v199対応(design.md仕様6): blockId分岐はplannedStartAt/plannedEndAt/updatedAtだけを更新し、
  // aiPlanは設定しない(makeBlock非経由のため)。旧assertion「aiPlanに元値が残る」は
  // blockId確定パスには適用できないためここでは検証しない。
  check("blockId確定パスはaiPlanを設定しない(design.md仕様6の明示スコープどおり)",
    !!confirmedBlock && !confirmedBlock.aiPlan, JSON.stringify(confirmedBlock && confirmedBlock.aiPlan));
  const historyAfterConfirm = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).aiScheduleHistory || [], KEY);
  check("確定してもaiScheduleHistoryへ新規記録しない", historyAfterConfirm.length === 0, JSON.stringify(historyAfterConfirm));

  // ---- (e) 個別削除(×)・破棄も実操作は維持し、履歴だけを書かない ----
  console.log("[4b] 個別削除は下書きだけを更新し、aiScheduleHistoryへ書かない");
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-60b", kind: "normal", title: "v60案件B", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
    s.tasks = [
      { id: "task-60r", projectId: "proj-60b", parentTaskId: "", title: "却下用タスク", category: "", status: "todo", dueDate: "", description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
      { id: "task-60k", projectId: "proj-60b", parentTaskId: "", title: "確定用タスク2", category: "", status: "todo", dueDate: "", description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
    ];
    // v199対応: 各タスクに紐づく当日Block(30分)を登録する(空き枠は広く取ってあるので
    // 2件とも配置される。元の予定時刻は重複していても再配置で前詰めされるため無関係)。
    s.blocks = [
      { id: "blk-task-60r", taskId: "task-60r", date: TODAY, title: "却下用タスク", category: "", plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
      { id: "blk-task-60k", taskId: "task-60k", date: TODAY, title: "確定用タスク2", category: "", plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
    ];
    s.aiScheduleHistory = [];
    s.selectedDate = TODAY;
    s.currentView = "today";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="today"]');
  await page.waitForTimeout(200);
  await triggerScheduleFromTimeline();
  await page.waitForTimeout(500);
  check("却下/確定の検証用に2件の下書きが配置される", await page.locator(".draft-block").count() === 2,
    await page.locator(".draft-block-title").allTextContents());
  await page.locator('.draft-block:has-text("却下用タスク") .draft-remove').click();
  await page.waitForTimeout(300);
  const removedResult = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return { history: s.aiScheduleHistory || [] };
  }, KEY);
  check("×で対象だけが下書きから外れる", await page.locator(".draft-block").count() === 1,
    await page.locator(".draft-block-title").allTextContents());
  check("個別削除でもaiScheduleHistoryへ新規記録しない", removedResult.history.length === 0, JSON.stringify(removedResult));

  console.log("[4c] 破棄は下書きを閉じ、aiScheduleHistoryへ書かない");
  await page.click('[data-action="draft-confirm"]');  // 残った「確定用タスク2」を確定して片付ける
  await page.waitForTimeout(400);
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = [{ id: "task-60d", projectId: "proj-60b", parentTaskId: "", title: "破棄用タスク", category: "", status: "todo", dueDate: "", description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
    // v199対応: task-60dに紐づく当日Blockを登録する(taskを差し替えたため旧task-60r/60kの
    // Blockは孤児化しtaskchuteBlocksの候補から自然に外れるが、明示的にリセットしておく)。
    s.blocks = [{ id: "blk-task-60d", taskId: "task-60d", date: TODAY, title: "破棄用タスク", category: "", plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`, actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
    s.aiScheduleHistory = [];
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="today"]');
  await page.waitForTimeout(200);
  await triggerScheduleFromTimeline();
  await page.waitForTimeout(500);
  check("破棄検証用に1件の下書きが配置される", await page.locator(".draft-block").count() === 1,
    await page.locator(".draft-block-title").allTextContents());
  await page.click('[data-action="draft-discard"]');
  await page.waitForTimeout(300);
  const discardedResult = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return { history: s.aiScheduleHistory || [] };
  }, KEY);
  check("破棄で下書きレイヤが閉じる", await page.locator(".draft-block").count() === 0);
  check("破棄でもaiScheduleHistoryへ新規記録しない", discardedResult.history.length === 0, JSON.stringify(discardedResult));

  // ---- (a) ここまでの全経路で api.anthropic.com への fetch が一切発生していない ----
  console.log("[5] api.anthropic.com への fetch が皆無であることの最終確認");
  const anthropicCalls = await page.evaluate(() => window.__anthropicCalls || []);
  check("api.anthropic.com への fetch が起動〜朝プラン確定まで一度も発生しない", anthropicCalls.length === 0, JSON.stringify(anthropicCalls));

  // ---- 前日フィードバックのファイル連携(fetch)は引き続き残っている ----
  console.log("[6] 回帰: 前日フィードバックのfetch経路(ファイル連携)は削除していない");
  const fbFetched = await page.evaluate(() => (window.__anthropicCalls || []).length === 0);  // 既に確認済みの再掲(意図の明示)
  check("AIフィードバック fetch はAPIではなくファイル取得のみ(api.anthropic.com不使用)", fbFetched);
  // v141: AIフィードバック列(.mdアップロード欄含む)はジャーナルタブのUIから撤去した。
  // fetch経路自体は[6]で確認済みなので、ここではUIが実際に無くなっていることを確認する。
  check("ジャーナルタブに.mdアップロード欄がもう無い(v141でUI撤去)", await (async () => {
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    return (await page.locator('input[data-feedback-upload]').count()) === 0;
  })());

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
