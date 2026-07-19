// v121 検証: ホームで「今週のやりたいこと」をWishリストから選択・設定でき、
// 未設定の週は睡眠ログ風の赤帯アラートで気づける状態にする。
//
// (a) 未設定週のホームに赤帯が出る
// (b) モーダルで2件選択→保存でカード表示になり赤帯が消える
// (c) 4件目の選択が拒否される
// (d) weeklyWishesの無い旧stateでも起動できる(normalizeStateの後方互換)
// (e) 過去日表示では赤帯を出さない
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
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v117等と同じ方針)
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);

  // app.js の weekRange() (土曜起点)をテスト側でも再現し、期待する週キーを算出する
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
  function makeWish({ id, title, realized = false, deleted = false }) {
    return {
      id, projectId: "wish-1", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", selfDueOff: false, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
      realized, realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "",
      aiWork: false, aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
      criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted
    };
  }

  // 注意: 起動処理(app.js末尾)はロード毎に必ず state.selectedDate = todayISO() へ
  // 上書きするため、ここでselectedDateを直接指定しても効かない。過去日を見る場合は
  // seed後にUIの date-prev を叩く(v117テストと同じ方式)。
  async function seed({ tasks = [], projects = [], weeklyWishes = {}, view = "home" } = {}) {
    await page.evaluate(({ KEY, tasks, projects, weeklyWishes, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.weeklyWishes = weeklyWishes;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, projects, weeklyWishes, view });
    await page.reload();
    await page.waitForTimeout(400);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    const wishes = [
      makeWish({ id: "w-1", title: "京都へ旅行する" }),
      makeWish({ id: "w-2", title: "書籍を出版する" }),
      makeWish({ id: "w-3", title: "フルマラソン完走" }),
      makeWish({ id: "w-4", title: "実家をリフォーム" })
    ];

    // ============================================================
    // (a) 未設定週のホームに赤帯が出る
    // ============================================================
    console.log("[1] 未設定週: ホームに赤帯アラートが出る(カードは出ない)");
    await seed({ tasks: wishes, projects: [wishProject()], weeklyWishes: {}, view: "home" });
    check("赤帯アラートが出る", await page.locator(".home-weekly-wish-alert").count() === 1);
    check("設定するボタンが出る", await page.locator('[data-action="weekly-wish-open"]').count() === 1);
    check("カードは出ない", await page.locator(".home-weekly-wish-card").count() === 0);

    // ============================================================
    // (b) モーダルで2件選択→保存でカード表示になり赤帯が消える
    // ============================================================
    console.log("[2] モーダルで2件選択して保存 → カード表示になり赤帯が消える");
    await page.click('[data-action="weekly-wish-open"]');
    await page.waitForTimeout(200);
    check("選択肢が4件出る(未実現・未削除のトップレベルWishのみ)",
      await page.locator('input[data-wish-id]').count() === 4);
    await page.check('input[data-wish-id="w-1"]');
    await page.check('input[data-wish-id="w-2"]');
    await page.click('[data-action="weekly-wish-submit"]');
    await page.waitForTimeout(300);
    check("赤帯が消える", await page.locator(".home-weekly-wish-alert").count() === 0);
    check("カードが表示される", await page.locator(".home-weekly-wish-card").count() === 1);
    const cardText = await page.locator(".home-weekly-wish-card").innerText();
    check("選んだ2件のタイトルが出る", cardText.includes("京都へ旅行する") && cardText.includes("書籍を出版する"), cardText);
    const s2 = await stateNow();
    check("weeklyWishes[週キー].taskIdsに2件保存される",
      Array.isArray(s2.weeklyWishes?.[WEEK_KEY]?.taskIds) && s2.weeklyWishes[WEEK_KEY].taskIds.length === 2,
      JSON.stringify(s2.weeklyWishes));
    check("updatedAtも記録される", !!s2.weeklyWishes?.[WEEK_KEY]?.updatedAt, JSON.stringify(s2.weeklyWishes));

    console.log("[2b] 「変更」で再度開くと既存選択がチェック済みで開く");
    await page.click('[data-action="weekly-wish-open"]');
    await page.waitForTimeout(200);
    check("既存選択(w-1)がチェック済み", await page.locator('input[data-wish-id="w-1"]').isChecked());
    check("既存選択(w-2)がチェック済み", await page.locator('input[data-wish-id="w-2"]').isChecked());
    check("未選択(w-3)はチェックなし", !(await page.locator('input[data-wish-id="w-3"]').isChecked()));
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(200);
    check("キャンセルではstateが変わらない", (await stateNow()).weeklyWishes[WEEK_KEY].taskIds.length === 2);

    // ============================================================
    // (c) 4件目の選択が拒否される
    // ============================================================
    console.log("[3] モーダルで3件選択済みの状態から4件目をチェックすると拒否される");
    await page.click('[data-action="weekly-wish-open"]');
    await page.waitForTimeout(200);
    await page.check('input[data-wish-id="w-3"]');  // これで3件目
    check("3件目まではチェックできる", await page.locator('input[data-wish-id]:checked').count() === 3);
    await page.click('input[data-wish-id="w-4"]');  // 4件目はクリックしても拒否される
    await page.waitForTimeout(150);
    check("4件目はチェックされない(拒否)", !(await page.locator('input[data-wish-id="w-4"]').isChecked()));
    check("チェック数は3のまま", await page.locator('input[data-wish-id]:checked').count() === 3);
    check("トーストで拒否理由が出る", (await page.locator("#toast").innerText()).includes("3つまでに絞りましょう"));
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (d) weeklyWishesの無い旧stateでも起動できる
    // ============================================================
    console.log("[4] weeklyWishesフィールドが無い旧stateでも起動でき、normalizeStateが補完する");
    const failuresBefore = failures;
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.weeklyWishes;
      s.tasks = [];
      s.projects = [];
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("旧stateでも例外なく起動できる(pageerrorなし)", failures === failuresBefore);
    check("ホームのヘッダが描画される", await page.locator("h1, .header-title").count() > 0);
    const s4 = await stateNow();
    check("normalizeStateがweeklyWishesを{}で補完する",
      s4.weeklyWishes && typeof s4.weeklyWishes === "object" && Object.keys(s4.weeklyWishes).length === 0,
      JSON.stringify(s4.weeklyWishes));

    // ============================================================
    // (e) 過去日表示では赤帯を出さない
    // ============================================================
    console.log("[5] 過去日(昨日)を見ている時は未設定でも赤帯・カードとも出ない");
    await seed({ tasks: wishes, projects: [wishProject()], weeklyWishes: {}, view: "home" });
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    check("過去日では赤帯が出ない", await page.locator(".home-weekly-wish-alert").count() === 0);
    check("過去日ではカードも出ない", await page.locator(".home-weekly-wish-card").count() === 0);
    check("過去日では設定するボタンも出ない", await page.locator('[data-action="weekly-wish-open"]').count() === 0);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
