// v156 検証: ADHD支援「①仕分けモード S3(Undo)」(CHANGES_v156.md参照)。
// v152(ボタン版)/v154(スワイプ)の三択実行後に5秒間のUndoトーストを出し、押すと直前の1操作を
// 完全に巻き戻す(スタック無し、次の操作で自動失効)。新しいトースト機構は作らず、v150の
// 完了トースト機構(showToastのアクションボタン+pointer-events対策)を汎用化して再利用した。
//
// 2系統レビュー(2026-07-28)対応版。ログ取り消しをslice(0,-1)方式から参照一致方式へ堅牢化
// (上限到達時に押し出された最古エントリの復元も含む)、5秒失効時に_triageUndoを明示null化
// (キーボードEnterでの遅延発動を防止)、showToast汎用経路のlabel必須化、直接showToast呼び出しへ
// _lastSaveErrorガードを追加。テストを4件追加(下記[10]-[13])。
//
// 検証項目:
//  [1]-[3] Block: 今日やる/手放す/延期 それぞれのUndo完全復元(フィールド単位の同値検証。
//          updatedAtのみ現在時刻へ更新される点を除く)+ 生成物(新規Block/Wish)の消滅 +
//          swipeTriageLog/migrationRitualLogの長さが元に戻る(該当エントリの取り消し)
//  [4]-[7] Wish: 今日やる(サブタスク無し/サブタスク有りの2ケース)/手放す(カスケード削除)/
//          延期(月またぎ年ロールオーバー込み) それぞれのUndo完全復元
//  [8] 5秒失効: 5秒経過後は#toastからhas-actionが外れ、実際のクリック位置(page.mouse)でも
//      Undoが発火しない(v150 A11のパターンを踏襲)
//  [9] 次の操作での失効 / 連続操作時の対象取り違えなし: 対象A(今日やる)→対象B(手放す)の順で
//      処理した後、表示中のUndo(Bのもの)をクリックしてもAには一切影響せず、Bだけが復元される
//  [10] 上限到達時のUndo: swipeTriageLogを200件で満たした状態でアクション→Undoすると、
//       200件のまま元の内容(押し出された最古エントリの復元込み)に一致する
//  [11] 5秒失効の完全化: タイマー満了後にボタンへキーボードでEnterを送っても(pointer-events
//       を経由しない経路)何も起きない(_triageUndoの明示null化を検証)
//  [12] スワイプ経由(via:"swipe")のUndo: ボタンだけでなくスワイプ確定分もUndoで完全復元する
//  [13] v150完了トーストとの混在: 仕分けのUndoトースト表示中に別Blockをホームで完了すると、
//       v150の「実績を編集」ボタンへ正しく置き換わり、古いUndoボタンは残らない
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

// TRIAGE_ACTION_COOLDOWN_MS(350ms)より確実に長い待機(別カードへのボタン操作間に必要)
const COOLDOWN_WAIT = 500;
// Undoトーストの表示時間(5000ms)を確実に跨ぐ待機
const UNDO_EXPIRE_WAIT = 5300;

// 2オブジェクトが updatedAt を除く全フィールドで一致するか(JSON化して比較。配列順は問わない
// フィールドを本テストでは使っていないため単純比較で足りる)
function sameExceptUpdatedAt(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updatedAt");
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

const mkBlock = (id, title, extra = {}) => ({
  id, taskId: "", date: YESTERDAY, title, category: "仕事", estimateMin: 20, carryCount: 0,
  migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false,
  createdAt: "2026-07-20T09:00:00", updatedAt: "2026-07-20T09:00:00", ...extra
});
const mkWish = (id, projectId, title, updatedAt, extra = {}) => ({
  id, projectId, parentTaskId: "", title, category: "", status: "todo",
  dueDate: "", description: "", lifeArea: "", motivation: "",
  targetYear: null, targetMonth: null, realized: false, realizedDate: "",
  createdAt: updatedAt, updatedAt, deleted: false, ...extra
});
// [13]用: v150.test.jsのplanBlock相当(ホーム画面のhome-flowに乗る当日Block)。
const planBlock = ({ id, title, startMin, minutes = 30 }) => {
  const pad2 = (n) => String(n).padStart(2, "0");
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
  return {
    id, taskId: "", date: TODAY, title, category: "",
    plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
    plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
    actualStartAt: "", actualEndAt: "",
    completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
    migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
    leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  };
};

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  page.on("dialog", async (d) => { failures++; console.log("  ❌ 予期しないネイティブダイアログ:", d.message()); await d.dismiss(); });
  await blockGithubApiByDefault(page);

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  await passGithubGate(page);

  const wishProjectId = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);
  check("Wish Project が既定で存在する", !!wishProjectId);

  const stateNow = () => page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const cardTitle = () => page.locator(".triage-card-title").textContent();
  const remainCount = async () => {
    const txt = await page.locator(".triage-panel > .muted").first().textContent();
    return Number((txt || "").match(/\d+/)?.[0]);
  };
  const clickChoice = (choice) => page.locator(`.triage-actions [data-choice="${choice}"]`).click();
  const clickUndo = () => page.locator('.toast-action[data-action="triage-undo"]').click();
  // [12]用: ドラッグヘルパー(tests/v154.test.jsと同じ手法。Chromiumはマウス入力もPointer
  // Eventsとして配送するため、page.mouseでスワイプ実配送経路をそのまま検証できる)
  async function swipe(dx, dy, { steps = 8 } = {}) {
    const box = await page.locator(".triage-card").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps });
    await page.mouse.up();
  }

  // 1シナリオ=1フィクスチャで完全に独立させる(state.tasks/state.blocksを毎回作り直し、
  // reloadしてからtriageに入る)。キュー並び順の副作用(v156のUndoはWish復元時にupdatedAtを
  // 現在時刻へ更新するため、キュー末尾へ回る仕様=decisions.md 2026-07-27)に振り回されないため。
  // fixture = { blocks: [...], tasks: [...], swipeTriageLog: [...] }(プレーンなデータのみ。
  // 関数はpage.evaluateを跨げないため、文字列化/再構築のような壊れやすい手段は使わない)。
  // swipeTriageLogは既定[](未指定時)、[10]の上限到達テストのみ明示的に200件で満たして渡す。
  async function seed(fixture) {
    await page.evaluate(({ KEY, wishProjectId, fixture }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = s.tasks.filter((t) => t.projectId !== wishProjectId);  // seedState()の初期デモWishを除去
      s.blocks = [];
      s.swipeTriageLog = fixture.swipeTriageLog || [];
      s.migrationRitualLog = fixture.migrationRitualLog || [];
      (fixture.blocks || []).forEach((b) => s.blocks.push(b));
      (fixture.tasks || []).forEach((t) => s.tasks.push(t));
      s.currentView = "wish";
      s.wishViewMode = "triage";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, wishProjectId, fixture });
    await page.reload();
    await page.waitForTimeout(500);
  }

  // ============================================================
  // [1] Block: 今日やる → Undo → 完全復元
  // ============================================================
  console.log("[1] Block「今日やる」のUndo: carryOverBlockで作られた新規Blockが消え、元Blockが完全復元する");
  await seed({ blocks: [mkBlock("blk-today", "Block今日Undo対象")] });
  check("先頭カードはBlock今日Undo対象", (await cardTitle()) === "Block今日Undo対象", await cardTitle());
  const before1 = (await stateNow()).blocks.find((b) => b.id === "blk-today");
  await clickChoice("today");
  await page.waitForTimeout(200);
  let snap = await stateNow();
  const migrated1 = snap.blocks.find((b) => b.id === "blk-today");
  check("(準備)今日やる実行直後はmigratedToが付与される", !!migrated1.migratedTo, JSON.stringify(migrated1));
  check("(準備)今日への複製Blockが作られる", snap.blocks.some((b) => b.title === "Block今日Undo対象" && b.date === TODAY));
  check("(準備)swipeTriageLogが1件になる", (snap.swipeTriageLog || []).length === 1);
  check("トーストに「元に戻す」ボタンが出る", await page.locator('.toast-action[data-action="triage-undo"][data-id="blk-today"]').count() === 1);
  await clickUndo();
  await page.waitForTimeout(200);
  snap = await stateNow();
  const after1 = snap.blocks.find((b) => b.id === "blk-today");
  check("元Blockが完全復元する(updatedAt以外の全フィールド一致)", sameExceptUpdatedAt(before1, after1), JSON.stringify({ before: before1, after: after1 }));
  check("今日への複製Blockが消える", !snap.blocks.some((b) => b.title === "Block今日Undo対象" && b.date === TODAY), JSON.stringify(snap.blocks));
  check("swipeTriageLogが0件に戻る(該当1件が取り消される)", (snap.swipeTriageLog || []).length === 0, JSON.stringify(snap.swipeTriageLog));
  check("Undo後、カードがキューへ戻る", await remainCount() === 1 && (await cardTitle()) === "Block今日Undo対象", await cardTitle());

  // ============================================================
  // [2] Block: 手放す → Undo → 完全復元
  // ============================================================
  console.log("[2] Block「手放す」のUndo: deleted:trueが解除され、migrationRitualLog/swipeTriageLogとも取り消される");
  await seed({ blocks: [mkBlock("blk-drop", "Block手放すUndo対象", { carryCount: 2 })] });
