// v59 検証: 朝の一括プランニング(繰越+WBS+MIT候補 → 空き時間へ仮配置 → 既存の下書きUIで確定)。
//
// 方針: app.js は type="module" で内部関数を window に露出しないため、既存スイート(v49〜v58)と
// 同じくブラウザ操作 + localStorage 状態の直接注入で観測する。
// v60でアプリ内からのClaude API直接呼び出しを全廃し、決定論配置(fallbackMorningPlan)が
// 唯一の配置経路になったため、本スイートが検証していた「AI失敗時のフォールバック」は
// そのまま「常用経路」の検証として引き続き成立する(fallbackMorningPlan自体は無改修)。
// フォールバックは computeFreeGaps の出力をそのまま使うため、配置境界を見ることで
// computeFreeGaps の境界(占有なし/連続占有/日跨ぎ端)も間接的に検証できる。
const { chromium, launchOptions, startServer } = require("./helpers");

const PORT = 4194;
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  // コーディネーター指摘(2026-07-09, v61レビュー): computeFreeGaps は「現在時刻〜23:00」を
  // 空き枠として扱うため、深夜23:00付近に実行すると空き枠が消えてフレーキーになっていた。
  // page.clock でページ内の現在時刻を日中(10:00)に固定し、実行時刻に依存しないようにする
  // (アプリ本体のロジックは無改修。以降のテスト内 now2 相当の計算も now0 を再利用する)。
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YEST = isoDate(new Date(now0.getTime() - 24 * 60 * 60 * 1000));

  // 各シナリオ共通の下地: blocks/tasks/projects を丸ごと差し替え、選択日を設定して reload。
  // projects=[] にしても normalizeState が Wish/その他 Project を再生成するので安全。
  async function seed({ blocks = [], tasks = [], projects = [] } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
  }

  function planBlock({ id, date, title, startMin, endMin, taskId = "", category = "", migratedTo = "" }) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo, orderIndex: 0,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
      deleted: false
    };
  }
  function wbsTask(id, title) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  async function runMorningPlan() {
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(600);
  }

  async function draftBlocks() {
    const els = await page.locator(".draft-block-time").allTextContents();
    return els.map((t) => {
      const m = t.match(/(\d{2}):(\d{2})〜(\d{2}):(\d{2})\((\d+)分\)/);
      if (!m) return null;
      return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]), minutes: Number(m[5]) };
    }).filter(Boolean);
  }

  await page.clock.setFixedTime(now0);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);

  // ---- [1] 空き時間の境界: 占有なし ----
  console.log("[1] computeFreeGaps 境界(占有なし)— 今〜23:00の1本に収まる");
  await seed({ tasks: [wbsTask("test-task-1", "占有なし候補タスク")], projects: [testProject()] });
  check("🌅 朝プランボタンが存在する(APIキー不要・今日を選択中)", await page.locator('[data-action="ai-morning-plan"]').count() === 1);  // (e)
  await runMorningPlan();
  const gaps1 = await draftBlocks();
  check("候補1件が下書きとして1件だけ配置される", gaps1.length === 1, JSON.stringify(gaps1));
  if (gaps1.length === 1) {
    check("配置は23:00(1380分)を超えない", gaps1[0].end <= 1380, JSON.stringify(gaps1[0]));
    check("配置時間は30分(既定見積)", gaps1[0].minutes === 30, JSON.stringify(gaps1[0]));
  }

  // ---- [2] 空き時間の境界: 連続占有はマージされ、隙間に配置されない / フォールバックは空き枠と重ならない ----
  console.log("[2] computeFreeGaps 境界(連続占有)/ フォールバック配置が空き枠と重ならない");
  // now0 は既に固定済み(10:00)なので、その値をそのまま再利用する(new Date()で取り直さない)。
  const nowFloor2 = Math.min(23 * 60, Math.ceil((now0.getHours() * 60 + now0.getMinutes()) / 15) * 15);
  const occStart = nowFloor2 + 15;   // 直前に15分だけ空き(30分候補には狭すぎる)
  const occMid = occStart + 30;
  const occEnd = occMid + 30;        // occStart〜occEnd の60分が「連続する2つのBlock」で占有
  await seed({
    tasks: [wbsTask("test-task-2", "連続占有テスト候補")],
    projects: [testProject()],
    blocks: [
      planBlock({ id: "test-occ-1", date: TODAY, title: "占有A", startMin: occStart, endMin: occMid }),
      planBlock({ id: "test-occ-2", date: TODAY, title: "占有B", startMin: occMid, endMin: occEnd })
    ]
  });
  await runMorningPlan();
  const gaps2 = await draftBlocks();
  check("候補1件が配置される(連続占有ブロックの直後)", gaps2.length === 1, JSON.stringify(gaps2));
  if (gaps2.length === 1) {
    check("配置開始は連続占有の終端(occEnd)と一致する = 隙間(occMid)には置かれない",
      gaps2[0].start === occEnd, `start=${gaps2[0].start} occEnd=${occEnd}`);
    check("配置は占有区間[occStart,occEnd)と重ならない(フォールバックは空き枠と重ならない)",
      gaps2[0].start >= occEnd || gaps2[0].end <= occStart, JSON.stringify({ gap: gaps2[0], occStart, occEnd }));
  }

  // ---- [3] 空き時間の境界: 日跨ぎ端(23:00) ----
  console.log("[3] computeFreeGaps 境界(日跨ぎ端 23:00)— 超えて配置しない・入り切らない候補はskipped");
  await seed({
    tasks: [wbsTask("test-task-3a", "23時境界テストA"), wbsTask("test-task-3b", "23時境界テストB")],
    projects: [testProject()],
    // 05:00〜22:15 を占有(残り45分のみ空き)。30分候補が1つ入り、もう1つは15分の余りに入らずskippedへ。
    blocks: [planBlock({ id: "test-occ-3", date: TODAY, title: "ほぼ終日の占有", startMin: 5 * 60, endMin: 22 * 60 + 15 })]
  });
  await runMorningPlan();
  const gaps3 = await draftBlocks();
  check("空き45分の枠に1件だけ配置される(もう1件は入り切らずskipped)", gaps3.length === 1, JSON.stringify(gaps3));
  if (gaps3.length === 1) {
    check("配置は22:15始まり(占有直後)", gaps3[0].start === 22 * 60 + 15, JSON.stringify(gaps3[0]));
    check("配置終了は23:00(1380分)を超えない", gaps3[0].end <= 1380, JSON.stringify(gaps3[0]));
  }
  const skippedText3 = await page.locator(".draft-bar + div").first().textContent().catch(() => "");
  check("入り切らなかった候補が「見送り」として表示される", (skippedText3 || "").includes("見送り"), skippedText3);

  // ---- [4] 繰越候補が draft に載る / 確定で元Blockに migratedTo が付く(二重繰越防止) ----
  console.log("[4] 繰越候補のdraft搭載 と 確定時のmigratedTo付与");
  const CARRY_TITLE = "昨日やり残したレポート作成";
  await seed({
    blocks: [planBlock({ id: "test-carry-1", date: YEST, title: CARRY_TITLE, startMin: 14 * 60, endMin: 14 * 60 + 30 })]
  });
  await runMorningPlan();
  const draftTitle = await page.locator(".draft-block-title").first().textContent().catch(() => "");
  check("昨日未完了(繰越候補)がdraftのタイトルとして表示される", (draftTitle || "").includes(CARRY_TITLE), draftTitle);  // (b)

  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const afterConfirm = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const srcBlock = (afterConfirm.blocks || []).find((b) => b.id === "test-carry-1");
  const newBlock = (afterConfirm.blocks || []).find((b) => b.date === TODAY && b.title === CARRY_TITLE);
  check("元Block(昨日)にmigratedToが設定される", !!srcBlock && !!srcBlock.migratedTo, JSON.stringify(srcBlock));  // (c)
  check("今日に新しいBlockとして登録される", !!newBlock, JSON.stringify(newBlock));
  check("migratedToの参照先は今日の新Blockと一致する(二重繰越防止の紐付け)",
    !!srcBlock && !!newBlock && srcBlock.migratedTo === newBlock.id);
  // 二重繰越防止: 再度「昨日の未完了」パネルにこの項目が出ないことを確認
  await page.reload();
  await page.waitForTimeout(400);
  const carryPanelText = await page.locator(".carryover-panel").textContent().catch(() => "");
  check("確定後は「昨日の未完了」繰越パネルに再表示されない(二重繰越防止)",
    !(carryPanelText || "").includes(CARRY_TITLE), carryPanelText);

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
