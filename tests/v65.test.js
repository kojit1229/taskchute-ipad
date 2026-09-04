// v65 検証: 10x機構の最小構成(designs/10x-mechanism.md v65節)。
//
// (a) normalizeState 後方互換: 旧Task/旧Block(leverageTypeフィールド無し)に ""(未設定) が補完される
// (b) Task/Block編集モーダルで leverageType を選択→保存できる(select保存)
// (c) 10秒判定ヘルパー: 3問中2問以上チェック→「判定結果を反映」でselectが asset になる。
//     1問だけなら未設定のままになる(強制しない・保存前はstate未変更)
// (d) 一覧(タスクシュート/WBS)・タイムラインに leverageType の控えめマークが出る
//     (asset=⚙資産・eliminate=✂削減。oneoffは視覚ノイズ回避のため無表示)
// (e)(f) v299で削除したAIプラン専用leverage検出・aiPlanSkippedLogの不在を固定する
//
// 方針: 既存スイート(v61/v62/v63)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。AIプランのfetchは
// v70でv62.test.jsと同じくpage.route(実ファイル不使用)によるモックへ書き換えた(理由はv62.test.js参照)。
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
  // v61/v62と同じ理由(computeFreeGapsが「現在時刻〜23:00」に依存)で日中に固定する。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);

  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  function makeBlockFixture({ id, date = TODAY, title, startMin = 9 * 60, minutes = 30, category = "",
    taskId = "", completed = false, leverageType, includeLeverageField = true }) {
    const b = {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt: completed ? `${date}T${hhmm(startMin)}` : "",
      actualEndAt: completed ? `${date}T${hhmm(startMin + minutes)}` : "",
      completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
    if (includeLeverageField) b.leverageType = leverageType || "";
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
    console.log("[1] normalizeState 後方互換: 旧Task/旧Block(leverageType無し)→\"\"補完、削除stateは再生成しない");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [{
        id: "legacy-task", projectId: "", parentTaskId: "", title: "旧データTask", category: "",
        status: "todo", dueDate: "", description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // leverageType フィールドなし(旧データを模擬)
      }];
      s.blocks = [{
        id: "legacy-block", taskId: "", date: TODAY, title: "旧データBlock", category: "",
        plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
        comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
        // leverageType フィールドなし(旧データを模擬)
      }];
      s.projects = [];
      delete s.aiPlanSkippedLog;  // フィールド自体が無い旧state
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await page.waitForTimeout(200);
    const normalized1 = await stateNow();
    const legacyTask = (normalized1.tasks || []).find((t) => t.id === "legacy-task");
    const legacyBlock = (normalized1.blocks || []).find((b) => b.id === "legacy-block");
    check("旧Taskにleverageの補完される", !!legacyTask && legacyTask.leverageType === "", JSON.stringify(legacyTask));
    check("旧Blockにleverageの補完される", !!legacyBlock && legacyBlock.leverageType === "", JSON.stringify(legacyBlock));
    check("aiPlanSkippedLogはnormalizeStateで再生成されない", !("aiPlanSkippedLog" in normalized1), JSON.stringify(normalized1.aiPlanSkippedLog));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);

    // ============================================================
    // (b) Task/Block編集モーダルで leverageType を選択→保存できる
    // ============================================================
    console.log("[2] Task編集モーダルで leverageType(資産)を選択→保存できる");
    await seed({
      tasks: [wbsTask("task-lev1", "leverageType保存検証Task")],
      projects: [testProject()],
      view: "wbs"
    });
    // v329: 行の副操作は…メニュー(排他)の中。先に開く(セレクタ追随・assert不変)
    await page.click('[data-wbs-row-id="task-lev1"] [data-action="wbs-row-menu-toggle"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="edit-task"][data-id="task-lev1"]');
    await page.waitForTimeout(200);
    check("Task編集モーダルにレバレッジselectがある", await page.locator('[data-modal-field="leverageType"]').count() === 1);
    await page.selectOption('[data-modal-field="leverageType"]', "asset");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const savedTask = (s2.tasks || []).find((t) => t.id === "task-lev1");
    check("Taskのleverageが保存される", !!savedTask && savedTask.leverageType === "asset", JSON.stringify(savedTask));

    console.log("[3] Block編集モーダルで leverageType(削減)を選択→保存できる");
    await seed({
      blocks: [makeBlockFixture({ id: "block-lev1", title: "leverageType保存検証Block" })],
      view: "tasks"
    });
    await page.click('[data-action="edit-block"][data-id="block-lev1"]');
    await page.waitForTimeout(200);
    check("Block編集モーダルにレバレッジselectがある", await page.locator('[data-modal-field="leverageType"]').count() === 1);
    await page.selectOption('[data-modal-field="leverageType"]', "eliminate");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const savedBlock = (s3.blocks || []).find((b) => b.id === "block-lev1");
    check("Blockのleverageが保存される", !!savedBlock && savedBlock.leverageType === "eliminate", JSON.stringify(savedBlock));

    // ============================================================
    // (c) 10秒判定ヘルパー: 強制しない・保存前はstate未変更
    // ============================================================
    console.log("[4] 10秒判定ヘルパー: 2問以上チェック→「判定結果を反映」でselectがassetになる");
    await seed({
      tasks: [wbsTask("task-lev2", "10秒判定検証Task")],
      projects: [testProject()],
      view: "wbs"
    });
    // v329: 行の副操作は…メニュー(排他)の中。先に開く(セレクタ追随・assert不変)
    await page.click('[data-wbs-row-id="task-lev2"] [data-action="wbs-row-menu-toggle"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="edit-task"][data-id="task-lev2"]');
    await page.waitForTimeout(200);
    check("10秒判定ヘルプ(details)がある", await page.locator(".lev-helper").count() === 1);
    await page.click(".lev-helper summary");  // 開く(details既定は閉じているため)
    await page.check('[data-lev-q="1"]');
    await page.check('[data-lev-q="2"]');
    await page.click('[data-action="lev-judge"]');
    await page.waitForTimeout(150);
    const selVal1 = await page.locator('[data-modal-field="leverageType"]').inputValue();
    check("2問以上Yesでselectがassetになる", selVal1 === "asset", selVal1);
    await page.click('[data-action="modal-close"]');  // 保存せずキャンセル
    await page.waitForTimeout(150);
    // v329: 直前に開いた…メニューがDOM直操作(render非経由)のため開いたまま残ることがある。
    // 閉じている時だけ開く(セレクタ追随・assert不変)
    const task_lev2MenuOpen = await page.evaluate(() => {
      const panel = document.querySelector('[data-wbs-row-id="task-lev2"] .wbs-row-menu-panel');
      return panel ? !panel.hidden : false;
    });
    if (!task_lev2MenuOpen) {
      await page.click('[data-wbs-row-id="task-lev2"] [data-action="wbs-row-menu-toggle"]');
      await page.waitForTimeout(150);
    }
    await page.click('[data-action="edit-task"][data-id="task-lev2"]');  // 開き直す
    await page.waitForTimeout(150);
    const selValAfterCancel = await page.locator('[data-modal-field="leverageType"]').inputValue();
    check("保存せずキャンセルすると判定結果は反映されない(強制しない)", selValAfterCancel === "", selValAfterCancel);

    console.log("[5] 10秒判定ヘルパー: 1問だけなら未設定のまま(強制しない)");
    await page.click(".lev-helper summary");  // 開き直したモーダルなので再度開く
    await page.check('[data-lev-q="1"]');
    await page.click('[data-action="lev-judge"]');
    await page.waitForTimeout(150);
    const selVal2 = await page.locator('[data-modal-field="leverageType"]').inputValue();
    check("1問だけなら未設定のまま", selVal2 === "", selVal2);
    await page.click('[data-action="modal-close"]');  // このケースは保存せず閉じる

    // ============================================================
    // (d) 一覧・タイムラインの控えめマーク
    // ============================================================
    console.log("[6] タスクシュート一覧・WBS一覧・タイムラインにleverageTypeの控えめマークが出る");
    await seed({
      tasks: [wbsTask("task-mark1", "資産マーク検証Task", { leverageType: "asset" })],
      blocks: [
        makeBlockFixture({ id: "block-mark1", title: "資産マーク検証Block", leverageType: "asset", startMin: 9 * 60 }),
        makeBlockFixture({ id: "block-mark2", title: "削減マーク検証Block", leverageType: "eliminate", startMin: 11 * 60 }),
        makeBlockFixture({ id: "block-mark3", title: "単発マーク非表示検証Block", leverageType: "oneoff", startMin: 13 * 60 })
      ],
      projects: [testProject()],
      view: "tasks"
    });
    const tasksViewText = await page.locator("main").innerHTML();
    check("タスクシュート一覧に⚙資産マークが出る(asset)", tasksViewText.includes("⚙資産") && tasksViewText.includes("lev-asset"), "");
    check("タスクシュート一覧に✂削減マークが出る(eliminate)", tasksViewText.includes("✂削減") && tasksViewText.includes("lev-eliminate"), "");
    check("oneoffは視覚ノイズ回避のためマーク非表示", !tasksViewText.includes(">単発<"), "");

    await page.click('[data-action="nav"][data-view="wbs"]');
    await page.waitForTimeout(300);
    const wbsViewText = await page.locator("main").innerHTML();
    check("WBS一覧のTaskにも⚙資産マークが出る", wbsViewText.includes("⚙資産"), "");

    // v335(§C追随): 旧timelineへの直接navは無くなったため、execへ遷移して実績モードへ切替える。
    await page.click('[data-action="nav"][data-view="exec"]');
    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForTimeout(300);
    const timelineText = await page.locator("main").innerHTML();
    check("タイムラインカードにも⚙資産/✂削減マークが出る", timelineText.includes("⚙資産") && timelineText.includes("✂削減"), "");

    // ============================================================
    // (e)(f) v299: AIプラン専用leverage検出とskippedログを削除。
    // Test-Reduction: 手動leverageの保存・表示は[2]〜[6]で同等以上に固定する。
    // ============================================================
    console.log("[7-8] v299: AIプラン専用leverage検出・skippedログを削除");
    check("detectLeverageTypeFromTitle本体が存在しない", !/\bfunction\s+detectLeverageTypeFromTitle\b/.test(appSource));
    check("ASSET_TITLE_PREFIXが存在しない", !appSource.includes("ASSET_TITLE_PREFIX"));
    check("aiPlanSkippedLog参照が存在しない", !appSource.includes("aiPlanSkippedLog"));
    check("AI_PLAN_SKIPPED_LOG_MAXが存在しない", !appSource.includes("AI_PLAN_SKIPPED_LOG_MAX"));

  } finally {
    // v70: page.routeでモックしているため、実ファイルの後始末は不要(何も書いていない)。
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
