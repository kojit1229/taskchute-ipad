// v163 batch 1: ダッシュボード集計の純粋関数 + UI接続点の契約テスト。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function sourceBetween(start, end) {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`source marker missing: ${start} ... ${end}`);
  return appSource.slice(from, to);
}

function cssBetween(start, end) {
  const from = cssSource.indexOf(start);
  const to = cssSource.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`css marker missing: ${start} ... ${end}`);
  return cssSource.slice(from, to);
}

function pad2(value) { return String(value).padStart(2, "0"); }
function dateToISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
}
function localDateTimeToMs(value) {
  if (!value) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return 0;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  ).getTime();
}

const context = vm.createContext({
  dateToISO, parseDate, addDays, localDateTimeToMs,
  todayISO: () => "2026-07-23",
  state: {
    settings: { categories: [] },
    feedbackFiles: ["2026-07-22", "2026-07-23"],
    feedback: { "2026-07-21": "# local" }
  },
  dashboardSelectedDate: "",
  dashboardDateTouched: false,
  render: () => {}
});
vm.runInContext(
  sourceBetween("function isDashboardDate(", "function dashboardRateHTML("),
  context
);

function block(id, date, extra = {}) {
  return {
    id, date, title: id, category: "仕事", estimateMin: null,
    plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "",
    completed: false, isMIT: false, recurrenceGroupId: "", deleted: false,
    ...extra
  };
}

console.log("[1] 集計純粋関数: 記録率・カテゴリ時間・完了率・MIT・ルーティン");
const fixture = [
  block("old", "2026-05-01", {
    actualStartAt: "2026-05-01T09:00", actualEndAt: "2026-05-01T09:30",
    completed: true, isMIT: true, estimateMin: 30
  }),
  block("week-a", "2026-07-20", {
    estimateMin: 60, completed: true, isMIT: true, recurrenceGroupId: "routine-a",
    actualStartAt: "2026-07-20T09:00", actualEndAt: "2026-07-20T10:00"
  }),
  block("week-b", "2026-07-21", {
    estimateMin: 0, plannedStartAt: "2026-07-21T10:00", plannedEndAt: "2026-07-21T10:30",
    isMIT: true, recurrenceGroupId: "routine-a"
  }),
  block("week-c", "2026-07-22", {
    completed: true, actualStartAt: "2026-07-22T11:00"
  }),
  block("week-other", "2026-07-23", {
    category: "未登録", estimateMin: 15, completed: true
  }),
  block("prior-a", "2026-07-15", {
    estimateMin: 20, completed: true, isMIT: true,
    actualStartAt: "2026-07-15T09:00", actualEndAt: "2026-07-15T09:20"
  }),
  block("prior-b", "2026-07-14", { estimateMin: 20, isMIT: true }),
  block("deleted", "2026-07-20", {
    estimateMin: 999, completed: true, isMIT: true, recurrenceGroupId: "routine-x", deleted: true
  }),
  block("future", "2026-07-24", {
    estimateMin: 999, completed: true, isMIT: true, recurrenceGroupId: "routine-x"
  })
];
const metrics = context.computeDashboardMetrics(
  fixture, "2026-07-23", "2026-07-23",
  [{ name: "仕事", color: "#007aff" }, { name: "休息", color: "#34c759" }]
);

check("月曜始まりの選択週",
  metrics.weekStart === "2026-07-20" && metrics.weekEnd === "2026-07-26", JSON.stringify(metrics));
check("全期間の実績記録率は削除済み・未来日を除外して3/7",
  metrics.recordOverall.recorded === 3 && metrics.recordOverall.total === 7 &&
  Math.abs(metrics.recordOverall.rate - 300 / 7) < 1e-9, JSON.stringify(metrics.recordOverall));
check("選択週の実績記録率は1/4=25%",
  metrics.recordWeek.recorded === 1 && metrics.recordWeek.total === 4 && metrics.recordWeek.rate === 25,
  JSON.stringify(metrics.recordWeek));
const work = metrics.categoryRows.find((row) => row.name === "仕事");
const other = metrics.categoryRows.find((row) => row.name === "その他");
check("カテゴリ時間はestimateMin優先、0は予定差へフォールバック(仕事90分・その他15分)",
  work?.minutes === 90 && other?.minutes === 15, JSON.stringify(metrics.categoryRows));
check("時間情報が両方無い1件を明示的に除外",
  metrics.excludedNoTime === 1, String(metrics.excludedNoTime));
check("選択週の完了率は3/4=75%",
  metrics.completion.completed === 3 && metrics.completion.total === 4 && metrics.completion.rate === 75,
  JSON.stringify(metrics.completion));
check("MITは選択週で終わる8週窓の単一集計2/4=50%",
  metrics.mit.completed === 2 && metrics.mit.total === 4 && metrics.mit.rate === 50,
  JSON.stringify(metrics.mit));
check("ルーティン遵守はrecurrenceGroupIdを持つBlockで1/2=50%",
  metrics.routine.completed === 1 && metrics.routine.total === 2 && metrics.routine.rate === 50,
  JSON.stringify(metrics.routine));
check("既定日はfeedbackFiles/state.feedbackの日付キー最大値",
  context.defaultDashboardDate() === "2026-07-23", context.defaultDashboardDate());

console.log("[1b] 8週推移(batch2): taskchute-dashboard-build.pyのbuild_weeksと同じ月曜始まり8週窓");
check("8週分の配列で、最古週が窓開始(windowStart)と一致",
  metrics.weeklyTrend.length === 8 && metrics.weeklyTrend[0].start === metrics.windowStart,
  JSON.stringify(metrics.weeklyTrend.map((w) => w.start)));
check("データの無い週(例: 最古週06/01)は3指標ともnull(0で除算しない)",
  metrics.weeklyTrend[0].recordRate === null && metrics.weeklyTrend[0].completionRate === null &&
  metrics.weeklyTrend[0].routineRate === null, JSON.stringify(metrics.weeklyTrend[0]));
check("07/13週(prior-a/prior-b)は記録率50%・完了率50%・ルーティン対象0件でnull",
  metrics.weeklyTrend[6].label === "07/13" && metrics.weeklyTrend[6].recordRate === 50 &&
  metrics.weeklyTrend[6].completionRate === 50 && metrics.weeklyTrend[6].routineRate === null,
  JSON.stringify(metrics.weeklyTrend[6]));
check("選択週(07/20、末尾)は単一値パネルと同じ25%/75%/50%で整合",
  metrics.weeklyTrend[7].label === "07/20" && metrics.weeklyTrend[7].recordRate === 25 &&
  metrics.weeklyTrend[7].completionRate === 75 && metrics.weeklyTrend[7].routineRate === 50,
  JSON.stringify(metrics.weeklyTrend[7]));

console.log("[1c] 日付カーソルの追随(batch2, Codex P2): 未操作の間はhydration後の新着フィードバック日に追随し、手操作後は固定する");
check("初回はfeedbackFiles/feedbackの最大日付", context.currentDashboardDate() === "2026-07-23");
context.state.feedbackFiles.push("2026-07-24");
check("未操作のまま新着フィードバック(hydration相当)が増えると、再取得のたびに最新へ追随する",
  context.currentDashboardDate() === "2026-07-24");
context.setDashboardDate("2026-07-20");
context.state.feedbackFiles.push("2026-07-25");
check("一度でも手で日付を変えたら、その後に新着が増えても選択日は固定されたまま動かない",
  context.currentDashboardDate() === "2026-07-20");

console.log("[2] UI・非同期取得・レスポンシブ・SWの接続契約");
const dashboardSource = sourceBetween("function renderDashboard(", "function renderStats(");
const hydrateSource = sourceBetween("async function hydrateDashboardFeedback(", "function maybeRefreshFeedback(");
check("navItemsにD印のダッシュボード", /\{ id: "dashboard", label: "ダッシュボード", mark: "D" \}/.test(appSource));
check("moreGroupsの振り返り群に📈ダッシュボード", /\{ id: "dashboard", label: "ダッシュボード", mark: "📈" \}/.test(appSource));
check("renderMainからrenderDashboardへ接続", /view === "dashboard"\) main\.innerHTML = renderDashboard\(\)/.test(appSource));
check("日付入力はnative type=date", /class="input dashboard-date-input" type="date"/.test(dashboardSource));
check("AI本文はdetailsでなくplain div", /dashboard-feedback-body md-render readonly-md/.test(dashboardSource) && !/<details/.test(dashboardSource));
check("任意日のAIフィードバック命名でContents API取得", /fetchGitHubRawResult\(`AIフィードバック_\$\{date\}\.md`\)/.test(hydrateSource));
check("404/未取得時の日本語空表示", /この日のAIフィードバックはありません。/.test(dashboardSource));
check("hydrateStaticMarkdown完了時の再描画対象にdashboard",
  /if \(changed && \([^\n]*state\.currentView === "dashboard"/.test(hydrateSource));
check("日付inputは16px以上", /\.dashboard-date-input\s*\{[^}]*font-size:\s*16px/s.test(cssSource));
const dashboardCssRules = cssBetween(".dashboard-grid { grid-template-columns: minmax(0, 1fr)", "/* ドーナツ + 凡例 */");
check("1024px以上(iPad横以上)は2列。iPad縦(760-1023px)は入れ子stats-gridの340pxはみ出しを避け縦積みのまま",
  /@media \(min-width: 1024px\)\s*\{\s*\.dashboard-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/m.test(dashboardCssRules) &&
  !dashboardCssRules.includes("760px"));
check("SW CACHE_NAMEはv163", /^const CACHE_NAME = "taskchute-journal-pwa-v163";/m.test(swSource));
check("8週ミニバー(記録率・完了率・ルーティン遵守)が計器盤と同じ.stats-bars/.stats-bar-fillで3箇所描画",
  (dashboardSource.match(/dashboardTrendBarsHTML\(metrics\.weeklyTrend,\s*"(recordRate|completionRate|routineRate)"\)/g) || []).length === 3);
check("狭いiPhone(320px幅など)でも入れ子.stats-gridが340px固定下限で横あふれしないよう、min(340px,100%)でクランプ(Codex P2)",
  /\.dashboard-achievement-column \.stats-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(340px,\s*100%\),\s*1fr\)\)/.test(cssSource));

console.log(failures === 0 ? "\n✅ v163 ALL PASS" : `\n❌ v163: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
