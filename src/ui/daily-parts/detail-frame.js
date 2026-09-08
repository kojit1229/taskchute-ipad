const fieldTypes = ["text", "textarea", "date", "time", "datetime-local", "number", "select", "checkbox"];
const text = value => typeof value === "string";
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
// Reject accessors/functions before reading the model; saved data is never executable markup.
function plainData(value, depth = 0) {
  if (depth > 24) return false;
  if (value === null || text(value) || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || (!Array.isArray(value)
    && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && !/^(?:__proto__|prototype|constructor|html|innerhtml|outerhtml|srcdoc)$/i.test(key)
      && Object.hasOwn(descriptor, "value") && plainData(descriptor.value, depth + 1);
  });
}
function validate(model, slots) {
  if (!plainData(model) || !model || !["block", "schedule", "actual", "task", "project"].includes(model.kind)
    || !text(model.id) || !model.id.trim() || !["title", "dateLabel", "saveLabel"].every(key => text(model[key]))
    || !["draftId", "origin"].every(key => model[key] === null || text(model[key]))
    || !["dirty", "busy", "canDelete"].every(key => typeof model[key] === "boolean")
    || !Array.isArray(model.errors) || !model.errors.every(text) || !Array.isArray(model.sections))
    throw new TypeError("Invalid daily detail frame");
  const keys = new Set();
  for (const section of model.sections) {
    if (!section || !text(section.title) || !Array.isArray(section.fields)
      || (section.slot !== undefined && (!text(section.slot) || !slots
        || typeof Object.getOwnPropertyDescriptor(slots, section.slot)?.value !== "function")))
      throw new TypeError("Invalid daily detail section or slot");
    for (const field of section.fields) {
      if (!field || !text(field.key) || !field.key.trim() || keys.has(field.key) || !text(field.label)
        || !fieldTypes.includes(field.type) || !["required", "readonly"].every(key => typeof field[key] === "boolean")
        || !["help", "error"].every(key => text(field[key]))
        || (field.type === "checkbox" ? typeof field.value !== "boolean"
          : !(text(field.value) || (field.type === "number" && typeof field.value === "number")))
        || (field.type === "select" && (!Array.isArray(field.options)
          || !field.options.every(option => Array.isArray(option) && option.length === 2 && option.every(text)))))
        throw new TypeError("Invalid daily detail field");
      keys.add(field.key);
    }
  }
}
// slots: own named functions supplied by trusted UI code, each receiving only escapeHTML.
// They must be pure safe renderers, never callbacks or HTML loaded from saved state.
export function renderDetailFrame(model, { slots = {}, className = "" } = {}) {
  validate(model, slots);
  const e = escapeHTML;
  const fieldHTML = field => {
    const locked = model.busy || field.readonly;
    const attrs = `data-modal-field="${e(field.key)}"${field.required ? " required" : ""}${field.error ? ' aria-invalid="true"' : ""}`;
    const disabled = locked ? " disabled" : "";
    let control;
    if (field.type === "select") control = `<select ${attrs}${disabled}>${field.options.map(([value, label]) => `<option value="${e(value)}"${value === field.value ? " selected" : ""}>${e(label)}</option>`).join("")}</select>`;
    else if (field.type === "textarea") control = `<textarea ${attrs}${locked ? " readonly" : ""}>${e(field.value)}</textarea>`;
    else if (field.type === "checkbox") control = `<input type="checkbox" ${attrs}${disabled}${field.value ? " checked" : ""}>`;
    else control = `<input type="${field.type}" ${attrs} value="${e(field.value)}"${locked ? " readonly" : ""}${["time", "datetime-local"].includes(field.type) ? ' step="300"' : ""}>`;
    return `<label class="daily-detail-field"><span>${e(field.label)}</span>${control}${field.help ? `<small>${e(field.help)}</small>` : ""}${field.error ? `<span class="daily-detail-error" role="alert">${e(field.error)}</span>` : ""}</label>`;
  };
  const button = (action, label, disabled = model.busy) => `<button type="button" class="btn${action === "modal-save" ? " primary" : action === "modal-delete" ? " danger" : ""}" data-action="${action}" data-kind="${e(model.kind)}" data-id="${e(model.id)}" data-draft-id="${e(model.draftId)}"${disabled ? " disabled" : ""}>${e(label)}</button>`;
  return `<div class="modal-card daily-detail-frame${className ? ` ${e(className)}` : ""}" role="dialog" aria-modal="true" aria-label="${e(model.title)}" aria-busy="${model.busy}" data-kind="${e(model.kind)}" data-id="${e(model.id)}" data-draft-id="${e(model.draftId)}" data-origin="${e(model.origin)}" data-dirty="${model.dirty}">
    <header><h2 class="modal-title">${e(model.title)}</h2><p>${e(model.dateLabel)}</p><p role="status">${model.busy ? "保存中…" : model.dirty ? "未保存の変更があります" : ""}</p></header>
    ${model.errors.map(error => `<p class="daily-detail-error" role="alert">${e(error)}</p>`).join("")}
    <fieldset class="daily-detail-body"${model.busy ? " disabled" : ""}>${model.sections.map(section => {
      const slot = section.slot === undefined ? "" : Object.getOwnPropertyDescriptor(slots, section.slot).value(e);
      if (!text(slot)) throw new TypeError("Invalid daily detail slot output");
      return `<section><h3>${e(section.title)}</h3>${section.fields.map(fieldHTML).join("")}${slot}</section>`;
    }).join("")}</fieldset>
    <footer class="daily-detail-actions modal-footer">${button("modal-save", model.saveLabel)}${button("modal-close", "取消")}${model.canDelete ? button("modal-delete", "削除") : ""}</footer>
  </div>`;
}
