// v65 検証: 10x機構の最小構成(designs/10x-mechanism.md v65節)。
//
// (a) normalizeState 後方互換: 旧Task/旧Block(leverageTypeフィールド無し)に ""(未設定) が
//     補完される。旧state(aiPlanSkippedLogフィールド自体が無い)にも [] が補完される
// (b) Task/Block編集モーダルで leverageType を選択→保存できる(select保存)
// (c) 10秒判定ヘルパー: 3問中2問以上チェック→「判定結果を反映」でselectが asset になる。
//     1問だけなら未設定のままになる(強制しない・保存前はstate未変更)
// (d) 一覧(タスクシュート/WBS)・タイムラインに leverageType の控えめマークが出る
//     (asset=⚙資産・eliminate=✂削減。oneoffは視覚ノイズ回避のため無表示)
// (e) AIプランのtitle先頭「[資産]」検出 → 下書き段階でマーク表示 → 確定後のBlockに
//     leverageType=asset が自動付与される(プレフィックス無しの項目は影響を受けない)
// (f) v64設計§3残余: AIプラン自身のskipped(kind:"ai")が state.aiPlanSkippedLog に記録される
// (g) 週次レビュータブのbucketゲージ下に、leverageType別の実績時間1行集計が表示される
//
// 方針: 既存スイート(v61/v62/v63)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。AIプランのfetchは
// v62.test.js と同じく実ファイルをリポジトリ直下に一時的に書いて読ませ、finally で必ず削除する。
const path = require("path");
const fs = require("fs");
const { chromium, launchOptions, startServer, ROOT } = require("./helpers");

const PORT = 4204;
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
  // v61/v62と同じ理由(computeFreeGapsが「現在時刻〜23:00」に依存)で日中に固定する。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);

  // app.js の weekRange() と同じロジック(週開始=直近土曜)をNode側でも再現する
  function weekStartOf(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 1) % 7; // Sat=0 ... Fri=6
    date.setDate(date.getDate() - dow);
    return isoDate(date);
  }
  const WEEK = weekStartOf(TODAY);
  const aiPlanPath = path.join(ROOT, `AIプラン_${TODAY}.json`);

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

  async function seed({ blocks = [], tasks = [], projects = [], view = "tasks", weeklySelectedWeek = null } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, weeklySelectedWeek }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.aiScheduleHistory = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      if (weeklySelectedWeek) s.settings.weeklySelectedWeek = weeklySelectedWeek;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, weeklySelectedWeek });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function draftTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }

  try {
    await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);

    // ============================================================
    // (a) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Task/旧Block(leverageType無し)→\"\"補完、aiPlanSkippedLog無し→[]補完");
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
    await page.click('[data-action="nav"][data-view="home"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const normalized1 = await stateNow();
    const legacyTask = (normalized1.tasks || []).find((t) => t.id === "legacy-task");
    const legacyBlock = (normalized1.blocks || []).find((b) => b.id === "legacy-block");
    check("旧Taskにleverageの補完される", !!legacyTask && legacyTask.leverageType === "", JSON.stringify(legacyTask));
    check("旧Blockにleverageの補完される", !!legacyBlock && legacyBlock.leverageType === "", JSON.stringify(legacyBlock));
    check("aiPlanSkippedLogが配列として補完される", Array.isArray(normalized1.aiPlanSkippedLog) && normalized1.aiPlanSkippedLog.length === 0, JSON.stringify(normalized1.aiPlanSkippedLog));
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

    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(300);
    const timelineText = await page.locator("main").innerHTML();
    check("タイムラインカードにも⚙資産/✂削減マークが出る", timelineText.includes("⚙資産") && timelineText.includes("✂削減"), "");

    // ============================================================
    // (e) AIプランのtitle先頭「[資産]」検出 + (f) aiPlanSkippedLogへの記録
    // ============================================================
    console.log("[7] AIプランのtitle先頭「[資産]」検出 → 下書きマーク表示 → 確定後Blockにleverage=assetが付与される");
    fs.writeFileSync(aiPlanPath, JSON.stringify({
      date: TODAY,
      generatedAt: `${TODAY}T05:00`,
      plan: [
        { title: "[資産] 自動化コードを書く", taskId: null, blockId: null, start: "10:30", minutes: 30, category: "", reason: "資産化候補", carryFromId: null },
        { title: "普通の単発タスク", taskId: null, blockId: null, start: "11:30", minutes: 30, category: "", reason: "", carryFromId: null }
      ],
      skipped: [
        { title: "AIが見送ったタスク", reason: "時間帯が合わない" }
      ]
    }, null, 2), "utf8");
    await seed({ tasks: [], projects: [] });
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(700);
    const titles7 = await draftTitles();
    check("[資産]プレフィックス項目・通常項目とも下書きに採用される",
      titles7.some((t) => t.includes("自動化コードを書く")) && titles7.some((t) => t.includes("普通の単発タスク")),
      JSON.stringify(titles7));
    // v65レビュー対応(必須1): [資産]プレフィックスは検出後にtitleから除去され、
    // ⚙資産マークと二重表示にならないことを確認する
    check("下書きタイトルに[資産]プレフィックスが残らない(二重表示防止)",
      !titles7.some((t) => t.includes("[資産]")), JSON.stringify(titles7));
    const assetDraftHTML = await page.locator('.draft-block:has-text("自動化コードを書く")').innerHTML();
    check("[資産]項目は下書き段階で⚙資産マークが出る", assetDraftHTML.includes("⚙資産"), assetDraftHTML);
    check("[資産]項目の下書きタイトル自体には[資産]の生プレフィックスが残らない",
      !assetDraftHTML.includes("[資産] 自動化コードを書く"), assetDraftHTML);
    const plainDraftHTML = await page.locator('.draft-block:has-text("普通の単発タスク")').innerHTML();
    check("プレフィックス無し項目には⚙資産マークが出ない", !plainDraftHTML.includes("⚙資産"), plainDraftHTML);

    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const s7 = await stateNow();
    const assetBlock = (s7.blocks || []).find((b) => b.title.includes("自動化コードを書く"));
    const plainBlock = (s7.blocks || []).find((b) => b.title.includes("普通の単発タスク"));
    check("[資産]検出項目はBlock確定時にleverageType=assetが付く", !!assetBlock && assetBlock.leverageType === "asset", JSON.stringify(assetBlock));
    check("確定後のBlockタイトルにも[資産]プレフィックスが残らない(二重表示防止)",
      !!assetBlock && assetBlock.title === "自動化コードを書く" && !assetBlock.title.includes("[資産]"), JSON.stringify(assetBlock));
    check("プレフィックス無し項目はleverageTypeが未設定のまま", !!plainBlock && (plainBlock.leverageType || "") === "", JSON.stringify(plainBlock));

    console.log("[8] v64設計§3残余: AIプラン自身のskipped(kind:ai)がaiPlanSkippedLogへ記録される");
    const skippedLog = (s7.aiPlanSkippedLog || []).find((e) => e.title === "AIが見送ったタスク");
    check("aiPlanSkippedLogにAIの見送り理由が記録される", !!skippedLog && skippedLog.reason === "時間帯が合わない" && skippedLog.date === TODAY, JSON.stringify(skippedLog));

    // ============================================================
    // (g) 週次レビューの leverageType 別1行集計
    // ============================================================
    console.log("[9] 週次レビュータブのbucketゲージ下にleverageType別実績時間の1行集計が表示される");
    await seed({
      blocks: [
        makeBlockFixture({ id: "wk-asset", date: WEEK, title: "週次集計・資産", leverageType: "asset", completed: true, startMin: 9 * 60, minutes: 60 }),
        makeBlockFixture({ id: "wk-elim", date: WEEK, title: "週次集計・削減", leverageType: "eliminate", completed: true, startMin: 10 * 60 + 30, minutes: 30 }),
        makeBlockFixture({ id: "wk-oneoff", date: WEEK, title: "週次集計・単発", leverageType: "oneoff", completed: true, startMin: 11 * 60 + 30, minutes: 15 }),
        makeBlockFixture({ id: "wk-unset", date: WEEK, title: "週次集計・未設定", leverageType: "", completed: true, startMin: 12 * 60, minutes: 45 })
      ],
      view: "weekly",
      weeklySelectedWeek: WEEK
    });
    await page.waitForTimeout(400);
    check("leverageType別1行集計が表示される", await page.locator(".lev-week-summary").count() === 1);
    const summaryText = await page.locator(".lev-week-summary").textContent();
    check("資産の実績時間(1h)が集計に含まれる", summaryText.includes("⚙資産") && summaryText.includes("1h"), summaryText);
    check("削減の実績時間(30m)が集計に含まれる", summaryText.includes("✂削減") && summaryText.includes("30m"), summaryText);
    check("単発の実績時間(15m)が集計に含まれる", summaryText.includes("単発") && summaryText.includes("15m"), summaryText);
    check("未設定の実績時間(45m)が集計に含まれる", summaryText.includes("未設定") && summaryText.includes("45m"), summaryText);
  } finally {
    // リポジトリ直下に書いたテスト用ファイルは必ず削除する
    try { if (fs.existsSync(aiPlanPath)) fs.unlinkSync(aiPlanPath); } catch { /* ignore */ }
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
