// v58 検証: レビュー指摘の再確認と回帰ガード。
//
// 背景: review.md にあった以下の指摘は、コード現物確認と tests/v56.test.js の
// 既存アサーションにより v56 時点で実装済みと判明した(review.md 側のチェックが
// 更新漏れだった)。v58 ではコード修正は行わず、review.md のチェックオフと、
// 将来の先祖返り(特に new Date(string) への回帰、.draft-resize のクリック横取り)
// を検知するための回帰テストをここに追加する。
//   - weekRange()/isWishStagnant()/Pomodoro 系の日時文字列パース(9時間ズレ回避)
//   - AI下書きスケジュールの削除ボタン(.draft-remove)が .draft-resize に
//     クリックを奪われる問題(短い下書きBlockで顕著)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction } = require("./helpers");

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
  // v355修正: runAiSchedule()後、1280px未満でもrenderExecView()がscheduleDraftActive()中は
  // timelineHTML(planモード)を描くようになった(app.js renderExecView)ため、.draft-blockは
  // 1280px未満/以上どちらでも到達可能になった。本テストの元のviewport(1100px、1280px境界の
  // 導入前からの値)へ戻し、[4]は1100px/1300pxの両方で下書きBlockの表示・削除を検証する
  // (v335での1300pxへの回避は取り消し。remediation ci-followup 55817e9からの復旧)。
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // "YYYY-MM-DDTHH:mm:ss" 形式(iOS Safari が UTC と誤解釈しうる形式そのもの)で固定する
  const isoDateTime = (d) => `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ---- [1] isWishStagnant(): 60日境界を "YYYY-MM-DDTHH:mm:ss" 形式で正しく判定する ----
  console.log("[1] isWishStagnant() の60日境界(9時間ズレ回避フォーマット)");
  const now = new Date();
  const fresh = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30日前 → 停滞していない
  const stale = new Date(now.getTime() - 61 * 24 * 60 * 60 * 1000); // 61日前 → 停滞している

  const wishProjectId = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);
  check("Wish Project が既定で存在する(normalizeState)", !!wishProjectId);

  await page.evaluate(({ KEY, wishProjectId, freshISO, staleISO }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = s.tasks || [];
    s.tasks.push(
      { id: "wish-fresh", projectId: wishProjectId, parentTaskId: "", title: "新しめのWish", category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "", targetYear: null, realized: false, createdAt: freshISO, updatedAt: freshISO, deleted: false },
      { id: "wish-stale", projectId: wishProjectId, parentTaskId: "", title: "放置中のWish", category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "", targetYear: null, realized: false, createdAt: staleISO, updatedAt: staleISO, deleted: false }
    );
    s.currentView = "wish";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId, freshISO: isoDateTime(fresh), staleISO: isoDateTime(stale) });
  await page.reload();
  await page.waitForTimeout(500);

  const freshText = await page.locator(".wish-card", { hasText: "新しめのWish" }).first().innerText();
  const staleText = await page.locator(".wish-card", { hasText: "放置中のWish" }).first().innerText();
  check("30日前更新のWishは🐢が付かない", !freshText.includes("🐢"), freshText);
  check("61日前更新のWishは🐢が付く(9時間ズレが起きると59〜61日境界の判定がずれる)", staleText.includes("🐢"), staleText);

  // ---- [2] Pomodoro: startedAt/endsAt の "YYYY-MM-DDTHH:mm:ss" パース ----
  console.log("[2] Pomodoro 残り時間(startedAt/endsAt の日時パース)");
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + 5 * 60 * 1000); // 5分後(2倍速表示で約10:00)
  await page.evaluate(({ KEY, startedAtISO, endsAtISO }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.blocks = s.blocks || [];
    s.blocks.push({ id: "blk-pomo", taskId: "", date: "", title: "集中作業", category: "", plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: startedAtISO, updatedAt: startedAtISO, deleted: false });
    s.pomodoro = { running: true, blockId: "blk-pomo", startedAt: startedAtISO, endsAt: endsAtISO, mode: "focus" };
    s.currentView = "today";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, startedAtISO: isoDateTime(startedAt), endsAtISO: isoDateTime(endsAt) });
  await page.reload();
  await page.waitForTimeout(500);

  const overlayText = (await page.locator(".today-pomodoro .pomo-time-overlay").textContent()).trim();
  const parts = overlayText.split(":").map(Number);
  const totalSec = (parts[0] || 0) * 60 + (parts[1] || 0);
  check("Pomodoroが「セッション切れ」として自動リセットされていない(50:00 に戻っていない)",
    overlayText !== "50:00", overlayText);
  // 5分 = 300000ms を2倍速換算(500ms=1秒)すると 600秒(10:00)。9時間ズレなら
  // endsAt が大幅に過去/未来にずれ、00:00 に張り付くか異常値になる。
  check("Pomodoro残り時間が期待レンジ内(9:30〜10:00、9時間ズレなら成立しない)",
    totalSec >= 560 && totalSec <= 600, overlayText);

  // ---- [4] 短い下書きBlockの削除ボタン(×)が .draft-resize にクリックを奪われない ----
  // v60メモ: 元はAIモックで「15分」の配置案を返させていたが、v60で下書きスケジュールは
  // 決定論配置(computeFreeGaps→fallbackMorningPlan)になったため、候補タスクの
  // estimateMin=15 を与えて同じ「15分の極短Block」を再現する(15分刻みに丸められる実装のため
  // 下限に近い最短の有効値として15分を使う。高さは Math.max(26, minutes/60*rowHeight) の
  // 下限26pxに張り付く、という検証対象は変わらない)。
  // v355修正: renderExecView()が1280px未満/以上で分岐する(app.js)ため、両幅で
  // .draft-blockの表示・削除が到達可能であることを回帰ガードする(1280px境界=デスクトップ
  // 二カラム/narrowの分岐点をまたいで検証)。
  async function runDraftRemovalScenario(width) {
    console.log(`[4] 短い下書きBlockの削除ボタンがクリック可能(viewport ${width}px)`);
    const wctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
    const wpage = await wctx.newPage();
    wpage.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
    await blockGithubApiByDefault(wpage);
    await wpage.goto(`http://localhost:${PORT}/`);
    await wpage.waitForTimeout(600);
    await passGithubGate(wpage);
    // v62レビュー対応: runAiSchedule()はcomputeFreeGaps(「現在時刻〜23:00」)に依存するため、
    // 23:00境界付近の実行だとfreeGapsが消えてフレーキーになる(v61で v50/v59/v60 に適用した
    // page.clock対策がこのシナリオだけ未適用だった)。日中時刻に固定して決定論化する。
    await wpage.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
    const TODAY = isoDate(now);
    // v199対応: 「📋 下書きスケジュール」(ai-schedule)の候補源がWBS未Block化タスクから
    // 当日登録済みBlockへ変わったため、task-shortに紐づく当日Block(9:00-9:15・15分)を
    // 合わせて登録する(estimateMinは新経路では使われないが、Block自体の長さを15分にすることで
    // 本テストの検証対象=「短い下書きBlock(高さ26px下限)の削除ボタンがクリック可能」を維持する)。
    await wpage.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
      s.projects.push({ id: "proj-short", kind: "normal", title: "短時間案件", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
      s.tasks = [{ id: "task-short", projectId: "proj-short", parentTaskId: "", title: "短時間タスク", category: "", status: "todo", dueDate: TODAY, description: "", estimateMin: 15, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
      s.blocks = [{
        id: "blk-task-short", taskId: "task-short", date: TODAY, title: "短時間タスク", category: "",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:15`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await wpage.reload();
    await wpage.waitForTimeout(500);

    await wpage.click('[data-action="nav"][data-view="today"]');
    await wpage.waitForTimeout(200);
    const scheduleBtn = wpage.locator('[data-action="ai-schedule"]');
    check(`todayビューには旧下書きボタンを戻さない(${width}px)`, await scheduleBtn.count() === 0);
    if (await scheduleBtn.count()) {
      await scheduleBtn.click();
    } else {
      await dispatchRegisteredAction(wpage, "ai-schedule");
    }
    await wpage.waitForTimeout(600);
    check(`15分の下書きBlockが表示される(${width}px)`, await wpage.locator(".draft-block").count() === 1);
    // review-v355-claude.md H-1対応: 発注書§仕様「確定/取消ボタン(draft-*)が両幅で到達可能」を
    // 表示・高さ・×削除の3点だけでなく、確定(draft-confirm)/破棄(draft-discard)ボタン自体の
    // 到達可能性も両幅でassertする(draft-removeは個別Block除去であり確定ではないため別物)。
    check(`確定/破棄ボタンが到達可能(${width}px)`,
      await wpage.locator('[data-action="draft-confirm"]').count() === 1
      && await wpage.locator('[data-action="draft-discard"]').count() === 1);
    await wpage.locator(".draft-block").scrollIntoViewIfNeeded();
    const box = await wpage.locator(".draft-block").boundingBox();
    check(`下書きBlockの高さが最小値(26px)に張り付いている(短いBlockケース、${width}px)`, !!box && box.height <= 27, box && box.height);

    let removeError = null;
    try {
      await wpage.locator(".draft-remove").click({ timeout: 4000 });
    } catch (e) { removeError = e.message; }
    check(`短いBlockでも×ボタンがクリックでき、.draft-resizeに横取りされない(${width}px)`, !removeError, removeError || "");
    await wpage.waitForTimeout(300);
    check(`削除後は下書きBlockが消える(${width}px)`, await wpage.locator(".draft-block").count() === 0);

    await wctx.close();
  }

  await runDraftRemovalScenario(1100);
  await runDraftRemovalScenario(1300);

  // review-v355-claude.md H-1対応: 発注書§仕様「確定できること」を、少なくとも1幅(narrow=1100px、
  // 今回の退行修正対象そのもの)で実際にdraft-confirmをクリックしBlockへ反映されるまで検証する。
  // (candidate=blockId付きBlockのため確定はBlock新規作成ではなく既存Blockの時刻更新。
  //  Block総数が増えないこと・plannedStartAt/EndAtが下書きの配置どおりに更新されること・
  //  .draft-blockが消えることを見る)
  async function runDraftConfirmScenario(width) {
    console.log(`[5] 下書き確定(draft-confirm)でBlockへ反映され下書きが消える(viewport ${width}px)`);
    const wctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
    const wpage = await wctx.newPage();
    wpage.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
    await blockGithubApiByDefault(wpage);
    await wpage.goto(`http://localhost:${PORT}/`);
    await wpage.waitForTimeout(600);
    await passGithubGate(wpage);
    await wpage.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
    const TODAY = isoDate(now);
    await wpage.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
      s.projects.push({ id: "proj-confirm", kind: "normal", title: "確定検証案件", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
      s.tasks = [{ id: "task-confirm", projectId: "proj-confirm", parentTaskId: "", title: "確定検証タスク", category: "", status: "todo", dueDate: TODAY, description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
      s.blocks = [{
        id: "blk-task-confirm", taskId: "task-confirm", date: TODAY, title: "確定検証タスク", category: "",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await wpage.reload();
    await wpage.waitForTimeout(500);
    await wpage.click('[data-action="nav"][data-view="today"]');
    await wpage.waitForTimeout(200);
    await dispatchRegisteredAction(wpage, "ai-schedule");
    await wpage.waitForTimeout(600);
    check(`確定シナリオ: 下書きBlockが表示される(${width}px)`, await wpage.locator(".draft-block").count() === 1);
    const before = await wpage.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.length, KEY);
    await wpage.click('[data-action="draft-confirm"]');
    await wpage.waitForTimeout(400);
    const after = await wpage.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const b = s.blocks.find((x) => x.id === "blk-task-confirm");
      return b ? { start: b.plannedStartAt, end: b.plannedEndAt, totalBlocks: s.blocks.length } : null;
    }, { KEY });
    check(`確定後、既存BlockのplannedStartAt/EndAtが下書きどおり更新される(${width}px)`,
      !!after && typeof after.start === "string" && after.start.startsWith(TODAY) && typeof after.end === "string" && after.end.startsWith(TODAY),
      JSON.stringify(after));
    check(`確定してもBlock総数は増えない(blockId付き下書きは新規作成でなく更新、${width}px)`,
      !!after && after.totalBlocks === before, JSON.stringify({ before, after }));
    check(`確定後は下書きBlockが消える(${width}px)`, await wpage.locator(".draft-block").count() === 0);
    await wctx.close();
  }
  await runDraftConfirmScenario(1100);

  // review-v355-claude.md M-1対応: 下書き有効中に日付を翌日へ移すと、narrowでは一覧
  // (renderTasks)へ戻り(下書きも一覧も両方消える状態にならない)、元の日付へ戻せば下書きが
  // 再表示され破棄(draft-discard)できることを検証する(_scheduleDraft.dateとstate.selectedDate
  // の不一致時、draftBarHTML/renderDraftLayerと同じゲートでbodyHTMLがlistHTMLへ戻る仕様)。
  async function runDraftDateChangeScenario(width) {
    console.log(`[6] 下書き有効中に日付を移すと一覧に戻り、戻せば破棄できる(viewport ${width}px)`);
    const wctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
    const wpage = await wctx.newPage();
    wpage.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
    await blockGithubApiByDefault(wpage);
    await wpage.goto(`http://localhost:${PORT}/`);
    await wpage.waitForTimeout(600);
    await passGithubGate(wpage);
    await wpage.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
    const TODAY = isoDate(now);
    await wpage.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
      s.projects.push({ id: "proj-datechg", kind: "normal", title: "日付移動検証案件", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
      s.tasks = [{ id: "task-datechg", projectId: "proj-datechg", parentTaskId: "", title: "日付移動検証タスク", category: "", status: "todo", dueDate: TODAY, description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
      s.blocks = [{
        id: "blk-task-datechg", taskId: "task-datechg", date: TODAY, title: "日付移動検証タスク", category: "",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await wpage.reload();
    await wpage.waitForTimeout(500);
    await wpage.click('[data-action="nav"][data-view="today"]');
    await wpage.waitForTimeout(200);
    await dispatchRegisteredAction(wpage, "ai-schedule");
    await wpage.waitForTimeout(600);
    check(`日付移動シナリオ: 下書きBlockが表示される(${width}px)`, await wpage.locator(".draft-block").count() === 1);

    await wpage.click('[data-action="date-next"]');
    await wpage.waitForTimeout(400);
    check(`翌日へ移すと下書きBlockは出ない(${width}px)`, await wpage.locator(".draft-block").count() === 0);
    check(`翌日へ移すと確定/破棄ボタンも出ない(${width}px)`, await wpage.locator('[data-action="draft-confirm"]').count() === 0);
    check(`翌日へ移すと一覧(これから)が表示される(${width}px、下書きも一覧も両方消えない)`,
      await wpage.locator("text=これから").count() > 0);

    await wpage.click('[data-action="date-prev"]');
    await wpage.waitForTimeout(400);
    check(`元の日付へ戻すと下書きBlockが再表示される(${width}px)`, await wpage.locator(".draft-block").count() === 1);
    check(`元の日付へ戻すと破棄ボタンが到達可能(${width}px)`, await wpage.locator('[data-action="draft-discard"]').count() === 1);
    await wpage.click('[data-action="draft-discard"]');
    await wpage.waitForTimeout(300);
    check(`破棄すると下書きBlockが消える(${width}px)`, await wpage.locator(".draft-block").count() === 0);
    await wctx.close();
  }
  await runDraftDateChangeScenario(1100);

  // review-v355-claude.md M-2対応: 下書き有効中に内側の「✅実績」(timeline-mode)トグルへ
  // 切り替えても、renderExecView側でtimelineHTMLのmodeを"planned"へ固定する(state.timelineMode
  // は書き換えない)ため、.draft-blockが消えないことを検証する。
  async function runDraftTimelineModeToggleScenario(width) {
    console.log(`[7] 下書き有効中に✅実績トグルへ切替えても下書きが消えない(viewport ${width}px)`);
    const wctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
    const wpage = await wctx.newPage();
    wpage.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
    await blockGithubApiByDefault(wpage);
    await wpage.goto(`http://localhost:${PORT}/`);
    await wpage.waitForTimeout(600);
    await passGithubGate(wpage);
    await wpage.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
    const TODAY = isoDate(now);
    await wpage.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
      s.projects.push({ id: "proj-modechg", kind: "normal", title: "モード切替検証案件", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
      s.tasks = [{ id: "task-modechg", projectId: "proj-modechg", parentTaskId: "", title: "モード切替検証タスク", category: "", status: "todo", dueDate: TODAY, description: "", estimateMin: 30, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
      s.blocks = [{
        id: "blk-task-modechg", taskId: "task-modechg", date: TODAY, title: "モード切替検証タスク", category: "",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }];
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await wpage.reload();
    await wpage.waitForTimeout(500);
    await wpage.click('[data-action="nav"][data-view="today"]');
    await wpage.waitForTimeout(200);
    await dispatchRegisteredAction(wpage, "ai-schedule");
    await wpage.waitForTimeout(600);
    check(`モード切替シナリオ: 下書きBlockが表示される(${width}px)`, await wpage.locator(".draft-block").count() === 1);

    // v355 review(M-2)テスト注: 旧timelineRail(#timelineRail、state.currentView==="tasks"時のみ
    // 使う非表示DOMだが#appの子として常駐、src/features/timeline.js renderTimelineRail)にも
    // 同名のdata-action/data-modeボタンが常駐しているため、execヘッダの専用コンテナ
    // (.exec-header-actions、app.js renderExecView)へスコープして一意化する。
    const toggleBtn = wpage.locator('.exec-header-actions [data-action="timeline-mode"][data-mode="actual"]');
    check(`「✅実績」トグルが到達可能(下書き有効中でも計画タブのまま、${width}px)`, await toggleBtn.count() === 1);
    await toggleBtn.click();
    await wpage.waitForTimeout(300);
    check(`「✅実績」へ切替えても下書きBlockが消えない(${width}px、state.timelineModeはactualへ)`,
      await wpage.locator(".draft-block").count() === 1);
    const timelineModeAfter = await wpage.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).timelineMode, KEY);
    check(`state.timelineModeは実際に"actual"へ書き換わっている(表示だけの一時的な優先である証拠、${width}px)`,
      timelineModeAfter === "actual", timelineModeAfter);
    check(`「✅実績」へ切替えても確定ボタンが到達可能(${width}px)`, await wpage.locator('[data-action="draft-confirm"]').count() === 1);
    await wctx.close();
  }
  await runDraftTimelineModeToggleScenario(1100);

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
