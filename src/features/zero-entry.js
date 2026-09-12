import { nextMutationStamp, stamped } from "../core/mutation-stamp.js";

const invalid = message => Object.assign(new Error(message), { code: "DAILY_OPERATION_INVALID" });
const fingerprint = value => JSON.stringify(value);
const baseline = draft => fingerprint([draft.body, draft.durationSec, draft.stoppedAt]);
const questionContent = q => fingerprint(Object.fromEntries(Object.entries(q || {})
  .filter(([key]) => !["status", "lastTouchedAt", "updatedAt"].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
export const zeroAnswer = draft => ({ id: draft.id, date: draft.date, theme: draft.theme.text,
  body: draft.body.trim(), questionId: draft.theme.questionId || null, createdAt: draft.createdAt,
  durationSec: draft.durationSec });
export const sameZeroAnswer = (entry, draft) => Object.entries(zeroAnswer(draft)).every(([key, value]) => entry?.[key] === value);

export function createZeroEntryDraft({ theme, id, connection, date, createdAt, startedAt }) {
  return { kind: "zero", id, draftId: id, requestId: id, connection, version: 1,
    theme: { ...theme }, themeId: theme.id, baseFingerprint: fingerprint(theme), date, createdAt,
    startedAt, deadline: startedAt + 60000, stoppedAt: null, durationSec: null, body: "",
    savedBaseline: null, questionRequest: null, completed: false };
}

export function stopZeroEntry(draft, now) {
  if (draft.stoppedAt == null) {
    draft.stoppedAt = now;
    draft.durationSec = Number.isFinite(draft.startedAt) ? Math.max(0, Math.round((now - draft.startedAt) / 1000)) : null;
  }
  return draft;
}

export function zeroNeedsSave(draft, body, entry) {
  if (draft.completed) return body !== (entry?.body || "");
  return baseline({ ...draft, body }) !== draft.savedBaseline
    || Boolean(draft.questionRequest && !draft.questionRequest.done);
}

function validate(draft, deps) {
  if (!draft || draft.kind !== "zero" || !draft.id || draft.id !== draft.draftId
      || draft.requestId !== draft.id || !deps.zeroDrafts || deps.isZeroOwner?.(draft) !== true)
    throw invalid("対象または接続先が変わりました。入力は残しています");
}

function prepare(mode, input, deps) {
  const draft = input.draft;
  validate(draft, deps);
  if (typeof input.body !== "string") throw invalid("本文を確認してください");
  draft.body = input.body;
  if (mode !== "draft" || input.stop) stopZeroEntry(draft, deps.nowMs());
  if (mode === "complete" && !draft.body.trim()) throw invalid("空のままでは保存できません");
  if (!draft.questionRequest && draft.body.trim() && draft.theme.questionId) {
    const q = deps.state.questions?.find(q => q.id === draft.theme.questionId && !q.deleted);
    if (!q) throw invalid("問いが変わりました。確認してください");
    const date = deps.today();
    draft.questionRequest = { id: q.id, date, before: { ...q },
      planned: { ...q, lastTouchedAt: date, status: q.status === "open" ? "deepening" : q.status }, done: false };
  }
  const nextBaseline = baseline(draft);
  const saved = deps.zeroDrafts.put({ ...draft, savedBaseline: nextBaseline });
  if (saved.ok) draft.savedBaseline = nextBaseline;
  if (!saved.ok && mode !== "complete") throw invalid("この画面内にだけ残っています。下書き保存を再試行してください");
  return { ...input, mode, draft, tabSaved: saved.ok };
}

function questionRecords(state, draft) {
  const request = draft.questionRequest;
  if (!request) return [];
  const current = state.questions?.find(q => q.id === request.id && !q.deleted);
  if (!current || questionContent(current) !== questionContent(request.before))
    throw invalid("問いが変更・削除されています。確認してください");
  if (fingerprint(current) === fingerprint(request.before)) {
    if (request.done) throw invalid("問いが保存済みの基準から変わりました");
    return [{ kind: "questions", before: current, after: request.planned }];
  }
  if (current.lastTouchedAt >= request.date && (current.status === request.planned.status
      || current.updatedAt > (request.before.updatedAt || request.before.createdAt || ""))) return [];
  throw invalid("問い更新待ちです。変更を確認してください");
}

function build(state, input, deps) {
  const { draft, mode } = input;
  validate(draft, deps);
  const existing = state.zeroThinking?.entries?.find(entry => entry.id === draft.id);
  if (existing) {
    if (!sameZeroAnswer(existing, draft)) throw invalid("完成済み回答が変わりました。確認してください");
    return { records: [], completed: true };
  }
  const records = questionRecords(state, draft);
  if (mode !== "complete") return { records };
  const theme = state.zeroThinking?.themes?.find(theme => theme.id === draft.themeId);
  if (!theme || fingerprint(theme) !== draft.baseFingerprint) throw invalid("テーマが変わりました。確認してください");
  const stamp = nextMutationStamp({ now: deps.now(), candidates: [draft.createdAt] });
  const entry = stamped(zeroAnswer(draft), stamp);
  return { records, completed: true, candidates: [stamp], values: [
    { kind: "zeroThinking", key: "entries", before: state.zeroThinking.entries, after: [...state.zeroThinking.entries, entry] },
    { kind: "zeroThinking", key: "themes", before: state.zeroThinking.themes,
      after: theme.fav ? state.zeroThinking.themes : state.zeroThinking.themes.filter(row => row.id !== theme.id) }
  ] };
}

export function zeroEntryOperation(mode) {
  return { prepare: (input, deps) => prepare(mode, input, deps), build,
    effects(result, input, deps) {
      const draft = input.draft;
      if (draft.questionRequest) draft.questionRequest.done = true;
      if (result.completed) draft.completed = true;
      result.draftStored = deps.zeroDrafts.put(draft);
      deps.zeroEffect?.(result, input);
    } };
}
