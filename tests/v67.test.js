// v67由来の横断コア: AI作業Taskと旧AI連携stateのnormalizeState後方互換を固定する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, dispatchRegisteredAction
} = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const NOW = new Date(2026, 7, 27, 10, 0, 0, 0);
const TODAY = "2026-08-27";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  let aiWorkResultFixture = null;
  await page.route((url) => /\/AI作業結果_.*\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    if (aiWorkResultFixture === null) return route.fulfill({ status: 404, body: "not found (v67 fixture)" });
    return route.fulfill({ status: 200, contentType: "application/json", body: aiWorkResultFixture });
  });

  const readState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  async function reloadAfterAiWorkFetch() {
    const responsePromise = page.waitForResponse((response) => /\/AI作業結果_.*\.json$/.test(decodeURIComponent(new URL(response.url()).pathname)));
    await page.reload();
    const response = await responsePromise;
    await response.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  try {
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 欠落フィールドを持つ旧Task/旧stateを安全に正規化する");
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.tasks = [{
        id: "legacy-task", projectId: "", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${today}T00:00`, updatedAt: `${today}T00:00`,
        deleted: false
      }];
      state.blocks = [];
      state.projects = [];
      delete state.aiLinkFreshness;
      delete state.aiWorkProcessedIds;
      state.journalMeta[today] = { aiRequest: "旧依頼", aiTaskCandidates: ["旧候補"] };
      state.currentView = "today";
      state.selectedDate = today;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, today: TODAY });
    await page.reload();
    await page.waitForSelector(".today-tower .sec-journal");
    const normalized = await readState();
    const legacyTask = normalized.tasks.find((task) => task.id === "legacy-task");
    check("旧TaskにaiWork:falseを補完", legacyTask?.aiWork === false, JSON.stringify(legacyTask));
    check("旧TaskにaiWorkBrief空文字を補完", legacyTask?.aiWorkBrief === "", JSON.stringify(legacyTask));
    check("旧stateにaiLinkFreshness既定値を補完", normalized.aiLinkFreshness?.feedbackAt === null && normalized.aiLinkFreshness?.planAt === null, JSON.stringify(normalized.aiLinkFreshness));
    check("旧stateにaiWorkProcessedIds空配列を補完", Array.isArray(normalized.aiWorkProcessedIds) && normalized.aiWorkProcessedIds.length === 0);
    check("旧journalMetaの依頼・候補stateを保持", normalized.journalMeta[TODAY]?.aiRequest === "旧依頼"
      && normalized.journalMeta[TODAY]?.aiTaskCandidates?.[0] === "旧候補", JSON.stringify(normalized.journalMeta[TODAY]));
    check("today右カラムはJOURNALだけを正常描画", await page.locator(".tower-col-right > .sec-journal").count() === 1);
    check("廃止済みAI集約UIの操作要素を描画しない",
      await page.locator('[data-action="ai-work-approve"], [data-action="ai-work-question"], [data-action="ai-task-adopt"], [data-action="ai-task-dismiss"], .ai-freshness-line').count() === 0);

    console.log("[2] Task編集モーダルのaiWork/brief保存とWBS表示は維持する");
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.projects = [{
        id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${today}T00:00`, updatedAt: `${today}T00:00`,
        deleted: false, collapsed: false
      }];
      state.tasks = [{
        id: "task-ai1", projectId: "test-proj", parentTaskId: "", title: "AIに任せたいTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${today}T00:00`, updatedAt: `${today}T00:00`,
        deleted: false, aiWork: false, aiWorkBrief: ""
      }];
      state.currentView = "wbs";
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, today: TODAY });
    await page.reload();
    await page.waitForSelector('[data-action="edit-task"][data-id="task-ai1"]');
    check("保存前はWBS一覧に🤝マーク無し", await page.locator(".ai-work-flag").count() === 0);
    await page.click('[data-action="edit-task"][data-id="task-ai1"]');
    await page.check('[data-modal-field="aiWork"]');
    await page.fill('[data-modal-field="aiWorkBrief"]', "候補3社を比較してまとめてほしい");
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector(".ai-work-flag");
    const saved = (await readState()).tasks.find((task) => task.id === "task-ai1");
    check("aiWorkをtrueで保存", saved?.aiWork === true, JSON.stringify(saved));
    check("aiWorkBriefを保存", saved?.aiWorkBrief === "候補3社を比較してまとめてほしい", JSON.stringify(saved));
    check("保存後はWBS一覧に🤝マークを表示", await page.locator(".ai-work-flag").count() === 1);

    console.log("[3] 廃止UIの背後に残るcompleted actionを委譲発火し、実績BlockとTask更新を固定する");
    const completedResultId = `${TODAY}__ai-task-completed`;
    const blockedResultId = `${TODAY}__ai-task-blocked`;
    aiWorkResultFixture = JSON.stringify([
      {
        taskId: "ai-task-completed", title: "顧客資料の下調べ", status: "completed",
        summary: "候補3社をリスト化し比較表を作成した", outputPath: "workbench/out/v67/summary.md", minutes: 45
      },
      {
        taskId: "ai-task-blocked", title: "請求書テンプレ更新", status: "blocked",
        summary: "テンプレの過去バージョンが2つあり、どちらを正とするか確認が必要", outputPath: "", minutes: 0
      },
      { taskId: "", title: "本番環境への反映", status: "queued", summary: "", outputPath: "", minutes: 0 }
    ]);
    await page.evaluate(({ key, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.blocks = [];
      state.questions = [];
      state.aiWorkProcessedIds = [];
      state.tasks = [
        {
          id: "ai-task-completed", projectId: "", parentTaskId: "", title: "顧客資料の下調べ", category: "",
          status: "todo", progressNum: 25, dueDate: "", description: "", createdAt: `${today}T00:00`,
          updatedAt: `${today}T00:00`, deleted: false, aiWork: true, aiWorkBrief: "候補3社を比較"
        },
        {
          id: "ai-task-blocked", projectId: "", parentTaskId: "", title: "請求書テンプレ更新", category: "",
          status: "todo", progressNum: 0, dueDate: "", description: "", createdAt: `${today}T00:00`,
          updatedAt: `${today}T00:00`, deleted: false, aiWork: true, aiWorkBrief: ""
        }
      ];
      state.currentView = "today";
      state.selectedDate = today;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: KEY, today: TODAY });
    await reloadAfterAiWorkFetch();
    await page.waitForSelector(".today-tower");
    check("AI作業結果の廃止済み承認/質問ボタンはDOMへ戻さない",
      await page.locator('[data-action="ai-work-approve"], [data-action="ai-work-question"]').count() === 0);
    check("hydrationだけでは実績Blockを自動登録しない", (await readState()).blocks.length === 0);
    check("hydrationだけでは質問を自動生成しない", (await readState()).questions.length === 0);
    check("hydrationだけでは処理済みIDを記録しない", (await readState()).aiWorkProcessedIds.length === 0);

    await dispatchRegisteredAction(page, "ai-work-approve", { resultId: completedResultId });
    await page.waitForFunction(({ key, title }) => JSON.parse(localStorage.getItem(key)).blocks.some((block) => block.title === title),
      { key: KEY, title: "顧客資料の下調べ" });
    const approved = await readState();
    const registeredBlock = approved.blocks.find((block) => block.title === "顧客資料の下調べ" && !block.deleted);
    const completedTask = approved.tasks.find((task) => task.id === "ai-task-completed");
    check("承認で実績Blockを1件生成", approved.blocks.filter((block) => block.title === "顧客資料の下調べ" && !block.deleted).length === 1, JSON.stringify(approved.blocks));
    check("実績BlockのtaskIdを維持", registeredBlock?.taskId === "ai-task-completed", JSON.stringify(registeredBlock));
    check("実績Blockの日付は当日", registeredBlock?.date === TODAY, JSON.stringify(registeredBlock));
    check("実績BlockのカテゴリはAI作業", registeredBlock?.category === "AI作業", JSON.stringify(registeredBlock));
    check("実績Blockはcompleted", registeredBlock?.completed === true, JSON.stringify(registeredBlock));
    check("実績Blockの見積時間はfixtureの45分", registeredBlock?.estimateMin === 45, JSON.stringify(registeredBlock));
    check("実績Blockの予定開始は当日ローカル文字列", registeredBlock?.plannedStartAt?.startsWith(`${TODAY}T`), JSON.stringify(registeredBlock));
    check("実績Blockの予定終了は当日ローカル文字列", registeredBlock?.plannedEndAt?.startsWith(`${TODAY}T`), JSON.stringify(registeredBlock));
    check("実績Blockの実績開始は予定開始と一致", registeredBlock?.actualStartAt === registeredBlock?.plannedStartAt, JSON.stringify(registeredBlock));
    check("実績Blockの実績終了は予定終了と一致", registeredBlock?.actualEndAt === registeredBlock?.plannedEndAt, JSON.stringify(registeredBlock));
    check("実績Blockのcommentへsummaryを保持", registeredBlock?.comment === "候補3社をリスト化し比較表を作成した", JSON.stringify(registeredBlock));
    check("紐づくTaskをcompletedへ更新", completedTask?.status === "completed", JSON.stringify(completedTask));
    check("紐づくTaskの進捗を分母まで更新", Number(completedTask?.progressDen) > 0
      && Number(completedTask?.progressNum) === Number(completedTask?.progressDen), JSON.stringify(completedTask));
    check("紐づくTaskのupdatedAtを更新", completedTask?.updatedAt !== `${TODAY}T00:00`, JSON.stringify(completedTask));
    check("承認resultIdを処理済みに記録", approved.aiWorkProcessedIds.includes(completedResultId), JSON.stringify(approved.aiWorkProcessedIds));
    check("承認resultIdは1回だけ記録", approved.aiWorkProcessedIds.filter((id) => id === completedResultId).length === 1, JSON.stringify(approved.aiWorkProcessedIds));
    check("blocked resultIdは承認時点で未処理", !approved.aiWorkProcessedIds.includes(blockedResultId), JSON.stringify(approved.aiWorkProcessedIds));
    check("承認ではquestionsを生成しない", approved.questions.length === 0, JSON.stringify(approved.questions));

    console.log("[4] blocked actionを委譲発火し、問い生成と処理済みIDを固定する");
    await dispatchRegisteredAction(page, "ai-work-question", { resultId: blockedResultId });
    await page.waitForFunction(({ key, marker }) => JSON.parse(localStorage.getItem(key)).questions.some((question) => question.text.includes(marker)),
      { key: KEY, marker: "テンプレの過去バージョン" });
    const questioned = await readState();
    const raisedQuestion = questioned.questions.find((question) => question.text.includes("テンプレの過去バージョン"));
    check("質問actionでquestionsを1件生成", questioned.questions.filter((question) => question.text.includes("テンプレの過去バージョン")).length === 1, JSON.stringify(questioned.questions));
    check("質問本文へblocked summaryを保持", raisedQuestion?.text === "テンプレの過去バージョンが2つあり、どちらを正とするか確認が必要", JSON.stringify(raisedQuestion));
    check("質問originはai", raisedQuestion?.origin === "ai", JSON.stringify(raisedQuestion));
    check("質問に一意IDを付与", typeof raisedQuestion?.id === "string" && raisedQuestion.id.length > 0, JSON.stringify(raisedQuestion));
    check("質問に作成日時を付与", typeof raisedQuestion?.createdAt === "string" && raisedQuestion.createdAt.startsWith(TODAY), JSON.stringify(raisedQuestion));
    check("質問actionは実績Blockを増やさない", questioned.blocks.filter((block) => block.title === "顧客資料の下調べ" && !block.deleted).length === 1, JSON.stringify(questioned.blocks));
    check("blocked resultIdを処理済みに記録", questioned.aiWorkProcessedIds.includes(blockedResultId), JSON.stringify(questioned.aiWorkProcessedIds));
    check("blocked resultIdは1回だけ記録", questioned.aiWorkProcessedIds.filter((id) => id === blockedResultId).length === 1, JSON.stringify(questioned.aiWorkProcessedIds));
    check("completed resultIdも失わない", questioned.aiWorkProcessedIds.includes(completedResultId), JSON.stringify(questioned.aiWorkProcessedIds));
    check("処理済みIDはcompleted/blockedの2件だけ", questioned.aiWorkProcessedIds.length === 2, JSON.stringify(questioned.aiWorkProcessedIds));

    console.log("[5] 同じ結果fixtureを再取得しても実績Block/questionsを二重生成しない");
    await reloadAfterAiWorkFetch();
    await page.waitForSelector(".today-tower");
    const reloaded = await readState();
    check("再読込後も実績Blockは1件", reloaded.blocks.filter((block) => block.title === "顧客資料の下調べ" && !block.deleted).length === 1, JSON.stringify(reloaded.blocks));
    check("再読込後もAI質問は1件", reloaded.questions.filter((question) => question.text.includes("テンプレの過去バージョン")).length === 1, JSON.stringify(reloaded.questions));
    check("再読込後も処理済みIDは2件", reloaded.aiWorkProcessedIds.length === 2, JSON.stringify(reloaded.aiWorkProcessedIds));
    check("再読込後もcompleted resultIdは1回", reloaded.aiWorkProcessedIds.filter((id) => id === completedResultId).length === 1, JSON.stringify(reloaded.aiWorkProcessedIds));
    check("再読込後もblocked resultIdは1回", reloaded.aiWorkProcessedIds.filter((id) => id === blockedResultId).length === 1, JSON.stringify(reloaded.aiWorkProcessedIds));
    check("再読込後もAI作業結果操作DOMは0件",
      await page.locator('[data-action="ai-work-approve"], [data-action="ai-work-question"]').count() === 0);

    const beforeUnknown = JSON.stringify({ blocks: reloaded.blocks, questions: reloaded.questions, ids: reloaded.aiWorkProcessedIds });
    await dispatchRegisteredAction(page, "ai-work-approve", { resultId: `${TODAY}__missing` });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const afterUnknownState = await readState();
    const afterUnknown = JSON.stringify({ blocks: afterUnknownState.blocks, questions: afterUnknownState.questions, ids: afterUnknownState.aiWorkProcessedIds });
    check("未知resultIdの承認actionはstateを変更しない", afterUnknown === beforeUnknown);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
