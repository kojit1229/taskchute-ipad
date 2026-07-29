// src/features/timeline.js — app.js分割・段階4-6(タイムライン抽出・段階B: 描画系)。
// prep-stage4-timeline.md §7「段階B」①renderTimelineCard②renderEnergyGraph
// ③renderTimeline/renderTimelineView/renderTimelineRail/setTimelineMode。
// 監査P0(タイムライン絶対配置CSS・IME入力中の描画の密結合)指定領域のため、1関数ずつ
// v127/v50/v70/v150を都度再走して直列に抽出した(段階Aの src/features/timeline-layout.js
// と同じ抽出パターン)。
//
// 契約(dashboard.js/routine.js等と同じconfigureXxx(deps)パターン):
//   1. state はsrc/state/store.jsからlive binding importする(再代入はしない)。
//   2. escapeHTML/getCategoryColor/migrationBadgeHTML/leverageTypeMarkHTML/minutesOf/todayISO/
//      pad2/clamp/formatDisplayDate/renderHeader/renderDateBar/defaultBatterySettings/
//      batteryCurvePoints/conditionBudget/blocksForDate はまだapp.js側に残る汎用ヘルパーのため
//      configureTimeline(deps)による依存注入で受け取る。
//   3. assignBlocksToLanes/adjustLaneTopPositionsはsrc/features/timeline-layout.js(段階A)から
//      直接importする(routine.jsがsrc/storage/local.jsのpersistLocalNoScheduleを直接importする
//      のと同じ「stateを持たない葉モジュールは直接importしてよい」パターン。circular importなし)。
//   4. persistLocalNoScheduleも同じ理由でsrc/storage/local.jsから直接importする。
//   5. draftBarHTML/zeroSecThemeBarHTML/draftRejectReasonPickerHTML/renderDraftLayerは
//      _scheduleDraft/_draftDrag(下書きスケジュール機能。prep-stage4-timeline.md §5により
//      今回の抽出範囲外の別関心事)を直接読むapp.js残留関数のため、参照だけをdeps注入で渡す
//      (renderDraftLayerの移動はしない、routine.jsのanchorCandidateOptions等と同型)。
//   6. _scheduleDraft自体はapp.js側のモジュールプライベート変数のため、変数を露出させず
//      scheduleDraftActive()という1関数越しにdeps注入する(routine.js冒頭コメントの
//      isChainRunActive/navigateGardenPixelMonthと同じ「モジュール変数を直接晒さない」方式)。
//   7. renderTimelineRailが直接書き換えるDOM要素(#timelineRail/#app)は、app.js側のconst
//      (起動時に1回だけdocument.querySelectorした固定参照)のため、timelineRailEl/appRootElと
//      してdeps注入で渡す(参照自体は不変なのでstateのようなlive bindingは不要)。
//   8. renderの実体(全再描画エントリポイント)はapp.js残留のためdeps注入で受け取る。
//   9. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// updateBatteryTick(app.js残留、500ms周期ティッカー)は`.energy-graph-overlay`要素を
// renderEnergyGraph(...)のouterHTMLで直接パッチする(L18287付近)。この配線はapp.js側の
// import文を「function renderEnergyGraph(...){...}」から「import { renderEnergyGraph } from
// "./src/features/timeline.js"」へ切り替えるだけで、updateBatteryTick内の呼び出しコード自体は
// 1文字も変更していない(=配線の参照方向が変わるだけで、呼び出し箇所は無改修。
// prep-stage4-timeline.md §2「サイレント退行警告」への対応)。
//
// characterization test: tests/timeline-render-core.test.js。

import { state } from "../state/store.js";
import { persistLocalNoSchedule } from "../storage/local.js";
import { assignBlocksToLanes, adjustLaneTopPositions } from "./timeline-layout.js";
import { registerActions } from "../ui/actions.js";

// ---- 依存注入(configureTimeline) ----
let escapeHTML, getCategoryColor, migrationBadgeHTML, leverageTypeMarkHTML;
let minutesOf, todayISO, pad2, clamp, formatDisplayDate, computeProjectedEnd, resolveEstimateMin;
let renderHeader, renderDateBar;
let defaultBatterySettings, batteryCurvePoints, conditionBudget;
let draftBarHTML, zeroSecThemeBarHTML, draftRejectReasonPickerHTML, renderDraftLayer;
let scheduleDraftActive, render, blocksForDate, postponeBlockToNextDay;
let makeBlock, getOtherTask, openBlockEditor, saveState, isStaleBlock;
let timelineRailEl, appRootEl;

function configureTimeline(deps) {
  ({
    escapeHTML, getCategoryColor, migrationBadgeHTML, leverageTypeMarkHTML,
    minutesOf, todayISO, pad2, clamp, formatDisplayDate, computeProjectedEnd, resolveEstimateMin,
    renderHeader, renderDateBar,
    defaultBatterySettings, batteryCurvePoints, conditionBudget,
    draftBarHTML, zeroSecThemeBarHTML, draftRejectReasonPickerHTML, renderDraftLayer,
    scheduleDraftActive, render, blocksForDate, postponeBlockToNextDay,
    makeBlock, getOtherTask, openBlockEditor, saveState, isStaleBlock,
    timelineRailEl, appRootEl
  } = deps);
  // v181: app.js分割・段階5-8(timeline系dispatcher分岐の移行・後半)。timeline-modeのハンドラ
  // 実体(setTimelineMode)はこのファイルに既に存在するため、v173方式(feature本体側で
  // registerActionsを呼ぶ)で登録する。他のtimeline系39分岐はハンドラ実体がapp.js残留のため、
  // app.js自身が呼ぶregisterActions({...})(v174方式、v180/v181で分割移行)へ移行した。
  registerActions({
    "timeline-mode": ({ target }) => setTimelineMode(target.dataset.mode),
    "drift-postpone": ({ id }) => postponeBlockToNextDay(id),
    "time-comb-fill": ({ target }) => createBlockForActualGap(target)
  });
}

// ---- ここから抽出したコード本体(app.js:v174時点から移動。ロジック無改変) ----

function renderTimelineRail() {
  // v11: サイドバーの幅(折りたたみ時 56px、通常 216px)
  const sbWidth = state.settings?.sidebarCollapsed ? "56px" : "216px";
  // v10: タスクシュート(tasks)時のみ右タイムライン rail を表示
  if (state.currentView !== "tasks") {
    timelineRailEl.style.display = "none";
    appRootEl.style.gridTemplateColumns = `${sbWidth} minmax(0, 1fr)`;
    return;
  }
  timelineRailEl.style.display = "";
  appRootEl.style.gridTemplateColumns = `${sbWidth} minmax(0, 1fr) 360px`;
  const mode = state.timelineMode || "planned";
  timelineRailEl.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <h3>${formatDisplayDate(state.selectedDate)}</h3>
      <button class="btn ghost" data-action="nav" data-view="timeline">開く</button>
    </div>
    <div class="segmented" style="margin-bottom:10px">
      <button class="${mode === "planned" ? "active" : ""}" data-action="timeline-mode" data-mode="planned">予定</button>
      <button class="${mode === "actual" ? "active" : ""}" data-action="timeline-mode" data-mode="actual">実績</button>
    </div>
    ${renderTimeline({ compact: true, mode })}
  `;
}

function renderTimelineView() {
  const nowMinute = (new Date().getHours() + 1) * 60;
  const mode = state.timelineMode || "planned";
  return `
    ${renderHeader("時間軸とエネルギー", "タイムライン")}
    ${renderDateBar()}
    <div class="segmented" style="margin-bottom:10px">
      <button class="${mode === "planned" ? "active" : ""}" data-action="timeline-mode" data-mode="planned">📅 予定</button>
      <button class="${mode === "actual" ? "active" : ""}" data-action="timeline-mode" data-mode="actual">✅ 実績</button>
    </div>
    <div class="row" style="margin-bottom:10px; gap:8px; flex-wrap:wrap">
      <button class="btn primary" data-action="timeline-new-block" data-minute="${nowMinute}">+ 新規Block</button>
      ${!scheduleDraftActive() ? `<button class="btn" data-action="ai-schedule">📋 下書きスケジュール</button>` : ""}
      ${mode === "planned" && state.selectedDate === todayISO()
        ? `<button class="btn" data-action="bulk-approve-planned">✅ 予定通りだった(一括承認)</button>` : ""}
      <span class="muted" style="font-size:12px">空き時間タップで追加 / ○タップで完了登録 / ▶いま開始・■いま終了でワンタップ実績 / カードタップで編集 / 赤線は現在時刻</span>
    </div>
    ${draftBarHTML()}
    ${zeroSecThemeBarHTML()}
    ${draftRejectReasonPickerHTML()}
    ${driftPanelHTML()}
    ${timeCombHTML()}
    ${state.settings.timelineCategoryFilter ? `<div class="row" style="margin-bottom:10px; gap:8px; align-items:center">
      <span class="cat-chip" style="background:${getCategoryColor(state.settings.timelineCategoryFilter)}1f; color:${getCategoryColor(state.settings.timelineCategoryFilter)}; border:1px solid ${getCategoryColor(state.settings.timelineCategoryFilter)}66">カテゴリ: ${escapeHTML(state.settings.timelineCategoryFilter)}</span>
      <button class="btn ghost" data-action="timeline-clear-cat" style="font-size:12px">フィルタ解除 ✕</button>
    </div>` : ""}
    ${renderTimeline({ compact: false, mode })}
  `;
}

function activeEstimateMinutes(block, nowMinute) {
  const estimate = resolveEstimateMin(block);
  if (!block.actualStartAt) return estimate;
  return Math.max(0, estimate - Math.max(0, nowMinute - minutesOf(block.actualStartAt)));
}

function driftPanelHTML() {
  const today = todayISO();
  if (state.selectedDate !== today) return "";
  const allBlocks = blocksForDate(today);
  // v186レビュー(M-3): 当日Blockに終了予定(plannedEndAt)を持つものが1件も無ければ、
  // 「計画上の最終終了」自体が存在しないためDRIFTパネル自体を出さない。
  if (!allBlocks.some((b) => b.plannedEndAt)) return "";
  const remaining = allBlocks.filter((b) => !b.completed && !b.migratedTo);
  if (!remaining.length) return "";
  // v186レビュー(H-1): 「明日へ送る」候補選出の母集合だけを、既存carryableBlocks(app.js)と
  // 同じ3条件(ルーティン除外・繰り返し系列除外・中断/中止/削除タスクのBlock除外)へ絞る。
  // ズレ計算(下のplannedEnd/projectedEnd/drift)の母集合(allBlocks)自体は変えない。
  const candidatePool = remaining.filter((b) =>
    b.category !== "ルーティン" && !b.recurrenceGroupId && !isStaleBlock(b));
  // v186レビュー(P2-1): 日跨ぎBlock(plannedEndAtのminutesOfが開始より小=翌日)は
  // 選択日基準へ+1440正規化してからmaxを取る(正規化しないと日跨ぎBlockの終了が
  // 早朝扱いになり、計画上の最終終了を過小評価してしまう)。
  const plannedEnd = Math.max(0, ...allBlocks.filter((b) => b.plannedEndAt).map((b) => {
    const endMin = minutesOf(b.plannedEndAt);
    const startMin = b.plannedStartAt ? minutesOf(b.plannedStartAt) : null;
    return (startMin !== null && endMin < startMin) ? endMin + 1440 : endMin;
  }));
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const projectedEnd = computeProjectedEnd(today, nowMinute);
  const drift = projectedEnd - plannedEnd;
  const candidate = drift > 0
    ? candidatePool.map((block) => ({ block, minutes: activeEstimateMinutes(block, nowMinute) }))
        .filter((item) => item.minutes >= drift)
        .sort((a, b) => a.minutes - b.minutes
          || (a.block.plannedStartAt || "").localeCompare(b.block.plannedStartAt || "")
          || a.block.id.localeCompare(b.block.id))[0]
    : null;
  const driftLabel = `${drift > 0 ? "+" : ""}${drift}分`;
  return `<section class="panel drift-panel">
    <div class="home-plabel">DRIFT</div>
    <div class="drift-value">${driftLabel}</div>
    <div class="muted drift-note">今日の全Block(ルーティン・タイムライン由来を含む)で、着地予定と計画上の最終終了を比較。</div>
    ${candidate ? `<div class="drift-suggestion">
      <span>取り戻す案: ${escapeHTML(candidate.block.title)} (${candidate.minutes}分)</span>
      <button class="btn ghost" data-action="drift-postpone" data-id="${candidate.block.id}">明日へ送る</button>
    </div>` : `<div class="muted drift-suggestion">${drift > 0 ? "1件送るだけで収まる案はありません。" : "計画の範囲に収まっています。"}</div>`}
  </section>`;
}

function actualGaps(blocks) {
  const intervals = blocks.filter((b) => b.actualStartAt && b.actualEndAt)
    .map((b) => {
      const start = minutesOf(b.actualStartAt);
      let end = minutesOf(b.actualEndAt);
      // v186レビュー(P2-2): 日跨ぎ実績(終了<開始=翌日)は+1440正規化して区間として保持する
      // (正規化しないと終了が翌日早朝扱いになり、end<=startでフィルタされ実績区間が消える)。
      if (end < start) end += 1440;
      return [start, end];
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  intervals.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  // v186レビュー(P2-2): 隙間列挙自体は当日24:00(=1440分)までにクリップする(日跨ぎ実績で
  // 伸びた終了時刻をそのまま隙間の開始に使わない。1440分以降に完全に入る隙間は翌日側の
  // TIME COMBが扱う対象のためここでは出さない)。
  return merged.slice(1).map((item, index) => [merged[index][1], item[0]])
    .map(([start, end]) => [start, Math.min(end, 1440)])
    .filter(([start, end]) => start < 1440 && end - start >= 15);
}

function timeCombHTML() {
  const gaps = actualGaps(blocksForDate(state.selectedDate));
  return `<section class="panel time-comb">
    <div class="home-plabel">TIME COMB</div>
    <div class="muted time-comb-note">実績記録どうしの15分以上の隙間を表示します。</div>
    <div class="time-comb-list">${gaps.length ? gaps.map(([start, end]) => `
      <button type="button" class="time-comb-gap" data-action="time-comb-fill" data-start="${start}" data-end="${end}">
        <span>${pad2(Math.floor(start / 60))}:${pad2(start % 60)}–${pad2(Math.floor(end / 60))}:${pad2(end % 60)}</span>
        <strong>${end - start}分を補う</strong>
      </button>`).join("") : `<span class="muted">補う隙間はありません。</span>`}</div>
  </section>`;
}

function createBlockForActualGap(target) {
  const start = Number(target.dataset.start);
  const end = Number(target.dataset.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const date = state.selectedDate;
  const toDateTime = (minute) => `${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00`;
  const plannedStartAt = toDateTime(start);
  const plannedEndAt = toDateTime(end);
  // v186レビュー(M-2): 同じ隙間時間帯にplanned一致の既存Blockが既にあれば新規作成せず、
  // それをそのまま開く(連打・二重タップでの重複Block生成を防ぐ冪等化)。
  const existing = state.blocks.find((b) =>
    !b.deleted && b.date === date && b.plannedStartAt === plannedStartAt && b.plannedEndAt === plannedEndAt);
  if (existing) {
    render();
    openBlockEditor(existing.id);
    return;
  }
  const block = makeBlock({
    date,
    plannedStartAt,
    plannedEndAt,
    taskId: getOtherTask()?.id
  });
  state.blocks.push(block);
  // v186レビュー: 生成した時点で永続化する(addBlockと同じ契約。保存しないと
  // モーダルを保存せず閉じた場合や再読込でBlockが消える)
  saveState();
  // v186レビュー(M-2): 保存直後にrender()を呼び、モーダル背後のTIME COMB/タイムラインを
  // 新Block反映済みの状態にしてからエディタを開く。
  render();
  openBlockEditor(block.id);
}

function setTimelineMode(mode) {
  state.timelineMode = mode;
  persistLocalNoSchedule();  // v37: 表示モード切替は UI 操作(dataModifiedAt を汚さない)
  render();
}

function renderTimeline({ compact, mode = "planned" }) {
  const allBlocks = blocksForDate(state.selectedDate);
  // モードに応じてフィルタリングと表示位置決定
  let blocksToRender;
  if (mode === "actual") {
    blocksToRender = allBlocks.filter((b) => b.actualStartAt);
  } else {
    // 予定モード: 未完了 + plannedStartAt あり(完了済みは予定から消す)
    blocksToRender = allBlocks.filter((b) => b.plannedStartAt && !b.completed);
  }
  // v19: カテゴリ「ルーティン」は専用ルーティンタブで表示するためタイムラインから除外
  blocksToRender = blocksToRender.filter((b) => b.category !== "ルーティン");
  // v39: エネルギー構造分析からのカテゴリフィルタ(UI状態)
  const catFilter = state.settings.timelineCategoryFilter || "";
  if (catFilter) blocksToRender = blocksToRender.filter((b) => (b.category || "未分類") === catFilter);
  // v10: ズームレベル(state.timelineZoom: 1.0 / 2.0 / 4.0 のいずれか)
  const zoom = compact ? 1 : (state.timelineZoom || 1);
  const rowHeight = (compact ? 48 : 60) * zoom;
  const startHour = 5;
  const endHour = 24;
  const rows = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  // v10: レーン分割(PC 5、iPhone 3)
  const maxLanes = (typeof window !== "undefined" && window.innerWidth <= 720) ? 3 : 5;
  const laneAssignments = assignBlocksToLanes(blocksToRender, mode, maxLanes, rowHeight);
  // v10: 同レーン内で物理位置が重ならないよう top を調整
  const positioned = adjustLaneTopPositions(laneAssignments, rowHeight, startHour);
  // v10: ズームコントロール(コンパクトモードでは出さない)。
  // v148レビュー対応(項目9): エネルギー/バッテリー切替(v144→v148で追加)を別行の
  // .tl-zoom-controlsとして2段にしていたが、縦圧縮方針(v98以降の一貫方針)に合わせて
  // 1行(.tl-controls-divider区切り)へ統合する。
  const energyGraphMode = state.settings.timelineEnergyGraphMode === "battery" ? "battery" : "energy";
  const timelineControls = compact ? "" : `
    <div class="tl-zoom-controls">
      <button class="btn ghost ${zoom === 1 ? "active" : ""}" data-action="tl-zoom" data-zoom="1">1x</button>
      <button class="btn ghost ${zoom === 2 ? "active" : ""}" data-action="tl-zoom" data-zoom="2">2x</button>
      <button class="btn ghost ${zoom === 4 ? "active" : ""}" data-action="tl-zoom" data-zoom="4">4x</button>
      <span class="tl-controls-divider"></span>
      <button class="btn ghost ${energyGraphMode === "energy" ? "active" : ""}" data-action="tl-energy-mode" data-mode="energy">エネルギー</button>
      <button class="btn ghost ${energyGraphMode === "battery" ? "active" : ""}" data-action="tl-energy-mode" data-mode="battery">バッテリー</button>
    </div>
  `;

  // v19: 現在時刻ライン(本日表示時のみ)
  const now = new Date();
  const isToday = state.selectedDate === todayISO();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = isToday && nowMinutes >= startHour * 60 && nowMinutes < endHour * 60
    ? ((nowMinutes - startHour * 60) / 60) * rowHeight
    : null;
  const nowLine = nowTop !== null ? `
    <div class="now-line" style="position:absolute; top:${nowTop}px; left:0; right:0; height:0; border-top:2px solid var(--timeline-now-line, #FF3B30); z-index:5; pointer-events:none">
      <span style="position:absolute; left:0; top:-10px; background:var(--timeline-now-line, #FF3B30); color:#fff; font-size:10px; padding:1px 6px; border-radius:8px; font-weight:700">${pad2(now.getHours())}:${pad2(now.getMinutes())}</span>
    </div>
  ` : "";

  return `
    ${timelineControls}
    <div class="timeline" style="position:relative; min-height:${rowHeight * (endHour - startHour + 1)}px">
      ${rows.map((hour) => `
        <div class="time-row" data-action="timeline-new-block" data-minute="${hour * 60}"
             style="top:${(hour - startHour) * rowHeight}px;height:${rowHeight}px; cursor:pointer;">${String(hour).padStart(2, "0")}:00</div>
      `).join("")}
      <div class="timeline-cards-area" style="position:absolute; top:0; left:60px; right:100px; height:100%;">
        ${positioned.map((a) => renderTimelineCard(a, mode, maxLanes)).join("")}
      </div>
      ${nowLine}
      ${!compact && mode === "planned" ? renderDraftLayer(rowHeight, startHour) : ""}
      ${renderEnergyGraph(allBlocks, rowHeight, startHour, endHour, compact)}
    </div>
  `;
}

function renderTimelineCard(positioned, mode = "planned", maxLanes = 5) {
  const { block, startStr, endStr, lane, isOverflow, top, height, isShort, laneCount } = positioned;

  // v26: 横幅は「同時に重なっているブロック数(クラスタのレーン数)」で決まる。
  // 重なり無し → laneCount 1 → 全幅 / 2つ重なり → 2 → 50:50
  const lanes = Math.max(1, laneCount || 1);
  const widthPercent = 100 / lanes;
  const leftPercent = lane * widthPercent;

  const isActual = mode === "actual";
  // カテゴリ色を反映
  const catColor = block.category ? getCategoryColor(block.category) : null;
  const catStyle = catColor
    ? `background:${catColor}29; border-left:4px solid ${catColor}; color:${catColor};`
    : "";
  const overflowAttr = isOverflow ? `data-overflow="true"` : "";
  // v70: ワンタップ実績(▶いま開始 / ■いま終了)。既存○ボタン(完了登録モーダル)とは別の軽量アクション。
  //      実績モード・極小カード・完了済みは既存○ボタンと同じ理由で対象外。
  const started = Boolean(block.actualStartAt);
  const inProgress = started && !block.completed && !block.actualEndAt;
  const startEndBtn = (!isActual && !isShort && !block.completed)
    ? (!started
      ? `<button class="tl-start-btn" data-action="now-start" data-id="${block.id}" aria-label="いま開始">▶</button>`
      : (inProgress ? `<button class="tl-start-btn tl-end-btn" data-action="now-end" data-id="${block.id}" aria-label="いま終了">■</button>` : ""))
    : "";

  // v150(UI改善計画Phase4b・R3): 完了作法統一。○ボタンをtoggle-blockに一本化(実績は
  // 完了直後のトースト「実績を編集」から直す。旧: complete-block-with-actualで実績モーダルへ直行)。
  // v150レビュー対応(項目8): toggle-blockは双方向トグルのため、万一この位置に完了済みカードが
  // 描画される場合(現状の予定モードフィルタでは完了Blockは表示対象から外れるため到達しないが、
  // 将来の表示条件変更に備えた防御的対応)、グリフとaria-label/titleを「解除」とわかる表現へ
  // 切り替える。
  const completeBtnHTML = (!isActual && !isShort)
    ? (block.completed
      ? `<button class="tl-complete-btn done" data-action="toggle-block" data-id="${block.id}" aria-label="完了を解除" title="完了を解除">↺</button>`
      : `<button class="tl-complete-btn" data-action="toggle-block" data-id="${block.id}" aria-label="完了登録" title="完了登録">○</button>`)
    : "";
  // v186レビュー(M-1): migratedTo付きBlock(翌日へ送済)は一覧から消さず、控えめなバッジ+
  // 減光で「送済」と分かるようにする(最小実装)。
  const isMigrated = Boolean(block.migratedTo);
  const migratedBadgeHTML = isMigrated
    ? `<span class="migrated-badge" title="明日へ送りました">→送済</span>` : "";
  return `
    <div class="timeline-card ${block.completed ? "completed" : ""} ${isActual ? "is-actual" : ""} ${isShort ? "is-short" : ""} ${isMigrated ? "is-migrated" : ""}"
         ${overflowAttr}
         style="top:${top}px; height:${height}px; left:${leftPercent}%; width:calc(${widthPercent}% - 4px); ${catStyle}"
         data-action="edit-block" data-id="${block.id}">
      ${completeBtnHTML}
      ${startEndBtn}
      <div class="tl-card-body">
        <strong>${escapeHTML(block.title)}${migrationBadgeHTML(block.carryCount)}${leverageTypeMarkHTML(block.leverageType)}${migratedBadgeHTML}</strong>
      </div>
    </div>
  `;
}

function renderEnergyGraph(allBlocks, rowHeight, startHour, endHour, compact = false) {
  const morning = state.settings.morningEnergyLog[state.selectedDate] ?? 5;
  const totalHeight = rowHeight * (endHour - startHour + 1);
  const startMinute = startHour * 60;
  const endMinute = endHour * 60;

  // 完了 Block を actualEndAt 順にソート(実線=実績)
  const completed = allBlocks
    .filter((b) => b.completed && b.actualEndAt)
    .sort((a, b) => a.actualEndAt.localeCompare(b.actualEndAt));

  // 累積実績点列
  const realPoints = [{ minute: 0, value: morning }];
  let cumulative = morning;
  for (const b of completed) {
    cumulative += Number(b.charge || 0) - Number(b.discharge || 0);
    realPoints.push({ minute: minutesOf(b.actualEndAt), value: cumulative });
  }
  // 現在時刻まで延伸
  const today = todayISO();
  if (state.selectedDate === today) {
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    realPoints.push({ minute: nowMinute, value: cumulative });
  } else {
    // 過去日付なら 24:00 まで延伸
    realPoints.push({ minute: endMinute, value: cumulative });
  }

  // 予測点列(未完了 Block の planned ベース、expected_charge/discharge 使うが無ければ通常の charge/discharge を予測値として使う)
  const isToday = state.selectedDate === today;
  const futureBlocks = allBlocks
    .filter((b) => !b.completed && b.plannedEndAt)
    .sort((a, b) => a.plannedEndAt.localeCompare(b.plannedEndAt));
  const predictPoints = [];
  if (isToday && futureBlocks.length > 0) {
    let predict = cumulative;
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    predictPoints.push({ minute: nowMinute, value: predict });
    for (const b of futureBlocks) {
      const ec = Number(b.expectedCharge ?? b.charge ?? 0);
      const ed = Number(b.expectedDischarge ?? b.discharge ?? 0);
      predict += ec - ed;
      predictPoints.push({ minute: minutesOf(b.plannedEndAt), value: predict });
    }
  }

  // X 軸スケール: 値を -maxAbs 〜 +maxAbs にマップ
  const allValues = [...realPoints, ...predictPoints].map((p) => Math.abs(p.value));
  const maxAbs = Math.max(20, ...allValues);
  // SVG viewBox 100x{totalHeight}、中央 x=50
  const yOf = (minute) => Math.min(totalHeight, Math.max(0, ((minute - startMinute) / (endMinute - startMinute)) * totalHeight));
  const xOf = (value) => 50 + (value / maxAbs) * 45;

  const polyline = (pts, dashed) => {
    if (pts.length < 2) return "";
    const points = pts.map((p) => `${xOf(p.value)},${yOf(p.minute)}`).join(" ");
    return `<polyline points="${points}" stroke="${dashed ? '#7b61ff' : '#2fb96d'}" stroke-width="1.5" fill="none" stroke-linejoin="round" ${dashed ? 'stroke-dasharray="3,2"' : ""}/>`;
  };
  const circles = (pts, color) =>
    pts.map((p) => `<circle cx="${xOf(p.value)}" cy="${yOf(p.minute)}" r="1.8" fill="${color}"/>`).join("");

  const endValue = realPoints[realPoints.length - 1]?.value ?? morning;

  // v144: バッテリー実カーブの重ね描き(当日のみ。既存グラフは置き換えず追加するだけ)。
  // 既存グラフのx軸(-maxAbs〜+maxAbs、朝の主観エネルギーが起点)とはスケールの意味が違うため、
  // 独立した0〜上限のスケール(中央線=0・右端=上限)で描く。既存の起点/終点ラベルは無変更。
  // レビュー対応: conditionBudget()/blocksForDate()の再計算をbatteryCurvePoints側で
  // 繰り返さないよう、ここで1回だけ求めてopts経由で渡す(allBlocksは呼び出し元から既に
  // blocksForDate(state.selectedDate)として渡されている値をそのまま使い回す)。
  const battDef = defaultBatterySettings();
  const batteryCfg = state.settings.battery || battDef;
  const batteryMax = Number.isFinite(batteryCfg.max) ? batteryCfg.max : battDef.max;
  const nowMinuteForBattery = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const batteryPts = isToday
    ? batteryCurvePoints(state.selectedDate, nowMinuteForBattery, {
        budgetLevel: conditionBudget(state.selectedDate).level,
        blocks: allBlocks
      })
    : [];
  const battXOf = (value) => 50 + (clamp(value, 0, batteryMax) / (batteryMax || 1)) * 45;
  const batteryPolyline = batteryPts.length >= 2
    ? `<polyline class="battery-curve" points="${batteryPts.map((p) => `${battXOf(p.value)},${yOf(p.minute)}`).join(" ")}" stroke="#ff9500" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`
    : "";
  const batteryLast = batteryPts.length ? Math.round(batteryPts[batteryPts.length - 1].value) : null;

  // v148(UI改善計画Phase3-5): 「エネルギー/バッテリー」表示モード切替(state.settings.
  // timelineEnergyGraphMode、既定"energy")。v144までは-maxAbs〜+maxAbsのエネルギー軸と
  // 0〜batteryMaxのバッテリー軸という別スケールの2線を同じSVGへ重ねて描いていたが
  // (claude-ux-review v144詳細「読み分けるのは難しい」)、常に片方だけ描く1グラフ1スケールへ
  // 変える。データ算出(realPoints/predictPoints/batteryPts)自体は両モードで変えず、
  // 表示するpolyline/ラベルだけを切り替える(既存チャートは削除しない)。
  // v148レビュー対応(Codex指摘・項目4): 選択状態はグローバル設定(state.settings)なので、
  // 切替トグルの無い場所(compact=タスクシュート右レール)や、batteryPtsが常に空になる
  // 過去日(!isToday)でモードが"battery"のままだと、復帰手段の無い空グラフになってしまう。
  // その2条件では強制的にエネルギー系列へフォールバックする(設定自体は変更しない。
  // 通常のタイムライン画面へ戻れば選択済みのモードのまま表示される)。
  const graphMode = (state.settings.timelineEnergyGraphMode === "battery" && isToday && !compact) ? "battery" : "energy";
  const showEnergy = graphMode === "energy";
  const showBattery = graphMode === "battery";

  // レビュー対応: ティッカー(updateBatteryTick)が全体を差し替えられるよう、単一の
  // コンテナ要素にまとめて返す(既存の.timelineは position:relative のままなので、
  // 子要素個々のposition:absoluteの基準は変わらない=見た目は無変更)。
  return `
    <div class="energy-graph-overlay">
      <svg class="energy-svg" viewBox="0 0 100 ${totalHeight}" preserveAspectRatio="none"
           style="position:absolute; top:0; right:0; width:90px; height:${totalHeight}px; pointer-events:none;">
        <line x1="50" y1="0" x2="50" y2="${totalHeight}" stroke="var(--line)" stroke-width="0.4" stroke-dasharray="2,2"/>
        ${showEnergy ? polyline(realPoints, false) : ""}
        ${showEnergy ? polyline(predictPoints, true) : ""}
        ${showEnergy ? circles(realPoints, "#2fb96d") : ""}
        ${showBattery ? batteryPolyline : ""}
      </svg>
      ${showEnergy ? `
      <div style="position:absolute; top:2px; right:2px; font-size:9px; color:var(--faint); pointer-events:none;">エネルギー</div>
      <div style="position:absolute; top:16px; right:2px; font-size:9px; color:var(--faint); pointer-events:none;">起点 ${morning}</div>
      <div style="position:absolute; bottom:2px; right:2px; font-size:9px; color:var(--green-text); pointer-events:none;">終値 ${endValue >= 0 ? '+' : ''}${endValue}</div>
      ` : ""}
      ${showBattery ? `
      <div style="position:absolute; top:2px; right:2px; font-size:9px; color:var(--faint); pointer-events:none;">バッテリー</div>
      ${batteryLast !== null
        ? `<div class="battery-curve-label" style="position:absolute; top:16px; right:2px; font-size:9px; color:#ff9500; pointer-events:none;">🔋残量 ${batteryLast}</div>`
        : `<div style="position:absolute; top:16px; right:2px; font-size:9px; color:var(--faint); pointer-events:none;">データなし</div>`}
      ` : ""}
    </div>
  `;
}

export {
  configureTimeline,
  renderTimelineRail, renderTimelineView, setTimelineMode, renderTimeline,
  renderTimelineCard, renderEnergyGraph
};
