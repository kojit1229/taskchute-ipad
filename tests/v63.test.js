// v63 検証: WIP上限アラート(Project優先度)の表示・操作。
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
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 空き時間依存の他スイートと同じ理由で日中に固定
  const TODAY = isoDate(now0);

  function testProject(id, title, { status = "active", kind = "normal", priority } = {}) {
    return {
      id, kind, title, category: "", status,
      ...(priority !== undefined ? { priority } : {}),
      description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false, collapsed: false
    };
  }
  async function seed({ blocks = [], tasks = [], projects = [], view = "wbs" } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view });
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

  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
