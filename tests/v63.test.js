// v63 検証: 週次レビューの「絞り込み」を数字で支援する(ROADMAP v63、提案2・提案6)。
//
// (a) WIP上限アラート(提案2): Projectの優先度フィールド(高/中/低)の編集モーダル保存、
//     normalizeState 後方互換(旧Projectにpriorityが無くても「中」で補完)、
//     アクティブ(status=active・kind=normal)なProjectが3件では非表示・4件で表示されるバナー、
//     wish/other/paused/kind違いはカウントから除外、バナーの「保留」ワンタップ導線
// (b) 戦略/雑用/休息ゲージ(提案6): カテゴリ管理のバケット属性(戦略/雑用/休息)の保存、
//     normalizeState 後方互換(旧カテゴリにbucketが無くても""で補完)、
//     週次レビュータブの3バケットゲージの集計精度(時間・%)、完了Blockが無い週の空表示、
//     週送り(◀前週/次週▶)でゲージの集計対象が選択中の週に追従すること
//
// 方針: 既存スイート(v61/v62)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4203;
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
  now0.setHours(10, 0, 0, 0);  // 空き時間依存の他スイートと同じ理由で日中に固定
  const TODAY = isoDate(now0);

  function addDaysISO(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return isoDate(dt);
  }
  // app.js の weekRange() と同じロジック(週開始=直近土曜)をNode側でも再現する
  function weekStartOf(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 1) % 7; // Sat=0 ... Fri=6
    date.setDate(date.getDate() - dow);
    return isoDate(date);
  }
  const WEEK = weekStartOf(TODAY);
  const PREV_WEEK = addDaysISO(WEEK, -7);

  // app.js の fmtMinShort() と同じロジック(ゲージ凡例の期待値をそこから生成する)
  function fmtMinShort(m) {
    if (!m) return "0m";
    const h = Math.floor(m / 60);
    return h ? `${h}h${m % 60 ? `${m % 60}m` : ""}` : `${m}m`;
  }
  const pct = (min, total) => Math.round((min / total) * 100);

  function testProject(id, title, { status = "active", kind = "normal", priority } = {}) {
    return {
      id, kind, title, category: "", status,
      ...(priority !== undefined ? { priority } : {}),
      description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false, collapsed: false
    };
  }
  function completedBlock({ id, date, title, category, startMin, endMin }) {
    return {
      id, taskId: "", date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`, plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: `${date}T${hhmm(startMin)}`, actualEndAt: `${date}T${hhmm(endMin)}`,
      completed: true, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }
  function plannedOnlyBlock({ id, date, title, startMin, endMin }) {
    return {
      id, taskId: "", date, title, category: "",
      plannedStartAt: `${date}T${hhmm(startMin)}`, plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }
  const testCategories = () => [
    { id: "cat-strategy", name: "戦略カテゴリ", color: "#007AFF", bucket: "strategy" },
    { id: "cat-chore", name: "雑用カテゴリ", color: "#FF9500", bucket: "chore" },
    { id: "cat-rest", name: "休息カテゴリ", color: "#34C759", bucket: "rest" },
    { id: "cat-none", name: "未分類カテゴリ", color: "#8E8E93", bucket: "" }
  ];

  async function seed({ blocks = [], tasks = [], projects = [], categories = null, weeklySelectedWeek = null, view = "wbs" } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, categories, weeklySelectedWeek, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      if (categories) s.settings.categories = categories;
      s.settings.weeklySelectedWeek = weeklySelectedWeek;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, categories, weeklySelectedWeek, TODAY, view });
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
    // (a) normalizeState 後方互換: 旧Project(priorityフィールド無し)に「中」が補完される
    // ============================================================
    console.log("[1] normalizeState 後方互換: 旧Project(priority無し)→「中」補完");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = [{
        id: "legacy-proj", kind: "normal", title: "旧データProject", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
        deleted: false
        // priority フィールドなし(旧データを模擬)
      }];
      s.tasks = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="home"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const normalized1 = await stateNow();
    const legacyProj = (normalized1.projects || []).find((p) => p.id === "legacy-proj");
    check("旧Projectにpriority:'中'が補完される", !!legacyProj && legacyProj.priority === "中", JSON.stringify(legacyProj));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);

    // ============================================================
    // (b) normalizeState 後方互換: 旧カテゴリ(bucketフィールド無し)に""が補完される
    // ============================================================
    console.log("[2] normalizeState 後方互換: 旧カテゴリ(bucket無し)→\"\"補完");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.categories = [{ id: "legacy-cat", name: "旧データカテゴリ", color: "#007AFF" }];  // bucketフィールドなし
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    const normalized2 = await stateNow();
    const legacyCat = (normalized2.settings.categories || []).find((c) => c.id === "legacy-cat");
    check("旧カテゴリにbucket:''が補完される", !!legacyCat && legacyCat.bucket === "", JSON.stringify(legacyCat));

    // ============================================================
    // (a) Project優先度の編集モーダル保存
    // ============================================================
    console.log("[3] Project編集モーダルで優先度(高/中/低)を保存できる");
    await seed({ projects: [testProject("proj-pri", "優先度テストProject")] });
    await page.click('button[data-action="edit-project"][data-id="proj-pri"]');
    await page.waitForTimeout(200);
    check("優先度selectが表示される", await page.locator('.modal-card [data-modal-field="priority"]').count() === 1);
    const defaultPriority = await page.locator('.modal-card [data-modal-field="priority"]').inputValue();
    check("既定値は「中」", defaultPriority === "中", defaultPriority);
    await page.selectOption('.modal-card [data-modal-field="priority"]', "高");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const savedProj = (s3.projects || []).find((p) => p.id === "proj-pri");
    check("優先度「高」が保存される", !!savedProj && savedProj.priority === "高", JSON.stringify(savedProj));

    // ============================================================
    // (a) WIPバナー: 3件では非表示・4件で表示。wish/other/paused/kind違いは対象外。
    // ============================================================
    console.log("[4] WIPバナー: アクティブなkind=normal Projectが3件では非表示");
    await seed({
      projects: [
        testProject("p1", "案件A"),
        testProject("p2", "案件B"),
        testProject("p3", "案件C"),
        testProject("p4", "中断中の案件", { status: "paused" }),   // 中断中は対象外
        testProject("p5", "やりたいこと", { kind: "wish" })         // Wishは対象外
      ]
    });
    check("バナーが表示されない(3件)", await page.locator(".wip-banner").count() === 0);

    console.log("[5] WIPバナー: アクティブなkind=normal Projectが4件で表示される");
    await seed({
      projects: [
        testProject("p1", "案件A"),
        testProject("p2", "案件B"),
        testProject("p3", "案件C"),
        testProject("p4", "案件D")
      ]
    });
    check("バナーが表示される(4件)", await page.locator(".wip-banner").count() === 1);
    const bannerMsg = await page.locator(".wip-banner-msg").textContent();
    check("バナーに件数と原則の文言が入る", bannerMsg.includes("4件") && bannerMsg.includes("3件まで"), bannerMsg);
    const bannerBg = await page.locator(".wip-banner").evaluate((el) => getComputedStyle(el).backgroundColor);
    check("警告色(赤系)ではなくアクセント(青系)トーンを使っている", bannerBg.includes("0, 122, 255"), bannerBg);
    check("4件それぞれに保留ボタンがある", await page.locator(".wip-banner-row").count() === 4);

    console.log("[6] WIPバナー: 「保留」ワンタップでstatus=pausedになり、3件に減れば非表示になる");
    await page.locator('.wip-banner-row:has-text("案件D") button[data-action="suspend-project"]').click();
    await page.waitForTimeout(300);
    const s6 = await stateNow();
    const pausedProj = (s6.projects || []).find((p) => p.id === "p4");
    check("対象Projectがstatus:pausedになる", !!pausedProj && pausedProj.status === "paused", JSON.stringify(pausedProj));
    check("3件に減るとバナーが消える", await page.locator(".wip-banner").count() === 0);

    // ============================================================
    // (b) カテゴリ管理: バケット(戦略/雑用/休息)の選択保存
    // ============================================================
    console.log("[7] カテゴリ管理: バケットselectで戦略/雑用/休息を選択→保存できる");
    await seed({ categories: testCategories().map((c) => ({ ...c, bucket: "" })), view: "settings" });
    await page.selectOption('select[data-cat-id="cat-strategy"][data-cat-field="bucket"]', "strategy");
    await page.waitForTimeout(200);
    const s7 = await stateNow();
    const catStrategy = (s7.settings.categories || []).find((c) => c.id === "cat-strategy");
    check("バケット「戦略」が保存される", !!catStrategy && catStrategy.bucket === "strategy", JSON.stringify(catStrategy));

    // ============================================================
    // (b) 週次レビュー: 3バケットゲージの集計精度
    // ============================================================
    console.log("[8] 週次レビュー: 戦略/雑用/休息/未分類ゲージが正しい時間・%を表示する");
    // 戦略40分・雑用30分・休息20分・未分類(bucket未設定カテゴリ)10分 = 合計100分(綺麗な%になる組み合わせ)
    await seed({
      categories: testCategories(),
      blocks: [
        completedBlock({ id: "b-strategy", date: WEEK, title: "戦略Block", category: "戦略カテゴリ", startMin: 9 * 60, endMin: 9 * 60 + 40 }),
        completedBlock({ id: "b-chore", date: WEEK, title: "雑用Block", category: "雑用カテゴリ", startMin: 10 * 60, endMin: 10 * 60 + 30 }),
        completedBlock({ id: "b-rest", date: WEEK, title: "休息Block", category: "休息カテゴリ", startMin: 11 * 60, endMin: 11 * 60 + 20 }),
        completedBlock({ id: "b-none", date: WEEK, title: "未分類Block", category: "未分類カテゴリ", startMin: 12 * 60, endMin: 12 * 60 + 10 })
      ],
      weeklySelectedWeek: WEEK,
      view: "weekly"
    });
    check("「戦略 / 雑用 / 休息 配分」セクションが表示される", await page.locator('.weekly-sec h3:has-text("戦略 / 雑用 / 休息 配分")').count() === 1);
    const gaugeText = await page.locator(".bucket-gauge").textContent();
    check(`戦略: ${fmtMinShort(40)} ・ ${pct(40, 100)}% が表示される`, gaugeText.includes(fmtMinShort(40)) && gaugeText.includes(`${pct(40, 100)}%`), gaugeText);
    check(`雑用: ${fmtMinShort(30)} ・ ${pct(30, 100)}% が表示される`, gaugeText.includes(fmtMinShort(30)) && gaugeText.includes(`${pct(30, 100)}%`), gaugeText);
    check(`休息: ${fmtMinShort(20)} ・ ${pct(20, 100)}% が表示される`, gaugeText.includes(fmtMinShort(20)) && gaugeText.includes(`${pct(20, 100)}%`), gaugeText);
    check(`未分類: ${fmtMinShort(10)} ・ ${pct(10, 100)}% が表示される`, gaugeText.includes("未分類") && gaugeText.includes(fmtMinShort(10)) && gaugeText.includes(`${pct(10, 100)}%`), gaugeText);
    check("目標値の入力欄は無い(現実を見る道具に徹する)", await page.locator('.weekly-sec:has(.bucket-gauge) input').count() === 0);
    const segCount = await page.locator(".bucket-gauge-seg").count();
    check("4バケット分のセグメントが描画される", segCount === 4, String(segCount));

    console.log("[9] 週次レビュー: 完了Blockが無い週は「記録がありません」表示になる(週自体は記録扱い)");
    await seed({
      categories: testCategories(),
      blocks: [plannedOnlyBlock({ id: "b-planned", date: WEEK, title: "未完了Block", startMin: 9 * 60, endMin: 9 * 60 + 30 })],
      weeklySelectedWeek: WEEK,
      view: "weekly"
    });
    check("週次レビュー本体は表示される(記録ゼロ扱いにならない)", await page.locator('.weekly-sec h3:has-text("実行スコア")').count() === 1);
    const emptyGaugeText = await page.locator(".weekly-sec:has(h3:has-text('戦略 / 雑用 / 休息 配分'))").textContent();
    check("ゲージ部分は「記録がありません」表示になる", emptyGaugeText.includes("記録がありません"), emptyGaugeText);
    check("完了Blockが無いのでセグメントは描画されない", await page.locator(".bucket-gauge-seg").count() === 0);

    // ============================================================
    // (b) 週送り(◀前週/次週▶)でゲージの集計対象が選択中の週に追従する
    // ============================================================
    console.log("[10] 週次レビュー: ◀前週でゲージの集計対象が前週のBlockに切り替わる");
    await seed({
      categories: testCategories(),
      blocks: [
        completedBlock({ id: "b-this-week", date: WEEK, title: "今週戦略Block", category: "戦略カテゴリ", startMin: 9 * 60, endMin: 9 * 60 + 60 }),
        completedBlock({ id: "b-prev-week", date: PREV_WEEK, title: "前週休息Block", category: "休息カテゴリ", startMin: 9 * 60, endMin: 9 * 60 + 45 })
      ],
      weeklySelectedWeek: WEEK,
      view: "weekly"
    });
    const thisWeekGauge = await page.locator(".bucket-gauge").textContent();
    check("今週は戦略60分(100%)のみ", thisWeekGauge.includes(fmtMinShort(60)) && thisWeekGauge.includes("100%") && !thisWeekGauge.includes(fmtMinShort(45)), thisWeekGauge);
    await page.click('[data-action="weekly-prev"]');
    await page.waitForTimeout(300);
    const prevWeekGauge = await page.locator(".bucket-gauge").textContent();
    check("◀前週で休息45分(100%)に切り替わる", prevWeekGauge.includes(fmtMinShort(45)) && prevWeekGauge.includes("100%") && !prevWeekGauge.includes(fmtMinShort(60)), prevWeekGauge);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
