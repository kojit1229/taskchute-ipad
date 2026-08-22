// v162 検証: 「未完了理由クイック入力」(CHANGES_v162.md参照)。
// K裁定b案(taskchute-notes/decisions.md「2026-07-28 言い訳ハンターの入力源」)の実装。
// 未完了Blockに理由を1タップで記録できるようにし、日報に「未完了理由」欄を出力する。
//
// 検証項目:
//  [1] normalizeState後方互換: incompleteReasonキー自体が無い旧Blockはnullへ補完される。
//      壊れた形状(chip欠落)もnullへ正規化される。既存の正しい値は保持される。
//  [2] 日次締め: 当日に理由未記録の未完了Blockが残っている状態で「日報を生成」を押すと、
//      直接は生成されず理由チップモーダルが開く(スキップ可能なことも確認)。
//  [3] チップ1タップで記録→キューの次のBlockへ進む。全件処理後にgenerateReport()が走り、
//      記録した理由がblock.incompleteReasonへ保存される。
//  [4] 全件スキップでもgenerateReport()は最終的に実行される(理由は記録されない)。
//  [5] 既に理由が付いているBlockは日次締めモーダルに再度出ない。
//  [6] 日報出力: 理由が1件以上ある日は「## 未完了理由」節が
//      `- [Block名] チップ名: ひと言`(ひと言なしは`- [Block名] チップ名`)形式で出る。
//      理由が無い日は節ごと省略される。
// 2026-07-28 2系統レビュー対応の追加検証(必須1-3・推奨4-6):
//  [6c] 記録後に完了へ転じたBlockは「## 未完了理由」から消える(必須2)。
//  [11] 日次締めでスキップしたBlockは同セッション内で再質問されない(推奨4)。
//  必須3(state.questions.push直後のsaveState())・推奨6(incompleteReason.atのString()正規化)は
//  コード変更のみで専用のUIテストは追加していない。
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


const mkTodayBlock = (id, title, extra = {}) => ({
  id, taskId: "", date: TODAY, title, category: "仕事", estimateMin: 20, carryCount: 0,
  migratedTo: "", completed: false, recurrenceGroupId: "", deleted: false, incompleteReason: null,
  plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "",
  charge: 0, discharge: 0, comment: "", pomodoroCount: 0, isMIT: false,
  createdAt: `${TODAY}T09:00:00`, updatedAt: `${TODAY}T09:00:00`, ...extra
});
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

  const stateNow = () => page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);

  async function seed(fixture) {
    await page.evaluate(({ KEY, wishProjectId, fixture, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = (s.tasks || []).filter((t) => t.projectId !== wishProjectId);  // デモWishを除去
      s.blocks = fixture.blocks || [];
      s.reports = {};
      s.questions = [];
      s.swipeTriageLog = fixture.swipeTriageLog || [];
      s.migrationRitualLog = fixture.migrationRitualLog || [];
      (fixture.tasks || []).forEach((t) => s.tasks.push(t));
      s.selectedDate = TODAY;
      s.currentView = fixture.view || "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, wishProjectId, fixture, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
  }

  try {
    // ============================================================
    // [1] normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState後方互換: incompleteReasonキー自体が無い旧Block→null補完/壊れた形状→null正規化/正しい値は保持");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const legacyBlock = { id: "legacy-1", taskId: "", date: TODAY, title: "旧Block", category: "", completed: false, deleted: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00` };
      delete legacyBlock.incompleteReason;
      const brokenBlock = { id: "broken-1", taskId: "", date: TODAY, title: "壊れ形状Block", category: "", completed: false, deleted: false, incompleteReason: { note: "chipが無い" }, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00` };
      const validBlock = { id: "valid-1", taskId: "", date: TODAY, title: "正常Block", category: "", completed: false, deleted: false, incompleteReason: { chip: "疲労", note: "既存メモ", at: `${TODAY}T08:00:00` }, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00` };
      s.blocks = [legacyBlock, brokenBlock, validBlock];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    const s1 = await stateNow();
    const legacyAfter = s1.blocks.find((b) => b.id === "legacy-1");
    const brokenAfter = s1.blocks.find((b) => b.id === "broken-1");
    const validAfter = s1.blocks.find((b) => b.id === "valid-1");
    check("フィールド自体が無い旧Blockはnullへ補完される", legacyAfter?.incompleteReason === null, JSON.stringify(legacyAfter));
    check("chip欠落の壊れた形状はnullへ正規化される", brokenAfter?.incompleteReason === null, JSON.stringify(brokenAfter));
    check("正しい値は保持される(chip/note/at)",
      validAfter?.incompleteReason?.chip === "疲労" && validAfter?.incompleteReason?.note === "既存メモ" && validAfter?.incompleteReason?.at === `${TODAY}T08:00:00`,
      JSON.stringify(validAfter));

    // ============================================================
    // [2]-[5] 日次締め導線
    // ============================================================
    console.log("[2] 日次締め: 理由未記録の未完了Blockが残っていると「日報を生成」で直接は生成されず理由チップモーダルが開く");
    await seed({ blocks: [mkTodayBlock("blk-close-1", "未完了A"), mkTodayBlock("blk-close-2", "未完了B", { completed: true })], view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    check("reports[TODAY]はまだ生成されない", !s2.reports[TODAY]);
    check("理由チップモーダルが開く", await page.locator(".modal-title", { hasText: "未完了の理由" }).count() === 1);
    check("完了済みBlock(未完了B)は対象にならない(モーダル本文に出ない)", !(await page.locator(".modal-body").textContent()).includes("未完了B"));
    check("対象Blockのタイトルが出る", (await page.locator(".modal-body").textContent()).includes("未完了A"));

    console.log("[3] チップ1タップで記録→次へ→全件処理後にgenerateReport()が走り理由が保存される");
    await page.fill("[data-incomplete-reason-note]", "会議が長引いた");
    await page.click('[data-action="incomplete-reason-chip"][data-chip="時間切れ"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const recorded = s3.blocks.find((b) => b.id === "blk-close-1");
    check("チップとひと言がincompleteReasonへ記録される",
      recorded?.incompleteReason?.chip === "時間切れ" && recorded?.incompleteReason?.note === "会議が長引いた", JSON.stringify(recorded));
    check("記録後は自動でgenerateReport()が走りreports[TODAY]が生成される", !!s3.reports[TODAY], Object.keys(s3.reports || {}));
    check("モーダルが閉じている", await page.locator(".modal-root.open").count() === 0);

    console.log("[4] 全件スキップでもgenerateReport()は最終的に実行される(理由は記録されない)");
    await seed({ blocks: [mkTodayBlock("blk-skip-1", "スキップ対象A"), mkTodayBlock("blk-skip-2", "スキップ対象B")], view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    check("(準備)モーダルが開く", await page.locator(".modal-root.open").count() === 1);
    await page.click('[data-action="incomplete-reason-skip"]');
    await page.waitForTimeout(200);
    check("(準備)2件目のモーダルへ進む(まだ閉じない)", await page.locator(".modal-root.open").count() === 1);
    await page.click('[data-action="incomplete-reason-skip"]');
    await page.waitForTimeout(300);
    const s4 = await stateNow();
    check("全件スキップ後にgenerateReport()が走る", !!s4.reports[TODAY]);
    check("理由は記録されない(incompleteReasonはnullのまま)",
      s4.blocks.find((b) => b.id === "blk-skip-1").incompleteReason === null &&
      s4.blocks.find((b) => b.id === "blk-skip-2").incompleteReason === null);
    check("モーダルが閉じている", await page.locator(".modal-root.open").count() === 0);

    console.log("[5] 既に理由が付いているBlockは日次締めモーダルに再度出ない");
    await seed({
      blocks: [
        mkTodayBlock("blk-already", "既に理由記録済み", { incompleteReason: { chip: "疲労", note: "", at: `${TODAY}T07:00:00` } }),
        mkTodayBlock("blk-fresh", "理由未記録")
      ],
      view: "journal"
    });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    check("モーダル本文には理由未記録のBlockだけが出る", (await page.locator(".modal-body").textContent()).includes("理由未記録"));
    check("既に理由が付いているBlockは出ない", !(await page.locator(".modal-body").textContent()).includes("既に理由記録済み"));
    await page.click('[data-action="incomplete-reason-skip"]');
    await page.waitForTimeout(300);

    // ============================================================
    // [6] 日報出力
    // ============================================================
    console.log("[6] 日報出力: 理由が1件以上ある日は「## 未完了理由」節が指定書式で出る/無い日は節ごと省略");
    await seed({
      blocks: [
        mkTodayBlock("blk-report-1", "資料作成", { incompleteReason: { chip: "時間切れ", note: "会議が伸びた", at: `${TODAY}T18:00:00` } }),
        mkTodayBlock("blk-report-2", "掃除", { incompleteReason: { chip: "気分が乗らない", note: "", at: `${TODAY}T18:01:00` } }),
        // 理由なし。completed:trueにして日次締めモーダルの横取り([2]-[5]で別途検証済み)を避け、
        // ここでは「理由が無いBlockの行が出力に出ない」ことだけに焦点を絞る。
        mkTodayBlock("blk-report-3", "理由なしBlock", { completed: true })
      ],
      view: "journal"
    });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s6 = await stateNow();
    const report6 = s6.reports[TODAY] || "";
    check("「## 未完了理由」見出しが出る", report6.includes("## 未完了理由"), report6.slice(0, 50));
    check("ひと言ありは`- [Block名] チップ名: ひと言`形式", report6.includes("- [資料作成] 時間切れ: 会議が伸びた"), report6);
    check("ひと言なしは`- [Block名] チップ名`形式(コロン以降なし)", report6.includes("- [掃除] 気分が乗らない\n"), report6);
    check("理由が無いBlockは行が出ない", !report6.includes("理由なしBlock]"), report6);

    console.log("[6b] 日報出力: 理由が1件も無い日は「## 未完了理由」節ごと省略される");
    await seed({ blocks: [mkTodayBlock("blk-noreason", "理由なし未完了")], view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s6b = await stateNow();
    check("節ごと省略される", !(s6b.reports[TODAY] || "").includes("## 未完了理由"));

    console.log("[6c] 日報出力: 記録後に完了へ転じたBlockは「## 未完了理由」から消える(2系統レビュー対応・必須2)");
    await seed({
      blocks: [
        mkTodayBlock("blk-still-incomplete", "未完了のまま", { incompleteReason: { chip: "疲労", note: "", at: `${TODAY}T09:00:00` } }),
        mkTodayBlock("blk-now-completed", "後で完了した", { completed: true, incompleteReason: { chip: "時間切れ", note: "", at: `${TODAY}T09:00:00` } })
      ],
      view: "journal"
    });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s6c = await stateNow();
    const report6c = s6c.reports[TODAY] || "";
    // 「### 実行 Block(時刻順)」表には完了/未完了問わず全Blockのタイトルが載るため、
    // 「## 未完了理由」節の中身だけを切り出して判定する(report全体に対する単純includesだと
    // 別表に載っているタイトルを誤検出する)。
    const reasonSection6c = (report6c.split("## 未完了理由")[1] || "").split(/\n## /)[0];
    check("未完了のままのBlockは節に出る", reasonSection6c.includes("- [未完了のまま] 疲労"), reasonSection6c);
    check("完了へ転じたBlockは節に出ない(偽の言い訳が台帳へ流れる汚染の防止)", !reasonSection6c.includes("後で完了した"), reasonSection6c);
    check("incompleteReason自体は削除されず残る(表示条件だけを変えている)",
      s6c.blocks.find((b) => b.id === "blk-now-completed")?.incompleteReason?.chip === "時間切れ");

    // ============================================================
    console.log("[11] 日次締め: スキップしたBlockは同セッション内で「日報を生成」を再度押しても再質問されない(2系統レビュー対応・推奨4)");
    await seed({ blocks: [mkTodayBlock("blk-skip-remember", "スキップ記憶対象")], view: "journal" });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    check("(準備)1回目はモーダルが開く", await page.locator(".modal-root.open").count() === 1);
    await page.click('[data-action="incomplete-reason-skip"]');
    await page.waitForTimeout(300);
    const s11a = await stateNow();
    check("(準備)スキップ後にgenerateReport()が走る", !!s11a.reports[TODAY]);
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    check("2回目はモーダルが開かない(同セッション内でスキップ済みBlockは再質問されない)",
      await page.locator(".modal-root.open").count() === 0);

    console.log(failures === 0 ? "\n✅ v162 ALL PASS" : `\n❌ v162: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
