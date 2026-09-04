// v61 検証: ROADMAP フェーズ1(繰り越しの無自覚化と継続の自己否定を止める)。
//
// (a) carryCount が繰越経路(carryOverBlock=タスクシュート画面の「→ 今日へ」)で増える
// (b) 3回目の繰り越しで儀式モーダルが出る・各選択肢(今日やる/分解する/手放す/それでも繰り越す)の効果
// (c) 「今日の理想」ワンライナーの保存・3日間のホーム表示(1〜3日目)・3日目のリトライ(続ける/手放す)・
//     日報生成(generateReport)への反映
// (d) normalizeState の後方互換(旧state = carryCount/ideal/migrationRitualLog が無いデータ)
//
// 方針: 既存スイート(v59/v60)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction, generateReportThroughGate } = require("./helpers");
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
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  // page.clockでページ内の現在時刻を日中(10:00)に固定し、日付依存の既存検証を安定させる。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YEST = isoDate(new Date(now0.getTime() - 24 * 60 * 60 * 1000));
  const YEST2 = isoDate(new Date(now0.getTime() - 2 * 24 * 60 * 60 * 1000));

  function planBlock({ id, date, title, startMin, endMin, taskId = "", category = "", migratedTo = "", carryCount = 0 }) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo, orderIndex: 0, carryCount, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
      deleted: false
    };
  }
  function wbsTask(id, title) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  // 共通の下地: blocks/tasks/projects/journalMeta を丸ごと差し替えて reload。
  async function seed({ blocks = [], tasks = [], projects = [], journalMeta = {}, view = "tasks" } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, journalMeta, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.journalMeta = journalMeta;
      s.migrationRitualLog = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, journalMeta, TODAY, view });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ============================================================
  // (d) normalizeState 後方互換: 旧state(carryCount/ideal/migrationRitualLogが無い)
  // ============================================================
  console.log("[1] normalizeState 後方互換(carryCount / journalMeta.ideal / migrationRitualLog)");
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.blocks = [{
      id: "legacy-block", taskId: "", date: TODAY, title: "旧データBlock", category: "",
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      // carryCount フィールドなし(旧データを模擬)
    }];
    s.journalMeta = { [TODAY]: { aiMitCandidates: [], aiImported: false } };  // ideal フィールドなし
    delete s.migrationRitualLog;  // フィールド自体が無い旧state
    s.projects = [];
    s.tasks = [];
    s.selectedDate = TODAY;
    s.currentView = "home";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
  // 何か保存操作を挟んでメモリ上の正規化値を永続化させる(v59/v60のテストと同じ作法)
  await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
  await page.waitForTimeout(300);
  const normalized = await stateNow();
  const legacyBlock = (normalized.blocks || []).find((b) => b.id === "legacy-block");
  check("carryCount のデフォルト(0)が補完される", !!legacyBlock && legacyBlock.carryCount === 0, JSON.stringify(legacyBlock));
  check("journalMeta.ideal のデフォルト('')が補完される", normalized.journalMeta?.[TODAY]?.ideal === "", JSON.stringify(normalized.journalMeta?.[TODAY]));
  check("migrationRitualLog が空配列で補完される", Array.isArray(normalized.migrationRitualLog) && normalized.migrationRitualLog.length === 0, JSON.stringify(normalized.migrationRitualLog));
  check("既存データはクラッシュせず表示できる(pageerror無し)", true);  // pageerrorハンドラで既に監視中

  // ============================================================
  // (a) carryCount の増加: carryOverBlock 経路(通常・儀式未発火)
  // ============================================================
  console.log("[2] carryOverBlock 経路: 通常の繰り越しでcarryCountが0→1になる(儀式は発火しない)");
  await seed({
    blocks: [planBlock({ id: "cb-a", date: YEST, title: "テストA(初回繰越)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 0 })]
  });
  check("繰越パネルにバッジが出ない(carryCount=0)", await page.locator('.carryover-row:has-text("テストA") .migration-badge').count() === 0);
  await page.click('[data-action="carry-over"][data-id="cb-a"]');
  await page.waitForTimeout(300);
  check("儀式モーダルは出ない(1回目)", await page.locator(".migration-ritual-modal").count() === 0);
  let s2 = await stateNow();
  let newA = (s2.blocks || []).find((b) => b.date === TODAY && b.title === "テストA(初回繰越)");
  let srcA = (s2.blocks || []).find((b) => b.id === "cb-a");
  check("新Blockのcarryが1になる", !!newA && newA.carryCount === 1, JSON.stringify(newA));
  check("元Blockにmigratedtoが付く", !!srcA && srcA.migratedTo === newA.id);

  // ============================================================
  // (a)(b) carryCount=2 のBlockはパネルにバッジが出て、繰り越すと儀式(3回目)が発火する
  // ============================================================
  console.log("[3] carryOverBlock 経路: carryCount=2 → バッジ表示 → 3回目で儀式モーダル発火");
  await seed({
    blocks: [planBlock({ id: "cb-b", date: YEST, title: "テストB(2回繰越済み)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  const badgeText = await page.locator('.carryover-row:has-text("テストB") .migration-badge').textContent().catch(() => "");
  check("carryCount=2のBlockはパネルに「↻2」バッジが出る", (badgeText || "").includes("2"), badgeText);
  await page.click('[data-action="carry-over"][data-id="cb-b"]');
  await page.waitForTimeout(300);
  check("儀式モーダルが出る(3回目)", await page.locator(".migration-ritual-modal").count() === 1);
  const ritualTitle = await page.locator(".migration-ritual-modal .modal-title").textContent().catch(() => "");
  check("モーダルに「3回目」の文言がある", (ritualTitle || "").includes("3"), ritualTitle);
  // モーダルを閉じてから次のシナリオへ(選択せず×で閉じても後の状態に影響しないこと)
  await page.click('[data-action="modal-close"]');
  await page.waitForTimeout(200);
  const afterClose = await stateNow();
  const srcBUnchanged = (afterClose.blocks || []).find((b) => b.id === "cb-b");
  check("×で閉じただけでは繰り越されない(migratedTo未設定)", !!srcBUnchanged && !srcBUnchanged.migratedTo, JSON.stringify(srcBUnchanged));

  // ---- 選択肢1: 今日やる(MIT候補に) ----
  console.log("[4] 儀式の選択肢: 今日やる → 繰り越し+MIT化");
  await seed({
    blocks: [planBlock({ id: "cb-today", date: YEST, title: "儀式テスト(今日やる)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  await page.click('[data-action="carry-over"][data-id="cb-today"]');
  await page.waitForTimeout(200);
  await page.click('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="today"]');
  await page.waitForTimeout(300);
  const sToday = await stateNow();
  const newToday = (sToday.blocks || []).find((b) => b.date === TODAY && b.title === "儀式テスト(今日やる)");
  check("carryCountが3になる", !!newToday && newToday.carryCount === 3, JSON.stringify(newToday));
  check("MIT化される", !!newToday && newToday.isMIT === true, JSON.stringify(newToday));
  check("選択ログに'today'が記録される", (sToday.migrationRitualLog || []).some((l) => l.choice === "today" && l.blockId === "cb-today"), JSON.stringify(sToday.migrationRitualLog));

  // ---- 選択肢2: 分解する(タイトル編集へ) ----
  console.log("[5] 儀式の選択肢: 分解する → 繰り越さずBlock編集モーダルが開く");
  await seed({
    blocks: [planBlock({ id: "cb-decomp", date: YEST, title: "儀式テスト(分解する)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  await page.click('[data-action="carry-over"][data-id="cb-decomp"]');
  await page.waitForTimeout(200);
  await page.click('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="decompose"]');
  await page.waitForTimeout(300);
  check("Block編集モーダルが開く(タイトル欄あり)", await page.locator('.modal-card [data-modal-field="title"]').count() === 1);
  const titleVal = await page.locator('.modal-card [data-modal-field="title"]').inputValue().catch(() => "");
  check("タイトル欄に元Blockのタイトルが入っている", titleVal === "儀式テスト(分解する)", titleVal);
  const sDecomp = await stateNow();
  const srcDecomp = (sDecomp.blocks || []).find((b) => b.id === "cb-decomp");
  check("繰り越しは実行されない(migratedTo未設定)", !!srcDecomp && !srcDecomp.migratedTo, JSON.stringify(srcDecomp));
  check("選択ログに'decompose'が記録される", (sDecomp.migrationRitualLog || []).some((l) => l.choice === "decompose" && l.blockId === "cb-decomp"));
  await page.click('[data-action="modal-close"]');
  await page.waitForTimeout(200);

  // ---- 選択肢3a: 手放す → Wishへ移動 ----
  console.log("[6] 儀式の選択肢: 手放す(Wishへ移動)");
  await seed({
    blocks: [planBlock({ id: "cb-wish", date: YEST, title: "儀式テスト(手放す・Wish)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  await page.click('[data-action="carry-over"][data-id="cb-wish"]');
  await page.waitForTimeout(200);
  page.once("dialog", (dialog) => dialog.accept());  // 「Wishへ移動しますか?」→ OK
  await page.click('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="release"]');
  await page.waitForTimeout(300);
  const sWish = await stateNow();
  const srcWish = (sWish.blocks || []).find((b) => b.id === "cb-wish");
  check("元Blockが削除扱いになる", !!srcWish && srcWish.deleted === true, JSON.stringify(srcWish));
  const wishProjectId = (sWish.projects || []).find((p) => p.kind === "wish" && !p.deleted)?.id;
  const wishTask = (sWish.tasks || []).find((t) => t.projectId === wishProjectId && t.title === "儀式テスト(手放す・Wish)");
  check("同名のWishタスクが作成される", !!wishTask, JSON.stringify(wishTask));
  check("選択ログに'release'が記録される", (sWish.migrationRitualLog || []).some((l) => l.choice === "release" && l.blockId === "cb-wish"));

  // ---- 選択肢3b: 手放す → 削除のみ(Wishへ移動をキャンセル) ----
  console.log("[7] 儀式の選択肢: 手放す(削除のみ)");
  await seed({
    blocks: [planBlock({ id: "cb-del", date: YEST, title: "儀式テスト(手放す・削除)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  await page.click('[data-action="carry-over"][data-id="cb-del"]');
  await page.waitForTimeout(200);
  page.once("dialog", (dialog) => dialog.dismiss());  // 「Wishへ移動しますか?」→ キャンセル(削除のみ)
  await page.click('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="release"]');
  await page.waitForTimeout(300);
  const sDel = await stateNow();
  const srcDel = (sDel.blocks || []).find((b) => b.id === "cb-del");
  check("元Blockが削除扱いになる", !!srcDel && srcDel.deleted === true, JSON.stringify(srcDel));
  const wishProjectId2 = (sDel.projects || []).find((p) => p.kind === "wish" && !p.deleted)?.id;
  const noWishTask = (sDel.tasks || []).find((t) => t.projectId === wishProjectId2 && t.title === "儀式テスト(手放す・削除)");
  check("Wishタスクは作られない(削除のみ)", !noWishTask, JSON.stringify(noWishTask));

  // ---- 選択肢4: それでも繰り越す ----
  console.log("[8] 儀式の選択肢: それでも繰り越す → 通常の繰り越しと同じ(MIT化なし)");
  await seed({
    blocks: [planBlock({ id: "cb-carry", date: YEST, title: "儀式テスト(それでも繰越)", startMin: 10 * 60, endMin: 10 * 60 + 30, carryCount: 2 })]
  });
  await page.click('[data-action="carry-over"][data-id="cb-carry"]');
  await page.waitForTimeout(200);
  await page.click('.migration-ritual-modal [data-action="migration-ritual-choice"][data-choice="carry"]');
  await page.waitForTimeout(300);
  const sCarry = await stateNow();
  const newCarry = (sCarry.blocks || []).find((b) => b.date === TODAY && b.title === "儀式テスト(それでも繰越)");
  check("carryCountが3になる", !!newCarry && newCarry.carryCount === 3, JSON.stringify(newCarry));
  check("MIT化はされない", !!newCarry && !newCarry.isMIT, JSON.stringify(newCarry));
  check("選択ログに'carry'が記録される", (sCarry.migrationRitualLog || []).some((l) => l.choice === "carry" && l.blockId === "cb-carry"));

  // ============================================================
  // v299: 削除した朝プラン経路を、実体不在の静的契約へ置き換える。
  // Test-Reduction: carryOverBlock経路のcarryCount/儀式は[2]〜[8]が同等以上に固定する。
  // ============================================================
  console.log("[9-10] v299: 朝プラン経路は削除済み、既存の繰越儀式は独立維持");
  check("ai-morning-plan actionが存在しない", !appSource.includes('"ai-morning-plan"'));
  check("runAiMorningPlan本体が存在しない", !/\bfunction\s+runAiMorningPlan\b/.test(appSource));
  check("carryOverBlock本体は維持", /\bfunction\s+carryOverBlock\b/.test(appSource));
  check("migration-ritual-choice actionは維持", appSource.includes('"migration-ritual-choice"'));

  // ============================================================
  // (c) 今日の理想ワンライナー: 保存・3日表示・3日目リトライ・日報反映
  // ============================================================
  // v230: home撤去に伴い「今日の理想」入力・3日リトライUIも描画対象から削除。
  // 日報への既存データ反映は[16]で引き続き検証する。
  console.log("[11-15] v230: 旧home理想UIは描画せず、既存データは保持する");
  await seed({
    journalMeta: { [TODAY]: { aiMitCandidates: [], aiImported: false, ideal: "保持される理想" } },
    view: "home"
  });
  check("旧home理想UIは描画されない",
    await page.locator('.home-ideal-text, .home-ideal-eyebrow, [data-ideal-date], [data-action="ideal-retry"]').count() === 0);
  check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
  check("journalMetaのidealは正規化後も保持される",
    (await stateNow()).journalMeta?.[TODAY]?.ideal === "保持される理想");

  console.log("[16] 今日の理想: 日報生成(generateReport)への反映");
  await seed({ journalMeta: { [TODAY]: { aiMitCandidates: [], aiImported: false, ideal: "日報反映テストの理想" } }, view: "journal" });
  await generateReportThroughGate(page);
  await page.waitForTimeout(400);
  const reportText = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
  check("日報に今日の理想が出力される", reportText.includes("日報反映テストの理想"), reportText.slice(0, 300));
  // 修正フェーズ単位11(2026-09-04、2-H1裁定): 「明日・明後日もホームに小さく残ります…3日目に
  // 続けるか手放すか」の文言は、v230のHome撤去で当該UI(3日リトライ)自体が消えて以来の
  // 虚偽記述だったため削除した。出ないことを検証する(仕様反転)。
  check("3日リトライの虚偽文言は出ない(撤去済み)", !reportText.includes("明日・明後日もホームに小さく残ります"), reportText);
  check("達成/未達の自己申告文言は含まない", !reportText.includes("達成できましたか"));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
