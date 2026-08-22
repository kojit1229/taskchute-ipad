// src/features/wish.js — app.js分割・段階4-2(WishタブのリストCRUD・描画を抽出)。
//
// 契約(prep-stage4-wish.md §7、既存featureと同じconfigureXxx(deps)パターン):
//   1. state の再代入はしない(src/state/store.jsからlive binding importし、プロパティ変更のみ)。
//   2. escapeHTML/renderHeader/todayISO/localDateTimeToMs/makeTask/makeBlock/defaultPlannedTimes/
//      showToast/nowDateTime/saveAndRender/render/updateTaskFieldはまだapp.js側に残る汎用ヘルパー
//      のため、configureWish(deps) による依存注入で受け取る。
//   3. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js(v167時点)の以下の関数群+モジュール変数。ロジックは一切変更していない
// (移動+依存注入化のみ)。
//   getWishProject/getSubtasksOf/wishProgress/nextStepOf/wishLastActivity/isWishStagnant/
//   wishGroupKey/wishGroupLabel/lifeAreaColor/renderWish/renderWishCard/renderWishDetail/
//   renderWishSubtask/addWish/toggleWishOpen/addWishSubtask/toggleWishSubtask/
//   wishSubtaskToTasks/realizeWish/unrealizeWish/deleteWish。
//
// nextStepOf/lifeAreaColorはprep-stage4-wish.md作成時点のgrepに出現しなかった追加の
// Tier1相当関数(監督者裁定): nextStepOfはgetSubtasksOfのみに依存する純粋読み取り関数で、
// renderWishCardから呼ばれる。lifeAreaColorもrenderWishCardから利用する。
//
// characterization test: tests/wish-core.test.js。
//
// TOWER意匠化(第3弾先行分・2026-08-22): renderWish/renderWishCard/renderWishDetailの
// HTML構造(クラス追加・見出し)とCSSのみを改装。ロジック・state操作・data-action・既存クラスは
// 1行も変えていない(既存クラスは削除せず、tower-*クラスを追加するだけ)。詳細は
// workbench/out/2026-08-21-taskchute-slim-spec/tower-restyle/wish/notes.md 参照。

import { state } from "../state/store.js";
import { registerActions } from "../ui/actions.js";

// ---- 依存注入(configureWish) ----
let escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock;
let defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField;
let maybeQueueNextAiStep;
let aiInsightsPanelHTML = () => "";

function configureWish(deps) {
  ({
    escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock,
    defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField,
    maybeQueueNextAiStep
  } = deps);
  aiInsightsPanelHTML = deps.aiInsightsPanelHTML || (() => "");
  // v173: app.js分割・段階5-2(prep-stage5-dispatcher.md案A)。Wish CRUD分岐を登録する。
  registerActions({
    "add-wish": () => addWish(),
    "open-wish": (ctx) => toggleWishOpen(ctx.id),
    "add-wish-subtask": (ctx) => addWishSubtask(ctx.id),
    "toggle-wish-subtask": (ctx) => toggleWishSubtask(ctx.id),
    "wish-subtask-to-tasks": (ctx) => wishSubtaskToTasks(ctx.id),
    "wish-realize": (ctx) => realizeWish(ctx.id),
    "wish-unrealize": (ctx) => unrealizeWish(ctx.id),
    "delete-wish": (ctx) => deleteWish(ctx.id)
  });
}

// ---- ここから抽出したコード本体(app.js:v167時点から移動。ロジック無改変) ----

// Wish Project を取得(必ず1つ存在することは normalizeState で保証済み)
function getWishProject() {
  return state.projects.find((p) => p.kind === "wish" && !p.deleted);
}

// ある Wish (Task) のサブタスク(全階層)を再帰的に取得
function getSubtasksOf(taskId) {
  const direct = state.tasks.filter((t) => !t.deleted && t.parentTaskId === taskId);
  let all = [...direct];
  for (const child of direct) {
    all = all.concat(getSubtasksOf(child.id));
  }
  return all;
}

// Wish の進捗(完了サブタスク数 / 総サブタスク数)
function wishProgress(wishTaskId) {
  const subs = getSubtasksOf(wishTaskId);
  if (subs.length === 0) return { done: 0, total: 0, percent: 0 };
  const done = subs.filter((t) => t.status === "completed").length;
  return { done, total: subs.length, percent: Math.round((done / subs.length) * 100) };
}

// Wish の「次の一歩」= 未完了の最初のサブタスク
function nextStepOf(wishTaskId) {
  const subs = getSubtasksOf(wishTaskId).filter((t) => t.status !== "completed");
  if (subs.length === 0) return null;
  // dueDate がある順 → createdAt 順
  subs.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
  return subs[0];
}

// Wish の最終更新日(本体 or サブタスクの最も新しい updatedAt)
function wishLastActivity(wishTaskId) {
  const wish = state.tasks.find((t) => t.id === wishTaskId);
  if (!wish) return "";
  const subs = getSubtasksOf(wishTaskId);
  const times = [wish.updatedAt || "", ...subs.map((t) => t.updatedAt || "")].filter(Boolean);
  return times.sort().pop() || "";
}

// 60 日以上動いていないか
function isWishStagnant(wishTaskId) {
  const last = wishLastActivity(wishTaskId);
  if (!last) return false;
  const lastMs = localDateTimeToMs(last); // v56: updatedAt はローカル日時文字列。iOS TZ 誤解釈回避
  return Date.now() - lastMs > 60 * 24 * 60 * 60 * 1000;
}

// v186 F5: 作成からの時間だけを表示する。最終活動から測る停滞判定とは別軸。
function wishRipeness(wish) {
  const createdMs = localDateTimeToMs(wish.createdAt || "");
  if (!createdMs) return null;
  const days = Math.max(0, Math.floor((Date.now() - createdMs) / (24 * 60 * 60 * 1000)));
  const percent = days <= 30
    ? Math.round(days / 30 * 50)
    : Math.min(100, Math.round(50 + (days - 30) / 60 * 50));
  return { days, percent };
}

function wishRipenessHTML(wish) {
  const ripeness = wishRipeness(wish);
  return `<div class="wish-ripeness">
    <div class="wish-ripeness-head">
      <span>熟成 = 作成からの時間</span>
      <strong>${ripeness ? `${ripeness.days}日・${ripeness.percent}%` : "作成日不明"}</strong>
    </div>
    <div class="wish-ripeness-track"><span class="wish-ripeness-bar" style="width:${ripeness?.percent || 0}%"></span></div>
    <div class="muted wish-ripeness-note">30日で50%・90日で100%。停滞表示は触っていない時間です。</div>
  </div>`;
}

// 時期グループ判定: targetYear と現在年から「~Nまで(あと M 年)」のラベル
function wishGroupKey(wish) {
  if (wish.realized) return "realized";
  if (!wish.targetYear) return "someday";
  return `by-${wish.targetYear}`;
}

function wishGroupLabel(key) {
  if (key === "realized") return "✓ 実現済み";
  if (key === "someday") return "いつか";
  const year = Number(key.replace("by-", ""));
  const now = new Date().getFullYear();
  const diff = year - now;
  if (diff <= 0) return `~${year} (今年・期限到来)`;
  return `~${year} (あと ${diff} 年)`;
}

// 領域の色を取得
function lifeAreaColor(name) {
  const area = (state.settings.lifeAreas || []).find((a) => a.name === name);
  return area?.color || "#8E8E93";
}

// メインレンダリング
// TOWER意匠化: タブ全体を<div class="tower-skin wish-tower">でラップし、各パネルに
// tower-panel-box(TOWERパネル枠)クラスと「PANEL NAME<span>説明</span>」型h2見出しを追加した。
// 既存クラス(panel/form-strip/section/grid/row/muted/progress等)・id・data-actionは
// 1つも削除・変更していない(既存テストの参照セレクタを温存)。
function renderWish() {
  const wishProject = getWishProject();
  if (!wishProject) {
    return `
      <div class="tower-skin wish-tower">
        ${renderHeader("やりたいことリスト", "Wish")}
        <section class="panel tower-panel-box">Wish Project が存在しません。リロードしてください。</section>
      </div>
    `;
  }

  // フィルタ状態
  const filter = state.wishFilter || { area: "", showRealized: false };
  const wishes = state.tasks
    .filter((t) => !t.deleted && t.projectId === wishProject.id && !t.parentTaskId)
    .filter((t) => filter.area ? t.lifeArea === filter.area : true)
    .filter((t) => filter.showRealized ? true : !t.realized);

  // 実現率(全 Wish 中)
  const allWishes = state.tasks.filter((t) => !t.deleted && t.projectId === wishProject.id && !t.parentTaskId);
  const realizedCount = allWishes.filter((t) => t.realized).length;
  const overallRate = allWishes.length === 0 ? 0 : Math.round((realizedCount / allWishes.length) * 100);

  // 領域フィルタオプション
  const lifeAreas = state.settings.lifeAreas || [];

  // 時期グループでまとめる
  const groups = {};
  for (const w of wishes) {
    const key = wishGroupKey(w);
    groups[key] ||= [];
    groups[key].push(w);
  }
  // グループ順: 今年→未来→いつか→実現済み
  const groupOrder = Object.keys(groups).sort((a, b) => {
    const order = (k) => {
      if (k === "realized") return 9999;
      if (k === "someday") return 9998;
      return Number(k.replace("by-", "")) || 0;
    };
    return order(a) - order(b);
  });

  return `
    <div class="tower-skin wish-tower">
    ${renderHeader("やりたいことリスト", "Wish")}
    <section class="panel tower-panel-box wish-rate-panel" style="margin-bottom:12px">
      <h2>WISH RADAR<span>実現率</span></h2>
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        <strong>実現率</strong>
        <div style="font-size:20px; font-weight:700; color:var(--accent)">${realizedCount} / ${allWishes.length}</div>
        <div class="muted">(${overallRate}%)</div>
        <div class="progress" style="flex:1; min-width:120px"><span style="width:${overallRate}%; background:var(--accent)"></span></div>
      </div>
    </section>

    <section class="panel tower-panel-box wish-deck-panel">
      <h2>WISH DECK<span>追加・絞り込み</span></h2>
      <section class="form-strip">
        <input id="wishTitle" class="input" placeholder="やりたいこと(壮大でOK)">
        <button class="btn primary" data-action="add-wish">追加</button>
      </section>

      <section class="form-strip" style="margin-top:8px">
        <select id="wishFilterArea" class="select" data-action="wish-filter-area">
          <option value="">全領域</option>
          ${lifeAreas.map((a) => `<option value="${escapeHTML(a.name)}" ${filter.area === a.name ? "selected" : ""}>${escapeHTML(a.name)}</option>`).join("")}
        </select>
        <label class="row" style="gap:6px; align-items:center; padding:0 8px">
          <input type="checkbox" data-action="wish-toggle-realized" ${filter.showRealized ? "checked" : ""}>
          <span class="muted" style="font-size:12px">実現済みも表示</span>
        </label>
      </section>
    </section>

    ${groupOrder.length === 0
      ? `<section class="panel tower-panel-box" style="margin-top:12px; text-align:center; padding:32px"><div class="muted">${filter.area ? `「${escapeHTML(filter.area)}」のやりたいことはまだありません` : "やりたいことを追加してみましょう(壮大なものでもOK)"}</div></section>`
      : groupOrder.map((key) => `
        <section class="section tower-panel-box wish-group-panel" style="margin-top:14px">
          <h2>FLIGHT PLAN<span>${wishGroupLabel(key)} ・ ${groups[key].length} 件</span></h2>
          <div class="grid">
            ${groups[key].map(renderWishCard).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

// TOWER意匠化: 既存クラス(panel/wish-card/is-realized等)は温存し、tower-flight-card
// クラスを追加しただけ(見出し追加はしていない。個々のカードはTOWERの「便」相当のため、
// パネル見出し=h2は付けずCSSのみで枠を寄せる)。
function renderWishCard(wish) {
  const progress = wishProgress(wish.id);
  const nextStep = nextStepOf(wish.id);
  const stagnant = isWishStagnant(wish.id);
  const areaColor = lifeAreaColor(wish.lifeArea);
  return `
    <div class="panel wish-card tower-flight-card ${wish.realized ? "is-realized" : ""}" style="border-left:4px solid ${areaColor}">
      <div class="row" style="align-items:center; gap:8px">
        <label class="wish-check-wrap">
          <input type="checkbox" class="wish-check" data-action="${wish.realized ? "wish-unrealize" : "wish-realize"}" data-id="${wish.id}" ${wish.realized ? "checked" : ""} title="実現済みにする" aria-label="実現済みにする">
        </label>
        <div style="flex:1; min-width:0">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            ${stagnant ? "<span title=\"60日以上動いていません\">🐢</span>" : ""}
            <strong style="${wish.realized ? "text-decoration:line-through; opacity:0.6" : ""}">${escapeHTML(wish.title)}</strong>
            ${wish.lifeArea ? `<span class="chip" style="background:${areaColor}22; color:${areaColor}; border:1px solid ${areaColor}55">${escapeHTML(wish.lifeArea)}</span>` : ""}
          </div>
          ${wish.motivation ? `<div class="muted" style="font-size:11px; margin-top:4px; font-style:italic">"${escapeHTML(wish.motivation)}"</div>` : ""}
        </div>
        <button class="btn ghost" data-action="open-wish" data-id="${wish.id}">${state.wishOpenId === wish.id ? "閉じる" : "開く"}</button>
      </div>

      <div class="row" style="align-items:center; gap:8px; margin-top:8px">
        <div class="muted" style="font-size:12px; white-space:nowrap">${progress.done} / ${progress.total}</div>
        <div class="progress" style="flex:1"><span style="width:${progress.percent}%"></span></div>
        ${nextStep
          ? `<div class="muted" style="font-size:11px; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeHTML(nextStep.title)}">次: ${escapeHTML(nextStep.title)}</div>`
          : (wish.realized ? "" : "<div class=\"muted\" style=\"font-size:11px; color:var(--orange-text)\">↳ サブタスクを書く</div>")}
      </div>
      ${wishRipenessHTML(wish)}
      ${aiInsightsPanelHTML("wish", wish.id)}

      ${state.wishOpenId === wish.id ? renderWishDetail(wish) : ""}
    </div>
  `;
}

// Wish 詳細展開(サブタスク・編集)
// TOWER意匠化: 既存クラス(wish-detail)は温存し、tower-flight-detailクラスを追加しただけ。
function renderWishDetail(wish) {
  const subtasks = state.tasks.filter((t) => !t.deleted && t.parentTaskId === wish.id);
  if (subtasks.some((task) => Number.isFinite(task.order))) {
    // v194: 両方に order があるときだけ実行計画の順序を使う。それ以外は従来の並び
  // (完了下沈み → 両方に期限があれば期限 → createdAt)を**そのまま維持する**
  subtasks.sort((a, b) => {
    if (Number.isFinite(a.order) && Number.isFinite(b.order) && a.order !== b.order) {
      return a.order - b.order;
    }
    // dueDate あれば優先、なければ createdAt 順
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
  } else {
    // order 導入前のWish詳細は既存の見え方を変えない。
    subtasks.sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  }
  const lifeAreas = state.settings.lifeAreas || [];
  const currentYear = new Date().getFullYear();
  const yearOptions = [
    `<option value="" ${!wish.targetYear ? "selected" : ""}>いつか</option>`,
    ...[0, 1, 2, 3, 5, 7, 10, 13, 20, 30].map((d) => {
      const y = currentYear + d;
      return `<option value="${y}" ${wish.targetYear === y ? "selected" : ""}>~${y} (${d === 0 ? "今年" : `あと${d}年`})</option>`;
    })
  ].join("");

  return `
    <div class="wish-detail tower-flight-detail" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--line)">
      <div class="form-strip" style="margin-bottom:10px">
        <select class="select" data-action="wish-set-year" data-id="${wish.id}" style="flex:1">${yearOptions}</select>
        <select class="select" data-action="wish-set-area" data-id="${wish.id}" style="flex:1">
          <option value="">領域未設定</option>
          ${lifeAreas.map((a) => `<option value="${escapeHTML(a.name)}" ${wish.lifeArea === a.name ? "selected" : ""}>${escapeHTML(a.name)}</option>`).join("")}
        </select>
      </div>

      <div style="margin-bottom:10px">
        <div class="muted" style="font-size:11px; margin-bottom:4px">期限(任意。週次レビューで参照)</div>
        <input class="input" type="date" data-action="wish-set-duedate" data-id="${wish.id}" value="${wish.dueDate || ""}">
      </div>

      <div style="margin-bottom:10px">
        <div class="muted" style="font-size:11px; margin-bottom:4px">なぜやりたい(モチベーションの源)</div>
        <textarea class="textarea" data-action="wish-set-motivation" data-id="${wish.id}" rows="2" placeholder="子が小さいうちに3世代で旅したい…">${escapeHTML(wish.motivation || "")}</textarea>
      </div>

      <div class="row" style="margin-bottom:8px; align-items:center">
        <strong>サブタスク</strong>
        <button class="btn ghost" data-action="add-wish-subtask" data-id="${wish.id}">+ 追加</button>
      </div>
      <div class="grid">
        ${subtasks.length === 0
          ? `<div class="muted" style="padding:8px; font-size:12px">最初の一歩を1〜3個書いてみましょう。完璧でなくて大丈夫。</div>`
          : subtasks.map((sub) => renderWishSubtask(sub)).join("")}
      </div>

      <div class="row" style="margin-top:12px; gap:8px; flex-wrap:wrap">
        ${wish.realized
          ? `<button class="btn ghost" data-action="wish-unrealize" data-id="${wish.id}">↩ 未実現に戻す</button>`
          : `<button class="btn primary" data-action="wish-realize" data-id="${wish.id}">🎉 実現済みにする</button>`}
        <button class="btn danger ghost" data-action="delete-wish" data-id="${wish.id}">削除</button>
      </div>
    </div>
  `;
}

// サブタスク1行
function renderWishSubtask(sub) {
  const done = sub.status === "completed";
  return `
    <div class="row" style="gap:8px; align-items:center; padding:6px 8px; border-radius:8px; background:var(--panel-soft)">
      <input type="checkbox" data-action="toggle-wish-subtask" data-id="${sub.id}" ${done ? "checked" : ""}>
      <input type="text" class="input" value="${escapeHTML(sub.title)}" data-action="wish-subtask-title" data-id="${sub.id}" style="flex:1; ${done ? "text-decoration:line-through; opacity:0.6" : ""}">
      ${done
        ? ""
        : `<button class="btn ghost" data-action="wish-subtask-to-tasks" data-id="${sub.id}" title="今日のタスクシュートに登録">📋 今日やる</button>`}
      <button class="btn danger ghost" data-action="delete-task" data-id="${sub.id}" title="削除">✕</button>
    </div>
  `;
}

function addWish() {
  const titleEl = document.querySelector("#wishTitle");
  const title = titleEl?.value.trim();
  if (!title) return showToast("やりたいことを入力してください");
  const wishProject = getWishProject();
  if (!wishProject) return showToast("Wish Project が見つかりません");
  const task = makeTask({ projectId: wishProject.id, title });
  // v79: makeTask の dueDate 既定(未指定時="今日")はタスクシュート実行前提の値で、
  //      長期的な「やりたいこと」には合わないため、Wish作成時だけ空に戻す(期限は任意)。
  task.dueDate = "";
  state.tasks.push(task);
  state.wishOpenId = task.id;  // 追加後すぐに開く
  if (titleEl) titleEl.value = "";
  saveAndRender("やりたいことを追加しました(サブタスクを書いて一歩を)");
}

function toggleWishOpen(id) {
  state.wishOpenId = (state.wishOpenId === id) ? "" : id;
  render();
}

function addWishSubtask(parentTaskId) {
  const title = window.prompt("サブタスク(次の一歩)を入力してください") || "";
  if (!title.trim()) return;
  const parent = state.tasks.find((t) => t.id === parentTaskId);
  if (!parent) return;
  const sub = makeTask({ projectId: parent.projectId, parentTaskId, title: title.trim() });
  // v79: addWish()と同じ理由でdueDateの「今日」既定を持ち込まない(Wishサブタスクも期限は任意)。
  //      Kフォローアップ指示: Wish関連の全作成経路でdueDateが既定で埋まらないようにする。
  sub.dueDate = "";
  state.tasks.push(sub);
  saveAndRender("サブタスクを追加しました");
}

function toggleWishSubtask(id) {
  // v198(第3弾3e): updateTaskFieldと同じ理由でprevStatusをここで確保する(完了6経路#6)
  const prevStatus = state.tasks.find((t) => t.id === id)?.status;
  state.tasks = state.tasks.map((t) => t.id === id
    ? {
        ...t,
        status: t.status === "completed" ? "todo" : "completed",
        updatedAt: nowDateTime()
      }
    : t);
  saveAndRender("");
  maybeQueueNextAiStep(id, prevStatus);  // v198(第3弾3e): 完了6経路#6(Wish詳細のサブタスクチェック)
}

// Wish のサブタスクを今日のタスクシュート(Block)に登録
function wishSubtaskToTasks(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return showToast("タスクが見つかりません");
  // v152レビュー対応(両系統一致): 「今日のタスクシュートに登録」は文言どおり常に実時計の今日
  // (todayISO())基準であるべきで、閲覧中の日付(state.selectedDate)に依存させない
  // (carryOverBlockと同じ基準に統一。過去日を閲覧した直後にこの経路を使うと過去日にBlockが
  // 作られてしまう既存の潜在バグだった)。
  const today = todayISO();
  // 既に今日の Block 化されていないか
  const exists = state.blocks.find((b) => !b.deleted && b.taskId === taskId && b.date === today);
  if (exists) return showToast("既に今日のタスクシュートにあります");
  // 新規 Block を作成。expectedCharge: 4(やりたいこと=充電源)を推奨値として
  // v29: 予定の開始/終了日時をデフォルトで入れる(v152: 日付部分もtoday基準に統一)
  const { plannedStartAt, plannedEndAt } = defaultPlannedTimes(today);
  const block = makeBlock({
    date: today,
    title: task.title,
    category: task.category || "回復",
    taskId: task.id,
    expectedCharge: 4,
    expectedDischarge: 1,
    plannedStartAt,
    plannedEndAt
  });
  state.blocks.push(block);
  // Task の status を "doing" に
  state.tasks = state.tasks.map((t) => t.id === taskId ? { ...t, status: "doing", updatedAt: nowDateTime() } : t);
  saveAndRender("今日のタスクシュートに登録しました");
}

function realizeWish(id) {
  // v198(第3弾3e): maybeQueueNextAiStepは意図的に配線しない(対象外)。addWish()が作るWishは
  // 常にトップレベル(parentTaskIdは既定""のまま)でplanParentFor()がnullを返すため、発火条件2が
  // 構造的に不成立(監督者裁定・実装設計書H節)。前提はtests/v198.test.jsで固定する。
  // v79: ネイティブcheckboxはクリック時点でchecked属性が先に反転済みのため、confirmを
  // キャンセルしてここでreturnするだけだとチェックが見た目だけONに残ってしまう(state.realized
  // は変わっていないのに)。render()でDOMをstateに合わせて戻す。
  if (!window.confirm("このやりたいことを「実現済み」にしますか?")) { render(); return; }
  const today = todayISO();
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, realized: true, realizedDate: today, status: "completed", updatedAt: nowDateTime() }
    : t);
  saveAndRender("🎉 おめでとうございます!実現済みにしました");
}

function unrealizeWish(id) {
  state.tasks = state.tasks.map((t) => t.id === id
    ? { ...t, realized: false, realizedDate: "", status: "todo", updatedAt: nowDateTime() }
    : t);
  saveAndRender("未実現に戻しました");
}

function deleteWish(id) {
  if (!window.confirm("このやりたいこと(およびサブタスク)を削除しますか?")) return;
  // 本体 + 子孫サブタスクをすべて deleted フラグ
  const allIds = new Set([id]);
  // 子孫を再帰的に集める
  const collect = (parentId) => {
    state.tasks.forEach((t) => {
      if (!t.deleted && t.parentTaskId === parentId) {
        allIds.add(t.id);
        collect(t.id);
      }
    });
  };
  collect(id);
  state.tasks = state.tasks.map((t) => allIds.has(t.id) ? { ...t, deleted: true, updatedAt: nowDateTime() } : t);
  if (state.wishOpenId === id) state.wishOpenId = "";
  saveAndRender("削除しました");
}

export {
  configureWish,
  getWishProject, getSubtasksOf, wishProgress, nextStepOf, wishLastActivity, isWishStagnant,
  wishGroupKey, wishGroupLabel, lifeAreaColor,
  renderWish, renderWishCard, renderWishDetail, renderWishSubtask,
  addWish, toggleWishOpen, addWishSubtask, toggleWishSubtask, wishSubtaskToTasks,
  realizeWish, unrealizeWish, deleteWish
};
