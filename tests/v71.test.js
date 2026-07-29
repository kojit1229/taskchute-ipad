// v71 検証: UI整理(タブ順の並び替え・ホームの折りたたみ化・AI系表示の集約)。
// CHANGES_v71.md 参照。破壊的な作り直しはしていない(タブ・機能・データ構造は無変更、並び替えと
// 折りたたみのみ)。
//
// (a) タブ順: navItems(サイドバー/「その他」メニュー)が実行系優先の新しい順序になっている
//     (home, tasks, timeline, wbs, routine, journal, weekly, reports, stats, wish, avoid,
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
    // v182 D2: mobileNav先頭差替え/moreGroups計画群へhome追加
    // v187 裁定15: サイドバーに「計時」(timeswitch)を今日の直後へ追加
    const expectedOrder = [
      "今日", "計時", "ホーム", "タスクシュート", "タイムライン", "WBS", "ルーティン",
      "ジャーナル", "週次", "日報", "AIレポート", "ダッシュボード", "計器盤", "やりたい", "やらない",
      "ビジョン", "0秒思考", "ポモドーロ", "設定"
    ];
    check("navItemsの並びが期待どおり", JSON.stringify(navLabels) === JSON.stringify(expectedOrder), JSON.stringify(navLabels));

    // v82(UX監査B1・K承認): 日課動線(朝: ホーム→ジャーナルで体調記録)を1タップにするため、
    // 不定期にしか触らないWBSを「その他」へ降ろし、ジャーナルをbottom-navへ昇格した。
    // WBSが「その他」の受け皿に出ることはv82.test.jsで別途検証する。
    console.log("[1b] 下部タブ(mobileNav)は 今日/ジャーナル/実行/時間/その他(v182でhome→todayに入替)");
    const bottomLabels = await page.locator("#bottomNav button").allTextContents();
    // v182 D2: mobileNav先頭差替え/moreGroups計画群へhome追加
    check("mobileNavはv182の新構成", JSON.stringify(bottomLabels) === JSON.stringify(["今日", "ジャーナル", "実行", "時間", "その他"]), JSON.stringify(bottomLabels));

    // ============================================================
    // (b) ホームの折りたたみ
    // ============================================================
    // v149(UI改善計画Phase4a)追補: ホームが「今日」/「ホーム」の2タブに分割され、信条/寿命/
    // 長い弧(zone3)は「ホーム」タブ、足あと(zone4)は「今日」タブ(既定)に移動した。加えて
    // K指定により信条・寿命はホームタブでの既定値がclosed→openへ変更された(CHANGES_v149.md参照)。
    const gotoHomeTab = async () => { await page.click('[data-action="home-tab"][data-tab="home"]'); await page.waitForTimeout(150); };
    const gotoTodayTab = async () => { await page.click('[data-action="home-tab"][data-tab="today"]'); await page.waitForTimeout(150); };
    console.log("[2] ホームの折りたたみ: 信条/寿命はホームタブで既定open(v149)、長い弧(ホームタブ)/足あと(今日タブ)は既定closed");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({ blocks: [], view: "home" });
    const isOpenZone4 = await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open);
    check("zone4(今日タブ)は既定closed", isOpenZone4 === false, String(isOpenZone4));
    await gotoHomeTab();
    // v149レビュー対応(必須6): creed/lifespanはdata-fold-idを持たない非永続セッション
    // オーバーライド方式(homeReflectFoldSection)に変わったため、クラスセレクタで判定する。
    for (const [id, cls] of [["creed", ".home-creed"], ["lifespan", ".home-lifespan"]]) {
      const isOpen = await page.locator(`details${cls}`).evaluate((el) => el.open);
      check(`${id} はホームタブで既定open(v149)`, isOpen === true, String(isOpen));
    }
    const isOpenZone3 = await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open);
    check("zone3(ホームタブ)は既定closed", isOpenZone3 === false, String(isOpenZone3));

    console.log("[3] 折りたたみを閉じる/開くとlocalStorage(state本体とは別キー)に記憶され、リロード後も維持される");
    // v149: zone3(ホームタブ側)で「操作→記憶→リロード後も維持」の仕組み自体を検証する
    // (v71時点の趣旨を維持。creed/lifespanは既定openになったためzone3で代替)。
    await page.click('details[data-fold-id="zone3"] > summary');
    await page.waitForTimeout(200);
    check("zone3を開くとopen属性が付く", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open));
    const fm1 = await foldMap();
    check("localStorageにzone3:trueが記録される", fm1.zone3 === true, JSON.stringify(fm1));
    check("他の折りたたみ(zone4)は記録を汚さずfalseのまま", fm1.zone4 !== true, JSON.stringify(fm1));
    await page.reload();
    await page.waitForTimeout(400);
    await gotoHomeTab();
    check("リロード後もzone3はopenのまま", await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open));
    await gotoTodayTab();
    check("リロード後もzone4はclosedのまま", await page.locator('details[data-fold-id="zone4"]').evaluate((el) => el.open) === false);

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
    // v149: 「AIから」(home-ai-hub)はホームタブへ移動した(既定は今日タブ)。
    await gotoHomeTab();
    check("「AIから」カードが1つだけ表示される", await page.locator(".home-ai-hub").count() === 1);
    const hubText = await page.locator(".home-ai-hub").textContent();
    check("鮮度インジケータがAIから内にある", (await page.locator(".home-ai-hub .ai-freshness-line").count()) === 1);
    check("鮮度テキストにフィードバック/プランの経過が出る", hubText.includes("AI連携:") && hubText.includes("フィードバック"), hubText);
    check("前日フィードバックのMIT候補見出しが出る", hubText.includes("昨日のフィードバックからの候補"), hubText);
    check("候補タスクXが表示される", hubText.includes("テスト候補タスクX"), hubText);
    check("候補タスクYが表示される", hubText.includes("テスト候補タスクY"), hubText);
    check("鮮度インジケータはページ全体で1箇所(AIからカード内)のみ(集約済み・重複表示なし)", await page.locator(".ai-freshness-line").count() === 1);

    // v146(UI改善計画Phase1-1): 「AIから」は参照系として既定closedの折りたたみになった。
    // 中の候補ボタンを操作するにはまず開く必要がある(textContent自体はDOMに常在するため
    // 上のtextベース検証には影響しない)。
    console.log("[4b] 「AIから」は既定closed(v146)。開くと候補ボタンが操作できる");
    const aiHubFold = page.locator("details.home-ai-hub");
    check("AIからは既定closed(v146)", await aiHubFold.evaluate((el) => el.open) === false);
    await aiHubFold.locator("summary").first().click();
    await page.waitForTimeout(150);
    check("開くとopen属性が付く", await aiHubFold.evaluate((el) => el.open));

    console.log("[5] 候補の「＋ 主役に」は移動後も動作し、今日の主役(MIT)に追加される");
    await page.click('.home-ai-hub [data-action="mit-candidate-add"][data-title="テスト候補タスクX"]');
    await page.waitForTimeout(300);
    const s5 = await stateNow();
    const added = (s5.blocks || []).find((b) => b.title === "テスト候補タスクX");
    check("候補がMITブロックとして追加される", !!added && added.isMIT === true, JSON.stringify(added));
    // v75: 「AIから」カードにAIフィードバック本文をそのまま読めるdetails(homeAiFeedbackReadHTML)が
    // 追加されたため、.home-ai-hub 全体のtextContentには(既に候補から除外された後でも)元のraw
    // フィードバック本文として「テスト候補タスクX」という文字列が残り得る(意図した仕様。CHANGES_v75.md参照)。
    // ここで検証したい「既存タイトルは候補として二重に出ない」は、候補行(追加ボタン)の消滅で判定する。
    check("追加後は候補(追加ボタン)がカードから消える(既存タイトルは除外される)",
      await page.locator('.home-ai-hub [data-action="mit-candidate-add"][data-title="テスト候補タスクX"]').count() === 0);

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
    await gotoHomeTab();
    // v75: 上と同じ理由で、raw本文を読めるdetailsのぶん .home-ai-hub のtextContentには
    // フィードバック本文がそのまま出るため、「候補セクション自体が無い」ことは候補見出しの不在で判定する。
    const hubTextFull = await page.locator(".home-ai-hub").textContent();
    check("MIT3件埋まっていれば候補セクション(見出し・追加ボタン)は出ない",
      !hubTextFull.includes("昨日のフィードバックからの候補")
        && await page.locator('.home-ai-hub [data-action="mit-candidate-add"]').count() === 0,
      hubTextFull);

    // ============================================================
    // (d) スコアボードのジャンプ先
    // ============================================================
    // v149(UI改善計画Phase4a)追補: 「12週 今週」セルのジャンプ先(#homezone-3)は今日タブの
    // 12週サイクルカード(homeCycle、常時表示・非折りたたみ)になった。旧仕様(「長い弧」の
    // 折りたたみを自動で開く)は、12週サイクルが「長い弧をたしかめる」から分離されホームタブへ
    // 移った(K指定)ことで意味を失ったため、新しい対応関係を検証する(CHANGES_v149.md参照)。
    console.log("[7] スコアボード「今日の主役」は#home-mit-anchorへ、「12週 今週」は#homezone-3(今日タブの12週サイクルカード)へジャンプする");
    await page.evaluate((FOLD_KEY) => localStorage.removeItem(FOLD_KEY), FOLD_KEY);
    await seed({ blocks: [planBlock({ id: "mit-jump", title: "ジャンプ確認MIT", startMin: 9 * 60, isMIT: true })], view: "home" });
    check("#home-mit-anchorが存在し今日の主役を含む", (await page.locator("#home-mit-anchor").textContent()).includes("ジャンプ確認MIT"));
    check("#homezone-3(今日タブ)は12週サイクルカードで、折りたたみを持たない(常時表示)",
      await page.locator("#homezone-3 details[data-fold-id]").count() === 0
      && (await page.locator("#homezone-3").textContent()).includes("12週サイクル"));
    // v82: スコアボード自体も既定closedの折りたたみになった(CHANGES_v82.md)ため、
    // 中の「今日の主役」セルをクリックするには先にスコアボードを開く必要がある。
    await page.locator('details[data-fold-id="home-scoreboard"] summary').click();
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.__homeJumpScrollTargets = [];
      window.__origScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        window.__homeJumpScrollTargets.push(this.id || this.className || this.tagName);
        return window.__origScrollIntoView.apply(this, args);
      };
    });
    await page.click('.home-score[data-id="homezone-3"]');
    await page.waitForTimeout(300);
    const jumpTargets = await page.evaluate(() => window.__homeJumpScrollTargets || []);
    // v149レビュー対応(推奨9): モンキーパッチしたscrollIntoViewを元に戻す(以降の操作
    // (gotoHomeTab等)に影響を残さない)。
    await page.evaluate(() => {
      if (window.__origScrollIntoView) Element.prototype.scrollIntoView = window.__origScrollIntoView;
    });
    check("「12週 今週」ジャンプで#homezone-3へscrollIntoViewが呼ばれる", jumpTargets.includes("homezone-3"), JSON.stringify(jumpTargets));
    await gotoHomeTab();
    check("ホームタブの「長い弧をたしかめる」(zone3)は、12週ジャンプでは自動的に開かない(分離済み)",
      await page.locator('details[data-fold-id="zone3"]').evaluate((el) => el.open) === false);
    const fm2 = await foldMap();
    check("zone3はlocalStorageにも記録されない(ジャンプと無関係)", fm2.zone3 !== true, JSON.stringify(fm2));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
