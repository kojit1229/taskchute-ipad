// v66 検証: 10x機構の可視化強化(designs/10x-mechanism.md v65節 2-2・2-4、v66節 2-1後段)。
//
// (a) normalizeState 後方互換: 旧Task/旧Block(leverageNoteフィールド無し)に ""(未設定) が補完される
// (b) レバレッジ台帳: leverageType=asset で完了したTask/Blockが自動で一覧表示される
//     (タイトル/完了日/累計節約メモ)。メモは入力→保存→リロード後も残る。まだ無ければ静かな空状態を出す
// (c) 台帳先頭の問い: 選択中週に資産が完了していれば「✓ 今週、資産を n 個作った」、
//     無ければ「今週、資産を1つ作ったか?」を裁かずに表示する(週送りで自動的に切り替わる)
// (d) 2x:10x時間比トレンド(直近8週): 常に8行描画され、記録の無い週は0除算せず「記録なし」表示、
//     記録がある週は資産+削減(10x) : 単発+未設定(2x)の比率(%)を表示する
// (e) マイグレーション儀式(3回目の繰り越し)に「Avoid Listへ記録して手放す」選択肢が追加され、
//     選ぶとAvoid Listへ記録されつつBlockが削除される(既存のaddAvoidロジックを流用)
//
// 方針: 既存スイート(v61/v65)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4205;
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
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  // v61/v65と同じ理由(朝プラン/週境界の実時刻依存を避ける)で日中に固定する。
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
  function addDaysStr(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  }
  const WEEK = weekStartOf(TODAY);
  const PREV_WEEK = addDaysStr(WEEK, -7);

  function makeBlockFixture({ id, date = TODAY, title, startMin = 9 * 60, minutes = 30, category = "",
    taskId = "", completed = false, leverageType = "", leverageNote, includeLeverageNote = true, carryCount = 0 }) {
    const b = {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt: completed ? `${date}T${hhmm(startMin)}` : "",
      actualEndAt: completed ? `${date}T${hhmm(startMin + minutes)}` : "",
      completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount, isMIT: false, source: "", estimateMin: null,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false, leverageType
    };
    if (includeLeverageNote) b.leverageNote = leverageNote || "";
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

  async function seed({ blocks = [], tasks = [], projects = [], view = "tasks", weeklySelectedWeek = null } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, weeklySelectedWeek }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.migrationRitualLog = [];
      s.settings.avoidList = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      if (weeklySelectedWeek) s.settings.weeklySelectedWeek = weeklySelectedWeek;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, weeklySelectedWeek });
    await page.reload();
    await page.waitForTimeout(400);
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
    // (a) normalizeState 後方互換: leverageNote が無い旧Task/旧Blockに "" が補完される
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Task/旧Block(leverageNote無し)→\"\"補完");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "", parentTaskId: "", title: "旧データTask(v65相当)", category: "",
        status: "completed", dueDate: "", description: "", leverageType: "asset",
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
        // leverageNote フィールドなし(v65時点の旧データを模擬)
      }];
      s.blocks = [{
        id: "legacy-block", taskId: "", date: TODAY, title: "旧データBlock(v65相当)", category: "",
        plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
        carryCount: 0, leverageType: "eliminate",
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
        // leverageNote フィールドなし(v65時点の旧データを模擬)
      }];
      s.projects = [];
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
    const legacyBlock = (normalized1.blocks || []).find((b) => b.id === "legacy-block");
    check("旧TaskにleverageNoteの補完される", !!legacyTask && legacyTask.leverageNote === "", JSON.stringify(legacyTask));
    check("旧BlockにleverageNoteの補完される", !!legacyBlock && legacyBlock.leverageNote === "", JSON.stringify(legacyBlock));
    check("既存のleverageType(v65補完値)は壊れない", legacyTask?.leverageType === "asset" && legacyBlock?.leverageType === "eliminate");

    // ============================================================
    // (b)(c) レバレッジ台帳: 空状態 + 問い(資産0件の週は問いだけ)
    // ============================================================
    console.log("[2] レバレッジ台帳: 資産が無い週は「今週、資産を1つ作ったか?」を裁かずに表示・台帳は空状態");
    await seed({ tasks: [], blocks: [], projects: [], view: "weekly", weeklySelectedWeek: WEEK });
    await page.waitForTimeout(300);
    check("レバレッジ台帳セクションが表示される", await page.locator(".lev-ledger").count() === 1);
    check("資産0件週は問いだけが出る(✓は出ない)", (await page.locator(".lev-ledger-prompt").textContent()).includes("今週、資産を1つ作ったか?"));
    check("✓プロンプトのyesクラスは付かない", await page.locator(".lev-ledger-prompt-yes").count() === 0);
    check("台帳は空状態メッセージを出す", (await page.locator(".lev-ledger").textContent()).includes("まだ「資産」に分類して完了したTask/Blockがありません"));

    // ============================================================
    // (b)(c) レバレッジ台帳: 資産がある週は✓+件数、一覧にタイトル/完了日/メモ入力が出る
    // ============================================================
    console.log("[3] レバレッジ台帳: leverageType=assetで完了したTask/Blockが自動で一覧化される。✓+件数表示。メモは保存後も残る");
    await seed({
      tasks: [wbsTask("ledger-task", "社内Wiki整備", { status: "completed", leverageType: "asset", realizedDate: WEEK })],
      blocks: [
        makeBlockFixture({ id: "ledger-block", date: WEEK, title: "自動化テンプレ作成", leverageType: "asset", completed: true, startMin: 9 * 60, minutes: 60 }),
        makeBlockFixture({ id: "ledger-block-elim", date: WEEK, title: "定例MTG削減", leverageType: "eliminate", completed: true, startMin: 11 * 60, minutes: 30 })
      ],
      projects: [testProject()],
      view: "weekly",
      weeklySelectedWeek: WEEK
    });
    await page.waitForTimeout(300);
    check("✓ + 件数(2件)が表示される", (await page.locator(".lev-ledger-prompt").textContent()).includes("✓ 今週、資産を 2 個作った"));
    check("台帳に資産(Block)が1行として出る(削減=eliminateは台帳対象外)", await page.locator('.lev-ledger-row:has-text("自動化テンプレ作成")').count() === 1);
    check("台帳に資産(Task)が1行として出る", await page.locator('.lev-ledger-row:has-text("社内Wiki整備")').count() === 1);
    check("eliminateのBlockは台帳(資産一覧)には出ない", await page.locator('.lev-ledger-row:has-text("定例MTG削減")').count() === 0);
    check("台帳の行数は2(asset扱いの2件のみ)", await page.locator(".lev-ledger-row").count() === 2);

    const noteSel = '.lev-ledger-note[data-ledger-note-id="ledger-block"]';
    await page.fill(noteSel, "月20時間削減");
    await page.dispatchEvent(noteSel, "change");
    await page.waitForTimeout(200);
    const noteTaskSel = '.lev-ledger-note[data-ledger-note-id="ledger-task"][data-ledger-note-kind="task"]';
    await page.fill(noteTaskSel, "問い合わせ対応が半減");
    await page.dispatchEvent(noteTaskSel, "change");
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(400);
    const sNote = await stateNow();
    const noteBlock = (sNote.blocks || []).find((b) => b.id === "ledger-block");
    const noteTask = (sNote.tasks || []).find((t) => t.id === "ledger-task");
    check("Blockの累計節約メモが保存され、リロード後も残る", noteBlock?.leverageNote === "月20時間削減", JSON.stringify(noteBlock));
    check("Taskの累計節約メモが保存され、リロード後も残る", noteTask?.leverageNote === "問い合わせ対応が半減", JSON.stringify(noteTask));
    check("リロード後も台帳の入力欄に値が残っている(表示側の反映確認)",
      await page.locator(noteSel).inputValue() === "月20時間削減");

    // ============================================================
    // (c) 問いの✓切替: 前週(資産0件)へ移動すると問いだけの表示に戻る
    // ============================================================
    console.log("[4] 問いの✓切替: 前週(資産0件)へ移動すると✓表示が消え、問いだけになる");
    check("前週ボタンが押せる", await page.locator('[data-action="weekly-prev"]').count() === 1);
    await page.click('[data-action="weekly-prev"]');
    await page.waitForTimeout(300);
    check("前週は資産0件なので✓は出ない", await page.locator(".lev-ledger-prompt-yes").count() === 0);
    check("前週は問いだけが出る", (await page.locator(".lev-ledger-prompt").textContent()).includes("今週、資産を1つ作ったか?"));
    check("台帳の一覧自体は週に関係なく残る(全期間の記録)", await page.locator(".lev-ledger-row").count() === 2);

    // ============================================================
    // (d) 2x:10x時間比トレンド(直近8週): 境界(データ無し週)+ 比率表示
    // ============================================================
    console.log("[5] 2x:10x時間比トレンド: 常に8行、記録ゼロ週は0除算せず「記録なし」、記録がある週は比率%を表示");
    await seed({
      blocks: [
        makeBlockFixture({ id: "trend-asset", date: WEEK, title: "トレンド用資産Block", leverageType: "asset", completed: true, startMin: 9 * 60, minutes: 60 }),
        makeBlockFixture({ id: "trend-oneoff", date: WEEK, title: "トレンド用単発Block", leverageType: "oneoff", completed: true, startMin: 10 * 60 + 30, minutes: 30 })
      ],
      view: "weekly",
      weeklySelectedWeek: WEEK
    });
    await page.waitForTimeout(300);
    check("トレンドは常に8行描画される", await page.locator(".lev-trend-row").count() === 8);
    const emptyRows = await page.locator(".lev-trend-row:has-text(\"記録なし\")").count();
    check("データが無い過去週は「記録なし」表示(0除算・NaN%を出さない)", emptyRows === 7, String(emptyRows));
    check("NaN%が出ない", !(await page.locator(".lev-trend").textContent()).includes("NaN"));
    const lastRowText = await page.locator(".lev-trend-row").last().textContent();
    // asset(10x)=60分、oneoff(2x)=30分 → 10x比率 = 60/90 = 67%
    check("記録がある週(今週)は10x比率67%が出る", lastRowText.includes("67%"), lastRowText);

    // ============================================================
    // (e) マイグレーション儀式に「Avoid Listへ記録して手放す」選択肢が追加される
    // ============================================================
    console.log("[6] 儀式の選択肢: Avoid Listへ記録して手放す → avoidListへ記録され、Blockは削除される");
    await seed({
      blocks: [makeBlockFixture({ id: "cb-avoid", date: YEST, title: "儀式テスト(Avoidへ記録)", startMin: 10 * 60, minutes: 30, carryCount: 2 })],
      view: "tasks"
    });
    await page.click('[data-action="carry-over"][data-id="cb-avoid"]');
    await page.waitForTimeout(300);
    check("儀式モーダルが出る(3回目)", await page.locator(".migration-ritual-modal").count() === 1);
    check("「Avoid Listへ記録して手放す」ボタンがある",
      await page.locator('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="avoid"]').count() === 1);
    await page.click('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="avoid"]');
    await page.waitForTimeout(300);
    const sAvoid = await stateNow();
    const srcAvoid = (sAvoid.blocks || []).find((b) => b.id === "cb-avoid");
    check("元Blockが削除扱いになる", !!srcAvoid && srcAvoid.deleted === true, JSON.stringify(srcAvoid));
    const avoidEntry = (sAvoid.settings?.avoidList || []).find((it) => it.text === "儀式テスト(Avoidへ記録)");
    check("Avoid Listに同名の項目が記録される", !!avoidEntry, JSON.stringify(sAvoid.settings?.avoidList));
    check("選択ログに'avoid'が記録される", (sAvoid.migrationRitualLog || []).some((l) => l.choice === "avoid" && l.blockId === "cb-avoid"), JSON.stringify(sAvoid.migrationRitualLog));

    // Avoid List画面にも実際に表示されることを確認する(入力欄のvalueなのでtextContentではなくinputValueで見る)
    await page.click('[data-action="nav"][data-view="avoid"]');
    await page.waitForTimeout(300);
    const avoidInputValues = await page.$$eval('[data-avoid-field="text"]', (els) => els.map((el) => el.value));
    check("Avoid List画面に記録した項目が表示される", avoidInputValues.includes("儀式テスト(Avoidへ記録)"), JSON.stringify(avoidInputValues));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
