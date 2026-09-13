// Reuse the editor transaction for legacy recurrence writers and their effects.
export function buildRecurrenceDraft(input, deps) {
  const value = input.work();
  deps.transaction.complete();
  return value;
}

export const recurrenceSaveOperation = {
  legacy: true,
  build: buildRecurrenceDraft,
  run(input, deps) {
    if (deps.transaction.active) return input.work();
    let value;
    const result = deps.transaction.run(() => { value = buildRecurrenceDraft(input, deps); },
      { kinds: ["recurrences", "blocks", "chainRuns", "habitPinHistory"] });
    return result.ok ? value : false;
  }
};
