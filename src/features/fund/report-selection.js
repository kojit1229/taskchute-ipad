export const FUND_REPORT_TYPES = Object.freeze([
  Object.freeze({kind:'fundJournal',engine:'fable',family:'journal',prefix:'FABLE FUND日誌_',label:'FABLE FUND日誌'}),
  Object.freeze({kind:'fundJournalCodex',engine:'codex',family:'journal',prefix:'CODEX FUND日誌_',label:'CODEX FUND日誌'}),
  Object.freeze({kind:'market',engine:'fable',family:'brief',prefix:'朝の投資ブリーフ_',label:'朝の投資ブリーフ FABLE'}),
  Object.freeze({kind:'marketCodex',engine:'codex',family:'brief',prefix:'朝の投資ブリーフ_CODEX_',label:'朝の投資ブリーフ CODEX'})
]);
export function validReportDate(date) {
  if(typeof date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y,m,d]=date.split('-').map(Number), leap=y%4===0 && (y%100!==0 || y%400===0);
  return y>=1 && m>=1 && m<=12 && d>=1 && d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
export function classifyFundReport(entry) {
  if(!entry || typeof entry.name!=='string' || (entry.type!=null && entry.type!=='file')) return null;
  const type=FUND_REPORT_TYPES.find(t=>entry.name.startsWith(t.prefix) &&
    entry.name.endsWith('.md') && validReportDate(entry.name.slice(t.prefix.length,-3)));
  if(!type) return null;
  const date=entry.name.slice(type.prefix.length,-3);
  if((entry.kind!==undefined && entry.kind!==type.kind) || (entry.date!==undefined && entry.date!==date)) return null;
  return Object.freeze({...type,date,name:entry.name});
}
export function fundReportFile(kind,date) {
  const type=FUND_REPORT_TYPES.find(t=>t.kind===kind);
  if(!type || !validReportDate(date)) throw new TypeError('invalid_report_selection');
  return `${type.prefix}${date}.md`;
}
// Index metadata wins even when invalid: never turn an explicit mismatch into a Contents fallback.
// Other report types retain their original Contents-first behavior.
export function unionReportEntries(indexFiles,dirList) {
  const map=new Map();
  for(const e of Array.isArray(dirList)?dirList:[]) if(e && typeof e.name==='string') map.set(e.name,{...e});
  for(const e of Array.isArray(indexFiles)?indexFiles:[]) {
    if(!e || typeof e.name!=='string') continue;
    const prior=map.get(e.name), isFund=FUND_REPORT_TYPES.some(t=>e.kind===t.kind || e.name.startsWith(t.prefix));
    if(!prior) map.set(e.name,{...e});
    else if(isFund) map.set(e.name,{...prior,...e});
  }
  return [...map.values()];
}
export function fundReportHistory(entries,family) {
  return [...new Set((Array.isArray(entries)?entries:[]).map(classifyFundReport)
    .filter(e=>e?.family===family).map(e=>e.date))].sort().reverse();
}
// Selection is private memory only. Initialization happens once; missing dates stay selected.
export function createFundReportSelection(initial={}) {
  let kind=FUND_REPORT_TYPES.some(t=>t.kind===initial.kind)?initial.kind:'fundJournal';
  let date=validReportDate(initial.date)?initial.date:null;
  const snapshot=()=>Object.freeze({...FUND_REPORT_TYPES.find(t=>t.kind===kind),date,
    name:date?fundReportFile(kind,date):null});
  return Object.freeze({snapshot,
    select(nextKind,nextDate=date) {
      if(!FUND_REPORT_TYPES.some(t=>t.kind===nextKind) || (nextDate!==null && !validReportDate(nextDate)))
        throw new TypeError('invalid_report_selection');
      kind=nextKind;date=nextDate;return snapshot();
    },
    initialize(entries) {if(!date) date=fundReportHistory(entries,snapshot().family)[0]||null;return snapshot();},
    history(entries) {return [...new Set([...fundReportHistory(entries,snapshot().family),...(date?[date]:[])])].sort().reverse();},
    move(entries,direction) {
      if(direction!==-1 && direction!==1) throw new TypeError('invalid_direction');
      const days=this.history(entries), at=days.indexOf(date), next=days[at+direction];
      if(at>=0 && next) date=next;return snapshot();
    }
  });
}
export function resolveFundReportLink(href) {
  if(typeof href!=='string' || href.includes('/') || href.includes('\\')) return null;
  let name;try {name=decodeURIComponent(href);} catch {return null;}
  return classifyFundReport({name});
}
