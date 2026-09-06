import { createFundController } from './controller.js';
import { FUND_REPORT_TYPES, validReportDate } from './report-selection.js';

// Integration adapter: updates only read-only FUND/report/MONEY regions.
export function createFundDOMBridge(deps) {
  const { root, getState, registerActions, requestDraftLeave, setView, render, markRead } = deps;
  let origin = null, restoreOrigin = false, pendingReport = null, displayedReportEpoch = null;
  const captureScroll = () => [...new Set([document.scrollingElement, document.getElementById('app'), root])]
    .filter(element => element && typeof element.scrollTop === 'number')
    .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  const restoreScroll = positions => positions.forEach(({ element, top, left }) => {
    element.scrollTop = top;
    if (typeof left === 'number') element.scrollLeft = left;
  });
  const focusKey = element => element?.id ? { id: element.id } : element?.dataset?.action ? {
    action: element.dataset.action, engine: element.dataset.engine, family: element.dataset.family,
    date: element.dataset.date
  } : null;
  function focusTarget(key, scope = root) {
    if (!key) return null;
    if (key.id) return scope.querySelector(`#${CSS.escape(key.id)}`);
    return [...scope.querySelectorAll('[data-action]')].find(element =>
      ['action', 'engine', 'family', 'date'].every(name => element.dataset[name] === key[name]));
  }
  function replaceReadonly(host, html) {
    if (!host) return;
    const focused = host.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    const scroll = captureScroll();
    const opened = [...host.querySelectorAll('details')].map(element => element.open);
    host.innerHTML = html;
    [...host.querySelectorAll('details')].forEach((element, index) => { if (opened[index] !== undefined) element.open = opened[index]; });
    focusTarget(focused, host)?.focus({ preventScroll: true });
    restoreScroll(scroll);
  }
  function patchReport(html) {
    const host = root.querySelector('[data-fund-report-host]');
    if (!host) return;
    const epoch = controller.reports.snapshot().index.epoch;
    if (epoch === displayedReportEpoch && host.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') {
      pendingReport = html; return;
    }
    displayedReportEpoch = epoch;
    pendingReport = null; replaceReadonly(host, html); markRead();
  }
  const controller = createFundController({ ...deps, currentView: () => getState().currentView,
    patchFund({ selected, content }) {
      const host = root.querySelector('.fund-content');
      if (host) host.dataset.fundSelection = selected;
      replaceReadonly(host, content);
      root.querySelectorAll('.fund-switches [data-engine]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.engine === selected)));
    },
    patchReport,
    patchMoney(date, html) {
      root.querySelectorAll('[data-fund-money]').forEach(host => {
        if (date !== null && host.dataset.date !== date) return;
        const ownDate = host.dataset.date;
        // Keep the stable wrapper and adjacent editable journal nodes intact.
        const template = document.createElement('template');
        template.innerHTML = date === null ? controller.reports.money(ownDate) : html;
        replaceReadonly(host, template.content.firstElementChild?.innerHTML || '');
      });
    }, onBack: () => back()
  });
  function guard(action) { if (!requestDraftLeave(action)) action(); }
  function open(engine, family, date) {
    const type = FUND_REPORT_TYPES.find(item => item.engine === engine && item.family === family);
    if (!type || (date !== undefined && !validReportDate(date))) return false;
    const state = getState(), captured = { view: state.currentView, date: state.selectedDate,
      scroll: captureScroll(), focus: focusKey(document.activeElement) };
    guard(() => {
      pendingReport = null;
      if (captured.view !== 'ai-reports') origin = captured;
      controller.selectReport(type.kind, date); setView('ai-reports', true);
    });
    return true;
  }
  function back() {
    const captured = origin;
    guard(() => {
      if (!captured) { setView('fund', true); return; }
      getState().selectedDate = captured.date;
      restoreOrigin = true; setView(captured.view, true);
    });
  }
  function change(operation) { guard(() => { operation(); render(); }); }
  registerActions({
    'fund-report-open': ({ target }) => open(target.dataset.engine, target.dataset.family || 'journal', target.dataset.date),
    'fund-report-engine': ({ target }) => { const s = controller.reports.snapshot(); open(target.dataset.engine, s.family, s.date || undefined); },
    'fund-report-family': ({ target }) => { const s = controller.reports.snapshot(); open(s.engine, target.dataset.family, s.date || undefined); },
    'fund-report-previous': () => change(() => { void controller.reports.previous(); }),
    'fund-report-next': () => change(() => { void controller.reports.next(); }),
    'fund-report-refresh': () => { void controller.reports.refresh(); }, 'fund-report-back': back
  });
  root.addEventListener('focusout', () => queueMicrotask(() => { if (pendingReport !== null) patchReport(pendingReport); }));
  return Object.freeze({ controller, open,
    render: () => controller.workspace.render(),
    renderReport() {
      displayedReportEpoch = controller.reports.snapshot().index.epoch;
      return `<div data-fund-report-host>${controller.reports.render()}</div>`;
    },
    money: date => controller.reports.money(date),
    invalidateConnection: () => { pendingReport = null; controller.invalidateConnection(); },
    handleDate(target) {
      if (!target.matches('[data-fund-report-date]') || !validReportDate(target.value)) return false;
      const s = controller.reports.snapshot(), date = target.value;
      target.value = s.date || '';
      open(s.engine, s.family, date);
      target.value = controller.reports.snapshot().date || '';
      return true;
    },
    handleLink(href) { const target = controller.reports.resolveLink(href); return target ? open(target.engine, target.family, target.date) : false; },
    async hydrate(interval) { await controller.workspace.load({ maxAgeMs: interval }); return false; },
    mounted() {
      const state = getState();
      if (restoreOrigin && origin && (state.currentView !== origin.view || state.selectedDate !== origin.date)) restoreOrigin = false;
      if (state.currentView === 'fund') void controller.workspace.load();
      if (state.currentView === 'ai-reports' && controller.activeKind()) void controller.reports.loadCurrent();
      root.querySelectorAll('[data-fund-money]').forEach(host => { if (validReportDate(host.dataset.date)) void controller.reports.loadMoney(host.dataset.date); });
      if (restoreOrigin && origin && state.currentView === origin.view && state.selectedDate === origin.date && !state.modal) {
        restoreOrigin = false;
        focusTarget(origin.focus)?.focus({ preventScroll: true }); restoreScroll(origin.scroll);
      }
    }
  });
}
