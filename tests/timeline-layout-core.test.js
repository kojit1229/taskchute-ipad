// tests/timeline-layout-core.test.js — 段階4-5抽出(タイムライン段階A: 純粋レーン割付計算)の
// characterization test。対象: src/features/timeline-layout.js(configureTimelineLayout(deps)に
// よる依存注入。routine.js等と同じ抽出パターン)。
//
// [PHASE1-VM→PHASE2-DYNAMIC IMPORT] 抽出作業中、まずapp.js(v170時点・抽出前)に対して
// vm.runInContextでassignBlocksToLanes/adjustLaneTopPositionsを直接実行し、本ファイルの
// assertion一式を抽出前の実挙動として先に緑化した(v163.test.js方式)。移動後の本バージョンは
// 同じassertionをdynamic import + configureTimelineLayout(deps)経由に差し替えたもので、
// 期待値・検証項目は1つも変更・削除していない(参照先の差し替えのみ、既存characterization test
// 冒頭コメントと同じ扱い)。
//
// §6のギャップ対応: [1]空入力 [2]非重複 [3]重複によるレーン分割 [4]v150(20分未満Blockの
// min-height換算による実効終了時刻クラスタ判定) [5]maxLanes超過時のoverflow [6]actualモード・
// actualEndAt未設定時のnowDateTime()フォールバック(nowDateTimeを固定値注入することで壁時計
// 依存を排除して固定できるようになった項目) [7]adjustLaneTopPositionsの5分未満min-height。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const TIMELINE_LAYOUT_PATH = path.join(ROOT, "src", "features", "timeline-layout.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// app.js側の実装と同一のヘルパー(依存注入のスタブ。app.js側のminutesOf(L15056相当)をそのまま再現)。
function minutesOf(dateTime) {
  if (!dateTime) return 0;
  const m1 = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  const m2 = /^(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return 0;
}

let nowDateTimeStub = () => "2026-07-29T09:20:00";

function block(id, extra = {}) {
  return { id, plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "", ...extra };
}

async function loadModule() {
  const mod = await import(pathToFileURL(TIMELINE_LAYOUT_PATH).href);
  mod.configureTimelineLayout({ minutesOf, nowDateTime: (...args) => nowDateTimeStub(...args) });
  return mod;
}

(async () => {
  const { assignBlocksToLanes, adjustLaneTopPositions } = await loadModule();

  console.log("[1] 空入力: 両関数とも空配列を返す");
  {
    check("assignBlocksToLanes([])は[]", JSON.stringify(assignBlocksToLanes([], "planned", 5, 60)) === "[]");
    check("adjustLaneTopPositions([])は[]", JSON.stringify(adjustLaneTopPositions([], 60, 5)) === "[]");
  }

  console.log("[2] 重ならない2Block(実時間ギャップあり・20分以上): laneCount=1で両方lane0");
  {
    const blocks = [
      block("a", { plannedStartAt: "2026-07-29T09:00", plannedEndAt: "2026-07-29T09:30" }),
      block("b", { plannedStartAt: "2026-07-29T10:00", plannedEndAt: "2026-07-29T10:30" })
    ];
    const result = assignBlocksToLanes(blocks, "planned", 5, 60);
    check("2件とも返る", result.length === 2, JSON.stringify(result));
    check("aはlane0/laneCount1", result[0].lane === 0 && result[0].laneCount === 1, JSON.stringify(result[0]));
    check("bはlane0/laneCount1(別クラスタ)", result[1].lane === 0 && result[1].laneCount === 1, JSON.stringify(result[1]));
  }

  console.log("[3] 重なる2Block(20分以上・実時間で重複): laneCount=2でlane0/lane1に分割");
  {
    const blocks = [
      block("a", { plannedStartAt: "2026-07-29T09:00", plannedEndAt: "2026-07-29T09:30" }),
      block("b", { plannedStartAt: "2026-07-29T09:15", plannedEndAt: "2026-07-29T09:45" })
    ];
    const result = assignBlocksToLanes(blocks, "planned", 5, 60);
    const a = result.find((r) => r.block.id === "a");
    const b = result.find((r) => r.block.id === "b");
    check("aはlane0", a.lane === 0, JSON.stringify(a));
    check("bはlane1(aと重なるため新レーン)", b.lane === 1, JSON.stringify(b));
    check("両方laneCount2", a.laneCount === 2 && b.laneCount === 2);
  }

  console.log("[4] v150: 実時間では重ならない20分未満Block同士がmin-height換算で重なり判定される");
  {
    // a: 09:00-09:10(10分)。b: 09:12-09:20(8分)。実時間はa終了(550)<=b開始(552)で非重複だが、
    // min-height(38px、rowHeight=60)換算のclusterEndがbの開始に食い込むため横レーン分割される。
    const blocks = [
      block("a", { plannedStartAt: "2026-07-29T09:00", plannedEndAt: "2026-07-29T09:10" }),
      block("b", { plannedStartAt: "2026-07-29T09:12", plannedEndAt: "2026-07-29T09:20" })
    ];
    const result = assignBlocksToLanes(blocks, "planned", 5, 60);
    const a = result.find((r) => r.block.id === "a");
    const b = result.find((r) => r.block.id === "b");
    check("実時間では重ならないのにlaneCount2(min-height食い込みで分割)", a.laneCount === 2 && b.laneCount === 2, JSON.stringify(result));
    check("aはlane0/bはlane1", a.lane === 0 && b.lane === 1, JSON.stringify(result));
  }

  console.log("[5] maxLanes超過: 3件全重複+maxLanes=2で3件目がoverflow(最終レーンへ重ね置き)");
  {
    const blocks = [
      block("a", { plannedStartAt: "2026-07-29T09:00", plannedEndAt: "2026-07-29T10:00" }),
      block("b", { plannedStartAt: "2026-07-29T09:10", plannedEndAt: "2026-07-29T10:10" }),
      block("c", { plannedStartAt: "2026-07-29T09:20", plannedEndAt: "2026-07-29T10:20" })
    ];
    const result = assignBlocksToLanes(blocks, "planned", 2, 60);
    const a = result.find((r) => r.block.id === "a");
    const b = result.find((r) => r.block.id === "b");
    const c = result.find((r) => r.block.id === "c");
    check("a/bは新規レーン(lane0/lane1)でisOverflow=false", a.lane === 0 && !a.isOverflow && b.lane === 1 && !b.isOverflow, JSON.stringify(result));
    check("cはmaxLanes超過でlane1(最終レーン)にisOverflow=trueで重ね置き", c.lane === 1 && c.isOverflow === true, JSON.stringify(c));
    check("laneCountは3件とも2(clusterLaneEnds.length)", a.laneCount === 2 && b.laneCount === 2 && c.laneCount === 2);
  }

  console.log("[6] actualモード・actualEndAt未設定: nowDateTime()注入値で終了時刻がフォールバックされる");
  {
    nowDateTimeStub = () => "2026-07-29T09:20:00";
    const blocks = [block("a", { actualStartAt: "2026-07-29T09:00", actualEndAt: "" })];
    const result = assignBlocksToLanes(blocks, "actual", 5, 60);
    const a = result[0];
    check("start=540(09:00)", a.start === 540, JSON.stringify(a));
    check("end=560(注入したnowDateTime 09:20由来)", a.end === 560, JSON.stringify(a));
    check("clusterEnd=560(所要20分ちょうどはv150の20分未満条件に該当せず無補正)", a.clusterEnd === 560, JSON.stringify(a));

    const positioned = adjustLaneTopPositions(result, 60, 5);
    check("top=240((540-300)/60*60)", positioned[0].top === 240, JSON.stringify(positioned[0]));
    check("height=38(20分想定=20pxだがmin-height38pxが優先)", positioned[0].height === 38, JSON.stringify(positioned[0]));
    check("isShort=false(20分は5分未満ではない)", positioned[0].isShort === false);
  }

  console.log("[7] adjustLaneTopPositions: 5分未満Blockはmin-height 14pxが優先される");
  {
    const assignments = [{ start: 540, end: 543, keep: "marker" }];
    const positioned = adjustLaneTopPositions(assignments, 60, 5);
    check("top=240", positioned[0].top === 240, JSON.stringify(positioned[0]));
    check("isShort=true(3分<5分)", positioned[0].isShort === true);
    check("height=14(3分換算3pxよりmin-height14pxが優先)", positioned[0].height === 14, JSON.stringify(positioned[0]));
    check("元のプロパティ(keep)がspreadで保持される", positioned[0].keep === "marker");
  }

  console.log(failures === 0 ? "\ntimeline-layout-core: 全件成功" : `\ntimeline-layout-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
