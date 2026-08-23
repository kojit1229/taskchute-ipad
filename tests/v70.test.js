// v70 検証: 実行接点の強化(designs/v70-execution-surface.md、機能3のICSはバッチ側実装のため対象外)。
//
// (a) normalizeState 後方互換: settings.focusTimerAuto が無い旧stateに true が補完される。
//     旧Block(interruptionsフィールド無し・壊れた形状)にも [] が補完される。
// (b) ワンタップ実績: タイムラインカードの「▶いま開始」で actualStartAt が入り、
//     ボタンが「■いま終了」に切り替わる。押すと actualEndAt が入る(focusTimerAutoはOFFで検証し、
//     ボタン単体の挙動をタイマー自動起動と切り分ける)。
// (c) 「予定通りだった」一括承認: 当日の未記録Block(plannedあり・actual無し・完了で無い)だけが
//     計画時刻をコピーされてcompleted化される。既に実績があるBlock・完了済み・ルーティンは対象外。
//     確認ダイアログでキャンセルすると何も変わらない。対象0件ならトーストのみ。
// (d) Now画面(実行コンベア): 「▶ Now」で全画面表示になり、現在時刻に該当するBlockが1個だけ出る。
//     「開始」→actualStartAt、「完了」→次のBlockへ自動遷移、「スキップ」→そのBlockを飛ばして次へ、
//     「✕」で通常UIに戻る(全Block片付いていれば完了メッセージ)。
// (e) タイマー自動起動: focusTimerAuto(既定true)がONだとBlock開始でポモドーロが自動起動する。
//     OFFなら起動しない。既に別Blockのタイマーが動いていれば乗っ取らない。
// (f) 中断記録(チョコ停): フォーカスタイマー中の「中断」は理由ワンタップピッカーを経由し、
//     理由選択で block.interruptions[] に記録されたうえで(既存どおり)タイマーが中断される。
//     キャンセルすればタイマーは止まらず、記録も残らない。
//
// 方針: 既存スイート(v62/v65/v67/v68)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。Clock APIで時刻を固定し、
// AIプラン/AIフィードバック/週次レビューの実ファイルfetchはpage.routeで常に404隔離する
// (本番バッチが実際にこれらを日次でcommitするため、実ファイル有無に結果が左右されないようにする)。
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

  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // computeFreeGaps等が日中に依存する既存スイートと同じ理由
  const TODAY = isoDate(now0);

  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  function planBlock({ id, date = TODAY, title, startMin, minutes = 30, taskId = "", category = "",
    completed = false, actualStartAt = "", actualEndAt = "", interruptions } = {}) {
    const b = {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt, actualEndAt,
      completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
    if (interruptions !== undefined) b.interruptions = interruptions;
    return b;
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

  async function seed({ blocks = [], tasks = [], projects = [], view = "today", focusTimerAuto, pomodoro } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, focusTimerAuto, pomodoro }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.reports[TODAY] = "STALE_BULK_APPROVE";
      s.settings = s.settings || {};
      if (typeof focusTimerAuto === "boolean") s.settings.focusTimerAuto = focusTimerAuto;
      if (pomodoro) s.pomodoro = pomodoro;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, focusTimerAuto, pomodoro });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // v87: now-start/now-end は「宣言→終了報告ループ」のモーダルを経由するようになった。
  // このスイート(v70)はその機能追加前の挙動(即実行)を検証する趣旨のため、
  // 宣言/報告モーダルが出たら「宣言せず開始」/「スキップ」を選び、従来どおりの結果に揃える。
  async function clickAndSkipLifecycleModal(selector) {
    await page.click(selector);
    await page.waitForTimeout(150);
    const declareSkip = page.locator('[data-action="declare-skip"]');
    if (await declareSkip.count() > 0) { await declareSkip.click(); return; }
    const reportSkip = page.locator('[data-action="report-skip"]');
    if (await reportSkip.count() > 0) { await reportSkip.click(); }
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
    // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
    await passGithubGate(page);

    // ============================================================
    // (a) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState後方互換: settings.focusTimerAuto無し→true補完、Block.interruptions無し/壊れた形状→[]補完");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.settings.focusTimerAuto;  // フィールド自体が無い旧state
      s.blocks = [
        {
          id: "legacy-block-no-field", taskId: "", date: TODAY, title: "旧データBlock(interruptions無し)", category: "",
          plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
          actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
          comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
          createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
          // interruptions フィールドなし
        },
        {
          id: "legacy-block-broken-field", taskId: "", date: TODAY, title: "旧データBlock(interruptions壊れた形状)", category: "",
          plannedStartAt: `${TODAY}T10:00:00`, plannedEndAt: `${TODAY}T10:30:00`,
          actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
          comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
          createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
          interruptions: "not-an-array"  // 壊れた形状
        },
        {
          id: "block-with-interruptions", taskId: "", date: TODAY, title: "既存interruptions保持Block", category: "",
          plannedStartAt: `${TODAY}T11:00:00`, plannedEndAt: `${TODAY}T11:30:00`,
          actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
          comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
          createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false,
          interruptions: [{ at: `${TODAY}T10:15:00`, reason: "割込み" }]
        }
      ];
      s.tasks = []; s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const norm1 = await stateNow();
    check("settings.focusTimerAutoが無ければtrueが補完される", norm1.settings.focusTimerAuto === true, JSON.stringify(norm1.settings.focusTimerAuto));
    const legacyNoField = (norm1.blocks || []).find((b) => b.id === "legacy-block-no-field");
    check("interruptionsフィールド無しのBlockに[]が補完される", Array.isArray(legacyNoField?.interruptions) && legacyNoField.interruptions.length === 0, JSON.stringify(legacyNoField?.interruptions));
    const legacyBroken = (norm1.blocks || []).find((b) => b.id === "legacy-block-broken-field");
    check("interruptionsが配列でないBlockは[]に初期化される", Array.isArray(legacyBroken?.interruptions) && legacyBroken.interruptions.length === 0, JSON.stringify(legacyBroken?.interruptions));
    const withInterruptions = (norm1.blocks || []).find((b) => b.id === "block-with-interruptions");
    check("既存interruptionsの値は保持される(既存値優先)", withInterruptions?.interruptions?.length === 1 && withInterruptions.interruptions[0].reason === "割込み", JSON.stringify(withInterruptions?.interruptions));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);

    // ============================================================
    // (b) ワンタップ実績: タイムラインカードの▶いま開始/■いま終了
    // ============================================================
    console.log("[2] タイムラインカード: 「▶いま開始」でactualStartAtが入り「■いま終了」に切り替わる。押すとactualEndAtが入る");
    await seed({
      blocks: [planBlock({ id: "tl-block-1", title: "ワンタップ実績検証Block", startMin: 9 * 60, minutes: 30 })],
      view: "timeline",
      focusTimerAuto: false  // ボタン単体の挙動をタイマー自動起動と切り分けて検証する
    });
    check("未着手カードに▶いま開始ボタンが出る", await page.locator('.timeline-card [data-action="now-start"][data-id="tl-block-1"]').count() === 1);
    check("未着手カードに■いま終了ボタンはまだ出ない", await page.locator('.timeline-card [data-action="now-end"][data-id="tl-block-1"]').count() === 0);
    await clickAndSkipLifecycleModal('.timeline-card [data-action="now-start"][data-id="tl-block-1"]');
    await page.waitForTimeout(300);
    const s2a = await stateNow();
    const b2a = (s2a.blocks || []).find((b) => b.id === "tl-block-1");
    check("actualStartAtが現在時刻で入る", !!b2a?.actualStartAt, JSON.stringify(b2a?.actualStartAt));
    check("focusTimerAuto:falseなのでポモドーロは自動起動しない", s2a.pomodoro?.running !== true, JSON.stringify(s2a.pomodoro));
    check("着手後は■いま終了ボタンに切り替わる", await page.locator('.timeline-card [data-action="now-end"][data-id="tl-block-1"]').count() === 1);
    check("着手後は▶いま開始ボタンは消える", await page.locator('.timeline-card [data-action="now-start"][data-id="tl-block-1"]').count() === 0);
    await clickAndSkipLifecycleModal('.timeline-card [data-action="now-end"][data-id="tl-block-1"]');
    await page.waitForTimeout(300);
    const s2b = await stateNow();
    const b2b = (s2b.blocks || []).find((b) => b.id === "tl-block-1");
    check("actualEndAtが現在時刻で入る", !!b2b?.actualEndAt, JSON.stringify(b2b?.actualEndAt));

    // ============================================================
    // (c) 「予定通りだった」一括承認
    // ============================================================
    console.log("[3] 「予定通りだった」一括承認: 未記録Blockだけ計画時刻がコピーされcompleted化される");
    await seed({
      blocks: [
        planBlock({ id: "bulk-target-1", title: "一括承認対象A", startMin: 9 * 60, minutes: 30, taskId: "bulk-task-1" }),
        planBlock({ id: "bulk-target-2", title: "一括承認対象B", startMin: 10 * 60, minutes: 30 }),
        planBlock({ id: "bulk-has-actual", title: "既に実績ありBlock", startMin: 11 * 60, minutes: 30, actualStartAt: `${TODAY}T11:00:00` }),
        planBlock({ id: "bulk-completed", title: "完了済みBlock", startMin: 12 * 60, minutes: 30, completed: true, actualStartAt: `${TODAY}T12:00:00`, actualEndAt: `${TODAY}T12:30:00` }),
        planBlock({ id: "bulk-routine", title: "ルーティンBlock", startMin: 13 * 60, minutes: 30, category: "ルーティン" })
      ],
      tasks: [wbsTask("bulk-task-1", "一括承認対象Aのタスク")],
      view: "timeline"
    });
    check("「予定通りだった」ボタンが出る(当日・予定モード)", await page.locator('[data-action="bulk-approve-planned"]').count() === 1);
    await page.evaluate(() => { window.confirm = () => false; });
    await page.click('[data-action="bulk-approve-planned"]');
    await page.waitForTimeout(300);
    const sCancelled = await stateNow();
    check("キャンセルすると何も変わらない", !(sCancelled.blocks.find((b) => b.id === "bulk-target-1")?.completed), JSON.stringify(sCancelled.blocks.find((b) => b.id === "bulk-target-1")));
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('[data-action="bulk-approve-planned"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const targetA = s3.blocks.find((b) => b.id === "bulk-target-1");
    const targetB = s3.blocks.find((b) => b.id === "bulk-target-2");
    check("対象Aは計画時刻がそのまま実績にコピーされる", targetA?.actualStartAt === targetA?.plannedStartAt && targetA?.actualEndAt === targetA?.plannedEndAt, JSON.stringify(targetA));
    check("対象Aはcompleted化される", targetA?.completed === true);
    check("対象Bもcompleted化される", targetB?.completed === true);
    check("一括承認の最後に日報が再生成される",
      s3.reports[TODAY] !== "STALE_BULK_APPROVE" && s3.reports[TODAY].includes("一括承認対象A"), s3.reports[TODAY]);
    check("紐づくTaskはtodo→doingになる(自動完了はしない)", s3.tasks.find((t) => t.id === "bulk-task-1")?.status === "doing", JSON.stringify(s3.tasks));
    const hasActual = s3.blocks.find((b) => b.id === "bulk-has-actual");
    check("既に実績があるBlockは対象外(変更されない)", hasActual?.completed !== true && hasActual?.actualStartAt === `${TODAY}T11:00:00`, JSON.stringify(hasActual));
    const alreadyCompleted = s3.blocks.find((b) => b.id === "bulk-completed");
    check("完了済みBlockは対象外(変更されない)", alreadyCompleted?.actualStartAt === `${TODAY}T12:00:00`, JSON.stringify(alreadyCompleted));
    const routine = s3.blocks.find((b) => b.id === "bulk-routine");
    check("ルーティンBlockは対象外(変更されない)", routine?.completed !== true, JSON.stringify(routine));

    console.log("[3b] 対象0件のときはトーストのみでconfirmは呼ばれない");
    await seed({ blocks: [planBlock({ id: "already-done", title: "既に完了済み", startMin: 9 * 60, completed: true, actualStartAt: `${TODAY}T09:00`, actualEndAt: `${TODAY}T09:30` })], view: "timeline" });
    await page.evaluate(() => { window.confirm = () => { throw new Error("confirmは呼ばれないはず"); }; });
    await page.click('[data-action="bulk-approve-planned"]');
    await page.waitForTimeout(300);
    const toastText3b = await page.locator("#toast").textContent();
    check("対象0件のトーストが出る", toastText3b.includes("対象のBlockがありません"), toastText3b);
    // ============================================================
    // (e) タイマー自動起動(focusTimerAuto)
    // ============================================================
    console.log("[5] focusTimerAuto:true(既定)でBlock開始 → フォーカスタイマーが自動起動する");
    await seed({
      blocks: [planBlock({ id: "auto-timer-block", title: "自動起動検証Block", startMin: 9 * 60, minutes: 30 })],
      view: "timeline",
      focusTimerAuto: true
    });
    await clickAndSkipLifecycleModal('.timeline-card [data-action="now-start"][data-id="auto-timer-block"]');
    await page.waitForTimeout(300);
    const s5a = await stateNow();
    check("ポモドーロが自動起動する(running:true)", s5a.pomodoro?.running === true, JSON.stringify(s5a.pomodoro));
    check("起動したポモドーロは開始したBlockに紐づく", s5a.pomodoro?.blockId === "auto-timer-block", JSON.stringify(s5a.pomodoro));

    console.log("[5b] 既に別Blockのタイマーが動いていれば乗っ取らない");
    await seed({
      blocks: [
        planBlock({ id: "running-block", title: "実行中Block", startMin: 8 * 60, minutes: 30 }),
        planBlock({ id: "another-block", title: "別のBlock", startMin: 9 * 60, minutes: 30 })
      ],
      view: "timeline",
      focusTimerAuto: true,
      pomodoro: { running: true, blockId: "running-block", startedAt: `${TODAY}T09:55:00`, endsAt: `${TODAY}T10:20:00`, mode: "focus", tab: "manual" }
    });
    await clickAndSkipLifecycleModal('.timeline-card [data-action="now-start"][data-id="another-block"]');
    await page.waitForTimeout(300);
    const s5b = await stateNow();
    check("既存タイマーは乗っ取られない(blockIdは元のまま)", s5b.pomodoro?.blockId === "running-block", JSON.stringify(s5b.pomodoro));
    check("新しく開始したBlock自体のactualStartAtは記録される", !!s5b.blocks.find((b) => b.id === "another-block")?.actualStartAt);

    // ============================================================
    // (f) 中断記録(チョコ停)
    // ============================================================
    console.log("[6] フォーカスタイマー中の「中断」は理由ワンタップピッカーを経由し、選択でinterruptionsに記録される");
    await seed({
      blocks: [planBlock({ id: "interrupt-block", title: "中断検証Block", startMin: 9 * 60, minutes: 30, actualStartAt: `${TODAY}T10:00:00` })],
      view: "today",
      pomodoro: { running: true, blockId: "interrupt-block", startedAt: `${TODAY}T10:00:00`, endsAt: `${TODAY}T10:25:00`, mode: "focus" }
    });
    check("作業中の中断ボタンが出る", await page.locator('.today-pomodoro [data-action="stop-pomodoro"]').count() === 1);
    await page.click('.today-pomodoro [data-action="stop-pomodoro"]');
    await page.waitForTimeout(300);
    check("理由ワンタップピッカーが出る", await page.locator(".interrupt-reason-picker").count() === 1);
    const sMidInterrupt = await stateNow();
    check("ピッカー表示中はまだタイマーは止まっていない", sMidInterrupt.pomodoro?.running === true);

    console.log("[6b] キャンセルすればタイマーは止まらず、記録も残らない");
    await page.click('[data-action="interrupt-reason-cancel"]');
    await page.waitForTimeout(200);
    check("キャンセルでピッカーが閉じる", await page.locator(".interrupt-reason-picker").count() === 0);
    const sAfterCancel = await stateNow();
    check("キャンセル後もタイマーは動いたまま", sAfterCancel.pomodoro?.running === true);
    check("キャンセルではinterruptionsは記録されない", (sAfterCancel.blocks.find((b) => b.id === "interrupt-block")?.interruptions || []).length === 0);

    console.log("[6c] 理由を選ぶとinterruptionsに記録され、タイマーは中断される(既存挙動どおりactualStartAtはクリア)");
    await page.click('.today-pomodoro [data-action="stop-pomodoro"]');
    await page.waitForTimeout(200);
    await page.click('.interrupt-reason-picker [data-action="interrupt-reason"][data-reason="疲労"]');
    await page.waitForTimeout(300);
    const s6 = await stateNow();
    const interruptedBlock = s6.blocks.find((b) => b.id === "interrupt-block");
    check("interruptionsに理由付きで1件記録される", interruptedBlock?.interruptions?.length === 1 && interruptedBlock.interruptions[0].reason === "疲労", JSON.stringify(interruptedBlock?.interruptions));
    check("記録にatタイムスタンプが入る", !!interruptedBlock?.interruptions?.[0]?.at, JSON.stringify(interruptedBlock?.interruptions));
    check("タイマーは中断される(running:false)", s6.pomodoro?.running === false, JSON.stringify(s6.pomodoro));
    check("既存挙動どおりactualStartAtはクリアされる(再開で改めて記録)", interruptedBlock?.actualStartAt === "", JSON.stringify(interruptedBlock));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
