export const FUND_SOURCES = Object.freeze({ fable: 'dashboard/fund.json', codex: 'dashboard/fund-codex.json',
  status: 'dashboard/fund-codex-status.json', comparison: 'dashboard/fund-comparison.json' });
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const string = v => typeof v === 'string';
const nullable = test => v => v === null || test(v);
const array = test => v => Array.isArray(v) && v.every(test);
const shape = schema => v => record(v) && Object.entries(schema).every(([k, test]) => Object.hasOwn(v, k) && test(v[k]));
export function validFundDate(v) {
  if (!string(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y,m,d] = v.split('-').map(Number), leap = y%4===0 && (y%100!==0 || y%400===0);
  return y>=1 && m>=1 && m<=12 && d>=1 && d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
export function fundTimestamp(v) {
  if (!string(v)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m || !validFundDate(m[1])) return null;
  const [y,mo,d]=m[1].split('-').map(Number), h=+m[2], min=+m[3], sec=+m[4];
  const zone=m[6], zh=zone==='Z'?0:+zone.slice(1,3), zm=zone==='Z'?0:+zone.slice(4);
  if(h>23 || min>59 || sec>59 || zh>23 || zm>59) return null;
  const date=new Date(0); date.setUTCFullYear(y,mo-1,d); date.setUTCHours(h,min,sec,+(m[5]||'').padEnd(3,'0').slice(0,3));
  return date.getTime()-(zone[0]==='-'?-1:1)*(zh*60+zm)*60000;
}
const navPoint=shape({date:string,nav:finite,n225:nullable(finite),spx:nullable(finite)});
const position=shape({code:string,name:string,shares:finite,avgCost:finite,lastClose:nullable(finite),
  marketValue:nullable(finite),pnlPct:nullable(finite),openedAt:string,stopNote:string});
const order=shape({id:string,validFor:string,side:string,type:string,code:string,name:string,price:finite,shares:finite,rationale:string,stopPlan:string});
const trade=shape({date:string,side:string,type:string,code:string,name:string,shares:finite,price:finite,pnl:nullable(finite),rationale:string});
const base=shape({version:v=>v===1,generatedAt:string,start:shape({date:string,capital:finite}),
  nav:shape({current:finite,dayChangePct:finite,totalReturnPct:finite,series:array(navPoint)}),
  benchmark:shape({n225ReturnPct:nullable(finite),spxReturnPct:nullable(finite),excessVsN225:nullable(finite),excessVsSpx:nullable(finite)}),
  cash:finite,positions:array(position),openOrders:array(order),recentTrades:array(trade)});
const individual = v => base(v) && (v.journal==null || shape({date:string,markdown:string})(v.journal))
  && (v.orders===undefined || array(record)(v.orders)) && (v.fills===undefined || array(record)(v.fills))
  && (v.series==null || shape({dates:array(string),fund:array(nullable(finite)),n225:array(nullable(finite)),spx:array(nullable(finite))})(v.series))
  && (v.journalPlain==null || string(v.journalPlain));
const orderedDates = rows => Array.isArray(rows) && rows.length>0
  && rows.every((r,i)=>record(r) && validFundDate(r.date) && (!i || rows[i-1].date<r.date));
const statuses = new Set(['not_started','ready','waiting_for_prices','skipped','budget_stopped','error']);
const timestamp = v => fundTimestamp(v)!==null;
function validComparison(v) {
  if (!record(v) || v.version!==1 || !timestamp(v.generatedAt)) return false;
  if (v.status==='insufficient_data' || v.status==='error') return Array.isArray(v.series) && v.series.length===0
    && v.metrics===null && v.startDate===null && v.valuationDate===null;
  if (v.status!=='ready' || !orderedDates(v.series) || v.series.length<2) return false;
  const metric=shape({returnPct:finite,maxDrawdownPct:n=>finite(n)&&n<=0});
  return v.startDate===v.series[0].date && v.valuationDate===v.series.at(-1).date
    && v.series.every(r=>finite(r.fable)&&finite(r.codex)&&r.fable>0&&r.codex>0)
    && v.series[0].fable===100 && v.series[0].codex===100
    && shape({fable:metric,codex:metric})(v.metrics) && finite(v.codexMinusFablePctPoints);
}
export function validateFundSource(source, value) {
  let ok=false;
  if(source==='fable' || source==='codex') ok=individual(value)
    && (source==='fable' ? value.engine?.id == null || value.engine.id==='fable'
      : record(value.engine)&&value.engine.id==='codex');
  else if(source==='status') ok=shape({version:v=>v===1,engine:v=>v==='codex',status:string,checkedAt:timestamp,
    lastAttemptAt:nullable(timestamp),lastSuccessAt:nullable(timestamp)})(value);
  else if(source==='comparison') ok=validComparison(value);
  return ok ? {ok:true,data:value} : {ok:false,reason:'invalid_shape'};
}
export function fundMetadata(source, data, nowMs=Date.now(), staleMs=120*60*60*1000) {
  const generatedAt=string(data?.generatedAt)?data.generatedAt:null, generatedAtMs=fundTimestamp(generatedAt);
  let valuationDate=null, startDate=null, benchmarkComparable=false;
  if(source==='fable' || source==='codex') {
    const rows=data?.nav?.series;
    if(orderedDates(rows)) valuationDate=rows.at(-1).date;
    startDate=validFundDate(data?.start?.date)?data.start.date:null;
    benchmarkComparable=!!valuationDate && !!startDate && rows[0].date===startDate;
  } else {
    valuationDate=validFundDate(data?.valuationDate)?data.valuationDate:null;
    startDate=validFundDate(data?.startDate)?data.startDate:null;
  }
  return {generatedAt,generatedAtMs,valuationDate,startDate,
    stale:generatedAtMs===null?null:nowMs-generatedAtMs>staleMs,benchmarkComparable,
    actualModel:string(data?.engine?.actualModel)&&data.engine.actualModel.trim()?data.engine.actualModel:null,
    producerStatus:source==='status'?(statuses.has(data?.status)?data.status:'unknown'):source==='comparison'?data?.status:null,
    producerCheckedAt:source==='status'&&timestamp(data?.checkedAt)?data.checkedAt:null};
}
