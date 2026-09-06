import { createFundReadTransport } from './read-transport.js';
import { createFundWorkspace } from './workspace.js';
import { createFundReportSelection, FUND_REPORT_TYPES } from './report-selection.js';
import { createFundReportGateway } from './report-gateway.js';
import { createFundReportView } from './report-view.js';

// Application navigation and dirty-input ownership remain in the caller.
// Async reads may only update the dedicated, read-only surfaces supplied here.
export function createFundController({ connection, fetchImpl, headers, onUnauthorized, onAuthorized,
  escapeHTML, renderHeader, renderMarkdown, registerActions, currentView, patchFund, patchReport,
  patchMoney, onBack, now = Date.now, isOffline = () => false, timeoutMs = 30000 }) {
  const transport = createFundReadTransport({ getConnection: connection, fetchImpl, headers, onUnauthorized, onAuthorized });
  const readOptions = { ...transport, now, isOffline, timeoutMs };
  const selection = createFundReportSelection();
  const reportGateway = createFundReportGateway(readOptions);
  let reportActive = false;
  const reports = createFundReportView({ selection, gateway: reportGateway, escapeHTML, renderMarkdown, onBack,
    onUpdate(event) {
      if (event.area === 'money') patchMoney(event.date, reports.money(event.date));
      else if (reportActive && currentView() === 'ai-reports') patchReport(reports.render());
    }
  });
  const workspace = createFundWorkspace({ ...readOptions, transport, escapeHTML, renderHeader,
    renderMarkdown, registerActions, onUpdate(value) { if (currentView() === 'fund') patchFund(value); } });
  return Object.freeze({ workspace, reports,
    activeKind: () => reportActive ? selection.snapshot().kind : null,
    selectReport(kind, date) {
      const type = FUND_REPORT_TYPES.find(item => item.kind === kind);
      if (!type) return false;
      reportActive = true;
      void reports.select(type.engine, type.family, date);
      return true;
    },
    leaveReports() { reportActive = false; },
    invalidateConnection() {
      transport.invalidate();
      reportGateway.resetConnection();
      workspace.resetConnection();
      if (reportActive && currentView() === 'ai-reports') patchReport(reports.render());
      // The caller refreshes every currently mounted MONEY surface by its own data-date.
      patchMoney(null, null);
    },
    dispose() { reportActive = false; workspace.dispose(); reportGateway.dispose(); }
  });
}
