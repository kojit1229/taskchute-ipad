// v54 検証: 計器盤の追加チャート(ドーナツ / カテゴリ双極 / 複数折れ線 / カレンダー / ヒストグラム)
const { chromium, launchOptions, startServer } = require("./helpers");

const PORT = 4193;
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysAgo = (n) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  const TODAY = iso(today);

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);

  // ---- seed: 過去4週の実績Block(カテゴリ・充放電・実績時刻)+ 記録日 ----
  await page.evaluate(({ KEY, days, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    // カテゴリを確実に用意
    s.settings.categories = [
      { id: "c1", name: "開発", color: "#007aff" },
      { id: "c2", name: "内省", color: "#2fb96d" },
      { id: "c3", name: "営業", color: "#ff9500" }
    ];
    // taskId 付き = taskchuteStartRate(着手率・折れ線)の分母に乗る
    s.projects.push({ id: "proj-1", kind: "normal", title: "P", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false });
    s.tasks.push({ id: "task-A", projectId: "proj-1", parentTaskId: "", title: "T", category: "", status: "doing", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false });
    const mk = (id, date, hh, cat, charge, discharge, mins = 45) => ({
      id, taskId: "task-A", date, title: `B${id}`, category: cat,
      plannedStartAt: `${date}T${String(hh).padStart(2, "0")}:00`, plannedEndAt: `${date}T${String(hh).padStart(2, "0")}:${mins}`,
      actualStartAt: `${date}T${String(hh).padStart(2, "0")}:05`, actualEndAt: `${date}T${String(hh).padStart(2, "0")}:${mins}`,
      completed: true, charge, discharge, isMIT: false,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, estimateMin: 30,
      createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false
    });
    // 開発=充電源(多時間・午前), 内省=中立, 営業=放電源(午後)
    days.forEach((d, i) => {
      s.blocks.push(mk(`dev-${i}`, d, 10, "開発", 3, 1, 55));   // 55分
      s.blocks.push(mk(`ref-${i}`, d, 13, "内省", 1, 1, 30));
      s.blocks.push(mk(`sal-${i}`, d, 16, "営業", 0, 3, 40));   // 放電
    });
    // 1件だけ MIT(推移のMIT線用)
    s.blocks[0].isMIT = true; s.blocks[3].isMIT = true;
    // 記録日(カレンダー用): journals / reports / 0秒思考
    s.journals[days[0]] = "記録テスト日記";
    s.journals[days[1]] = "もう一日";
    s.reports[days[2]] = "# 日報";
    s.zeroThinking = s.zeroThinking || { themes: [], entries: [] };
    s.zeroThinking.entries.push({ id: "z1", date: days[3], theme: "t", body: "b", createdAt: `${days[3]}T09:00` });
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, days: [3, 6, 9, 12, 15, 18].map(daysAgo), TODAY });
  await page.reload();
  await page.waitForTimeout(600);

  console.log("[1] 計器盤の追加チャート(4週)");
  await page.click('[data-action="nav"][data-view="stats"]');
  await page.waitForTimeout(400);

  // A. ドーナツ
  check("ドーナツSVGが出る", await page.locator(".stats-donut").count() === 1);
  const donutSegs = await page.locator(".stats-donut circle[stroke-dasharray]").count();
  check("ドーナツにカテゴリ数分のセグメント(3)", donutSegs === 3, `segs=${donutSegs}`);
  check("ドーナツ凡例にカテゴリ名+時間", await page.locator(".stats-legend-row").count() === 3
    && (await page.locator(".stats-legend").textContent()).includes("開発"));

  // B. カテゴリ別 双極バー
  check("カテゴリ双極バーが出る", (await page.locator("main").textContent()).includes("カテゴリ別 エネルギー収支"));
  check("開発は充電源(pos) / 営業は放電源(neg)", await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".stats-div-row")];
    const dev = rows.find((r) => r.textContent.includes("開発"));
    const sal = rows.find((r) => r.textContent.includes("営業"));
    return dev && dev.querySelector(".stats-div-pos > span") && sal && sal.querySelector(".stats-div-neg > span");
  }));

  // C. 複数折れ線
  check("主要指標の推移SVG", await page.locator(".stats-line-svg").count() === 1);
  const polylines = await page.locator(".stats-line-svg polyline").count();
  check("折れ線が描かれる(着手率等)", polylines >= 1, `polylines=${polylines}`);
  check("凡例に最新値(直ラベル)がある", /着手率\s*\d+%/.test(await page.locator(".stats-legend-inline-row").textContent()));

  // D. カレンダー
  check("記録カレンダーが出る", await page.locator(".stats-cal").count() === 1);
  check("活動強度セル(lv1以上)がある", await page.locator(".stats-cal-cell.lv1, .stats-cal-cell.lv2, .stats-cal-cell.lv3").count() >= 1);

  // E. ヒストグラム
  check("時間帯ヒストグラムが出る", await page.locator(".stats-hist").count() === 1);
  check("着手時刻のバー(10/13/16時台)が立つ", await page.locator(".stats-hist-fill").count() >= 3);

  // 既存4セクションが健在
  const txt = await page.locator("main").textContent();
  check("既存: 着手率の週次推移", txt.includes("着手率の週次推移"));
  check("既存: 見積 vs 実績", txt.includes("見積 vs 実績"));

  // ---- [2] 期間切替 ----
  console.log("[2] 期間切替");
  await page.click('[data-action="stats-range"][data-range="12w"]');
  await page.waitForTimeout(300);
  check("12週でもドーナツ描画", await page.locator(".stats-donut").count() === 1);
  check("range=12w が保存", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.statsRange, KEY) === "12w");

  // ---- [3] データ不足で非表示 ----
  console.log("[3] データ不足時は非表示");
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.blocks = [];
    s.journals = {}; s.reports = {}; s.zeroThinking = { themes: [], entries: [] };
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="stats"]');
  await page.waitForTimeout(300);
  check("データ無しでドーナツ非表示", await page.locator(".stats-donut").count() === 0);
  check("データ無しでカレンダー非表示", await page.locator(".stats-cal").count() === 0);
  check("空メッセージが出る", (await page.locator("main").textContent()).includes("まだ十分なデータがありません"));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
