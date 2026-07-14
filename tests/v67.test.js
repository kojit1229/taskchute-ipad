// v67 検証: AI連携の鮮度インジケータ(designs/v67-plus-claude-vision.md 柱1b) +
//           aiWorkフラグ + AI作業結果の取り込み表示(柱2アプリ側)。
//
// (a) normalizeState 後方互換: 旧Task(aiWork/aiWorkBrief無し)に false/"" が補完される。
//     旧state(aiLinkFreshness/aiWorkProcessedIdsフィールド自体が無い)にも既定値が補完される
// (b) Task編集モーダルで aiWork トグル + aiWorkBrief を保存でき、WBS一覧に🤝マークが出る
// (c) AI連携鮮度: state.aiLinkFreshness.feedbackAt/planAt から経過日数を1行表示し、
//     どちらかが3日以上(または未取得)なら控えめな注意バナーが出る。2日以内なら出ない
// (d) AI作業結果_<今日>.json の3ステータス(completed/blocked/queued)がホームカードに
//     それぞれ正しいUI(承認ボタン/質問ボタン/表示のみ)で並ぶ
// (e) completed の「実績として登録」ワンタップで実績Block(カテゴリ"AI作業"・completed:true・
//     指定minutes)が作成され、紐づくTaskも完了化される
// (f) blocked の「質問として積む」で state.questions に origin:"ai" の問いが追加される
// (g) 二重登録防止: 承認/質問済みの resultId は state.aiWorkProcessedIds に記録され、
//     リロード後(同じ結果ファイルを再fetchしても)再表示されない
//
// 方針: 既存スイート(v62/v65)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。AI作業結果_*.json のfetchは
// v70でpage.route(実ファイル不使用)によるモックへ書き換えた(v62.test.js参照。本番バッチが
// 同名の実ファイルを日次でcommitするため、実行日依存を避ける)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  // v67レビュー対応: このリポジトリには本番バッチ(plan-daily.sh等)が実際に
  // AIプラン_<今日>.json / AIフィードバック_<日付>.md / 週次レビュー_<週>.md を日次でcommitする。
  // これらが実在すると、起動時fetch(hydrateStaticMarkdown)が本当に成功してしまい、
  // 「未取得(null)」を前提にしたシナリオ(鮮度のnormalizeState補完テスト等)が実行日に
  // よってREDになる環境依存バグを生む。v67.test.jsはこの3種のfetchを常に404にルーティングし、
  // リポジトリに実ファイルが有っても無くても結果が変わらないようにする。
  // (AI作業結果_<今日>.json はこのスイート専用の可変fixture経由でモックする。下記参照)
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  // v70(v62と同じ手法): 実ファイルを書く代わりに、この変数をfetchのモック応答として使う
  // (null=404)。書き換えるだけで良く、テスト終了時の実ファイル後始末も不要。
  let aiWorkResultFixture = null;
  await page.route((url) => /\/AI作業結果_.*\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    if (aiWorkResultFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
    route.fulfill({ status: 200, contentType: "application/json", body: aiWorkResultFixture });
  });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // v61〜v66と同じ理由(computeFreeGaps/朝プラン等が実時刻に依存)で日中に固定する。
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const D3AGO = addDaysStr(TODAY, -3);
  const D1AGO = addDaysStr(TODAY, -1);

  function wbsTask(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, ...extra
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  async function seed({ blocks = [], tasks = [], projects = [], view = "home", aiLinkFreshness, aiWorkProcessedIds = [] } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, aiLinkFreshness, aiWorkProcessedIds }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.questions = [];
      s.aiWorkProcessedIds = aiWorkProcessedIds;
      s.aiLinkFreshness = aiLinkFreshness || { feedbackAt: null, planAt: null };
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, aiLinkFreshness, aiWorkProcessedIds });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
    // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
    await passGithubGate(page);

    // ============================================================
    // (a) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Task(aiWork無し)→false/\"\"補完、旧state(aiLinkFreshness/aiWorkProcessedIds無し)→既定値補完");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // aiWork/aiWorkBrief フィールドなし(旧データを模擬)
      }];
      s.blocks = [];
      s.projects = [];
      delete s.aiLinkFreshness;      // フィールド自体が無い旧state
      delete s.aiWorkProcessedIds;   // 同上
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="home"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const normalized1 = await stateNow();
    const legacyTask = (normalized1.tasks || []).find((t) => t.id === "legacy-task");
    check("旧TaskにaiWork:falseが補完される", !!legacyTask && legacyTask.aiWork === false, JSON.stringify(legacyTask));
    check("旧Taskにaiwork Brief:\"\"が補完される", !!legacyTask && legacyTask.aiWorkBrief === "", JSON.stringify(legacyTask));
    check("旧stateにaiLinkFreshnessが補完される", normalized1.aiLinkFreshness
      && normalized1.aiLinkFreshness.feedbackAt === null && normalized1.aiLinkFreshness.planAt === null,
      JSON.stringify(normalized1.aiLinkFreshness));
    check("旧stateにaiWorkProcessedIdsが配列として補完される", Array.isArray(normalized1.aiWorkProcessedIds) && normalized1.aiWorkProcessedIds.length === 0);

    // ============================================================
    // (b) Task編集モーダルで aiWork トグル + brief を保存でき、WBS一覧に🤝マークが出る
    // ============================================================
    console.log("[2] Task編集モーダルで aiWork をON+brief入力→保存→WBS一覧に🤝マーク");
    await seed({
      tasks: [wbsTask("task-ai1", "AIに任せたいTask")],
      projects: [testProject()],
      view: "wbs"
    });
    check("保存前はWBS一覧に🤝マークが無い", await page.locator('.ai-work-flag').count() === 0);
    await page.click('[data-action="edit-task"][data-id="task-ai1"]');
    await page.waitForTimeout(200);
    check("Task編集モーダルにaiWorkチェックボックスがある", await page.locator('[data-modal-field="aiWork"]').count() === 1);
    check("Task編集モーダルにaiWorkBriefテキストエリアがある", await page.locator('[data-modal-field="aiWorkBrief"]').count() === 1);
    await page.check('[data-modal-field="aiWork"]');
    await page.fill('[data-modal-field="aiWorkBrief"]', "候補3社を比較してまとめてほしい");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const savedTask = (s2.tasks || []).find((t) => t.id === "task-ai1");
    check("aiWorkがtrueで保存される", !!savedTask && savedTask.aiWork === true, JSON.stringify(savedTask));
    check("aiWorkBriefが保存される", savedTask?.aiWorkBrief === "候補3社を比較してまとめてほしい", JSON.stringify(savedTask));
    check("保存後はWBS一覧に🤝マークが出る", await page.locator('.ai-work-flag').count() === 1);

    // ============================================================
    // (c) AI連携鮮度: 経過日数の表示 + 3日閾値の注意バナー
    // ============================================================
    console.log("[3] AI連携鮮度: 両方とも新しければ注意バナー無し、テキストに経過日数が出る");
    await seed({ view: "home", aiLinkFreshness: { feedbackAt: TODAY, planAt: TODAY } });
    check("鮮度ラインが表示される", await page.locator(".ai-freshness-line").count() === 1);
    const freshText = await page.locator(".ai-freshness-line").textContent();
    check("フィードバック「今日届いた」が出る", freshText.includes("フィードバック 今日届いた"), freshText);
    check("プラン「今日届いた」が出る", freshText.includes("プラン 今日届いた"), freshText);
    check("ドットはok(注意なし)", await page.locator(".ai-freshness-dot.ok").count() === 1);
    check("注意バナーは出ない", await page.locator(".ai-freshness-banner").count() === 0);

    console.log("[4] AI連携鮮度: フィードバックが3日途絶えると注意バナーが出る(責めない文言)");
    await seed({ view: "home", aiLinkFreshness: { feedbackAt: D3AGO, planAt: TODAY } });
    const freshText2 = await page.locator(".ai-freshness-line").textContent();
    check("フィードバック「3日前」が出る", freshText2.includes("フィードバック 3日前"), freshText2);
    check("ドットはwarn(注意あり)", await page.locator(".ai-freshness-dot.warn").count() === 1);
    check("注意バナーが出る", await page.locator(".ai-freshness-banner").count() === 1);
    const bannerText = await page.locator(".ai-freshness-banner").textContent();
    check("バナー文言は「止まっているかも」で責めない", bannerText.includes("AI連携が止まっているかも"), bannerText);

    console.log("[5] AI連携鮮度: 2日前は閾値未満なので注意バナーは出ない");
    await seed({ view: "home", aiLinkFreshness: { feedbackAt: D1AGO, planAt: D1AGO } });
    check("1日前は注意バナー無し", await page.locator(".ai-freshness-banner").count() === 0);

    console.log("[6] AI連携鮮度: 一度も届いていない(null)場合も「まだ届いていません」+ 注意バナー");
    await seed({ view: "home", aiLinkFreshness: { feedbackAt: null, planAt: null } });
    const freshText3 = await page.locator(".ai-freshness-line").textContent();
    check("未取得は「まだ届いていません」表示", freshText3.includes("まだ届いていません"), freshText3);
    check("未取得も注意バナーが出る", await page.locator(".ai-freshness-banner").count() === 1);

    // ============================================================
    // (d)〜(g) AI作業結果の取り込み(completed/blocked/queued)
    // ============================================================
    console.log("[7] AI作業結果_<今日>.json の3ステータスがホームカードに正しく表示される");
    aiWorkResultFixture = JSON.stringify([
      { taskId: "ai-task-1", title: "顧客資料の下調べ", status: "completed", summary: "候補3社をリスト化し比較表を作成した", outputPath: "workbench/out/2026-07-09-research/summary.md", minutes: 45 },
      { taskId: "ai-task-2", title: "請求書テンプレ更新", status: "blocked", summary: "テンプレの過去バージョンが2つあり、どちらを正とするか確認が必要", outputPath: "", minutes: 0 },
      { taskId: "", title: "本番環境への反映", status: "queued", summary: "", outputPath: "", minutes: 0 }
    ]);
    await seed({
      tasks: [
        wbsTask("ai-task-1", "顧客資料の下調べ", { aiWork: true, aiWorkBrief: "候補3社を比較してまとめてほしい" }),
        wbsTask("ai-task-2", "請求書テンプレ更新", { aiWork: true })
      ],
      projects: [testProject()],
      view: "home"
    });
    await page.waitForTimeout(400);  // hydrateStaticMarkdown() の非同期fetch完了を待つ
    const resultIdCompleted = `${TODAY}__ai-task-1`;
    const resultIdBlocked = `${TODAY}__ai-task-2`;
    const resultIdQueued = `${TODAY}__idx2`;
    // v71: 「AIが処理した作業」は独立カードから「AIから」集約カード内のサブ見出し(.home-ai-sub)に変更された
    check("「AIが処理した作業」カードが表示される", await page.locator('.home-ai-sub:has-text("AIが処理した作業")').count() === 1);
    check("3件のai-work-rowが表示される", await page.locator(".ai-work-row").count() === 3);
    check("completed行に「実績として登録」ボタンがある",
      await page.locator(`[data-action="ai-work-approve"][data-result-id="${resultIdCompleted}"]`).count() === 1);
    check("blocked行に質問文が表示される",
      (await page.locator(".ai-work-row:has-text(\"請求書テンプレ更新\")").textContent())
        .includes("テンプレの過去バージョンが2つあり"));
    check("blocked行に「質問として積む」ボタンがある",
      await page.locator(`[data-action="ai-work-question"][data-result-id="${resultIdBlocked}"]`).count() === 1);
    check("queued行に「承認待ち」表示のみでボタンは無い",
      (await page.locator(".ai-work-row:has-text(\"本番環境への反映\")").textContent()).includes("承認待ち(PC側のqueueにあります)"));
    check("queued行には承認/質問ボタンが無い",
      await page.locator(`.ai-work-row:has-text("本番環境への反映") button`).count() === 0);

    console.log("[8] completed: 「実績として登録」ワンタップで実績Blockが作成され、Taskも完了化される");
    await page.click(`[data-action="ai-work-approve"][data-result-id="${resultIdCompleted}"]`);
    await page.waitForTimeout(300);
    const s8 = await stateNow();
    const registeredBlock = (s8.blocks || []).find((b) => b.title === "顧客資料の下調べ" && !b.deleted);
    check("実績Blockが作成される", !!registeredBlock, JSON.stringify(registeredBlock));
    check("実績Blockのカテゴリは「AI作業」", registeredBlock?.category === "AI作業", JSON.stringify(registeredBlock));
    check("実績Blockはcompleted:true", registeredBlock?.completed === true);
    check("実績Blockの所要時間は45分(estimateMin)", registeredBlock?.estimateMin === 45, JSON.stringify(registeredBlock));
    check("実績Blockに実績開始/終了時刻が入っている", !!registeredBlock?.actualStartAt && !!registeredBlock?.actualEndAt, JSON.stringify(registeredBlock));
    check("紐づくTaskが完了化される", (s8.tasks || []).find((t) => t.id === "ai-task-1")?.status === "completed");
    check("resultIdがaiWorkProcessedIdsに記録される(二重登録防止)", (s8.aiWorkProcessedIds || []).includes(resultIdCompleted), JSON.stringify(s8.aiWorkProcessedIds));
    check("承認後、completed行はカードから消える", await page.locator(`[data-action="ai-work-approve"][data-result-id="${resultIdCompleted}"]`).count() === 0);
    check("カードの行数が2件に減る", await page.locator(".ai-work-row").count() === 2);

    console.log("[9] blocked: 「質問として積む」で state.questions に origin:ai の問いが追加される");
    await page.click(`[data-action="ai-work-question"][data-result-id="${resultIdBlocked}"]`);
    await page.waitForTimeout(300);
    const s9 = await stateNow();
    const raisedQuestion = (s9.questions || []).find((q) => q.text === "テンプレの過去バージョンが2つあり、どちらを正とするか確認が必要");
    check("questionsにAIからの質問が追加される", !!raisedQuestion, JSON.stringify(s9.questions));
    check("追加された質問のoriginはai", raisedQuestion?.origin === "ai", JSON.stringify(raisedQuestion));
    check("resultId(blocked)もaiWorkProcessedIdsに記録される", (s9.aiWorkProcessedIds || []).includes(resultIdBlocked), JSON.stringify(s9.aiWorkProcessedIds));
    check("質問化後、blocked行はカードから消える", await page.locator(`[data-action="ai-work-question"][data-result-id="${resultIdBlocked}"]`).count() === 0);
    check("カードの行数が1件(queuedのみ)に減る", await page.locator(".ai-work-row").count() === 1);

    console.log("[10] 二重登録防止: リロード後(同じ結果ファイルを再fetch)も承認/質問済みの2件は再表示されない");
    await page.reload();
    await page.waitForTimeout(600);
    check("リロード後もqueued行のみ表示される(3件中2件は処理済みで非表示)", await page.locator(".ai-work-row").count() === 1);
    check("リロード後もqueued行の内容は「本番環境への反映」", (await page.locator(".ai-work-row").textContent()).includes("本番環境への反映"));
    const s10 = await stateNow();
    check("リロード後、実績Blockは残ったまま(二重作成されていない)",
      (s10.blocks || []).filter((b) => b.title === "顧客資料の下調べ" && !b.deleted).length === 1, JSON.stringify(s10.blocks));
    check("リロード後、questionsも二重追加されていない",
      (s10.questions || []).filter((q) => q.text.includes("テンプレの過去バージョン")).length === 1, JSON.stringify(s10.questions));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
