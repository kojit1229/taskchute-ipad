// v71 検証: UI整理(タブ順の並び替え・ホームの折りたたみ化・AI系表示の集約)。
// CHANGES_v71.md 参照。破壊的な作り直しはしていない(タブ・機能・データ構造は無変更、並び替えと
// 折りたたみのみ)。
//
// (a) タブ順: navItems(サイドバー/「その他」メニュー)が実行系優先の新しい順序になっている
//     (home, tasks, timeline, wbs, routine, journal, weekly, reports, stats, wish, avoid,
//      vision, zero, pomodoro, settings)。mobileNav(下部4タブ)は意図的に変更していない
//     (CHANGES_v71.md参照: iPhone/iPadの筋肉記憶を壊さないためのリスク最小化判断)。
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
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4209;
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
    const expectedOrder = [
      "ホーム", "タスクシュート", "タイムライン", "WBS", "ルーティン",
      "ジャーナル", "週次", "日報", "計器盤", "やりたい", "やらない",
      "ビジョン", "0秒思考", "ポモドーロ", "設定"
    ];
    check("navItemsの並びが期待どおり", JSON.stringify(navLabels) === JSON.stringify(expectedOrder), JSON.stringify(navLabels));

    console.log("[1b] 下部タブ(mobileNav)は従来どおり home/WBS/実行/時間/その他(意図的に不変更)");
    const bottomLabels = await page.locator("#bottomNav button").allTextContents();
    check("mobileNavは変更していない", JSON.stringify(bottomLabels) === JSON.stringify(["ホーム", "WBS", "実行", "時間", "その他"]), JSON.stringify(bottomLabels));

    // ============================================================
    // (b) ホームの折りたたみ
    // ============================================================
    // v72(K指示・追加要件): 信条/寿命はホーム最上部(Now/MITより上)へ移動し、既定openに変更。
    // 長い弧/今日の足あとは既存どおり下部・既定closedのまま(CHANGES_v72.md参照)。
    console.log("[2] ホームの折りたたみ: 信条/寿命は既定open(v72でトップ移動)、長い弧/足あとは既定closed");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({ blocks: [], view: "home" });
    for (const id of ["creed", "lifespan"]) {
      const isOpen = await page.locator(`details[data-fold-id="${id}"]`).evaluate((el) => el.open);
      check(`${id} は既定open(v72)`, isOpen === true, String(isOpen));
    }
    for (const id of ["zone3", "zone4"]) {
      const isOpen = await page.locator(`details[data-fold-id="${id}"]`).evaluate((el) => el.open);
      check(`${id} は既定closed`, isOpen === false, String(isOpen));
    }

    console.log("[3] 折りたたみを閉じる/開くとlocalStorage(state本体とは別キー)に記憶され、リロード後も維持される");
    // v72: creedは既定openになったため、ここではまだ未操作のzone4(既定closed)で
    // 「操作→記憶→リロード後も維持」の仕組み自体を検証する(v71時点の趣旨を維持)。
    await page.click('details[data-fold-id="zone4"] > summary');
    await page.waitForTimeout(200);
    check("zone4を開くとopen属性が付く", await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open));
    const fm1 = await foldMap();
    check("localStorageにzone4:trueが記録される", fm1.zone4 === true, JSON.stringify(fm1));
    check("他の折りたたみ(zone3)は記録を汚さずfalseのまま", fm1.zone3 !== true, JSON.stringify(fm1));
    await page.reload();
    await page.waitForTimeout(400);
    check("リロード後もzone4はopenのまま", await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open));
    check("リロード後もzone3はclosedのまま", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open) === false);

    // ============================================================
    // (c) 「AIから」集約カード
    // ============================================================
    console.log("[4] 「AIから」カードに鮮度・AI作業結果・前日AIフィードバック候補がまとまって出る");
    await seed({
      blocks: [planBlock({ id: "mit-1", title: "既存MIT", startMin: 9 * 60, isMIT: true })],
      view: "home",
      feedback: { [YESTERDAY]: "## 明日のMIT候補\n- テスト候補タスクX\n- テスト候補タスクY\n" },
      aiLinkFreshness: { feedbackAt: YESTERDAY, planAt: null }
    });
    check("「AIから」カードが1つだけ表示される", await page.locator(".home-ai-hub").count() === 1);
    const hubText = await page.locator(".home-ai-hub").textContent();
    check("鮮度インジケータがAIから内にある", (await page.locator(".home-ai-hub .ai-freshness-line").count()) === 1);
    check("鮮度テキストにフィードバック/プランの経過が出る", hubText.includes("AI連携:") && hubText.includes("フィードバック"), hubText);
    check("前日フィードバックのMIT候補見出しが出る", hubText.includes("昨日のフィードバックからの候補"), hubText);
    check("候補タスクXが表示される", hubText.includes("テスト候補タスクX"), hubText);
    check("候補タスクYが表示される", hubText.includes("テスト候補タスクY"), hubText);
    check("鮮度インジケータはページ全体で1箇所(AIからカード内)のみ(集約済み・重複表示なし)", await page.locator(".ai-freshness-line").count() === 1);

    console.log("[5] 候補の「＋ 主役に」は移動後も動作し、今日の主役(MIT)に追加される");
    await page.click('.home-ai-hub [data-action="mit-candidate-add"][data-title="テスト候補タスクX"]');
    await page.waitForTimeout(300);
    const s5 = await stateNow();
    const added = (s5.blocks || []).find((b) => b.title === "テスト候補タスクX");
    check("候補がMITブロックとして追加される", !!added && added.isMIT === true, JSON.stringify(added));
    check("追加後は候補カードから消える(既存タイトルは除外される)", !(await page.locator(".home-ai-hub").textContent()).includes("テスト候補タスクX"));

    console.log("[6] MITが3件埋まっていれば候補セクション自体を出さない(既存仕様を踏襲)");
    await seed({
      blocks: [
        planBlock({ id: "mit-a", title: "MIT-A", startMin: 8 * 60, isMIT: true }),
        planBlock({ id: "mit-b", title: "MIT-B", startMin: 9 * 60, isMIT: true }),
        planBlock({ id: "mit-c", title: "MIT-C", startMin: 10 * 60, isMIT: true })
      ],
      view: "home",
      feedback: { [YESTERDAY]: "## 明日のMIT候補\n- 埋まっているはずの候補\n" }
    });
    const hubTextFull = await page.locator(".home-ai-hub").textContent();
    check("MIT3件埋まっていれば候補は出ない", !hubTextFull.includes("埋まっているはずの候補"), hubTextFull);

    // ============================================================
    // (d) スコアボードのジャンプ先
    // ============================================================
    console.log("[7] スコアボード「今日の主役」は#home-mit-anchorへ、「長い弧」は閉じていても自動で開く");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({ blocks: [planBlock({ id: "mit-jump", title: "ジャンプ確認MIT", startMin: 9 * 60, isMIT: true })], view: "home" });
    check("#home-mit-anchorが存在し今日の主役を含む", (await page.locator("#home-mit-anchor").textContent()).includes("ジャンプ確認MIT"));
    check("zone3は開始時点でclosed", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open) === false);
    await page.click('.home-score[data-id="homezone-3"]');
    await page.waitForTimeout(300);
    check("「長い弧」ジャンプでzone3が自動的に開く", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open));
    const fm2 = await foldMap();
    check("自動オープンもlocalStorageに記憶される", fm2.zone3 === true, JSON.stringify(fm2));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
