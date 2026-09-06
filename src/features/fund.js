import { state } from '../state/store.js';
import { registerActions } from '../ui/actions.js';
import { createFundDOMBridge } from './fund/dom-bridge.js';
import { FUND_REPORT_TYPES } from './fund/report-selection.js';

let bridge;
export function configureFund(deps) {
  bridge = createFundDOMBridge({ ...deps, getState: () => state, registerActions,
    connection: () => ({ ...deps.personalDataConn(state.settings.github),
      ready: deps.personalDataReady(state.settings.github), prefix: 'taskchute' }),
    fetchImpl: (...args) => fetch(...args), headers: deps.githubHeaders,
    isOffline: () => navigator.onLine === false });
}
export function renderFund() { return bridge.render(); }
export function hydrateFundData(interval) { return bridge.hydrate(interval); }
export function invalidateFundConnection() { bridge.invalidateConnection(); }
export function hydrateFundSurfaces() { bridge.mounted(); }
export const fundReportsUI = Object.freeze({
  type: () => bridge.controller.activeKind(),
  isType: kind => FUND_REPORT_TYPES.some(type => type.kind === kind),
  select: (kind, date) => bridge.controller.selectReport(kind, date),
  leave: () => bridge.controller.leaveReports(),
  render: () => bridge.renderReport(),
  money: date => bridge.money(date),
  refresh: () => bridge.controller.reports.refresh(),
  dateChange: target => bridge.handleDate(target),
  link: href => bridge.handleLink(href)
});
