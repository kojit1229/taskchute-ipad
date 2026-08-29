// v62 検証: AIレポート週次レビュー + 下書きUndo/Redo・却下理由メモ
//           + ホーム信条の実データ化。
//
// (a)-(c) v299で削除したAIプランJSON→朝プラン経路は、対象コードの不在契約へ更新する
// (d) 週次レビュー_*.md(直近土曜)をアプリ内表示し、「来週のタスク提案」の行ごとに
//     「+登録」でWBSタスクを1件ずつ登録できる(一括登録はしない)。無ければセクション非表示
// (e) 下書きレイヤ操作(×削除)の直前状態へ1段Undo、却下理由のワンタップ選択が
//     aiScheduleHistoryのreasonに反映される
// (f) ホーム信条(homeCreed)がKの実データ裏付け型の文言に更新されている
//
// 方針: app.js は type="module" で内部関数を window に露出しないため、既存スイート(v49〜v61)と
// 同じくブラウザ操作 + localStorage 状態の直接注入で観測する。AIプラン/週次レビューのfetchは
// v67以降の流儀(page.route)でモックする。以前は実ファイルをリポジトリ直下に一時的に書いて
// finally で削除していたが、本番バッチ(plan-daily.sh等)が同名の実ファイルを日次でcommitする
// ため、実行日によってはテスト終了後に実ファイルが一時的に消える環境依存の副作用があった
// (v67 CHANGES参照)。v70でこれを恒久修正し、実ファイルには一切触れない。
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
  // v61と同じ理由(computeFreeGapsが「現在時刻〜23:00」に依存)で日中に固定する。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YEST = isoDate(new Date(now0.getTime() - 24 * 60 * 60 * 1000));

  // app.js の weekRange() と同じロジック(週開始=直近土曜)をNode側でも再現する
  function weekStartOf(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 1) % 7; // Sat=0 ... Fri=6
    date.setDate(date.getDate() - dow);
    return isoDate(date);
  }
  const WEEK = weekStartOf(TODAY);

  // v70: 実ファイルを書く代わりに、週次レビュー応答をfixtureで差し替える(null=404)。
  let weeklyReviewFixture = null;

  function planBlock({ id, date, title, startMin, endMin, taskId = "", category = "", migratedTo = "" }) {
    const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo, orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
      deleted: false
    };
  }
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

  async function seed({ blocks = [], tasks = [], projects = [], view = "today", settings = {} } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.aiScheduleHistory = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      s.settings = { ...s.settings, ...settings };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function runScheduleFromTimeline() {
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForSelector('#app[data-view="timeline"]');
    const scheduleButton = page.locator('#app[data-view="timeline"] [data-action="ai-schedule"]');
    if (await scheduleButton.count()) await scheduleButton.click();
    else await dispatchRegisteredAction(page, "ai-schedule");
  }

  async function draftTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }
  async function draftBarText() {
    return page.locator(".draft-bar").first().textContent().catch(() => "");
  }

  try {
    // v70: 週次レビュー_<WEEK>.md のfetchを常にモックする(実ファイル不使用)。
    //      weeklyReviewFixtureがnullなら404、文字列ならその内容で200を返す。
    // v72: 個人データはGitHub Contents API(personal-data リポジトリの taskchute/ 配下)経由に
    //      なったため、判定を同一オリジンの絶対パスから api.github.com のcontents URL末尾一致に更新。
    await page.route((url) =>
      url.hostname === "api.github.com" && decodeURIComponent(url.pathname).endsWith("/taskchute/report-index.json"),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: `${TODAY}T01:00:00Z`,
        files: [{ name: `週次レビュー_${WEEK}.md`, date: WEEK, kind: "weekly" }]
      })
    }));
    await page.route((url) =>
      url.hostname === "api.github.com" && decodeURIComponent(url.pathname).endsWith(`/taskchute/週次レビュー_${WEEK}.md`),
    (route) => {
      if (weeklyReviewFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      route.fulfill({ status: 200, contentType: "text/markdown", body: weeklyReviewFixture });
    });

    await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
    // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
    await passGithubGate(page);

    // ============================================================
    // (m4レビュー対応) normalizeState 後方互換: 旧aiScheduleHistoryエントリにsource/reasonが無くても
    // クラッシュせず、デフォルト(source:"unknown", reason:"")が補完される
    // ============================================================
    console.log("[0] normalizeState 後方互換: 旧aiScheduleHistory(source/reason無し)にデフォルト補完");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.aiScheduleHistory = [
        { date: TODAY, title: "旧データ(v61以前)", category: "", aiStart: "10:00", aiMin: 30, outcome: "confirmed", userStart: "10:00", userMin: 30, at: `${TODAY}T10:00:00` }
        // source/reason フィールドが無い(v62より前の形状)
      ];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await page.waitForTimeout(200);
    const normalized0 = await stateNow();
    const legacyEntry = (normalized0.aiScheduleHistory || []).find((h) => h.title === "旧データ(v61以前)");
    check("旧エントリにsource:'unknown'が補完される", !!legacyEntry && legacyEntry.source === "unknown", JSON.stringify(legacyEntry));
    check("旧エントリにreason:''が補完される", !!legacyEntry && legacyEntry.reason === "", JSON.stringify(legacyEntry));
    check("旧エントリの既存値(outcome等)は上書きされない", !!legacyEntry && legacyEntry.outcome === "confirmed" && legacyEntry.userMin === 30, JSON.stringify(legacyEntry));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);

    // ============================================================
    // (a)-(c) v299: AIプランJSON適用経路を削除。旧挙動テストを実体不在へ追随する。
    // Test-Reduction: 下書きUndo/理由/確定は[6]以降、AIレポートは[8]以降で独立検証する。
    // ============================================================
    console.log("[1-5] v299: AIプランJSONの適用・検証・朝プラン経路を削除");
    check("tryFetchAiPlan本体が存在しない", !/\basync\s+function\s+tryFetchAiPlan\b/.test(appSource));
    check("runAiMorningPlan本体が存在しない", !/\basync\s+function\s+runAiMorningPlan\b/.test(appSource));
    check("ai-morning-plan actionが存在しない", !appSource.includes('"ai-morning-plan"'));
    check("aiScheduleCandidates本体が存在しない", !/\bfunction\s+aiScheduleCandidates\b/.test(appSource));
    check("ai-schedule actionは維持", appSource.includes('"ai-schedule": () => runAiSchedule()'));

    // ============================================================
    // (e) 下書きUndo・却下理由ワンタップ選択
    // ============================================================
    console.log("[6] 下書きUndo: ×で削除 → 「元に戻す」で直前状態へ復元");
    // v199: ai-scheduleの候補源が「WBS未Block化タスク」から「当日登録済みの未着手Block」へ
    //   変更されたため、各taskに対応する当日Block(30分)を合わせて登録する。
    await seed({
      tasks: [wbsTask("task-u1", "Undo検証タスクA", { estimateMin: 30 }), wbsTask("task-u2", "Undo検証タスクB", { estimateMin: 30 })],
      blocks: [
        planBlock({ id: "blk-u1", date: TODAY, title: "Undo検証タスクA", taskId: "task-u1", startMin: 9 * 60, endMin: 9 * 60 + 30 }),
        planBlock({ id: "blk-u2", date: TODAY, title: "Undo検証タスクB", taskId: "task-u2", startMin: 9 * 60, endMin: 9 * 60 + 30 })
      ],
      projects: [testProject()]
    });
    await page.click('[data-action="nav"][data-view="today"]');
    await page.waitForTimeout(150);
    await runScheduleFromTimeline();
    await page.waitForTimeout(500);
    const beforeRemove = await draftTitles();
    check("2件が下書きに配置される", beforeRemove.length === 2, JSON.stringify(beforeRemove));
    check("Undoボタンはまだ出ない(操作前)", await page.locator('[data-action="draft-undo"]').count() === 0);
    await page.locator('.draft-block:has-text("Undo検証タスクA") .draft-remove').click();
    await page.waitForTimeout(300);
    const afterRemove = await draftTitles();
    check("×で1件削除される", afterRemove.length === 1 && !afterRemove.some((t) => t.includes("Undo検証タスクA")), JSON.stringify(afterRemove));
    check("却下理由ピッカーが表示される", await page.locator(".draft-reject-picker").count() === 1);
    check("Undoボタンが出る(削除操作あり)", await page.locator('[data-action="draft-undo"]').count() === 1);
    await page.click('[data-action="draft-undo"]');
    await page.waitForTimeout(300);
    const afterUndo = await draftTitles();
    check("Undoで2件とも復元される", afterUndo.length === 2 && afterUndo.some((t) => t.includes("Undo検証タスクA")), JSON.stringify(afterUndo));
    check("Undo後はUndoボタンが消える(1段のみ)", await page.locator('[data-action="draft-undo"]').count() === 0);
    const s6 = await stateNow();
    const removedAfterUndo = (s6.aiScheduleHistory || []).filter((h) => h.title === "Undo検証タスクA" && h.outcome === "removed");
    check("m2: Undoで直前のremovedエントリがaiScheduleHistoryから取り消される", removedAfterUndo.length === 0, JSON.stringify(removedAfterUndo));

    console.log("[6b] m2: 削除→Undo→確定 でaiScheduleHistoryにremoved/confirmedが二重計上されない");
    await seed({
      tasks: [wbsTask("task-dd1", "二重計上検証タスクA", { estimateMin: 30 }), wbsTask("task-dd2", "二重計上検証タスクB", { estimateMin: 30 })],
      blocks: [
        planBlock({ id: "blk-dd1", date: TODAY, title: "二重計上検証タスクA", taskId: "task-dd1", startMin: 9 * 60, endMin: 9 * 60 + 30 }),
        planBlock({ id: "blk-dd2", date: TODAY, title: "二重計上検証タスクB", taskId: "task-dd2", startMin: 9 * 60, endMin: 9 * 60 + 30 })
      ],
      projects: [testProject()]
    });
    await runScheduleFromTimeline();
    await page.waitForTimeout(500);
    await page.locator('.draft-block:has-text("二重計上検証タスクA") .draft-remove').click();
    await page.waitForTimeout(300);
    const sMidDd = await stateNow();
    const removedBeforeUndoDd = (sMidDd.aiScheduleHistory || []).filter((h) => h.title === "二重計上検証タスクA" && h.outcome === "removed");
    check("削除直後はremovedが1件記録される", removedBeforeUndoDd.length === 1, JSON.stringify(removedBeforeUndoDd));
    await page.click('[data-action="draft-undo"]');
    await page.waitForTimeout(300);
    check("Undo後は却下理由ピッカーが出ない(取り消されたentryを参照していたため畳まれる)",
      await page.locator(".draft-reject-picker").count() === 0);
    const sAfterUndoDd = await stateNow();
    const removedAfterUndoDd = (sAfterUndoDd.aiScheduleHistory || []).filter((h) => h.title === "二重計上検証タスクA" && h.outcome === "removed");
    check("Undoでremovedエントリが取り消される(0件)", removedAfterUndoDd.length === 0, JSON.stringify(removedAfterUndoDd));
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const sFinalDd = await stateNow();
    const confirmedFinalDd = (sFinalDd.aiScheduleHistory || []).filter((h) => h.title === "二重計上検証タスクA" && h.outcome === "confirmed");
    const removedFinalDd = (sFinalDd.aiScheduleHistory || []).filter((h) => h.title === "二重計上検証タスクA" && h.outcome === "removed");
    check("確定後はconfirmedのみ1件・removedは0件のまま(二重計上なし)",
      confirmedFinalDd.length === 1 && removedFinalDd.length === 0,
      JSON.stringify({ confirmedFinalDd, removedFinalDd }));

    console.log("[7] 却下理由: ワンタップ選択がaiScheduleHistoryのreasonに反映される");
    await seed({
      tasks: [wbsTask("task-reason1", "却下理由ワンタップ検証タスク", { estimateMin: 30 })],
      blocks: [planBlock({ id: "blk-reason1", date: TODAY, title: "却下理由ワンタップ検証タスク", taskId: "task-reason1", startMin: 9 * 60, endMin: 9 * 60 + 30 })],
      projects: [testProject()]
    });
    await runScheduleFromTimeline();
    await page.waitForTimeout(500);
    await page.locator('.draft-block:has-text("却下理由ワンタップ検証タスク") .draft-remove').click();
    await page.waitForTimeout(300);
    check("却下理由ピッカーが表示される", await page.locator(".draft-reject-picker").count() === 1);
    await page.click('.draft-reject-picker [data-action="draft-remove-reason"][data-reason="価値が薄い"]');
    await page.waitForTimeout(300);
    check("理由選択後はピッカーが閉じる", await page.locator(".draft-reject-picker").count() === 0);
    const s7 = await stateNow();
    const histReason = (s7.aiScheduleHistory || []).find((h) => h.title === "却下理由ワンタップ検証タスク" && h.outcome === "removed");
    check("aiScheduleHistoryのreasonに選択した理由が入る", !!histReason && histReason.reason === "価値が薄い", JSON.stringify(histReason));
    check("aiScheduleHistoryのsourceはdeterministic(ai-scheduleは決定論配置のみ)", !!histReason && histReason.source === "deterministic", JSON.stringify(histReason));

    console.log("[7b] 却下理由: 「閉じる」を選ぶと理由なし(空文字)のまま");
    await seed({
      tasks: [wbsTask("task-u3", "却下理由検証タスク", { estimateMin: 30 })],
      blocks: [planBlock({ id: "blk-u3", date: TODAY, title: "却下理由検証タスク", taskId: "task-u3", startMin: 9 * 60, endMin: 9 * 60 + 30 })],
      projects: [testProject()]
    });
    await runScheduleFromTimeline();
    await page.waitForTimeout(500);
    await page.locator('.draft-block:has-text("却下理由検証タスク") .draft-remove').click();
    await page.waitForTimeout(300);
    await page.click('[data-action="draft-remove-reason-dismiss"]');
    await page.waitForTimeout(200);
    check("「閉じる」でピッカーが閉じる", await page.locator(".draft-reject-picker").count() === 0);
    const s7b = await stateNow();
    const histNoReason = (s7b.aiScheduleHistory || []).find((h) => h.title === "却下理由検証タスク" && h.outcome === "removed");
    check("理由を選ばなければreasonは空文字のまま", !!histNoReason && histNoReason.reason === "", JSON.stringify(histNoReason));

    // ============================================================
    // (d) AIレポートの週次レビュー表示(無い場合は提案非表示 → ある場合は表示+登録)
    // ============================================================
    console.log("[8] AIレポート週次レビューの本文が無いときは提案セクションが出ない");
    weeklyReviewFixture = null;
    await seed({ view: "ai-reports", settings: { aiReportType: "weekly" } });
    await page.waitForTimeout(600);
    check("本文取得失敗時は提案セクションが出ない", await page.locator(".ai-weekly-suggest").count() === 0);

    console.log("[9] AIレポート週次レビューに提案が表示され、+登録で1件ずつWBSへ登録できる");
    weeklyReviewFixture = [
      `# 週次レビュー ${WEEK}`,
      "",
      "## 今週の事実",
      "- v62テスト用ダミー",
      "",
      "## 来週のタスク提案",
      "Kが内容を確認のうえ手動でアプリに登録する前提の提案です。",
      "",
      "- [ ] 週次提案タスクA(30分)",
      "- [ ] 週次提案タスクB(45分)",
      "",
      "## アプリ改善の種",
      "なし"
    ].join("\n");
    await seed({ view: "ai-reports", settings: { aiReportType: "weekly" } });
    await page.waitForTimeout(700);
    const weeklyMdText = await page.locator(".ai-weekly-suggest").textContent().catch(() => "");
    check("週次提案タスクA/Bの両方が一覧に出る", weeklyMdText.includes("週次提案タスクA") && weeklyMdText.includes("週次提案タスクB"), weeklyMdText);
    check("+登録ボタンが2件分ある(一括登録ボタンではない)", await page.locator('[data-action="weekly-suggest-add"]').count() === 2);

    await page.locator('[data-action="weekly-suggest-add"]').first().click();
    await page.waitForTimeout(400);
    const s9 = await stateNow();
    const registeredTask = (s9.tasks || []).find((t) => t.title === "週次提案タスクA");
    check("1件目の+登録でWBSタスクが作られる(タイトルから見積表記が除去される)", !!registeredTask && registeredTask.status === "todo", JSON.stringify(registeredTask));
    check("見積分数(30分)がestimateMinに反映される", !!registeredTask && registeredTask.estimateMin === 30, JSON.stringify(registeredTask));
    const notRegisteredYet = (s9.tasks || []).find((t) => t.title === "週次提案タスクB");
    check("2件目は自動登録されない(一括登録はしない)", !notRegisteredYet, JSON.stringify(notRegisteredYet));
    check("登録済みの行は+登録ボタンが消え、未登録行には残る",
      await page.locator('.ai-weekly-suggest-row:has-text("週次提案タスクA") button[data-action="weekly-suggest-add"]').count() === 0
      && await page.locator('.ai-weekly-suggest-row:has-text("週次提案タスクB") [data-action="weekly-suggest-add"]').count() === 1);

    // ============================================================
    // (f) ホーム信条の実データ化
    // ============================================================
    console.log("[10] v230: 旧home信条カードは描画されない");
    await seed({ view: "home" });
    check("旧home信条カードとサブタブは描画されない",
      await page.locator('.home-creed, [data-action="home-tab"]').count() === 0);
    check("旧home viewはtoday/TOWERへフォールバックする",
      await page.locator('#app[data-view="today"] .today-tower').count() === 1);
  } finally {
    // v70: page.routeでモックしているため、実ファイルの後始末は不要(何も書いていない)。
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
