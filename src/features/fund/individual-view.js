import {validFundDate} from './read-contract.js';
import {renderIndividualChart} from './individual-chart.js';
const finite=v=>typeof v==='number' && Number.isFinite(v);
const record=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const labels={fable:'FABLE FUND',codex:'CODEX FUND'};
const operation={not_started:'運用開始前',ready:'直近の処理に成功',waiting_for_prices:'確定価格を待っています',
  skipped:'今回は実行しません',budget_stopped:'予算の確認で停止',error:'処理に失敗しています'};
export function createFundIndividualView({escapeHTML,renderMarkdown,readState}) {
  if([escapeHTML,renderMarkdown,readState].some(f=>typeof f!=='function')) throw new TypeError('invalid_view_configuration');
  const text=v=>escapeHTML(typeof v==='string' && v.trim()?v:'未確認');
  const money=v=>finite(v)?`${v<0?'-':''}¥${Math.abs(v).toLocaleString('ja-JP')}`:'未確認';
  const number=v=>finite(v)?v.toLocaleString('ja-JP'):'未確認';
  const percent=v=>finite(v)?`${v>0?'+':''}${v.toFixed(2)}%`:'未確認';
  const points=v=>finite(v)?`${v>0?'+':''}${v.toFixed(2)}ポイント`:'未確認';
  const received=v=>{try {return finite(v)?new Date(v).toISOString():'未確認';} catch {return '未確認';}};
  const day=v=>validFundDate(v)?v:'未確認';
  const side=v=>v==='buy'?'買い':v==='sell'?'売り':'未確認';
  const type=v=>v==='stop'?'逆指値':v==='limit'?'指値':v==='market'?'成行':'未確認';
  const why=row=>typeof row.whyPlain==='string' && row.whyPlain.trim()?row.whyPlain:row.rationale;
  const metric=(label,value)=>`<div class="fund-metric"><span>${label}</span><strong>${value}</strong></div>`;
  const identity=row=>record(row) && typeof row.code==='string' && row.code && typeof row.side==='string' && row.side;
  const rows=(data,modern,legacy)=>{
    const current=Array.isArray(data[modern])?data[modern]:[];
    if(current.some(identity)) return current.map(row=>identity(row)?row:null);
    return Array.isArray(data[legacy])?data[legacy]:Array.isArray(data[modern])?current.map(()=>null):null;
  };
  function listing(input,render,empty) {
    if(!input) return '<p class="fund-empty">記録を確認できません</p>';
    const valid=input.filter(record),invalid=input.length-valid.length;
    return `<p class="fund-note">${valid.length}件（入力データ内の全件）${invalid?`。形式を確認できない記録 ${invalid}件`:''}</p>`+
      (valid.length?valid.map(render).join(''):`<p class="fund-empty">${empty}</p>`);
  }
  const targetPrice=(price,base)=>money(price)+(finite(price) && finite(base) && base>0 && finite((price/base-1)*100)?' ('+percent((price/base-1)*100)+')':'');
  function position(p) {
    const tp=record(p.takeProfit)?p.takeProfit:{},sl=record(p.stopLoss)?p.stopLoss:{};
    return `<article class="panel fund-card"><h3>${text(p.code)} ${text(p.name)}</h3><div class="fund-facts">
      <span>${number(p.shares)}株</span><span>購入価格 ${money(p.avgCost)}</span><span>現在価格 ${money(p.lastClose)}</span>
      <span>評価額 ${money(p.marketValue)}</span><strong>損益率 ${percent(p.pnlPct)}</strong></div>
      <p class="fund-note">買った理由：${text(p.reasonPlain)}</p><p class="fund-note">利益確定価格 ${targetPrice(tp.price,p.avgCost)} ／ 理由：${text(tp.basis)}</p>
      <p class="fund-note">損切り価格 ${targetPrice(sl.price,p.avgCost)} ／ 理由：${text(sl.basis)}</p>
      ${p.stopNote && ![tp.basis,sl.basis].some(v=>typeof v==='string' && v.trim())?`<p class="fund-note">補足：${text(p.stopNote)}</p>`:''}</article>`;
  }
  function order(o) {
    return `<article class="panel fund-card"><h3><span class="fund-status-tag">有効注文</span>${text(o.code)} ${text(o.name)}</h3>
      <div class="fund-facts"><span>${side(o.side)}・${type(o.type)}</span><span>${money(o.price)}</span><span>${number(o.shares)}株</span>
      <span>有効日 ${day(o.validFor)}</span></div><p class="fund-note">理由：${text(why(o))}</p>
      <p class="fund-note">損切り計画：${text(o.stopPlan)}</p></article>`;
  }
  function fill(t) {
    return `<article class="panel fund-card"><h3><span class="fund-status-tag is-filled">成立した売買</span>${day(t.date)} ${text(t.code)} ${text(t.name)}</h3>
      <div class="fund-facts"><span>${side(t.side)}・${type(t.type)}</span><span>${money(t.price)}</span><span>${number(t.shares)}株</span>
      <span>実現損益 ${money(t.pnl)}</span></div><p class="fund-note">理由：${text(why(t))}</p></article>`;
  }
  function range(input) {
    const dates=(input||[]).filter(record).map(r=>r.date).filter(validFundDate).sort();
    const unknown=(input||[]).length-dates.length;
    return `<p class="fund-note">収録期間：${dates.length?`${dates[0]} ～ ${dates.at(-1)}`:'未確認'}${unknown?` ／ 日付未確認 ${unknown}件`:''}。収録されていない過去分は含みません。</p>`;
  }
  function reportButton(engine,family,date,label,history=false) {
    if(!validFundDate(date) && !history) return '';
    return `<button class="btn ghost" style="min-height:44px" data-action="fund-report-open" data-engine="${engine}" data-family="${family}"
      ${validFundDate(date)?`data-date="${date}"`:''}${history?' data-history="true"':''}>${label}</button>`;
  }
  function render(engine,snapshot={},statusSnapshot={}) {
    if(!Object.hasOwn(labels,engine)) throw new TypeError('invalid_engine');
    const data=snapshot.data,meta=snapshot.metadata||{},status=statusSnapshot.data;
    const operationText=engine==='codex'?(operation[status?.status]||'未確認'):'処理状態の記録なし';
    const statusHTML=`<section class="panel fund-status"><h2>${labels[engine]}</h2><p>運用状態：${operationText}</p>
      <p class="fund-status-line" role="status">成績：${text(readState(snapshot))}${data && snapshot.state!=='available'?'。前回正常に取得した成績を表示しています':''}</p>
      <p>成績の正常取得時刻（協定世界時・UTC）：${received(snapshot.lastSuccessAt)} ／ 今回の取得試行（協定世界時・UTC）：${received(snapshot.lastAttemptAt)}</p>
      ${engine==='codex'?`<p>処理状態の取得：${text(readState(statusSnapshot))}</p><p>処理状態の確認時刻：${text(status?.checkedAt)}</p>
      <p>直近の試行：${text(status?.lastAttemptAt)} ／ 直近の成功：${text(status?.lastSuccessAt)}</p>`:''}</section>`;
    if(!record(data)) return `${statusHTML}<section class="panel fund-loading"><p>表示できる成績がまだありません</p></section>`;
    const nav=data.nav||{},benchmark=data.benchmark||{},valuation=day(meta.valuationDate),start=day(meta.startDate);
    const cashRatio=finite(data.cash) && finite(nav.current) && nav.current>0?data.cash/nav.current*100:null;
    const comparable=meta.benchmarkComparable===true;
    const positions=Array.isArray(data.positions)?data.positions:null,orders=rows(data,'orders','openOrders'),fills=rows(data,'fills','recentTrades');
    const journal=record(data.journal)?data.journal:null,journalDate=validFundDate(journal?.date)?journal.date:null;
    const body=journalDate?(typeof data.journalPlain==='string' && data.journalPlain.trim()?data.journalPlain:journal.markdown):null;
    const undatedBody=!journalDate?(typeof data.journalPlain==='string' && data.journalPlain.trim()?data.journalPlain:journal?.markdown):null;
    const allEmpty=[positions,orders,fills].every(a=>Array.isArray(a) && a.length===0);
    const dateForLinks=journalDate || (validFundDate(meta.valuationDate)?meta.valuationDate:null);
    return `${statusHTML}<section class="panel fund-summary">${meta.stale?'<p class="fund-stale-badge">生成から時間が経った記録です</p>':''}
      <div class="fund-metrics">${metric('評価日',valuation)}${metric('最終生成時刻',text(meta.generatedAt))}${metric('運用開始日',start)}
      ${metric('元本',money(data.start?.capital))}${metric('現在の資産額',money(nav.current))}${metric('運用開始からの増減率',percent(nav.totalReturnPct))}
      ${metric('現金',money(data.cash))}${metric('現金の割合',finite(cashRatio)?`${cashRatio.toFixed(2)}%`:'未確認')}
      ${metric('同じ開始日からの日経平均との差',comparable?points(benchmark.excessVsN225):'未確認')}
      ${metric('同じ開始日からのS&P500との差',comparable?points(benchmark.excessVsSpx):'未確認')}</div>
      ${!comparable?'<p class="fund-note">指数と同じ開始日か確認できないため、差を表示していません。</p>':''}
      <p class="fund-note">実際に使ったモデル：${meta.actualModel?text(meta.actualModel):'記録なし'} ／ 呼び出し費用：${finite(data.engine?.costUsd)?`${number(data.engine.costUsd)}米ドル`:'未確認'}</p>
      <p class="fund-note">取得時刻と資産の評価日は異なります。運用名から実モデルは推測しません。</p></section>
      ${renderIndividualChart(data,escapeHTML)}
      ${allEmpty?'<section class="panel fund-empty"><h2>まだ取引記録がありません</h2><p>保有銘柄はありません</p><p>有効な注文はありません</p><p>成立した売買はありません</p></section>':`
      <section class="fund-section fund-holdings"><h2>保有銘柄</h2>${listing(positions,position,'保有銘柄はありません')}</section>
      <section class="fund-section fund-activity"><h2>有効な注文</h2>${listing(orders,order,'有効な注文はありません')}
      <h2>成立した売買</h2>${range(fills)}${listing(fills,fill,'成立した売買はありません')}</section>`}
      <section class="panel fund-journal"><h2>${labels[engine]}の日誌</h2><p>日誌の日付：${journalDate||'未確認'}</p>
      ${typeof body==='string' && body.trim()?`<div class="md-render readonly-md fund-journal-plain">${renderMarkdown(body)}</div>`:'<p>日付を確認できる日誌本文がありません</p>'}
      ${typeof undatedBody==='string' && undatedBody.trim()?`<details class="fund-undated-journal"><summary style="min-height:44px">日付未確認の本文</summary><p>この本文の日付は確認できません。同日の日誌・朝ブリーフとは別の記録です。</p><div class="md-render readonly-md fund-journal-plain">${renderMarkdown(undatedBody)}</div></details>`:''}
      <div class="fund-report-links">${reportButton(engine,'journal',dateForLinks,`${dateForLinks||''}の日誌を読む`)}
      ${reportButton(engine,'brief',dateForLinks,`${dateForLinks||''}の朝ブリーフ`)}${reportButton(engine,'journal',dateForLinks,'過去の日誌を選ぶ',true)}</div></section>`;
  }
  return Object.freeze({render});
}
