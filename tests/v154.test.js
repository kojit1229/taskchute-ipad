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
