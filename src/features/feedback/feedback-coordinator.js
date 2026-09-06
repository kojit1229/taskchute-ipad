import { captureReportInput } from './report-input.js';
import { buildReportMarkdown } from './report-builder.js';
import { deriveReportValues } from './report-derived.js';
import { makeRequest, validateRequest } from './request-contract.js';
import { createQueueGateway } from './queue-gateway.js';

// No live app/HTTP defaults. The caller must supply the protected, proof-producing boundaries.
export function createFeedbackCoordinator({ getState, identity, selectedDate, today, now, crypto,
  localCommit, serializePrimary, proof, queueTransport, onPrepared = () => {}, onProven = () => {} } = {}) {
  if ([getState, identity, selectedDate, today, now, localCommit, serializePrimary].some(fn => typeof fn !== 'function')
    || !crypto?.subtle?.digest || !proof?.state || !proof?.report
    || !['get','put','connectionKey'].every(key => typeof queueTransport?.[key] === 'function')) throw Error('coordinator_configuration_required');
  let busy = false;
  return async (date, ownerCurrent) => {
    if (typeof ownerCurrent !== 'function' || ownerCurrent() !== true) throw Error('feedback_owner_required');
    if (busy) throw Error('feedback_busy');
    busy = true;
    try {
      const startIdentity = identity(), startToday = today(), startSelected = selectedDate();
      if (startIdentity == null || date !== startSelected) throw Error('feedback_context_required');
      const isCurrent = () => identity() === startIdentity && today() === startToday && selectedDate() === startSelected && ownerCurrent() === true;
      const guard = () => { if (!isCurrent()) throw Error('feedback_context_changed'); };
      const source = getState();
      const input = captureReportInput(source, date, deriveReportValues);
      const audit = source.journalMeta?.[date]?.textUpdatedAt ?? '';
      if (typeof audit !== 'string') throw Error('invalid_journal_audit');
      const candidate = Object.freeze({ date, reportMarkdown: buildReportMarkdown(input),
        journalText: input.state.journals[date], journalTextUpdatedAt: audit });
      guard();
      const saved = localCommit(candidate);
      if (saved?.then || saved?.ok !== true || saved.date !== date || saved.reportMarkdown !== candidate.reportMarkdown
        || saved.journalText !== candidate.journalText) throw Error('local_save_unconfirmed');
      guard();
      // This private string belongs to the state transport, never to the request DTO or logs.
      const content = serializePrimary();
      if (typeof content !== 'string') throw Error('primary_candidate_required');
      const request = await makeRequest(date, candidate.reportMarkdown, candidate.journalText, now(), crypto);
      guard();
      request.snapshot.journalTextUpdatedAt = audit;
      const validated = await validateRequest(request, startToday, crypto);
      guard();
      onPrepared(structuredClone(validated)); guard();
      const context = Object.freeze({ isCurrent });
      const stateProof = await proof.state(content, context); guard();
      if (!/^[a-f0-9]{40}$/i.test(stateProof?.sha || '')) throw Error('primary_sync_unconfirmed');
      const reportProof = await proof.report(date, candidate.reportMarkdown, context); guard();
      if (!/^[a-f0-9]{40}$/i.test(reportProof?.sha || '')) throw Error('report_write_unconfirmed');
      onProven(structuredClone(validated)); guard();
      const confirmSavedInput = check => {
        guard();
        if (check.date !== validated.date || check.inputHash !== validated.inputHash
          || check.snapshot?.reportMarkdown !== candidate.reportMarkdown || check.snapshot?.journalText !== candidate.journalText)
          throw Error('saved_input_mismatch');
        return { date: validated.date, inputHash: validated.inputHash };
      };
      const queueKey = queueTransport.connectionKey();
      const queueGuard = () => { guard(); if (queueTransport.connectionKey() !== queueKey) throw Error('feedback_context_changed'); };
      const transport = {
        connectionKey: () => { queueGuard(); return 'captured-feedback-context'; },
        get: async (...args) => { queueGuard(); const value = await queueTransport.get(...args); queueGuard(); return value; },
        put: async (...args) => { queueGuard(); const value = await queueTransport.put(...args); queueGuard(); return value; }
      };
      const queue = createQueueGateway({ transport, crypto, today, confirmSavedInput });
      const result = await queue.enqueue(validated);
      guard();
      return result;
    } finally { busy = false; }
  };
}
