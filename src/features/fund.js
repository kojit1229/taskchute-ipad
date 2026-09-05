// FABLE FUND閲覧タブ。personal-dataの生成済みJSONを30分間隔で読み、stateには保存しない。
import { state } from "../state/store.js";
import { fundCache } from "../state/fund-cache.js";
import { registerActions } from "../ui/actions.js";

let escapeHTML, renderHeader, renderMarkdown, personalDataReady, fetchGitHubRawText, render;

const FUND_STALE_MS = 120 * 60 * 60 * 1000;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 160;
const CHART_PAD = 16;

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string";
const nullable = (validate) => (value) => value === null || validate(value);
const arrayOf = (validate) => (value) => Array.isArray(value) && value.every(validate);
const shape = (schema) => (value) => record(value) && Object.entries(schema)
  .every(([key, validate]) => Object.prototype.hasOwnProperty.call(value, key) && validate(value[key]));

const navPointSchema = shape({ date: string, nav: finite, n225: nullable(finite), spx: nullable(finite) });
const positionSchema = shape({
  code: string, name: string, shares: finite, avgCost: finite,
  lastClose: nullable(finite), marketValue: nullable(finite), pnlPct: nullable(finite),
  openedAt: string, stopNote: string
});
const orderSchema = shape({
  id: string, validFor: string, side: string, type: string, code: string, name: string,
  price: finite, shares: finite, rationale: string, stopPlan: string
});
const tradeSchema = shape({
  date: string, side: string, type: string, code: string, name: string,
  shares: finite, price: finite, pnl: nullable(finite), rationale: string
});
const journalSchema = shape({ date: string, markdown: string });
// v356レビュー対応(M5): orders/fillsは要素単位で寛容に扱う。必須はrecord(オブジェクト)である
// ことだけとし、code/side等の個別フィールドはrender側(whyOf/text/yen等の既存フォールバック)が
// 欠損を「—」で吸収する。1要素の形が崩れていてもfundSchema全体を棄却しない(壊れた1要素で
// FUNDタブ全体が非表示になる事故を防ぐ)。厳密な形はrenderFund側のフィルタで担保する。
const seriesSchema = shape({
  dates: arrayOf(string), fund: arrayOf(nullable(finite)),
  n225: arrayOf(nullable(finite)), spx: arrayOf(nullable(finite))
});
const fundSchemaBase = shape({
  version: (value) => value === 1,
  generatedAt: string,
  start: shape({ date: string, capital: finite }),
  nav: shape({ current: finite, dayChangePct: finite, totalReturnPct: finite, series: arrayOf(navPointSchema) }),
  benchmark: shape({
    n225ReturnPct: nullable(finite), spxReturnPct: nullable(finite),
    excessVsN225: nullable(finite), excessVsSpx: nullable(finite)
  }),
  cash: finite,
  positions: arrayOf(positionSchema),
  openOrders: arrayOf(orderSchema),
  recentTrades: arrayOf(tradeSchema)
});
// v356: orders/fills/series/journalPlainは新フィールドのため、journal同様キー自体が
// 無くても(旧世代キャッシュ・移行期の欠損)例外にせず容認する。値がある場合だけ形を検査する。
const fundSchema = (value) => fundSchemaBase(value)
  && (value.journal == null || journalSchema(value.journal))
  && (value.orders === undefined || arrayOf(record)(value.orders))
  && (value.fills === undefined || arrayOf(record)(value.fills))
  && (value.series == null || seriesSchema(value.series))
  && (value.journalPlain == null || string(value.journalPlain));

function configureFund(deps) {
  ({ escapeHTML, renderHeader, renderMarkdown, personalDataReady, fetchGitHubRawText, render } = deps);
}

async function hydrateFundData(refreshIntervalMs) {
  if (!personalDataReady(state.settings.github)) return false;
  if (Date.now() - fundCache.fetchedAt < refreshIntervalMs) return false;
  let next;
  let error = "";
  try {
    const raw = await fetchGitHubRawText("dashboard/fund.json");
    const parsed = raw ? JSON.parse(raw) : null;
    if (fundSchema(parsed)) next = parsed;
    else error = "FUNDデータの形式が正しくありません";
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause || "FUNDデータを取得できませんでした");
  }
  const previous = fundCache.data;
  fundCache.lastAttemptAt = Date.now();
  fundCache.fetchedAt = fundCache.lastAttemptAt;
  fundCache.lastError = next ? "" : error || "FUNDデータを取得できませんでした";
  if (!next) return true; // 失敗表示へ更新する。前回正常データは維持する。
  fundCache.data = next;
  return JSON.stringify(previous) !== JSON.stringify(next);
}

// v356: ヘッダの「再取得」導線。連打時は多重fetchせず1回だけ実行する。
let fundRefreshing = false;
async function refreshFundData() {
  if (fundRefreshing) return;
  fundRefreshing = true;
  try {
    await hydrateFundData(0);
  } finally {
    fundRefreshing = false;
    render();
  }
}
registerActions({ "fund-refresh": () => { refreshFundData(); } });

const text = (value) => escapeHTML(String(value ?? ""));
const numberText = (value, suffix = "") => finite(value) ? `${value.toLocaleString("ja-JP")}${suffix}` : "—";
const yen = (value) => finite(value) ? `${value < 0 ? "-" : ""}¥${Math.abs(value).toLocaleString("ja-JP")}` : "—";
const tone = (value) => finite(value) ? (value > 0 ? "is-positive" : value < 0 ? "is-negative" : "") : "";
const pct = (value) => finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const ratioPct = (value) => finite(value) ? `${value.toFixed(2)}%` : "—";
const generatedAtText = (value) => string(value)
  ? value.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}).*$/, "$1 $2") : "";
const side = (value) => value === "buy" ? "買" : value === "sell" ? "売" : text(value) || "—";
const type = (value) => value === "stop" ? "逆指値" : value === "limit" ? "指値" : text(value) || "—";
const empty = (label) => `<p class="fund-empty">${label}</p>`;
const localTimeText = (timestamp) => {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
// v356: 建値基準の指値/逆指値の乖離%。price/avgCostのどちらかが欠けていたら「—」。
const priceMovePct = (price, avgCost) => finite(price) && finite(avgCost) && avgCost !== 0
  ? (price / avgCost - 1) * 100 : null;
const whyOf = (row) => (string(row.whyPlain) && row.whyPlain) || (string(row.rationale) && row.rationale) || "";
// v356レビュー対応(M5): orders/fillsはfundSchemaで要素の形を検査していないため、render側で
// code/sideを最低限持つ要素だけを表示対象にする(壊れた要素は静かに除外し、他の正常要素は
// そのまま表示する。code/sideさえ揃っていれば他フィールドの欠損は各表示ヘルパーが「—」で
// 吸収する)。
const hasIdentity = (row) => record(row) && string(row.code) && row.code && string(row.side) && row.side;

// generatedAtはoffset付きISO。文字列をDateへ直接渡さず、数値とoffsetからUTC msを組み立てる。
function isoTimestampMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value || "");
  if (!match) return 0;
  const offsetMinutes = match[7] === "Z" ? 0
    : (match[8] === "+" ? 1 : -1) * (Number(match[9]) * 60 + Number(match[10]));
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0)) - offsetMinutes * 60000;
}

function chartEmpty(label) {
  return `<section class="panel fund-chart"><h2>NAV推移</h2>${empty(label)}</section>`;
}

// values[index]がnull(欠損)の区間はパスを繋がず、次の非null点から新しいM(moveto)で
// 描き直す(欠損日を線で埋めない=見た目の嘘を作らない)。
function pathFromValues(values, x, y) {
  let d = "";
  let needMove = true;
  values.forEach((value, index) => {
    if (!finite(value)) { needMove = true; return; }
    d += `${d ? " " : ""}${needMove ? "M" : "L"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    needMove = false;
  });
  return d;
}

// v356レビュー対応(H2): 上位series(dates/fund/n225/spx、生成済みJSONが既に起点=100で
// 正規化済み)を優先して使う。x軸はdatesの並び順で等間隔、欠損(null)はpathFromValuesが
// 線を途切れさせる。
function fundNavChartFromSeries(series) {
  const dates = series.dates;
  const lineDefs = [
    { key: "fund", label: "NAV", className: "is-nav" },
    { key: "n225", label: "日経", className: "is-n225" },
    { key: "spx", label: "S&P500", className: "is-spx" }
  ];
  const lines = lineDefs
    .map((def) => ({ ...def, values: Array.isArray(series[def.key]) ? series[def.key].slice(0, dates.length).map((v) => finite(v) ? v : null) : [] }))
    .filter((line) => line.values.some(finite));
  if (!lines.length) return chartEmpty("推移データがありません");
  const values = lines.flatMap((line) => line.values.filter(finite));
  if (!values.length) return chartEmpty("推移データが不足しています");

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || 2;
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.08;
  const x = (index) => dates.length === 1 ? CHART_WIDTH / 2
    : CHART_PAD + index * (CHART_WIDTH - CHART_PAD * 2) / (dates.length - 1);
  const y = (value) => CHART_PAD + (max - value) * (CHART_HEIGHT - CHART_PAD * 2) / (max - min);
  const paths = lines.map((line) => {
    const path = pathFromValues(line.values, x, y);
    const finiteIndexes = line.values.map((value, index) => (finite(value) ? index : -1)).filter((index) => index >= 0);
    const dot = finiteIndexes.length === 1
      ? `<circle class="fund-chart-dot ${line.className}" cx="${x(finiteIndexes[0]).toFixed(2)}" cy="${y(line.values[finiteIndexes[0]]).toFixed(2)}" r="3.5"></circle>` : "";
    return `<path class="fund-chart-line ${line.className}" d="${path}"></path>${dot}`;
  }).join("");
  const legend = lines.map((line) => `<span class="fund-chart-key ${line.className}">${line.label}</span>`).join("");
  return `<section class="panel fund-chart"><div class="fund-chart-head"><h2>NAV推移</h2><div class="fund-chart-legend">${legend}</div></div>
    <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="NAV・日経・S&amp;P500の起点100推移">
      <line class="fund-chart-baseline" x1="${CHART_PAD}" x2="${CHART_WIDTH - CHART_PAD}" y1="${y(100).toFixed(2)}" y2="${y(100).toFixed(2)}"></line>${paths}
    </svg><p class="fund-chart-dates"><span>${text(dates[0])}</span><span>${text(dates.at(-1))}</span></p></section>`;
}

// 旧経路(nav.series、date/nav/n225/spxの生値)。上位seriesが無い/空のときのフォールバックとして
// 維持する(既存v281/v301スイートのfixtureがこの形のまま)。
function fundNavChartFromNavPoints(navSeries) {
  const points = (Array.isArray(navSeries) ? navSeries : [])
    .filter((point) => record(point) && ["nav", "n225", "spx"].every((key) => finite(point[key])));
  if (!points.length) return chartEmpty("推移データがありません");

  const lines = [
    { key: "nav", label: "NAV", className: "is-nav" },
    { key: "n225", label: "日経", className: "is-n225" },
    { key: "spx", label: "S&P500", className: "is-spx" }
  ].filter((line) => points[0][line.key] !== 0);
  const normalized = lines.map((line) => ({ ...line,
    values: points.map((point) => point[line.key] / points[0][line.key] * 100)
  }));
  const values = normalized.flatMap((line) => line.values);
  if (!values.length) return chartEmpty("推移データが不足しています");

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || 2;
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.08;
  const x = (index) => points.length === 1 ? CHART_WIDTH / 2
    : CHART_PAD + index * (CHART_WIDTH - CHART_PAD * 2) / (points.length - 1);
  const y = (value) => CHART_PAD + (max - value) * (CHART_HEIGHT - CHART_PAD * 2) / (max - min);
  const paths = normalized.map((line) => {
    const coords = line.values.map((value, index) => [x(index), y(value)]);
    const path = coords.map(([cx, cy], index) => `${index ? "L" : "M"}${cx.toFixed(2)} ${cy.toFixed(2)}`).join(" ");
    const dot = coords.length === 1
      ? `<circle class="fund-chart-dot ${line.className}" cx="${coords[0][0].toFixed(2)}" cy="${coords[0][1].toFixed(2)}" r="3.5"></circle>` : "";
    return `<path class="fund-chart-line ${line.className}" d="${path}"></path>${dot}`;
  }).join("");
  const legend = normalized.map((line) => `<span class="fund-chart-key ${line.className}">${line.label}</span>`).join("");
  return `<section class="panel fund-chart"><div class="fund-chart-head"><h2>NAV推移</h2><div class="fund-chart-legend">${legend}</div></div>
    <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="NAV・日経・S&amp;P500の起点100推移">
      <line class="fund-chart-baseline" x1="${CHART_PAD}" x2="${CHART_WIDTH - CHART_PAD}" y1="${y(100).toFixed(2)}" y2="${y(100).toFixed(2)}"></line>${paths}
    </svg><p class="fund-chart-dates"><span>${text(points[0].date)}</span><span>${text(points.at(-1).date)}</span></p></section>`;
}

function fundNavChartSVG(data) {
  const series = record(data.series) ? data.series : null;
  if (series && Array.isArray(series.dates) && series.dates.length) {
    return fundNavChartFromSeries(series);
  }
  const nav = record(data.nav) ? data.nav : {};
  return fundNavChartFromNavPoints(nav.series);
}

function metric(label, value, valueTone = "") {
  return `<div class="fund-metric"><span>${label}</span><strong class="${valueTone}">${value}</strong></div>`;
}

function renderPosition(position) {
  const takeProfit = record(position.takeProfit) ? position.takeProfit : {};
  const stopLoss = record(position.stopLoss) ? position.stopLoss : {};
  const tpPct = priceMovePct(takeProfit.price, position.avgCost);
  const slPct = priceMovePct(stopLoss.price, position.avgCost);
  const reason = string(position.reasonPlain) && position.reasonPlain ? text(position.reasonPlain).replace(/\n/g, "<br>") : "—";
  // v356レビュー対応(M3): 根拠はtakeProfit.basis/stopLoss.basis(生成スクリプトが出す平易文)を
  // 優先する。どちらも無ければ既存stopNoteへフォールバックする(モックの「中学生でもわかる
  // 言葉で」の意図に沿う。専門用語混じりの長文stopNoteを既定にしない)。
  const takeProfitBasis = string(takeProfit.basis) && takeProfit.basis ? text(takeProfit.basis) : "";
  const stopLossBasis = string(stopLoss.basis) && stopLoss.basis ? text(stopLoss.basis) : "";
  const basisHTML = takeProfitBasis || stopLossBasis
    ? [takeProfitBasis && `利確: ${takeProfitBasis}`, stopLossBasis && `損切り: ${stopLossBasis}`].filter(Boolean).join(" ・ ")
    : (position.stopNote ? text(position.stopNote) : "");
  return `<article class="panel fund-card">
    <h3><span>${text(position.code)}</span> ${text(position.name)}</h3>
    <div class="fund-facts"><span>${numberText(position.shares, "株")}</span><span>建値 ${yen(position.avgCost)}</span><span>現値 ${yen(position.lastClose)}</span><strong class="${tone(position.pnlPct)}">${pct(position.pnlPct)}</strong></div>
    <p class="fund-note">買った理由: ${reason}</p>
    <p class="fund-note">利確 指値 ${yen(takeProfit.price)}${tpPct !== null ? `(${pct(tpPct)})` : ""} ・ 損切り 逆指値 ${yen(stopLoss.price)}${slPct !== null ? `(${pct(slPct)})` : ""}</p>
    ${basisHTML ? `<p class="fund-note"><b>根拠</b> ${basisHTML}</p>` : ""}
  </article>`;
}

function renderOrderRow(order) {
  const why = whyOf(order);
  // v356レビュー対応(M6): 注文行に「有効」ラベルを付け、約定行と見た目で区別できるようにする。
  // (B-M2): v281で削除されたstopPlan(ストップ計画)の表示を復帰させる。
  return `<article class="panel fund-card">
    <h3><span class="fund-status-tag">有効</span><span>${text(order.code)}</span> ${text(order.name)}</h3>
    <div class="fund-facts"><strong>${side(order.side)}・${type(order.type)}</strong><span>${yen(order.price)}</span><span>${numberText(order.shares, "株")}</span>${order.validFor ? `<span>有効期限 ${text(order.validFor)}</span>` : ""}</div>
    ${why ? `<p class="fund-note">なぜ: ${text(why)}</p>` : ""}
    ${order.stopPlan ? `<p class="fund-note">ストップ計画: ${text(order.stopPlan)}</p>` : ""}
  </article>`;
}

function renderFillRow(trade) {
  const why = whyOf(trade);
  // v356レビュー対応(M6): 約定行に「約定」ラベルを付ける。
  return `<article class="panel fund-card">
    <h3><span class="fund-status-tag is-filled">約定</span><span>${text(trade.date)}</span> ${text(trade.code)} ${text(trade.name)}</h3>
    <div class="fund-facts"><strong>${side(trade.side)}・${type(trade.type)}</strong><span>${yen(trade.price)} × ${numberText(trade.shares, "株")}</span><strong class="${tone(trade.pnl)}">実現 ${yen(trade.pnl)}</strong></div>
    ${why ? `<p class="fund-note">なぜ: ${text(why)}</p>` : ""}
  </article>`;
}

function statusLineHTML(data) {
  const generated = text(generatedAtText(data.generatedAt)) || "—";
  if (fundCache.lastError && fundCache.lastAttemptAt) {
    return `<p class="fund-status-line">前回データ(${generated} 時点・古い)を表示中(最終試行 ${localTimeText(fundCache.lastAttemptAt)})</p>`;
  }
  return `<p class="fund-status-line">${generated} 時点</p>`;
}

function renderFund() {
  const data = fundCache.data;
  const refreshBtn = `<button class="btn ghost" data-action="fund-refresh">再取得</button>`;
  if (!data) {
    let status = "FUNDデータを読み込んでいます";
    if (!personalDataReady(state.settings.github)) {
      status = "設定で個人データリポジトリを接続すると表示されます";
    } else if (fundCache.lastError && fundCache.lastAttemptAt) {
      status = `FUNDデータを取得できませんでした(最終試行 ${localTimeText(fundCache.lastAttemptAt)})。30分後に再試行します`;
    }
    return `<div class="fund-view">${renderHeader("PAPER TRADE", "FABLE FUND", refreshBtn)}<section class="panel fund-loading fund-status">${status}</section></div>`;
  }
  const nav = data.nav || {};
  const benchmark = data.benchmark || {};
  const cashRatio = finite(data.cash) && finite(nav.current) && nav.current !== 0 ? data.cash / nav.current * 100 : null;
  const positions = Array.isArray(data.positions) ? data.positions.filter(record) : [];
  // v356レビュー対応(M5): ordersはfundSchemaでrecord()のみ検査(要素単位は寛容)のため、
  // 表示対象は最低限code/sideを持つ要素だけに絞る(hasIdentity)。code/sideすら欠けた壊れた
  // 要素は静かに除外し、FUNDタブ全体は棄却しない。
  const ordersNew = Array.isArray(data.orders) ? data.orders.filter(hasIdentity) : [];
  const openOrders = Array.isArray(data.openOrders) ? data.openOrders.filter(record) : [];
  const ordersToShow = ordersNew.length ? ordersNew : openOrders;
  const fillsNew = Array.isArray(data.fills) ? data.fills.filter(hasIdentity) : [];
  const recentTrades = Array.isArray(data.recentTrades) ? data.recentTrades.filter(record).slice(0, 10) : [];
  const fillsToShow = fillsNew.length ? fillsNew : recentTrades;
  const noActivity = !positions.length && !ordersToShow.length && !fillsToShow.length;
  const generatedMs = isoTimestampMs(data.generatedAt);
  const staleBadge = generatedMs && Date.now() - generatedMs > FUND_STALE_MS
    ? `<span class="fund-stale-badge">データが古い</span>` : "";
  const journal = record(data.journal) && string(data.journal.markdown) ? data.journal : null;
  const journalPlain = string(data.journalPlain) && data.journalPlain ? data.journalPlain : "";
  const activityHTML = noActivity
    ? `<section class="fund-section fund-holdings fund-activity">${empty("まだ取引記録がありません")}</section>`
    : `<section class="fund-section fund-holdings"><h2>保有ポジション</h2>${positions.length ? positions.map(renderPosition).join("") : empty("保有ポジションはありません")}</section>
    <section class="fund-section fund-activity"><h2>今日の注文と約定</h2>
      ${ordersToShow.length ? ordersToShow.map(renderOrderRow).join("") : empty("有効な注文はありません")}
      ${fillsToShow.length ? fillsToShow.map(renderFillRow).join("") : empty("約定はありません")}
    </section>`;
  const journalHTML = journalPlain
    ? `<section class="panel fund-journal"><h2>日誌</h2><div class="md-render readonly-md fund-journal-plain">${renderMarkdown(journalPlain)}</div></section>`
    : journal ? `<section class="panel fund-journal"><h2>日誌</h2><div class="md-render readonly-md">${renderMarkdown(journal.markdown)}</div></section>` : "";
  return `<div class="fund-view">${renderHeader("PAPER TRADE", "FABLE FUND", refreshBtn)}
    ${statusLineHTML(data)}
    <section class="panel fund-summary">${staleBadge}<div class="fund-metrics">
      ${metric("NAV", yen(nav.current))}${metric("起点比", pct(nav.totalReturnPct), tone(nav.totalReturnPct))}
      ${metric("対日経", pct(benchmark.excessVsN225), tone(benchmark.excessVsN225))}${metric("対S&P", pct(benchmark.excessVsSpx), tone(benchmark.excessVsSpx))}
      ${metric("現金比率", ratioPct(cashRatio))}${metric("生成時刻", text(generatedAtText(data.generatedAt)) || "—")}
    </div></section>
    ${fundNavChartSVG(data)}
    ${activityHTML}
    ${journalHTML}
  </div>`;
}

export { configureFund, hydrateFundData, renderFund };
