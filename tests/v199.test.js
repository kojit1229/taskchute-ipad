// v199 検証: 「📋 下書きスケジュール」(runAiSchedule)を、当日タスクシュート登録済みBlock
//   (未着手のみ)の空き時間への決定論的な重複なし再配置へ変更したことの検証。
//   WBS未Block化タスクの新規配置案はv299で削除済み。本スイートは維持対象の
//   runAiSchedule(data-action="ai-schedule")だけを対象にする。
//
// (a) 可動/固定の選別: ルーティン・完了済み・着手済み・timeline由来のBlockは動かない
//     (軽微7も同居: 配置済み項目が固定Blockと重ならないことを直接assertion化)
// (b) 再配置後は項目間の重複がゼロ(元は同時刻に積み重なっていた候補でも)
// (c) 空き時間不足のBlockはskipped(タスク過多。2026-08-11: 予定長15〜240クランプに伴い3件fixtureへ更新)
// (d) confirmで既存Blockの時刻更新+updatedAt bump・新規Block非生成
//     (軽微8も同居: migratedTo/carryCountが確定後も不変であることを直接assertion化)
// (e) 配置ウィンドウ: 仕事Block=平日9-18のみ / プライベート=8-21のみ、休日の仕事Blockはskipped
// (f) タスク過多時、draft barに警告行が出る
// (g) 重大1改訂(2026-08-11 r2裁定): skipが1件でも出たら元区間を固定占有に加えて配置全体を
//     最初からやり直す「再スタートループ」。レビュー報告書の実機プローブ2シナリオ
//     (g1=同時刻積み上げ3件+タスク過多、g2=休日仕事Block+私用7時台)をそのままfixtureにし、
//     一手先取り穴(skipより前に処理されたBlockが元区間を先取りする)が塞がれたことを確認
// (h) 重大2修正: plannedEndAt欠落の固定Blockはstart+見積分を占有として扱う(その上に配置しない)
// (i) 重大3修正: 可動Blockの日跨ぎ長さ(24:00−start)+end、および巨大な予定長の15〜240クランプ
// (j) 中3修正: 休日の仕事Blockのみskipされた日は、警告行/トーストが「タスク過多」と誤表示せず
//     「仕事タスクは平日9-18のみ」の文言になる
// (k) 候補0件時のトースト文言(仕様8番、ボーナス確認)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction } = require("./helpers");

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
  // v335(§C追随): 旧timeline/tasksへの直接navが無くなったため、execの1280px以上2ペイン
  // (右列=renderTimelineView、計画モード=state.timelineMode連動)経由で下書き
  // (.draft-block-title等)を可視化する。1100pxのままだと計画モード単一列はタスク一覧のみで
  // 下書きが乗るタイムライングリッドが出ない。
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // 2026-08-10は月曜(平日)。isToday=trueの場合はnowFloor(=現在時刻15分切上げ)がwindowより
  // 効くため、ウィンドウ境界だけを見たいシナリオ(e)ではisToday=falseになる別日(DATE2/SAT)を使う。
  const now0 = new Date(2026, 7, 10, 10, 0, 0);
  const TODAY = isoDate(now0);       // 2026-08-10(月・平日)
  const DATE2 = "2026-08-12";        // 水(平日)・today(2026-08-10)とは別日でisToday=falseにする
  const SAT = "2026-08-15";          // 土(休日)

  function planBlock({ id, date, title, taskId = "", category = "", startMin, endMin, completed = false, actualStartAt = "", source = "" }) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: startMin != null ? `${date}T${hhmm(startMin)}` : "",
      plannedEndAt: endMin != null ? `${date}T${hhmm(endMin)}` : "",
      actualStartAt, actualEndAt: "",
      completed, charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "",
      estimateMin: null, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", carryCount: 0, leverageType: "", interruptions: [], incompleteReason: null,
      orderIndex: 0, createdAt: `${date}T00:00:00`, updatedAt: `${date}T00:00:00`, deleted: false,
      source
    };
  }
  function wbsTask(id, title, extra = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, ...extra
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  // v85仕様(app.js:17680): 起動時は必ずselectedDateをtodayISO()へ強制する(永続化された
  // selectedDateをそのまま初期表示に使わない)。そのため date!==TODAY のシナリオは、
  // localStorageへ直接書いても reload で today に巻き戻る — セッション中のユーザー操作と同じ
  // データピッカー(`[data-date-picker]`)経由でstate.selectedDateを移動させる。
  async function seed({ blocks = [], tasks = [], projects = [testProject()], date = TODAY } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.aiScheduleHistory = [];
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects });
    await page.reload();
    await page.waitForTimeout(500);
    // v335(§C追随): currentViewは直接seedで既に"tasks"(旧ビューはrender()の分岐に残っている
    // ため直接setViewしても壊れない)なので、この時点で追加のnavクリックは不要(旧「タスク
    // シュート」nav項目はサイドバーから撤去済み)。
    if (date !== TODAY) {
      await page.fill('[data-date-picker]', date);
      await page.waitForTimeout(300);
    }
  }

  async function runAiSchedule() {
    // v285: 本番UIは廃止済み。残存actionの内部契約をテスト専用delegation入口から検証する。
    // v335(§C追随): action本体側がsetView("exec")(計画モード)へ寄せるため、事前navは
    // execで十分(旧timeline直行navは撤去済み)。
    await page.click('[data-action="nav"][data-view="exec"]');
    await page.waitForTimeout(150);
    await dispatchRegisteredAction(page, "ai-schedule");
    await page.waitForTimeout(500);
  }

  async function draftTitles() {
    return page.locator(".draft-block-title").allTextContents();
  }
  async function draftTimes() {
    const els = await page.locator(".draft-block-time").allTextContents();
    return els.map((t) => {
      const m = t.match(/(\d{2}):(\d{2})〜(\d{2}):(\d{2})\((\d+)分\)/);
      if (!m) return null;
      return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]), minutes: Number(m[5]) };
    }).filter(Boolean);
  }
  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  // app.jsのminutesOf()と同じ正規表現でHH:MMを抽出する(normalizeStateが未確定Blockに
  // 秒(":00")を補完することがあり、末尾5文字の単純sliceでは秒あり/秒なしが混在すると誤判定になる)。
  function minOf(dt) {
    const m = /T(\d{1,2}):(\d{2})/.exec(dt || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  // blocks配列から、plannedStartAt/plannedEndAtが両方とも解釈できるペアだけを対象に
  // 区間重複([start,end)同士の交差)をすべて洗い出す。
  function findOverlaps(blocks) {
    const overlaps = [];
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i], b = blocks[j];
        const as = minOf(a.plannedStartAt), ae = minOf(a.plannedEndAt), bs = minOf(b.plannedStartAt), be = minOf(b.plannedEndAt);
        if (as === null || ae === null || bs === null || be === null) continue;
        if (as < be && bs < ae) overlaps.push([a.title, b.title]);
      }
    }
    return overlaps;
  }

  try {
    await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 可動/固定の選別
    // ============================================================
    console.log("[a] 可動/固定の選別: ルーティン・完了済み・着手済み・timeline由来は動かない");
    await seed({
      tasks: [
        wbsTask("task-move", "movable移動対象"),
        wbsTask("task-comp", "completed完了済み"),
        wbsTask("task-started", "started着手済み")
      ],
      blocks: [
        planBlock({ id: "blk-move", date: TODAY, title: "movable移動対象", taskId: "task-move", startMin: 9 * 60, endMin: 9 * 60 + 30 }),
        planBlock({ id: "blk-routine", date: TODAY, title: "ルーティン固定", category: "ルーティン", startMin: 12 * 60, endMin: 12 * 60 + 30 }),
        planBlock({ id: "blk-comp", date: TODAY, title: "completed完了済み", taskId: "task-comp", completed: true, startMin: 13 * 60, endMin: 13 * 60 + 30 }),
        planBlock({ id: "blk-started", date: TODAY, title: "started着手済み", taskId: "task-started", actualStartAt: `${TODAY}T14:00`, startMin: 14 * 60, endMin: 14 * 60 + 30 }),
        planBlock({ id: "blk-timeline", date: TODAY, title: "timeline固定", source: "timeline", startMin: 15 * 60, endMin: 15 * 60 + 30 })
      ]
    });
    await runAiSchedule();
    const titlesA = await draftTitles();
    check("可動Blockのみ下書きに現れる(1件)", titlesA.length === 1 && titlesA[0].includes("movable移動対象"), JSON.stringify(titlesA));
    check("ルーティン/完了済み/着手済み/timeline由来は下書きに現れない",
      !titlesA.some((t) => t.includes("ルーティン固定") || t.includes("completed完了済み") || t.includes("started着手済み") || t.includes("timeline固定")),
      JSON.stringify(titlesA));
    // 軽微7: 配置済み項目が固定Block(ルーティン/完了/着手済み/timeline)と重ならないことを直接確認
    const timesA = await draftTimes();
    const fixedRangesA = [[12 * 60, 12 * 60 + 30], [13 * 60, 13 * 60 + 30], [14 * 60, 14 * 60 + 30], [15 * 60, 15 * 60 + 30]];
    const overlapsFixedA = timesA.some((it) => fixedRangesA.some(([fs, fe]) => it.start < fe && fs < it.end));
    check("配置済み項目が固定Block(ルーティン等)の時間帯と重ならない(軽微7)", !overlapsFixedA, JSON.stringify({ timesA, fixedRangesA }));

    // ============================================================
    // (b) 再配置後は項目間の重複がゼロ
    // ============================================================
    console.log("[b] 再配置後は項目間の重複がゼロ(元は同時刻に積み重なっていた候補)");
    await seed({
      tasks: [wbsTask("task-b1", "重複解消候補A"), wbsTask("task-b2", "重複解消候補B"), wbsTask("task-b3", "重複解消候補C")],
      blocks: [
        planBlock({ id: "blk-b1", date: TODAY, title: "重複解消候補A", taskId: "task-b1", startMin: 9 * 60, endMin: 9 * 60 + 30 }),
        planBlock({ id: "blk-b2", date: TODAY, title: "重複解消候補B", taskId: "task-b2", startMin: 9 * 60, endMin: 9 * 60 + 30 }),
        planBlock({ id: "blk-b3", date: TODAY, title: "重複解消候補C", taskId: "task-b3", startMin: 9 * 60, endMin: 9 * 60 + 30 })
      ]
    });
    await runAiSchedule();
    const timesB = (await draftTimes()).sort((x, y) => x.start - y.start);
    check("3件とも配置される", timesB.length === 3, JSON.stringify(timesB));
    check("開始時刻が10:00/10:40/11:20(30分+10分バッファで前詰め、現在時刻10:00以降)",
      timesB.length === 3 && timesB[0].start === 600 && timesB[1].start === 640 && timesB[2].start === 680,
      JSON.stringify(timesB));
    const overlapB = timesB.some((it, i) => i > 0 && it.start < timesB[i - 1].end);
    check("項目間の重複がゼロ", !overlapB, JSON.stringify(timesB));

    // ============================================================
    // (c) 空き時間不足のBlockはskipped(タスク過多)
    // ============================================================
    console.log("[c] 空き時間不足のBlockはskipped(タスク過多)");
    // 2026-08-11裁定(重大3)で予定長が15〜240へクランプされるようになったため、400分の2件では
    // 両方とも240分に収まってしまいskipが発生しない。3件(各400分→240分クランプ)にして
    // 3件目だけが空き不足でskippedになるよう調整する。
    await seed({
      tasks: [wbsTask("task-c1", "過多候補A"), wbsTask("task-c2", "過多候補B"), wbsTask("task-c3", "過多候補C")],
      blocks: [
        planBlock({ id: "blk-c1", date: TODAY, title: "過多候補A", taskId: "task-c1", startMin: 0, endMin: 400 }),
        planBlock({ id: "blk-c2", date: TODAY, title: "過多候補B", taskId: "task-c2", startMin: 0, endMin: 400 }),
        planBlock({ id: "blk-c3", date: TODAY, title: "過多候補C", taskId: "task-c3", startMin: 0, endMin: 400 })
      ]
    });
    await runAiSchedule();
    const titlesC = await draftTitles();
    check("1・2件目(過多候補A/B)は配置される(400分は240分にクランプされる)",
      titlesC.some((t) => t.includes("過多候補A")) && titlesC.some((t) => t.includes("過多候補B")), JSON.stringify(titlesC));
    check("3件目(過多候補C)は入り切らず下書きに現れない", !titlesC.some((t) => t.includes("過多候補C")), JSON.stringify(titlesC));
    const skippedC = await page.locator(".draft-skipped-list").first().textContent().catch(() => "");
    check("3件目が「見送り: 過多候補C(空き時間不足(タスク過多))」としてskipped表示される",
      (skippedC || "").includes("過多候補C") && skippedC.includes("空き時間不足(タスク過多)"), skippedC);

    // ============================================================
    // (d) confirmで既存Blockの時刻更新+updatedAt bump・新規Block非生成
    // ============================================================
    console.log("[d] confirmで既存Blockの時刻更新+updatedAt bump・新規Block非生成");
    const OLD_UPDATED_AT = "2020-01-01T00:00:00";
    // 軽微8: migratedTo/carryCountに非既定値を仕込み、confirm後も不変(=繰越専用パスを通らない)ことを確認する
    await seed({
      tasks: [wbsTask("task-d1", "確定検証タスク")],
      blocks: [{ ...planBlock({ id: "blk-d1", date: TODAY, title: "確定検証タスク", taskId: "task-d1", startMin: 7 * 60, endMin: 7 * 60 + 30 }), updatedAt: OLD_UPDATED_AT, migratedTo: "dummy-migrated-to", carryCount: 2 }]
    });
    await runAiSchedule();
    const beforeConfirm = await stateNow();
    check("確定前はBlock総数1件のまま(下書きは非永続)", (beforeConfirm.blocks || []).length === 1, JSON.stringify(beforeConfirm.blocks));
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const afterConfirm = await stateNow();
    const blocksD = afterConfirm.blocks || [];
    check("確定後もBlock総数は1件のまま(新規Block非生成)", blocksD.length === 1, JSON.stringify(blocksD));
    const bD = blocksD.find((b) => b.id === "blk-d1");
    check("同じidのBlockが残り、時刻が下書き値(10:00〜10:30)に更新される",
      !!bD && bD.plannedStartAt === `${TODAY}T10:00` && bD.plannedEndAt === `${TODAY}T10:30`, JSON.stringify(bD));
    check("updatedAtがbumpされる(旧タイムスタンプのままではない)", !!bD && bD.updatedAt !== OLD_UPDATED_AT, JSON.stringify(bD));
    check("migratedTo/carryCountは不変(軽微8・繰越専用パス非経由の直接確認)",
      !!bD && bD.migratedTo === "dummy-migrated-to" && bD.carryCount === 2, JSON.stringify(bD));
    check("確定してもaiScheduleHistoryへ新規記録しない",
      (afterConfirm.aiScheduleHistory || []).length === 0, JSON.stringify(afterConfirm.aiScheduleHistory));

    // ============================================================
    // (e) 配置ウィンドウ: 仕事=平日9-18のみ / プライベート=8-21のみ
    // ============================================================
    console.log("[e1] 仕事Blockは平日でも9-18が埋まっていれば夜間へ溢れずskipped");
    await seed({
      date: DATE2,
      tasks: [wbsTask("task-e1", "仕事window候補")],
      blocks: [
        planBlock({ id: "blk-e1-occ", date: DATE2, title: "9-18終日占有", startMin: 9 * 60, endMin: 18 * 60 }),
        planBlock({ id: "blk-e1-work", date: DATE2, title: "仕事window候補", taskId: "task-e1", category: "仕事", startMin: 6 * 60, endMin: 6 * 60 + 30 })
      ]
    });
    await runAiSchedule();
    const titlesE1 = await draftTitles();
    check("9-18が埋まっていれば18時以降(夜間)へは溢れず配置されない", !titlesE1.some((t) => t.includes("仕事window候補")), JSON.stringify(titlesE1));
    const skippedE1 = await page.locator(".draft-skipped-list").first().textContent().catch(() => "");
    check("空き時間不足(タスク過多)としてskippedになる", (skippedE1 || "").includes("仕事window候補") && skippedE1.includes("空き時間不足(タスク過多)"), skippedE1);

    console.log("[e2] 仕事Blockは9:00より前には置かれない(平日・空きは十分)");
    await seed({
      date: DATE2,
      tasks: [wbsTask("task-e2", "仕事window下限候補")],
      blocks: [planBlock({ id: "blk-e2-work", date: DATE2, title: "仕事window下限候補", taskId: "task-e2", category: "仕事", startMin: 6 * 60, endMin: 6 * 60 + 30 })]
    });
    await runAiSchedule();
    const timesE2 = await draftTimes();
    check("配置開始が9:00(540分)ちょうど", timesE2.length === 1 && timesE2[0].start === 540, JSON.stringify(timesE2));

    console.log("[e3] プライベートBlockは8時より前・21時以降には置かれない");
    await seed({
      date: DATE2,
      tasks: [wbsTask("task-e3a", "プライベート下限候補")],
      blocks: [planBlock({ id: "blk-e3a", date: DATE2, title: "プライベート下限候補", taskId: "task-e3a", startMin: 6 * 60, endMin: 6 * 60 + 30 })]
    });
    await runAiSchedule();
    const timesE3a = await draftTimes();
    check("配置開始が8:00(480分)ちょうど", timesE3a.length === 1 && timesE3a[0].start === 480, JSON.stringify(timesE3a));

    await seed({
      date: DATE2,
      tasks: [wbsTask("task-e3b", "プライベート上限候補")],
      blocks: [
        planBlock({ id: "blk-e3b-occ", date: DATE2, title: "8-21終日占有", startMin: 8 * 60, endMin: 21 * 60 }),
        planBlock({ id: "blk-e3b", date: DATE2, title: "プライベート上限候補", taskId: "task-e3b", startMin: 6 * 60, endMin: 6 * 60 + 30 })
      ]
    });
    await runAiSchedule();
    const titlesE3b = await draftTitles();
    check("8-21が埋まっていれば21時以降(深夜)へは溢れず配置されない", !titlesE3b.some((t) => t.includes("プライベート上限候補")), JSON.stringify(titlesE3b));
    const skippedE3b = await page.locator(".draft-skipped-list").first().textContent().catch(() => "");
    check("空き時間不足(タスク過多)としてskippedになる", (skippedE3b || "").includes("プライベート上限候補") && skippedE3b.includes("空き時間不足(タスク過多)"), skippedE3b);

    console.log("[e4] 休日の仕事Blockは配置されずskipped(理由: 仕事タスクは平日9-18のみ)");
    await seed({
      date: SAT,
      tasks: [wbsTask("task-e4", "休日仕事候補")],
      blocks: [planBlock({ id: "blk-e4", date: SAT, title: "休日仕事候補", taskId: "task-e4", category: "仕事", startMin: 10 * 60, endMin: 10 * 60 + 30 })]
    });
    await runAiSchedule();
    const titlesE4 = await draftTitles();
    check("休日の仕事Blockは配置されない", !titlesE4.some((t) => t.includes("休日仕事候補")), JSON.stringify(titlesE4));
    const skippedE4 = await page.locator(".draft-skipped-list").first().textContent().catch(() => "");
    check("理由は「仕事タスクは平日9-18のみ」", (skippedE4 || "").includes("休日仕事候補") && skippedE4.includes("仕事タスクは平日9-18のみ"), skippedE4);

    // ============================================================
    // (f) タスク過多時にdraft barへ警告行が出る
    // ============================================================
    console.log("[f] タスク過多時にdraft barへ警告行が出る");
    // (c)と同じ理由(重大3の15〜240クランプ)で3件fixtureにする。
    await seed({
      date: TODAY,
      tasks: [wbsTask("task-f1", "過多警告候補A"), wbsTask("task-f2", "過多警告候補B"), wbsTask("task-f3", "過多警告候補C")],
      blocks: [
        planBlock({ id: "blk-f1", date: TODAY, title: "過多警告候補A", taskId: "task-f1", startMin: 0, endMin: 400 }),
        planBlock({ id: "blk-f2", date: TODAY, title: "過多警告候補B", taskId: "task-f2", startMin: 0, endMin: 400 }),
        planBlock({ id: "blk-f3", date: TODAY, title: "過多警告候補C", taskId: "task-f3", startMin: 0, endMin: 400 })
      ]
    });
    await runAiSchedule();
    const warnText = await page.locator(".draft-overload-warning").first().textContent().catch(() => "");
    check("警告行に「⚠ 1件が空き時間に入り切りません(タスク過多)」が出る",
      (warnText || "").includes("⚠ 1件が空き時間に入り切りません(タスク過多)"), warnText);
    const toastF = await page.locator("#toast").textContent().catch(() => "");
    check("トーストにも同旨のタスク過多警告が出る", (toastF || "").includes("入り切りません(タスク過多)"), toastF);

    // ============================================================
    // (g) 重大1改訂(2026-08-11 r2裁定): 「skipが1件でも出たら元区間を固定占有に加えて
    //     配置全体を最初からやり直す(再スタートループ)」への修正。レビュー報告書
    //     (app-side-review-claude-r2.md)の実機プローブ2シナリオをそのままfixtureにする。
    // ============================================================
    console.log("[g1] プローブ再現(同時刻積み上げ3件+タスク過多): 一手先取り穴が塞がれ、新規配置がskip Blockの元区間と重ならない");
    // レビュー記載どおり: 当日10:00時点、12:00以降はルーティンで占有、可動3件(積み上がりA/B/C)が
    // すべて10:00-11:00に積み上がった状態。120分(10:00-12:00)の空きに60分+10分バッファ=70分ずつしか
    // 入らないため、最大1件しか収まらない(旧実装は先に処理したBlockがこの120分の枠を素通しで
    // 使い切ってしまい、確定後にskip Blockと重なっていた)。
    await seed({
      tasks: [
        wbsTask("task-g1a", "積み上がりA"), wbsTask("task-g1b", "積み上がりB"), wbsTask("task-g1c", "積み上がりC")
      ],
      blocks: [
        planBlock({ id: "blk-g1a", date: TODAY, title: "積み上がりA", taskId: "task-g1a", startMin: 10 * 60, endMin: 11 * 60 }),
        planBlock({ id: "blk-g1b", date: TODAY, title: "積み上がりB", taskId: "task-g1b", startMin: 10 * 60, endMin: 11 * 60 }),
        planBlock({ id: "blk-g1c", date: TODAY, title: "積み上がりC", taskId: "task-g1c", startMin: 10 * 60, endMin: 11 * 60 }),
        planBlock({ id: "blk-g1-routine", date: TODAY, title: "12時以降ルーティン占有", category: "ルーティン", startMin: 12 * 60, endMin: 23 * 60 })
      ]
    });
    await runAiSchedule();
    const timesG1 = await draftTimes();
    check("1件だけ新規に配置される(積み上がりA。安定ソートで最初に処理される候補が生き残る)",
      timesG1.length === 1 && timesG1[0].start === 11 * 60, JSON.stringify(timesG1));
    const skippedG1 = await page.locator(".draft-skipped-list").first().textContent().catch(() => "");
    check("積み上がりB・Cはともにskipped(空き時間不足)のまま", (skippedG1 || "").includes("積み上がりB") && (skippedG1 || "").includes("積み上がりC"), skippedG1);
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const stateG1 = await stateNow();
    const blocksG1 = (stateG1.blocks || []).filter((b) => b.date === TODAY);
    const aG1 = blocksG1.find((b) => b.id === "blk-g1a");
    const bG1 = blocksG1.find((b) => b.id === "blk-g1b");
    const cG1 = blocksG1.find((b) => b.id === "blk-g1c");
    check("積み上がりAは新しい枠(11:00-12:00)へ移動する", !!aG1 && minOf(aG1.plannedStartAt) === 11 * 60 && minOf(aG1.plannedEndAt) === 12 * 60, JSON.stringify(aG1));
    check("積み上がりB・Cはskipされ元の10:00-11:00のまま動かない",
      !!bG1 && !!cG1 && minOf(bG1.plannedStartAt) === 10 * 60 && minOf(cG1.plannedStartAt) === 10 * 60, JSON.stringify({ bG1, cG1 }));
    const overlapsG1 = findOverlaps(blocksG1);
    // 一手先取り穴が塞がれたことの直接検証: 新規配置(積み上がりA)はルーティンともskip対象(B/C)とも
    // 重ならない(=A絡みの重複が0件)。B・C同士は「どちらも元々10:00-11:00に重複登録されていた
    // (=そもそもKが直す前のデータ)」ため、いずれも動かさないskipのまま確定すると重複が残る。
    // これは配置アルゴリズムの限界ではなく「skip=不変」という仕様上の帰結であり、この機能が
    // 解くべき対象(新規配置がskip領域を侵さないこと)ではない。
    const overlapsInvolvingA1 = overlapsG1.filter(([t1, t2]) => t1 === "積み上がりA" || t2 === "積み上がりA");
    check("新規配置(積み上がりA)はルーティン・skip対象(B/C)のどちらとも重ならない(一手先取り穴の解消を直接確認)",
      overlapsInvolvingA1.length === 0, JSON.stringify(overlapsG1));
    check("B・C間の重複は『どちらも動かしていない(skip=不変)』ことに由来する既知の残存(新規配置由来ではない)",
      overlapsG1.length === 1 && overlapsG1[0][0] === "積み上がりB" && overlapsG1[0][1] === "積み上がりC", JSON.stringify(overlapsG1));

    console.log("[g2] プローブ再現(休日の仕事Block+私用7時台): 私用が仕事の元区間(10:00-11:00)を避けて配置される");
    // レビュー記載どおり: 土曜、8:00-10:00固定 / 私用Block(元は7:00-8:00) / 仕事Block(10:00-11:00)。
    // 私用の元plannedStartAt(7:00)は仕事(10:00)より早いため、処理順は私用→仕事。
    // 旧実装は私用が先に「自然な最速空き枠」10:00を掴んでしまい、後から仕事がskipされても
    // 私用の位置は直らなかった。再スタートループなら、仕事がskipされたpassの次のpassで
    // 私用が仕事の元区間を避けて再配置される。
    await seed({
      date: SAT,
      tasks: [wbsTask("task-g2-private", "朝の私用"), wbsTask("task-g2-work", "土曜の仕事")],
      blocks: [
        planBlock({ id: "blk-g2-fixed", date: SAT, title: "8-10固定", startMin: 8 * 60, endMin: 10 * 60 }),
        planBlock({ id: "blk-g2-private", date: SAT, title: "朝の私用", taskId: "task-g2-private", startMin: 7 * 60, endMin: 8 * 60 }),
        planBlock({ id: "blk-g2-work", date: SAT, title: "土曜の仕事", taskId: "task-g2-work", category: "仕事", startMin: 10 * 60, endMin: 11 * 60 })
      ]
    });
    await runAiSchedule();
    const timesG2 = await draftTimes();
    check("朝の私用は仕事の元区間(10:00-11:00)を避けて11:00(660分)から配置される",
      timesG2.length === 1 && timesG2[0].start === 11 * 60, JSON.stringify(timesG2));
    const skippedG2 = await page.locator(".draft-skipped-list").first().textContent().catch(() => "");
    check("土曜の仕事はskippedのまま", (skippedG2 || "").includes("土曜の仕事"), skippedG2);
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const stateG2 = await stateNow();
    const blocksG2 = (stateG2.blocks || []).filter((b) => b.date === SAT);
    const workBlockG2 = blocksG2.find((b) => b.id === "blk-g2-work");
    check("土曜の仕事Blockは確定後も元の10:00-11:00のまま(skippedなので触られない)",
      !!workBlockG2 && minOf(workBlockG2.plannedStartAt) === 10 * 60 && minOf(workBlockG2.plannedEndAt) === 11 * 60, JSON.stringify(workBlockG2));
    const overlapsG2 = findOverlaps(blocksG2);
    check("確定後、当日の実Block同士に重複が一切ない(このシナリオは重複の原因となる重複登録が無いため完全にゼロを達成できる)",
      overlapsG2.length === 0, JSON.stringify(overlapsG2));

    // ============================================================
    // (h) 重大2修正: plannedEndAt欠落の固定Blockはstart+見積分を占有として扱う
    // ============================================================
    console.log("[h] plannedEndAt欠落の固定Blockはstart+見積分だけ占有し、その上に新規配置されない");
    await seed({
      date: DATE2,
      tasks: [wbsTask("task-h1", "欠落末尾回避候補")],
      blocks: [
        // 8:00-9:00を占有する完全な固定Block(以降の空きの先頭を塞ぐ)
        planBlock({ id: "blk-h-before", date: DATE2, title: "8-9占有", startMin: 8 * 60, endMin: 9 * 60 }),
        // plannedEndAt欠落。estimateMin=90分 → fix2により9:00-10:30を占有するはず
        { ...planBlock({ id: "blk-h-missing-end", date: DATE2, title: "終了時刻欠落9時から90分" }), plannedStartAt: `${DATE2}T09:00`, plannedEndAt: "", estimateMin: 90 },
        planBlock({ id: "blk-h-move", date: DATE2, title: "欠落末尾回避候補", taskId: "task-h1", startMin: 6 * 60, endMin: 6 * 60 + 30 })
      ]
    });
    await runAiSchedule();
    const timesH = await draftTimes();
    check("plannedEndAt欠落Blockの占有(9:00-10:30)を避けて10:30(630分)から配置される",
      timesH.length === 1 && timesH[0].start === 10 * 60 + 30, JSON.stringify(timesH));

    // ============================================================
    // (i) 重大3修正: 可動Blockの日跨ぎ長さ・巨大な予定長の15〜240クランプ
    // ============================================================
    console.log("[i] 可動Blockの日跨ぎ長さは(24:00-start)+end、巨大な予定長は240分にクランプされる");
    await seed({
      date: DATE2,
      tasks: [wbsTask("task-i1", "日跨ぎ候補")],
      blocks: [{ ...planBlock({ id: "blk-i1", date: DATE2, title: "日跨ぎ候補", taskId: "task-i1" }), plannedStartAt: `${DATE2}T23:30`, plannedEndAt: `${DATE2}T00:30` }]
    });
    await runAiSchedule();
    const timesI1 = await draftTimes();
    check("日跨ぎ(23:30→翌0:30)の長さは(24:00-23:30)+0:30=60分として扱われる",
      timesI1.length === 1 && timesI1[0].minutes === 60, JSON.stringify(timesI1));

    await seed({
      date: DATE2,
      tasks: [wbsTask("task-i2", "巨大長さ候補")],
      blocks: [planBlock({ id: "blk-i2", date: DATE2, title: "巨大長さ候補", taskId: "task-i2", startMin: 0, endMin: 400 })]
    });
    await runAiSchedule();
    const timesI2 = await draftTimes();
    check("予定長400分は240分に、算出経路によらずクランプされる",
      timesI2.length === 1 && timesI2[0].minutes === 240, JSON.stringify(timesI2));

    // ============================================================
    // (j) 中3修正: 休日の仕事Blockのみskipされた日は「タスク過多」と誤表示しない
    // ============================================================
    console.log("[j] 休日の仕事Blockのみskipのとき、警告行/トーストは「タスク過多」ではなく理由どおりの文言になる");
    await seed({
      date: SAT,
      tasks: [wbsTask("task-j1", "休日単独仕事候補")],
      blocks: [planBlock({ id: "blk-j1", date: SAT, title: "休日単独仕事候補", taskId: "task-j1", category: "仕事", startMin: 10 * 60, endMin: 10 * 60 + 30 })]
    });
    await runAiSchedule();
    const warnTextJ = await page.locator(".draft-overload-warning").first().textContent().catch(() => "");
    check("警告行に「タスク過多」は出ない(休日の仕事のみがskip理由のため)", !(warnTextJ || "").includes("タスク過多"), warnTextJ);
    check("警告行は「1件が休日のため配置されません(仕事タスクは平日9-18のみ)」になる",
      (warnTextJ || "").includes("1件が休日のため配置されません(仕事タスクは平日9-18のみ)"), warnTextJ);
    const toastJ = await page.locator("#toast").textContent().catch(() => "");
    check("トーストにも「タスク過多」は出ない", !(toastJ || "").includes("タスク過多"), toastJ);
    check("トーストは休日理由の文言になる", (toastJ || "").includes("休日のため配置されません"), toastJ);

    // ============================================================
    // (k) 候補0件時のトースト文言(仕様8番)
    // ============================================================
    console.log("[k] 当日の可動Blockが無ければ専用トーストが出る");
    await seed({ date: TODAY, tasks: [], blocks: [] });
    await runAiSchedule();
    const toastK = await page.locator("#toast").textContent().catch(() => "");
    check("候補0件時のトースト文言", (toastK || "").includes("当日のタスクシュート登録タスクがありません"), toastK);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
