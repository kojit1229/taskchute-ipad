// v117 検証: 今日の宣言(A)+自己締切の自動前倒し(B)+過集中ブレーカーのゲート化(C)。
// K承認済み案件(2026-07-17)。
//
// (a) 今日の宣言カード: 表示・change時の保存・赤警告の出現(今日・未入力)/消灯(入力後)。
//     過去日を見ている時は未入力でも警告が出ない
// (b) 日報生成: `## 📣 今日の宣言`節が常に出力される(理想ワンライナーと異なり省略しない。
//     未入力時は「(未入力)」)
// (c) effectiveDueDate: 既定(selfDueOff false)でdueDateの2日前倒し・selfDueOff=trueで無効化・
//     WBS行の期限切れ判定/締切ラベル併記(前倒しが効く時だけ「実 M/D」を併記)への反映
// (d) 過集中ブレーカーのゲート: 保護系ルーティン未実行時、Block完了(toggle-block)直後に出る。
//     保護系ルーティンが無い/全部実行済みなら出ない。「あとで」を押した直後は抑止フラグが立ち、
//     同一セッション内では再表示されない(90分の実経過待ちはモックが難しいため、抑止フラグの
//     単体確認に留める)
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
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v108/v113/v114と同じ方針)
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);
  const YEST = isoOffset(-1);
  const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

  const testProject = () => ({
    id: "proj-1", kind: "normal", title: "テスト案件", category: "", status: "active", priority: "中",
    showProgress: false, description: "", dueDate: "", twelveWeekStartDate: "",
    createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false
  });
  function makeTask({ id, title, dueDate = "", selfDueOff = false, status = "todo" }) {
    return {
      id, projectId: "proj-1", parentTaskId: "", title, category: "", status, dueDate,
      description: "", selfDueOff, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
      realized: false, realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "",
      aiWork: false, aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
      criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  function makeRule({ id, title, time, protection = true, fallbackTitle = "" }) {
    return {
      id, title, category: "ルーティン", taskId: "", kind: "daily", startTime: time, endTime: "",
      anchorDate: YEST, expectedCharge: "", expectedDischarge: "", source: "", exceptionDates: [],
      protection, fallbackTitle, fallbackMinutes: fallbackTitle ? 5 : null, anchor: "",
      createdAt: `${YEST}T00:00`, updatedAt: `${YEST}T00:00`, deleted: false
    };
  }
  function makeRoutineBlock({ id, ruleId, title, time, completed = false }) {
    return {
      id, taskId: "", date: TODAY, title, category: "ルーティン",
      plannedStartAt: `${TODAY}T${time}`, plannedEndAt: `${TODAY}T${time}`,
      actualStartAt: "", actualEndAt: "", completed, charge: 0, discharge: 0,
      expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: ruleId,
      pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false, source: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  function makeBlock({ id, title, startMin, completed = false }) {
    return {
      id, taskId: "", date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`, plannedEndAt: `${TODAY}T${hhmm(startMin + 30)}`,
      actualStartAt: "", actualEndAt: "", completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      carryCount: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false
    };
  }

  async function seed({ blocks = [], tasks = [], projects = [], recurrences = [], dailyDeclarations = {}, view = "home", pomodoro = null } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, recurrences, dailyDeclarations, TODAY, view, pomodoro }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.recurrences = recurrences;
      s.dailyDeclarations = dailyDeclarations;
      s.selectedDate = TODAY;
      s.currentView = view;
      // v117(C)追補: ポモドーロ完了経路のゲートトリガー検証用(未指定なら既存どおり無変更)
      if (pomodoro) s.pomodoro = { ...(s.pomodoro || {}), ...pomodoro };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, recurrences, dailyDeclarations, TODAY, view, pomodoro });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  // WBSタスク行のテキスト・期限切れ表示有無を取得する。renderTaskRow内は
  // [data-action="edit-task"][data-id]がタイトル(title-line内)と「編集」ボタン
  // (row.wbs-actions内)の2箇所にあるため、.first()でタイトル側に絞ってから
  // 最も近い祖先div.rowを辿る(=タイトル・期限バッジ等を含む本体行)。
  async function taskRowInfo(taskId) {
    const titleEl = page.locator(`[data-action="edit-task"][data-id="${taskId}"]`).first();
    const row = titleEl.locator("xpath=ancestor::div[contains(@class,'row')][1]");
    return { text: await row.innerText(), overdueCount: await row.locator(".wbs-overdue").count() };
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 今日の宣言カード
    // ============================================================
    // v147: 未入力時の赤警告(.home-declaration-alert)はhomeTodayStatusCard(「今日の状態」1枚化)
    // へ統合され、色もグレーに変わった(赤は同期異常等データ保全系のみに限定)。
    const declAlertShown = async () => (await page.locator(".home-today-status").textContent().catch(() => "")).includes("今日の宣言が未入力です");
    // v149(UI改善計画Phase4a): 今日の宣言入力欄(homeDeclarationCard)はホームの2タブ分割で
    // 「アファメーション」としてホームタブへ移動した(既定は今日タブ)。「今日の状態」警告
    // (homeTodayStatusCard)は今日タブに残るため、タブを行き来して両方を検証する。
    const gotoHomeTab = async () => { await page.click('[data-action="home-tab"][data-tab="home"]'); await page.waitForTimeout(150); };
    const gotoTodayTab = async () => { await page.click('[data-action="home-tab"][data-tab="today"]'); await page.waitForTimeout(150); };
    console.log("[1] 今日の宣言: 未入力の今日は「今日の状態」に警告が出る。入力し保存すると消える");
    await seed({ view: "home" });
    check("未入力の今日は「今日の状態」に警告が出る", await declAlertShown());
    await gotoHomeTab();
    check("宣言入力欄が表示される", await page.locator("[data-declaration-date]").count() === 1);
    await page.fill("[data-declaration-date]", "決算ナビのバグ修正に着手する");
    await page.locator("[data-declaration-date]").evaluate((el) => el.blur());
    await page.waitForTimeout(200);
    const s1 = await stateNow();
    check("change時にdailyDeclarationsへ保存される",
      s1.dailyDeclarations?.[TODAY]?.text === "決算ナビのバグ修正に着手する", JSON.stringify(s1.dailyDeclarations));
    check("updatedAtも記録される", !!s1.dailyDeclarations?.[TODAY]?.updatedAt, JSON.stringify(s1.dailyDeclarations));
    await gotoTodayTab();
    // 環境負荷でrender()完了がwaitForTimeout固定値より遅れることがあったため、
    // 警告文言の消滅をポーリング待機する(タイムアウトしても後続checkで通常どおり❌になるだけ)
    await page.waitForFunction(
      () => !(document.querySelector(".home-today-status")?.textContent || "").includes("今日の宣言が未入力です"),
      null, { timeout: 3000 }
    ).catch(() => {});
    check("入力後は警告が消える", !(await declAlertShown()));

    console.log("[2] 今日の宣言: 過去日を見ている時は未入力でも警告が出ない");
    await seed({ dailyDeclarations: {}, view: "home" });
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    check("過去日(昨日)を見ている時は未入力でも警告が出ない", !(await declAlertShown()));
    await gotoHomeTab();
    check("それでも入力欄自体は出る(過去日も編集可能)", await page.locator("[data-declaration-date]").count() === 1);

    // ============================================================
    // (b) 日報生成
    // ============================================================
    console.log("[3] 日報生成: 今日の宣言が入力済みなら本文がそのまま出る");
    await seed({ dailyDeclarations: { [TODAY]: { text: "日報反映テストの宣言", updatedAt: `${TODAY}T07:00:00` } }, view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText1 = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    check("`## 📣 今日の宣言`見出しが出力される", reportText1.includes("## 📣 今日の宣言"), reportText1.slice(0, 200));
    check("宣言本文が出力される", reportText1.includes("日報反映テストの宣言"), reportText1.slice(0, 300));

    console.log("[4] 日報生成: 未入力日は節自体は出て本文が「(未入力)」になる");
    await seed({ dailyDeclarations: {}, view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(400);
    const reportText2 = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    check("見出しは省略されない(未入力でも節自体は常に出る)", reportText2.includes("## 📣 今日の宣言"), reportText2.slice(0, 200));
    check("本文は「(未入力)」になる", /## 📣 今日の宣言\s*\n\s*\(未入力\)/.test(reportText2), reportText2.slice(0, 200));

    // ============================================================
    // (c) 自己締切の自動前倒し(effectiveDueDate)
    // ============================================================
    console.log("[5] effectiveDueDate: 既定(selfDueOff false)はdueDateの2日前が有効締切になる");
    const dueIn5 = isoOffset(5);
    const effOf5 = isoOffset(3);  // 5日後の2日前=3日後
    await seed({
      projects: [testProject()],
      tasks: [makeTask({ id: "t-auto", title: "自動前倒しタスク", dueDate: dueIn5, selfDueOff: false })],
      view: "wbs"
    });
    const rowAuto = await taskRowInfo("t-auto");
    check("締切ラベルに前倒し後の日付が出る", rowAuto.text.includes(effOf5.slice(5).replace("-", "/")), rowAuto.text);
    check("実期日も併記される(前倒しが効いている時だけ)", rowAuto.text.includes(`実 ${dueIn5.slice(5).replace("-", "/")}`), rowAuto.text);
    check("期限切れ(wbs-overdue)にはならない(3日後はまだ先)", rowAuto.overdueCount === 0);

    console.log("[6] effectiveDueDate: 前倒しにより「まだ実期日前だが有効締切は過ぎている」タスクが期限切れ表示になる");
    const dueTomorrow = isoOffset(1);  // 実期日は明日=まだ先だが、2日前倒しで有効締切は昨日
    await seed({
      projects: [testProject()],
      tasks: [makeTask({ id: "t-pressured", title: "前倒しで期限切れ扱いのタスク", dueDate: dueTomorrow, selfDueOff: false })],
      view: "wbs"
    });
    const rowPressured = await taskRowInfo("t-pressured");
    check("実期日はまだ先でも、前倒しにより期限切れ(wbs-overdue)表示になる", rowPressured.overdueCount === 1);

    console.log("[7] effectiveDueDate: selfDueOff=trueは前倒しを無効化し、実期日をそのまま使う");
    await seed({
      projects: [testProject()],
      tasks: [makeTask({ id: "t-off", title: "前倒し無効タスク", dueDate: dueTomorrow, selfDueOff: true })],
      view: "wbs"
    });
    const rowOff = await taskRowInfo("t-off");
    check("selfDueOff=trueは実期日のみ表示(「実」の併記が無い)", !rowOff.text.includes("(実"), rowOff.text);
    check("selfDueOff=trueは期限切れにならない(実期日は明日でまだ先)", rowOff.overdueCount === 0);

    console.log("[8] タスク編集モーダル: 「⏪ 自己締切(期日−2日)」チェックボックスの保存反映(反転マッピング)");
    // 直前の[7]でtasksを[t-off]だけに差し替えているため、t-pressuredを再投入してから編集する
    await seed({
      projects: [testProject()],
      tasks: [makeTask({ id: "t-pressured", title: "前倒しで期限切れ扱いのタスク", dueDate: dueTomorrow, selfDueOff: false })],
      view: "wbs"
    });
    // renderTaskRowは[data-action="edit-task"]がタイトルと「編集」ボタンの2箇所にあるため.first()で絞る
    await page.locator('[data-action="edit-task"][data-id="t-pressured"]').first().click();
    await page.waitForTimeout(200);
    const checkedByDefault = await page.locator('[data-modal-field="selfDueEnabled"]').isChecked();
    check("既定(selfDueOff false)ではチェックがON表示になる", checkedByDefault === true);
    await page.uncheck('[data-modal-field="selfDueEnabled"]');
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s8 = await stateNow();
    const tPressuredAfter = (s8.tasks || []).find((t) => t.id === "t-pressured");
    check("チェックを外すとselfDueOff=trueで保存される", tPressuredAfter && tPressuredAfter.selfDueOff === true, JSON.stringify(tPressuredAfter));

    // ============================================================
    // (d) 過集中ブレーカーのゲート
    // ============================================================
    console.log("[9] ゲート: 保護系ルーティン未実行がある状態でBlock完了すると軽量モーダルが出る");
    const ruleProtected = makeRule({ id: "rule-protect", title: "運動", time: "06:00", protection: true });
    const blkRoutine = makeRoutineBlock({ id: "blk-routine", ruleId: "rule-protect", title: "運動", time: "06:00", completed: false });
    const blkOther = makeBlock({ id: "blk-other", title: "普通のBlock", startMin: 9 * 60, completed: false });
    await seed({ blocks: [blkRoutine, blkOther], recurrences: [ruleProtected], view: "tasks" });
    await page.click('[data-action="toggle-block"][data-id="blk-other"]');
    await page.waitForTimeout(300);
    check("保護系ルーティン未実行がある時、Block完了直後にゲートモーダルが出る",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 1);
    check("未実行の保護系ルーティン名が一覧に出る",
      (await page.locator(".modal-body").innerText()).includes("運動"));
    check("縮退版未設定のルーティンには「Block作成」ボタンが出る",
      await page.locator('[data-action="hyperfocus-gate-make-block"][data-id="rule-protect"]').count() === 1);

    console.log("[10] ゲート: 「Block作成」を押すとBlockが作られる(完了はさせない=偽装しない)");
    await page.click('[data-action="hyperfocus-gate-make-block"][data-id="rule-protect"]');
    await page.waitForTimeout(300);
    const s10 = await stateNow();
    const madeBlock = (s10.blocks || []).find((b) => !b.deleted && b.recurrenceGroupId === "rule-protect" && b.date === TODAY);
    check("今日のルーティンBlockが新規作成される", !!madeBlock, JSON.stringify(madeBlock));
    check("作成しただけでは完了扱いにしない(完了の偽装をしない)", madeBlock && madeBlock.completed === false, JSON.stringify(madeBlock));

    console.log("[11] ゲート: 保護系ルーティンが全部実行済みなら出ない");
    const blkRoutineDone = makeRoutineBlock({ id: "blk-routine2", ruleId: "rule-protect", title: "運動", time: "06:00", completed: true });
    const blkOther2 = makeBlock({ id: "blk-other2", title: "普通のBlock2", startMin: 10 * 60, completed: false });
    await seed({ blocks: [blkRoutineDone, blkOther2], recurrences: [ruleProtected], view: "tasks" });
    await page.click('[data-action="toggle-block"][data-id="blk-other2"]');
    await page.waitForTimeout(300);
    check("保護系ルーティンが実行済みならゲートは出ない", await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 0);

    console.log("[12] ゲート: 縮退版が設定されたルーティンはワンタップボタンになる/「あとで」で閉じられ、直後は抑止される");
    const ruleFallback = makeRule({ id: "rule-fb", title: "睡眠記録", time: "07:00", protection: true, fallbackTitle: "メモだけ残す" });
    const blkFbRoutine = makeRoutineBlock({ id: "blk-fb-routine", ruleId: "rule-fb", title: "睡眠記録", time: "07:00", completed: false });
    const blkFbOther = makeBlock({ id: "blk-fb-other", title: "普通のBlock3", startMin: 11 * 60, completed: false });
    const blkFbOther2 = makeBlock({ id: "blk-fb-other2", title: "普通のBlock4", startMin: 12 * 60, completed: false });
    await seed({ blocks: [blkFbRoutine, blkFbOther, blkFbOther2], recurrences: [ruleFallback], view: "tasks" });
    await page.click('[data-action="toggle-block"][data-id="blk-fb-other"]');
    await page.waitForTimeout(300);
    check("縮退版が設定されたルーティンはワンタップ実行ボタンが出る",
      await page.locator('[data-action="hyperfocus-gate-fallback"][data-id="rule-fb"]').count() === 1);
    await page.click('[data-action="hyperfocus-gate-later"]');
    await page.waitForTimeout(200);
    check("「あとで」でモーダルが閉じる", await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 0);
    await page.click('[data-action="toggle-block"][data-id="blk-fb-other2"]');
    await page.waitForTimeout(300);
    check("表示直後(90分以内)の再度のBlock完了ではゲートが再表示されない(抑止フラグ)",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 0);

    console.log("[13] ゲート: ポモドーロ完了エンジンでも開く");
    const ruleProtectedPomo = makeRule({ id: "rule-protect-pomo", title: "白湯を飲む", time: "06:30", protection: true });
    const blkPomoRoutine = makeRoutineBlock({ id: "blk-pomo-routine", ruleId: "rule-protect-pomo", title: "白湯を飲む", time: "06:30", completed: false });
    const blkPomoTarget = makeBlock({ id: "blk-pomo-target", title: "ポモドーロ対象Block", startMin: 9 * 60 + 50, completed: false });
    await seed({
      blocks: [blkPomoRoutine, blkPomoTarget], recurrences: [ruleProtectedPomo], view: "today",
      pomodoro: { running: true, blockId: "blk-pomo-target", startedAt: `${TODAY}T09:50:00`, endsAt: `${TODAY}T10:25:00`, mode: "focus" }
    });
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "complete-pomodoro";
      button.dataset.testAction = "complete-pomodoro";
      document.body.appendChild(button);
    });
    await page.click('[data-test-action="complete-pomodoro"]');
    await page.waitForTimeout(200);
    // v87の終了報告モーダル(宣言/報告ループ)が挟まるため、スキップして先にBlock完了自体を確定させる
    if (await page.locator('[data-action="report-skip"]').count() > 0) {
      await page.click('[data-action="report-skip"]');
      await page.waitForTimeout(300);
    }
    check("ポモドーロ完了でBlockがcompletedになる",
      (await stateNow()).blocks.find((b) => b.id === "blk-pomo-target")?.completed === true);
    // v129: ポモドーロ完了直後は先に身体スキャンモーダルが開く(順序契約: 身体スキャン→ゲート)。
    // 「記録せず閉じる」で抜けても、閉じた後にゲートが開くことを確認する。
    check("ポモドーロ完了直後は先に身体スキャンモーダルが開く",
      await page.locator(".modal-title", { hasText: "いまの疲労感は?" }).count() === 1);
    await page.click('[data-action="body-scan-discard"]');
    await page.waitForTimeout(200);
    check("身体スキャンを記録せず閉じた後に過集中ブレーカーのゲートモーダルが開く(独立レビュー指摘対応)",
      await page.locator(".modal-title", { hasText: "保護ルーティンが残っています" }).count() === 1);
    check("未実行の保護系ルーティン名(白湯を飲む)が一覧に出る",
      (await page.locator(".modal-body").innerText()).includes("白湯を飲む"));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
