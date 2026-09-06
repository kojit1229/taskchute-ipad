// Only the report may be PUT here. Primary state must pass the existing protected sync writer.
export function createReportProofAdapter({ get, putReport, syncProtectedState } = {}) {
  if ([get, putReport, syncProtectedState].some(fn => typeof fn !== 'function')) throw Error('proof_configuration_required');
  const guard = context => { if (context.isCurrent() !== true) throw Error('feedback_context_changed'); };
  const validRead = value => value && [200, 404].includes(value.status)
    && (value.status === 404 || typeof value.sha === 'string' && /^[a-f0-9]{40}$/i.test(value.sha) && typeof value.text === 'string');
  return {
    async state(expectedContent, context) {
      guard(context);
      const result = await syncProtectedState({ expectedContent, isCurrent: context.isCurrent });
      guard(context);
      if (result?.ok !== true || result.content !== expectedContent) throw Error('primary_sync_unconfirmed');
      const remote = await get({ kind: 'primary-state' }, { fresh: true, context });
      guard(context);
      if (!validRead(remote) || remote.status !== 200 || remote.text !== expectedContent) throw Error('primary_readback_unconfirmed');
      return { sha: remote.sha };
    },
    async report(date, text, context) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof text !== 'string') throw Error('report_input_required');
      const resource = Object.freeze({ kind: 'report', date });
      for (let attempt = 0; attempt < 3; attempt++) {
        guard(context);
        const before = await get(resource, { fresh: true, context });
        guard(context);
        if (!validRead(before)) throw Error('report_read_unavailable');
        if (before.status === 200 && before.text === text) return { sha: before.sha };
        try { await putReport(resource, text, { expectedSha: before.status === 404 ? null : before.sha, context }); }
        catch { /* An unknown PUT outcome must be checked by a fresh GET, never assumed unsent. */ }
        guard(context);
        const after = await get(resource, { fresh: true, context });
        guard(context);
        if (!validRead(after)) throw Error('report_readback_unconfirmed');
        if (after.status === 200 && after.text === text) return { sha: after.sha };
      }
      throw Error('report_write_unconfirmed');
    }
  };
}
