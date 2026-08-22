// v82 検証: UX監査(workbench/out/2026-07-12-ux-audit/findings.md)の「B. K判断が必要」のうち
// K承認済みの B1/B2/B3 に対応。CHANGES_v82.md参照。
//   B1: bottom-nav(mobileNav)の入替。WBSを「その他」へ降ろし、ジャーナルを5枠に昇格
//       (ホーム/ジャーナル/実行/時間/その他)。朝の体調記録(ホーム→ジャーナル)を1タップにする。
//   B2: 「今日のリズム」ゾーン(ながれ)を折りたたみにし、集計値
//       (ながれ完了数)をsummary行に要約表示する。v73縮退モードの
//       zone2-degradedとは独立foldId(zone2 / zone2-degraded)で共存させる。
//       (注: 既定open/closedはv82時点は既定closedだったが、v146(CHANGES_v146.md)で
//       行動優先の並び替えとあわせて既定openへ反転した。本ファイルはv146仕様に追従済み)
//   B3: ホーム常時表示を「いま、これ/MIT/タスクシュート」に絞り、読書カード・スコアボードを
//       既定closedの折りたたみへ(既に折りたたみ済みの長い弧zone3/足あとzone4は既存どおり)。
//       読書カードは書名+記入状況をsummaryに出す。
//       (注: 信条・寿命・AIからはv82時点では常時表示だったが、v146で参照系として
//       既定closedの折りたたみへ移動した。本ファイルはv146仕様に追従済み)
//
// 主端末=iPhone縦持ち(幅390px)想定のviewportで検証する(bottom-navの検証に必須)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const FOLD_KEY = "taskchute-journal-home-fold-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(9, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 30, category = "", isMIT = false, completed = false, taskId = "" } = {}) {
    return {
      id, taskId, date: TODAY, title, category,
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: completed ? `${TODAY}T${hhmm(startMin)}` : "",
      actualEndAt: completed ? `${TODAY}T${hhmm(startMin + minutes)}` : "",
      completed, charge: 0, discharge: 0, isMIT,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, interruptions: [],
      migratedTo: "", orderIndex: 0, carryCount: 0, leverageType: "", estimateMin: null,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }

  // v82-proj / v82-task: homeTaskchute(タスクシュート)にBlockを出すにはProjectに紐づくTaskが要る
  // (taskchuteBlocks: taskId必須+紐づくtaskにprojectIdが必要)。[4]でのみ使う。
  const V82_PROJECT = {
    id: "v82-proj", kind: "normal", title: "v82テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`,
    updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false
  };
  const V82_TASK = {
    id: "v82-task", projectId: "v82-proj", parentTaskId: "", title: "v82テストタスク",
    category: "", status: "todo", dueDate: "", description: "",
    createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  };

  async function seed({ blocks = [], view = "home", morningEnergyLog, extraTasks = [], extraProjects = [] } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, morningEnergyLog, extraTasks, extraProjects }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = extraTasks;
      s.projects = [...(s.projects || []), ...extraProjects];
      s.questions = [];
      s.feedback = {};
      s.settings.morningEnergyLog = morningEnergyLog || {};
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, morningEnergyLog, extraTasks, extraProjects });
    await page.reload();
    await page.waitForTimeout(500);
  }
  async function foldMap() {
    return page.evaluate((FOLD_KEY) => JSON.parse(localStorage.getItem(FOLD_KEY) || "{}"), FOLD_KEY);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) B1: bottom-navの入替
    // ============================================================
    console.log("[1] B1: bottom-navが 今日/ジャーナル/実行/時間/その他 の並びになっている");
    await seed({ blocks: [], view: "home" });
    const bottomLabels = await page.locator("#bottomNav button").allTextContents();
    // v182 D2: mobileNav先頭差替え/moreGroups計画群へhome追加
    check("bottom-navの並びがv182仕様", JSON.stringify(bottomLabels) === JSON.stringify(["今日", "ジャーナル", "実行", "時間", "その他"]), JSON.stringify(bottomLabels));

    console.log("[1b] ホームからジャーナルへ1タップで遷移できる(朝の体調記録の日課動線)");
    await page.click('#bottomNav button[data-view="journal"]');
    await page.waitForTimeout(300);
    const viewAfterTap = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY);
    check("1タップでcurrentViewがjournalになる", viewAfterTap === "journal", viewAfterTap);

    console.log("[1c] 「その他」はv233の8項目で、削除済みhomeや主要4タブを重複表示しない");
    await seed({ blocks: [], view: "more" });
    const moreGridText = await page.locator(".more-tower-grid").textContent();
    check("WBSが「その他」に出る", moreGridText.includes("WBS"), moreGridText);
    check("ジャーナルは「その他」に出ない(bottom-navへ移動済み)", !moreGridText.includes("ジャーナル"), moreGridText);
    const moreDataViews = await page.locator('.more-tower-grid [data-action="nav"]').evaluateAll((els) => els.map((el) => el.dataset.view));
    check("「その他」の受け皿にwbsが含まれる", moreDataViews.includes("wbs"), JSON.stringify(moreDataViews));
    // v230でhome撤去、v233でinstruments/iron-log追加。
    check("「その他」は現行8項目の順序と一致する",
      moreDataViews.join(",") === "wbs,wish,vision,zero,ai-reports,instruments,iron-log,settings",
      JSON.stringify(moreDataViews));
    check("削除済みhomeと主要4タブは「その他」に重複しない",
      !moreDataViews.includes("home") && !moreDataViews.includes("journal")
      && !moreDataViews.includes("tasks") && !moreDataViews.includes("timeline"), JSON.stringify(moreDataViews));

    // v230: home描画コードごと撤去。移設先のない折りたたみ/縮退UIは不存在を固定し、
    // 現行同等の統合起点(TOWER/ATIS)が描画されることを肯定検証する。
    console.log("[2] v230: home専用ゾーン・縮退バナーは描画されず、TOWER/ATISへ一本化される");
    await seed({ blocks: [planBlock({ id: "flow-now", title: "現行便", startMin: 9 * 60 })], view: "today" });
    check("削除済みhomeナビが無い", await page.locator('[data-action="nav"][data-view="home"]').count() === 0);
    check("homeタブバーが無い", await page.locator(".home-tabbar").count() === 0);
    check("旧homeゾーン(zone2/zone2-degraded/homezone-1)が無い",
      await page.locator('[data-fold-id="zone2"], [data-fold-id="zone2-degraded"], #homezone-1').count() === 0);
    check("縮退モードバナーが無い", await page.locator(".cond-degraded-banner").count() === 0);
    check("現行todayはTOWERを描画する", await page.locator(".today-tower").count() === 1);
    check("AI導線の移設先ATISを描画する", await page.locator(".sec-atis").count() === 1);

    console.log(failures === 0 ? "\n✅ v82 ALL PASS" : `\n❌ v82: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
