let getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin, updateBlockField, render;
let visibilityBound = false;
let declarationStartId = null;
const declarationDrafts = new Map();
if (typeof document !== "undefined") document.addEventListener("input", event => {
  if (event.target?.matches('[data-field="now-declaration"]')) declarationDrafts.set(event.target.dataset.id, event.target.value);
});

export function configureNowView(deps) {
  ({ getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin, updateBlockField, render } = deps);
  if (!visibilityBound && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const root = document.querySelector(".now-view");
      if (root) root.dataset.paused = document.hidden ? "1" : "0";
      if (!document.hidden) updateNowViewTick();
    });
    visibilityBound = true;
  }
}

function hasDateTime(value) {
  const match = typeof value === "string" && value.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return Boolean(match && +match[1] >= 1 && +match[1] <= 12 && +match[2] >= 1 && +match[2] <= 31
    && +match[3] <= 23 && +match[4] <= 59);
}

function clearStartedDrafts() {
  for (const block of getState().blocks) {
    if (block.actualStartAt) declarationDrafts.delete(String(block.id));
  }
}

// モーダル生成後に初期値を渡す。重複開始の確認を挟んだ場合も同じ経路で渡す。
export function withNowDeclaration(action, startId) {
  if (getState().currentView !== "now") return action();
  if (startId !== undefined) declarationStartId = String(startId);
  if (declarationStartId === null) return action();
  const result = action();
  clearStartedDrafts();
  const modal = getState().modal, input = document.querySelector('[data-declare-note]');
  const id = String(modal?.id);
  if (modal?.type === "declare" && id === declarationStartId && input && declarationDrafts.has(id) && input.dataset.nowDraftId !== id) {
    input.value = declarationDrafts.get(id);
    input.dataset.nowDraftId = id;
  }
  if (getState().blocks.some(b => String(b.id) === declarationStartId && b.actualStartAt)) declarationStartId = null;
  return result;
}

export function setNowEstimate(id, minutes) {
  const block = getState().blocks.find(b => String(b.id) === id && !b.deleted);
  if (!block || block.completed || block.actualStartAt || block.actualEndAt || ![15, 25, 50].includes(minutes)) return;
  if (updateBlockField(block.id, "estimateMin", minutes)) render();
}

function candidateHTML(block) {
  const id = escapeHTML(block.id), estimate = resolveEstimateMin(block);
  return `<article class="now-candidate">
    <div class="now-candidates"><button type="button" data-action="now-start" data-id="${id}"><strong>${block.isMIT ? "★ " : ""}${escapeHTML(block.title)}</strong><small>${escapeHTML(timeFromDateTime(block.plannedStartAt) || "時刻未定")} · 見積 ${escapeHTML(estimate)}分</small></button></div>
    <input type="text" data-field="now-declaration" data-id="${id}" aria-label="${escapeHTML(block.title)}の宣言(任意)" placeholder="宣言(任意)" value="${escapeHTML(declarationDrafts.get(String(block.id)) || "")}">
    <div class="now-estimates" role="group" aria-label="見積">${[15, 25, 50].map(minutes => `<span><button type="button" data-action="now-estimate" data-id="${id}" data-minutes="${minutes}" aria-pressed="${estimate === minutes}">${minutes}分</button></span>`).join("")}</div>
  </article>`;
}

function elapsedText(block) {
  if (!hasDateTime(block.actualStartAt)) return "--:--";
  const seconds = Math.max(0, Math.floor((Date.now() - localDateTimeToMs(block.actualStartAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function recordTimeText(block) {
  if (!hasDateTime(block.actualStartAt)) return "時刻不明";
  if (!block.actualEndAt && block.completed) return `${timeFromDateTime(block.actualStartAt)}〜`;
  if (!hasDateTime(block.actualEndAt)) return "時刻不明";
  const start = localDateTimeToMs(block.actualStartAt);
  const end = new Date(Math.max(start + 60000, localDateTimeToMs(block.actualEndAt)));
  const pad = n => String(n).padStart(2, "0");
  const endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${timeFromDateTime(block.actualStartAt)}〜${endDate !== block.actualStartAt.slice(0, 10) ? endDate + " " : ""}${endTime}`;
}

function recordHTML(block) {
  return `<article class="now-record" data-record-id="${escapeHTML(block.id)}">
    <strong>${escapeHTML(block.title)}</strong><p><time>${escapeHTML(recordTimeText(block))}</time></p>
    <p class="now-comment">${escapeHTML(block.comment || "")}</p></article>`;
}

export function renderNowView() {
  clearStartedDrafts();
  const state = getState(), today = todayISO(), blocks = blocksForDate(today);
  const pending = blocks.filter(b => !b.completed && !b.actualStartAt && !b.actualEndAt)
    .sort((a, b) => String(a.plannedStartAt || "~").localeCompare(String(b.plannedStartAt || "~")) || (a.orderIndex || 0) - (b.orderIndex || 0));
  const running = state.blocks.filter(b => !b.deleted && b.actualStartAt && !b.actualEndAt && !b.completed);
  const records = blocks.filter(b => b.completed || (b.actualStartAt && b.actualEndAt));
  const history = state.blocks.filter(b => !b.deleted && b.date < today && (b.completed || (b.actualStartAt && b.actualEndAt)))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.actualStartAt || "").localeCompare(String(a.actualStartAt || "")));
  return `<div class="now-view" data-motion="${escapeHTML(state.settings.towerMotion || "normal")}" data-paused="${document.hidden ? "1" : "0"}">
    <section class="now-start"><h2>開始</h2><div class="now-candidate-list">${pending.map(candidateHTML).join("")}</div>
      ${!blocks.length ? '<p>今日やることはまだ決まっていません。</p><button type="button" data-action="nav" data-view="dandori">段取りで決める</button>' : !pending.length ? '<p>未着手の Block はありません。</p>' : ""}</section>
    <section class="now-current"><h2>いま</h2>${running.map(b => `<article class="now-running" data-running-id="${escapeHTML(b.id)}"><div class="now-elapsed" data-elapsed-id="${escapeHTML(b.id)}">${elapsedText(b)}</div><small>経過</small><h3>${b.isMIT ? "★ " : ""}${escapeHTML(b.title)}</h3><button type="button" data-action="now-end" data-id="${escapeHTML(b.id)}">終了報告</button></article>`).join("") || '<p>実行中の Block はありません。開始するカードを選んでください。</p>'}</section>
    <section class="now-done"><h2>今日できた</h2>${records.map(recordHTML).join("") || '<p>終えたことが、ここに残ります。</p>'}
      ${history.length ? `<details><summary>これまでの履歴</summary>${history.slice(0, 30).map(b => `<div><small>${escapeHTML(b.date)}</small>${recordHTML(b)}</div>`).join("")}${history.length > 30 ? '<p>ほかの記録は実行タブの実績で見られます</p>' : ""}</details>` : ""}</section>
    <section class="now-stack"><h2>積み上げ</h2><div class="now-tower-frame" aria-label="タワーの枠"><span>今日の本</span></div><div class="now-ring-frame" aria-label="輪の枠"></div></section>
    <section class="now-next"><h2>これから</h2>${pending.map(b => `<p>${escapeHTML(timeFromDateTime(b.plannedStartAt))} ${escapeHTML(b.title)}</p>`).join("") || '<p>ひと息ついて、次のことへ。</p>'}</section>
  </div>`;
}

export function updateNowViewTick() {
  if (document.hidden) return;
  const root = document.querySelector(".now-view");
  if (!root) return;
  root.querySelectorAll("[data-elapsed-id]").forEach(container => {
    if (container.contains(document.activeElement)) return;
    const block = getState().blocks.find(b => String(b.id) === container.dataset.elapsedId);
    if (hasDateTime(block?.actualStartAt) && !block.actualEndAt) container.textContent = elapsedText(block);
  });
}
