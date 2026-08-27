// FABLE FUND閲覧タブ。personal-dataの生成済みJSONを30分間隔で読み、stateには保存しない。
import { state } from "../state/store.js";
import { fundCache } from "../state/fund-cache.js";

let escapeHTML, renderHeader, personalDataReady, fetchGitHubRawText;

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
const fundSchema = shape({
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
  recentTrades: arrayOf(tradeSchema),
  journal: nullable(shape({ date: string, markdown: string }))
});

function configureFund(deps) {
  ({ escapeHTML, renderHeader, personalDataReady, fetchGitHubRawText } = deps);
}

async function hydrateFundData(refreshIntervalMs) {
  if (!personalDataReady(state.settings.github)) return false;
  if (Date.now() - fundCache.fetchedAt < refreshIntervalMs) return false;
  let next;
  try {
    const raw = await fetchGitHubRawText("dashboard/fund.json");
    const parsed = raw ? JSON.parse(raw) : null;
    if (fundSchema(parsed)) next = parsed;
  } catch (_) {
    // 壊れたJSON・取得失敗は前回正常データを維持し、次の定期更新へ任せる。
  }
  const previous = fundCache.data;
  fundCache.fetchedAt = Date.now();
  if (!next) return false;
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
  if (!data) return `<div class="fund-view">${renderHeader("PAPER TRADE", "FABLE FUND")}<section class="panel fund-loading">FUNDデータを読み込んでいます</section></div>`;
  const nav = data.nav || {};
  const benchmark = data.benchmark || {};
  const cashRatio = finite(data.cash) && finite(nav.current) && nav.current !== 0 ? data.cash / nav.current * 100 : null;
  const positions = Array.isArray(data.positions) ? data.positions.filter(record) : [];
  const orders = Array.isArray(data.openOrders) ? data.openOrders.filter(record) : [];
  const trades = Array.isArray(data.recentTrades) ? data.recentTrades.filter(record).slice(0, 10) : [];
  return `<div class="fund-view">${renderHeader("PAPER TRADE", "FABLE FUND")}
    <section class="panel fund-summary"><div class="fund-metrics">
      ${metric("NAV", yen(nav.current))}${metric("起点比", pct(nav.totalReturnPct), tone(nav.totalReturnPct))}
      ${metric("対日経", pct(benchmark.excessVsN225), tone(benchmark.excessVsN225))}${metric("対S&P", pct(benchmark.excessVsSpx), tone(benchmark.excessVsSpx))}
      ${metric("現金比率", ratioPct(cashRatio))}${metric("生成時刻", text(generatedAtText(data.generatedAt)) || "—")}
    </div></section>
    <section class="fund-section"><h2>保有ポジション</h2>${positions.length ? positions.map(renderPosition).join("") : empty("保有ポジションはありません")}</section>
    <section class="fund-section"><h2>当日有効注文</h2>${orders.length ? orders.map(renderOrder).join("") : empty("有効な注文はありません")}</section>
    <section class="fund-section"><h2>直近の約定</h2>${trades.length ? trades.map(renderTrade).join("") : empty("約定履歴はありません")}</section>
  </div>`;
}

export { configureFund, hydrateFundData, renderFund };
