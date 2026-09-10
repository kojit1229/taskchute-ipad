const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });

function desiredCompletion(input) {
  if (input.desiredCompleted === true || input.desiredCompleted === "true") return true;
  if (input.desiredCompleted === false || input.desiredCompleted === "false") return false;
  throw invalid("希望する完了状態を確認してください");
}

export function buildPlanCompletion(state, input) {
  const block = state.blocks?.find(row => row.id === input.id && !row.deleted);
  if (!block || !["block", "schedule"].includes(input.kind)) throw invalid("完了する予定を確認してください");
  const completed = desiredCompletion(input);
  if (Boolean(block.completed) === completed) return { records: [], block };
  if (completed && block.actualStartAt && !block.actualEndAt)
    return { records: [], block, confirmEnd: true };
  return { records: [{ kind: "blocks", before: block, after: { ...block, completed } }],
    block: { ...block, completed } };
}
