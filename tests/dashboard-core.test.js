// tests/dashboard-core.test.js — 段階4-1抽出(ダッシュボードの閲覧専用render)のcharacterization test。
// 対象: src/features/dashboard.js(configureDashboard(deps)による依存注入。github.js/avoid.jsと
// 同じ抽出パターン)、src/state/feedback-cache.js(Home「AIから」カードとの共有cachedFeedback)。
//
// v163.test.jsは抽出前、app.jsへのsourceBetween+vmパターンでこれらの関数を直接検証していた
// (computeDashboardMetrics/defaultDashboardDate/currentDashboardDate/dashboardRateHTML等)。
// 本ファイルはdynamic import方式に切り替え、v163.test.jsで既に固定済みの期待値と重複しない
// 観点(isDashboardDate/dashboardWeekStartの単体挙動、state.settings.categoriesのデフォルト
// 引数経路、renderDashboardのスモーク、hydrateDashboardFeedbackの非同期取得契約)に絞って
// 抽出後の実挙動を固定する(「こうあるべき」ではなく実装をそのまま固定する)。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const DASHBOARD_PATH = path.join(ROOT, "src", "features", "dashboard.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");
const FEEDBACK_CACHE_PATH = path.join(ROOT, "src", "state", "feedback-cache.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---- app.js側の実装と同一のヘルパー(依存注入のスタブ。app.js:16800-16921相当) ----
function pad2(value) { return String(value).padStart(2, "0"); }
function dateToISO(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
}
function localDateTimeToMs(dateTime) {
  if (!dateTime) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(dateTime);
  if (!m) return 0;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  ).getTime();
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function fmtMinShort(m) {
  if (!m) return "";
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? `${m % 60}m` : ""}` : `${m}m`;
}

let renderCalls = 0;
let renderDeferringCalls = 0;
function renderHeader(eyebrow, title, action = "") {
  return `<div class="stub-header">${eyebrow}/${title}</div>${action}`;
}
function renderMarkdown(text) { return `<div class="stub-md">${text}</div>`; }
function getCategoryColor() { return "#007aff"; }

function block(id, date, extra = {}) {
  return {
    id, date, title: id, category: "仕事", estimateMin: null,
    plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "",
    completed: false, isMIT: false, recurrenceGroupId: "", deleted: false,
    ...extra
  };
}

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const feedbackCacheMod = await import(pathToFileURL(FEEDBACK_CACHE_PATH).href);
  const dashboardMod = await import(pathToFileURL(DASHBOARD_PATH).href);
  return { storeMod, feedbackCacheMod, dashboardMod };
}

(async () => {
  const { storeMod, feedbackCacheMod, dashboardMod } = await loadModules();

  // fetchGitHubRawResultとpersonalDataReadyは各テスト内で差し替えられるよう変数越しに注入する
  let fetchGitHubRawResultImpl = async () => ({ ok: false, text: "" });
  let personalDataReadyImpl = () => true;
  dashboardMod.configureDashboard({
    renderHeader, escapeHTML, clamp, parseDate, addDays, dateToISO, localDateTimeToMs,
    todayISO: () => "2026-07-28", fmtMinShort, renderMarkdown, getCategoryColor,
    personalDataReady: (...args) => personalDataReadyImpl(...args),
    fetchGitHubRawResult: (...args) => fetchGitHubRawResultImpl(...args),
    renderDeferringForFocus: () => { renderDeferringCalls++; },
    render: () => { renderCalls++; }
  });

  function setBaseState(extra = {}) {
    storeMod.setState({
      blocks: [], settings: { categories: [], github: {} },
      feedbackFiles: [], feedback: {}, currentView: "dashboard",
      ...extra
    });
  }

  console.log("[1] isDashboardDate: 正しい形式・存在しない日付・区切り違反");
  {
    check("2026-07-28(正しい形式)はtrue", dashboardMod.isDashboardDate("2026-07-28") === true);
    check("2026-02-30(存在しない日、dateToISO往復で不一致)はfalse", dashboardMod.isDashboardDate("2026-02-30") === false);
    check("2026/07/28(区切り違反)はfalse", dashboardMod.isDashboardDate("2026/07/28") === false);
    check("空文字はfalse", dashboardMod.isDashboardDate("") === false);
  }

  console.log("[2] dashboardWeekStart: 月曜(2026-07-20)始まりの週で、日〜土の7パターンすべてが同じ週頭を返す");
  {
    const days = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];
    for (const d of days) {
      check(`${d} → 週頭2026-07-20`, dashboardMod.dashboardWeekStart(d) === "2026-07-20", dashboardMod.dashboardWeekStart(d));
    }
  }

  console.log("[3] computeDashboardMetrics: categories省略時はstate.settings.categories(live binding)を既定値に使う");
  {
    setBaseState({
      settings: { categories: [{ name: "副業", color: "#111" }], github: {} },
      blocks: [block("b1", "2026-07-20", { category: "副業", estimateMin: 40 })]
    });
    // 第4引数(categories)を渡さない呼び出し → dashboard.js内部でimportしたstateのlive bindingを参照する
    const metrics = dashboardMod.computeDashboardMetrics(storeMod.state.blocks, "2026-07-23", "2026-07-23");
    const row = metrics.categoryRows.find((r) => r.name === "副業");
    check("state.settings.categoriesが既定カテゴリとして使われる", row?.minutes === 40, JSON.stringify(metrics.categoryRows));
  }

  console.log("[4] defaultDashboardDate: feedbackFiles/feedbackが両方空なら前日を返す");
  {
    setBaseState({ feedbackFiles: [], feedback: {} });
    check(
      "前日(addDays(todayISO(),-1)=2026-07-27)を返す",
      dashboardMod.defaultDashboardDate() === "2026-07-27",
      dashboardMod.defaultDashboardDate()
    );
  }

  console.log("[5] dashboardRateHTML: rate===nullのとき「対象データなし」、そうでなければ%とprogressバーを描画");
  {
    check("rate===nullで対象データなし文言", dashboardMod.dashboardRateHTML({ rate: null }, "件").includes("対象データなし"));
    const html = dashboardMod.dashboardRateHTML({ rate: 40, completed: 2, total: 5 }, "件完了");
    check("40%と2/5件完了が出力される", html.includes("40%") && html.includes("2/5 件完了"), html);
  }

  console.log("[6] dashboardTrendBarsHTML: v===nullの週は空バー(記録なしのtitle)、それ以外は高さ%を描画");
  {
    const trend = [
      { label: "06/01", recordRate: null },
      { label: "07/20", recordRate: 75 }
    ];
    const html = dashboardMod.dashboardTrendBarsHTML(trend, "recordRate");
    check("記録なし週はtitleに記録なしが入り、stats-bar-fillが無い", /title="06\/01〜: 記録なし"/.test(html) && !html.includes("06/01〜: 75"));
    check("記録あり週はheight:75%のバーを描画", html.includes("height:75%"));
  }

  console.log("[7] renderDashboard: スモーク(例外を投げずに主要要素を描画し、選択日のinput valueと一致)");
  {
    renderCalls = 0; renderDeferringCalls = 0;
    setBaseState({
      feedbackFiles: ["2026-07-27"], feedback: { "2026-07-27": "# 昨日のふりかえり" },
      blocks: [block("b1", "2026-07-27", { completed: true, actualStartAt: "2026-07-27T09:00", actualEndAt: "2026-07-27T09:30" })]
    });
    let threw = false;
    let html = "";
    try { html = dashboardMod.renderDashboard(); } catch (e) { threw = true; console.log(e); }
    check("例外を投げずに描画できる", threw === false);
    check("選択日(2026-07-27)のdate input valueが出る", html.includes('data-dashboard-date value="2026-07-27"'), html.slice(0, 200));
    check("AIフィードバック本文がrenderMarkdown経由で描画される", html.includes("stub-md") && html.includes("昨日のふりかえり"));
  }

  console.log("[8] hydrateDashboardFeedback: 1セッション1回だけfetchし、404/空文字はmissingへ倒す");
  {
    setBaseState({ feedbackFiles: [], feedback: {}, currentView: "dashboard" });
    let fetchCalls = 0;
    fetchGitHubRawResultImpl = async () => { fetchCalls++; return { ok: false, text: "" }; };
    personalDataReadyImpl = () => true;
    const date = "2026-07-24";  // 節[7]のrenderDashboardが触れていない日付(_dashboardFeedbackFetchStateの衝突回避)
    const first = await dashboardMod.hydrateDashboardFeedback(date);
    check("404/空文字はchanged=falseを返す", first === false);
    check("fetchGitHubRawResultが1回呼ばれる", fetchCalls === 1, String(fetchCalls));
    const second = await dashboardMod.hydrateDashboardFeedback(date);
    check("同一セッション内の2回目はfetchを呼ばない(_dashboardFeedbackFetchStateがmissingで早期return)", second === false && fetchCalls === 1, String(fetchCalls));

    console.log("  -- キャッシュヒット時は早期returnしfetchしない --");
    fetchCalls = 0;
    const cachedDate = "2026-07-26";
    storeMod.state.feedback[cachedDate] = "# 既にある本文";
    const cachedResult = await dashboardMod.hydrateDashboardFeedback(cachedDate);
    check("state.feedbackに既に本文があればfetchせずfalseを返す", cachedResult === false && fetchCalls === 0, String(fetchCalls));

    console.log("  -- 取得成功時はcachedFeedbackへ書き込み、changed=trueを返す --");
    fetchCalls = 0;
    const newDate = "2026-07-25";
    fetchGitHubRawResultImpl = async () => { fetchCalls++; return { ok: true, text: "# 新着フィードバック" }; };
    const changed = await dashboardMod.hydrateDashboardFeedback(newDate);
    check("取得成功でchanged=trueを返す", changed === true);
    check("cachedFeedbackへ本文が書き込まれる(Homeカードとの共有契約)", feedbackCacheMod.cachedFeedback[newDate] === "# 新着フィードバック");
  }

  console.log(failures === 0 ? "\ndashboard-core: 全件成功" : `\ndashboard-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
