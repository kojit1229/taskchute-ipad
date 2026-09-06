// A transient leave decision: no persisted state, no per-element listeners.
export function createDraftLeaveGuard(document) {
  let pending = null;
  let dialog = null;
  let origin = null;
  let lastEditor = null;
  function owns(action) {
    try {
      const result = typeof action?.isCurrentOwner === "function" && action.isCurrentOwner();
      if (result && typeof result.then === "function") { Promise.resolve(result).catch(() => {}); return false; }
      return result === true;
    }
    catch { return false; }
  }
  const editorSelector = '[data-modal-field], [data-twy-ms-label], [data-twy-ms-date], #zt-write-input, #zt-edit-input';
  document.addEventListener?.("focusin", event => {
    if (event.target.matches?.(editorSelector)) lastEditor = event.target;
  });
  function restoreFocus(saved) {
    if (!saved?.element?.isConnected) return;
    saved.element.focus({ preventScroll: true });
    if (saved.start != null && saved.element.setSelectionRange) {
      saved.element.setSelectionRange(saved.start, saved.end, saved.direction);
    }
  }
  function dismiss(shouldRestoreFocus) {
    // Removing the dialog avoids native close() restoring a stale editor.
    // Restore focus explicitly only when the captured editor still owns the action.
    dialog?.remove();
    dialog = null;
    pending = null;
    if (shouldRestoreFocus) restoreFocus(origin);
    origin = null;
  }
  document.addEventListener?.("cancel", event => {
    if (event.target !== dialog || !pending) return;
    event.preventDefault();
    dismiss(owns(pending));
  }, true);
  return {
    get active() { return Boolean(pending); },
    request({ save, leave, isCurrentOwner, allowDiscard = true }) {
      if (pending) return;
      pending = { save, leave, isCurrentOwner, allowDiscard };
      const element = lastEditor?.isConnected ? lastEditor : document.activeElement;
      origin = { element, start: element?.selectionStart, end: element?.selectionEnd, direction: element?.selectionDirection };
      dialog = document.createElement("dialog");
      dialog.className = "draft-leave-dialog";
      dialog.setAttribute("aria-labelledby", "draft-leave-title");
      dialog.innerHTML = `<h2 id="draft-leave-title">書きかけの内容があります</h2>
        <p>入力を保存してから${allowDiscard ? "移動" : "操作を続行"}しますか？</p>
        <div class="draft-leave-actions">
          <button class="btn primary" data-action="draft-leave-save">保存して${allowDiscard ? "移動" : "続行"}</button>
          <button class="btn" data-action="draft-leave-stay" autofocus>編集を続ける</button>
          ${allowDiscard ? '<button class="btn" data-action="draft-leave-discard">破棄して移動</button>' : ""}
        </div>`;
      document.body.append(dialog);
      dialog.showModal();
    },
    resolve(choice) {
      if (!pending) return;
      if (!["save", "stay", "discard"].includes(choice)) return;
      if (choice === "discard" && !pending.allowDiscard) return;
      if (!owns(pending)) { dismiss(false); return; }
      if (choice === "stay") { dismiss(true); return; }
      const action = pending;
      const savedFocus = origin;
      // Close before saving, so a validation error can focus the original form.
      dismiss(false);
      const result = choice === "save" ? action.save() : true;
      if (result !== true && !result?.ok) { if (owns(action)) restoreFocus(savedFocus); return; }
      try { action.leave(); } finally { result?.afterLeave?.(); }
    }
  };
}
