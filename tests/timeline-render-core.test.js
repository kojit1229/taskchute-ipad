// tests/timeline-render-core.test.js — 段階4-6抽出(タイムライン段階B: 描画系)の
// characterization test。prep-stage4-timeline.md §7「段階B」①②③。
// 対象: src/features/timeline.js(configureTimeline(deps)による依存注入。routine.js/
// timeline-layout.js等と同じ抽出パターン)。
//
// renderTimelineCard/renderEnergyGraphの出力(inline styleのtop/height/left/width計算、SVG点列)は
// 監査P0(タイムライン絶対配置CSSとの契約)の正典であるため、抽出前のapp.js実装をそのまま読み、
// 期待値をここで固定してから移動する(既存characterization testと同じ「実装をそのまま
// 固定する」方針。exact文字列一致ではなく、構造的に壊れやすい箇所(style属性の各プロパティ値・
// ボタンの有無・data-*属性・エスケープ)を正規表現抽出して検証することで、空白差分など無関係な
// 変更にまでテストが過敏に反応しないようにする)。
//
// [1]renderTimelineCard基本(top/height/left/width・▶いま開始・○完了登録) [2]completed→↺のみ
// [3]inProgress→■いま終了 [4]isShort→開始/完了ボタンとも非表示 [5]isActual→開始/完了ボタンとも非表示
// [6]isOverflow→data-overflow="true" [7]カテゴリ色反映 [8]laneCount2・lane1→left50%/width計算
// [9]migrationBadge+leverageTypeMark [10]タイトルのHTMLエスケープ
// [11-17]renderEnergyGraph: energy/batteryモード切替・compact強制フォールバック・過去日フォールバック・
//   起点/終値ラベル・batteryLast表示・データなし表示
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const TIMELINE_PATH = path.join(ROOT, "src", "features", "timeline.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---- app.js側の実装と同一(相当)のヘルパー(依存注入のスタブ) ----
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
// app.js:migrationBadgeHTML(L4975相当)そのまま
function migrationBadgeHTML(carryCount) {
  const n = Number(carryCount || 0);
  return n >= 2 ? `<span class="migration-badge" title="${n}回目の繰り越しです">↻${n}</span>` : "";
}
// app.js:leverageTypeMarkHTML(L4913相当)そのまま(leverageTypeLabelも同梱)
function leverageTypeLabel(type) {
  return ({ asset: "資産", eliminate: "削減", oneoff: "単発" })[type] || "";
}
function leverageTypeMarkHTML(type) {
  const icon = ({ asset: "⚙", eliminate: "✂" })[type];
  return icon ? `<span class="lev-mark lev-${type}" title="${leverageTypeLabel(type)}(10x機構)">${icon}${leverageTypeLabel(type)}</span>` : "";
}
let categoryColorMap = {};
function getCategoryColor(name) { return name ? (categoryColorMap[name] || "#8E8E93") : "#8E8E93"; }
function minutesOf(dateTime) {
  if (!dateTime) return 0;
  const m1 = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  const m2 = /^(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return 0;
}
function pad2(value) { return String(value).padStart(2, "0"); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
let todayISOValue = "2026-07-29";
function todayISO() { return todayISOValue; }
function renderHeader(eyebrow, title) { return `<div class="stub-header">${eyebrow}/${title}</div>`; }
function renderDateBar() { return `<div class="stub-datebar"></div>`; }
function formatDisplayDate(date) { return `${date}(stub)`; }
let batterySettingsStub = { start: { deficit: 30, low: 40, normal: 50 }, decayPerHour: 3, decayStartMinutes: 420, max: 50, recoveryDraft: false, recoveryThresholdPct: 40 };
function defaultBatterySettings() { return batterySettingsStub; }
let conditionBudgetLevel = "normal";
function conditionBudget() { return { level: conditionBudgetLevel, reason: "" }; }
let batteryCurvePointsStub = [];
function batteryCurvePoints() { return batteryCurvePointsStub; }

let draftBarHTMLCalls = 0;
function draftBarHTML() { draftBarHTMLCalls++; return "<div class=\"stub-draftbar\"></div>"; }
function draftRejectReasonPickerHTML() { return ""; }
function renderDraftLayer() { return "<div class=\"stub-draftlayer\"></div>"; }
let scheduleDraftActiveValue = false;
function scheduleDraftActive() { return scheduleDraftActiveValue; }
let renderCalls = 0;
function render() { renderCalls++; }

function block(id, extra = {}) {
  return {
    id, title: id, category: "", completed: false, carryCount: 0, leverageType: "",
    actualStartAt: "", actualEndAt: "", charge: 0, discharge: 0,
    expectedCharge: "", expectedDischarge: "", plannedStartAt: "", plannedEndAt: "",
    ...extra
  };
}

function positioned(overrides = {}) {
  return {
    block: block("b1"), startStr: "2026-07-29T09:00", endStr: "2026-07-29T10:00",
    lane: 0, isOverflow: false, top: 120, height: 60, isShort: false, laneCount: 1,
    ...overrides
  };
}

// styleプロパティの値を1つ抽出(例: extractStyleProp(html, "top") → "120px")
function extractStyleProp(html, prop) {
  const m = new RegExp(`style="[^"]*\\b${prop}:\\s*([^;"]+)`).exec(html);
  return m ? m[1].trim() : null;
}

async function loadModule() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const timelineMod = await import(pathToFileURL(TIMELINE_PATH).href);
  timelineMod.configureTimeline({
    escapeHTML, getCategoryColor, migrationBadgeHTML, leverageTypeMarkHTML,
    minutesOf, todayISO, pad2, clamp, formatDisplayDate,
    renderHeader, renderDateBar,
    defaultBatterySettings, batteryCurvePoints, conditionBudget,
    draftBarHTML, draftRejectReasonPickerHTML, renderDraftLayer,
    scheduleDraftActive, render,
    timelineRailEl: { style: {}, innerHTML: "" },
    appRootEl: { style: {} }
  });
  return { storeMod, timelineMod };
}

(async () => {
  const { storeMod, timelineMod } = await loadModule();
  const { renderTimelineCard, renderEnergyGraph } = timelineMod;

  storeMod.setState({
    selectedDate: "2026-07-29",
    timelineZoom: 1, timelineMode: "planned", currentView: "timeline",
    settings: { categories: [], morningEnergyLog: {}, battery: batterySettingsStub, timelineEnergyGraphMode: "energy", timelineCategoryFilter: "", sidebarCollapsed: false }
  });

  console.log("[1] renderTimelineCard基本: 予定モード・未完了・未着手・laneCount1");
  {
    const html = renderTimelineCard(positioned(), "planned", 5);
    check("top=120px", extractStyleProp(html, "top") === "120px", html);
    check("height=60px", extractStyleProp(html, "height") === "60px", html);
    check("left=0%", extractStyleProp(html, "left") === "0%", html);
    check("width=calc(100% - 4px)", extractStyleProp(html, "width") === "calc(100% - 4px)", html);
    check("▶いま開始ボタンあり", html.includes('data-action="now-start" data-id="b1"'), html);
    check("○完了登録ボタンあり", html.includes('data-action="toggle-block" data-id="b1"') && html.includes("完了登録"), html);
    check("data-action=edit-blockでカード全体がクリック領域", html.includes('data-action="edit-block" data-id="b1"'), html);
  }

  console.log("[2] completed=true: ↺(完了解除)のみ、▶/■は出ない");
  {
    const html = renderTimelineCard(positioned({ block: block("b2", { completed: true }) }), "planned", 5);
    check("↺完了解除ボタンがある", html.includes("完了を解除") && html.includes("done"), html);
    check("いま開始ボタンは出ない", !html.includes("now-start"), html);
    check("いま終了ボタンは出ない", !html.includes("now-end"), html);
    check("completedクラスが付く", /class="timeline-card\s+completed/.test(html), html);
  }

  console.log("[3] 着手済み・未完了(inProgress): ■いま終了ボタン");
  {
    const html = renderTimelineCard(positioned({ block: block("b3", { actualStartAt: "2026-07-29T09:05" }) }), "planned", 5);
    check("■いま終了ボタンがある", html.includes('data-action="now-end" data-id="b3"'), html);
    check("▶いま開始ボタンは出ない(着手済みのため)", !html.includes("now-start"), html);
  }

  console.log("[4] isShort=true: 開始/完了ボタンとも非表示");
  {
    const html = renderTimelineCard(positioned({ isShort: true }), "planned", 5);
    check("いま開始ボタンなし", !html.includes("now-start"), html);
    check("完了登録ボタンなし", !html.includes("toggle-block"), html);
    check("is-shortクラスが付く", html.includes("is-short"), html);
  }

  console.log("[5] isActual=true(実績モード): 開始/完了ボタンとも非表示");
  {
    const html = renderTimelineCard(positioned(), "actual", 5);
    check("いま開始ボタンなし", !html.includes("now-start"), html);
    check("完了登録ボタンなし", !html.includes("toggle-block"), html);
    check("is-actualクラスが付く", html.includes("is-actual"), html);
  }

  console.log("[6] isOverflow=true: data-overflow=\"true\"");
  {
    const html = renderTimelineCard(positioned({ isOverflow: true }), "planned", 5);
    check('data-overflow="true"が付く', html.includes('data-overflow="true"'), html);
  }

  console.log("[7] カテゴリ色反映: getCategoryColorの戻り値がbackground/border-left/colorに使われる");
  {
    categoryColorMap = { "仕事": "#ff0000" };
    const html = renderTimelineCard(positioned({ block: block("b7", { category: "仕事" }) }), "planned", 5);
    check("背景色に反映", html.includes("background:#ff0000"), html);
    check("border-leftに反映", html.includes("border-left:4px solid #ff0000"), html);
    categoryColorMap = {};
  }

  console.log("[8] laneCount2・lane1: left=50%/width=calc(50% - 4px)");
  {
    const html = renderTimelineCard(positioned({ lane: 1, laneCount: 2 }), "planned", 5);
    check("left=50%", extractStyleProp(html, "left") === "50%", html);
    check("width=calc(50% - 4px)", extractStyleProp(html, "width") === "calc(50% - 4px)", html);
  }

  console.log("[9] migrationBadge(carryCount>=2)+leverageTypeMark(asset)");
  {
    const html = renderTimelineCard(positioned({ block: block("b9", { carryCount: 3, leverageType: "asset" }) }), "planned", 5);
    check("繰り越しバッジ↻3が出る", html.includes("↻3"), html);
    check("資産マーク⚙が出る", html.includes("lev-mark lev-asset") && html.includes("⚙"), html);
  }

  console.log("[10] タイトルのHTMLエスケープ");
  {
    const html = renderTimelineCard(positioned({ block: block("b10", { title: '<script>&"\'' }) }), "planned", 5);
    check("<がエスケープされる", html.includes("&lt;script&gt;"), html);
    check("生の<script>は出ない", !html.includes("<script>"), html);
  }

  console.log("[11] renderEnergyGraph: energyモード・当日・完了1件+未完了1件で実線/予測線が出る");
  {
    todayISOValue = "2026-07-29";
    storeMod.setState({
      selectedDate: "2026-07-29",
      settings: { categories: [], morningEnergyLog: { "2026-07-29": 5 }, battery: batterySettingsStub, timelineEnergyGraphMode: "energy" }
    });
    const blocks = [
      block("e1", { completed: true, actualEndAt: "2026-07-29T09:00", charge: 3, discharge: 1 }),
      block("e2", { completed: false, plannedEndAt: "2026-07-29T12:00", expectedCharge: 2, expectedDischarge: 0 })
    ];
    const html = renderEnergyGraph(blocks, 60, 5, 24, false);
    check("energy-graph-overlayコンテナがある", html.includes('class="energy-graph-overlay"'), html);
    check("実線(polyline、dash無し)が出る", /<polyline points="[^"]+" stroke="#2fb96d"/.test(html), html);
    check("予測線(polyline、dash付き)が出る", /<polyline points="[^"]+" stroke="#7b61ff"[^>]*stroke-dasharray/.test(html), html);
    check("起点ラベルに朝の値5が出る", html.includes("起点 5"), html);
    check("バッテリー系列は出ない(energyモードのため)", !html.includes("battery-curve\""), html);
  }

  console.log("[12] renderEnergyGraph: batteryモード・当日・compact=false → バッテリー系列が出る");
  {
    storeMod.setState({
      selectedDate: "2026-07-29",
      settings: { categories: [], morningEnergyLog: { "2026-07-29": 5 }, battery: batterySettingsStub, timelineEnergyGraphMode: "battery" }
    });
    batteryCurvePointsStub = [{ minute: 0, value: 30 }, { minute: 600, value: 20 }];
    const html = renderEnergyGraph([], 60, 5, 24, false);
    check("battery-curveのpolylineが出る", html.includes('class="battery-curve"'), html);
    check("残量ラベルにbatteryLast(20)が出る", html.includes("🔋残量 20"), html);
    check("エネルギー系のラベルは出ない(batteryモードのため)", !html.includes("起点"), html);
    batteryCurvePointsStub = [];
  }

  console.log("[13] renderEnergyGraph: compact=trueはbatteryモード設定でも強制的にenergyへフォールバック");
  {
    storeMod.setState({
      selectedDate: "2026-07-29",
      settings: { categories: [], morningEnergyLog: { "2026-07-29": 5 }, battery: batterySettingsStub, timelineEnergyGraphMode: "battery" }
    });
    const html = renderEnergyGraph([], 60, 5, 24, true);
    check("compact=trueではbatteryモード設定でもenergy表示にフォールバック", html.includes("起点"), html);
  }

  console.log("[14] renderEnergyGraph: 過去日(!isToday)はbatteryモード設定でもenergyへフォールバック");
  {
    storeMod.setState({
      selectedDate: "2026-07-28",
      settings: { categories: [], morningEnergyLog: { "2026-07-28": 5 }, battery: batterySettingsStub, timelineEnergyGraphMode: "battery" }
    });
    const html = renderEnergyGraph([], 60, 5, 24, false);
    check("過去日ではenergy表示にフォールバック", html.includes("起点"), html);
  }

  console.log("[15] renderEnergyGraph: batteryPtsが空ならデータなし表示");
  {
    storeMod.setState({
      selectedDate: "2026-07-29",
      settings: { categories: [], morningEnergyLog: { "2026-07-29": 5 }, battery: batterySettingsStub, timelineEnergyGraphMode: "battery" }
    });
    batteryCurvePointsStub = [];
    const html = renderEnergyGraph([], 60, 5, 24, false);
    check("データなし表示が出る", html.includes("データなし"), html);
  }

  console.log(failures === 0 ? "\ntimeline-render-core: 全件成功" : `\ntimeline-render-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
