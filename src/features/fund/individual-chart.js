import {validFundDate} from './read-contract.js';
const finite=v=>typeof v==='number' && Number.isFinite(v);
const datesValid=dates=>Array.isArray(dates) && dates.length>0 && dates.every((d,i)=>validFundDate(d) && (!i || dates[i-1]<d));
export function individualChartModel(data) {
  const s=data?.series;
  if(s && datesValid(s.dates) && ['fund','n225','spx'].every(k=>Array.isArray(s[k]) && s[k].length===s.dates.length &&
    s[k].every(v=>v===null || finite(v)))) {
    return {dates:s.dates,normalized:true,unit:'提供された起点100の値',lines:[
      {label:'資産',key:'is-nav',values:s.fund},{label:'日経平均',key:'is-n225',values:s.n225},
      {label:'S&P500',key:'is-spx',values:s.spx}]};
  }
  const rows=data?.nav?.series;
  if(!Array.isArray(rows) || !datesValid(rows.map(r=>r?.date)) || !rows.every(r=>r.nav===null || finite(r.nav))) return null;
  return {dates:rows.map(r=>r.date),normalized:false,unit:'資産額（円）',lines:[{label:'資産額',unit:'資産額（円）',key:'is-nav',values:rows.map(r=>r.nav)}],
    indices:[{label:'日経平均',key:'is-n225',unit:'日経平均（円）',values:rows.map(r=>finite(r.n225)?r.n225:null)},
      {label:'S&P500',key:'is-spx',unit:'S&P500（指数ポイント）',values:rows.map(r=>finite(r.spx)?r.spx:null)}]};
}
function plot(dates,lines,unit,normalized,escapeHTML) {
  const values=lines.flatMap(l=>l.values.filter(finite));
  if(!values.length) return `<p class="fund-empty">${escapeHTML(unit)}：全日付の値が未確認です</p>`;
  const domain=normalized?[...values,100]:values;
  const low=Math.min(...domain),high=Math.max(...domain),range=high-low||2,min=low-range*.08,max=high+range*.08;
  if(!finite(min) || !finite(max) || max<=min) return '<p>推移の表示範囲を確認できません</p>';
  const x=i=>dates.length===1?160:16+i*288/(dates.length-1),y=n=>16+(max-n)*128/(max-min);
  const paths=lines.map(l=>{
    let move=true,path='';const dots=[];
    l.values.forEach((v,i)=>{
      if(!finite(v)) {move=true;return;}
      path+=`${move?'M':'L'}${x(i).toFixed(2)} ${y(v).toFixed(2)} `;move=false;
      dots.push(`<circle class="fund-chart-dot ${l.key}" cx="${x(i).toFixed(2)}" cy="${y(v).toFixed(2)}" r="2"></circle>`);
    });
    return path?`<path class="fund-chart-line ${l.key}" d="${path.trim()}"></path>${dots.join('')}`:'';
  }).join('');
  return `<svg viewBox="0 0 320 160" role="img" aria-label="${escapeHTML(unit)}の推移">${normalized?`<line class="fund-chart-baseline" x1="16" x2="304" y1="${y(100).toFixed(2)}" y2="${y(100).toFixed(2)}" stroke="#888" stroke-width="1"></line>`:''}${paths}</svg>`;
}
function table(model,escapeHTML) {
  const lines=[...model.lines,...(model.indices||[])];
  return `<details><summary style="min-height:44px">評価日ごとの値を見る</summary><div class="fund-table-wrap"><table><thead><tr><th>評価日</th>
    ${lines.map(l=>`<th>${escapeHTML(l.unit||l.label)}${model.normalized?'（提供起点100）':''}</th>`).join('')}</tr></thead><tbody>${model.dates.map((date,i)=>`<tr><th>${escapeHTML(date)}</th>
    ${lines.map(l=>`<td>${finite(l.values[i])?l.values[i].toLocaleString('ja-JP'):'未確認'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
export function renderIndividualChart(data,escapeHTML) {
  const model=individualChartModel(data);
  if(!model) return '<section class="panel fund-chart"><h2>資産の推移</h2><p>推移の記録を確認できません</p></section>';
  return `<section class="panel fund-chart"><div class="fund-chart-head"><h2>資産の推移</h2>
    <div class="fund-chart-legend">${model.lines.map(l=>`<span class="fund-chart-key ${l.key}">${l.label}</span>`).join('')}</div></div>
    <p class="fund-note">${model.unit}。欠けた値は線でつなぎません。</p>
    ${plot(model.dates,model.lines,model.unit,model.normalized,escapeHTML)}
    ${(model.indices||[]).map(l=>`<section class="fund-index-chart"><h3>${l.unit}</h3><p>提供された値。資産額とは単位・目盛りが異なります。</p>${plot(model.dates,[l],l.unit,false,escapeHTML)}</section>`).join('')}
    <p class="fund-chart-dates"><span>${escapeHTML(model.dates[0])}</span><span>${escapeHTML(model.dates.at(-1))}</span></p>
    ${table(model,escapeHTML)}</section>`;
}
