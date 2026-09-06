// Values and periods come from the producer. This view never calculates investment performance.
export function createFundComparisonView({ escapeHTML }) {
  const text = v => escapeHTML(String(v ?? '未確認'));
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const percent = v => finite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '未確認';
  const labels = { fable: 'FABLE FUND', codex: 'CODEX FUND' };
  function chart(data) {
    const points = data.series, values = points.flatMap(p => [p.fable, p.codex]);
    const low = Math.min(100, ...values), high = Math.max(100, ...values), pad = (high - low || 2) * .08;
    const min = low - pad, max = high + pad, width = 640, height = 240, inset = 24;
    const x = i => inset + i * (width - 2 * inset) / (points.length - 1);
    const y = n => inset + (max - n) * (height - 2 * inset) / (max - min);
    const paths = Object.keys(labels).map(engine => {
      const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p[engine]).toFixed(2)}`).join(' ');
      return `<path class="fund-chart-line is-${engine}" d="${path}"></path>`;
    }).join('');
    return `<section class="panel fund-chart"><h2>同じ期間の資産推移</h2>
      <p class="fund-chart-legend"><span class="fund-chart-key is-fable">FABLE FUND（実線）</span><span class="fund-chart-key is-codex">CODEX FUND（破線）</span></p>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="最初の共通評価日を100としたFABLEとCODEXの資産推移">
      <line class="fund-chart-baseline" x1="${inset}" x2="${width - inset}" y1="${y(100)}" y2="${y(100)}"></line>${paths}</svg>
      <p class="fund-chart-dates"><span>${text(data.startDate)}</span><span>${text(data.valuationDate)}</span></p>
      <p class="fund-note">両者に記録がある評価日だけを表示。点の間の値は補っていません。</p>
      <details><summary>評価日ごとの値を見る</summary><div class="fund-table-wrap"><table><thead><tr><th>評価日</th><th>FABLE</th><th>CODEX</th></tr></thead>
      <tbody>${points.map(p => `<tr><th>${text(p.date)}</th><td>${text(p.fable)}</td><td>${text(p.codex)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
  }
  function readState(snapshot) {
    if (snapshot.loading) return '読み込み中';
    return ({ idle: '未取得', disconnected: '接続設定が必要です', not_created: 'まだ作成されていません',
      unauthorized: '読み取り権限を確認してください', invalid: 'データの形式を確認できません', offline: 'オフライン',
      failed: snapshot.error === 'timeout' ? '読み取りが時間内に終わりませんでした' : '取得に失敗しました',
      available: '取得済み' })[snapshot.state] || '未確認';
  }
  function render(snapshot, individuals = {}) {
    const data = snapshot.data;
    const status = `<p class="fund-status-line" role="status">比較データ：${readState(snapshot)}${data && snapshot.state !== 'available' ? '。前回取得した記録を表示しています' : ''}</p>`;
    const sourceStates = `<section class="panel fund-source-states" aria-label="個別データの取得状態">${Object.entries(labels).map(([engine, label]) => {
      const source = individuals[engine] || { state: 'idle' };
      return `<p>${label} 個別成績：${readState(source)}${source.data && source.state !== 'available' ? '（前回正常値を保持）' : ''} ／ 個別の評価日：${text(source.metadata?.valuationDate)} ／ 生成時刻：${text(source.metadata?.generatedAt)}${source.metadata?.stale ? '（生成から時間が経っています）' : ''}</p>`;
    }).join('')}<p>上記の個別評価日と、比較ファイルの共通期間は別に確認します。</p></section>`;
    const limitation = '<p class="fund-note">FABLEは既存の保有から継続し、CODEXは現金から開始しています。同じ期間でも開始時の保有は異なるため、この比較だけでAIの能力の優劣は決まりません。</p>';
    if (!data || data.status !== 'ready' || data.series.length < 2) return `${status}${sourceStates}<section class="panel fund-comparison-empty"><h2>同じ期間で比較</h2>
      <p>${data?.status === 'error' ? '比較データの生成に失敗しています' : '比較できる記録がまだそろっていません'}</p>
      <p>比較開始日：未確認 ／ 終了日：未確認</p>${limitation}</section>`;
    const difference = data.codexMinusFablePctPoints;
    return `${status}${sourceStates}<section class="panel fund-comparison-period"><h2>同じ期間で比較</h2>
      <p>比較開始日：${text(data.startDate)} ／ 終了日：${text(data.valuationDate)}</p>
      <p>最終生成時刻：${text(data.generatedAt)}</p>${snapshot.metadata?.stale ? '<p>生成から時間が経った記録です</p>' : ''}${limitation}</section>
      <div class="fund-compare-cards">${Object.keys(labels).map(engine => `<section class="panel fund-compare-card" data-fund-engine="${engine}">
        <h3>${labels[engine]}</h3><dl><dt>共通期間の増減率</dt><dd>${percent(data.metrics[engine].returnPct)}</dd>
        <dt>共通評価日で観測した最大の落ち込み</dt><dd>${percent(data.metrics[engine].maxDrawdownPct)}</dd></dl>
        <button class="btn ghost" data-action="fund-select" data-engine="${engine}">保有・現金・注文を見る</button>
        <button class="btn ghost" data-action="fund-report-open" data-engine="${engine}" data-family="journal" data-date="${text(data.valuationDate)}">${text(data.valuationDate)}の日誌</button>
      </section>`).join('')}</div>
      <p class="fund-comparison-difference">増減率の差（CODEX − FABLE）：${finite(difference) ? `${difference > 0 ? '+' : ''}${difference.toFixed(2)}ポイント` : '未確認'}</p>
      ${chart(data)}${data.note ? `<p class="fund-note">${text(data.note)}</p>` : ''}`;
  }
  return Object.freeze({ render, readState });
}
