// v153 検証: ADHD支援「②今日の庭 S1」(gardenLog + 今日の芽、CHANGES_v153.md参照)。
// 罰なしゲーミフィケーション(designs/11-habit-garden.md §④「罰なしルールの仕様化」)。
// 2系統レビュー(2026-07-28)のFAIL指摘4件+推奨5件への対応を含む最終版。
//
// (A) 今日の芽(zone2ルーティンカード内、homeRoutine()):
//     - ルーティン0件の日は非表示(.home-gardenごと出ない)
//     - 0件(達成0)は「土」状態: 段階クラス(.g-stage1/2/3)も文言も出ない(罰なし、沈黙)
//     - 1件以上かつ50%未満=芽(.g-stage1、薄緑)/ 50%以上かつ未全完了=若木(.g-stage2、緑)/
//       全完了=開花(.g-stage3、濃緑)。境界値(1/4=25%, 2/4=50%, 3/4=75%, 4/4=100%)で検証
//     - 3段階は色トークン(--garden-pale/mid/deep)で実装されており、算出colorが3段階とも
//       異なる値になっている(レビュー指摘: opacityだとダークで薄緑が暗緑に化ける問題への対応確認)
//     - 完了操作(toggle-block、v150統一方式)で段階が即座に更新される(再読込不要)
//     - 段階が「上がった」直後だけフェードインクラス(.garden-grew)が付く。上がらない操作
//       (同じ段階に留まる/下がる)には付かない
//     - データ層(gardenLog)は完了取り消しでもdoneが下がらない(フィールド別maxマージ、
//       ライブ表示(sprout自体)は取り消しに追従して下がる、という2層の使い分け)
// (B) normalizeState後方互換: gardenLogフィールド自体が無い旧state・不正な型(配列)の
//     どちらも空オブジェクトへ補完される。既存の正常なgardenLogは補完で壊されない
// (C) gardenLogのフィールド別maxマージ(レビュー必須1): 既存スナップショットの
//     done/totalそれぞれ独立に「今まで見た最大値」を保持する。「done同値・total縮小」
//     (繰り返し実体purgeの典型パターン)でも改竄されない。ルーティン0件かつ既存エントリも
//     無い日には空エントリ{0,0}を書き込まない(レビュー必須4)
// (D) gardenLogの端末間同期マージ(レビュー必須2、データ消失クラス): computeSyncMergeに
//     日付キーごとのフィールド別maxマージを配線。ローカル限定エントリはリモート採用後も残る
// (E) pruneGardenLog: 保持上限(GARDEN_LOG_KEEP_DAYS=400日)超過分は剪定される
//
// 解釈メモ(つまずいた点、K確認事項): 設計書§④-1「減らない」は、gardenLog(データ層)は
// 常に「今まで見た最大値」を保持し続けるが、当日の「今日の芽」表示自体は設計書§③が明記する
// とおりライブ計算(routineRate)であり、ユーザーが完了を取り消せばその場で表示も追従して下がる
// (既存の「実行率%」バーと同じ挙動)と解釈して実装した。「表示自体も当日中は一度上がったら
// 下がらないよう凍結する」機構は追加していない。凍結が意図であれば要追加相談。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";
const OWNER = "kojit1229";
const REPO = "personal-data";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const now = new Date();
const TODAY = isoDate(now);
const YESTERDAY = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

function makeRoutineBlock(id, date, title, completed) {
  return {
    id, taskId: "", date, title, category: "ルーティン",
    plannedStartAt: `${date}T07:00`, plannedEndAt: `${date}T07:10`,
    actualStartAt: "", actualEndAt: "", completed,
    charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment: "",
    recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false,
    source: "", createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  // ============================================================
  // Part A: 今日の芽の段階表示(zone2ルーティンカード)
  // ============================================================
  const ctxA = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 1000 } });
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log("  ❌ [A] pageerror:", e.message); });
  await blockGithubApiByDefault(pageA);
  await pageA.goto(`http://localhost:${PORT}/`);
  await pageA.waitForTimeout(500);
  await passGithubGate(pageA);

  async function stateNowA() {
    return pageA.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  console.log("[A0] ルーティン0件の日は「今日の芽」自体が非表示");
  await pageA.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = []; s.projects = []; s.blocks = []; s.gardenLog = {};
    s.selectedDate = TODAY; s.currentView = "home"; s.homeTab = "today";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await pageA.reload();
  await pageA.waitForTimeout(400);
  check("ルーティン0件では.home-gardenが存在しない", await pageA.locator(".home-garden").count() === 0);
  console.log("[A0b] ルーティン0件・既存gardenLogエントリも無い日は空エントリ{0,0}を書き込まない(レビュー必須4)");
  const sA0 = await stateNowA();
  check("gardenLog[TODAY]が作られていない({0,0}の無駄書き込み抑制)", sA0.gardenLog[TODAY] === undefined, JSON.stringify(sA0.gardenLog));

  console.log("[A1] 0件(達成0=土)は段階クラスも文言も出ない(罰なし・沈黙)");
  const blocks4 = [
    makeRoutineBlock("gdn-1", TODAY, "白湯を飲む", false),
    makeRoutineBlock("gdn-2", TODAY, "ストレッチ", false),
    makeRoutineBlock("gdn-3", TODAY, "日記を書く", false),
    makeRoutineBlock("gdn-4", TODAY, "早めに寝る準備", false)
  ];
  await pageA.evaluate(({ KEY, TODAY, blocks4 }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = []; s.projects = []; s.blocks = blocks4; s.gardenLog = {};
    s.selectedDate = TODAY; s.currentView = "home"; s.homeTab = "today";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY, blocks4 });
  await pageA.reload();
  await pageA.waitForTimeout(400);
  check(".home-gardenは存在する(ルーティンはある)", await pageA.locator(".home-garden").count() === 1);
  check("土(達成0)では段階クラスが無い", await pageA.locator(".home-garden-svg .g-stage1, .home-garden-svg .g-stage2, .home-garden-svg .g-stage3").count() === 0);
  check("土(達成0)では文言(caption)が無い", await pageA.locator(".home-garden-caption").count() === 0);

  async function toggle(id) {
    await pageA.click(`[data-action="toggle-block"][data-id="${id}"]`);
    await pageA.waitForTimeout(250);
  }
  async function stageComputedColor(n) {
    const el = pageA.locator(`.home-garden-svg .g-stage${n}`);
    if (await el.count() === 0) return null;
    return el.evaluate((node) => getComputedStyle(node).color);
  }
  async function gardenSnapshot() {
    return {
      stage1: await pageA.locator(".home-garden-svg .g-stage1").count(),
      stage2: await pageA.locator(".home-garden-svg .g-stage2").count(),
      stage3: await pageA.locator(".home-garden-svg .g-stage3").count(),
      grew: await pageA.locator(".home-garden-svg.garden-grew").count(),
      caption: (await pageA.locator(".home-garden-caption").count()) ? (await pageA.locator(".home-garden-caption").textContent()).trim() : null
    };
  }

  console.log("[A2] 1/4=25% → 芽(薄緑、g-stage1)+ フェードイン(段階が0→1へ上がった)");
  await toggle("gdn-1");
  let snap = await gardenSnapshot();
  check("1/4で芽(g-stage1)になる", snap.stage1 === 1 && snap.stage2 === 0 && snap.stage3 === 0, JSON.stringify(snap));
  check("1/4の文言は加点表現のみ", snap.caption === "今日は1件できた 🌱", snap.caption);
  check("段階が上がった直後はgarden-grewが付く", snap.grew === 1, JSON.stringify(snap));
  const colorStage1 = await stageComputedColor(1);
  check("芽(g-stage1)に色が付いている(空でない)", !!colorStage1, colorStage1);

  console.log("[A3] 2/4=50% → 若木(緑、g-stage2、境界値ちょうど50%)");
  await toggle("gdn-2");
  snap = await gardenSnapshot();
  check("2/4(50%)で若木(g-stage2)になる", snap.stage1 === 0 && snap.stage2 === 1 && snap.stage3 === 0, JSON.stringify(snap));
  check("2/4の文言", snap.caption === "今日は2件できた 🌿", snap.caption);
  check("50%到達で段階が上がった直後はgarden-grewが付く", snap.grew === 1, JSON.stringify(snap));
  const colorStage2 = await stageComputedColor(2);
  check("若木(g-stage2)の色は芽(g-stage1)と異なる(レビュー必須3: 段階ごとに別トークン)", colorStage2 && colorStage2 !== colorStage1, `stage1=${colorStage1} stage2=${colorStage2}`);

  console.log("[A4] 3/4=75% → 引き続き若木(段階は変わらない → フェードは付かない)");
  await toggle("gdn-3");
  snap = await gardenSnapshot();
  check("3/4(75%)も若木のまま(g-stage2)", snap.stage1 === 0 && snap.stage2 === 1 && snap.stage3 === 0, JSON.stringify(snap));
  check("3/4の文言", snap.caption === "今日は3件できた 🌿", snap.caption);
  check("段階が変わらない操作にはgarden-grewが付かない", snap.grew === 0, JSON.stringify(snap));

  console.log("[A5] 4/4=100% → 開花(濃緑、g-stage3)+ フェードイン");
  await toggle("gdn-4");
  snap = await gardenSnapshot();
  check("4/4(100%)で開花(g-stage3)になる", snap.stage1 === 0 && snap.stage2 === 0 && snap.stage3 === 1, JSON.stringify(snap));
  check("4/4の文言", snap.caption === "今日は4件できた 🌸", snap.caption);
  check("全完了到達で段階が上がった直後はgarden-grewが付く", snap.grew === 1, JSON.stringify(snap));
  const colorStage3 = await stageComputedColor(3);
  check("開花(g-stage3)の色は芽・若木のどちらとも異なる(3段階とも別トークン)",
    colorStage3 && colorStage3 !== colorStage1 && colorStage3 !== colorStage2,
    `stage1=${colorStage1} stage2=${colorStage2} stage3=${colorStage3}`);
  const sA5 = await stateNowA();
  check("gardenLog[TODAY]は4/4を記録している", sA5.gardenLog[TODAY] && sA5.gardenLog[TODAY].done === 4 && sA5.gardenLog[TODAY].total === 4, JSON.stringify(sA5.gardenLog[TODAY]));

  console.log("[A6] 完了を取り消す(4/4→3/4)。ライブ表示は現状に追従して下がるが、データ層(gardenLog)のdoneは下がらない(レビュー必須1)");
  await toggle("gdn-4");  // 完了解除
  snap = await gardenSnapshot();
  check("取り消し後、ライブ表示は3/4相当の若木(g-stage2)に戻る", snap.stage1 === 0 && snap.stage2 === 1 && snap.stage3 === 0, JSON.stringify(snap));
  check("段階が下がる操作にはgarden-grewが付かない", snap.grew === 0, JSON.stringify(snap));
  const sA6 = await stateNowA();
  check("取り消し後もgardenLog[TODAY].doneは4のまま(データ層は下がらない、フィールド別maxマージ)",
    sA6.gardenLog[TODAY] && sA6.gardenLog[TODAY].done === 4 && sA6.gardenLog[TODAY].total === 4,
    JSON.stringify(sA6.gardenLog[TODAY]));

  console.log("[A7] 再読込後もライブ表示は正しい段階のまま(非永続フラグはクリアされる)");
  await pageA.reload();
  await pageA.waitForTimeout(400);
  snap = await gardenSnapshot();
  check("再読込後も3/4=若木のまま", snap.stage2 === 1 && snap.stage1 === 0 && snap.stage3 === 0, JSON.stringify(snap));
  check("再読込後はgarden-grewが残らない(非永続)", snap.grew === 0, JSON.stringify(snap));
  const sA7 = await stateNowA();
  check("再読込後もgardenLog[TODAY].doneは4のまま(データ層は維持される)", sA7.gardenLog[TODAY] && sA7.gardenLog[TODAY].done === 4 && sA7.gardenLog[TODAY].total === 4, JSON.stringify(sA7.gardenLog[TODAY]));

  await ctxA.close();

  // ============================================================
  // Part B: normalizeState 後方互換(gardenLog)
  // ============================================================
  const ctxB = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log("  ❌ [B] pageerror:", e.message); });
  await blockGithubApiByDefault(pageB);
  await pageB.goto(`http://localhost:${PORT}/`);
  await pageB.waitForTimeout(500);
  await passGithubGate(pageB);

  console.log("[B1] gardenLogフィールド自体が無い旧state → 空オブジェクトへ補完(クラッシュしない)");
  await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    delete s.gardenLog;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await pageB.reload();
  await pageB.waitForTimeout(400);
  let sB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  check("gardenLog無し旧stateは{}へ補完される", sB.gardenLog && typeof sB.gardenLog === "object" && !Array.isArray(sB.gardenLog));
  check("pageerrorなし(クラッシュしない)", true);  // pageerrorハンドラで既にfailures計上済み

  console.log("[B2] gardenLogが不正な型(配列)→ 空オブジェクトへリセット");
  await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.gardenLog = ["broken", "array"];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await pageB.reload();
  await pageB.waitForTimeout(400);
  sB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  check("配列だったgardenLogは{}へリセットされる", sB.gardenLog && typeof sB.gardenLog === "object" && !Array.isArray(sB.gardenLog));

  console.log("[B3] 既存の正常なgardenLogは補完で壊されない");
  await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.gardenLog = { "2026-01-01": { done: 2, total: 3 } };
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await pageB.reload();
  await pageB.waitForTimeout(400);
  sB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  check("既存の正常なgardenLogエントリは維持される", sB.gardenLog && sB.gardenLog["2026-01-01"] && sB.gardenLog["2026-01-01"].done === 2 && sB.gardenLog["2026-01-01"].total === 3, JSON.stringify(sB.gardenLog));

  await ctxB.close();

  // ============================================================
  // Part C: フィールド別maxマージ(レビュー必須1・4)
  // ============================================================
  const ctxC = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageC = await ctxC.newPage();
  pageC.on("pageerror", (e) => { failures++; console.log("  ❌ [C] pageerror:", e.message); });
  await blockGithubApiByDefault(pageC);
  await pageC.goto(`http://localhost:${PORT}/`);
  await pageC.waitForTimeout(500);
  await passGithubGate(pageC);

  console.log("[C1] 前日の既存gardenLogスナップショット(繰り返し実体purge後を模擬=当日Blockは無い)を用意");
  await pageC.evaluate(({ KEY, YESTERDAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // YESTERDAY分のルーティンBlockは無い状態(=RECURRENCE_KEEP_PAST_DAYS超過でpurge済みを模擬)。
    // 既存デフォルトのProject/Task(12週サイクル用)はそのまま残し、toggle-task用に使う。
    s.blocks = s.blocks.filter((b) => b.date !== YESTERDAY);
    s.gardenLog = { [YESTERDAY]: { done: 3, total: 4 } };  // purge前のより良いスナップショット
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, YESTERDAY });
  await pageC.reload();
  await pageC.waitForTimeout(400);
  // v85: reload直後はselectedDateが実時計の今日へ強制される。前日ボタンでセッション内移動する。
  await pageC.click('[data-action="date-prev"]');
  await pageC.waitForTimeout(200);

  const taskIdForToggle = await pageC.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const t = s.tasks.find((t) => !t.deleted && t.status === "todo" && t.projectId && s.projects.find((p) => p.id === t.projectId && p.kind === "normal" && p.twelveWeekStartDate));
    return t ? t.id : null;
  }, KEY);
  check("12週サイクルの日付非依存タスクが既定シードに存在する", !!taskIdForToggle);

  console.log("[C2] 前日を閲覧中にsaveStateを伴う操作(タスク完了)を行っても、前日gardenLog(total全滅パターン)は悪化上書きされない");
  await pageC.click(`[data-action="toggle-task"][data-id="${taskIdForToggle}"]`);
  await pageC.waitForTimeout(300);
  const sC2 = await pageC.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  check("selectedDateは前日のまま", sC2.selectedDate === YESTERDAY, sC2.selectedDate);
  check("前日のgardenLog(既存値がdone/totalとも上回る)は上書きされず維持される",
    sC2.gardenLog[YESTERDAY] && sC2.gardenLog[YESTERDAY].done === 3 && sC2.gardenLog[YESTERDAY].total === 4,
    JSON.stringify(sC2.gardenLog[YESTERDAY]));
  check("当日(TODAY)はルーティン0件・既存エントリも無いため空エントリを書かない(レビュー必須4)",
    sC2.gardenLog[TODAY] === undefined, JSON.stringify(sC2.gardenLog[TODAY]));

  console.log("[C3] 「done同値・total縮小」の穴の回帰確認(レビュー必須1で指摘された具体的な改竄パターン): "
    + "既存{done:4,total:5}に対し実体purgeで再計算が{done:4,total:4}になっても、4/5(80%)が4/4(100%)へ改竄されない");
  await pageC.evaluate(({ KEY, TODAY, YESTERDAY, taskIdForToggle }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // C2でtoggle-taskしたタスクをtodoへ戻す(completed状態だとisTaskDead()判定でホームの
    // 12週サイクルからチェックボックスが消え、C3のトリガー操作が押せなくなるため)。
    s.tasks = s.tasks.map((t) => t.id === taskIdForToggle ? { ...t, status: "todo" } : t);
    // TODAY: 完了済みルーティン4件のみ実在(=5件目の未完了分がpurgeされた後を模擬)。
    // 既存gardenLog[TODAY]は5件だった頃のスナップショット{done:4,total:5}。
    s.blocks = s.blocks.filter((b) => b.date !== TODAY || b.category !== "ルーティン");
    s.blocks.push(
      { id: "gdn-c3-1", taskId: "", date: TODAY, title: "運動", category: "ルーティン", plannedStartAt: `${TODAY}T06:00`, plannedEndAt: `${TODAY}T06:10`, actualStartAt: "", actualEndAt: "", completed: true, charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
      { id: "gdn-c3-2", taskId: "", date: TODAY, title: "読書", category: "ルーティン", plannedStartAt: `${TODAY}T06:20`, plannedEndAt: `${TODAY}T06:30`, actualStartAt: "", actualEndAt: "", completed: true, charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
      { id: "gdn-c3-3", taskId: "", date: TODAY, title: "日記", category: "ルーティン", plannedStartAt: `${TODAY}T06:40`, plannedEndAt: `${TODAY}T06:50`, actualStartAt: "", actualEndAt: "", completed: true, charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
      { id: "gdn-c3-4", taskId: "", date: TODAY, title: "瞑想", category: "ルーティン", plannedStartAt: `${TODAY}T07:00`, plannedEndAt: `${TODAY}T07:10`, actualStartAt: "", actualEndAt: "", completed: true, charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
    );
    s.gardenLog[TODAY] = { done: 4, total: 5 };
    s.selectedDate = YESTERDAY;  // toggle-task操作をtoday以外の日付から行う(=updateGardenLog(todayISO())経由でTODAYがupsertされることを確認するため)
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY, YESTERDAY, taskIdForToggle });
  await pageC.reload();
  await pageC.waitForTimeout(400);
  await pageC.click('[data-action="date-prev"]');  // reload直後にtodayへ強制されるためもう一度前日へ
  await pageC.waitForTimeout(200);
  await pageC.click(`[data-action="toggle-task"][data-id="${taskIdForToggle}"]`);
  await pageC.waitForTimeout(300);
  const sC3 = await pageC.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  check("「done同値・total縮小」でも4/5(80%)のまま(4/4=全完了へ改竄されない)",
    sC3.gardenLog[TODAY] && sC3.gardenLog[TODAY].done === 4 && sC3.gardenLog[TODAY].total === 5,
    JSON.stringify(sC3.gardenLog[TODAY]));

  await ctxC.close();

  // ============================================================
  // Part D: gardenLogの端末間同期マージ(レビュー必須2、データ消失クラス)
  // ============================================================
  console.log("[D] gardenLogの同期マージ: ローカル限定エントリはリモート採用後も残り、共有日付はフィールド別maxで統合される");
  const ctxD = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const pageD = await ctxD.newPage();
  pageD.on("pageerror", (e) => { failures++; console.log("  ❌ [D] pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDateD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(22, 0, 0, 0);  // 日中固定(深夜跨ぎ回避、v103と同じ理由)
  const D_TODAY = isoDateD(now0);

  function contentsBodyFor(obj) {
    const jsonText = JSON.stringify(obj);
    const b64 = Buffer.from(jsonText, "utf-8").toString("base64");
    const chunked = (b64.match(/.{1,60}/g) || []).join("\n");
    return JSON.stringify({ name: "app-state.json", path: "taskchute/app-state.json", sha: "sha-v153", content: chunked, encoding: "base64" });
  }
  function remoteState(dataModifiedAt, gardenLogOverride) {
    return {
      dataModifiedAt,
      currentView: "home",
      selectedDate: D_TODAY,
      blocks: [], projects: [], tasks: [], settings: {},
      gardenLog: gardenLogOverride
    };
  }

  const fixtures = { status: 404, body: null };
  await blockGithubApiByDefault(pageD);
  await pageD.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`) {
      if (fixtures.status === 200) return route.fulfill({ status: 200, contentType: "application/json", body: fixtures.body });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await pageD.clock.setFixedTime(now0);
  await pageD.goto(`http://localhost:${PORT}/`);
