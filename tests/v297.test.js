// v297 検証: TOWER(今日タブ)へBODY/MINDウィジェット(2軸身体スキャンの日次積み上げ+週推移)を追加。
// K要望2026-08-29「この数値の積み上げ状況を統合画面に表示したい」・モック
// workbench/out/2026-08-29-bodyscan-2axis/bodyscan-2axis-mock.html 画面2・画面3 承認済み。
// 表示専用(stateへの書き込みゼロ・同期無関係)。§8-1(a)〜(d)を網羅する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(12, 0, 0, 0);
  const dateISOof = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const TODAY = dateISOof(now0);
  const daysAgoISO = (n) => dateISOof(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - n));
  const at = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;

  function block(id, dateISO, hhmm, title) {
    return {
      id, taskId: "", date: dateISO, title, category: "",
      plannedStartAt: at(dateISO, hhmm), plannedEndAt: at(dateISO, hhmm), actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0, estimateMin: 30,
      recurrenceGroupId: "", orderIndex: 0, migratedTo: "", deleted: false,
      createdAt: at(dateISO, "00:00"), updatedAt: at(dateISO, "00:00")
    };
  }

  async function seed({ blocks = [], bodyScans = [], view = "today" } = {}) {
    await page.evaluate(({ KEY, blocks, bodyScans, view, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.bodyScans = bodyScans;
      s.currentView = view;
      s.selectedDate = TODAY;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, bodyScans, view, TODAY });
    await page.reload();
    await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
  }

  async function stateNow() {
    return page.evaluate((KEY) => localStorage.getItem(KEY), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction((KEY) => !!localStorage.getItem(KEY), KEY);
    await passGithubGate(page);

    // ============================================================
    // (a) 正例
    // ============================================================
    console.log("[1] 当日スキャン4件→Σ疲労/Σ回復/差引/内訳3件(直近優先)の表示値が正しい");
    await seed({
      blocks: [block("a", TODAY, "09:00", "対象A"), block("b", TODAY, "10:00", "対象B"),
        block("c", TODAY, "12:00", "対象C"), block("d", TODAY, "15:00", "対象D")],
      bodyScans: [
        { id: "s-a", dateTime: at(TODAY, "09:00"), fatigue: 2, recovery: 3, part: "", pomodoroBlockId: "a" },
        { id: "s-b", dateTime: at(TODAY, "10:00"), fatigue: 1, recovery: 1, part: "", pomodoroBlockId: "b" },
        { id: "s-c", dateTime: at(TODAY, "12:00"), fatigue: 3, recovery: 0, part: "肩", pomodoroBlockId: "c" },
        { id: "s-d", dateTime: at(TODAY, "15:00"), fatigue: 0, recovery: 2, part: "", pomodoroBlockId: "d" }
      ]
    });
    check("BODY/MINDウィジェットが描画される", await page.locator(".sec-bodymind").count() === 1);
    check("Σ疲労=6(2+1+3+0)", (await page.locator(".bm-row:nth-child(1) .bm-val").textContent()) === "Σ6");
    check("Σ回復=6(3+1+0+2)", (await page.locator(".bm-row:nth-child(2) .bm-val").textContent()) === "Σ6");
    const netText = await page.locator(".bm-net").textContent();
    check("差引0で「拮抗しています」と表示される", netText.includes("拮抗しています"), netText);
    const items = await page.locator(".bm-item").allTextContents();
    check("内訳ミニリストは3件(直近優先、最古のAは含まれない)",
      items.length === 3 && !items.some((t) => t.includes("対象A")), JSON.stringify(items));
    check("先頭行は直近(15:00・対象D・疲労0・回復2)", /15:00/.test(items[0]) && items[0].includes("対象D")
      && items[0].includes("疲労0") && items[0].includes("回復2"), items[0]);
    check("2番目の行に部位付き(対象C・疲労3・回復0・肩)が出る",
      items[1].includes("対象C") && items[1].includes("（肩）") && items[1].includes("疲労3") && items[1].includes("回復0"), items[1]);

    console.log("[2] 見出しタップで週推移展開→7日分(今日含む)の日別Σ疲労/Σ回復が表示される");
    // 前日〜6日前へ既知の値を仕込む(今日はfat=6/rec=6=[1]と同じ)
    const weekBodyScans = [
      { id: "s-a", dateTime: at(TODAY, "09:00"), fatigue: 2, recovery: 3, part: "", pomodoroBlockId: "a" },
      { id: "s-b", dateTime: at(TODAY, "10:00"), fatigue: 1, recovery: 1, part: "", pomodoroBlockId: "b" },
      { id: "s-c", dateTime: at(TODAY, "12:00"), fatigue: 3, recovery: 0, part: "肩", pomodoroBlockId: "c" },
      { id: "s-d", dateTime: at(TODAY, "15:00"), fatigue: 0, recovery: 2, part: "", pomodoroBlockId: "d" }
    ];
    for (let i = 1; i <= 6; i++) {
      const d = daysAgoISO(i);
      weekBodyScans.push({ id: `s-past-${i}`, dateTime: at(d, "09:00"), fatigue: i, recovery: i === 3 ? null : 6 - i, part: "", pomodoroBlockId: "" });
    }
    await seed({
      blocks: [block("a", TODAY, "09:00", "対象A"), block("b", TODAY, "10:00", "対象B"),
        block("c", TODAY, "12:00", "対象C"), block("d", TODAY, "15:00", "対象D")],
      bodyScans: weekBodyScans
    });
    check("展開前は週推移(.bm-weekly)が無い", await page.locator(".bm-weekly").count() === 0);
    check("トグルはaria-expanded=false", await page.locator(".bm-toggle").getAttribute("aria-expanded") === "false");
    await page.click(".bm-toggle");
    await page.waitForSelector(".bm-weekly", { state: "attached" });
    check("展開後はaria-expanded=true", await page.locator(".bm-toggle").getAttribute("aria-expanded") === "true");
    check("週推移の列は7日分(今日含む)", await page.locator(".bm-col").count() === 7);
    const cols = await page.evaluate(() => [...document.querySelectorAll(".bm-col")].map((el) => ({
      date: el.dataset.date, fat: Number(el.dataset.fat), rec: Number(el.dataset.rec), isToday: el.classList.contains("is-today")
    })));
    const todayCol = cols.find((c) => c.date === TODAY);
    check("今日の列がfat=6/rec=6でis-today", !!todayCol && todayCol.fat === 6 && todayCol.rec === 6 && todayCol.isToday,
      JSON.stringify(todayCol));
    const past3 = cols.find((c) => c.date === daysAgoISO(3));
    check("3日前の列(recovery=null仕込み)はfat=3・rec=0(nullは0扱いされない=Σに未算入)",
      !!past3 && past3.fat === 3 && past3.rec === 0, JSON.stringify(past3));
    const past1 = cols.find((c) => c.date === daysAgoISO(1));
    check("1日前の列はfat=1・rec=5", !!past1 && past1.fat === 1 && past1.rec === 5, JSON.stringify(past1));
    await page.click(".bm-toggle");
    await page.waitForSelector(".bm-weekly", { state: "detached" });
    check("再タップで週推移が閉じる", await page.locator(".bm-weekly").count() === 0);

    // ============================================================
    // (b) 負例
    // ============================================================
    console.log("[3] 当日スキャン0件→ウィジェットは空状態表示(トグル不可)");
    await seed({ blocks: [], bodyScans: [{ id: "s-yesterday", dateTime: at(daysAgoISO(1), "09:00"), fatigue: 3, recovery: 3, part: "", pomodoroBlockId: "" }] });
    check("BODY/MINDウィジェット自体は描画される", await page.locator(".sec-bodymind").count() === 1);
    const emptyText = await page.locator(".bm-empty").textContent();
    check("「今日の記録はまだありません」と事実表現で表示される(責め語彙なし)", emptyText.includes("まだありません"), emptyText);
    check("0件時は見出しタップ(週推移トグル)自体が存在しない", await page.locator(".bm-toggle").count() === 0);
    check("バー・内訳リストも描画されない", await page.locator(".bm-bars, .bm-list").count() === 0);

    console.log("[4] recovery=nullの過去形式レコードが混在してもΣ回復に算入されず、件数注記が出る");
    await seed({
      blocks: [block("g1", TODAY, "08:00", "対象G1"), block("g2", TODAY, "09:00", "対象G2")],
      bodyScans: [
        { id: "legacy", dateTime: at(TODAY, "08:00"), fatigue: 4, part: "", pomodoroBlockId: "g1" },  // recoveryキー無し
        { id: "valid", dateTime: at(TODAY, "09:00"), fatigue: 1, recovery: 2, part: "", pomodoroBlockId: "g2" }
      ]
    });
    check("Σ疲労=5(4+1、両方とも算入)", (await page.locator(".bm-row:nth-child(1) .bm-val").textContent()) === "Σ5");
    check("Σ回復=2(recovery=nullのlegacyは算入されない)", (await page.locator(".bm-row:nth-child(2) .bm-val").textContent()) === "Σ2");
    const netText4 = await page.locator(".bm-net").textContent();
    check("件数注記(回復記録1/2件)が出る", netText4.includes("回復記録 1/2件"), netText4);
    const items4 = await page.locator(".bm-item").allTextContents();
    const legacyRow = items4.find((t) => t.includes("対象G1"));
    check("legacyレコードの回復タグは「—」表示(0と混同しない)", !!legacyRow && legacyRow.includes("回復—"), legacyRow);

    console.log("[5] 表示専用: 週推移トグルをタップしてもstateは一切変化しない(開閉トグル以外)");
    await seed({
      blocks: [block("a", TODAY, "09:00", "対象A")],
      bodyScans: [{ id: "s-a", dateTime: at(TODAY, "09:00"), fatigue: 2, recovery: 3, part: "", pomodoroBlockId: "a" }]
    });
    const beforeState = await stateNow();
    await page.click(".bm-toggle");
    await page.waitForSelector(".bm-weekly", { state: "attached" });
    const afterOpenState = await stateNow();
    check("週推移を開いてもlocalStorage上のstateは1バイトも変化しない", beforeState === afterOpenState);
    await page.click(".bm-toggle");
    await page.waitForSelector(".bm-weekly", { state: "detached" });
    const afterCloseState = await stateNow();
    check("週推移を閉じてもlocalStorage上のstateは1バイトも変化しない", beforeState === afterCloseState);

    // ============================================================
    // (d) 退行
    // ============================================================
    console.log("[6] 既存TOWER節(FLIGHT LOG/GATE/ARRIVALS)がBODY/MIND追加後も無改修で描画される");
    await seed({
      blocks: [
        { ...block("r1", TODAY, "07:00", "実績1"), completed: true, actualStartAt: at(TODAY, "07:00"), actualEndAt: at(TODAY, "07:30") }
      ],
      bodyScans: [{ id: "s-r1", dateTime: at(TODAY, "07:15"), fatigue: 1, recovery: 4, part: "", pomodoroBlockId: "r1" }]
    });
    check("NOW LANDING(滑走路)節が生存", await page.locator(".tower-runway").count() === 1);
    check("ARRIVALS節が生存", await page.locator(".tower-board").count() === 1);
    check("FLIGHT LOG節が生存し実績1件を含む", (await page.locator(".sec-log").textContent()).includes("実績1"));
    check("GATE ROUTINE節が生存", await page.locator(".tower-gates").count() === 1);
    check("BODY/MINDはFLIGHT LOGの後・JOURNALより前の順で描画される(order:5)",
      await page.evaluate(() => {
        const log = document.querySelector(".sec-log");
        const bm = document.querySelector(".sec-bodymind");
        if (!log || !bm) return false;
        return getComputedStyle(bm).order === "5" && Number(getComputedStyle(log).order) < 5;
      }));

    console.log("[7] 390px幅で横スクロールが発生しない(BODY/MINDウィジェット込み)");
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForSelector(".sec-bodymind", { state: "attached" });
    const widths = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    check("390px幅で横スクロールが発生しない(scrollWidth<=clientWidth+1)",
      widths.scrollWidth <= widths.clientWidth + 1, JSON.stringify(widths));
    await page.setViewportSize({ width: 1100, height: 1400 });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
