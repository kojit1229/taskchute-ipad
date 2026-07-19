// v126 検証: 「やりたいこと」をWBSのProject+Taskとして扱う仕様変更。
// v122で作った週次選定ベースの特別スケジュールルートは撤去し、期日駆動のWBSフローへ一本化した。
//
// (a) WBS一覧にやりたいことProjectが表示され、既存のインライン編集(期限)がそのまま効く
// (b) 期日付きWish(due<=今日)が朝の一括プランニング候補に入り、下書きに配置される
//     (通常のWBSタスクと同列で扱われ、特別なnote/rankは付かない)
// (c) 期日なしWishは候補に入らない(通常WBSタスクの「期日なし=filler」ルールはWishに適用しない)
// (d) ホームカードの「今日へ」ボタン(v121/v122のUI・state.weeklyWishes)は引き続き動く
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
  now0.setHours(10, 0, 0, 0);  // v59/v121/v122と同じく実行時刻依存のフレークを避けるため日中に固定
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);

  // app.js の weekRange() (土曜起点)をテスト側でも再現する(v121/v122と同じ)
  function weekStartOf(dateISO) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = (dt.getDay() + 1) % 7; // Sat=0
    dt.setDate(dt.getDate() - dow);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  const WEEK_KEY = weekStartOf(TODAY);

  const wishProject = () => ({
    id: "wish-1", kind: "wish", title: "Wish", category: "回復", status: "active",
    twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });
  function makeWish({ id, title, dueDate = "", realized = false, deleted = false }) {
    return {
      id, projectId: "wish-1", parentTaskId: "", title, category: "", status: "todo", dueDate,
      description: "", selfDueOff: false, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
      realized, realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "",
      aiWork: false, aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
      criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  function wbsTask(id, title, dueDate = "") {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate,
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }

  async function seed({ tasks = [], projects = [], blocks = [], weeklyWishes = {}, journalMeta = {}, view = "tasks" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, blocks, weeklyWishes, journalMeta, view, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = blocks;
      s.weeklyWishes = weeklyWishes;
      s.journalMeta = journalMeta;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, blocks, weeklyWishes, journalMeta, view, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function draftTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) WBS一覧にやりたいことProjectが表示され、既存のインライン編集(期限)がそのまま効く
    // ============================================================
    console.log("[1] WBSにやりたいことProjectが表示され、期限をインライン編集できる");
    const WISH_TITLE_A = "京都へ旅行する";
    const WBS_TITLE_A = "議事録作成";
    await seed({
      tasks: [makeWish({ id: "w-1", title: WISH_TITLE_A }), wbsTask("wbs-1", WBS_TITLE_A)],
      projects: [wishProject(), testProject()],
      view: "wbs"
    });

    check("WishのProjectカード(badge)がWBSに表示される", await page.locator(".badge.purple", { hasText: "Wish" }).count() === 1);
    check("Wish配下のTaskタイトルがWBSに表示される",
      await page.locator('span[data-action="edit-task"]', { hasText: WISH_TITLE_A }).count() === 1);
    check("通常ProjectのTaskタイトルも引き続き表示される",
      await page.locator('span[data-action="edit-task"]', { hasText: WBS_TITLE_A }).count() === 1);

    // インライン編集モードで、Wishタスクの期限を直接編集できる(既存のwbs-edit機構がそのまま効くこと)
    await page.click('[data-action="toggle-wbs-edit"]');
    await page.waitForTimeout(300);
    const wishDueInput = page.locator('input[data-wbs-edit="dueDate"][data-id="w-1"]');
    check("Wishタスクにも期限のインライン入力が出る", await wishDueInput.count() === 1);
    await wishDueInput.fill(TODAY);
    await wishDueInput.dispatchEvent("change");
    await page.waitForTimeout(300);
    const sAfterEdit = await stateNow();
    const wishAfterEdit = (sAfterEdit.tasks || []).find((t) => t.id === "w-1");
    check("Wishタスクの期限がモーダルなしで保存される", wishAfterEdit && wishAfterEdit.dueDate === TODAY, JSON.stringify(wishAfterEdit));

    // ============================================================
    // (b)(c) 朝の一括プランニング候補: 期日付きWishは通常WBSタスクと同列で候補に入り配置される。
    //         期日なしWishは候補に入らない。
    // ============================================================
    console.log("[2] 朝の一括プランニング候補: 期日付きWishのみ候補に入る");
    const DUE_WISH_TITLE = "資格試験に合格する";
    const NO_DUE_WISH_TITLE = "書籍を出版する";
    const WBS_TITLE_B = "見積書を作成する";
    await seed({
      tasks: [
        makeWish({ id: "w-2", title: DUE_WISH_TITLE, dueDate: TODAY }),
        makeWish({ id: "w-3", title: NO_DUE_WISH_TITLE, dueDate: "" }),
        wbsTask("wbs-2", WBS_TITLE_B, TODAY)
      ],
      projects: [wishProject(), testProject()],
      view: "tasks"
    });
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(600);

    const titlesB = await draftTitles();
    const titlesBJoined = titlesB.join(" / ");
    check("期日付きWishが下書きに配置される", titlesBJoined.includes(DUE_WISH_TITLE), titlesBJoined);
    check("通常WBSタスクも引き続き下書きに配置される", titlesBJoined.includes(WBS_TITLE_B), titlesBJoined);
    check("期日なしWishは候補に入らない(下書きに現れない)", !titlesBJoined.includes(NO_DUE_WISH_TITLE), titlesBJoined);

    await page.click('[data-action="draft-discard"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (d) ホームカードの「今日へ」で今日のBlockが作られる(v121/v122のUIは無変更で存続)
    // ============================================================
    console.log("[3] ホームカード(今週のやりたいこと)の「今日へ」ボタン");
    const HOME_WISH_TITLE = "フルマラソン完走";
    await seed({
      tasks: [makeWish({ id: "w-5", title: HOME_WISH_TITLE })],
      projects: [wishProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-5"], updatedAt: `${TODAY}T09:00` } },
      view: "home"
    });

    const wishRow = page.locator(".home-weekly-wish-card li", { hasText: HOME_WISH_TITLE });
    check("未Block時は「今日へ」ボタンが出る", await wishRow.locator('[data-action="wish-subtask-to-tasks"]').count() === 1);

    await wishRow.locator('[data-action="wish-subtask-to-tasks"]').click();
    await page.waitForTimeout(300);
    check("登録トーストが出る", (await page.locator("#toast").innerText()).includes("今日のタスクシュートに登録しました"));

    const sHome = await stateNow();
    const newBlock = (sHome.blocks || []).find((b) => !b.deleted && b.taskId === "w-5" && b.date === TODAY);
    check("今日のBlockが作られる", !!newBlock, JSON.stringify(sHome.blocks));

    const wishRowAfter = page.locator(".home-weekly-wish-card li", { hasText: HOME_WISH_TITLE });
    check("Block化後はボタンが消え「済」表示になる",
      await wishRowAfter.locator('[data-action="wish-subtask-to-tasks"]').count() === 0
      && (await wishRowAfter.innerText()).includes("済"));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
