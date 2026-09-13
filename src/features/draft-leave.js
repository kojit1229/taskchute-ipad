// A transient leave decision: no persisted state, no per-element listeners.
export function createDraftLeaveGuard(document, { drafts, readDraft, isComposing = () => false, notify = () => {} } = {}) {
  let pending = null;
  let dialog = null;
  let origin = null;
  let lastEditor = null;
  function owns(action) {
    try {
      const result = typeof action?.isCurrentOwner === "function" && action.isCurrentOwner();
      if (result && typeof result.then === "function") { Promise.resolve(result).catch(() => {}); return false; }
      return result === true && (!action.draft || drafts.matches(action.draft, readDraft(action.inputSelector)));
    }
    catch { return false; }
  }
  const editorSelector = '[data-modal-field], [data-twy-ms-label], [data-twy-ms-date], #zt-write-input, #zt-edit-input';
  const checkedEditors = new WeakSet();
  document.addEventListener?.("focusin", event => {
    if (event.target.matches?.(editorSelector)) lastEditor = event.target;
    const root = event.target.closest?.("#modalRoot")?.firstElementChild
      || (event.target.id === "zt-edit-input" ? event.target : null);
    if (!root || checkedEditors.has(root) || isComposing()) return;
    checkedEditors.add(root);
    const owner = readDraft?.();
    const elements = root.matches?.("#zt-edit-input") ? [root]
      : Array.from(root.querySelectorAll(editorSelector));
    drafts?.recover?.(owner, saved => {
      if (!Array.isArray(saved.inputs) || saved.inputs.length !== elements.length) return false;
      if (!saved.inputs.every((input, index) => input.field === (elements[index].dataset.modalField || elements[index].id || "")
        && typeof input.value === "string" && (input.checked == null || typeof input.checked === "boolean")
        && (input.start == null || Number.isInteger(input.start)) && (input.end == null || Number.isInteger(input.end)))) return false;
      saved.inputs.forEach((input, index) => {
        const element = elements[index];
        element.value = input.value;
        if (element.type === "checkbox") element.checked = input.checked === true;
        if (input.start != null && input.end != null && ["text", "search", "tel", "url", "password", "textarea"].includes(element.type))
          element.setSelectionRange(input.start, input.end, input.direction);
      });
      notify("再読込前の下書きを復元しました。内容を確認して保存してください");
      return true;
    });
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
    request({ save, leave, isCurrentOwner, allowDiscard = true, inputSelector }) {
      if (pending) return;
      const draft = readDraft?.(inputSelector);
      if (draft && !drafts.put(draft).ok) notify("控えを保存できません。この画面内にだけ残っています。再読込せず、必要なら文字をコピーしてください");
      if (draft?.current === false) { notify("接続先または対象が変わりました。入力の控えは残しています"); return; }
      if (isComposing()) { notify("文字の変換を確定してから操作してください。入力は残しています"); return; }
      pending = { save, leave, isCurrentOwner, allowDiscard, draft, inputSelector };
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
      if (!owns(pending)) { notify("接続先または対象が変わったため操作を中止しました。入力の控えは残しています"); dismiss(false); return; }
      if (isComposing()) { notify("文字の変換を確定してから操作してください"); dismiss(true); return; }
      if (choice === "stay") { dismiss(true); return; }
      const action = pending;
      const savedFocus = origin;
      // Close before saving, so a validation error can focus the original form.
      dismiss(false);
      const result = choice === "save" ? action.save() : true;
      if (result !== true && !result?.ok) { if (owns(action)) restoreFocus(savedFocus); return; }
      if (action.draft) drafts.clear(action.draft, choice === "save" ? "saved" : "discard");
      try { action.leave(); } finally { result?.afterLeave?.(); }
    }
  };
}
