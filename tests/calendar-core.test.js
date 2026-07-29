// tests/calendar-core.test.js — カレンダービュー(W3=v188・第1弾は閲覧専用)の仕様ベースE2Eスイート。
// 機能別coreスイート方式。実装(未着手)より先に仕様から書いた。
// 設計の正: workbench/out/2026-07-29-today-cockpit-ideas/design-onetap-timetree.md
//   §3.4(schedule-inbox.json ファイル契約: generatedAtはT区切り秒あり・events[].label 4種)/
//   §3.6(カレンダービュー: 全4ラベル表示・凡例・月送り・当日+35日範囲・範囲外セル低輝度・
//   セルタップで予定詳細ポップオーバーまで=閲覧専用)/
//   §5裁定表 #10(タイムラインはこーじのみ・カレンダーに全ラベル)#12(終日予定はカレンダーでのみ見える)
//
// DOM契約(実装側と共有):
//   - ビューid "calendar"(サイドバー .nav-button[data-action="nav"][data-view="calendar"]、ラベル「カレンダー」)
//   - 月間グリッド .calendar-grid / 日セル .calendar-day[data-date="YYYY-MM-DD"] /
//     予定チップ .calendar-chip[data-label] / 凡例 .calendar-legend /
//     月送り data-action="calendar-prev-month" / "calendar-next-month" /
//     範囲外(当日+35日の外)の日セル .is-out-of-range / セルタップで .calendar-popover
//
// 前提(実装と食い違った場合はテストを弱めるのではなく、前提の側を実装と突合して直すこと):
//   前提C1: schedule-inbox.json は Contents API 経路(パス末尾 /contents/taskchute/schedule-inbox.json)
//          で取得される(today-core.test.js 前提W1-11と同一契約)
//   前提C2: 月間グリッドは表示月の全日を .calendar-day[data-date] で持つ(隣接月の埋めセルの
//          有無・数は契約にしない。検証は data-date 指名で行う)
//   前提C3: セル内チップは当該日の予定全件を描画する(第1弾は「+n件」等の省略表示なし)
//   前提C4: ラベル4色はチップの computed style(backgroundColor / borderColor / color のいずれか)に
//          現れ、4ラベルで互いに異なる組になる
//   前提C5: 月送りは表示月だけを変え、state.selectedDate を変えない(閲覧専用ビューが
//          今日ビュー・タイムラインの選択日を汚さない)
//   前提C6: ポップオーバーには当該日の予定タイトルが表示される
//
// 体裁: today-core.test.js と同じブラウザE2E流儀(randomPort / serviceWorkers:"block" /
// localStorage直接seed / page.clock.setFixedTime / blockGithubApiByDefault + 後発page.routeのモック)。
// 日時はすべて数値引数のDateコンストラクタとISO文字列リテラルで組み立てる(new Date("文字列")禁止)。
// 固定waitは使わず selector / waitForFunction / waitForResponse で成立を待つ。
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

  // 固定現在時刻 = 今日の12:00:00。日付は数値引数コンストラクタからのみ組み立てる
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(12, 0, 0, 0);
  const TODAY = toISO(now0);
  const TOMORROW = toISO(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() + 1));
  // 当月内に必ず収まる「2日目」(月末実行でも決定論: 明日が翌月なら当日に倒してチップを同居させる)
  const D2 = TOMORROW.slice(0, 7) === TODAY.slice(0, 7) ? TOMORROW : TODAY;
  const NEXT_MONTH_FIRST = toISO(new Date(now0.getFullYear(), now0.getMonth() + 1, 1));
  // 範囲外検証用: 当日+40日(schedule-inboxの範囲=当日+35日の外側。§3.6「範囲外の日セルは低輝度」)
  const beyond0 = new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() + 40);
  const BEYOND = toISO(beyond0);
  const BEYOND_MONTH_DIFF = (beyond0.getFullYear() - now0.getFullYear()) * 12 + (beyond0.getMonth() - now0.getMonth());

  // schedule-inbox.json フィクスチャ(§3.4契約どおり。全4ラベル各1件+こーじ終日=裁定#12の検証用)
  const inboxFx = { status: 200 };
  const SCHEDULE_INBOX = {
    generatedAt: `${TODAY}T07:00:00`,  // 当日朝生成=鮮度内(T区切り秒あり。FORMAT_CONTRACT整合)
    events: [
      { externalId: "cal-koji-1", title: "CAL-こーじ-通院", date: TODAY, startAt: "16:00", endAt: "17:00", allDay: false, label: "こーじ", calendarName: "家族" },
      { externalId: "cal-koji-allday", title: "CAL-こーじ-終日", date: TODAY, startAt: "00:00", endAt: "00:00", allDay: true, label: "こーじ", calendarName: "家族" },
      { externalId: "cal-midori-1", title: "CAL-翠-習い事", date: TODAY, startAt: "15:00", endAt: "16:00", allDay: false, label: "翠", calendarName: "家族" },
      { externalId: "cal-yotei-1", title: "CAL-予定-ゴミ出し", date: D2, startAt: "08:00", endAt: "08:30", allDay: false, label: "予定", calendarName: "家族" },
      { externalId: "cal-date-1", title: "CAL-デート-映画", date: D2, startAt: "19:00", endAt: "21:00", allDay: false, label: "デート", calendarName: "家族" }
    ]
  };
  // blockGithubApiByDefault(既定404)より後に登録するのでこちらが優先される(前提C1)
  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p.endsWith("/contents/taskchute/schedule-inbox.json")) {
      if (inboxFx.status !== 200) return route.fulfill({ status: inboxFx.status, body: "not found" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE_INBOX) });
    }
    return route.fallback();
  });

  // localStorage直接seed → reload(today-core.test.jsのseed()と同じ流儀)
  async function seed({ blocks = [], view = "calendar", settings = {} } = {}) {
    await page.evaluate(({ KEY, blocks, view, settings, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.currentView = view;
      s.selectedDate = TODAY;
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      Object.assign(s.settings, settings);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, view, settings, TODAY });
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function currentDataView() {
    return page.evaluate(() => document.getElementById("app").dataset.view);
  }
  async function waitView(view) {
    await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
  }

  const LABELS = ["こーじ", "予定", "翠", "デート"];
  const chipSel = (label) => `.calendar-grid .calendar-chip[data-label="${label}"]`;
  const daySel = (dateISO) => `.calendar-grid .calendar-day[data-date="${dateISO}"]`;

  try {
    await page.clock.setFixedTime(now0);

    // ============================================================
    // [1] ナビ遷移: サイドバー「カレンダー」→ view id "calendar"・当月グリッドが描画される
    // ============================================================
    console.log("[1] サイドバーの「カレンダー」から calendar ビューへ遷移でき、当月グリッドと凡例が描画される");
    await page.goto(`http://localhost:${PORT}/`);
    // 新規プロファイル = トークン未設定なのでまずゲートが出る(既存挙動)。通過してから検証する。
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);
    check("サイドバーに calendar のナビボタンがある(DOM契約)",
      await page.locator('#sidebar .nav-button[data-action="nav"][data-view="calendar"]').count() === 1);
    check("ナビボタンのラベルが「カレンダー」を含む",
      ((await page.locator('#sidebar .nav-button[data-view="calendar"]').textContent()) || "").includes("カレンダー"));
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="calendar"]').click();
    await waitView("calendar");
    check("クリックで calendar ビューが表示される(view id 'calendar')", (await currentDataView()) === "calendar");
    check("サイドバーの calendar ボタンが active になる",
      await page.locator('#sidebar .nav-button[data-view="calendar"].active').count() === 1);
    await page.waitForSelector(".calendar-grid", { state: "attached" });
    check("月間グリッド .calendar-grid が描画される(DOM契約)", await page.locator(".calendar-grid").count() === 1);
    check("初期表示は当月(今日の日セル .calendar-day[data-date=今日] がある。前提C2)",
      await page.locator(daySel(TODAY)).count() === 1);
    check("凡例 .calendar-legend が描画される(DOM契約)", await page.locator(".calendar-legend").count() === 1);
    check("月送りボタン(calendar-prev-month / calendar-next-month)がある(DOM契約)",
      await page.locator('[data-action="calendar-prev-month"]').count() >= 1
      && await page.locator('[data-action="calendar-next-month"]').count() >= 1);

    // ============================================================
    // [2] 全4ラベルのチップ表示 — こーじ/予定/翠/デート各1件+こーじ終日(裁定#10・#12)
    // ============================================================
    console.log("[2] 全4ラベルの予定チップが日セルに出る。終日こーじ予定もカレンダーには出る(裁定#12)");
    await seed({ view: "calendar" });
    await waitView("calendar");
    await page.waitForSelector(chipSel("こーじ"), { state: "attached" });
    for (const label of LABELS) {
      check(`ラベル「${label}」のチップ .calendar-chip[data-label] が表示される(全4ラベル表示。裁定#10)`,
        await page.locator(chipSel(label)).count() >= 1);
    }
    check("こーじの終日予定(allDay)もカレンダーには出る(こーじチップ=時間帯1+終日1の2枚。裁定#12)",
      await page.locator(chipSel("こーじ")).count() === 2,
      String(await page.locator(chipSel("こーじ")).count()));
    check("チップは予定の日付のセル内に置かれる(こーじ・翠=今日のセル。前提C2/C3)",
      await page.locator(`${daySel(TODAY)} .calendar-chip[data-label="こーじ"]`).count() === 2
      && await page.locator(`${daySel(TODAY)} .calendar-chip[data-label="翠"]`).count() === 1);
    check("予定・デートのチップもその日付のセル内に置かれる",
      await page.locator(`${daySel(D2)} .calendar-chip[data-label="予定"]`).count() === 1
      && await page.locator(`${daySel(D2)} .calendar-chip[data-label="デート"]`).count() === 1);
    check("カレンダー表示ではBlock化されない(閲覧専用。externalRef付きBlockが1件も無い)",
      ((await stateNow()).blocks || []).every((b) => !b.externalRef));

    // ============================================================
    // [3] 凡例4色 — 凡例に4ラベル名が出て、チップ配色が4ラベルで互いに異なる(§3.6)
    // ============================================================
    console.log("[3] 凡例に4ラベルすべてが表示され、チップ配色が4ラベルで互いに異なる");
    const legendText = await page.evaluate(() => document.querySelector(".calendar-legend")?.textContent ?? "");
    check("凡例に4ラベルすべての名前が表示される(ラベル別の色は凡例に固定表示。§3.6)",
      LABELS.every((l) => legendText.includes(l)), legendText);
    const chipStyles = await page.evaluate((labels) => labels.map((label) => {
      const el = document.querySelector(`.calendar-grid .calendar-chip[data-label="${label}"]`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return `${cs.backgroundColor}|${cs.borderColor}|${cs.color}`;
    }), LABELS);
    check("4ラベルのチップ配色(background/border/colorの組)が互いに異なる(4色割り当て。前提C4)",
      chipStyles.every(Boolean) && new Set(chipStyles).size === 4, JSON.stringify(chipStyles));

    // ============================================================
    // [4] 月送り — 翌月表示→前月で当月へ戻る。selectedDate は変えない(前提C5)
    // ============================================================
    console.log("[4] 月送り: next で翌月グリッドになり、prev で当月へ戻る。state.selectedDate は変わらない");
    const selectedDateBeforeNav = (await stateNow()).selectedDate;
    await page.locator('[data-action="calendar-next-month"]').first().click();
    await page.waitForSelector(daySel(NEXT_MONTH_FIRST), { state: "attached" });
    check("calendar-next-month で翌月のグリッドが表示される(翌月1日のセルが現れる)", true);
    await page.locator('[data-action="calendar-prev-month"]').first().click();
    await page.waitForSelector(daySel(TODAY), { state: "attached" });
    check("calendar-prev-month で当月へ戻る(今日のセルが再び現れる)", true);
    check("月送りしても今日のチップが再描画される(表示月の切替はデータを壊さない)",
      await page.locator(`${daySel(TODAY)} .calendar-chip[data-label="こーじ"]`).count() === 2);
    check("月送りで state.selectedDate が変わらない(閲覧専用ビューが選択日を汚さない。前提C5)",
      (await stateNow()).selectedDate === selectedDateBeforeNav,
      `${selectedDateBeforeNav}→${(await stateNow()).selectedDate}`);

    // ============================================================
    // [5] 当日+35日の範囲外セル — 今日は範囲内、当日+40日のセルは .is-out-of-range(§3.6)
    // ============================================================
    console.log("[5] 範囲: 今日のセルは範囲内、当日+40日のセルには .is-out-of-range が付きチップも出ない");
    check("今日のセルに .is-out-of-range が付かない(当日は範囲内)",
      await page.locator(`${daySel(TODAY)}.is-out-of-range`).count() === 0
      && await page.locator(daySel(TODAY)).count() === 1);
    // 当日+40日の月まで月送り(1〜2回。回数は日付から決定論で算出)
    for (let i = 1; i <= BEYOND_MONTH_DIFF; i++) {
      const firstOfMonth = toISO(new Date(now0.getFullYear(), now0.getMonth() + i, 1));
      await page.locator('[data-action="calendar-next-month"]').first().click();
      await page.waitForSelector(daySel(firstOfMonth), { state: "attached" });
    }
    check("当日+40日(範囲=当日+35日の外)のセルに .is-out-of-range が付く(低輝度セル。§3.6)",
      await page.locator(`${daySel(BEYOND)}.is-out-of-range`).count() === 1);
    check("範囲外セルにはチップが出ない(データが無いことを正直に見せる。§3.6)",
      await page.locator(`${daySel(BEYOND)} .calendar-chip`).count() === 0);

    // ============================================================
    // [6] セルタップ → 予定詳細ポップオーバー(閲覧のみ=state不変。§3.6第1弾)
    // ============================================================
    console.log("[6] 今日のセルタップで .calendar-popover に予定詳細が出る。state(blocks/tasks/projects)は不変");
    await seed({ view: "calendar" });  // 当月表示へ戻す(表示月はstate外のため再seedでリセット)
    await waitView("calendar");
    await page.waitForSelector(`${daySel(TODAY)} .calendar-chip[data-label="こーじ"]`, { state: "attached" });
    const snapBeforePopover = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ blocks: s.blocks, tasks: s.tasks, projects: s.projects });
    }, KEY);
    await page.locator(daySel(TODAY)).first().click();
    await page.waitForSelector(".calendar-popover", { state: "attached" });
    check("セルタップで予定詳細ポップオーバー .calendar-popover が開く(DOM契約)", true);
    const popoverText = await page.evaluate(() => document.querySelector(".calendar-popover")?.textContent ?? "");
    check("ポップオーバーに当該日の予定タイトルが出る(前提C6)",
      popoverText.includes("CAL-こーじ-通院") && popoverText.includes("CAL-翠-習い事"), popoverText);
    check("終日予定もポップオーバーに出る(カレンダービューでのみ見える。裁定#12)",
      popoverText.includes("CAL-こーじ-終日"), popoverText);
    const snapAfterPopover = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ blocks: s.blocks, tasks: s.tasks, projects: s.projects });
    }, KEY);
    check("ポップオーバー表示の前後で blocks/tasks/projects が不変(第1弾は閲覧専用=Block化なし。§3.6)",
      snapBeforePopover === snapAfterPopover);
    check("Block編集モーダルは開かない(カレンダーからのBlock化は第2弾候補=非目標)",
      await page.locator(".modal-card").count() === 0);

    // ============================================================
    // [7] フェイルソフト: schedule-inbox.json 404 でも空グリッドが描画される(pageerrorゼロ。§3.4)
    // ============================================================
    console.log("[7] schedule-inbox 404 でもカレンダーは空グリッドを描画し、pageerrorゼロ");
    const failuresBefore404 = failures;  // この区間のpageerror検出用(page.on('pageerror')が加算する)
    inboxFx.status = 404;
    const resp404 = page.waitForResponse((r) => r.url().includes("schedule-inbox.json"));
    await seed({ view: "calendar" });
    await resp404;
    await waitView("calendar");
    await page.waitForSelector(".calendar-grid", { state: "attached" });
    // 404応答後の描画反映猶予にマクロタスクを回してから不在を断定する(today-core [45b]と同手法)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("404でも .calendar-grid と当月の日セルが描画される(空グリッド。ファイル不在で一切エラーなし)",
      await page.locator(".calendar-grid").count() === 1
      && await page.locator(daySel(TODAY)).count() === 1
      && await page.locator(".calendar-grid .calendar-day").count() >= 28);
    check("404では予定チップが1枚も出ない", await page.locator(".calendar-grid .calendar-chip").count() === 0);
    check("[7]区間の描画で pageerror が発生しない", failures === failuresBefore404);
    inboxFx.status = 200;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
