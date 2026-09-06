// Only synchronous, audited editor saves may enter this boundary. Never await in work.
export function createDraftSaveTransaction({ getState, setState, persist, schedule, onFailure, onEffectError = () => {} }) {
  let current = null;
  function fail(error) {
    try { onFailure(error); } catch { /* Error reporting cannot prevent state restoration. */ }
  }
  function runEffect(effect) {
    try { effect(); } catch (error) {
      try { onEffectError(error); } catch { /* Persistence already succeeded; keep finishing the other effects. */ }
    }
  }
  const api = {
    get active() { return Boolean(current); },
    defer(effect, { post = false } = {}) {
      if (!current) return false;
      (post ? current.post : current.ui).push(effect);
      return true;
    },
    complete(effect) {
      if (!current) return false;
      current.ready = true;
      if (effect) current.ui.push(effect);
      return true;
    },
    run(work, { deferPost = false } = {}) {
      if (current) throw new Error("Nested editor save is not supported");
      const before = getState();
      const transaction = { ready: false, ui: [], post: [] };
      let committed = false;
      try {
        setState(JSON.parse(JSON.stringify(before)));
        current = transaction;
        const value = work();
        if (value?.then) throw new Error("Editor save must remain synchronous");
        if (!transaction.ready) return { ok: false, reason: "invalid" };
        if (!persist()) { fail(); return { ok: false, reason: "storage-failed" }; }
        committed = true;
      } catch (error) {
        fail(error);
        return { ok: false, reason: "exception" };
      } finally {
        current = null;
        if (!committed) setState(before);
      }
      runEffect(schedule);
      transaction.ui.forEach(runEffect);
      let postPending = true;
      const afterLeave = () => {
        if (!postPending) return;
        postPending = false;
        transaction.post.forEach(runEffect);
      };
      if (!deferPost) afterLeave();
      return { ok: true, afterLeave };
    }
  };
  return api;
}
