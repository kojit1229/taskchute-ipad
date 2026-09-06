// Vision-only read transport. Connection edits must call invalidate, including A -> B -> A.
export function createVisionRead({ connection, key, path, headers, setAuthError, clearAuthError, fetcher = fetch, timeoutMs = 30000 }) {
  let generation = 0;
  const pending = new Set();
  function invalidate() {
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear();
  }
  async function read(name, kind = "text") {
    const ticket = generation, startedKey = key(), cfg = connection();
    const failed = status => ({ ok: false, status, text: "", blob: null });
    if (!startedKey || !cfg) return failed(0);
    if (!/^content\/(?:Vision\.md|Daily_Affirmation\.md|vision-overview\.json|vision-overview\/[a-z0-9][a-z0-9_-]*\.(?:png|jpe?g|webp))$/i.test(name)) return failed(0);
    const controller = new AbortController(); pending.add(controller);
    const current = () => ticket === generation && key() === startedKey && !controller.signal.aborted;
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(failed(0)); }, timeoutMs); });
    try {
      return await Promise.race([deadline, (async () => {
        const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path(name).split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(cfg.branch || "main")}`;
        const response = await fetcher(url, { headers: { ...headers(cfg.token), Accept: "application/vnd.github.raw+json" }, signal: controller.signal });
        if (!current()) return failed(0);
        if (response.status === 401) { setAuthError("個人データに接続できません。設定を確認してください"); return failed(401); }
        if (!response.ok) return failed(response.status);
        const value = kind === "blob" ? await response.blob() : await response.text();
        if (!current()) return failed(0);
        clearAuthError();
        return { ok: true, status: response.status, text: kind === "blob" ? "" : value, blob: kind === "blob" ? value : null };
      })()]);
    } catch { return failed(0); }
    finally { clearTimeout(timer); pending.delete(controller); }
  }
  return { read, invalidate };
}
