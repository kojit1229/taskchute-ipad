// v146 検証: UI改善計画Phase1(毎日の摩擦を消す)。CHANGES_v146.md参照。
// 入力: workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md(承認済み計画)。
//
// (1) ホーム折りたたみ既定値: 信条/寿命/AIからは既定closed(参照系)、今日のリズム(zone2、
//     非縮退時)は既定open。長い弧(zone3)/足あと(zone4)は既定closedのまま(既存仕様維持)
// (2) ホームの並び順: いま、これ→今日の主役(MIT)→今日、すすめる→今日のリズム→
//     参照系(信条/寿命/AIから/スコアボード)→長い弧→足あと
// (3) ホームは着手中(無ければ次の未着手)Blockへレンダー後自動スクロールする。
//     検索入力にフォーカス中は発火しない
// (4) タスクシュートも同様に自動スクロールする
// (5) 🏁(タスク完了)はタスクシュート行から撤去され、Block編集モーダルへ移設されている
//     (詳細な状態遷移の回帰はtests/v107.test.jsが担当。本ファイルは配置のみ確認)
// (6) 誤タップ対策の44px当たり判定: .checkbox-button / .tl-start-btn / .modal-close
// (7) バッファ残量帯は「今日を扱う」画面(home/tasks/timeline/journal)だけに出る
// (8) ジャーナルは720px以下で当日編集パネルが先頭(CSS order)。前日パネルは既定closedのdetails
// (9) 設定画面から内部バージョン表記(vNNN)が消え、「現在のファイル構成」はdetails化(既定closed)
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 30, taskId = "", category = "", completed = false }) {
    return {
      id, taskId, date: TODAY, title, category,
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "v146-proj", kind: "normal", title: "v146テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v146-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({ blocks = [], tasks = [], projects = [], view = "home", settings = {} } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      Object.assign(s.settings, settings);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function mainHTML() {
    return page.evaluate(() => document.querySelector("#main")?.innerHTML || "");
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) ホーム折りたたみ既定値
    // v149(UI改善計画Phase4a)追補: ホームが「今日」/「ホーム」の2タブに分割され、信条/寿命/
    // AIから/長い弧は「ホーム」タブ、今日のリズム/スコアボード/足あとは「今日」タブ(既定)に
    // 移動した。加えて信条・寿命はK指定によりホームタブでの既定値がopenへ変更された
    // (CHANGES_v149.md参照)。タブをまたいで検証する。
    // ============================================================
    console.log("[1-8] v230: home折りたたみ/専用カードの不存在とview移行");
    await seed({ blocks: [], view: "home" });
    // (9) 設定画面のvNNN非表示 + 現在のファイル構成のdetails化
    // ============================================================
    console.log("[9] 設定画面から内部バージョン表記(vNNN)が消え、「現在のファイル構成」はdetails既定closed");
    await seed({ blocks: [], view: "settings" });
    // 「見出しから削除」が対象であり、本文の技術的な移行経緯の説明(例: 「Contents API 経由で
    // 保存します(v72。...)」)まで削るのはスコープ外(過剰対応)。パネル見出し(h2/h3)+
    // 群summaryを検査する。v148で13パネルが4群のdetails内(h3、2階層ネスト)へ移動したため、
    // 「.settings-grid > .panel h2」(直下のみ)だと個々のパネル見出しに届かなくなっていた
    // (2系統レビュー指摘・回帰保護の空洞化)。h2/h3/summaryをスコープ全体から広く拾う形に
    // 直し、13パネル分の見出しへ回帰保護を回復する(closed details内でもtextContentは読める)。
    const panelHeadings = await page.locator("#main .settings-grid h2, #main .settings-grid h3, #main .settings-grid summary").allTextContents();
    check("パネル見出しに(vNNN)を含まない", panelHeadings.every((h) => !/\(v\d+/.test(h)), JSON.stringify(panelHeadings));
    const fileStructFold = page.locator("details:has-text('現在のファイル構成')").first();
    check("「現在のファイル構成」はdetails要素で既定closed",
      await fileStructFold.count() === 1 && await fileStructFold.evaluate((el) => el.open) === false);

    console.log(failures === 0 ? "\n✅ v146 ALL PASS" : `\n❌ v146: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
