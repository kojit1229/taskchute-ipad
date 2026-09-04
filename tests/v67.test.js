// v67由来の横断コア: AI作業Taskと旧AI連携stateのnormalizeState後方互換を固定する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort
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

  const readState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

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
    check("aiLinkFreshnessを持たない旧stateへ鮮度フィールドを補完しない", !("aiLinkFreshness" in normalized), JSON.stringify(normalized.aiLinkFreshness));
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
    await page.waitForSelector('[data-wbs-row-id="task-ai1"] [data-action="wbs-row-menu-toggle"]');
    check("保存前はWBS一覧に🤝マーク無し", await page.locator(".ai-work-flag").count() === 0);
    // v329: 行の副操作は…メニュー(排他)の中。先に開く(セレクタ追随・assert不変)
    await page.click('[data-wbs-row-id="task-ai1"] [data-action="wbs-row-menu-toggle"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="edit-task"][data-id="task-ai1"]');
    await page.check('[data-modal-field="aiWork"]');
    await page.fill('[data-modal-field="aiWorkBrief"]', "候補3社を比較してまとめてほしい");
    await page.click('[data-action="modal-save"]');
    // v329: 🤝マークは…メニュー(既定非表示)の中。表示検証はcountで行うためattachedで待つ
    await page.waitForSelector(".ai-work-flag", { state: "attached" });
    const saved = (await readState()).tasks.find((task) => task.id === "task-ai1");
    check("aiWorkをtrueで保存", saved?.aiWork === true, JSON.stringify(saved));
    check("aiWorkBriefを保存", saved?.aiWorkBrief === "候補3社を比較してまとめてほしい", JSON.stringify(saved));
    check("保存後はWBS一覧に🤝マークを表示", await page.locator(".ai-work-flag").count() === 1);

    check("AI作業結果の廃止済み承認/質問ボタンはDOMへ戻さない",
      await page.locator('[data-action="ai-work-approve"], [data-action="ai-work-question"]').count() === 0);
    check("再読込後もAI作業結果操作DOMは0件",
      await page.locator('[data-action="ai-work-approve"], [data-action="ai-work-question"]').count() === 0);

    // Test-Reduction: v285(R2)レビューH1是正でdispatchRegisteredAction経由の検証を復元した
    // approveAiWorkResult/raiseAiWorkQuestion/markAiWorkResultProcessed(旧[3][4][5]区間、
    // AI作業結果_<today>.json の承認/質問/二重登録防止フローを直接検証していた)は、
    // R3(本コミット)で関数本体そのものを削除(K裁定2026-08-27=ATIS6機能の完全廃止の最終段階)。
    // H1の趣旨は「まだ存在する機能の検証を落とすな」であり、機能自体を削除する本コミットには
    // 適用されない。DOM不在の否定アサーション([1]の74-75行相当、count()===0)は無改修で残り、
    // 廃止の事実は引き続き検証される。fixture route/reloadAfterAiWorkFetchヘルパも本区間専用の
    // ため、削除対象と合わせて撤去した。[1]normalizeState移行検証・[2]Task編集モーダルの
    // aiWork/aiWorkBrief保存検証は本削除と無関係のため無改修。
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
