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
