// Captured read-only connection. Credentials remain inside this closure, never in cache envelopes.
export function createFundReadTransport({ getConnection, fetchImpl, headers, onUnauthorized = () => {}, onAuthorized = () => {} }) {
  let revision = 0, previous = null;
  const contexts = new WeakMap();
  const keys = ['ready', 'owner', 'repo', 'branch', 'token', 'prefix'];
  function captureConnection() {
    let supplied;
    try { supplied = getConnection(); } catch { supplied = null; }
    const next = { ready: supplied?.ready === true, owner: supplied?.owner, repo: supplied?.repo,
      branch: supplied?.branch, token: supplied?.token, prefix: supplied?.prefix };
    next.ready = next.ready && ['owner', 'repo', 'branch', 'token', 'prefix'].every(k => typeof next[k] === 'string' && next[k].length > 0);
    if (!previous || keys.some(k => previous[k] !== next[k])) { revision++; previous = next; }
    const context = Object.freeze({});
    contexts.set(context, { ...next, revision });
    return { ready: next.ready, revision, readContext: context };
  }
  // Call synchronously for every connection-setting edit, including A → B → A between reads.
  function invalidate() { revision++; previous = null; }
  function current(captured, signal) {
    return !signal?.aborted && captureConnection().revision === captured.revision;
  }
  const allowed = path => typeof path === 'string' && (
    /^dashboard\/fund(?:-codex(?:-status)?|-comparison)?\.json$/.test(path) || path === 'report-index.json' ||
    /^(?:FABLE FUND日誌_|CODEX FUND日誌_|朝の投資ブリーフ_(?:CODEX_)?)[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$/.test(path));
  async function request(path, { context, signal } = {}, directory = false) {
    const captured = context && contexts.get(context);
    if (!captured?.ready || (!directory && !allowed(path)) || !current(captured, signal)) return { ok: false, status: 0, text: '' };
    try {
      const filePath = (directory ? captured.prefix : `${captured.prefix}/${path}`).split('/').map(encodeURIComponent).join('/');
      const url = `https://api.github.com/repos/${encodeURIComponent(captured.owner)}/${encodeURIComponent(captured.repo)}/contents/${filePath}?ref=${encodeURIComponent(captured.branch)}`;
      const response = await fetchImpl(url, { method: 'GET', cache: 'no-store', signal,
        headers: { ...headers(captured.token), Accept: directory ? 'application/vnd.github+json' : 'application/vnd.github.raw+json' } });
      if (!current(captured, signal)) return { ok: false, status: 0, text: '' };
      if (!response.ok) {
        if (response.status === 401) onUnauthorized();
        return { ok: false, status: response.status, text: '' };
      }
      const text = await response.text();
      if (!current(captured, signal)) return { ok: false, status: 0, text: '' };
      onAuthorized();
      return { ok: true, status: response.status, text };
    } catch { return { ok: false, status: 0, text: '' }; }
  }
  return Object.freeze({ captureConnection, invalidate,
    read: (path, options) => request(path, options),
    readDirectory: options => request(null, options, true) });
}
