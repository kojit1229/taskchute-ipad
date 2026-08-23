// v247: INSTRUMENTSの早起き・構造化IRON期間統計と積み上げ棒DOMを固定するNodeテスト。
const path = require("path");
const { pathToFileURL } = require("url");

const MODULE_PATH = path.join(__dirname, "..", "src", "features", "instruments.js");
const TODAY = "2026-08-23";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

function weekRange(dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekStart = addDays(dateISO, -((date.getDay() + 1) % 7));
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

const escapeHTML = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const set = (date, exercise, weight, reps) => ({ exercise, weight, reps, at: `${date}T09:00:00` });
const stateWith = (sets, extra = {}) => ({
  ...extra,
  // 格納キーを意図的にatとずらし、期間集計がset.at基準であることも同時に固定する。
  condition: { logs: { "2099-12-31": { gym: sets } } }
});

(async () => {
  const { configureInstruments, renderInstruments, earlyBirdStats, ironPeriodStats } =
    await import(pathToFileURL(MODULE_PATH).href);

  configureInstruments({
    getState: () => ({}), escapeHTML, todayISO: () => TODAY, addDays, weekRange,
    renderHeader: () => "", registerActions: () => {}
  });

  console.log("[1] 早起きストリークと年間境界");
  const early = earlyBirdStats({ earlyBird: { logs: {
    "2025-12-31": {}, "2026-01-01": {}, "2026-08-22": {}, "2026-08-23": {}, "2026-08-24": {}
  } } }, TODAY);
  check("当日まで2日連続", early.currentStreak === 2, `got ${early.currentStreak}`);
  check("今年1/1〜今日だけ3回", early.yearCount === 3, `got ${early.yearCount}`);

  console.log("[2] ジム週ストリーク: 土〜金の連続・途切れ・今週進行中");
  const continuous = ironPeriodStats(stateWith([
    set("2026-08-23", "ベンチプレス", 60, 10),
    set("2026-08-21", "スクワット", 80, 5),
    set("2026-08-14", "ベンチプレス", 50, 6)
  ]), TODAY);
  check("土曜境界を跨ぐ3週連続", continuous.gymStreakWeeks === 3, `got ${continuous.gymStreakWeeks}`);
  const broken = ironPeriodStats(stateWith([
    set("2026-08-23", "ベンチプレス", 60, 10), set("2026-08-14", "ベンチプレス", 50, 6)
  ]), TODAY);
  check("中間週が空なら現在週だけの1週", broken.gymStreakWeeks === 1, `got ${broken.gymStreakWeeks}`);
  const inProgress = ironPeriodStats(stateWith([
    set("2026-08-21", "スクワット", 80, 5), set("2026-08-14", "ベンチプレス", 50, 6)
  ]), TODAY);
  check("今週未記録でも完了済み週の2連続を維持", inProgress.gymStreakWeeks === 2, `got ${inProgress.gymStreakWeeks}`);

  console.log("[3] 週間・年間・月別はat基準、1/1境界、移行分除外");
  const periodState = stateWith([
    set("2025-12-31", "ベンチプレス", 100, 10),
    set("2026-01-01", "スクワット", 50, 10),
    set("2026-08-21", "スクワット", 40, 5),
    set("2026-08-23", "ベンチプレス", 60, 10)
  ], { settings: { ironManualBaseKg: 5000 }, ironImport: { importedTotalKg: 9000 } });
  const period = ironPeriodStats(periodState, TODAY);
  check("今週は8/22以降の600kgだけ", period.weekKg === 600, `got ${period.weekKg}`);
  check("年間は1/1以降の構造化1300kgだけ", period.yearKg === 1300, `got ${period.yearKg}`);
  check("移行分・手動基準値は期間集計へ混入しない", period.yearKg !== 15300 && period.weekKg !== 14600);
  check("月別は1月500kg・8月800kg", period.months[0].totalKg === 500 && period.months[7].totalKg === 800);

  console.log("[4] グラフDOM: 1月〜当月、種目別segmentと凡例");
  configureInstruments({
    getState: () => periodState, escapeHTML, todayISO: () => TODAY, addDays, weekRange,
    renderHeader: () => "", registerActions: () => {}
  });
  const html = renderInstruments();
  check("当月まで8本の月棒", (html.match(/class="instr-chart-month"/g) || []).length === 8);
  check("2種目×8月のsegment", (html.match(/data-exercise=/g) || []).length === 16);
  check("種目数と同じ2件の凡例", (html.match(/class="instr-chart-legend-item"/g) || []).length === 2);
  check("画面注記に移行分除外を明記", html.includes("日付のない過去コメント移行分は含みません"));

  console.log("[5] データなしの縮退");
  const empty = ironPeriodStats({}, TODAY);
  check("週・年は0、月軸は8か月", empty.gymStreakWeeks === 0 && empty.weekKg === 0 && empty.yearKg === 0 && empty.months.length === 8);
  configureInstruments({
    getState: () => ({}), escapeHTML, todayISO: () => TODAY, addDays, weekRange,
    renderHeader: () => "", registerActions: () => {}
  });
  check("空グラフの案内を表示", renderInstruments().includes("構造化セットの記録はまだありません"));

  console.log(failures === 0 ? "\nv247: 全件成功" : `\nv247: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
