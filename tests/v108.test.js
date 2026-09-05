// v108 検証: Block保存モーダルの二重送信ガード + 繰り返しルール重複防止
// (2026-05-22実害・2026-07-15調査で確定した事故の再発防止、K承認2026-07-16)。
//
// 背景: 同一秒(11:43:00)に同タイトル「宣言(今日も最高の一日にします!)」の繰り返しルールが
// 2本生成され、日報に宣言ブロックが2カテゴリ重複記録された。iPad Safariでの保存ボタン
// 二重発火が最有力仮説。対策として saveBlockFromModal() に実行中フラグ+保存ボタンdisableの
// 再入防止ガードを追加し、createRecurrenceRule() に「同タイトル・同開始時刻のアクティブな
// (deletedでない)繰り返しルールが既にあれば作成しない」重複防止チェックを追加した。
//
// app.jsは type="module" で読み込まれるため、内部関数を直接呼び出すことはできない。
// そのため(a)は「同一内容の新規Block作成フローを最初からやり直す」形で二重発火を模した
// (実際の事故は2本の異なる繰り返しルールが生成されており、同一idの二重送信ではなく、
// 独立した新規Block作成が2回走った結果と推定されるため、この形が最も実態に近い)。
//
// (a) 同一内容(同タイトル・同時刻・同recurrenceKind)の新規Block作成を2回連続実行しても、
//     Block/繰り返しルールは1件しか作られない(2回目は重複ルール検知でスキップされ、
//     Block自体も作成されずトーストで通知される)
// (b) 同名・同開始時刻のアクティブな繰り返しルールが既にある状態で新規Block作成→ルールは
//     作成されず、トーストで通知される(既存ルールも変更されない)
// (c) 同名・同開始時刻の削除済み(deleted:true)ルールがある場合は誤ブロックせず、
//     新規Block+ルールが作成できる
// (d) 正常系(繰り返しなしの単発Block新規作成)の保存は従来どおり動く(回帰)
// (e) 既存Blockを編集モーダルで完了保存すると日報が再生成される
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  // v357修正(A-H1レビュー対応): exec内(embedded)は実績・計画どちらのモードでも.time-rowが
  // fill-gap-openへ配線されるようになったため、v335時点のワークアラウンド(execの1280px2ペイン
  // 右列=embedded&&mode="planned"経由でtimeline-new-blockを踏む)はもう使えない。本テストが
  // 検証したいのは保存モーダルの二重送信ガード自体(タイムラインの空き時間タップ配線ではない)
  // ため、旧timelineビュー(embedded=false、seed()時点で既にcurrentView="timeline")へ
  // 直接setViewする方式(tests/v357.test.js[1b]と同方式)へ戻した。
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  // v108: 他スイート同様、実時刻依存フレークを避けるためTODAYは実行時の「今日」10:00に固定する
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const DECLARE_TITLE = "宣言(今日も最高の一日にします!)";

  async function seed({ recurrences = [], blocks = [] } = {}) {
    await page.evaluate(({ KEY, recurrences, blocks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [];
      s.blocks = blocks;
      s.projects = [];
      s.recurrences = recurrences;
      s.selectedDate = TODAY;
      s.currentView = "timeline";
      s.timelineMode = "planned";
      s.reports[TODAY] = "STALE_BLOCK_MODAL_SAVE";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, recurrences, blocks, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // タイムラインの指定時刻の行をクリックして新規Block作成モーダルを開く。
  // .timeline-cards-area(left:60px〜)が.time-rowの上に重なるため、重ならない左端(x=20)を狙う。
  // v357修正(A-H1レビュー対応): seed()がcurrentView="timeline"のままreloadするため、
  // execへナビゲートし直さず旧timelineビュー(embedded=false)の.time-rowをそのまま使う
  // (execの右列は本バージョンからembedded&&計画モードでもfill-gap-openへ配線されるため、
  // ここでtimeline-new-blockを踏むには旧ビュー単体のままにする必要がある)。
  // 旧フローはexecへのnavクリック(persistLocalNoSchedule()を伴う)が副次的に、起動時
  // maintainRecurrences()がメモリ上にだけ実体化した繰り返しBlock群をlocalStorageへ反映していた
  // (stateNow()はlocalStorageを直接読むため、これが無いと[2]の「新しい系列は増えない」検証が
  // 見かけ上0件になる)。同じ役割を、同一ビューに留まったまま持てるtl-zoomボタン
  // (persistLocalNoSchedule()を呼ぶだけの無害な操作)で代替する。
  async function openNewBlockModal(minute) {
    await page.click('[data-action="tl-zoom"][data-zoom="1"]');
    await page.waitForTimeout(100);
    await page.click(`.time-row[data-action="timeline-new-block"][data-minute="${minute}"]`, { position: { x: 20, y: 15 } });
    await page.waitForTimeout(200);
  }

  async function fillAndSave({ title, recurrenceKind = "" }) {
    await page.fill('[data-modal-field="title"]', title);
    if (recurrenceKind) {
      await page.selectOption('[data-modal-field="recurrenceKind"]', recurrenceKind);
    }
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
  }

  async function toastText() {
    return ((await page.locator("#toast").textContent()) || "").trim();
  }

  function activeRule(state, id) {
    return (state.recurrences || []).find((r) => r.id === id);
  }

  // "毎日"等の繰り返しルールは maintainRecurrences() により未来31日分が即座に実体化される
  // ため、生Blockの件数(=1系列で数十件)ではなく「作られた系列(recurrenceGroupId)の数」で
  // 重複の有無を数える。系列に属さない単発Blockはidそのものを1系列として数える。
  function seriesCount(state) {
    const groupIds = new Set();
    let standalone = 0;
    (state.blocks || []).filter((b) => !b.deleted).forEach((b) => {
      if (b.recurrenceGroupId) groupIds.add(b.recurrenceGroupId);
      else standalone++;
    });
    return groupIds.size + standalone;
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 同一内容の新規Block作成を2回連続実行→Block/ルールは1件のみ
    // ============================================================
    console.log("[1] 同一内容(同タイトル・同時刻・繰り返し「毎日」)の新規Block作成を2回連続実行");
    await seed();
    await openNewBlockModal(9 * 60);
    await fillAndSave({ title: DECLARE_TITLE, recurrenceKind: "daily" });
    const s1a = await stateNow();
    check("1回目: 系列(Block群)が1つ作られる", seriesCount(s1a) === 1, JSON.stringify(s1a.blocks));
    check("1回目: 繰り返しルールが1件作られる", (s1a.recurrences || []).filter((r) => !r.deleted).length === 1, JSON.stringify(s1a.recurrences));

    // 2回目: 保存ボタン二重発火を模し、同一内容で「新規Block作成」を最初からやり直す
    await openNewBlockModal(9 * 60);
    await fillAndSave({ title: DECLARE_TITLE, recurrenceKind: "daily" });
    const s1b = await stateNow();
    check("2回目後も系列は1つのまま(重複作成されない)", seriesCount(s1b) === 1, JSON.stringify(s1b.blocks));
    check("2回目後も繰り返しルールは1件のまま(重複作成されない)", (s1b.recurrences || []).filter((r) => !r.deleted).length === 1, JSON.stringify(s1b.recurrences));
    check("2回目は重複検知のトーストが出る", (await toastText()).includes("既にあるため作成しませんでした"), await toastText());

    // ============================================================
    // (b) 同名・同開始時刻のアクティブな繰り返しルールが既にある→新規ルールは作られない
    // ============================================================
    console.log("[2] 既存のアクティブな繰り返しルールと同名・同時刻の新規Block作成→ルールは作成されない");
    await seed({
      recurrences: [{
        id: "existing-rule-1", title: DECLARE_TITLE, category: "ルーティン", taskId: "",
        kind: "daily", startTime: "09:00:00", endTime: "09:45:00", anchorDate: TODAY,
        expectedCharge: "", expectedDischarge: "", source: "", exceptionDates: [],
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }]
    });
    await openNewBlockModal(9 * 60);
    await fillAndSave({ title: DECLARE_TITLE, recurrenceKind: "weekly" });
    const s2 = await stateNow();
    check("既存アクティブルールがある場合、ルール総数は1件のまま", (s2.recurrences || []).filter((r) => !r.deleted).length === 1, JSON.stringify(s2.recurrences));
    check("既存ルール自体も変更されない(kindはdailyのまま)", activeRule(s2, "existing-rule-1")?.kind === "daily", JSON.stringify(activeRule(s2, "existing-rule-1")));
    // 既存ルールはseed時点で自動実体化されているため系列は1つのまま(新しい系列は増えない)
    check("新しい系列(Block群)は増えない(黙って握りつぶさない)", seriesCount(s2) === 1, JSON.stringify(s2.blocks));
    check("重複検知のトーストが出る", (await toastText()).includes("既にあるため作成しませんでした"), await toastText());

    // ============================================================
    // (c) 同名・同開始時刻の削除済みルールがある→誤ブロックせず新規作成できる
    // ============================================================
    console.log("[3] 同名・同時刻だが削除済みのルールがある場合は誤ブロックせず新規Block+ルールを作成できる");
    await seed({
      recurrences: [{
        id: "deleted-rule-1", title: DECLARE_TITLE, category: "", taskId: "",
        kind: "daily", startTime: "09:00:00", endTime: "09:45:00", anchorDate: TODAY,
        expectedCharge: "", expectedDischarge: "", source: "", exceptionDates: [],
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: true
      }]
    });
    await openNewBlockModal(9 * 60);
    await fillAndSave({ title: DECLARE_TITLE, recurrenceKind: "daily" });
    const s3 = await stateNow();
    check("削除済み同名ルールがあっても新規アクティブルールが作られる", (s3.recurrences || []).filter((r) => !r.deleted).length === 1, JSON.stringify(s3.recurrences));
    check("削除済みルール自体はそのまま残る(2件中1件は削除済み)", (s3.recurrences || []).length === 2, JSON.stringify(s3.recurrences));
    check("Blockの系列も1つ作られる", seriesCount(s3) === 1, JSON.stringify(s3.blocks));

    // ============================================================
    // (d) 正常系(繰り返しなしの単発Block新規作成)の保存は従来どおり動く(回帰)
    // ============================================================
    console.log("[4] 繰り返しなしの単発Block新規作成は従来どおり保存できる(回帰)");
    await seed();
    await openNewBlockModal(14 * 60);
    await fillAndSave({ title: "普通の単発Block" });
    const s4 = await stateNow();
    check("単発Blockが1件作られる", (s4.blocks || []).filter((b) => !b.deleted).length === 1, JSON.stringify(s4.blocks));
    check("繰り返しルールは作られない", (s4.recurrences || []).length === 0, JSON.stringify(s4.recurrences));
    check("保存成功のトーストが出る", (await toastText()) === "Blockを追加しました", await toastText());

    // ============================================================
    // (e) 既存Blockの編集完了保存→日報再生成
    // ============================================================
    console.log("[5] 既存Blockを編集モーダルで完了保存すると日報が再生成される");
    await seed({
      blocks: [{
        id: "modal-complete-report", taskId: "", date: TODAY, title: "編集完了の日報反映", category: "学習",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:45`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "",
        recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, carryCount: 0,
        isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }]
    });
    await page.click('.timeline-card[data-action="edit-block"][data-id="modal-complete-report"]');
    await page.check('[data-modal-field="completed"]');
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s5 = await stateNow();
    check("Block編集完了保存でcompletedになる", s5.blocks.find((b) => b.id === "modal-complete-report")?.completed === true);
    check("Block編集完了保存の直後に日報が再生成される",
      s5.reports[TODAY] !== "STALE_BLOCK_MODAL_SAVE" && s5.reports[TODAY].includes("編集完了の日報反映"), s5.reports[TODAY]);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
