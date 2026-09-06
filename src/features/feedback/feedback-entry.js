// No automatic IME commit: the user finishes composition before a new attempt.
export function createFeedbackEntry({ isComposing, captureOwner, isOwner, requestLeave, reflectInput, run,
  onResult, onError, onSettled = () => {} } = {}) {
  if ([isComposing,captureOwner,isOwner,requestLeave,reflectInput,run,onResult,onError].some(fn => typeof fn !== 'function')) throw Error('entry_configuration_required');
  return (lifecycle = {}) => {
    const current = () => lifecycle.isCurrent?.() !== false;
    const settled = () => (lifecycle.onSettled || onSettled)();
    let owner, continued = false;
    const fail = error => { try { if (current() && (!owner || isOwner(owner))) onError(error); } finally { settled(); } };
    try {
      if (isComposing()) { fail(Error('finish_composition_first')); return false; }
      owner = captureOwner();
      const leave = () => {
        if (continued) return;
        continued = true;
        try {
          if (!current() || isComposing() || !isOwner(owner)) { settled(); return; }
          if (lifecycle.onRunning?.() === false) { settled(); return; }
          reflectInput(owner);
          Promise.resolve(run(owner.date, () => current() && !isComposing() && isOwner(owner))).then(
            result => { try { if (current() && isOwner(owner)) onResult(result); } finally { settled(); } },
            fail
          );
        } catch (error) { fail(error); }
      };
      if (!requestLeave(leave, { allowDiscard: false })) leave();
      else if (!continued) lifecycle.onDeferred?.();
      return true;
    } catch (error) { fail(error); return false; }
  };
}

// Protected legacy reads may not accept AbortSignal. Expiry makes every later write guard false.
export function boundProtectedSync(sync, { timeoutMs = 30000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof sync !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('sync_deadline_configuration_required');
  return async proof => {
    let active = true, timer;
    const controller = new AbortController();
    const isCurrent = () => active && proof.isCurrent() === true;
    const expired = new Promise((_, reject) => { timer = setTimer(() => { active = false; controller.abort(); reject(Error('protected_sync_timeout')); }, timeoutMs); });
    try { return await Promise.race([Promise.resolve().then(() => sync({ ...proof, isCurrent, signal: controller.signal })), expired]); }
    finally { active = false; clearTimer(timer); }
  };
}
