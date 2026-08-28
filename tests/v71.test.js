// v71 検証: UI整理(タブ順の並び替え・ホームの折りたたみ化・AI系表示の集約)。
// CHANGES_v71.md 参照。破壊的な作り直しはしていない(タブ・機能・データ構造は無変更、並び替えと
// 折りたたみのみ)。
//
// (a) タブ順: navItems(サイドバー/「その他」メニュー)が実行系優先の新しい順序になっている
//     (home, tasks, timeline, wbs, routine, journal, weekly, stats, wish,
//      vision, zero, pomodoro, settings)。
//     ※ mobileNav(下部タブ)はv71時点では意図的に不変更だったが、v82(UX監査B1)で
//        WBS→ジャーナルに入れ替えた。下記[1b]はv82仕様に追従済み(詳細はCHANGES_v82.md/v82.test.js)。
// (b) ホームの折りたたみ: 信条(creed)/寿命カウントダウン(lifespan)/長い弧(zone3)/足あと(zone4)は
//     既定closed。開閉するとlocalStorage(taskchute-journal-home-fold-v1、stateとは別キー)に
//     即時記憶され、リロード後も維持される。
// (c) 「AIから」集約カード: 鮮度インジケータ・AI作業結果・前日AIフィードバックのMIT候補が
//     1つの .home-ai-hub カードにまとまっている(旧: 3箇所に分散)。MIT候補の追加アクション
//     (mit-candidate-add)は移動後も動作する。
// (d) スコアボードの「今日の主役」ジャンプは新しいMIT位置(#home-mit-anchor)へ、「長い弧」への
//     ジャンプは折りたたみが閉じていても自動で開いてからスクロールする(home-jump)。
//
// 方針: 既存スイート(v70等)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。Clock APIで時刻を固定し、
// AIプラン/AIフィードバック/週次レビューの実ファイルfetchはpage.routeで常に404隔離する
// (本番バッチが実際にこれらを日次でcommitするため、実ファイル有無に結果が左右されないようにする)。
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // computeFreeGaps等が日中に依存する既存スイートと同じ理由
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const YESTERDAY = addDaysStr(TODAY, -1);

  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  function planBlock({ id, date = TODAY, title, startMin, minutes = 30, isMIT = false, completed = false } = {}) {
    return {
      id, taskId: "", date, title, category: "",
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0, isMIT,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, interruptions: [],
      migratedTo: "", orderIndex: 0, carryCount: 0, leverageType: "", estimateMin: null,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  async function seed({ blocks = [], view = "home", feedback, aiLinkFreshness } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, feedback, aiLinkFreshness }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = [];
      s.projects = s.projects || [];
      s.questions = [];
      s.feedback = feedback || {};
      s.aiLinkFreshness = aiLinkFreshness || { feedbackAt: null, planAt: null };
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, feedback, aiLinkFreshness });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function foldMap() {
    return page.evaluate((FOLD_KEY) => JSON.parse(localStorage.getItem(FOLD_KEY) || "{}"), FOLD_KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
    // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
    await passGithubGate(page);

    // ============================================================
    // (a) タブ順
    // ============================================================
    console.log("[1] タブ順: サイドバー(=「その他」メニューの順序基盤)が実行系優先の新順序になっている");
    await seed({ blocks: [], view: "home" });
    const navLabels = await page.locator(".nav-list .nav-button .nav-label").allTextContents();
    // v230: homeを削除。現行サイドバー順を固定する。
    // v278: 固定化ルーティンを確認する計器盤2画面を「その他」の前へ常設したため期待順を更新。
    const expectedOrder = [
      "今日", "タスクシュート", "タイムライン", "WBS",
      "ジャーナル", "AIレポート", "やりたい", "ビジョン", "0秒思考",
      "INSTRUMENTS", "IRON LOG", "FUND", "その他", "設定"
    ];
    check("navItemsの並びが期待どおり", JSON.stringify(navLabels) === JSON.stringify(expectedOrder), JSON.stringify(navLabels));

    // v82(UX監査B1・K承認): 日課動線(朝: ホーム→ジャーナルで体調記録)を1タップにするため、
    // 不定期にしか触らないWBSを「その他」へ降ろし、ジャーナルをbottom-navへ昇格した。
    // WBSが「その他」の受け皿に出ることはv82.test.jsで別途検証する。
    console.log("[1b] 下部タブ(mobileNav)は 今日/ジャーナル/実行/時間/その他(v182でhome→todayに入替)");
    const bottomLabels = await page.locator("#bottomNav button").allTextContents();
    // v182 D2: mobileNav先頭差替え/moreGroups計画群へhome追加
    check("mobileNavはv182の新構成", JSON.stringify(bottomLabels) === JSON.stringify(["今日", "ジャーナル", "実行", "時間", "その他"]), JSON.stringify(bottomLabels));

    // v230: home本体と専用fold群は描画コードごと撤去。移設先のないUIは不存在を固定する。
    console.log("[2] v230: homeナビ・タブ・専用fold群が存在せず、旧home stateはtodayへ縮退する");
    await seed({ blocks: [], view: "home" });
    check("homeナビが存在しない", await page.locator('[data-action="nav"][data-view="home"]').count() === 0);
    check("homeタブバーが存在しない", await page.locator(".home-tabbar").count() === 0);
    check("home専用fold群が存在しない",
      await page.locator('.home-creed, .home-lifespan, [data-fold-id="zone3"], [data-fold-id="zone4"]').count() === 0);
    check("旧home stateはtodayへ縮退しTOWERを描画する",
      await page.locator('#app[data-view="today"] .today-tower').count() === 1);

    // ============================================================
    // (c) 廃止済みAI集約UIと旧stateの互換
    // ============================================================
    console.log("[4] 旧AI連携stateを保持しつつ、廃止済み集約UIを描画しない");
    await seed({
      blocks: [planBlock({ id: "mit-1", title: "既存MIT", startMin: 9 * 60, isMIT: true })],
      view: "today",
      feedback: { [YESTERDAY]: "## 明日のMIT候補\n- テスト候補タスクX\n- テスト候補タスクY\n" },
      aiLinkFreshness: { feedbackAt: YESTERDAY, planAt: null }
    });
    check("today/TOWERの右カラムはJOURNALだけを描画", await page.locator(".tower-col-right > .sec-journal").count() === 1);
    check("右カラム直下要素はJOURNAL 1個だけ", await page.locator(".tower-col-right > *").count() === 1);
    check("旧ATISセクションを描画しない", await page.locator(".sec-atis").count() === 0);
    check("旧ATIS data属性を描画しない", await page.locator("[data-atis-panel], [data-atis-task-candidates]").count() === 0);
    check("鮮度・候補の旧UIを描画しない", await page.locator('.ai-freshness-line, [data-action="mit-candidate-add"], [data-action="ai-mit-adopt"]').count() === 0);
    const s5 = await stateNow();
    const added = (s5.blocks || []).find((b) => b.title === "テスト候補タスクX");
    check("旧フィードバックstateを保持し、MITブロックを自動追加しない", !added && (s5.feedback?.[YESTERDAY] || "").includes("テスト候補タスクX"), JSON.stringify(s5.feedback));
    check("旧鮮度stateを正規化後も保持", s5.aiLinkFreshness?.feedbackAt === YESTERDAY && s5.aiLinkFreshness?.planAt === null, JSON.stringify(s5.aiLinkFreshness));
    check("旧フィードバック本文をstateから削除しない", (s5.feedback?.[YESTERDAY] || "").includes("テスト候補タスクY"), JSON.stringify(s5.feedback));
    check("MIT候補UIのAIラベルをtodayへ戻さない", !(await page.locator(".today-tower").textContent()).includes("明日のMIT候補"));
    check("廃止済みMIT候補actionを描画しない", await page.locator('[data-action="mit-candidate-add"], [data-action="ai-mit-adopt"]').count() === 0);

    console.log("[5] MIT数に関係なく廃止済み候補UIを戻さない");
    await seed({
      blocks: [
        planBlock({ id: "mit-a", title: "MIT-A", startMin: 8 * 60, isMIT: true }),
        planBlock({ id: "mit-b", title: "MIT-B", startMin: 9 * 60, isMIT: true }),
        planBlock({ id: "mit-c", title: "MIT-C", startMin: 10 * 60, isMIT: true })
      ],
      view: "today",
      feedback: { [YESTERDAY]: "## 明日のMIT候補\n- 埋まっているはずの候補\n" }
    });
    check("MIT3件時も候補セクション(追加ボタン)は出ない",
      await page.locator('[data-action="mit-candidate-add"], [data-action="ai-mit-adopt"]').count() === 0);

    // ============================================================
    // (d) homeアンカー不存在 + TOWER維持
    // ============================================================
    console.log("[6] home MITアンカーは撤去され、TOWERが維持される");
    await seed({ blocks: [planBlock({ id: "mit-jump", title: "ジャンプ確認MIT", startMin: 9 * 60, isMIT: true })], view: "today" });
    check("#home-mit-anchorは存在しない", await page.locator("#home-mit-anchor").count() === 0);
    check("today/TOWERは引き続き描画される", await page.locator(".today-tower").count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
