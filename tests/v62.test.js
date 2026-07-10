// v62 検証: バッチ生成物のアプリ側着地(AIプラン・週次レビュー) + 下書きUndo/Redo・却下理由メモ
//           + ホーム信条の実データ化。
//
// (a) 朝プラン(runAiMorningPlan)が当日の AIプラン_YYYY-MM-DD.json を同一オリジンfetchし、
//     正常なら下書き採用(source="ai-plan"、reasonをツールチップ/バーで表示、skippedも表示)
// (b) 取得失敗(不正JSON)・日付不一致(古い)・空き時間との不整合(状態ズレ)・
//     carryFromIdの二重繰越参照 の各ケースで決定論配置(source="deterministic")へフォールバックする
// (c) 確定時の aiScheduleHistory に source(ai-plan/deterministic)が記録される
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
const { chromium, launchOptions, startServer } = require("./helpers");

const PORT = 4202;
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

  // v70: 実ファイルを書く代わりに、この2変数をfetchのモック応答として使う(null=404)。
  //      page.route登録後は、シナリオごとにこの変数を書き換えるだけで良い(実ファイル操作なし)。
  let aiPlanFixture = null;
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

  async function seed({ blocks = [], tasks = [], projects = [], view = "tasks" } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.aiScheduleHistory = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function runMorningPlan() {
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(700);
  }

  async function draftTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }
  async function draftBarText() {
    return page.locator(".draft-bar").first().textContent().catch(() => "");
  }

  try {
    // v70: AIプラン_<TODAY>.json / 週次レビュー_<WEEK>.md のfetchを常にモックする(実ファイル不使用)。
    //      aiPlanFixture/weeklyReviewFixtureがnullなら404、文字列ならその内容で200を返す。
    await page.route((url) => decodeURIComponent(url.pathname) === `/AIプラン_${TODAY}.json`, (route) => {
      if (aiPlanFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      route.fulfill({ status: 200, contentType: "application/json", body: aiPlanFixture });
    });
    await page.route((url) => decodeURIComponent(url.pathname) === `/週次レビュー_${WEEK}.md`, (route) => {
      if (weeklyReviewFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      route.fulfill({ status: 200, contentType: "text/markdown", body: weeklyReviewFixture });
    });

    await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);

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
    await page.click('[data-action="nav"][data-view="home"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const normalized0 = await stateNow();
    const legacyEntry = (normalized0.aiScheduleHistory || []).find((h) => h.title === "旧データ(v61以前)");
    check("旧エントリにsource:'unknown'が補完される", !!legacyEntry && legacyEntry.source === "unknown", JSON.stringify(legacyEntry));
    check("旧エントリにreason:''が補完される", !!legacyEntry && legacyEntry.reason === "", JSON.stringify(legacyEntry));
    check("旧エントリの既存値(outcome等)は上書きされない", !!legacyEntry && legacyEntry.outcome === "confirmed" && legacyEntry.userMin === 30, JSON.stringify(legacyEntry));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);

    // ============================================================
    // (a) AIプラン正常fetch → 下書きにAI由来として反映
    // ============================================================
    console.log("[1] AIプランJSON正常fetch → 下書き採用(source=ai-plan・reason表示・skipped表示)");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [
        { title: "AIプラン採用タスク", taskId: null, blockId: null, start: "10:30", minutes: 30, category: "開発", reason: "午前中に集中できるため", carryFromId: null }
      ],
      skipped: [
        { title: "AIプラン見送りタスク", reason: "時間帯が合わない" }
      ]
    }, null, 2);
    await seed({ tasks: [], projects: [] });
    await runMorningPlan();
    const titles1 = await draftTitles();
    check("AIプランの項目が下書きとして採用される", titles1.some((t) => t.includes("AIプラン採用タスク")), JSON.stringify(titles1));
    const bar1 = await draftBarText();
    check("下書きバーにAI由来のラベルが出る(🤖 AIプラン由来)", (bar1 || "").includes("🤖 AIプラン由来"), bar1);
    const mainText1 = await page.locator("main").textContent();
    check("skippedが「見送り」として表示される", mainText1.includes("見送り") && mainText1.includes("AIプラン見送りタスク"), mainText1.slice(0, 400));
    const reasonAttr = await page.locator('.draft-block:has-text("AIプラン採用タスク")').getAttribute("title").catch(() => "");
    check("reasonがツールチップ(title属性)で見える", (reasonAttr || "").includes("午前中に集中できるため"), reasonAttr);
    const reasonText = await page.locator(".draft-block-reason").first().textContent().catch(() => "");
    check("reasonが下書きBlock内にも小さく表示される", (reasonText || "").includes("午前中に集中できるため"), reasonText);

    console.log("[1b] 確定時、aiScheduleHistoryにsource='ai-plan'で記録される");
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const s1 = await stateNow();
    const confirmedAi = (s1.aiScheduleHistory || []).find((h) => h.title === "AIプラン採用タスク" && h.outcome === "confirmed");
    check("aiScheduleHistoryにconfirmed(source=ai-plan)が記録される", !!confirmedAi && confirmedAi.source === "ai-plan", JSON.stringify(confirmedAi));
    const newBlock1 = (s1.blocks || []).find((b) => b.title === "AIプラン採用タスク" && b.date === TODAY);
    check("AIプラン由来のBlockが10:30〜11:00で登録される", !!newBlock1 && newBlock1.plannedStartAt.endsWith("T10:30") && newBlock1.plannedEndAt.endsWith("T11:00"), JSON.stringify(newBlock1));

    // ============================================================
    // (b) 不正JSON → 決定論配置へフォールバック
    // ============================================================
    console.log("[2] 不正JSON(パース不能) → 決定論配置へフォールバック");
    aiPlanFixture = "{ これはJSONとして壊れている ,,, ";
    await seed({ tasks: [wbsTask("task-fb1", "決定論フォールバックA")], projects: [testProject()] });
    await runMorningPlan();
    const titles2 = await draftTitles();
    check("不正JSON時は決定論配置の候補が使われる", titles2.some((t) => t.includes("決定論フォールバックA")), JSON.stringify(titles2));
    const bar2 = await draftBarText();
    check("下書きバーが決定論配置のラベルになる(⚙ 決定論配置)", (bar2 || "").includes("⚙ 決定論配置"), bar2);
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const s2 = await stateNow();
    const confirmedDet = (s2.aiScheduleHistory || []).find((h) => h.title === "決定論フォールバックA" && h.outcome === "confirmed");
    check("aiScheduleHistoryにconfirmed(source=deterministic)が記録される", !!confirmedDet && confirmedDet.source === "deterministic", JSON.stringify(confirmedDet));

    // ============================================================
    // (b) 日付不一致(古いプラン) → フォールバック
    // ============================================================
    console.log("[3] AIプランのdateが当日と不一致(古いプラン) → フォールバック");
    aiPlanFixture = JSON.stringify({
      date: YEST,  // 当日ではない
      generatedAt: `${YEST}T05:00`,
      plan: [{ title: "古いプランのタスク", taskId: null, blockId: null, start: "10:30", minutes: 30, category: "", reason: "古い", carryFromId: null }],
      skipped: []
    });
    await seed({ tasks: [wbsTask("task-fb2", "決定論フォールバックB")], projects: [testProject()] });
    await runMorningPlan();
    const titles3 = await draftTitles();
    check("古い日付のプランは採用されない", !titles3.some((t) => t.includes("古いプランのタスク")), JSON.stringify(titles3));
    check("決定論配置にフォールバックする", titles3.some((t) => t.includes("決定論フォールバックB")), JSON.stringify(titles3));

    // ============================================================
    // (b) 空き時間との不整合(既存Blockと衝突=状態が生成時から動いた) → フォールバック
    // ============================================================
    console.log("[4] AIプランの配置先が既存Blockと衝突(状態がズレている) → フォールバック");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [{ title: "衝突するプランのタスク", taskId: null, blockId: null, start: "10:30", minutes: 30, category: "", reason: "衝突", carryFromId: null }],
      skipped: []
    });
    await seed({
      blocks: [planBlock({ id: "occ-1", date: TODAY, title: "既存の予定", startMin: 10 * 60 + 30, endMin: 11 * 60 })],
      tasks: [wbsTask("task-fb3", "決定論フォールバックC")],
      projects: [testProject()]
    });
    await runMorningPlan();
    const titles4 = await draftTitles();
    check("既存Blockと衝突するプランは採用されない", !titles4.some((t) => t.includes("衝突するプランのタスク")), JSON.stringify(titles4));
    check("決定論配置にフォールバックする", titles4.some((t) => t.includes("決定論フォールバックC")), JSON.stringify(titles4));

    // ============================================================
    // (b) carryFromIdが既に繰り越し済み(二重繰越防止) → 該当項目は不採用 → 他に無ければフォールバック
    // ============================================================
    console.log("[5] carryFromIdが既に繰り越し済みBlockを参照 → 不採用 → フォールバック(二重繰越防止の維持)");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [{ title: "二重繰越になるはずのタスク", taskId: null, blockId: null, start: "10:30", minutes: 30, category: "", reason: "繰越", carryFromId: "already-migrated" }],
      skipped: []
    });
    await seed({
      blocks: [planBlock({ id: "already-migrated", date: YEST, title: "既に繰り越し済みの元Block", startMin: 10 * 60, endMin: 10 * 60 + 30, migratedTo: "some-existing-block" })],
      tasks: [wbsTask("task-fb4", "決定論フォールバックD")],
      projects: [testProject()]
    });
    await runMorningPlan();
    const titles5 = await draftTitles();
    check("既に繰り越し済みの項目は採用されない(二重繰越防止)", !titles5.some((t) => t.includes("二重繰越になるはずのタスク")), JSON.stringify(titles5));
    check("決定論配置にフォールバックする", titles5.some((t) => t.includes("決定論フォールバックD")), JSON.stringify(titles5));

    // ============================================================
    // (M1レビュー対応) 一部項目のみ空き時間と不整合(過去時刻) → その項目だけ個別ドロップされ、
    // 残りの項目は採用される(プラン全体を不採用にしない)
    // ============================================================
    console.log("[5b] AIプランの一部項目のみ過去時刻 → その項目だけ「時間切れで除外」、残りは採用される");
    aiPlanFixture = JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [
        { title: "過去時刻タスク(除外される)", taskId: null, blockId: null, start: "05:30", minutes: 30, category: "", reason: "朝イチ想定だった", carryFromId: null },
        { title: "採用されるタスク", taskId: null, blockId: null, start: "11:00", minutes: 30, category: "", reason: "午前中OK", carryFromId: null }
      ],
      skipped: []
    });
    await seed({ tasks: [], projects: [] });
    await runMorningPlan();
    const titles5b = await draftTitles();
    check("過去時刻の項目は下書きに採用されない", !titles5b.some((t) => t.includes("過去時刻タスク")), JSON.stringify(titles5b));
    check("残りの有効な項目は採用される", titles5b.some((t) => t.includes("採用されるタスク")), JSON.stringify(titles5b));
    const bar5b = await draftBarText();
    check("一部だけ落ちてもsourceはai-planのまま(全体フォールバックしない)", (bar5b || "").includes("🤖 AIプラン由来"), bar5b);
    const mainText5b = await page.locator("main").textContent();
    check("除外された項目が「時間切れで除外」として表示される(見送りとは別ラベル)",
      mainText5b.includes("時間切れで除外") && mainText5b.includes("過去時刻タスク"), mainText5b.slice(0, 500));

    // ============================================================
    // (e) 下書きUndo・却下理由ワンタップ選択
    // ============================================================
    console.log("[6] 下書きUndo: ×で削除 → 「元に戻す」で直前状態へ復元");
    aiPlanFixture = null;  // 以降のシナリオはAIプラン非依存(ai-scheduleを使う)
    await seed({
      tasks: [wbsTask("task-u1", "Undo検証タスクA", { estimateMin: 30 }), wbsTask("task-u2", "Undo検証タスクB", { estimateMin: 30 })],
      projects: [testProject()]
    });
    await page.click('[data-action="ai-schedule"]');
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
      projects: [testProject()]
    });
    await page.click('[data-action="ai-schedule"]');
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
      projects: [testProject()]
    });
    await page.click('[data-action="ai-schedule"]');
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
      projects: [testProject()]
    });
    await page.click('[data-action="ai-schedule"]');
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
    // (d) 週次レビュー_*.md のアプリ内表示(無い場合は非表示 → ある場合は表示+登録)
    // ============================================================
    console.log("[8] 週次レビュー_*.mdが無い週は「AI週次レビュー」セクションが非表示");
    weeklyReviewFixture = null;
    await seed({ view: "weekly" });
    await page.waitForTimeout(600);
    check("AI週次レビュー見出しが出ない(ファイル無し)", await page.locator('.weekly-sec h3:has-text("AI週次レビュー")').count() === 0);

    console.log("[9] 週次レビュー_*.mdがある週は表示され、「+登録」で1件ずつWBSへ登録できる");
    weeklyReviewFixture = [
      `# 週次レビュー ${WEEK}`,
      "",
      "## 今週の事実",
      "- v62テスト用ダミー",
      "",
      "## ルーティン最適化の提案",
      "対象なし",
      "",
      "## WBS棚卸し",
      "対象なし",
      "",
      "## 12WYレビュー",
      "進捗データなし",
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
    await seed({ view: "weekly" });
    await page.waitForTimeout(700);
    check("AI週次レビュー見出しが表示される", await page.locator('.weekly-sec h3:has-text("AI週次レビュー")').count() === 1);
    const weeklyMdText = await page.locator(".ai-weekly-suggest").textContent().catch(() => "");
    check("週次提案タスクA/Bの両方が一覧に出る", weeklyMdText.includes("週次提案タスクA") && weeklyMdText.includes("週次提案タスクB"), weeklyMdText);
    check("+登録ボタンが2件分ある(一括登録ボタンではない)", await page.locator('[data-action="weekly-suggest-add"]').count() === 2);

    await page.locator('[data-action="weekly-suggest-add"]').first().click();
    await page.waitForTimeout(400);
    const s9 = await stateNow();
    // v62(m7レビュー対応): 「(30分)」はestimateMinへ分離され、タイトルからは取り除かれる
    const registeredTask = (s9.tasks || []).find((t) => t.title === "週次提案タスクA");
    check("1件目の+登録でWBSタスクが作られる(タイトルから見積表記が除去される)", !!registeredTask && registeredTask.status === "todo", JSON.stringify(registeredTask));
    check("見積分数(30分)がestimateMinに反映される", !!registeredTask && registeredTask.estimateMin === 30, JSON.stringify(registeredTask));
    const notRegisteredYet = (s9.tasks || []).find((t) => t.title === "週次提案タスクB");
    check("2件目は自動登録されない(一括登録はしない)", !notRegisteredYet, JSON.stringify(notRegisteredYet));
    check("登録済みの行は「+登録」ボタンが消え「✓ 登録済み」になる",
      await page.locator('.ai-weekly-suggest-row:has-text("週次提案タスクA") button[data-action="weekly-suggest-add"]').count() === 0
      && (await page.locator('.ai-weekly-suggest-row:has-text("週次提案タスクA")').textContent()).includes("登録済み"));
    check("未登録行にはまだ+登録ボタンが残る", await page.locator('.ai-weekly-suggest-row:has-text("週次提案タスクB") [data-action="weekly-suggest-add"]').count() === 1);

    // ============================================================
    // (f) ホーム信条の実データ化
    // ============================================================
    console.log("[10] ホーム信条がKの実データ裏付け型の文言になっている");
    await seed({ view: "home" });
    const creedText = await page.locator(".home-creed").textContent();
    check("「決めた一つは、必ずやり切れる(MIT達成率100%)」が含まれる", creedText.includes("決めた一つは、") && creedText.includes("必ずやり切れる(MIT達成率100%)"), creedText);
    check("「進んだ量で測る。実行率で自分を裁かない」が含まれる", creedText.includes("進んだ量で測る。") && creedText.includes("実行率で自分を裁かない"), creedText);
    check("「朝に全部を注ぐ。夜は手放して充電する」が含まれる", creedText.includes("朝に全部を注ぐ。") && creedText.includes("夜は手放して充電する"), creedText);
    check("旧文言(着手第一主義!)は残っていない", !creedText.includes("着手第一主義"));
  } finally {
    // v70: page.routeでモックしているため、実ファイルの後始末は不要(何も書いていない)。
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
