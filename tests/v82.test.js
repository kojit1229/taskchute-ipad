// v82 検証: UX監査(workbench/out/2026-07-12-ux-audit/findings.md)の「B. K判断が必要」のうち
// K承認済みの B1/B2/B3 に対応。CHANGES_v82.md参照。
//   B1: bottom-nav(mobileNav)の入替。WBSを「その他」へ降ろし、ジャーナルを5枠に昇格
//       (ホーム/ジャーナル/実行/時間/その他)。朝の体調記録(ホーム→ジャーナル)を1タップにする。
//   B2: 「今日のリズム」ゾーン(ながれ+ルーティン)を折りたたみにし、集計値
//       (ながれ完了数・ルーティン実行率)をsummary行に要約表示する。v73縮退モードの
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
    console.log("[1] B1: bottom-navが ホーム/ジャーナル/実行/時間/その他 の並びになっている");
    await seed({ blocks: [], view: "home" });
    const bottomLabels = await page.locator("#bottomNav button").allTextContents();
    check("bottom-navの並びがv82仕様", JSON.stringify(bottomLabels) === JSON.stringify(["ホーム", "ジャーナル", "実行", "時間", "その他"]), JSON.stringify(bottomLabels));

    console.log("[1b] ホームからジャーナルへ1タップで遷移できる(朝の体調記録の日課動線)");
    await page.click('#bottomNav button[data-view="journal"]');
    await page.waitForTimeout(300);
    const viewAfterTap = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY);
    check("1タップでcurrentViewがjournalになる", viewAfterTap === "journal", viewAfterTap);

    console.log("[1c] 「その他」画面にWBSが受け皿として出る。ホーム/ジャーナル/実行/時間は「その他」に出ない");
    await seed({ blocks: [], view: "more" });
    const moreLabels = await page.locator("main section.grid button strong").allTextContents();
    check("WBSが「その他」に出る", moreLabels.includes("WBS"), JSON.stringify(moreLabels));
    check("ジャーナルは「その他」に出ない(bottom-navへ移動済み)", !moreLabels.includes("ジャーナル"), JSON.stringify(moreLabels));
    const moreDataViews = await page.locator('main [data-action="nav"]').evaluateAll((els) => els.map((el) => el.dataset.view));
    check("「その他」の受け皿にwbsが含まれる", moreDataViews.includes("wbs"), JSON.stringify(moreDataViews));
    check("「その他」の受け皿にhome/journal/tasks/timelineは含まれない",
      !moreDataViews.includes("home") && !moreDataViews.includes("journal") && !moreDataViews.includes("tasks") && !moreDataViews.includes("timeline"),
      JSON.stringify(moreDataViews));

    // ============================================================
    // (b) B2: 「今日のリズム」ゾーンの既定折りたたみ + summary集計
    // ============================================================
    console.log("[2] B2(通常時): 「今日のリズム」(ながれ+ルーティン)は既定open(v146)。summaryに集計値が出る");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({
      blocks: [
        planBlock({ id: "flow-1", title: "ながれ1", startMin: 9 * 60, completed: true }),
        planBlock({ id: "flow-2", title: "ながれ2", startMin: 10 * 60, completed: false }),
        planBlock({ id: "rt-1", title: "ルーティン1", startMin: 7 * 60, category: "ルーティン", completed: true }),
        planBlock({ id: "rt-2", title: "ルーティン2", startMin: 7 * 60 + 30, category: "ルーティン", completed: false })
      ],
      view: "home"
    });
    const zone2 = page.locator('details[data-fold-id="zone2"]');
    check("zone2(今日のリズム)が描画されている", await zone2.count() === 1);
    check("zone2は既定open(v146)", await zone2.evaluate((el) => el.open) === true);
    check("zone2-degradedは通常時には存在しない(独立foldIdで排他)", await page.locator('details[data-fold-id="zone2-degraded"]').count() === 0);
    const zone2Summary = await zone2.locator("summary").textContent();
    check("summaryに「ながれ 1/2」の集計が出る", zone2Summary.includes("ながれ 1/2"), zone2Summary);
    check("summaryに「ルーティン実行 50%(1/2)」の集計が出る", zone2Summary.includes("ルーティン実行 50%(1/2)"), zone2Summary);
    check("既定openなので本文(ながれ2)が最初から見える", await zone2.locator("text=ながれ2").isVisible());

    await zone2.locator("summary").click();
    await page.waitForTimeout(150);
    check("タップで閉じる", await zone2.evaluate((el) => el.open) === false);
    check("閉じると本文(ながれ2)が見えなくなる", !(await zone2.locator("text=ながれ2").isVisible()));
    const fm1 = await foldMap();
    check("開閉状態がlocalStorageに記憶される(zone2:false)", fm1.zone2 === false, JSON.stringify(fm1));

    console.log("[2b] リロード後も閉じた状態が保たれる(一度閉じたセクションは既定値を上書きしない)");
    await page.reload();
    await page.waitForTimeout(400);
    check("リロード後もzone2は閉じたまま", await page.locator('details[data-fold-id="zone2"]').evaluate((el) => el.open) === false);

    console.log("[3] B2(縮退時): zone2-degradedも既定closedで、独立してsummary集計を持つ(zone2とは別foldId)");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({
      blocks: [
        planBlock({ id: "flow-1d", title: "縮退ながれ1", startMin: 9 * 60, completed: true }),
        planBlock({ id: "rt-1d", title: "縮退ルーティン1", startMin: 7 * 60, category: "ルーティン", completed: true })
      ],
      view: "home",
      morningEnergyLog: { [TODAY]: 3 }
    });
    check("縮退モードの案内バナーが出る", await page.locator(".cond-degraded-banner").count() === 1);
    const zone2d = page.locator('details[data-fold-id="zone2-degraded"]');
    check("zone2-degradedが描画されている", await zone2d.count() === 1);
    check("zone2(非縮退用foldId)は縮退時には存在しない", await page.locator('details[data-fold-id="zone2"]').count() === 0);
    check("zone2-degradedは既定closed", await zone2d.evaluate((el) => el.open) === false);
    const zone2dSummary = await zone2d.locator("summary").textContent();
    check("縮退時summaryにも集計値が出る", zone2dSummary.includes("ながれ 1/1") && zone2dSummary.includes("ルーティン実行 100%(1/1)"), zone2dSummary);

    // ============================================================
    // (c) B3: ホーム常時表示のスリム化
    // ============================================================
    console.log("[4] B3: 初期表示(何も開かない状態)でいま、これ/MIT/タスクシュートが見える。信条/寿命/AIからは参照系(既定closed、v146)");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({
      blocks: [
        planBlock({ id: "mit-slim", title: "スリム化確認MIT", startMin: 8 * 60, isMIT: true }),
        planBlock({ id: "tc-slim", title: "スリム化確認タスクシュート", startMin: 9 * 60, taskId: "v82-task" })
      ],
      view: "home",
      extraProjects: [V82_PROJECT],
      extraTasks: [V82_TASK]
    });
    // v146(UI改善計画Phase1-1): 信条/寿命/AIからは行動優先の並び替えで参照系(既定closed)へ
    // 移動した(v82時点は常時表示だった)。
    check("信条(creed)は既定closed(v146)", await page.locator('details[data-fold-id="creed"]').evaluate((el) => el.open) === false);
    check("寿命(lifespan)は既定closed(v146)", await page.locator('details[data-fold-id="lifespan"]').evaluate((el) => el.open) === false);
    const heroText = await page.locator("main").textContent();
    check("「いま、これ」(hero)は折りたたみ無しで常時表示", heroText.includes("いま、これ"));
    check("MITは常時表示(#home-mit-anchor)", (await page.locator("#home-mit-anchor").textContent()).includes("スリム化確認MIT"));
    check("AIから(home-ai-hub)は既定closedの折りたたみ(v146)",
      await page.locator("details.home-ai-hub").count() === 1
      && await page.locator("details.home-ai-hub").evaluate((el) => el.open) === false);
    check("タスクシュート(homezone-1)は折りたたみ無しで常時表示",
      (await page.locator("#homezone-1").textContent()).includes("スリム化確認タスクシュート")
      && await page.locator("#homezone-1 details").count() === 0);

    console.log("[5] B3: スコアボード・読書カードは既定closedの折りたたみ(常時表示から除外)");
    const scoreboardFold = page.locator('details[data-fold-id="home-scoreboard"]');
    check("スコアボードがdetailsとして描画されている", await scoreboardFold.count() === 1);
    check("スコアボードは既定closed", await scoreboardFold.evaluate((el) => el.open) === false);
    const scoreboardSummary = await scoreboardFold.locator("summary").textContent();
    check("スコアボードのsummaryに集計値が出る(着手/主役/ルーティン/12週)", /着手\d+%/.test(scoreboardSummary) && scoreboardSummary.includes("主役"), scoreboardSummary);
    check("既存の長い弧(zone3)・足あと(zone4)は既定closedのまま(既存仕様を維持)",
      await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open) === false
      && await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open) === false);

    console.log("[6] B3: スコアボードからのジャンプは、閉じているzone2(今日のリズム)も自動的に開く");
    // v146: zone2は既定openになったため(この時点でFOLD_KEYはクリア済みで新規なので開いている)、
    // まずユーザーが閉じた状態を作ってからジャンプの自動オープン挙動そのものを検証する
    // (home-jumpの挙動自体は無変更)。
    await page.locator('details[data-fold-id="zone2"] summary').click();
    await page.waitForTimeout(150);
    check("検証のため一旦zone2を閉じる", await page.locator('details[data-fold-id="zone2"]').evaluate((el) => el.open) === false);
    await scoreboardFold.locator("summary").click();
    await page.waitForTimeout(150);
    check("スコアボードを開くとルーティンのジャンプ先セルが見える", await page.locator('.home-score[data-id="homezone-2"]').isVisible());
    check("zone2はこの時点でまだclosed", await page.locator('details[data-fold-id="zone2"]').evaluate((el) => el.open) === false);
    await page.click('.home-score[data-id="homezone-2"]');
    await page.waitForTimeout(300);
    check("ジャンプでzone2(今日のリズム)が自動的に開く", await page.locator('details[data-fold-id="zone2"]').evaluate((el) => el.open));

    console.log(failures === 0 ? "\n✅ v82 ALL PASS" : `\n❌ v82: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
