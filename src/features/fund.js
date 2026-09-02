// FABLE FUND閲覧タブ。personal-dataの生成済みJSONを30分間隔で読み、stateには保存しない。
import { state } from "../state/store.js";
import { fundCache } from "../state/fund-cache.js";

let escapeHTML, renderHeader, renderMarkdown, personalDataReady, fetchGitHubRawText;

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

const navPointSchema = shape({ date: string, nav: finite, n225: finite, spx: finite });
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
const fundSchema = (value) => fundSchemaBase(value)
  && (value.journal == null || journalSchema(value.journal));

function configureFund(deps) {
  ({ escapeHTML, renderHeader, renderMarkdown, personalDataReady, fetchGitHubRawText } = deps);
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

// generatedAtはoffset付きISO。文字列をDateへ直接渡さず、数値とoffsetからUTC msを組み立てる。
function isoTimestampMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value || "");
  if (!match) return 0;
  const offsetMinutes = match[7] === "Z" ? 0
    : (match[8] === "+" ? 1 : -1) * (Number(match[9]) * 60 + Number(match[10]));
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0)) - offsetMinutes * 60000;
}

function fundNavChartSVG(series) {
  const points = (Array.isArray(series) ? series : [])
    .filter((point) => record(point) && ["nav", "n225", "spx"].every((key) => finite(point[key])));
  if (!points.length) return `<section class="panel fund-chart"><h2>NAV推移</h2>${empty("推移データがありません")}</section>`;

  const lines = [
    { key: "nav", label: "NAV", className: "is-nav" },
    { key: "n225", label: "日経", className: "is-n225" },
    { key: "spx", label: "S&P500", className: "is-spx" }
  ].filter((line) => points[0][line.key] !== 0);
  const normalized = lines.map((line) => ({ ...line,
    values: points.map((point) => point[line.key] / points[0][line.key] * 100)
  }));
  const values = normalized.flatMap((line) => line.values);
  if (!values.length) return `<section class="panel fund-chart"><h2>NAV推移</h2>${empty("推移データが不足しています")}</section>`;

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

function metric(label, value, valueTone = "") {
  return `<div class="fund-metric"><span>${label}</span><strong class="${valueTone}">${value}</strong></div>`;
}

function renderPosition(position) {
  return `<article class="panel fund-card">
    <h3><span>${text(position.code)}</span> ${text(position.name)}</h3>
    <div class="fund-facts"><span>${numberText(position.shares, "株")}</span><span>建値 ${yen(position.avgCost)}</span><span>現値 ${yen(position.lastClose)}</span><strong class="${tone(position.pnlPct)}">${pct(position.pnlPct)}</strong></div>
    ${position.stopNote ? `<p class="fund-note"><b>STOP</b> ${text(position.stopNote)}</p>` : ""}
  </article>`;
}

function renderOrder(order) {
  return `<article class="panel fund-card">
    <h3><span>${text(order.code)}</span> ${text(order.name)}</h3>
    <div class="fund-facts"><strong>${side(order.side)}・${type(order.type)}</strong><span>${yen(order.price)}</span><span>${numberText(order.shares, "株")}</span></div>
    ${order.rationale ? `<details><summary>根拠</summary><p>${text(order.rationale)}</p></details>` : ""}
    ${order.stopPlan ? `<details><summary>ストップ計画</summary><p>${text(order.stopPlan)}</p></details>` : ""}
  </article>`;
}

function renderTrade(trade) {
  return `<article class="panel fund-card">
    <h3><span>${text(trade.date)}</span> ${text(trade.code)} ${text(trade.name)}</h3>
    <div class="fund-facts"><strong>${side(trade.side)}・${type(trade.type)}</strong><span>${yen(trade.price)} × ${numberText(trade.shares, "株")}</span><strong class="${tone(trade.pnl)}">実現 ${yen(trade.pnl)}</strong></div>
    ${trade.rationale ? `<details><summary>根拠</summary><p>${text(trade.rationale)}</p></details>` : ""}
  </article>`;
}

function renderFund() {
  const data = fundCache.data;
  if (!data) {
    let status = "FUNDデータを読み込んでいます";
    if (!personalDataReady(state.settings.github)) {
      status = "設定で個人データリポジトリを接続すると表示されます";
    } else if (fundCache.lastError && fundCache.lastAttemptAt) {
      status = `FUNDデータを取得できませんでした(最終試行 ${localTimeText(fundCache.lastAttemptAt)})。30分後に再試行します`;
    }
    return `<div class="fund-view">${renderHeader("PAPER TRADE", "FABLE FUND")}<section class="panel fund-loading fund-status">${status}</section></div>`;
  }
  const nav = data.nav || {};
  const benchmark = data.benchmark || {};
  const cashRatio = finite(data.cash) && finite(nav.current) && nav.current !== 0 ? data.cash / nav.current * 100 : null;
  const positions = Array.isArray(data.positions) ? data.positions.filter(record) : [];
  const orders = Array.isArray(data.openOrders) ? data.openOrders.filter(record) : [];
  const trades = Array.isArray(data.recentTrades) ? data.recentTrades.filter(record).slice(0, 10) : [];
  const generatedMs = isoTimestampMs(data.generatedAt);
  const staleBadge = generatedMs && Date.now() - generatedMs > FUND_STALE_MS
    ? `<span class="fund-stale-badge">データが古い</span>` : "";
  const journal = record(data.journal) && string(data.journal.markdown) ? data.journal : null;
  return `<div class="fund-view">${renderHeader("PAPER TRADE", "FABLE FUND")}
    <section class="panel fund-summary">${staleBadge}<div class="fund-metrics">
      ${metric("NAV", yen(nav.current))}${metric("起点比", pct(nav.totalReturnPct), tone(nav.totalReturnPct))}
      ${metric("対日経", pct(benchmark.excessVsN225), tone(benchmark.excessVsN225))}${metric("対S&P", pct(benchmark.excessVsSpx), tone(benchmark.excessVsSpx))}
      ${metric("現金比率", ratioPct(cashRatio))}${metric("生成時刻", text(generatedAtText(data.generatedAt)) || "—")}
    </div></section>
    ${fundNavChartSVG(nav.series)}
    <section class="fund-section"><h2>保有ポジション</h2>${positions.length ? positions.map(renderPosition).join("") : empty("保有ポジションはありません")}</section>
    <section class="fund-section"><h2>当日有効注文</h2>${orders.length ? orders.map(renderOrder).join("") : empty("有効な注文はありません")}</section>
    <section class="fund-section"><h2>直近の約定</h2>${trades.length ? trades.map(renderTrade).join("") : empty("約定履歴はありません")}</section>
    ${journal ? `<section class="panel fund-journal"><h2>日誌</h2><div class="md-render readonly-md">${renderMarkdown(journal.markdown)}</div></section>` : ""}
  </div>`;
}

export { configureFund, hydrateFundData, renderFund };
