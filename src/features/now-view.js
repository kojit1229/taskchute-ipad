import { weekTowers, towerScale, ringState, beatYesterday } from "../core/tower-week.js";

let getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin;
let beatenShownFor = null;
const towerDays = ["月", "火", "水", "木", "金", "土", "日"];
let visibilityBound = false;
let declarationStartId = null;
let fetchMorningStatus, morningStatus = null, morningKey = '', morningLoaded = false, morningCheckedAt = 0, morningPending = false;
const declarationDrafts = new Map();
if (typeof document !== "undefined") document.addEventListener("input", event => {
  if (event.target?.matches('[data-field="now-declaration"]')) declarationDrafts.set(event.target.dataset.id, event.target.value);
});

export function configureNowView(deps) {
  ({ getState, escapeHTML, todayISO, blocksForDate, localDateTimeToMs, timeFromDateTime, resolveEstimateMin } = deps);
  fetchMorningStatus = deps.fetchMorningStatus;
  if (!visibilityBound && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const root = document.querySelector(".now-view");
      if (root) root.dataset.paused = document.hidden ? "1" : "0";
      if (!document.hidden) updateNowViewTick();
    });
    visibilityBound = true;
  }
}

function morningTime(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return '--:--';
  if (!m[6]) return `${m[4]}:${m[5]}`;
  const offset = m[6] === 'Z' ? 0 : (m[6][0] === '-' ? -1 : 1) * (+m[6].slice(1, 3) * 60 + +m[6].slice(4));
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + (540 - offset) * 60000).toISOString().slice(11, 16);
}

function morningBarHTML() {
  const today = todayISO(), status = morningStatus;
  if (!status || status.date !== today) return '';
  const blocks = blocksForDate(today).filter(b => !b.deleted && !b.migratedTo);
  const ai = blocks.filter(b => b.aiPlan?.source === 'morning'), failed = status.status === 'error';
  const skipped = Array.isArray(status.skipped) ? status.skipped : [];
  if (!failed && !ai.length && !skipped.length) return '';
  const remaining = blocks.filter(b => !b.completed && !b.actualStartAt && !isRoutineBlock(b) && !String(b.id).startsWith('rec_'))
    .reduce((sum, b) => sum + Math.max(0, Number(resolveEstimateMin(b)) || 0), 0);
  const endAt = blocks.map(b => timeFromDateTime(b.actualEndAt || b.plannedEndAt)).filter(Boolean).sort().at(-1) || '--:--';
  const builtAt = ai.map(b => b.aiPlan.builtAt).filter(Boolean).sort().at(-1) || status.builtAt;
  const reasons = (label, items) => `<details style="margin-top:6px"><summary>${label}</summary><ul>${items.map(text => `<li>${escapeHTML(text)}</li>`).join('')}</ul></details>`;
  return `<section class="ai-bar${failed ? ' fail' : ''}" data-testid="ai-morning-bar" data-status="${failed ? 'error' : 'ok'}" style="box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere;border:1px solid ${failed ? '#c43c45' : '#8872c4'};background:${failed ? '#fff0f1' : '#f2edff'};color:#342e43;border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:13px">
    ${failed ? `<b>✦ AI が今朝は組めませんでした</b><div>理由: ${escapeHTML(status.reason || '不明')} ・ 既存の予定はそのまま</div><div>次の実行 ${escapeHTML(status.nextRunAt || '--:--')}</div>`
      : ai.length ? `<b>✦ AI が組みました ・ ${morningTime(builtAt)}</b><div>AI が置いたもの ${ai.length} 件 ・ 残り ${remaining} 分(ルーティン除く)・ 終わる見込み ${escapeHTML(endAt)}</div>${reasons('なぜこう組んだか', ai.map(b => b.aiPlan.reason || ''))}` : ''}
    ${skipped.length ? reasons(`AI が今日は置かなかったもの(${skipped.length} 件)`, skipped.map(item => `${item.title || ''} ・ ${item.reason || ''}`)) : ''}
  </section>`;
}

export function renderAiMorningBar() {
  const cfg = getState().settings.github || {};
  const key = JSON.stringify([todayISO(), cfg.dataOwner, cfg.dataRepo, cfg.branch, cfg.token]);
  if (key !== morningKey) {
    morningKey = key; morningStatus = null; morningLoaded = false; morningCheckedAt = 0; morningPending = false;
  }
  if (fetchMorningStatus && !morningPending && (!morningLoaded || Date.now() - morningCheckedAt >= 60000)) {
    morningPending = true;
    void (async () => {
      let status = null;
      try {
        const result = await fetchMorningStatus('ai-morning-status.json', 'text', { cache: 'no-store' });
        if (result.ok) status = JSON.parse(result.text);
      } catch { /* Missing, malformed or unavailable status is display-only. */ }
      if (key !== morningKey) return;
      morningStatus = status; morningPending = false; morningLoaded = true; morningCheckedAt = Date.now();
      const host = document.querySelector('[data-testid="ai-morning-host"]');
      if (host && getState().currentView === 'today') {
        host.innerHTML = morningBarHTML(); host.dataset.loaded = 'true';
      }
    })();
  }
  return `<div data-testid="ai-morning-host" data-loaded="${morningLoaded}" style="min-width:0;max-width:100%">${morningBarHTML()}</div>`;
}

function hasDateTime(value) {
  const match = typeof value === "string" && value.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return Boolean(match && +match[1] >= 1 && +match[1] <= 12 && +match[2] >= 1 && +match[2] <= 31
    && +match[3] <= 23 && +match[4] <= 59);
}

function clearStartedDrafts() {
  for (const block of getState().blocks) {
    if (!block.actualStartAt) continue;
    const id = String(block.id);
    declarationDrafts.delete(id);
    if (declarationStartId === id) declarationStartId = null;
  }
}

// now-start によるモーダル生成後に初期値を渡す。
export function withNowDeclaration(action, startId) {
  const { currentView, settings } = getState();
  if (currentView !== "now" && !(currentView === "today" && settings.todaySkin === "now")) return action();
  if (startId !== undefined) declarationStartId = String(startId);
  if (declarationStartId === null) return action();
  const result = action();
  const modal = getState().modal, input = document.querySelector('[data-declare-note]');
  const id = String(modal?.id);
  if (modal?.type === "declare" && id === declarationStartId && input && declarationDrafts.has(id) && input.dataset.nowDraftId !== id) {
    input.value = declarationDrafts.get(id);
    input.dataset.nowDraftId = id;
  }
  return result;
}

function candidateHTML(block) {
  const id = escapeHTML(block.id), estimate = resolveEstimateMin(block);
  return `<article class="now-candidate">
    <div class="now-candidates"><button type="button" data-action="${isRoutineBlock(block) ? "now-routine-complete" : "now-start"}" data-id="${id}"><strong>${block.isMIT ? "★ " : ""}${escapeHTML(block.title)}</strong><small>${escapeHTML(timeFromDateTime(block.plannedStartAt) || "時刻未定")} · 見積 ${escapeHTML(estimate)}分</small></button></div>
    <button type="button" class="now-actual-button" data-action="complete-block-with-actual" data-id="${id}">実績付きで完了</button>
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
    <div class="now-record-heading"><strong>${escapeHTML(block.title)}</strong><button type="button" data-action="edit-block" data-id="${escapeHTML(block.id)}">編集</button></div><p><time>${escapeHTML(recordTimeText(block))}</time></p>
    <p class="now-comment">${escapeHTML(block.comment || "")}</p></article>`;
}

function durationText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, "0")}分`;
}

function stackData(blocks, today) {
  const nowMs = Date.now(), towers = weekTowers(blocks, today, nowMs, localDateTimeToMs);
  if (beatenShownFor !== today) beatenShownFor = null;
  return { towers, scale: towerScale(towers), ring: ringState(blocks, today, nowMs, localDateTimeToMs),
    beat: beatYesterday(blocks, today, nowMs, localDateTimeToMs) };
}

function beatenFlag(beat, today) {
  if (!beat.beaten || beatenShownFor === today) return "0";
  beatenShownFor = today;
  return "1";
}

function ringTotalText(ring) {
  return ring.totalSeconds === 0 ? "0分" : durationText(ring.totalSeconds);
}

function ringLabel(ring) {
  return `輪 ${ring.laps}周と ${Math.floor(ring.lapProgress * 30)}分・合計 ${ringTotalText(ring)}`;
}

function stackHTML(blocks, today) {
  const { towers, scale, ring, beat } = stackData(blocks, today);
  return `<div class="now-tower-frame" aria-label="今週の実績"><div class="now-tower-plot" style="height:${scale.ceilingSeconds / scale.lines.at(-1) * 100}%">
    <div class="now-tower-lines">${scale.lines.map(seconds => `<div class="now-tower-line" style="bottom:${seconds / scale.ceilingSeconds * 100}%">${seconds / 3600}h</div>`).join("")}</div>
    ${towers.map((tower, index) => `<div class="now-tower-day"><div class="now-tower" role="img" data-date="${tower.date}" data-today="${tower.isToday ? "1" : "0"}" data-future="${tower.isFuture ? "1" : "0"}" style="height:${tower.seconds / scale.ceilingSeconds * 100}%" aria-label="${towerDays[index]}曜 ${durationText(tower.seconds)}"></div><span>${towerDays[index]}</span></div>`).join("")}</div></div>
    <div class="now-ring-frame" role="img" aria-label="${ringLabel(ring)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="now-ring-full" cx="50" cy="50" r="42" pathLength="1" stroke-dasharray="1 1" style="display:${ring.laps ? "inline" : "none"}" /><circle class="now-ring-progress" cx="50" cy="50" r="42" pathLength="1" stroke-dasharray="${ring.lapProgress} 1" /></svg><span class="now-ring-text"><strong>${ringTotalText(ring)}</strong><small${ring.laps ? "" : " hidden"}>${ring.laps}周</small></span></div>
    <p class="now-beaten" data-beaten="${beatenFlag(beat, today)}"${beat.beaten ? "" : " hidden"}>昨日を超えた</p><small class="now-yesterday">昨日 ${durationText(beat.yesterday)}</small>`;
}

function updateStackTick(root, blocks, today) {
  const stack = root.querySelector(".now-stack");
  if (!stack || stack.contains(document.activeElement)) return;
  const { towers, scale, ring, beat } = stackData(blocks, today);
  stack.querySelector(".now-tower-plot").style.height = `${scale.ceilingSeconds / scale.lines.at(-1) * 100}%`;
  towers.forEach((tower, index) => {
    const bar = stack.querySelector(`.now-tower[data-date="${tower.date}"]`);
    if (!bar) return;
    bar.style.height = `${tower.seconds / scale.ceilingSeconds * 100}%`;
    bar.setAttribute("aria-label", `${towerDays[index]}曜 ${durationText(tower.seconds)}`);
  });
  const lines = stack.querySelector(".now-tower-lines");
  while (lines.children.length > scale.lines.length) lines.lastElementChild.remove();
  scale.lines.forEach((seconds, index) => {
    const line = lines.children[index] || lines.appendChild(document.createElement("div"));
    line.className = "now-tower-line";
    line.style.bottom = `${seconds / scale.ceilingSeconds * 100}%`;
    line.textContent = `${seconds / 3600}h`;
  });
  const frame = stack.querySelector(".now-ring-frame");
  frame.setAttribute("aria-label", ringLabel(ring));
  frame.querySelector(".now-ring-full").style.display = ring.laps ? "inline" : "none";
  frame.querySelector(".now-ring-progress").setAttribute("stroke-dasharray", `${ring.lapProgress} 1`);
  frame.querySelector("strong").textContent = ringTotalText(ring);
  const laps = frame.querySelector("small");
  laps.hidden = ring.laps === 0;
  laps.textContent = `${ring.laps}周`;
  const beaten = stack.querySelector(".now-beaten");
  beaten.hidden = !beat.beaten;
  if (beat.beaten && beatenShownFor !== today) beaten.dataset.beaten = beatenFlag(beat, today);
  stack.querySelector(".now-yesterday").textContent = `昨日 ${durationText(beat.yesterday)}`;
}

// v436 B2-80: 12 週計画由来(taskId のタスクの twyPlan.perWeek > 0。正規化で全タスクに twyPlan が付くため真偽では判定しない)はルーティン枠に出さない。
function isRoutineBlock(b) {
  return b.category === "ルーティン" && !(b.taskId && getState().tasks.some(t => t.id === b.taskId && Number(t.twyPlan?.perWeek) > 0));
}

export function renderNowView() {
  clearStartedDrafts();
  const state = getState(), today = todayISO(), blocks = blocksForDate(today);
  const pending = blocks.filter(b => !b.completed && !b.actualStartAt && !b.actualEndAt)
    .sort((a, b) => String(a.plannedStartAt || "~").localeCompare(String(b.plannedStartAt || "~")) || (a.orderIndex || 0) - (b.orderIndex || 0));
  const pendingBlocks = pending.filter(b => !isRoutineBlock(b));
  const pendingRoutines = pending.filter(isRoutineBlock);
  const running = state.blocks.filter(b => !b.deleted && b.actualStartAt && !b.actualEndAt && !b.completed);
  const records = blocks.filter(b => b.completed || (b.actualStartAt && b.actualEndAt));
  const history = state.blocks.filter(b => !b.deleted && b.date < today && (b.completed || (b.actualStartAt && b.actualEndAt)))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.actualStartAt || "").localeCompare(String(a.actualStartAt || "")));
  const startSection = `<section class="now-start"><h2>開始</h2><div class="now-candidate-list" data-kind="block">${pendingBlocks.map(candidateHTML).join("")}
      ${!blocks.length ? '<p>今日やることはまだ決まっていません。</p><button type="button" data-action="nav" data-view="dandori">段取りで決める</button>' : !pendingBlocks.length ? '<p>未着手の Block はありません。</p>' : ""}</div>
      ${pendingRoutines.length ? `<div class="now-routine"><h3>ルーティン <button type="button" data-action="nav" data-view="routine">編集</button></h3><div class="now-candidate-list" data-kind="routine">${pendingRoutines.map(candidateHTML).join("")}</div></div>` : ""}</section>`;
  const currentSection = `<section class="now-current"><h2>いま</h2>${running.map(b => `<article class="now-running" data-running-id="${escapeHTML(b.id)}"><div class="now-elapsed" data-elapsed-id="${escapeHTML(b.id)}">${elapsedText(b)}</div><small>経過</small><h3>${b.isMIT ? "★ " : ""}${escapeHTML(b.title)}</h3><button type="button" data-action="now-end" data-id="${escapeHTML(b.id)}">終了報告</button></article>`).join("") || '<p>実行中の Block はありません。開始するカードを選んでください。</p>'}</section>`;
  return `<div class="now-view" data-running="${running.length ? "1" : "0"}" data-motion="${escapeHTML(state.settings.towerMotion || "normal")}" data-paused="${document.hidden ? "1" : "0"}">
    ${running.length ? currentSection + startSection : startSection + currentSection}
    <section class="now-done"><h2>今日できた</h2>${records.map(recordHTML).join("") || '<p>終えたことが、ここに残ります。</p>'}
      ${history.length ? `<details><summary>これまでの履歴</summary>${history.slice(0, 30).map(b => `<div><small>${escapeHTML(b.date)}</small>${recordHTML(b)}</div>`).join("")}${history.length > 30 ? '<p>ほかの記録は実行タブの実績で見られます</p>' : ""}</details>` : ""}
      <p class="now-journal-link"><button type="button" data-action="nav" data-view="journal">日報を書く ›</button></p></section>
    <section class="now-stack"><h2>積み上げ</h2>${stackHTML(state.blocks, today)}</section>
  </div>`;
}

export function updateNowViewTick() {
  clearStartedDrafts();
  if (document.hidden) return;
  const root = document.querySelector(".now-view");
  if (!root || root.dataset.paused === "1") return;
  root.querySelectorAll("[data-elapsed-id]").forEach(container => {
    if (container.contains(document.activeElement)) return;
    const block = getState().blocks.find(b => String(b.id) === container.dataset.elapsedId);
    if (hasDateTime(block?.actualStartAt) && !block.actualEndAt) container.textContent = elapsedText(block);
  });
  const blocks = getState().blocks;
  if (blocks.some(b => !b.deleted && !b.completed && hasDateTime(b.actualStartAt) && !b.actualEndAt)) updateStackTick(root, blocks, todayISO());
}
