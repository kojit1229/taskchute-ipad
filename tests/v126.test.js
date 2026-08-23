// v126 検証: 「やりたいこと」をWBSのProject+Taskとして扱う仕様変更。
// v122で作った週次選定ベースの特別スケジュールルートは撤去し、期日駆動のWBSフローへ一本化した。
//
// (a) WBS一覧にやりたいことProjectが表示され、既存のインライン編集(期限)がそのまま効く
// (b) 期日付きWish(due<=今日)が朝の一括プランニング候補に入り、下書きに配置される
//     (通常のWBSタスクと同列で扱われ、特別なnote/rankは付かない)
// (c) 期日なしWishは候補に入らない(通常WBSタスクの「期日なし=filler」ルールはWishに適用しない)
// (d) ホームカードの「今日へ」ボタン(v121/v122のUI・state.weeklyWishes)は引き続き動く
// (e追補・v127レビュー対応) WBS上のWish Project(シングルトン)には削除ボタンが出ず、
//     data-action="delete-project"を直接発火させても関数側のガードで拒否される
// (f追補・v127レビュー対応) WBSのWish Project配下で新規タスクを作成すると期日が空のまま
//     (addWish/addWishSubtaskと同じ挙動。ユーザーが明示入力しない限り当日日付を補完しない)
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
    // (e追補) WBS上のWish Projectは削除ボタンが出ない/削除アクションが拒否される
    // ============================================================
    console.log("[1b] Wish Projectの削除ボタン非表示 + 削除ガード + 種別ロック");
    await page.click('button[data-action="edit-project"][data-id="wish-1"]');
    await page.waitForTimeout(200);
    check("Wish Projectの編集モーダルに削除ボタンが出ない", await page.locator('[data-action="modal-delete"]').count() === 0);
    check("種別プルダウンがdisabledになっている(kindを変更できない)",
      await page.locator('select[data-modal-field="kind"]').isDisabled());
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(200);

    // UIのボタン自体は消えているため、v122の二重登録ガード検証と同じ「同じdata-actionの
    // 要素を直接注入してクリック」パターンで、deleteProject関数側のガードも直接確認する
    await page.evaluate((wid) => {
      const btn = document.createElement("button");
      btn.id = "test-delete-wish-btn";
      btn.dataset.action = "delete-project";
      btn.dataset.id = wid;
      document.body.appendChild(btn);
    }, "wish-1");
    await page.click("#test-delete-wish-btn");
    await page.waitForTimeout(300);
    check("直接delete-projectアクションを発火してもトーストで拒否される",
      (await page.locator("#toast").innerText()).includes("削除できません"));
    const sAfterDeleteAttempt = await stateNow();
    const wishProjAfter = (sAfterDeleteAttempt.projects || []).find((p) => p.id === "wish-1");
    check("Wish Projectは削除されない(deletedフラグが立たない)",
      wishProjAfter && wishProjAfter.deleted === false, JSON.stringify(wishProjAfter));

    // ============================================================
    // (f追補) WBSのWish Project配下の新規タスク作成は期日が既定で空になる
    // ============================================================
    console.log("[1c] Wish Project配下の新規タスク作成では期日が既定で空になる");
    await page.click('button[data-action="add-task-to-project"][data-id="wish-1"]');
    await page.waitForTimeout(200);
    const newTaskDueInput = page.locator('input[data-modal-field="dueDate"]');
    check("新規タスク作成モーダルの期限が空で開く(Wish Project配下)", (await newTaskDueInput.inputValue()) === "");
    const NEW_WISH_TASK_TITLE = "マラソン練習計画を立てる";
    await page.locator('input[data-modal-field="title"]').fill(NEW_WISH_TASK_TITLE);
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const sAfterTaskCreate = await stateNow();
    const newWishTask = (sAfterTaskCreate.tasks || []).find((t) => t.title === NEW_WISH_TASK_TITLE);
    check("作成されたWish配下タスクの期日は空のまま(addWishと同じ挙動)",
      newWishTask && newWishTask.dueDate === "", JSON.stringify(newWishTask));
    check("作成されたタスクのprojectIdはWish Project", newWishTask && newWishTask.projectId === "wish-1", JSON.stringify(newWishTask));

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
    await page.click('[data-action="nav"][data-view="today"]');  // v230: 朝プランはATISへ移設
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
    // ============================================================
    // (c) v230: home週間Wishカード撤去
    // ============================================================
    console.log("[3] v230: 旧週間Wishカードは描画せず、既存選択は保持する");
    const HOME_WISH_TITLE = "フルマラソン完走";
    await seed({
      tasks: [makeWish({ id: "w-5", title: HOME_WISH_TITLE })],
      projects: [wishProject()],
      weeklyWishes: { [WEEK_KEY]: { taskIds: ["w-5"], updatedAt: `${TODAY}T09:00` } },
      view: "home"
    });
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
    const sHome = await stateNow();
    check("既存weeklyWishes選択は保持され、意図しないBlockを作らない",
      sHome.weeklyWishes?.[WEEK_KEY]?.taskIds?.[0] === "w-5"
      && !(sHome.blocks || []).some((b) => !b.deleted && b.taskId === "w-5" && b.date === TODAY),
      JSON.stringify({ weeklyWishes: sHome.weeklyWishes, blocks: sHome.blocks }));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
