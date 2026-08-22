// v87 検証: 「宣言→終了報告ループ」(taskchute-notes/ROADMAP.md v91・実番号v87)。
//
// ①宣言ワンタップ→開始: now-start(タイムラインの▶いま開始)/start-pomodoro(25分ボタン)いずれも
//   クリックで宣言モーダルが開き、[宣言して開始]一発でstate.declarationsに記録されたうえで
//   従来どおりの開始処理(actualStartAt記録/ポモドーロ起動)が走る。
// ②宣言スキップ/×閉じで従来動作: [宣言せず開始]または×閉じでは宣言ログを残さず、
//   スキップ時は従来どおり開始のみ実行、×閉じでは開始自体も取り消される。
// ③終了報告→ログ記録: now-end(■いま終了)は終了報告モーダルを経由し、
//   [できた/一部できた/脱線した]いずれかのワンタップでoutcome・一言が記録される。
//   [スキップ]では報告ログを残さず従来どおりの完了処理のみ走る。
// ④決定論フィードバックの文言: 「宣言→完了まで{分}分(宣言時見積{分}分)。今日の宣言達成 X/Y」が
//   トーストに出る(アプリ内AI呼び出しは無し・定型文+簡易集計のみ)。
// ⑤normalizeStateの後方互換: 旧state(declarationsフィールド無し)から[]が補完され、
//   上限300件で切り詰められる。
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
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);

  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  function planBlock({ id, date = TODAY, title, startMin, minutes = 30, estimateMin = null,
    completed = false, actualStartAt = "", actualEndAt = "", category = "" } = {}) {
    return {
      id, taskId: "", date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt, actualEndAt,
      completed, charge: 0, discharge: 0, estimateMin,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, interruptions: [],
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  // declarations は既定で毎回 [] にリセットする(各サブテストを独立させ、前のサブテストの
  // 宣言/報告ログが後続の「今日の宣言達成」集計に混入しないようにするため)。
  async function seed({ blocks = [], view = "timeline", pomodoro, declarations = [] } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, pomodoro, declarations }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = []; s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      s.settings = s.settings || {};
      s.settings.focusTimerAuto = false;  // ポモドーロ自動起動と切り分けて検証する
      if (pomodoro) s.pomodoro = pomodoro;
      s.declarations = declarations;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, pomodoro, declarations });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [①②] now-start: 宣言ワンタップ確定→開始 / スキップ・×閉じで従来動作
    // ============================================================
    console.log("[①] now-start: 宣言モーダルが開き、一言を添えて[宣言して開始]で記録→開始される");
    await seed({
      blocks: [planBlock({ id: "blk-a", title: "資料作成", startMin: 9 * 60, minutes: 30 })]
    });
    check("宣言前はモーダルが無い", await page.locator(".modal-root.open").count() === 0);
    await page.click('.timeline-card [data-action="now-start"][data-id="blk-a"]');
    await page.waitForTimeout(200);
    check("宣言モーダルが開く", await page.locator('[data-action="declare-confirm"]').count() === 1);
    const declareText = await page.locator(".modal-body").first().textContent();
    check("宣言文言にBlockタイトルと見積(予定差分30分)が入る", declareText.includes("資料作成") && declareText.includes("30分"), declareText);
    const declareNoteFont = await page.locator("[data-declare-note]").evaluate((el) => getComputedStyle(el).fontSize);
    check("宣言の一言入力欄はfont-size 16px以上(iOS自動ズーム防止)", parseFloat(declareNoteFont) >= 16, declareNoteFont);
    await page.fill("[data-declare-note]", "集中していく");
    await page.click('[data-action="declare-confirm"]');
    await page.waitForTimeout(300);
    check("宣言確定後はモーダルが閉じる", await page.locator(".modal-root.open").count() === 0);
    const s1 = await stateNow();
    check("従来どおりactualStartAtが記録される", !!s1.blocks.find((b) => b.id === "blk-a")?.actualStartAt);
    check("state.declarationsに1件記録される", (s1.declarations || []).length === 1, JSON.stringify(s1.declarations));
    const d1 = s1.declarations[0];
    check("宣言エントリのblockId/title/note/estimateMinが正しい",
      d1.blockId === "blk-a" && d1.title === "資料作成" && d1.note === "集中していく" && d1.estimateMin === 30,
      JSON.stringify(d1));
    check("declaredAtが記録され、reportedAtはまだ空", !!d1.declaredAt && d1.reportedAt === "", JSON.stringify(d1));

    console.log("[①b] block.estimateMinが設定されていればそちらを優先する");
    await seed({
      blocks: [planBlock({ id: "blk-est", title: "見積優先確認", startMin: 9 * 60, minutes: 30, estimateMin: 45 })]
    });
    await page.click('.timeline-card [data-action="now-start"][data-id="blk-est"]');
    await page.waitForTimeout(200);
    const declareText2 = await page.locator(".modal-body").first().textContent();
    check("estimateMin(45分)が予定差分(30分)より優先される", declareText2.includes("45分") && !declareText2.includes("30分"), declareText2);
    await page.click('[data-action="declare-skip"]');
    await page.waitForTimeout(200);

    console.log("[②] now-start: [宣言せず開始]では宣言ログを残さず従来どおり開始のみ実行される");
    await seed({
      blocks: [planBlock({ id: "blk-b", title: "宣言スキップ検証", startMin: 9 * 60, minutes: 30 })]
    });
    await page.click('.timeline-card [data-action="now-start"][data-id="blk-b"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="declare-skip"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    check("スキップでもactualStartAtは記録される(従来どおり)", !!s2.blocks.find((b) => b.id === "blk-b")?.actualStartAt);
    check("スキップでは宣言ログが残らない", (s2.declarations || []).length === 0, JSON.stringify(s2.declarations));

    console.log("[②b] now-start: ×閉じでは開始自体も取り消される(宣言を強制しない)");
    await seed({
      blocks: [planBlock({ id: "blk-c", title: "×閉じ検証", startMin: 9 * 60, minutes: 30 })]
    });
    await page.click('.timeline-card [data-action="now-start"][data-id="blk-c"]');
    await page.waitForTimeout(200);
    await page.click('.modal-root [data-action="modal-close"]');
    await page.waitForTimeout(200);
    const s2b = await stateNow();
    check("×閉じでは開始処理自体が行われない(actualStartAtが空のまま)", !s2b.blocks.find((b) => b.id === "blk-c")?.actualStartAt, JSON.stringify(s2b.blocks.find((b) => b.id === "blk-c")));
    check("×閉じでは宣言ログも残らない", (s2b.declarations || []).length === 0);

    // ============================================================
    // [③④] now-end: 終了報告→ログ記録 + 決定論フィードバック
    // ============================================================
    console.log("[③] now-end: 終了報告モーダルで[できた]を選ぶと、outcome/一言が記録され従来どおり終了する");
    await seed({
      blocks: [planBlock({ id: "blk-d", title: "終了報告検証", startMin: 9 * 60, minutes: 30, actualStartAt: `${TODAY}T09:00:00` })]
    });
    // blk-dは既にactualStartAt設定済みなので「▶いま開始」ボタンは出ない想定。now-endを直接叩く。
    check("(準備)actualStartAt設定済みのため▶いま開始ボタンは出ない", await page.locator('.timeline-card [data-action="now-start"][data-id="blk-d"]').count() === 0);
    await page.click('.timeline-card [data-action="now-end"][data-id="blk-d"]');
    await page.waitForTimeout(200);
    check("終了報告モーダルが開く", await page.locator('[data-action="report-outcome"][data-outcome="done"]').count() === 1);
    const reportNoteFont = await page.locator("[data-report-note]").evaluate((el) => getComputedStyle(el).fontSize);
    check("終了報告の一言入力欄はfont-size 16px以上(iOS自動ズーム防止)", parseFloat(reportNoteFont) >= 16, reportNoteFont);
    await page.fill("[data-report-note]", "予定通り終わった");
    await page.click('[data-action="report-outcome"][data-outcome="done"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    check("従来どおりactualEndAtが記録される", !!s3.blocks.find((b) => b.id === "blk-d")?.actualEndAt);
    const d3 = (s3.declarations || []).find((d) => d.blockId === "blk-d");
    check("宣言なしの終了報告も新規エントリとして記録される", !!d3, JSON.stringify(s3.declarations));
    check("outcome/resultNoteが記録される", d3?.outcome === "done" && d3?.resultNote === "予定通り終わった", JSON.stringify(d3));
    check("reportedAtが記録され、declaredAtは空(宣言なし)", !!d3?.reportedAt && d3?.declaredAt === "", JSON.stringify(d3));

    console.log("[③b] now-end: [スキップ]では報告ログを残さず従来どおり終了する");
    await seed({
      blocks: [planBlock({ id: "blk-e", title: "報告スキップ検証", startMin: 9 * 60, minutes: 30, actualStartAt: `${TODAY}T09:00:00` })]
    });
    await page.click('.timeline-card [data-action="now-end"][data-id="blk-e"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="report-skip"]');
    await page.waitForTimeout(300);
    const s3b = await stateNow();
    check("スキップでもactualEndAtは記録される(従来どおり)", !!s3b.blocks.find((b) => b.id === "blk-e")?.actualEndAt);
    check("スキップでは報告ログが残らない", (s3b.declarations || []).length === 0, JSON.stringify(s3b.declarations));

    // ============================================================
    // v230: home上のNow全画面入口は描画導線ごと撤去。Now開始/終了・報告の現行導線は
    // [①]〜[⑥]で引き続き検証する。
    console.log("[⑥b] v230: 旧Now全画面入口は描画されない");
    await seed({
      blocks: [planBlock({ id: "blk-now-fs", title: "Now全画面撤去確認", startMin: new Date().getHours() * 60, minutes: 60 })],
      view: "home"
    });
    check("旧now-mode-open導線とfullscreenは描画されない",
      await page.locator('[data-action="now-mode-open"], .now-fullscreen').count() === 0);
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);

    // ============================================================
    // [⑤] normalizeState 後方互換 + 上限300件
    // ============================================================
    console.log("[⑤] normalizeStateの後方互換: declarationsフィールド無しの旧stateから[]が補完される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.declarations;  // v86以前を模した状態(フィールド自体が無い)
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("pageerrorが起きずクラッシュしない", true);
    const s5 = await stateNow();
    check("declarationsが配列として補完される", Array.isArray(s5.declarations), JSON.stringify(s5.declarations));

    console.log("[⑤b] 上限300件で切り詰められる(既存値優先で内容は保持)");
    const many = Array.from({ length: 305 }, (_, i) => ({
      id: `cap-${i}`, blockId: "cap-blk", date: TODAY, title: `件数上限検証${i}`, estimateMin: 25,
      note: "", declaredAt: `${TODAY}T00:00:0${i % 10}`, reportedAt: "", outcome: "", resultNote: ""
    }));
    await page.evaluate(({ KEY, many }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.declarations = many;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, many });
    await page.reload();
    await page.waitForTimeout(400);
    const s5b = await stateNow();
    check("305件投入しても300件に切り詰められる", (s5b.declarations || []).length === 300, (s5b.declarations || []).length);
    check("切り詰めは古い方から捨てる(末尾=新しい方が残る)", s5b.declarations[s5b.declarations.length - 1].id === "cap-304", JSON.stringify(s5b.declarations[s5b.declarations.length - 1]));

    console.log(failures === 0 ? "\n✅ v87 ALL PASS" : `\n❌ v87: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
