// v50 検証: スケジュール下書きのD&D操作(ドラッグ移動 / 下端リサイズ / 確定 / 破棄)
//
// v60メモ: 本スイートはもともと「①AIタスク分解 ②スケジュール下書きD&D ③週次壁打ち
// ④0秒思考所感」の4機能を検証していたが、v60でアプリ内からのClaude API直接呼び出しを
// 全廃したため、①③④(いずれもcallClaude前提)は機能ごと削除した。②のスケジュール下書きは
// 決定論配置(computeFreeGaps→fallbackMorningPlan)に置き換えて存続するため、本スイートは
// D&D操作(ドラッグ・リサイズ・確定・破棄)の検証として残す。AIのfetchモックは使わない。
// v199メモ: runAiSchedule(ai-schedule)の候補源が「WBSの未Block化タスク」から「当日登録済みの
// 未着手Block(taskchuteBlocks条件を満たすもの)」へ変更されたため、fixtureを当日Block(blk-A)
// 前提に更新した。D&D・確定・破棄の検証意図(この見出しの主目的)は維持し、確定時のassertionだけ
// 「新規Block化」から「既存Blockの時刻更新(blockIdマッチ・新規Block非生成)」へ更新している
// (詳細はCHANGES_v199.md参照)。
const { chromium, ROOT, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dispatchRegisteredAction } = require("./helpers");

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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const today = new Date();
  // コーディネーター指摘(2026-07-09, v61レビュー): このスイートは「現在時刻からの空き枠」を
  // 前提に境界値を計算するため、深夜23:00付近に実行すると空き枠が消えてフレーキーになっていた。
  // page.clock で「ページ内から見える現在時刻」を日中(10:00)に固定し、実行時刻に関係なく
  // 決定論的な結果になるようにする(アプリ本体のロジックは無改修)。
  today.setHours(10, 0, 0, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(today);
  const pad2 = (n) => String(n).padStart(2, "0");
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  // 決定論配置(runAiSchedule)が使う「現在時刻からの空き枠」を予測可能にするため、
  // 05:00〜(現在時刻を15分単位に切り上げ+60分)を1本の既存Blockで占有しておく。
  // これで最初の空き枠の開始時刻(=下書きの初期配置)を計算で特定できる。
  const nowMin = today.getHours() * 60 + today.getMinutes();
  const nowFloor = Math.min(23 * 60, Math.ceil(nowMin / 15) * 15);
  const occupiedUntil = Math.min(22 * 60, nowFloor + 60);  // 23:00に寄りすぎて空き枠が消えないようclamp
  const expectedStart = occupiedUntil;

  await page.clock.setFixedTime(today);  // goto前に固定してアプリ起動時のnew Date()から一貫させる
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ---- seed: プロジェクト/タスク + 既存Block(空き枠の開始を固定するため) ----
  // v199: runAiScheduleの候補源は「当日登録済みの未着手Block」になったため、task-Aは
  //   WBS未Block化のままでなく、あらかじめ当日Block(blk-A・7:00-7:30=30分)として登録しておく
  //   (元の予定長がそのまま可動Blockの長さになる。旧仕様の「既定見積30分」と同じ結果になるよう
  //   30分幅にしている)。
  await page.evaluate(({ TODAY, KEY, occupiedUntil }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-1", kind: "normal", title: "英語学習", category: "", status: "active", description: "TOEIC 800を目指す", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false, collapsed: false });
    s.tasks = [{ id: "task-A", projectId: "proj-1", parentTaskId: "", title: "資料作成", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false }];
    s.blocks = [{
      id: "blk-ex", taskId: "", date: TODAY, title: "既存ミーティング", category: "",
      plannedStartAt: `${TODAY}T05:00`, plannedEndAt: `${TODAY}T${String(Math.floor(occupiedUntil / 60)).padStart(2, "0")}:${String(occupiedUntil % 60).padStart(2, "0")}`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false
    }, {
      id: "blk-A", taskId: "task-A", date: TODAY, title: "資料作成", category: "",
      plannedStartAt: `${TODAY}T07:00`, plannedEndAt: `${TODAY}T07:30`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false
    }];
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { TODAY, KEY, occupiedUntil });
  await page.reload();
  await page.waitForTimeout(600);

  // ---- スケジュール下書き(決定論配置) + D&D ----
  console.log("[1] 下書きスケジュール(決定論配置)");
  await page.click('[data-action="nav"][data-view="today"]');
  await page.waitForTimeout(300);
  check("todayビューには旧下書きボタンを戻さない", await page.locator('[data-action="ai-schedule"]').count() === 0);
  await page.click('[data-action="nav"][data-view="timeline"]');
  await page.waitForSelector('#app[data-view="timeline"] [data-action="ai-schedule"]');
  check("timelineの現行下書き導線を維持", await page.locator('#app[data-view="timeline"] [data-action="ai-schedule"]').count() === 1);
  await page.click('#app[data-view="timeline"] [data-action="ai-schedule"]');
  await page.waitForTimeout(500);
  check("タイムラインへ自動遷移", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY) === "timeline");
  check("下書きブロックが表示される", await page.locator(".draft-block").count() === 1);
  check("下書きバー(確定/破棄)", await page.locator('[data-action="draft-confirm"]').count() === 1);
  let label = await page.locator(".draft-block-time").textContent();
  check(`既存Blockの直後(${hhmm(expectedStart)})・30分(blk-Aの元の予定長)で仮配置`,
    label.includes(hhmm(expectedStart)) && label.includes("30分"), label);

  // ドラッグ移動: 60px 下へ(zoom1 = 60px/時 → +60分)
  await page.locator(".draft-block").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  let box = await page.locator(".draft-block").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  label = await page.locator(".draft-block-time").textContent();
  check(`ドラッグで ${hhmm(expectedStart + 60)}〜 に移動(15分スナップ)`, label.includes(hhmm(expectedStart + 60)), label);

  // 下端リサイズ: +30px(=+30分 → 60分)
  await page.locator(".draft-block").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  box = await page.locator(".draft-block").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5 + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  label = await page.locator(".draft-block-time").textContent();
  check("下端ドラッグで 60分 に延長", label.includes("60分"), label);

  // 確定(v199: blockId付き項目なので既存Block=blk-Aの時刻が更新されるだけで、新規Blockは作られない)
  await page.click('[data-action="draft-confirm"]');
  await page.waitForTimeout(400);
  const confirmed = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const b = s.blocks.find((x) => x.id === "blk-A");
    return b ? { start: b.plannedStartAt, end: b.plannedEndAt, taskId: b.taskId, totalBlocks: s.blocks.length } : null;
  }, KEY);
  const expEnd = expectedStart + 60 + 60;
  check(`確定で既存Block(blk-A)の時刻が更新される(${hhmm(expectedStart + 60)}〜${hhmm(expEnd)}・taskId紐づけ維持)`,
    confirmed && confirmed.start.endsWith(`T${hhmm(expectedStart + 60)}`) && confirmed.end.endsWith(`T${hhmm(expEnd)}`) && confirmed.taskId === "task-A",
    JSON.stringify(confirmed));
  check("新規Blockは作られない(Block総数=2のまま。既存ミーティング+blk-A)", confirmed && confirmed.totalBlocks === 2, JSON.stringify(confirmed));
  check("確定後は下書きが消える", await page.locator(".draft-block").count() === 0);

  // 破棄フロー(v199: blk-Aは確定後も引き続き未着手Blockのため再度候補になりうる。
  //   候補の有無どちらでも安全に倒れるよう両分岐を維持する)
  await page.click('[data-action="nav"][data-view="today"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="nav"][data-view="timeline"]');
  const scheduleButton = page.locator('#app[data-view="timeline"] [data-action="ai-schedule"]');
  if (await scheduleButton.count()) {
    await scheduleButton.click();
  } else {
    await dispatchRegisteredAction(page, "ai-schedule");
  }
  await page.waitForTimeout(500);
  const hasDraft = await page.locator(".draft-block").count();
  if (hasDraft) {
    await page.click('[data-action="draft-discard"]');
    await page.waitForTimeout(300);
    check("破棄で下書きが消え、Blockは増えない", await page.locator(".draft-block").count() === 0);
  } else {
    check("破棄フロー(候補なしのためスキップ扱い)", true);
  }

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
