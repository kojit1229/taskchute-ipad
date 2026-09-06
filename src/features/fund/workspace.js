import { createFundReadGateway } from './read-gateway.js';
import { createFundComparisonView } from './comparison-view.js';
import { createFundIndividualView } from './individual-view.js';

// Display choices and generated data live here, outside persisted application state.
export function createFundWorkspace({ transport, escapeHTML, renderHeader, renderMarkdown, registerActions,
  onUpdate = () => {}, now = Date.now, isOffline = () => false, timeoutMs = 30000 }) {
  const gateway = createFundReadGateway({ ...transport, now, isOffline, timeoutMs });
  const comparison = createFundComparisonView({ escapeHTML });
  const individual = createFundIndividualView({ escapeHTML, renderMarkdown, readState: comparison.readState });
  let selected = 'comparison';
  const sources = ['fable', 'codex', 'status', 'comparison'];
  const choices = { comparison: '比較', fable: 'FABLE', codex: 'CODEX' };
  function content() {
    return selected === 'comparison' ? comparison.render(gateway.snapshot('comparison'), { fable: gateway.snapshot('fable'), codex: gateway.snapshot('codex') })
      : individual.render(selected, gateway.snapshot(selected), gateway.snapshot('status'));
  }
  function notify() { onUpdate({ selected, content: content() }); }
  async function load({ force = false, maxAgeMs = 1800000 } = {}) {
    const tasks = sources.map(source => gateway.load(source, { force, maxAgeMs }).then(result => {
      if (!result.discarded) notify();
      return result;
    }));
    notify();
    return Promise.all(tasks);
  }
  function select(engine) {
    if (!Object.hasOwn(choices, engine)) return false;
    selected = engine; notify(); return true;
  }
  function render() {
    const controls = `<p class="fund-note">模擬運用・閲覧専用</p><button class="btn ghost" data-action="fund-refresh">再取得</button>`;
    return `<div class="fund-view">${renderHeader('PAPER TRADE', 'FUND', controls)}
      <div class="fund-switches" role="group" aria-label="FUNDの表示">${Object.entries(choices).map(([engine, label]) =>
        `<button class="btn ghost" data-action="fund-select" data-engine="${engine}" aria-pressed="${selected === engine}">${label}</button>`).join('')}</div>
      <div class="fund-content" data-fund-selection="${selected}">${content()}</div></div>`;
  }
  registerActions({ 'fund-select': ({ target }) => select(target?.dataset?.engine), 'fund-refresh': () => { void load({ force: true }); } });
  return Object.freeze({ render, content, select, load, selected: () => selected, snapshot: gateway.snapshot,
    resetConnection() { gateway.resetConnection(); notify(); }, dispose: gateway.dispose });
}
