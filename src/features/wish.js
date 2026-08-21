// src/features/wish.js — app.js分割・段階4-2(WishタブTier1のCRUD・描画・月間ボードD&D抽出)。
//
// 契約(prep-stage4-wish.md §7、既存featureと同じconfigureXxx(deps)パターン):
//   1. state の再代入はしない(src/state/store.jsからlive binding importし、プロパティ変更のみ)。
//   2. escapeHTML/renderHeader/todayISO/localDateTimeToMs/makeTask/makeBlock/defaultPlannedTimes/
//      showToast/nowDateTime/saveAndRender/render/updateTaskFieldはまだapp.js側に残る汎用ヘルパー
//      のため、configureWish(deps) による依存注入で受け取る。
//   3. renderWishTriage(仕分けモード、Tier3=非移動)も同じdeps注入で受け取る。renderWish()の
//      viewMode==="triage"分岐はロジック無改変のため元のまま残し(prep-stage4-wish.md §7の
//      2案のうち(a))、循環importにしないためstatic importではなくdeps注入にした
//      (v166/v167で確立したconfigureXxx(deps)パターンが、(a)案が懸念していた循環importの
//      問題を解消するため、renderWishを分割する(b)案より安全に(a)を実現できる。逸脱点として
//      監督者へ報告指定のとおり)。
//   4. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js(v167時点)の以下の関数群+モジュール変数。ロジックは一切変更していない
// (移動+依存注入化のみ)。
//   getWishProject/getSubtasksOf/wishProgress/nextStepOf/wishLastActivity/isWishStagnant/
//   wishGroupKey/wishGroupLabel/lifeAreaColor/renderWish/renderWishBoard/
//   scrollWishBoardToCurrentMonth/renderWishBoardCard/renderWishCard/renderWishDetail/
//   renderWishSubtask/addWish/toggleWishOpen/addWishSubtask/toggleWishSubtask/
//   wishSubtaskToTasks/realizeWish/unrealizeWish/deleteWish(以上Tier1)/
//   wishHasTodayBlock(Tier2、triageQueue(Tier3・app.js側)から共有importされる)/
//   _wishDrag(モジュールlet)+ 月間ボードD&Dのpointerdown/move/upリスナー3件。
//
// nextStepOf/lifeAreaColorはprep-stage4-wish.md作成時点のgrepに出現しなかった追加の
// Tier1相当関数(監督者裁定): nextStepOfはgetSubtasksOfのみに依存する純粋読み取り関数で
// renderWishCard(Tier1)とtriageAction(Tier3・app.js側)の両方から呼ばれるため、
// wishHasTodayBlockと同じ「Tier1へ移しexportし、Tier3側はここからimportする」扱いとした。
// lifeAreaColorはrenderWishBoardCard/renderWishCard(いずれもTier1)からのみ参照される。
//
// Tier3(仕分けモード・儀式連携・Homeタブ週次カード)は移動しない。moveBlockToWish/
// buildWeeklyWishModal(いずれもapp.js残留)はgetWishProjectを、triageAction(app.js残留)は
// nextStepOf/wishSubtaskToTasksを、triageQueue(app.js残留)はwishHasTodayBlockをこのファイルから
// importする(依存の向きはapp.js→features/wish.jsの一方向のまま)。
//
// characterization test: tests/wish-core.test.js。

import { state } from "../state/store.js";
import { persistLocalNoSchedule } from "../storage/local.js";
import { registerActions } from "../ui/actions.js";

// ---- 依存注入(configureWish) ----
let escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock;
let defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField;
let renderWishTriage, maybeQueueNextAiStep;
let aiInsightsPanelHTML = () => "";

function configureWish(deps) {
  ({
    escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock,
    defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField,
    renderWishTriage, maybeQueueNextAiStep
  } = deps);
  aiInsightsPanelHTML = deps.aiInsightsPanelHTML || (() => "");
  // v173: app.js分割・段階5-2(prep-stage5-dispatcher.md案A)。click dispatcherのWish Tier1
  // CRUD分岐+表示モード切替をレジストリへ移行する(ロジック無改変)。triage-*(仕分けモード、
  // Tier3=このファイル未抽出)はapp.js残留のためここでは登録しない。
  registerActions({
    "add-wish": () => addWish(),
    "open-wish": (ctx) => toggleWishOpen(ctx.id),
    "add-wish-subtask": (ctx) => addWishSubtask(ctx.id),
    "toggle-wish-subtask": (ctx) => toggleWishSubtask(ctx.id),
    "wish-subtask-to-tasks": (ctx) => wishSubtaskToTasks(ctx.id),
    "wish-realize": (ctx) => realizeWish(ctx.id),
    "wish-unrealize": (ctx) => unrealizeWish(ctx.id),
    "delete-wish": (ctx) => deleteWish(ctx.id),
    "wish-view-mode": (ctx) => {
      state.wishViewMode = ctx.target.dataset.mode || "list";
      persistLocalNoSchedule();
      render();
      if (state.wishViewMode === "board") scrollWishBoardToCurrentMonth();
    },
    "wish-board-jump-current": () => scrollWishBoardToCurrentMonth()
  });
}

// ---- ここから抽出したコード本体(app.js:v167時点から移動。ロジック無改変) ----

// v79: 月間プランニングボードのカードドラッグ(Pointer Events。既存の下書きBlockドラッグ
//      (_draftDrag)と同じ「pointerdown/move/upで見た目だけ動かしupで正規化」方式を流用)。
//      { id, el, startX, startY, moved } 非永続。moved=trueになって初めてドラッグ確定(タップの
//      月選択セレクト操作を邪魔しないための閾値判定)。
let _wishDrag = null;

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
function renderWish() {
  const wishProject = getWishProject();
  if (!wishProject) {
    return `
      ${renderHeader("やりたいことリスト", "Wish")}
      <section class="panel">Wish Project が存在しません。リロードしてください。</section>
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

  // v79: 表示切替(リスト⇔ボード)。UI状態のみ・dataModifiedAtは汚さない(routineViewModeと同じ扱い)。
  const viewMode = state.wishViewMode || "list";

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
    ${renderHeader("やりたいことリスト", "Wish")}
    <section class="panel" style="margin-bottom:12px">
      <div class="row" style="align-items:center; gap:8px; flex-wrap:wrap">
        <strong>実現率</strong>
        <div style="font-size:20px; font-weight:700; color:var(--accent)">${realizedCount} / ${allWishes.length}</div>
        <div class="muted">(${overallRate}%)</div>
        <div class="progress" style="flex:1; min-width:120px"><span style="width:${overallRate}%; background:var(--accent)"></span></div>
      </div>
    </section>

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

    <div class="segmented" style="margin-top:8px">
      <button class="${viewMode === "list" ? "active" : ""}" data-action="wish-view-mode" data-mode="list">☰ リスト</button>
      <button class="${viewMode === "board" ? "active" : ""}" data-action="wish-view-mode" data-mode="board">🗓 月間ボード</button>
      <button class="${viewMode === "triage" ? "active" : ""}" data-action="wish-view-mode" data-mode="triage">🃏 仕分け</button>
    </div>

    ${viewMode === "board" ? renderWishBoard(wishes) : viewMode === "triage" ? renderWishTriage(wishes) : (groupOrder.length === 0
      ? `<section class="panel" style="margin-top:12px; text-align:center; padding:32px"><div class="muted">${filter.area ? `「${escapeHTML(filter.area)}」のやりたいことはまだありません` : "やりたいことを追加してみましょう(壮大なものでもOK)"}</div></section>`
      : groupOrder.map((key) => `
        <section class="section" style="margin-top:14px">
          <div class="row" style="margin-bottom:8px">
            <h3>${wishGroupLabel(key)}</h3>
            <div class="muted">${groups[key].length} 件</div>
          </div>
          <div class="grid">
            ${groups[key].map(renderWishCard).join("")}
          </div>
        </section>
      `).join(""))}
  `;
}

// v79: 月間プランニングボード ==============================
// 「未定」プール + 1〜12月の枠。ドラッグ&ドロップ(iPadタッチ対応: pointer events)+
// タップ代替(カード上の月選択セレクト)の両方で targetMonth を割り当てる。
// wishes は renderWish() で既にarea/showRealizedフィルタ済みのものをそのまま使う。
//
// v80: レイアウトを「小さい固定グリッド」から縦積みリスト型に変更。
// 理由(Kフィードバック: 「月カードが小さくて、入れるとやりたいことが見切れてしまう」):
// 旧実装は auto-fill grid(minmax(150px,1fr))で、主端末のiPhone(縦持ち・幅約390px)では
// 実質2列にしかならず、カード幅が狭すぎてタイトルが省略記号(ellipsis)で切れていた。
// 1〜12月を縦一列に並べれば、カード幅は画面幅いっぱいまで使えるためタイトルを折り返せる。
// 空月まで毎回フルサイズの枠を描くと12ヶ月分でスクロールが長大になるため、
// 中身が無い月はヘッダ行だけの薄い行に縮小する(=ドロップ先としても残す。month-zoneは
// 行全体に付けているので、空月でも「ヘッダだけの行」自体がドロップターゲットになる)。
function renderWishBoard(wishes) {
  const unassigned = wishes.filter((w) => !w.targetMonth);
  const currentMonth = Number(todayISO().slice(5, 7));  // "YYYY-MM-DD" の月部分(文字列抽出。new Date(string)は使わない)
  const monthGroups = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => ({ month: m, items: wishes.filter((w) => w.targetMonth === m) }));

  return `
    <section class="section wish-board" style="margin-top:14px">
      <div class="wish-board-pool">
        <div class="row" style="margin-bottom:6px; align-items:center">
          <h3>未定</h3>
          <div class="muted">${unassigned.length} 件</div>
        </div>
        <div class="wish-board-pool-body month-zone" data-month="">
          ${unassigned.length === 0
            ? `<div class="muted" style="font-size:12px; padding:8px">すべて月に割り当て済みです</div>`
            : unassigned.map(renderWishBoardCard).join("")}
        </div>
      </div>

      <div class="row wish-board-toolbar">
        <div class="muted" style="font-size:11px">1月〜12月を縦に並べています。空の月はヘッダのみ表示です。</div>
        <button class="btn ghost" data-action="wish-board-jump-current">📍 ${currentMonth}月(今月)へ</button>
      </div>

      <div class="wish-board-list">
        ${monthGroups.map(({ month, items }) => `
          <div class="wish-board-month-row month-zone ${items.length === 0 ? "is-empty" : ""} ${month === currentMonth ? "is-current" : ""}"
               data-month="${month}" data-month-row="${month}">
            <div class="wish-board-month-head">
              <strong>${month}月</strong>
              ${month === currentMonth ? `<span class="wish-board-current-badge">今月</span>` : ""}
              <span class="muted" style="font-size:11px">${items.length > 0 ? `${items.length}件` : "空き"}</span>
            </div>
            ${items.length > 0
              ? `<div class="wish-board-month-body">${items.map(renderWishBoardCard).join("")}</div>`
              : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

// v80: 月間ボードを現在月の行までスクロール(自動起動時・「今月へ」ボタン共用)
function scrollWishBoardToCurrentMonth() {
  const currentMonth = Number(todayISO().slice(5, 7));
  setTimeout(() => {
    document.querySelector(`[data-month-row="${currentMonth}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 60);
}

// 月間ボードのカード1個(ドラッグ対象 + タップ代替の月選択セレクト同居)。
// v80: タイトルを単一行ellipsisから2行までのline-clampへ変更(見切れ対策の本丸)。
function renderWishBoardCard(wish) {
  const areaColor = lifeAreaColor(wish.lifeArea);
  const monthOptions = [
    `<option value="">未定</option>`,
    ...Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => `<option value="${m}" ${wish.targetMonth === m ? "selected" : ""}>${m}月</option>`)
  ].join("");
  return `
    <div class="wish-board-card" draggable="true" data-wish-drag-id="${wish.id}" style="border-left:3px solid ${areaColor}">
      <div class="wish-board-card-main">
        <span class="wish-board-card-title" title="${escapeHTML(wish.title)}">${escapeHTML(wish.title)}</span>
        ${wish.lifeArea ? `<span class="wish-board-card-area" style="color:${areaColor}">${escapeHTML(wish.lifeArea)}</span>` : ""}
      </div>
      <select class="select wish-board-card-month" data-action="wish-set-month" data-id="${wish.id}" aria-label="月を選ぶ">${monthOptions}</select>
    </div>
  `;
}

// Wish カード(1個)
function renderWishCard(wish) {
  const progress = wishProgress(wish.id);
  const nextStep = nextStepOf(wish.id);
  const stagnant = isWishStagnant(wish.id);
  const areaColor = lifeAreaColor(wish.lifeArea);
  return `
    <div class="panel wish-card ${wish.realized ? "is-realized" : ""}" style="border-left:4px solid ${areaColor}">
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
    <div class="wish-detail" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--line)">
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

// 指定Wish(本体または子孫サブタスク)を対象にした「今日の」Blockが既に存在するか。
// セッションをまたいでも(リロード後も)再ループしないための永続データ側の判定
// (仕分けモード側のセッション内Setはページリロードで消えるため、こちらが本当の歯止め。Tier2:
// 仕分けモード=triageQueue(app.js残留)がこのファイルからimportして使う)。
function wishHasTodayBlock(wishId) {
  const today = todayISO();
  const ids = new Set([wishId, ...getSubtasksOf(wishId).map((t) => t.id)]);
  return state.blocks.some((b) => !b.deleted && b.date === today && ids.has(b.taskId));
}

// v79: 月間プランニングボードのカードD&D(Pointer Events。iPadタッチ対応)。
// 上の下書きBlockドラッグと同じ「pointerdown/move/upで見た目だけ動かし、upでstateに反映して
// render()で正規化」方式を流用しつつ、こちらは連続位置ではなく「どの月枠の上で離したか」を
// document.elementFromPoint で判定する離散ドロップ。移動量が閾値未満はタップ(カード上の月選択
// セレクト操作)とみなし何もしない。
const WISH_DRAG_THRESHOLD = 8; // px
document.addEventListener("pointerdown", (event) => {
  const card = event.target.closest(".wish-board-card");
  if (!card) return;
  if (event.target.closest("[data-action]")) return;  // 月選択セレクトは通常のタップ操作に譲る
  _wishDrag = { id: card.dataset.wishDragId, el: card, startX: event.clientX, startY: event.clientY, moved: false };
});
document.addEventListener("pointermove", (event) => {
  if (!_wishDrag) return;
  const dx = event.clientX - _wishDrag.startX;
  const dy = event.clientY - _wishDrag.startY;
  if (!_wishDrag.moved && Math.hypot(dx, dy) < WISH_DRAG_THRESHOLD) return;
  _wishDrag.moved = true;
  _wishDrag.el.classList.add("is-dragging");
  _wishDrag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  document.querySelectorAll(".month-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest(".month-zone");
  if (zone) zone.classList.add("drag-over");
  event.preventDefault();
});
const endWishDrag = (event) => {
  if (!_wishDrag) return;
  const { id, el, moved } = _wishDrag;
  el.classList.remove("is-dragging");
  el.style.transform = "";
  document.querySelectorAll(".month-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  if (moved && event) {
    const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest(".month-zone");
    if (zone) {
      const monthStr = zone.dataset.month || "";
      updateTaskField(id, "targetMonth", monthStr ? Number(monthStr) : null);
    }
  }
  _wishDrag = null;
  if (moved) render();  // カード位置をstateどおりに正規化(ドロップ先が無ければ元の位置に戻る)
};
document.addEventListener("pointerup", endWishDrag);
document.addEventListener("pointercancel", () => {
  if (!_wishDrag) return;
  _wishDrag.el.classList.remove("is-dragging");
  _wishDrag.el.style.transform = "";
  document.querySelectorAll(".month-zone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  _wishDrag = null;
});

export {
  configureWish,
  getWishProject, getSubtasksOf, wishProgress, nextStepOf, wishLastActivity, isWishStagnant,
  wishGroupKey, wishGroupLabel, lifeAreaColor,
  renderWish, renderWishBoard, scrollWishBoardToCurrentMonth, renderWishBoardCard,
  renderWishCard, renderWishDetail, renderWishSubtask,
  addWish, toggleWishOpen, addWishSubtask, toggleWishSubtask, wishSubtaskToTasks,
  realizeWish, unrealizeWish, deleteWish,
  wishHasTodayBlock
};
