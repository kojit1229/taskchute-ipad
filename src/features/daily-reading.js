import { buildDailyReading } from "../core/daily-reading.js";
export const READING_LABELS = { affirmation: "アファメーション", visionBoard: "ビジョンボード", feedback: "昨日のAIフィードバック" };
export const dailyReadingOpenOperation = { legacy: true, run: (input, deps) => deps.legacy["daily-reading-open"](input) };
import { nextMutationStamp } from "../core/mutation-stamp.js";
export const dailyReadingRecordOperation = { prepare: input => {
  try {
    if (!input || !Object.hasOwn(READING_LABELS, input.kind) || !Number.isSafeInteger(input.sequence)
        || input.sequence < 1 || typeof input.displayed !== "boolean") throw new TypeError("Invalid reading request");
    for (const date of [input.date, input.referenceDate]) {
      if (typeof date !== "string" || date.length !== 10) throw new TypeError("Invalid reading date");
      nextMutationStamp({ now: date + "T00:00:00" });
    }
    nextMutationStamp({ now: input.recordedAt });
  } catch (error) { throw Object.assign(error, { code: "DAILY_OPERATION_INVALID" }); }
  return input;
}, build: buildDailyReading };

export function buildReadingView(request, result, markdown) {
  if (!result?.ok) throw new Error(result?.status === 404 ? "昨日の結果はまだありません" : [401, 403].includes(result?.status) ? "接続状態を確認してください" : "取得できませんでした／再試行");
  if (!result.text?.trim()) throw new Error("本文がありません");
  return { ...request, html: markdown(result.text) };
}

// A request owns the day, connection and visible container, including image decoding.
export function createDailyReading(deps) {
  let sequence = 0, active = null;
  const previous = new Map(), successes = new Map();
  const current = request => active === request && request.sequence === sequence
    && request.connection === deps.connection() && deps.visible(request);
  function release(request) { request?.urls.splice(0).forEach(url => URL.revokeObjectURL(url)); }
  function close() { sequence++; release(active); active = null; }
  function status(request, text) { if (current(request)) deps.document.querySelector('[data-reading-status]').textContent = text; }
  function record(request) {
    const result = deps.record?.({ ...request, displayed: true });
    status(request, result ? result.ok ? result.message : "保存できませんでした。同じ成功時刻で再試行できます" : "閲覧済み");
    request.saved = Boolean(result?.ok);
    return result;
  }
  async function open(kind) {
    if (!Object.hasOwn(READING_LABELS, kind)) return;
    if (active?.pending && active.kind === kind && current(active)) return active.promise;
    const date = deps.today(), connection = deps.connection();
    const request = { kind, date, referenceDate: kind === "feedback" ? deps.addDays(date, -1) : date,
      connection, sequence: ++sequence, board: deps.board(), pending: true, routineIds: deps.routineIds?.() };
    release(active); request.urls = []; active = request;
    deps.show(request, `<section class="modal-card"><h2>${READING_LABELS[kind]}</h2>
      <button type="button" data-action="modal-close">閉じる</button>
      <p>${request.referenceDate}</p><p role="status" data-reading-status>読み込んでいます</p>
      <article class="md-render" data-reading-body></article>
      <button type="button" data-action="daily-reading-open" data-reading-kind="${kind}">再試行</button></section>`);
    const key = JSON.stringify([connection, kind, request.referenceDate, request.board, request.routineIds]);
    const prior = successes.get(key);
    const body = deps.document.querySelector('[data-reading-body]');
    if (previous.has(key)) { body.innerHTML = previous.get(key); status(request, "読み込んでいます（前回取得分）"); }
    request.promise = (async () => {
      const urls = request.urls;
      try {
        if (!connection) throw new Error("接続状態を確認してください");
        if (kind === "visionBoard") {
          const result = await deps.readRaw("content/vision-pages/manifest.json");
          if (!current(request)) return;
          if (!result.ok) buildReadingView(request, result, deps.markdown);
          const files = JSON.parse(result.text)?.[request.board]?.files;
          if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== "string"
              || !/^[a-z0-9][a-z0-9_.-]*\.(png|jpe?g|webp)$/i.test(file))) throw new Error("画像を表示できませんでした");
          const images = [];
          for (const file of files) {
            if (!current(request)) return;
            const result = await deps.readRaw(`content/vision-pages/${file}`, "blob");
            if (!current(request)) return;
            if (!result.ok || !result.blob?.size) throw new Error("画像を表示できませんでした");
            const img = deps.document.createElement("img"), url = URL.createObjectURL(result.blob);
            urls.push(url); img.src = url; img.alt = READING_LABELS[kind]; img.style.maxWidth = "100%";
            await img.decode().catch(() => { throw new Error("画像を表示できませんでした"); }); images.push(img);
          }
          if (!current(request)) return;
          body.replaceChildren(...images);
          if (!images.every(img => img.isConnected && img.naturalWidth > 0)) throw new Error("画像を表示できませんでした");
        } else {
          const result = kind === "affirmation" ? await deps.readVision("content/Daily_Affirmation.md")
            : await deps.readRaw(`AIフィードバック_${request.referenceDate}.md`);
          if (!current(request)) return;
          const view = buildReadingView(request, result, deps.markdown);
          body.innerHTML = view.html;
          if (!body.isConnected || !body.textContent.trim()) throw new Error("本文を表示できませんでした");
          previous.set(key, view.html);
        }
        if (!current(request)) return;
        if (deps.today() !== request.date) { request.pending = false; return open(kind); }
        request.recordedAt = prior?.recordedAt || deps.now();
        successes.set(key, { recordedAt: request.recordedAt });
        record(request);
        return { displayed: true, request };
      } catch (error) {
        status(request, `${previous.has(key) ? "前回取得分。" : ""}${error.message || "取得できませんでした"}`);
        return { displayed: false };
      } finally { request.pending = false; if (!current(request)) release(request); }
    })();
    return request.promise;
  }
  return { open, close, current: input => Boolean(active && input.sequence === active.sequence && current(active)) };
}
