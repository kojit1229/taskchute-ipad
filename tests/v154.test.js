// v154 検証: ADHD支援「①仕分けモード S2(スワイプ)」(CHANGES_v154.md参照)。
// v152のボタン版仕分けモードに、Pointer Events統一のスワイプ操作を追加する。
// Chromiumはマウス入力もPointer Eventsとして配送するため、page.mouse(既存tests/v50.test.jsの
// ドラッグ検証と同じ手法)でpointerdown/move/up/cancelの実配送経路をそのまま検証できる。
// 多指シナリオ(2本目の指)はpage.mouseでは表現できないため、documentへdispatchEventで
// 合成PointerEvent列を直接発火させて検証する。
//
// 2026-07-28、2系統レビュー(FAIL)対応版。設計変更(監督者裁定): スワイプは左右のみ
// (右=今日やる/左=手放す)。上スワイプ=延期は廃止し延期はボタン専用にした
// (touch-action: none→pan-yへ変更、縦方向はネイティブスクロールに譲る)。
//
// 検証項目:
//  [1] 連続スワイプの飲み込み修正: 210ms間隔で異なる2枚を連続スワイプしても両方確定する
//      (クールダウンが同一カードidの二重発火防止に限定されたことの確認)
//  [2] スワイプ確定2方向: 右=今日やる / 左=手放す(swipeTriageLogにvia:"swipe")
//  [3] touch-action: pan-y が実DOMに適用されている / 上フリックは確定せず(延期はボタン専用)、
//      ページ自体は引き続きスクロールできる
//  [4] 閾値未満(30px)で離すとスナップバックし、state・swipeTriageLogが一切変化しない
//  [5] pointercancel: 閾値超のドラッグ中でもキャンセルされれば何も確定しない(完全リセット)
//  [6] 多指の誤確定防止: 2本目の指のpointerupでは確定しない(isPrimary+pointerId一致チェック)
//  [7] triageActionの成否(boolean)と原状復帰: 退場アニメ待機中に別経路(ボタン)で同じカードが
//      先に処理されると、保留中だったスワイプの確定はfalseで拒否され、カードの見た目が
//      原状復帰する(二重処理も起きない)
//  [8] ボタン併存: 延期はボタン専用のまま動作し(via:"button")、全件処理で仕分け完了になる
//  [9] reduced-motion: 退場アニメの待機(180ms)を待たずに極短時間(60ms)で確定する
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const now = new Date();
const YESTERDAY = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const TODAY = isoDate(now);

// TRIAGE_ACTION_COOLDOWN_MS(350ms)より確実に長い待機(同一カードへの二重発火防止テスト用)
const COOLDOWN_WAIT = 500;
// TRIAGE_SWIPE_EXIT_MS(180ms)より確実に長い待機(退場アニメ完了+triageAction実行を待つ)
const EXIT_WAIT = 400;
// ブラウザはel.style.transform代入時に単位を正規化する("0"→"0px")ため、値が実質ゼロかどうかで判定する
const isResetTransform = (t) => /^translate\(0(px)?,\s*0(px)?\)\s*rotate\(0deg\)$/.test(t || "");

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  // ============================================================
  // Part A: メインフロー(通常のモーション設定。モバイル幅)
  // ============================================================
  const ctxA = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { failures++; console.log("  ❌ [A] pageerror:", e.message); });
  pageA.on("dialog", async (d) => { failures++; console.log("  ❌ [A] 予期しないネイティブダイアログ:", d.message()); await d.dismiss(); });
  await blockGithubApiByDefault(pageA);

  await pageA.goto(`http://localhost:${PORT}/`);
  await pageA.waitForTimeout(600);
  await passGithubGate(pageA);

  const wishProjectId = await pageA.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);

  await pageA.evaluate(({ KEY, wishProjectId, YESTERDAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // seedState()の初期デモWishを除去し、キュー枚数アサーションをこのスイートのフィクスチャだけに揃える
    s.tasks = s.tasks.filter((t) => t.projectId !== wishProjectId);
    const mk = (id, title) => ({ id, taskId: "", date: YESTERDAY, title, category: "仕事", estimateMin: 20, carryCount: 0, migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false, createdAt: "2026-07-20T09:00:00", updatedAt: "2026-07-20T09:00:00" });
    s.blocks.push(
      mk("block-v154-fast1", "Fast1用Block"),
      mk("block-v154-fast2", "Fast2用Block"),
      mk("block-v154-today", "Today用Block"),
      mk("block-v154-drop", "Drop用Block"),
      mk("block-v154-multi", "Multi用Block"),
      mk("block-v154-button", "Button用Block")
    );
    s.currentView = "wish";
    s.wishViewMode = "triage";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId, YESTERDAY });
  await pageA.reload();
  await pageA.waitForTimeout(500);

  const cardTitle = () => pageA.locator(".triage-card-title").textContent();
  const remainCount = async () => {
    const txt = await pageA.locator(".triage-panel > .muted").first().textContent();
    return Number((txt || "").match(/\d+/)?.[0]);
  };
  const stateNow = () => pageA.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const cardTransform = () => pageA.locator(".triage-card").evaluate((el) => el.style.transform);

  // ドラッグヘルパー: カード中心からdx,dy分ポインタを動かす(mouse.down済みか否かは呼び出し側管理)
  async function swipe(dx, dy, { steps = 8, release = true } = {}) {
    const box = await pageA.locator(".triage-card").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await pageA.mouse.move(cx, cy);
    await pageA.mouse.down();
    await pageA.mouse.move(cx + dx, cy + dy, { steps });
    if (release) await pageA.mouse.up();
  }

  // 合成PointerEvent列を.triage-cardへ直接発火する(多指・pointercancelなど page.mouse では
  // 表現できないシナリオ用。bubbles:trueでdocumentレベルの委譲リスナーへ届く)
  async function dispatchPointerSeq(events) {
    await pageA.evaluate((events) => {
      const card = document.querySelector(".triage-card");
      events.forEach(({ type, ...init }) => {
        card.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
      });
    }, events);
  }

  console.log("[0] 初期キュー: 6枚、先頭はFast1用Block");
  check("残枚数が6枚", await remainCount() === 6, String(await remainCount()));
  check("先頭カードはFast1用Block", (await cardTitle()) === "Fast1用Block", await cardTitle());

  // ============================================================
  // [1] 連続スワイプの飲み込み修正: 210ms間隔で異なる2枚を連続スワイプしても両方確定する
  // ============================================================
  console.log("[1] 210ms間隔の連続スワイプ: 異なる2枚のスワイプが両方とも記録される(クールダウンが同一id限定になった修正)");
  await swipe(140, 0);  // Fast1用Block: 右スワイプ(今日やる)。180ms後に確定
  await pageA.waitForTimeout(210);  // この時点でFast1の確定は完了しているはず(180ms<210ms)。次カードが表示される
  await swipe(-140, 0);  // Fast2用Block(既に表示されているはず): 左スワイプ(手放す)。さらに180ms後に確定
  await pageA.waitForTimeout(EXIT_WAIT);
  let snap = await stateNow();
  const fast1 = snap.blocks.find((b) => b.id === "block-v154-fast1");
  const fast2 = snap.blocks.find((b) => b.id === "block-v154-fast2");
  check("Fast1(今日やる)が確定している(migratedTo付与)", !!fast1.migratedTo, JSON.stringify(fast1));
  check("Fast2(手放す)も確定している(deleted化)。旧実装なら350msクールダウンで飲み込まれていた",
    fast2.deleted === true, JSON.stringify(fast2));
  let log = snap.swipeTriageLog || [];
  check("Fast1のswipeTriageLog記録がある(via:swipe)",
    log.some((l) => l.targetId === "block-v154-fast1" && l.action === "today" && l.via === "swipe"));
  check("Fast2のswipeTriageLog記録もある(via:swipe、飲み込まれていない)",
    log.some((l) => l.targetId === "block-v154-fast2" && l.action === "drop" && l.via === "swipe"), JSON.stringify(log));
  check("残枚数が2件減って4枚になる", await remainCount() === 4, String(await remainCount()));
  check("次のカードはToday用Block", (await cardTitle()) === "Today用Block", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [2a] 右スワイプ = 今日やる。退場アニメの時間差(180ms未満ではまだ未確定)も確認する
  // ============================================================
  console.log("[2a] 右スワイプで「今日やる」が確定する(carryOverBlockと同じ結果、via:swipe)");
  await swipe(140, 0);
  await pageA.waitForTimeout(60);  // TRIAGE_SWIPE_EXIT_MS(180ms)未満 = まだ未確定のはず
  snap = await stateNow();
  check("退場アニメ中(60ms時点)はまだmigratedTo未設定(即時確定していない=アニメが効いている)",
    !snap.blocks.find((b) => b.id === "block-v154-today").migratedTo);
  await pageA.waitForTimeout(EXIT_WAIT - 60);
  snap = await stateNow();
  const todayOrig = snap.blocks.find((b) => b.id === "block-v154-today");
  check("元Blockにmigratedtoが付与される", !!todayOrig.migratedTo, JSON.stringify(todayOrig));
  const todayNew = snap.blocks.find((b) => b.title === "Today用Block" && b.date === TODAY);
  check("今日への複製Blockが作られる", !!todayNew, JSON.stringify(snap.blocks.map((b) => b.title + "/" + b.date)));
  check("残枚数が3枚に減る", await remainCount() === 3, String(await remainCount()));
  check("次のカードはDrop用Block", (await cardTitle()) === "Drop用Block", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [2b] 左スワイプ = 手放す
  // ============================================================
  console.log("[2b] 左スワイプで「手放す」が確定する(deleted化+migrationRitualLog avoid、via:swipe)");
  await swipe(-140, 0);
  await pageA.waitForTimeout(EXIT_WAIT);
  snap = await stateNow();
  const dropBlock = snap.blocks.find((b) => b.id === "block-v154-drop");
  check("Blockがdeleted化される", dropBlock.deleted === true, JSON.stringify(dropBlock));
  check("migrationRitualLogにavoidとして記録される",
    (snap.migrationRitualLog || []).some((l) => l.blockId === "block-v154-drop" && l.choice === "avoid"));
  check("残枚数が2枚に減る", await remainCount() === 2, String(await remainCount()));
  check("次のカードはMulti用Block", (await cardTitle()) === "Multi用Block", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // 以降はすべて「Multi用Block」に対する、確定に至らない一連の操作(残枚数は2枚のまま推移)
  // ============================================================

  console.log("[3a] touch-action が pan-y になっている(縦スクロールと両立させる設計変更)");
  const touchAction = await pageA.locator(".triage-card").evaluate((el) => getComputedStyle(el).touchAction);
  check(".triage-card の touch-action が pan-y", touchAction === "pan-y", touchAction);

  console.log("[3b] 上フリックは確定しない(延期はボタン専用へ変更)。ページ自体は引き続きスクロールできる");
  // ページは読み込み直後、既に最下部(scrollY=最大値)にいる(レイアウト都合の既存挙動でv154とは無関係)。
  // 「スクロールできる」ことを検証するため、まず先頭へ戻してから計測する。
  await pageA.evaluate(() => window.scrollTo(0, 0));
  await pageA.waitForTimeout(100);
  const scrollBefore = await pageA.evaluate(() => window.scrollY);
  await swipe(0, -140);  // 上方向(縦優位)。新仕様では候補なし=何も起きない
  await pageA.waitForTimeout(EXIT_WAIT);
  snap = await stateNow();
  const multiBlock1 = snap.blocks.find((b) => b.id === "block-v154-multi");
  check("上フリックでは何も確定しない(deleted/migratedTo/Wish化のいずれも起きない)",
    multiBlock1.deleted === false && !multiBlock1.migratedTo, JSON.stringify(multiBlock1));
  check("上フリック後も残枚数は2枚のまま", await remainCount() === 2, String(await remainCount()));
  await pageA.mouse.wheel(0, 400);
  await pageA.waitForTimeout(150);
  const scrollAfter = await pageA.evaluate(() => window.scrollY);
  check("ページは引き続き縦スクロールできる(touch-action:pan-yでスクロールが奪われていない)",
    scrollAfter > scrollBefore, `${scrollBefore} -> ${scrollAfter}`);
  await pageA.evaluate(() => window.scrollTo(0, 0));

  console.log("[3c] 閾値未満(30px)の横スワイプはスナップバックし、state・swipeTriageLogが変化しない");
  const logCountBefore3c = ((await stateNow()).swipeTriageLog || []).length;
  await swipe(30, 0);
  await pageA.waitForTimeout(EXIT_WAIT);
  check("カードのtransformが元位置へ戻る", isResetTransform(await cardTransform()), await cardTransform());
  check("残枚数は2枚のまま(未確定)", await remainCount() === 2, String(await remainCount()));
  snap = await stateNow();
  check("Multi用Blockはdeleted/migratedTo化されていない",
    snap.blocks.find((b) => b.id === "block-v154-multi").deleted === false
    && !snap.blocks.find((b) => b.id === "block-v154-multi").migratedTo);
  check("swipeTriageLogは増えていない(閾値未満)", (snap.swipeTriageLog || []).length === logCountBefore3c);

  console.log("[3d] pointercancelで閾値超のドラッグ中でも完全リセットされ、何も確定しない");
  await dispatchPointerSeq([
    { type: "pointerdown", pointerId: 1, isPrimary: true, clientX: 100, clientY: 400 },
    { type: "pointermove", pointerId: 1, isPrimary: true, clientX: 240, clientY: 400 },  // 閾値超
    { type: "pointercancel", pointerId: 1, isPrimary: true, clientX: 240, clientY: 400 }
  ]);
  await pageA.waitForTimeout(EXIT_WAIT);
  check("残枚数は2枚のまま(キャンセルなので未確定)", await remainCount() === 2, String(await remainCount()));
  snap = await stateNow();
  check("Multi用Blockはdeleted/migratedTo化されていない(pointercancelでは一切state変更しない)",
    snap.blocks.find((b) => b.id === "block-v154-multi").deleted === false
    && !snap.blocks.find((b) => b.id === "block-v154-multi").migratedTo);
  check("swipeTriageLogは増えていない(pointercancel)", (snap.swipeTriageLog || []).length === logCountBefore3c);
  check("カードのtransformがリセットされる", isResetTransform(await cardTransform()), await cardTransform());

  console.log("[3e] 多指の誤確定防止: 2本目の指のpointerupでは確定しない(isPrimary+pointerId一致チェック)");
  await dispatchPointerSeq([
    { type: "pointerdown", pointerId: 1, isPrimary: true, clientX: 100, clientY: 400 },
    { type: "pointermove", pointerId: 1, isPrimary: true, clientX: 240, clientY: 400 },  // 1本目(主指)で閾値超まで移動
    { type: "pointerdown", pointerId: 2, isPrimary: false, clientX: 105, clientY: 405 },  // 2本目の指が触れる(isPrimary:falseのため無視される想定)
    { type: "pointerup", pointerId: 2, isPrimary: false, clientX: 400, clientY: 400 }  // 2本目が先に離れる(閾値を大きく超える位置。誤確定すれば「今日やる」が発火してしまう)
  ]);
  await pageA.waitForTimeout(EXIT_WAIT);
  snap = await stateNow();
  check("2本目の指のupでは何も確定しない(migratedTo等が付与されない)",
    snap.blocks.find((b) => b.id === "block-v154-multi").deleted === false
    && !snap.blocks.find((b) => b.id === "block-v154-multi").migratedTo, JSON.stringify(snap.blocks.find((b) => b.id === "block-v154-multi")));
  check("残枚数は2枚のまま(2本目の指では未確定)", await remainCount() === 2, String(await remainCount()));
  // 1本目(主指)を閾値未満の位置まで戻してから離し、ドラッグ自体を後始末する(スナップバック)
  await dispatchPointerSeq([
    { type: "pointermove", pointerId: 1, isPrimary: true, clientX: 110, clientY: 400 },
    { type: "pointerup", pointerId: 1, isPrimary: true, clientX: 110, clientY: 400 }
  ]);
  await pageA.waitForTimeout(EXIT_WAIT);
  check("後始末後もカードのtransformがリセットされる(1本目のスナップバック)", isResetTransform(await cardTransform()), await cardTransform());
  check("後始末後も残枚数は2枚のまま", await remainCount() === 2, String(await remainCount()));

  // ============================================================
  // [4] triageActionの成否(boolean)と原状復帰: 退場アニメ待機中に別経路(ボタン)で同じカードが
  //     先に処理されると、保留中だったスワイプの確定はfalseで拒否され、カードの見た目が
  //     原状復帰する(二重処理も起きない)。この時点の現在カードは引き続きMulti用Block
  // ============================================================
  console.log("[4] 退場アニメ待機中にボタンで先に確定すると、保留中のスワイプはfalseで拒否されカードが原状復帰する(二重処理なし)");
  const staleCardHandle = await pageA.locator(".triage-card").elementHandle();
  await swipe(140, 0);  // Multi用Block: 右スワイプ(今日やる)。180ms後にtriageAction("today")が予定される
  // 180ms未満のうちに、同じカードをボタン(手放す)で先に確定させる。Playwrightのlocator.click()は
  // actionability待機(要素の安定性チェック等)のぶん実際の発火が数十〜百数十ms遅れることがあり
  // 180msの窓に対して不安定だったため、page.evaluate内でDOMのclick()を直接呼びレイテンシを排除する
  // (実測: locator.click()はケースにより180ms超まで遅延しうるが、直接click()は数ms以内に安定して発火した)。
  await pageA.evaluate(() => {
    document.querySelector('.triage-actions [data-choice="drop"]').click();
  });
  await pageA.waitForTimeout(EXIT_WAIT);
  snap = await stateNow();
  const multiFinal = snap.blocks.find((b) => b.id === "block-v154-multi");
  check("ボタンの「手放す」が成立する(deleted化)", multiFinal.deleted === true, JSON.stringify(multiFinal));
  check("保留中だったスワイプの「今日やる」は二重処理されない(migratedTo未設定)", !multiFinal.migratedTo, JSON.stringify(multiFinal));
  log = snap.swipeTriageLog || [];
  const multiLogs = log.filter((l) => l.targetId === "block-v154-multi");
  check("swipeTriageLogにblock-v154-multiの記録は1件だけ(via:buttonのみ、swipe分は記録されない)",
    multiLogs.length === 1 && multiLogs[0].via === "button" && multiLogs[0].action === "drop", JSON.stringify(multiLogs));
  const staleTransform = await staleCardHandle.evaluate((el) => el.style.transform);
  check("拒否されたスワイプの古いカード要素はtransformが原状復帰する", isResetTransform(staleTransform), staleTransform);
  const staleOpacity = await staleCardHandle.evaluate((el) => el.style.opacity);
  check("拒否されたスワイプの古いカード要素はopacityも原状復帰する(空文字に戻る)", staleOpacity === "", JSON.stringify(staleOpacity));
  check("残枚数が1枚に減る(Multi用Blockが処理された)", await remainCount() === 1, String(await remainCount()));
  check("次のカードはButton用Block", (await cardTitle()) === "Button用Block", await cardTitle());

  await pageA.waitForTimeout(COOLDOWN_WAIT);

  // ============================================================
  // [5] ボタン併存: 延期はボタン専用のまま動作する(via:button)。全4件処理完了で仕分け完了になる
  // ============================================================
  console.log("[5] ボタン併存: 延期はボタン専用として引き続き動作し(via:button)、全件処理で仕分け完了になる");
  await pageA.locator('.triage-actions [data-choice="defer"]').click();
  await pageA.waitForTimeout(200);
  snap = await stateNow();
  log = snap.swipeTriageLog || [];
  check("延期のボタン確定はvia:buttonで記録される",
    log.some((l) => l.targetId === "block-v154-button" && l.action === "defer" && l.via === "button"), JSON.stringify(log));
  check("残枚数が0枚になり「仕分け完了」が表示される(全6件処理完了)",
    await pageA.locator(".triage-actions").count() === 0);
  check("「仕分け完了 🎉」が表示される", (await pageA.locator(".triage-panel").textContent() || "").includes("仕分け完了"));

  await ctxA.close();

  // ============================================================
  // Part B: prefers-reduced-motion:reduce のコンテキストでは即時確定する
  // ============================================================
  console.log("[Part B] prefers-reduced-motion:reduce では退場アニメを待たず極短時間(60ms)で確定する");
  const ctxB = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { failures++; console.log("  ❌ [B] pageerror:", e.message); });
  pageB.on("dialog", async (d) => { failures++; console.log("  ❌ [B] 予期しないネイティブダイアログ:", d.message()); await d.dismiss(); });
  await blockGithubApiByDefault(pageB);
  await pageB.goto(`http://localhost:${PORT}/`);
  await pageB.waitForTimeout(600);
  await passGithubGate(pageB);

  const wishProjectIdB = await pageB.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);

  await pageB.evaluate(({ KEY, wishProjectId, YESTERDAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = s.tasks.filter((t) => t.projectId !== wishProjectId);
    s.blocks.push({ id: "block-v154-reduced", taskId: "", date: YESTERDAY, title: "Reduced用Block", category: "仕事", estimateMin: 20, carryCount: 0, migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false, createdAt: "2026-07-20T09:00:00", updatedAt: "2026-07-20T09:00:00" });
    s.currentView = "wish";
    s.wishViewMode = "triage";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId: wishProjectIdB, YESTERDAY });
  await pageB.reload();
  await pageB.waitForTimeout(500);

  const reducedMotionActive = await pageB.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  check("コンテキストがprefers-reduced-motion:reduceを報告する(前提確認)", reducedMotionActive === true);

  const boxB = await pageB.locator(".triage-card").boundingBox();
  await pageB.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
  await pageB.mouse.down();
  await pageB.mouse.move(boxB.x + boxB.width / 2 + 140, boxB.y + boxB.height / 2, { steps: 8 });
  await pageB.mouse.up();
  await pageB.waitForTimeout(60);  // TRIAGE_SWIPE_EXIT_MS(180ms)より大幅に短い
  const snapB = await pageB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const reducedBlock = snapB.blocks.find((b) => b.id === "block-v154-reduced");
  check("reduced-motion時は60ms以内に確定している(退場アニメの待機をスキップ)", !!reducedBlock.migratedTo, JSON.stringify(reducedBlock));
  const logB = snapB.swipeTriageLog || [];
  check("reduced-motion時もvia:swipeで記録される",
    logB.some((l) => l.targetId === "block-v154-reduced" && l.action === "today" && l.via === "swipe"), JSON.stringify(logB));

  await ctxB.close();

  console.log(failures === 0 ? "\n✅ v154 ALL PASS" : `\n❌ v154: ${failures} 件失敗`);
  await browser.close();
  server.close();
  process.exit(failures === 0 ? 0 : 1);
})();
