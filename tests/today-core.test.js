// tests/today-core.test.js — 「今日」コックピットビュー(B1 = P1〜P4)の仕様ベースE2Eスイート。
// 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md §4(ビュー仕様・ライブ更新原則)と
// §7 P1〜P4行の完了条件。実装(別担当が並行作業中)とは独立に、以下のDOM契約だけを前提に書いた:
//   - ビューid "today"(render()が #app の data-view に反映する既存パターン)
//   - ナビ遷移は既存 data-action="nav" data-view="today"(サイドバー .nav-button / #bottomNav button)
//   - パネルroot: .today-now-focus / .today-next-queue / .today-day-gauge / .today-routine / .today-flight-plan
//   - ヘッダ時計: #todayClock(今日ビュー内のみ = #main配下。ビューを離れるとDOMごと消える)
//   - NOW FOCUSの完了ボタンは既存アクション data-action="complete-block-with-actual" の実名再利用
//     (既存挙動 = 実績登録モーダル(actualEntry)が開き、modal-save で actualEndAt + completed が付く)
//
// 検証観点(§7 P1〜P4完了条件から):
//   [1] 新規state(seedState)の起動ビューが today(D3)+ 5パネル・時計が描画される
//   [2] 既存stateは最後のビュー復元が壊れない(currentView復元の後方互換)
//   [3] normalizeState が未知の currentView を "home" へ補完する(D3・§8-4)
//   [4] サイドバーから today へ遷移できる
//   [5] bottom-nav(モバイル幅)から today へ遷移できる(D2)
//   [5b] home滞在時はbottom-navの「その他」がactiveになる(D2)
//   [6] #todayClock が毎秒tickし、固定時刻の前進へ追随する(§4ライブ更新原則)
//   [7] ビューを離れると ticker が停止する(離脱後に #todayClock 相当のDOM更新が起きない)+ 再入場で再開
//   [8] NOW FOCUS: 実行中Block(actualStartAt && !actualEndAt)のタイトル表示・複数あれば最新開始・経過が進む
//   [9] NOW FOCUS: 完了ボタン → 既存実績登録モーダル保存で block に actualEndAt が付き completed になる
//   [9b] modal-saveの全再描画後もtickerが時計・経過表示を更新し続ける(C1)
//   [10] NEXT QUEUE: 未着手Blockが plannedStartAt→orderIndex 順に最大5件(着手済み・完了は出ない)
//   [11] DAY GAUGE: 完了n/総数が state からの期待値と一致(deleted除外)
//   [12] ROUTINE: 時間帯別 done/total の合計が routineRate 相当(カテゴリ"ルーティン"のcompleted集計)と一致(D5・A7)
//   [13] FLIGHT PLAN: 当日Block 0件でもエラーなく5パネルが描画される
//   [13b] 深夜跨ぎBlockが当日24:00までの幅で描画される
//   [13c] 同時刻開始Blockが別レーンに配置され、両方の編集モーダルを開ける
//   [14] cockpit CSS変数(P1先行定義)が light/dark テーマの見た目に影響しない(D10・§6)
//
// 作法: v161.test.js / v150.test.js / timeline-tick-wiring.test.js と同じ
// (ブラウザ操作 + serviceWorkers:"block" + localStorage直接seed + page.clock.setFixedTime)。
// 日時はすべてISO文字列リテラルで組み立てる(new Date("文字列") 禁止、§8-2)。
// 新しい固定waitは原則使わず selector / waitForFunction で成立を待つ。例外は[7]の
// 「tickerが止まっている」負の検証のみ(ticker周期1秒そのものが仕様(§4)のため、
// 2周期分を実時間で待って「更新が起きない」ことを確認する。CLAUDE.mdの例外条件に該当)。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const ROOT = path.join(__dirname, "..");
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

  // 固定現在時刻 = 今日の12:00:00(ISO文字列はここから組み立てる。new Date("文字列")は使わない)
  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(12, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const tomorrow0 = new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() + 1);
  const TOMORROW = `${tomorrow0.getFullYear()}-${pad2(tomorrow0.getMonth() + 1)}-${pad2(tomorrow0.getDate())}`;
  const at = (hhmm) => `${TODAY}T${hhmm}:00`;  // "09:00" → "YYYY-MM-DDT09:00:00"
  const fixedTime = (h, m, s = 0) => new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), h, m, s, 0);

  // Blockフィクスチャ(makeBlockの主要フィールドと同形。normalizeStateが残りを補完する前提)
  const block = (id, extra = {}) => ({
    id, taskId: "", date: TODAY, title: id, category: "",
    plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "",
    completed: false, charge: 0, discharge: 0, estimateMin: 30,
    recurrenceGroupId: "", orderIndex: 0, migratedTo: "", deleted: false,
    createdAt: at("00:00"), updatedAt: at("00:00"), ...extra
  });

  // localStorage直接seed → reload(v150.test.jsのseed()と同じ流儀。固定waitではなくnavの出現を待つ)
  async function seed({ blocks = [], view = "today", settings = {} } = {}) {
    await page.evaluate(({ KEY, blocks, view, settings, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.currentView = view;
      s.selectedDate = TODAY;
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.settings.todaySkin = "cockpit";
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
  async function panelText(selector) {
    return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, selector);
  }

  const PANELS = [".today-now-focus", ".today-next-queue", ".today-day-gauge", ".today-routine", ".today-flight-plan"];

  try {
    await page.clock.setFixedTime(now0);

    // ============================================================
    // [1] 新規state(seedState)の起動ビューが today(D3)
    // ============================================================
    console.log("[1] 新規state(seedState)の起動ビューが today で、tower既定が描画される(v211)");
    await page.goto(`http://localhost:${PORT}/`);
    // 新規プロファイル = トークン未設定なのでまずゲートが出る(既存挙動)。通過後に起動ビューを判定する。
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);
    check("seedState(新規state)の起動ビューが today になる(D3)", (await currentDataView()) === "today", await currentDataView());
    check("tower root .today-tower が描画される", await page.locator(".today-tower").count() === 1);
    const towerDayLeft = (await page.locator("#towerDayLeft").textContent()) || "";
    check("#towerDayLeft が描画されHH:MM:SS形式", /^\d{2}:\d{2}:\d{2}$/.test(towerDayLeft), towerDayLeft);

    // ============================================================
    // [2] 既存stateは最後のビュー復元が壊れない
    // ============================================================
    console.log("[2] 既存stateの currentView(既知ビュー)は従来どおり復元される");
    await seed({ view: "stats" });
    check("currentView='stats' がそのまま復元される(today導入で既存復元が壊れない)",
      (await currentDataView()) === "stats", await currentDataView());

    // ============================================================
    // [3] normalizeState が未知の currentView を "home" へ補完する
    // ============================================================
    console.log("[3] 未知の currentView は normalizeState が 'home' へ補完する(旧app.jsとの相互事故防止、D3)");
    await seed({ view: "no-such-view-v999" });
    check("未知view('no-such-view-v999')が 'home' に補完される", (await currentDataView()) === "home", await currentDataView());
    check("補完後のhomeビューが空画面にならない(renderMainのif羅列・else無し対策 §8-4)",
      await page.evaluate(() => document.getElementById("main").innerHTML.trim().length > 0));

    // ============================================================
    // [4] サイドバーから today へ遷移できる
    // ============================================================
    console.log("[4] サイドバー(.nav-button)から today へ遷移できる");
    await seed({ view: "home" });
    check("サイドバーに today のナビボタンがある",
      await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').count() === 1);
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').click();
    await waitView("today");
    check("クリックで today ビューが表示される", (await currentDataView()) === "today");
    check("遷移後にNOW FOCUSパネルが存在する", await page.locator(".today-now-focus").count() === 1);
    check("サイドバーの today ボタンが active になる",
      await page.locator('#sidebar .nav-button[data-view="today"].active').count() === 1);

    // ============================================================
    // [5] bottom-nav(モバイル幅)から today へ遷移できる(D2)
    // ============================================================
    console.log("[5] bottom-nav(モバイル幅390px)から today へ遷移できる");
    await page.setViewportSize({ width: 390, height: 844 });
    await seed({ view: "tasks" });
    check("bottom-nav に today ボタンがある(D2: mobileNav先頭差替え)",
      await page.locator('#bottomNav button[data-action="nav"][data-view="today"]').count() === 1);
    await page.locator('#bottomNav button[data-action="nav"][data-view="today"]').click();
    await waitView("today");
    check("bottom-nav から today ビューへ遷移できる", (await currentDataView()) === "today");
    check("bottom-nav の today ボタンが active になる",
      await page.locator('#bottomNav button[data-view="today"].active').count() === 1);
    console.log("[5b] home画面滞在時はbottom-navの「その他」がactiveになる(D2)");
    await seed({ view: "home" });
    check("home滞在時はbottom-navの「その他」がactiveになる",
      await page.locator('#bottomNav button[data-view="more"].active').count() === 1);
    await page.setViewportSize({ width: 1100, height: 1400 });

    // ============================================================
    // [6] #todayClock が毎秒tickし、固定時刻の前進へ追随する
    // ============================================================
    console.log("[6] #todayClock が tick で進む(page.clockの固定時刻を前進させ、reload・クリック無しで表示が追随する)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ view: "today" });
    await page.waitForFunction(() => (document.getElementById("todayClock")?.textContent || "").includes("12:00"));
    check("固定時刻12:00:00で時計に '12:00' が表示される", true);
    // 固定時刻を12:01:05へ前進(実タイマーは動き続けるため、1秒周期のtickerが新時刻を拾って書き換える)
    await page.clock.setFixedTime(fixedTime(12, 1, 5));
    await page.waitForFunction(() => (document.getElementById("todayClock")?.textContent || "").includes("12:01"));
    check("固定時刻の前進(+65秒)が reload なしで時計表示へ反映される(tickerが生きている証拠)", true);

    // ============================================================
    // [7] ビューを離れると ticker が停止する + 再入場で再開する
    // ============================================================
    console.log("[7] today を離れると ticker が停止し(おとり#todayClockが書き換えられない)、再入場で再開する");
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    check("ビュー離脱で #todayClock がDOMから消える(時計はtodayビュー内のみ)",
      await page.locator("#todayClock").count() === 0);
    // 離脱直後のtickが自分でclearIntervalする猶予として、まずticker 1周期分を実時間で待つ
    // (固定wait例外: ticker周期1秒そのものが仕様(§4)。この待機と次の待機のみ)
    await page.waitForTimeout(1300);
    // おとり: 同idの要素を注入し、tickerが生きていれば毎秒の再取得(getElementById)で
    // 書き換えられてしまうはず。2周期分待っても書き換わらなければ停止している。
    await page.evaluate(() => {
      const decoy = document.createElement("span");
      decoy.id = "todayClock";
      decoy.textContent = "DECOY-v-today";
      document.getElementById("main").appendChild(decoy);
    });
    await page.clock.setFixedTime(fixedTime(12, 3, 0));
    await page.waitForTimeout(2300);  // 固定wait例外(上記コメント参照): 負の検証はticker 2周期分の実時間経過が必要
    check("離脱後は ticker が停止している(おとり#todayClockが2周期経っても書き換えられない)",
      (await page.evaluate(() => document.getElementById("todayClock")?.textContent)) === "DECOY-v-today");
    await page.evaluate(() => document.getElementById("todayClock")?.remove());
    // 再入場: tickerが再開し、新しい固定時刻(12:03)が表示される
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').click();
    await waitView("today");
    await page.waitForFunction(() => (document.getElementById("todayClock")?.textContent || "").includes("12:03"));
    check("再入場で ticker が再開し現在の固定時刻(12:03)を表示する", true);

    // ============================================================
    // [8] NOW FOCUS: 実行中Blockのタイトル表示・最新開始優先・経過が進む
    // ============================================================
    console.log("[8] NOW FOCUS: 実行中Block(actualStartAt && !actualEndAt)のタイトルが表示され、複数あれば最新開始、経過表示が進む");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      blocks: [
        block("nf-early", { title: "NF-EARLY-古い実行中", actualStartAt: at("09:00"), plannedStartAt: at("09:00"), plannedEndAt: at("10:00"), estimateMin: 60 }),
        block("nf-late", { title: "NF-LATE-最新実行中", actualStartAt: at("10:30"), plannedStartAt: at("10:30"), plannedEndAt: at("11:30"), estimateMin: 60 }),
        block("nf-queued", { title: "NF-QUEUED-未着手", plannedStartAt: at("14:00"), plannedEndAt: at("14:30") })
      ]
    });
    await page.waitForSelector(".today-now-focus", { state: "attached" });
    const nfText = await panelText(".today-now-focus");
    check("実行中Blockのうち最新開始(10:30開始)のタイトルが NOW FOCUS に表示される",
      (nfText || "").includes("NF-LATE-最新実行中"), nfText);
    check("より古い実行中Block(09:00開始)は NOW FOCUS の対象にならない",
      !(nfText || "").includes("NF-EARLY-古い実行中"), nfText);
    // 経過タイマー: 固定時刻を+65秒進めると、reload無しでパネル内テキスト(経過表示)が変わる
    await page.clock.setFixedTime(fixedTime(12, 1, 5));
    await page.waitForFunction((prev) => {
      const el = document.querySelector(".today-now-focus");
      return el && el.textContent !== prev;
    }, nfText);
    check("固定時刻+65秒で NOW FOCUS の経過表示が reload なしで更新される(毎秒tick)", true);

    // ============================================================
    // [9] NOW FOCUS: 完了ボタン → 既存実績登録モーダル保存で actualEndAt + completed
    // ============================================================
    console.log("[9] NOW FOCUS の完了ボタン(data-action='complete-block-with-actual')で既存アクションと同結果になる");
    check("NOW FOCUS 内に complete-block-with-actual の完了ボタンがある(既存アクションの実名再利用)",
      await page.locator('.today-now-focus [data-action="complete-block-with-actual"]').count() >= 1);
    await page.locator('.today-now-focus [data-action="complete-block-with-actual"]').first().click();
    // 既存挙動: 実績登録モーダル(actualEntry)が開く。保存で actualEndAt + completed が付く。
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("既存の実績登録モーダルが開く(新規ビジネスロジックを作らない検証)",
      await page.locator('.modal-title:has-text("実績を登録")').count() === 1);
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const b = s.blocks.find((x) => x.id === "nf-late");
      return b && b.completed === true && !!b.actualEndAt;
    }, KEY);
    const stAfterComplete = await stateNow();
    const nfLate = stAfterComplete.blocks.find((b) => b.id === "nf-late");
    check("保存後 block に actualEndAt が付く", !!nfLate.actualEndAt, JSON.stringify(nfLate));
    check("保存後 block が completed になる(既存 saveActualEntryFromModal と同結果)", nfLate.completed === true);
    console.log("[9b] modal-saveの全再描画後もtickerが新DOMの時計・経過表示を更新し続ける(C1)");
    await page.waitForSelector("#todayNowElapsed", { state: "attached" });
    const elapsedAfterSave = await page.locator("#todayNowElapsed").textContent();
    await page.clock.setFixedTime(fixedTime(12, 2, 10));
    await page.waitForFunction((previousElapsed) => {
      const clock = document.getElementById("todayClock");
      const elapsed = document.getElementById("todayNowElapsed");
      return (clock?.textContent || "").includes("12:02") && elapsed?.textContent !== previousElapsed;
    }, elapsedAfterSave);
    check("modal-save後も時計が固定時刻12:02へ進む(tickerが新DOMを毎tick再取得)", true);
    check("modal-save後もNOW FOCUSの経過表示が再び進む",
      (await page.locator("#todayNowElapsed").textContent()) !== elapsedAfterSave);

    // ============================================================
    // [10] NEXT QUEUE: plannedStartAt→orderIndex 順に最大5件
    // ============================================================
    console.log("[10] NEXT QUEUE: 未着手Blockが plannedStartAt→orderIndex 順に最大5件表示され、着手済み・完了は出ない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      blocks: [
        // 意図的に順不同でseedする(表示側のソートを検証するため)
        block("q-e", { title: "QN-E-1200", plannedStartAt: at("12:00"), plannedEndAt: at("12:30") }),
        block("q-a", { title: "QN-A-0900", plannedStartAt: at("09:00"), plannedEndAt: at("09:30") }),
        block("q-d", { title: "QN-D-1100b", plannedStartAt: at("11:00"), plannedEndAt: at("11:30"), orderIndex: 2 }),
        block("q-c", { title: "QN-C-1100a", plannedStartAt: at("11:00"), plannedEndAt: at("11:30"), orderIndex: 1 }),
        block("q-b", { title: "QN-B-1000", plannedStartAt: at("10:00"), plannedEndAt: at("10:30") }),
        block("q-f", { title: "QN-F-1300-6件目", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") }),
        block("q-g", { title: "QN-G-1400-7件目", plannedStartAt: at("14:00"), plannedEndAt: at("14:30") }),
        block("q-run", { title: "QN-RUN-実行中", plannedStartAt: at("08:00"), actualStartAt: at("08:00") }),
        block("q-done", { title: "QN-DONE-完了済み", plannedStartAt: at("07:00"), actualStartAt: at("07:00"), actualEndAt: at("07:30"), completed: true })
      ]
    });
    await page.waitForSelector(".today-next-queue", { state: "attached" });
    const queueText = await panelText(".today-next-queue");
    const idx = (t) => (queueText || "").indexOf(t);
    check("先頭5件(QN-A/B/C/D/E)がすべて表示される",
      idx("QN-A-0900") >= 0 && idx("QN-B-1000") >= 0 && idx("QN-C-1100a") >= 0 && idx("QN-D-1100b") >= 0 && idx("QN-E-1200") >= 0,
      queueText);
    check("plannedStartAt昇順で並ぶ(09:00 → 10:00 → 11:00 → 12:00)",
      idx("QN-A-0900") < idx("QN-B-1000") && idx("QN-B-1000") < idx("QN-C-1100a") && idx("QN-D-1100b") < idx("QN-E-1200"));
    check("plannedStartAt同時刻(11:00)は orderIndex 順(1→2)で並ぶ",
      idx("QN-C-1100a") < idx("QN-D-1100b"));
    check("6件目以降(QN-F/QN-G)は表示されない(最大5件)",
      idx("QN-F-1300-6件目") === -1 && idx("QN-G-1400-7件目") === -1, queueText);
    check("実行中Block(actualStartAtあり)は NEXT QUEUE に出ない", idx("QN-RUN-実行中") === -1);
    check("完了Blockは NEXT QUEUE に出ない", idx("QN-DONE-完了済み") === -1);

    // ============================================================
    // [11] DAY GAUGE: 完了n/総数が state からの期待値と一致
    // ============================================================
    console.log("[11] DAY GAUGE: 完了n/総数が state から計算した期待値(2/5、deleted除外)と一致する");
    await seed({
      view: "today",
      blocks: [
        block("g-1", { title: "GAUGE-1", completed: true, actualStartAt: at("08:00"), actualEndAt: at("08:30") }),
        block("g-2", { title: "GAUGE-2", completed: true, actualStartAt: at("09:00"), actualEndAt: at("09:30") }),
        block("g-3", { title: "GAUGE-3", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") }),
        block("g-4", { title: "GAUGE-4", plannedStartAt: at("14:00"), plannedEndAt: at("14:30") }),
        block("g-5", { title: "GAUGE-5", plannedStartAt: at("15:00"), plannedEndAt: at("15:30") }),
        // deleted は総数にも完了数にも入らない(入ると 3/6 になり下の一致判定が落ちる)
        block("g-del", { title: "GAUGE-DEL", completed: true, deleted: true })
      ]
    });
    await page.waitForSelector(".today-day-gauge", { state: "attached" });
    const gaugeText = await panelText(".today-day-gauge");
    check("DAY GAUGE に 完了2/総数5 が表示される(deleted除外)",
      /2\s*\/\s*5/.test(gaugeText || ""), gaugeText);
    check("deletedを含む誤集計(3/6)になっていない", !/3\s*\/\s*6/.test(gaugeText || ""), gaugeText);

    // ============================================================
    // [12] ROUTINE: 時間帯別 done/total の合計が routineRate 相当と一致
    // ============================================================
    console.log("[12] ROUTINE: 時間帯別 done/total の合計が routineRate(カテゴリ'ルーティン'のcompleted集計)= 2/4 と一致する");
    await seed({
      view: "today",
      blocks: [
        // ルーティン4件(朝・午前・午後・夜に分散)、うち完了2件 → routineRate = 2/4
        block("r-1", { title: "RT-朝", category: "ルーティン", plannedStartAt: at("07:00"), plannedEndAt: at("07:15"), completed: true, actualStartAt: at("07:00"), actualEndAt: at("07:15") }),
        block("r-2", { title: "RT-午前", category: "ルーティン", plannedStartAt: at("10:00"), plannedEndAt: at("10:15") }),
        block("r-3", { title: "RT-午後", category: "ルーティン", plannedStartAt: at("14:00"), plannedEndAt: at("14:15"), completed: true, actualStartAt: at("14:00"), actualEndAt: at("14:15") }),
        block("r-4", { title: "RT-夜", category: "ルーティン", plannedStartAt: at("21:00"), plannedEndAt: at("21:15") }),
        // ルーティン以外の完了Blockは分子にも分母にも入らない(入ると合計が 3/5 になり判定が落ちる)
        block("r-x", { title: "RT外-完了仕事", category: "仕事", completed: true, actualStartAt: at("11:00"), actualEndAt: at("11:30") })
      ]
    });
    await page.waitForSelector(".today-routine", { state: "attached" });
    const routineText = await panelText(".today-routine");
    // パネル内の「n/m」形式(時間帯別 done/total)を全部拾って合計し、routineRate(2/4)と突合する。
    // 前提: .today-routine 内の n/m 表記は時間帯別 done/total のみ(§4-4の完了条件を機械検証するための契約)。
    const pairs = [...(routineText || "").matchAll(/(\d+)\s*\/\s*(\d+)/g)];
    const doneSum = pairs.reduce((a, m) => a + Number(m[1]), 0);
    const totalSum = pairs.reduce((a, m) => a + Number(m[2]), 0);
    check("ROUTINE パネルに時間帯別 done/total が1つ以上表示される", pairs.length >= 1, routineText);
    check("全時間帯の done 合計が routineRate の done(2)と一致する", doneSum === 2, `doneSum=${doneSum} text=${routineText}`);
    check("全時間帯の total 合計が routineRate の total(4)と一致する(ルーティン以外・deletedを混ぜない)",
      totalSum === 4, `totalSum=${totalSum} text=${routineText}`);

    // ============================================================
    // [13] FLIGHT PLAN: 当日Block 0件でもエラーなく描画される
    // ============================================================
    console.log("[13] 当日Block 0件でも today ビュー(FLIGHT PLAN含む5パネル)がエラーなく描画される");
    const failuresBeforeEmpty = failures;  // この区間のpageerror検出用(page.on('pageerror')が加算する)
    await seed({ view: "today", blocks: [] });
    await page.waitForSelector(".today-flight-plan", { state: "attached" });
    for (const sel of PANELS) {
      check(`0件日でも ${sel} が描画される`, await page.locator(sel).count() === 1);
    }
    check("0件日の描画で pageerror が発生しない", failures === failuresBeforeEmpty);

    // ============================================================
    // [13b] FLIGHT PLAN: 深夜跨ぎBlockを当日24:00でクリップする
    // ============================================================
    console.log("[13b] 深夜跨ぎBlock(23:30→翌00:30)は当日24:00までの幅で描画される");
    await seed({
      view: "today",
      blocks: [
        block("flight-overnight", {
          title: "FLIGHT-OVERNIGHT",
          plannedStartAt: at("23:30"),
          plannedEndAt: `${TOMORROW}T00:30:00`
        })
      ]
    });
    const overnight = page.locator('.today-flight-block[data-id="flight-overnight"]');
    await overnight.waitFor({ state: "attached" });
    const overnightWidth = await overnight.evaluate((el) => parseFloat(el.style.width));
    const expectedOvernightWidth = 30 / (18 * 60) * 100;
    check("23:30→翌00:30の帯幅が23:30→24:00の30分相当になる",
      Math.abs(overnightWidth - expectedOvernightWidth) < 0.05,
      `width=${overnightWidth} expected=${expectedOvernightWidth}`);

    // ============================================================
    // [13c] FLIGHT PLAN: 同時刻開始Blockを別レーンへ配置する
    // ============================================================
    console.log("[13c] 同時刻開始の2Blockは別レーンに配置され、両方ともタップで編集できる");
    await seed({
      view: "today",
      blocks: [
        block("flight-lane-a", { title: "FLIGHT-LANE-A", plannedStartAt: at("10:00"), plannedEndAt: at("11:00") }),
        block("flight-lane-b", { title: "FLIGHT-LANE-B", plannedStartAt: at("10:00"), plannedEndAt: at("11:00") })
      ]
    });
    const laneBlocks = page.locator('.today-flight-block[data-id^="flight-lane-"]');
    await laneBlocks.first().waitFor({ state: "attached" });
    const laneTops = await laneBlocks.evaluateAll((els) => els.map((el) => el.style.top));
    check("同時刻開始の2Blockが異なるtop(別レーン)に配置される",
      laneTops.length === 2 && new Set(laneTops).size === 2, JSON.stringify(laneTops));
    for (const id of ["flight-lane-a", "flight-lane-b"]) {
      await page.locator(`.today-flight-block[data-id="${id}"]`).click();
      await page.waitForSelector(".modal-card", { state: "attached" });
      check(`${id}をタップすると既存Block編集モーダルが開く`, await page.locator(".modal-card").count() === 1);
      await page.locator('.modal-card [data-action="modal-close"]').first().click();
      await page.waitForSelector(".modal-card", { state: "detached" });
    }

    // ============================================================
    // [14] cockpit CSS変数の先行定義が light/dark の見た目に影響しない(D10・§6)
    // ============================================================
    console.log("[14] cockpit CSS変数(P1先行定義)が存在し、light/dark テーマの見た目(body背景色)は従来値のまま");
    const cssSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
    check("styles.css に :root[data-theme=\"cockpit\"] の変数定義がある(P1完了条件の先行定義)",
      /:root\[data-theme="cockpit"\]/.test(cssSource));

    await seed({ view: "today", settings: { theme: "dark" } });
    await page.waitForSelector('html[data-theme="dark"]', { state: "attached" });
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("darkテーマの body 背景が従来値 #111216 = rgb(17, 18, 22) のまま(cockpit変数が漏れて汚染していない)",
      darkBg === "rgb(17, 18, 22)", darkBg);
    check("darkテーマでも today ビューのパネルが描画される", await page.locator(".today-now-focus").count() === 1);

    await seed({ view: "today", settings: { theme: "light" } });
    await page.waitForSelector('html[data-theme="light"]', { state: "attached" });
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("lightテーマの body 背景が従来値 #f7f7fa = rgb(247, 247, 250) のまま",
      lightBg === "rgb(247, 247, 250)", lightBg);

    // ============================================================
    // ==== ここから B2(P5〜P7)追記セクション [15]〜[18] ====
    // 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md §4-6/7・§7のP5〜P7行。
    // 現物調査: workbench/out/2026-07-29-today-cockpit-impl/b2-survey.md。
    // DOM契約(実装側と共有済み):
    //   .today-pomodoro / .today-kindle / .today-kindle-card / .today-zero /
    //   ZERO-SEC textarea id=todayZeroText / KINDLE操作の data-action は "today-kindle-" プレフィクス
    // 実装(別担当が並行作業中)より先に仕様から書いたため、上記契約に加えて以下を前提にする。
    // 前提が実装と食い違った場合はテストを弱めるのではなく、前提の側を実装と突合して直すこと:
    //   前提1: 今日ビューのポモ開始/停止は既存アクション実名 start-pomodoro / stop-pomodoro を
    //          data-action で再利用する(§4-1「既存アクションの実名で再利用」)
    //   前提2: 今日ビューの中断は stop-pomodoro 発火後、理由ピッカー
    //          (既存 data-action="interrupt-reason" / data-reason)が今日ビュー内に表示される
    //          (b2-survey.md §2の結論 = ピッカー表示分岐の関数化を今日ビューへ接続)
    //   前提3: KINDLEの「現在のカード」= .today-kindle-card のうち可視の先頭要素
    //          (全カードDOM保持型でも1枚描画型でも成立する読み方をする)
    //   前提4: 45秒自動送りは §4 の単一1秒tickerから Date.now(=page.clockの固定時刻)基準で
    //          45秒経過を判定して駆動する。raw setInterval(45000) 実装は §4「interval idを
    //          1本だけ保持」に反し、page.clock.setFixedTime で検証もできないため契約違反とする
    //   前提5: ZERO-SEC の「このテーマで書く」「保存」は .today-zero 内の button 文言
    //   前提6: ZERO-SEC 書き込み中の経過タイマー表示は .today-zero 内にあり毎秒tickerで更新される
    // ============================================================

    // B2用seed: 既存 seed() と同じ流儀に pomodoro / zeroThinking の直接seedを足した拡張。
    // (既存 seed() は変更禁止のため別名で追加。pomodoro未指定時は必ず非実行中へリセットし、
    //  直前セクションのセッションが持ち越されないようにする)
    async function seedB2({ blocks = [], view = "today", settings = {}, pomodoro = null, zeroThinking = null } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, pomodoro, zeroThinking, TODAY }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = TODAY;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        s.pomodoro = pomodoro
          ? { ...s.pomodoro, ...pomodoro }
          : { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        if (zeroThinking) s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [], ...zeroThinking };
        s.settings.todaySkin = "cockpit";
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, view, settings, pomodoro, zeroThinking, TODAY });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    }

    // KINDLE用フィクスチャ+ルート(v74.test.js と同じ Contents API 偽装。
    // highlights.json 以外は route.fallback() で既定の404ブロッカーへ委ねる)
    const kindleFixtures = { status: 200 };
    const KINDLE_HIGHLIGHTS_FIXTURE = {
      generatedAt: "2026-07-01T00:00:00Z",
      books: [
        { id: "kb1", title: "テスト書籍A_B2", author: "著者A", count: 3, highlights: [
          { ref: "a1", text: "KINDLE-HL-1 学びの一節その1", location: 10 },
          { ref: "a2", text: "KINDLE-HL-2 学びの一節その2", location: 20 },
          { ref: "a3", text: "KINDLE-HL-3 学びの一節その3", location: 30 }
        ] },
        { id: "kb2", title: "テスト書籍B_B2", author: "著者B", count: 2, highlights: [
          { ref: "b1", text: "KINDLE-HL-4 学びの一節その4", location: 40 },
          { ref: "b2", text: "KINDLE-HL-5 学びの一節その5", location: 50 }
        ] }
      ]
    };
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/contents/taskchute/reading/highlights.json")) {
        if (kindleFixtures.status !== 200) return route.fulfill({ status: kindleFixtures.status, body: "not found" });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KINDLE_HIGHLIGHTS_FIXTURE) });
      }
      return route.fallback();
    });

    // 前提3の読み方: 現在カード = 可視の先頭 .today-kindle-card(無ければDOM上の先頭)
    async function kindleCardText() {
      return page.evaluate(() => {
        const cards = [...document.querySelectorAll(".today-kindle-card")];
        const visible = cards.filter((c) => c.offsetParent !== null &&
          getComputedStyle(c).visibility !== "hidden" && getComputedStyle(c).display !== "none");
        return (visible[0] || cards[0])?.textContent ?? null;
      });
    }
    async function waitKindleCardChange(prev) {
      await page.waitForFunction((p) => {
        const cards = [...document.querySelectorAll(".today-kindle-card")];
        const visible = cards.filter((c) => c.offsetParent !== null &&
          getComputedStyle(c).visibility !== "hidden" && getComputedStyle(c).display !== "none");
        const t = (visible[0] || cards[0])?.textContent ?? null;
        return t !== null && t !== p;
      }, prev);
    }
    const kindleNextBtn = () => page.locator('.today-kindle [data-action^="today-kindle-"]', { hasText: "▶" }).first();

    // ============================================================
    // [15] P5: 今日ビューからポモ開始 → state.pomodoro が更新される(双方向同期・行き)
    // ============================================================
    console.log("[15] P5: 今日ビューのポモ開始(既存アクション実名 start-pomodoro)で state.pomodoro が実行中へ更新される");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("pomo-run", { title: "POMO-RUN-実行中", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("12:30"), estimateMin: 90 })
      ]
    });
    await page.waitForSelector(".today-pomodoro", { state: "attached" });
    check("今日ビューに .today-pomodoro パネルが描画される(DOM契約)", await page.locator(".today-pomodoro").count() === 1);
    check("パネル内にポモ開始ボタン(data-action='start-pomodoro')がある(前提1)",
      await page.locator('.today-pomodoro [data-action="start-pomodoro"]').count() >= 1);
    await page.locator('.today-pomodoro [data-action="start-pomodoro"]').first().click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.pomodoro.running === true && s.pomodoro.blockId === "pomo-run";
    }, KEY);
    const pomoState = (await stateNow()).pomodoro;
    check("state.pomodoro.running=true / blockId=実行中Block(既存 startPomodoro と同結果)",
      pomoState.running === true && pomoState.blockId === "pomo-run");
    check("state.pomodoro.mode が 'focus' で開始される", pomoState.mode === "focus", pomoState.mode);
    check("startedAt が固定現在時刻 12:00:00 になる", (pomoState.startedAt || "").includes("12:00:00"), pomoState.startedAt);
    check("endsAt が実時間25分後 12:25:00 になる(実タイマー25分の既存仕様を変えていない)",
      (pomoState.endsAt || "").includes("12:25:00"), pomoState.endsAt);
    // v183レビューH1: 実行中Blockからの開始で実績開始時刻を上書きしない(v13「既存値維持」契約)
    const runBlockAfterStart = (await stateNow()).blocks.find((b) => b.id === "pomo-run");
    check("実行中Blockの actualStartAt(11:00)が上書きされない(実績保持・レビューH1)",
      (runBlockAfterStart.actualStartAt || "").includes("11:00"), runBlockAfterStart.actualStartAt);

    // ============================================================
    // [15c] P5: 今日ビューの中断(stop-pomodoro)→ 理由ピッカー → 理由選択で記録+リセット
    // ============================================================
    console.log("[15c] P5: 今日ビューの中断で理由ピッカーが出て、理由選択で中断記録+pomodoroリセットになる");
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').click();
    await waitView("today");
    check("実行中は .today-pomodoro に停止導線(data-action='stop-pomodoro')がある(前提1)",
      await page.locator('.today-pomodoro [data-action="stop-pomodoro"]').count() >= 1);
    await page.locator('.today-pomodoro [data-action="stop-pomodoro"]').first().click();
    await page.waitForSelector('[data-action="interrupt-reason"]', { state: "attached" });
    check("blockId連結中の停止で既存の中断理由ピッカーが出る(前提2・§4-6)", true);
    await page.locator('[data-action="interrupt-reason"][data-reason="割込み"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro.running === false, KEY);
    const stAfterStop = await stateNow();
    const stoppedBlock = stAfterStop.blocks.find((b) => b.id === "pomo-run");
    check("理由選択後 state.pomodoro.running=false(既存 stopPomodoro と同結果)", stAfterStop.pomodoro.running === false);
    check("blockに中断理由 '割込み' が記録される(既存 recordBlockInterruption 経由)",
      Array.isArray(stoppedBlock.interruptions) && stoppedBlock.interruptions.some((i) => i.reason === "割込み"),
      JSON.stringify(stoppedBlock.interruptions));
    check("中断で block.actualStartAt がクリアされる(既存 stopPomodoro と同結果)",
      !stoppedBlock.actualStartAt, stoppedBlock.actualStartAt);

    // ============================================================
    // [15d] P5: state側で実行中のセッションが今日ビューにも実行中として見える(双方向同期・帰り)
    // ============================================================
    console.log("[15d] P5: stateが実行中なら今日ビューの .today-pomodoro が実行中表示になる(逆方向の同期)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("pomo-run2", { title: "POMO-RUN2", actualStartAt: at("11:50"), plannedStartAt: at("11:50"), plannedEndAt: at("12:20") })
      ],
      pomodoro: { running: true, blockId: "pomo-run2", startedAt: at("11:50"), endsAt: at("12:15"), mode: "focus" }
    });
    await page.waitForSelector(".today-pomodoro", { state: "attached" });
    check("state側が実行中なら .today-pomodoro に停止導線が出る(実行中表示への同期)",
      await page.locator('.today-pomodoro [data-action="stop-pomodoro"]').count() >= 1);
    check("実行中表示では開始ボタンが出ない(開始/停止の状態が排他表示)",
      await page.locator('.today-pomodoro [data-action="start-pomodoro"]').count() === 0);

    // ============================================================
    // [15e] P5: focusTimerAuto=OFF でも今日ビューのポモ開始ボタンでセッションが始まる(レビューM2)
    // ============================================================
    console.log("[15e] P5: focusTimerAuto=OFF でも今日ビューの開始でポモが始まり、未着手Blockには着手時刻が付く");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("pomo-idle", { title: "POMO-IDLE-未着手", plannedStartAt: at("12:30"), plannedEndAt: at("13:00") })
      ],
      settings: { focusTimerAuto: false }
    });
    await page.waitForSelector('.today-pomodoro [data-action="start-pomodoro"]', { state: "attached" });
    await page.locator('.today-pomodoro [data-action="start-pomodoro"]').first().click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.pomodoro.running === true && s.pomodoro.blockId === "pomo-idle";
    }, KEY);
    const idleAfter = await stateNow();
    check("focusTimerAuto=OFF でも running=true(手動開始は設定に依存しない)", idleAfter.pomodoro.running === true);
    check("未着手Blockには actualStartAt=12:00 が記録される",
      ((idleAfter.blocks.find((b) => b.id === "pomo-idle") || {}).actualStartAt || "").includes("12:00"));

    // ============================================================
    // [16] P6: highlights.json あり → .today-kindle にカードデッキが出る
    // ============================================================
    console.log("[16] P6: highlights.json(fetchモック)をseed → .today-kindle にカードが表示される");
    kindleFixtures.status = 200;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({ view: "today" });
    await page.waitForSelector(".today-kindle", { state: "attached" });
    check(".today-kindle パネルが描画される(DOM契約)", await page.locator(".today-kindle").count() === 1);
    check(".today-kindle-card が1枚以上描画される(DOM契約)", await page.locator(".today-kindle-card").count() >= 1);
    const firstCard = await kindleCardText();
    check("現在カードにseedしたハイライト本文(KINDLE-HL-*)が表示される", /KINDLE-HL-\d/.test(firstCard || ""), firstCard);
    check("KINDLE操作ボタンの data-action が 'today-kindle-' プレフィクス(DOM契約)",
      await page.locator('.today-kindle [data-action^="today-kindle-"]').count() >= 1);

    // ============================================================
    // [16b] P6: highlights.json が404 → .today-kindle 自体が存在しない(フェイルソフト非表示)
    // ============================================================
    console.log("[16b] P6: highlights未取得(404)では .today-kindle が存在せず、他パネルは通常描画される");
    kindleFixtures.status = 404;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    const respHighlights404 = page.waitForResponse((r) => r.url().includes("reading/highlights.json"));
    await seedB2({ view: "today" });
    await respHighlights404;
    // 404応答後に最低1tick経過してから不在を断定する(固定waitではなく時計表示の前進で待つ)
    await page.clock.setFixedTime(fixedTime(12, 1, 0));
    await page.waitForFunction(() => (document.getElementById("todayClock")?.textContent || "").includes("12:01"));
    check("highlights未取得(404)では .today-kindle が存在しない(§4-6: 未取得/空でパネル非表示)",
      await page.locator(".today-kindle").count() === 0);
    check("404でも他のパネル(NOW FOCUS)は通常描画される(フェイルソフト)",
      await page.locator(".today-now-focus").count() === 1);
    kindleFixtures.status = 200;

    // ============================================================
    // [16c] P6: 同一dateISOで2回描画してもカードの並び順が同じ(決定論シャッフル)+手動めくり
    // ============================================================
    console.log("[16c] P6: 同一dateISOの再描画で並び順が一致する(決定論)。あわせて▶手動めくりの動作を確認");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({ view: "today" });
    await page.waitForSelector(".today-kindle-card", { state: "attached" });
    async function readDeckSequence(steps) {
      const seq = [await kindleCardText()];
      for (let i = 1; i < steps; i++) {
        const prev = seq[seq.length - 1];
        await kindleNextBtn().click();
        await waitKindleCardChange(prev);
        seq.push(await kindleCardText());
      }
      // カード本文からハイライト識別子だけ抜き出して比較する(装飾差分の影響を受けない)
      return seq.map((t) => (t || "").match(/KINDLE-HL-\d+/)?.[0] ?? t);
    }
    const deckSeq1 = await readDeckSequence(3);
    check("▶(めくる)でカードが順に切り替わる(手動送り)", new Set(deckSeq1).size === 3, JSON.stringify(deckSeq1));
    // 同じ固定時刻・同じdateISOのまま再描画(reload)して同じ並びになることを確認する
    await seedB2({ view: "today" });
    await page.waitForSelector(".today-kindle-card", { state: "attached" });
    const deckSeq2 = await readDeckSequence(3);
    check("同一dateISOの2回目の描画で並び順が一致する(決定論シャッフル・§7 P6完了条件)",
      JSON.stringify(deckSeq1) === JSON.stringify(deckSeq2),
      `1回目=${JSON.stringify(deckSeq1)} 2回目=${JSON.stringify(deckSeq2)}`);

    // ============================================================
    // [17] P7: pending の提案テーマが最優先で出る
    // ============================================================
    console.log("[17] P7: pendingの提案テーマが通常テーマより優先して .today-zero に出る(§4-7の優先順)");
    const ZT_SEED = {
      themes: [{ id: "zt-theme-normal", text: "ZT-NORMAL-通常テーマ", fav: false, groupId: null, createdAt: at("08:00") }],
      entries: [],
      groups: [],
      suggestedThemes: [{ id: "zt-sugg-1", text: "ZT-SUGGEST-提案テーマ", status: "pending", createdAt: at("09:00") }]
    };
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({ view: "today", zeroThinking: ZT_SEED });
    await page.waitForSelector(".today-zero", { state: "attached" });
    const zeroText0 = await panelText(".today-zero");
    const idxSuggest = (zeroText0 || "").indexOf("ZT-SUGGEST-提案テーマ");
    const idxNormal = (zeroText0 || "").indexOf("ZT-NORMAL-通常テーマ");
    check("pending提案テーマが .today-zero に表示される", idxSuggest >= 0, zeroText0);
    // 1枚描画型(通常テーマはDOM未出現=-1)でも全件描画型(提案が先頭)でも成立する判定
    check("pending提案が通常テーマより先(最優先)に出る",
      idxSuggest >= 0 && (idxNormal === -1 || idxSuggest < idxNormal),
      `idxSuggest=${idxSuggest} idxNormal=${idxNormal}`);

    // ============================================================
    // [17b] P7: 「このテーマで書く」→ #todayZeroText が表示され入力できる
    // ============================================================
    console.log("[17b] P7: 「このテーマで書く」でインラインtextarea #todayZeroText が出て入力できる");
    await page.locator(".today-zero button", { hasText: "このテーマで書く" }).first().click();
    await page.waitForSelector("#todayZeroText", { state: "visible" });
    check("インラインtextarea #todayZeroText が表示される(DOM契約)", await page.locator("#todayZeroText").count() === 1);
    await page.locator("#todayZeroText").click();
    await page.keyboard.type("ZERO-B2-今日ビューから書いた本文");
    check("textareaへ入力できる", (await page.locator("#todayZeroText").inputValue()) === "ZERO-B2-今日ビューから書いた本文");

    // ============================================================
    // [17c] P7: textarea入力中の毎秒tick再描画で入力が消えない(既存保護機構への相乗り)
    // ============================================================
    console.log("[17c] P7: 入力中に固定時刻を進めてtick更新が起きても、入力値とフォーカスが消えない(§4・C5)");
    const zeroPanelBefore = await panelText(".today-zero");
    await page.clock.setFixedTime(fixedTime(12, 1, 30));
    // 前提6: 書き込み中の経過タイマー表示がtickで変わるのを「更新が起きた」正の条件として待つ
    // (textareaの入力値は .value であり textContent に混ざらないため、この変化はタイマー等の表示更新)
    await page.waitForFunction((prev) => {
      const el = document.querySelector(".today-zero");
      return el && el.textContent !== prev;
    }, zeroPanelBefore);
    check("入力中もtickerがパネル表示(経過タイマー)を更新し続ける(前提6)", true);
    check("tick更新後も入力値が消えない(isFocusInEditableElement保護への相乗り)",
      (await page.locator("#todayZeroText").inputValue()) === "ZERO-B2-今日ビューから書いた本文");
    check("tick更新後もフォーカスがtextareaに残る(再描画で吹き飛ばされない)",
      await page.evaluate(() => document.activeElement?.id === "todayZeroText"));

    // ============================================================
    // [17d] P7: 保存で entries に durationSec 付きで追記され、提案は既存採用アクション経由で adopted
    // ============================================================
    console.log("[17d] P7: 保存で zeroThinking.entries が増え(durationSec付き)、提案テーマは adopted に遷移する");
    await page.locator(".today-zero button", { hasText: "保存" }).first().click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).zeroThinking.entries.length === 1, KEY);
    const ztAfterSave = (await stateNow()).zeroThinking;
    const ztEntry = ztAfterSave.entries[0];
    check("entry.body に入力本文が入る", (ztEntry.body || "").includes("ZERO-B2-今日ビューから書いた本文"), JSON.stringify(ztEntry));
    check("entry.theme が書いたテーマ(提案テーマ)のテキストになる", ztEntry.theme === "ZT-SUGGEST-提案テーマ", ztEntry.theme);
    check("entry.date が今日になる", ztEntry.date === TODAY, ztEntry.date);
    check("entry.durationSec に書き始め→保存の実測秒(固定時刻差=約90秒)が記録される(§7 P7完了条件)",
      Number.isFinite(ztEntry.durationSec) && ztEntry.durationSec >= 60 && ztEntry.durationSec <= 120, String(ztEntry.durationSec));
    check("pending提案が既存採用アクション経由で status='adopted' に遷移している(D7・§4-7)",
      ztAfterSave.suggestedThemes.find((s) => s.id === "zt-sugg-1")?.status === "adopted",
      JSON.stringify(ztAfterSave.suggestedThemes));

    // ============================================================
    // [17e] P7: 保存したentryが0秒思考ビューにも反映される
    // ============================================================
    console.log("[17e] P7: 0秒思考ビューの「今日 n 本」カウントに保存分が反映される");
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="zero"]').click();
    await waitView("zero");
    const dayCountText = await page.locator(".zt-day-count").textContent();
    check("0秒思考ビューの「今日 1 本」カウントに保存分が反映される(§7 P7: 0秒思考ビューに出る)",
      /今日\s*1\s*本/.test((dayCountText || "").replace(/\s+/g, " ")), dayCountText);

    // ============================================================
    // [17f] P7: 書きかけ本文が、他パネル操作による全再描画(render())でも消えない(レビューM3/M4)
    //   毎秒tickの差分更新([17c])ではなく、実際に main.innerHTML を丸ごと差し替える
    //   経路(ポモ開始の saveAndRender)を発火させて下書きバッファの実効性を検証する
    // ============================================================
    console.log("[17f] P7: 入力中に他パネル操作(ポモ開始=全再描画)が起きても下書きが消えない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("draft-pomo", { title: "DRAFT-POMO", plannedStartAt: at("12:30"), plannedEndAt: at("13:00") })
      ],
      zeroThinking: { themes: [{ id: "th-draft", text: "下書き保持テーマ", fav: false, groupId: null, createdAt: at("08:00") }], entries: [], groups: [], suggestedThemes: [] }
    });
    await page.waitForSelector('.today-zero [data-action="today-zero-write"]', { state: "attached" });
    await page.locator('.today-zero [data-action="today-zero-write"]').first().click();
    await page.waitForSelector("#todayZeroText", { state: "attached" });
    await page.locator("#todayZeroText").fill("消えてはいけない下書き");
    await page.locator('.today-pomodoro [data-action="start-pomodoro"]').first().click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro.running === true, KEY);
    await page.waitForSelector("#todayZeroText", { state: "attached" });
    check("全再描画後も textarea に下書き本文が残っている(レビューM3の実効検証)",
      (await page.locator("#todayZeroText").inputValue()) === "消えてはいけない下書き",
      await page.locator("#todayZeroText").inputValue());

    // ============================================================
    // [18] P6: 45秒自動送り — 45秒経過で次カードへ送られ、ビュー離脱でtimerが停止する
    // ============================================================
    console.log("[18] P6: 45秒自動送りが固定時刻+46秒で発火し、ビュー離脱で停止する(おとり方式=既存[7]参照)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({ view: "today" });
    await page.waitForSelector(".today-kindle-card", { state: "attached" });
    const autoCard0 = await kindleCardText();
    // 前提4: 自動送りは1秒tickerが Date.now(=固定時刻)基準で45秒経過を判定する設計。
    // 固定時刻を+46秒進めると、実時間1〜2秒内の次tickで自動送りが発火する(固定waitなしで待てる)。
    await page.clock.setFixedTime(fixedTime(12, 0, 46));
    await waitKindleCardChange(autoCard0);
    check("45秒経過(固定時刻+46秒)で自動的に次のカードへ送られる(§4-6: 45秒自動送り)",
      (await kindleCardText()) !== autoCard0);
    // ビュー離脱 → おとり注入 → さらに45秒相当前進しても、おとりが書き換えられない=timer停止
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    check("ビュー離脱で .today-kindle がDOMから消える", await page.locator(".today-kindle").count() === 0);
    // 離脱直後のtickが自分でclearIntervalする猶予として1周期分待つ
    // (固定wait例外: ticker周期1秒そのものが仕様(§4)。既存[7]と同根拠)
    await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const decoy = document.createElement("section");
      decoy.className = "today-kindle";
      decoy.id = "kindleDecoyRoot";
      decoy.innerHTML = '<div class="today-kindle-card">DECOY-KINDLE-CARD</div>';
      document.getElementById("main").appendChild(decoy);
    });
    await page.clock.setFixedTime(fixedTime(12, 1, 35));
    await page.waitForTimeout(2300);  // 固定wait例外([7]と同根拠): tickerが生きていれば2周期以内におとりへ触るはずの負検証
    check("離脱後は自動送りtimerが停止している(おとりカードが45秒相当の前進+2周期でも書き換えられない)",
      (await page.evaluate(() => document.querySelector("#kindleDecoyRoot .today-kindle-card")?.textContent)) === "DECOY-KINDLE-CARD");
    await page.evaluate(() => document.getElementById("kindleDecoyRoot")?.remove());

    // ============================================================
    // ==== ここから B3(P8計器盤TIME LOG / P9 12WY TRACKER+migration)追記セクション [19]〜[23] ====
    // 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md
    //   §5(計器盤への追加)・§3 D8(weeklyTargetMin migration)/D9(カテゴリ計時・表示のみ毎秒加算)・
    //   §7のP8/P9行(完了条件)。
    // 現物調査: workbench/out/2026-07-29-today-cockpit-impl/b3-survey.md(§5テストフィクスチャ設計)。
    // DOM契約(実装側と共有済み):
    //   .stats-time-log / .stats-time-log-row[data-category] /
    //   .stats-twelve-week / .stats-twelve-week-row[data-project-id]
    //   2パネルは計器盤(stats)ビューの常時表示層(stats-detailsフォールドの外)の先頭
    // 実装(別担当が並行作業中)と食い違った場合はテストを弱めるのではなく、
    // 前提の側を実装と突合して直すこと:
    //   前提B3-1: 分数nの表示形式は「n分」「H:MM(H:MM:SS含む)」「H時間M分」「NhMm」「nm」
    //            または裸の数字のどれか(textHasMin()が許容形式を列挙。別形式ならそこへ1つ足す)
    //   前提B3-2: 12WY TRACKERの実績/目標バーはインラインstyleのwidth指定要素で描く
    //            (progress系・stats-bar-fill系の既存バーと同じ流儀)。目標未設定(0)行にはwidth指定要素が無い
    //   前提B3-3: 目標未設定(weeklyTargetMin=0)行の誘導文言は「目標」を含む(§5-2「目標時間を設定」)
    //   前提B3-4: 計器盤tickerは§4のtoday tickerと同原則(毎tick再取得・stats離脱でclear・
    //            id "statsTimeLogTotal" の合計表示を毎tick更新)。停止の負検証は[7]/[18]と同じおとり方式
    // ============================================================

    // B3用seed: 既存seed()/seedB2()と同じ流儀に projects / tasks の直接seedを足した拡張
    // (既存関数は変更禁止のため別名で追加)
    async function seedB3({ blocks = [], view = "stats", settings = {}, projects = null, tasks = null } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, projects, tasks, TODAY }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = TODAY;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        if (projects) s.projects = projects;
        if (tasks) s.tasks = tasks;
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, view, settings, projects, tasks, TODAY });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    }

    // 日付部品(すべてISO文字列リテラルの組み立て。new Date("文字列")は使わない)
    const dateISOof = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const daysAgoISO = (n) => dateISOof(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - n));
    const atOn = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;
    const YESTERDAY = daysAgoISO(1);
    // 12週サイクル開始 = 23日前 → homeCycleと同算式 floor(daysBetween/7)+1 = floor(23/7)+1 = WEEK 4
    // (テスト実行日の曜日に依存せず決定論。残り日数も同式で 84-23=61日)
    const CYCLE_START = daysAgoISO(23);
    const EXPECTED_WK = Math.floor(23 / 7) + 1;  // = 4(期待値もhomeCycleと同一算式から導出して突合する)
    // 今週の土曜起点(weekRangeと同式: (getDay()+1)%7 → Sat=0)。その前日 = 先週(週境界テスト用)
    const PREV_WEEK_DAY = daysAgoISO(((now0.getDay() + 1) % 7) + 1);

    // 前提B3-1: 分数nの表示として許容する形式群。どれか1つでも含めば「nが表示されている」とみなす
    function textHasMin(text, min) {
      if (text == null) return false;
      const h = Math.floor(min / 60), m = min % 60;
      const fixed = [`${min}分`, `${h}:${String(m).padStart(2, "0")}`];
      if (h > 0) {
        fixed.push(`${h}時間${m}分`, `${h}時間${String(m).padStart(2, "0")}分`, `${h}h${m ? `${m}m` : ""}`);
        if (m === 0) fixed.push(`${h}時間`);
      } else {
        fixed.push(`${m}m`);
      }
      if (fixed.some((r) => text.includes(r))) return true;
      return new RegExp(`(^|[^0-9])${min}([^0-9]|$)`).test(text);
    }
    async function timeLogRowText(category) {
      return page.evaluate((c) => document.querySelector(`.stats-time-log-row[data-category="${c}"]`)?.textContent ?? null, category);
    }
    async function twelveWeekRowText(projectId) {
      return page.evaluate((p) => document.querySelector(`.stats-twelve-week-row[data-project-id="${p}"]`)?.textContent ?? null, projectId);
    }
    // Projectフィクスチャ: homeCycleの12WY目標の条件(kind:"normal"/status:"active"/
    // twelveWeekStartDateあり/未削除)を満たす形。weeklyTargetMinは既定で「キー自体を持たせない」
    // (migrationテスト[21]の前提。必要なテストだけextraで与える)
    const projectFx = (id, title, extra = {}) => ({
      id, kind: "normal", title, status: "active", memo: "",
      twelveWeekStartDate: CYCLE_START, priority: "中", showProgress: false, updatedAt: "",
      deleted: false, ...extra
    });
    const taskFx = (id, projectId, extra = {}) => ({
      id, projectId, title: id, status: "todo", dueDate: "", deleted: false,
      createdAt: at("00:00"), updatedAt: at("00:00"), ...extra
    });

    // ============================================================
    // [19] P8 TIME LOG: 当日・実績のみ・完了問わずのカテゴリ集計が期待値と一致
    // ============================================================
    console.log("[19] P8 TIME LOG: 固定フィクスチャで当日・実績のみ・完了問わずのカテゴリ集計が期待値と一致する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB3({
      view: "stats",
      blocks: [
        // 仕事 = 実績あり完了45分 + 実績あり未完了20分 = 65分(「完了問わず」の検証。混入があると65にならない)
        block("tl-done", { title: "TL-実績あり完了", category: "仕事", completed: true, actualStartAt: at("09:00"), actualEndAt: at("09:45") }),
        block("tl-undone", { title: "TL-実績あり未完了", category: "仕事", completed: false, actualStartAt: at("10:00"), actualEndAt: at("10:20") }),
        // 実績なし完了(計画60分)→ 計画時間で代替しない = 集計0
        // (既存「カテゴリ別 時間配分」=完了のみ・実績なしは予定時間代替、との定義差の検証点。
        //  §5-1: 画面間の数字一致は完了条件にしない=既存パネルとの突合はしない)
        block("tl-noact", { title: "TL-実績なし完了", category: "学習", completed: true, plannedStartAt: at("13:00"), plannedEndAt: at("14:00") }),
        // 他日Block(昨日の実績60分)→ 当日境界の外
        block("tl-other-day", { title: "TL-他日", category: "他日", date: YESTERDAY, completed: true, actualStartAt: atOn(YESTERDAY, "09:00"), actualEndAt: atOn(YESTERDAY, "10:00") }),
        // deleted(実績30分)→ 集計外
        block("tl-deleted", { title: "TL-削除済", category: "削除済", deleted: true, completed: true, actualStartAt: at("08:00"), actualEndAt: at("08:30") }),
        // 早朝の実績(04:30-05:30)→ 当日全体(00:00〜)の集計に入る(v184レビューM1: チャート軸06-24とは独立)
        block("tl-early", { title: "TL-早朝", category: "早朝", completed: true, actualStartAt: at("04:30"), actualEndAt: at("05:30") })
      ]
    });
    await page.waitForSelector(".stats-time-log", { state: "attached" });
    check("計器盤に .stats-time-log パネルが描画される(DOM契約)", await page.locator(".stats-time-log").count() === 1);
    const tlWork = await timeLogRowText("仕事");
    check("カテゴリ行 .stats-time-log-row[data-category='仕事'] が存在する(DOM契約)", tlWork !== null);
    check("仕事 = 65分(実績あり完了45 + 実績あり未完了20。完了問わず・実績のみで集計)", textHasMin(tlWork, 65), tlWork);
    const tlNoact = await timeLogRowText("学習");
    check("実績なし完了(計画60分)は計画時間で代替しない(行が無いか、60分が出ない=既存パネルとの定義差)",
      !textHasMin(tlNoact, 60), tlNoact);
    const tlOther = await timeLogRowText("他日");
    check("他日(昨日)の実績60分は当日集計に入らない", !textHasMin(tlOther, 60), tlOther);
    const tlDeleted = await timeLogRowText("削除済");
    check("deleted Blockの実績30分は集計に入らない", !textHasMin(tlDeleted, 30), tlDeleted);
    const tlEarly = await timeLogRowText("早朝");
    check("早朝(04:30-05:30)の実績60分が当日集計に入る(集計窓は00:00〜24:00。v184レビューM1)", textHasMin(tlEarly, 60), tlEarly);
    check("記録済み合計の表示がある(§5-1)", /合計/.test((await panelText(".stats-time-log")) || ""));

    // ============================================================
    // [20] P8 TIME LOG: 実行中カテゴリの毎秒加算 + statsビュー離脱でticker停止
    // ============================================================
    console.log("[20] P8 TIME LOG: 実行中Blockのカテゴリが毎秒加算され、statsビュー離脱でtickerが停止する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB3({
      view: "stats",
      blocks: [
        block("tl-run", { title: "TL-実行中", category: "回復", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("12:30"), estimateMin: 90 }),
        block("tl-fixed", { title: "TL-完了固定", category: "仕事", completed: true, actualStartAt: at("09:00"), actualEndAt: at("09:45") })
      ]
    });
    await page.waitForSelector('.stats-time-log-row[data-category="回復"]', { state: "attached" });
    const runRow0 = await timeLogRowText("回復");
    check("実行中カテゴリ(回復)に経過60分(11:00開始→固定12:00)が表示される", textHasMin(runRow0, 60), runRow0);
    // 固定時刻を+2分10秒前進 → reload・クリック無しで表示値が増える(D9: 表示上のみ毎秒加算)
    await page.clock.setFixedTime(fixedTime(12, 2, 10));
    await page.waitForFunction((prev) => {
      const el = document.querySelector('.stats-time-log-row[data-category="回復"]');
      return el && el.textContent !== prev;
    }, runRow0);
    const runRow1 = await timeLogRowText("回復");
    check("固定時刻+2分で実行中カテゴリの表示値が reload なしで62分へ増える(毎秒加算)", textHasMin(runRow1, 62), runRow1);
    const fixedRow = await timeLogRowText("仕事");
    check("実行中でない完了カテゴリ(仕事45分)は加算されない", textHasMin(fixedRow, 45) && !textHasMin(fixedRow, 47), fixedRow);
    // D9後段: 毎秒加算は表示上のみ。実行中Blockのstateに終了実績を書き込まない
    check("毎秒加算してもstateへは書かない(tl-run.actualEndAt が空のまま。D9)",
      !((await stateNow()).blocks.find((b) => b.id === "tl-run") || {}).actualEndAt);
    // statsビュー離脱でticker停止(前提B3-4: [7]/[18]と同じおとり方式)
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    check("ビュー離脱で .stats-time-log がDOMから消える", await page.locator(".stats-time-log").count() === 0);
    // 離脱直後のtickが自分でclearIntervalする猶予として、まずticker 1周期分を実時間で待つ
    // (固定wait例外: ticker周期1秒そのものが仕様(§4)。既存[7]/[18]と同根拠)
    await page.waitForTimeout(1300);
    // おとり: tickerが毎tick再取得するid(statsTimeLogTotal)を持つ要素を注入する(前提B3-4)。
    // tickerが生きていれば合計表示が毎秒書き換えられてしまうはず。
    await page.evaluate(() => {
      const decoy = document.createElement("div");
      decoy.className = "stats-time-log";
      decoy.id = "statsTimeLogDecoy";
      decoy.innerHTML = '<div class="stats-time-log-row" data-category="回復">DECOY-STATS-ROW</div>'
        + '<strong id="statsTimeLogTotal">DECOY-STATS-TOTAL</strong>';
      document.getElementById("main").appendChild(decoy);
    });
    await page.clock.setFixedTime(fixedTime(12, 5, 0));
    await page.waitForTimeout(2300);  // 固定wait例外([7]と同根拠): 負の検証はticker 2周期分の実時間経過が必要
    check("stats離脱後はtickerが停止している(おとり合計が2周期経っても書き換えられない)",
      (await page.evaluate(() => document.getElementById("statsTimeLogTotal")?.textContent)) === "DECOY-STATS-TOTAL");
    await page.evaluate(() => document.getElementById("statsTimeLogDecoy")?.remove());

    // ============================================================
    // [21] P9 migration: weeklyTargetMin無しの旧projectが0補完・既存値は上書きされない
    // ============================================================
    console.log("[21] P9 migration: weeklyTargetMinキー無しの旧projectが0補完され、既存値(120)は上書きされない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB3({
      view: "stats",
      settings: { twelveWeekStartDate: CYCLE_START },
      projects: [
        projectFx("p-old", "12WY旧形状(キー無し)"),
        projectFx("p-keep", "12WY既存値あり", { weeklyTargetMin: 120 })
      ],
      tasks: []
    });
    // 読込時のnormalizeState結果はメモリ上にあるだけなので、保存契機(setView→persistLocalNoSchedule)を
    // 明示的に踏んでlocalStorageへ書き戻させてから突合する(毎秒処理では保存しない設計 §8-7 のため)
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const p = (s.projects || []).find((x) => x.id === "p-old");
      return !!p && p.weeklyTargetMin === 0;
    }, KEY);
    const migProjects = (await stateNow()).projects;
    check("weeklyTargetMinキー無しの旧projectに 0 が補完される(D8 migration)",
      migProjects.find((p) => p.id === "p-old")?.weeklyTargetMin === 0,
      JSON.stringify(migProjects.find((p) => p.id === "p-old")));
    check("既存値 weeklyTargetMin=120 は上書きされない(既定値を先に置き既存値優先の流儀)",
      migProjects.find((p) => p.id === "p-keep")?.weeklyTargetMin === 120,
      JSON.stringify(migProjects.find((p) => p.id === "p-keep")));

    // ============================================================
    // [22] P9 12WY TRACKER: 週番号=homeCycle同算式・目標未設定は誘導・目標設定済みは今週実績/目標バー
    // ============================================================
    console.log("[22] P9 12WY TRACKER: WEEK n/12がhomeCycle同算式、目標未設定(0)は誘導、目標設定済みは今週実績/目標が期待値一致");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB3({
      view: "stats",
      settings: { twelveWeekStartDate: CYCLE_START },
      projects: [
        projectFx("p-goal", "12WY目標あり", { weeklyTargetMin: 300 }),
        projectFx("p-nogoal", "12WY目標未設定", { weeklyTargetMin: 0 })
      ],
      tasks: [
        taskFx("t-goal", "p-goal"),
        taskFx("t-free", "")  // どのprojectにも属さないTask(集計対象外の検証用)
      ],
      blocks: [
        // 今週(当日)の12WY実績 = 120分(blocks→taskId→task.projectId 経由。D8)
        block("tw-this", { title: "TW-今週実績", taskId: "t-goal", category: "仕事", completed: true, actualStartAt: at("09:00"), actualEndAt: at("11:00") }),
        // 先週(今週の土曜起点の前日)の実績60分 → 今週集計に入らない(週境界=weekRange土曜起点。D4)
        block("tw-prev", { title: "TW-先週実績", taskId: "t-goal", category: "仕事", date: PREV_WEEK_DAY, completed: true, actualStartAt: atOn(PREV_WEEK_DAY, "10:00"), actualEndAt: atOn(PREV_WEEK_DAY, "11:00") }),
        // 12WYプロジェクトに属さないTaskの実績 → 集計外
        block("tw-other", { title: "TW-対象外task", taskId: "t-free", category: "仕事", completed: true, actualStartAt: at("13:00"), actualEndAt: at("14:00") }),
        // 実績なし(計画45分のみ)→ 実績集計に入らない
        block("tw-plan", { title: "TW-計画のみ", taskId: "t-goal", category: "仕事", plannedStartAt: at("15:00"), plannedEndAt: at("15:45") })
      ]
    });
    await page.waitForSelector(".stats-twelve-week", { state: "attached" });
    check("計器盤に .stats-twelve-week パネルが描画される(DOM契約)", await page.locator(".stats-twelve-week").count() === 1);
    const twText = await panelText(".stats-twelve-week");
    // 週番号の期待値はhomeCycleと同一算式(floor(daysBetween(start,today)/7)+1)から独立に導出して突合する
    check(`週番号が WEEK ${EXPECTED_WK}(homeCycleと同算式・開始=23日前)と一致する`,
      new RegExp(`week\\s*0?${EXPECTED_WK}([^0-9]|$)`, "i").test(twText || "") ||
      new RegExp(`(^|[^0-9])${EXPECTED_WK}\\s*/\\s*12([^0-9]|$)`).test(twText || ""),
      twText);
    check("残り日数 61日(84-23。homeCycleの残り日数と同算式)が表示される", /残り\s*61\s*日/.test(twText || ""), twText);
    const goalRow = await twelveWeekRowText("p-goal");
    check("目標設定済みprojectの行 .stats-twelve-week-row[data-project-id='p-goal'] が存在する(DOM契約)", goalRow !== null);
    // 期待値120は「先週分(+60)・対象外task(+60)・計画のみ(+45)のどれが混入しても120でなくなる」判別値
    check("今週の投資時間 = 120分(当日実績のみ。先週分・対象外task・計画のみは入らない)", textHasMin(goalRow, 120), goalRow);
    check("週目標 300分(weeklyTargetMin)が表示される", textHasMin(goalRow, 300), goalRow);
    const goalBarWidths = await page.evaluate(() =>
      [...document.querySelectorAll('.stats-twelve-week-row[data-project-id="p-goal"] [style*="width"]')].map((el) => el.style.width));
    check("今週実績/目標バーの幅が 40%(120/300)を表す(前提B3-2)",
      goalBarWidths.some((w) => Math.abs(parseFloat(w) - 40) < 0.5), JSON.stringify(goalBarWidths));
    check("実績が 2h ちょうど(2h45m等の端数付き表示が無い=textHasMinの包含判定の弱さ対策。v184レビューM4)",
      !/2h\d/.test(goalRow || ""), goalRow);
    const nogoalRow = await twelveWeekRowText("p-nogoal");
    check("目標未設定(0)の行も存在する(誘導のため行ごと消さない)", nogoalRow !== null);
    check("目標未設定(0)の行はバー非表示(width指定要素が無い。前提B3-2)",
      await page.evaluate(() => !document.querySelector('.stats-twelve-week-row[data-project-id="p-nogoal"] [style*="width"]')));
    check("目標未設定(0)の行に目標設定への誘導文言(「目標」を含む)が出る(§5-2・前提B3-3)",
      /目標/.test(nogoalRow || ""), nogoalRow);

    // ============================================================
    // [23] 既存パネルの回帰: 新2パネルは常時表示層の先頭、既存パネル群は引き続き描画される
    // ============================================================
    console.log("[23] 既存パネルが引き続き描画される(新2パネル=常時表示層の先頭・既存9パネル無変更 §5)");
    const failuresBeforeB3Reg = failures;  // [23]区間のpageerror検出用([13]と同じ方式)
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB3({
      view: "stats",
      settings: { twelveWeekStartDate: CYCLE_START },
      projects: [projectFx("p-goal", "12WY目標あり", { weeklyTargetMin: 300 })],
      tasks: [taskFx("t-goal", "p-goal")],
      blocks: [
        // 完了+実績ありBlockを置き、既存詳細パネル(カテゴリ別 時間配分など)が生成される状態にする
        block("reg-1", { title: "REG-完了1", category: "仕事", completed: true, actualStartAt: at("09:00"), actualEndAt: at("09:45") }),
        block("reg-2", { title: "REG-完了2", category: "学習", completed: true, actualStartAt: at("10:00"), actualEndAt: at("10:30") })
      ]
    });
    await page.waitForSelector(".stats-time-log", { state: "attached" });
    check("新2パネル(.stats-time-log / .stats-twelve-week)が両方描画される",
      await page.locator(".stats-time-log").count() === 1 && await page.locator(".stats-twelve-week").count() === 1);
    check("計器盤ヘッダが引き続き表示される",
      ((await page.evaluate(() => document.getElementById("main").textContent)) || "").includes("計器盤"));
    check("レンジセグメント(4週/12週/全期間)が3つ残っている(既存UI無変更)",
      await page.locator('[data-action="stats-range"]').count() === 3);
    check("既存の詳細フォールド(stats-details)が残っている",
      await page.locator('details[data-fold-id="stats-details"]').count() === 1);
    // 注意: 新TIME LOGパネルの注記にも「カテゴリ別 時間配分」の語が含まれるため、
    // 既存パネルの実在確認はフォールド内textContentへスコープして判定する
    check("既存パネル代表「カテゴリ別 時間配分」がフォールド内に引き続き存在する",
      await page.evaluate(() =>
        (document.querySelector('details[data-fold-id="stats-details"]')?.textContent || "").includes("カテゴリ別 時間配分")));
    check(".stats-time-log がフォールドの中に入っていない(常時表示層。DOM契約)",
      await page.evaluate(() => !document.querySelector('details[data-fold-id="stats-details"] .stats-time-log')));
    check(".stats-twelve-week がフォールドの中に入っていない(常時表示層。DOM契約)",
      await page.evaluate(() => !document.querySelector('details[data-fold-id="stats-details"] .stats-twelve-week')));
    check(".stats-time-log が既存詳細フォールドよりDOM順で前にある(常時表示層の先頭)",
      await page.evaluate(() => {
        const tl = document.querySelector(".stats-time-log");
        const fold = document.querySelector('details[data-fold-id="stats-details"]');
        return !!tl && !!fold && !!(tl.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING);
      }));
    check("[23]区間の描画でpageerrorが発生しない", failures === failuresBeforeB3Reg);

    // ============================================================
    // ==== ここから B4(P10 cockpitテーマ6点セット / P11 全画面適用)追記セクション [24]〜[29] ====
    // 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md §6(6点セット。1つでも漏れるとドリフト)・
    //   §7のP10/P11行(完了条件。特にP10「cockpit選択が再読込・同期後も維持される(A2再発防止の明示テスト)」)・
    //   §11(P11対応表。now-line色は「cockpit時のみ変数で上書き」)。
    // 現物調査: workbench/out/2026-07-29-today-cockpit-impl/b4-css-inventory.md(6点セットの実位置)。
    // 実装(別担当が並行作業中)より先に仕様から書いた。前提が実装と食い違った場合は
    // テストを弱めるのではなく、前提の側を実装と突合して直すこと:
    //   前提B4-1: cockpit適用も既存2テーマと同じ html[data-theme] 属性経路
    //            (index.html同期スクリプト(§6-6)+ render()内applyTheme()(§6-2/3))で行う
    //   前提B4-2: 設定画面のテーマ選択肢は既存 select[data-setting-field="theme"] に
    //            option value="cockpit"(表示名に「コックピット」を含む)を追加する(§6-5。
    //            変更適用は既存data-setting-field汎用changeハンドラ=selectOptionで発火)
    //   前提B4-3: 未知テーマ値はnormalizeStateの許可リスト(§6-4)で既定 "dark" へフォールバック
    //            (既存実装 app.js の normalizeState がテーマ不正値を "dark" に落とす現挙動を維持)
    //   前提B4-4: cockpitの --bg は #050a14系(サンプル値。b4-css-inventory.md §3-2)。実装が
    //            近傍色へ調整する余地を残すため、厳密hex一致ではなく
    //            「既存light/darkのどちらの値でもない」+「暗い青系(全ch<64かつ青>赤)」で判定する
    //   前提B4-5: timelineのnow-line色(src/features/timeline.js のインライン#FF3B30)は
    //            cockpit時のみ #FF3B30 以外へ上書きされ、light/darkでは従来色 #FF3B30 のまま
    //            (§11は「上書き検討(1行)」表記だが、本スイートは委譲指示に従い契約として検証する。
    //             実装が意図的に上書きを見送る場合はこの前提を実装と突合して直す)
    // ============================================================

    // 色文字列 "rgb(r, g, b)" / "rgba(...)" のパース(B4専用小物)
    const parseRgbB4 = (s) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || "");
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    };
    // 現在テーマでの var(--bg) の解決値を、probe要素のcomputed backgroundColorとして読む
    // (bodyの背景がグラデーション等のshorthandでも --bg 自体の値を直接検証できる)
    async function resolvedBgVar() {
      return page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--bg)";
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
      });
    }
    const LEGACY_DARK_BG = "rgb(17, 18, 22)";     // #111216
    const LEGACY_LIGHT_BG = "rgb(247, 247, 250)"; // #f7f7fa
    const NOW_LINE_LEGACY = "rgb(255, 59, 48)";   // #FF3B30(timeline.jsの従来ハードコード)

    // ============================================================
    // [24] P10 A2再発防止(最重要): theme="cockpit" がリロード・保存・再リロードを跨いで維持される
    // ============================================================
    console.log("[24] P10 A2再発防止: settings.theme='cockpit' をseed→リロードしてもテーマが維持される(§6-4許可リスト)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ view: "today", settings: { theme: "cockpit" } });
    // seed()内のreloadで index.html同期スクリプト → normalizeState → render(applyTheme) を通過済み。
    // 許可リストにcockpitが漏れているとここで data-theme が "dark" になりタイムアウトで落ちる(A2)。
    await page.waitForSelector('html[data-theme="cockpit"]', { state: "attached" });
    check("リロード後も html[data-theme='cockpit'] が維持される(§6-3/6-6。漏れるとdarkへ戻る)", true);
    // 保存契機(setView)を踏んで localStorage へ書き戻させ、normalizeStateが値を
    // 黙って "dark" に矯正していないことを突合する([21]と同じ保存契機の踏み方)
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.theme === "cockpit", KEY);
    check("保存(setView契機)後も localStorage の settings.theme が 'cockpit' のまま(A2の本体=正規化での矯正が無い)", true);
    // 再リロード(seedし直さない=保存済みstateそのままの起動)でも維持される
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.waitForSelector('html[data-theme="cockpit"]', { state: "attached" });
    check("保存済みstateからの再リロードでも data-theme='cockpit' が維持される(P10完了条件の明示テスト)", true);
    check("再リロード後の settings.theme も 'cockpit' のまま", (await stateNow()).settings.theme === "cockpit");

    // ============================================================
    // [25] P10: 設定画面のテーマ選択肢に「コックピット」があり、選択でbody配色が変わる
    // ============================================================
    console.log("[25] P10: 設定画面のテーマselectに「コックピット」が出て、選択で配色が --bg:#050a14系 へ変わる(§6-5)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ view: "settings", settings: { theme: "dark" } });
    await page.waitForSelector('select[data-setting-field="theme"]', { state: "attached" });
    // テーマselectは折りたたみ群「表示・タイマー」(details[data-fold-id="settings-display"]、既定閉)の
    // 中にあるため、selectOption(可視要素必須)の前にフォールドを開く
    await page.evaluate(() => { const d = document.querySelector('details[data-fold-id="settings-display"]'); if (d) d.open = true; });
    check("テーマselectに option[value='cockpit'] がある(§6-5)",
      await page.locator('select[data-setting-field="theme"] option[value="cockpit"]').count() === 1);
    check("cockpit選択肢の表示名に「コックピット」を含む(前提B4-2)",
      ((await page.evaluate(() =>
        document.querySelector('select[data-setting-field="theme"] option[value="cockpit"]')?.textContent)) || "")
        .includes("コックピット"));
    await page.locator('select[data-setting-field="theme"]').selectOption("cockpit");
    await page.waitForSelector('html[data-theme="cockpit"]', { state: "attached" });
    check("選択で html[data-theme='cockpit'] へ切り替わる(data-setting-field汎用ハンドラ→applyTheme)", true);
    const cockpitBgVar = await resolvedBgVar();
    const cockpitRgb = parseRgbB4(cockpitBgVar);
    check("cockpitの --bg が既存light/darkのどちらの値でもない(cockpit専用値が定義されている)",
      cockpitBgVar !== LEGACY_DARK_BG && cockpitBgVar !== LEGACY_LIGHT_BG, cockpitBgVar);
    check("cockpitの --bg が #050a14系の暗い青系(全ch<64かつ青>赤。前提B4-4)",
      !!cockpitRgb && cockpitRgb.r < 64 && cockpitRgb.g < 64 && cockpitRgb.b < 64 && cockpitRgb.b > cockpitRgb.r,
      cockpitBgVar);
    const cockpitBodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("body の computed background が従来dark/light値から変わる(選択が実際に見た目へ効く)",
      cockpitBodyBg !== LEGACY_DARK_BG && cockpitBodyBg !== LEGACY_LIGHT_BG, cockpitBodyBg);

    // ============================================================
    // [26] P10: 未知テーマ値はnormalizeStateで既定へフォールバックし白画面にならない
    // ============================================================
    console.log("[26] P10: 未知テーマ値('neon')が既定 'dark' へフォールバックし、白画面にならない(§6-4)");
    const failuresBeforeNeon = failures;  // この区間のpageerror検出用([13]と同じ方式)
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ view: "today", settings: { theme: "neon" } });
    await page.waitForSelector('html[data-theme="dark"]', { state: "attached" });
    check("未知テーマ('neon')は data-theme='dark'(既定)へフォールバックする(前提B4-3)", true);
    check("フォールバック後も today ビューが白画面にならない(#main非空)",
      await page.evaluate(() => document.getElementById("main").innerHTML.trim().length > 0));
    check("フォールバック後もパネル(NOW FOCUS)が描画される", await page.locator(".today-now-focus").count() === 1);
    // 保存契機を踏むと不正値がstorage上も既定値へ正規化される(不正値の永続化を許さない)
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.theme === "dark", KEY);
    check("保存後は settings.theme が既定 'dark' に正規化される('neon'が残らない)", true);
    check("[26]区間の描画でpageerrorが発生しない", failures === failuresBeforeNeon);

    // ============================================================
    // [27] P10: light/dark無変更 — cockpit導入後も既存2テーマの背景色が従来値のまま(回帰)
    // ============================================================
    console.log("[27] P10: cockpit導入後も light/dark の body 背景が従来値のまま([14]と同手法の回帰確認)");
    await seed({ view: "today", settings: { theme: "dark" } });
    await page.waitForSelector('html[data-theme="dark"]', { state: "attached" });
    const darkBgB4 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("darkテーマの body 背景が従来値 #111216 = rgb(17, 18, 22) のまま(cockpit実装後の回帰)",
      darkBgB4 === LEGACY_DARK_BG, darkBgB4);
    await seed({ view: "today", settings: { theme: "light" } });
    await page.waitForSelector('html[data-theme="light"]', { state: "attached" });
    const lightBgB4 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("lightテーマの body 背景が従来値 #f7f7fa = rgb(247, 247, 250) のまま(cockpit実装後の回帰)",
      lightBgB4 === LEGACY_LIGHT_BG, lightBgB4);

    // ============================================================
    // [28] P11: cockpitテーマで主要ビューを巡回して pageerror ゼロ・#main非空
    // ============================================================
    console.log("[28] P11: cockpitテーマで today/home/stats/timeline/settings を巡回し、pageerrorゼロ・#main非空");
    const failuresBeforeTour = failures;  // 巡回区間のpageerror検出用(page.on('pageerror')が加算する)
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      settings: { theme: "cockpit" },
      blocks: [
        // 各ビューに中身が出る最小フィクスチャ(実行中1+完了1+未着手1)
        block("b4-run", { title: "B4-実行中", category: "仕事", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("12:30"), estimateMin: 90 }),
        block("b4-done", { title: "B4-完了", category: "学習", completed: true, actualStartAt: at("09:00"), actualEndAt: at("09:45") }),
        block("b4-plan", { title: "B4-未着手", category: "仕事", plannedStartAt: at("14:00"), plannedEndAt: at("14:30") })
      ]
    });
    await page.waitForSelector('html[data-theme="cockpit"]', { state: "attached" });
    for (const view of ["today", "home", "stats", "timeline", "settings"]) {
      await page.locator(`#sidebar .nav-button[data-action="nav"][data-view="${view}"]`).click();
      await waitView(view);
      check(`cockpitテーマで ${view} ビューの #main が空でない`,
        await page.evaluate(() => document.getElementById("main").innerHTML.trim().length > 0));
    }
    check("巡回後も data-theme='cockpit' が維持されている(各render()のapplyTheme()で剥がれない)",
      await page.evaluate(() => document.documentElement.getAttribute("data-theme")) === "cockpit");
    check("[28]巡回区間で pageerror が発生しない(P11完了条件の機械検証部分)", failures === failuresBeforeTour);

    // ============================================================
    // [29] P11: timelineのnow-line色 — cockpit時は#FF3B30以外、light/dark時は従来色
    // ============================================================
    console.log("[29] P11: now-line色がcockpit時のみ変わり(#FF3B30以外)、light/darkでは従来色 #FF3B30 のまま(§11・前提B4-5)");
    // 固定時刻12:00はtimeline表示レンジ(startHour=5〜)内なのでnow-lineが必ず描画される。
    // 検証はcomputed borderTopColor(実装がインラインstyleのvar()参照でもCSS上書きでも成立する読み方)。
    async function nowLineBorderColor() {
      return page.evaluate(() => {
        const el = document.querySelector(".now-line");
        return el ? getComputedStyle(el).borderTopColor : null;
      });
    }
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ view: "timeline", settings: { theme: "cockpit" } });
    await page.waitForSelector(".now-line", { state: "attached" });
    const cockpitNowLine = await nowLineBorderColor();
    check("cockpitテーマで now-line が描画される", cockpitNowLine !== null);
    check("cockpitテーマの now-line 色が従来ハードコード #FF3B30 以外(変数上書きが効いている。前提B4-5)",
      cockpitNowLine !== null && cockpitNowLine !== NOW_LINE_LEGACY, cockpitNowLine);
    await seed({ view: "timeline", settings: { theme: "dark" } });
    await page.waitForSelector(".now-line", { state: "attached" });
    check("darkテーマの now-line 色は従来色 #FF3B30 = rgb(255, 59, 48) のまま(P11: light/dark非影響)",
      (await nowLineBorderColor()) === NOW_LINE_LEGACY, await nowLineBorderColor());
    await seed({ view: "timeline", settings: { theme: "light" } });
    await page.waitForSelector(".now-line", { state: "attached" });
    check("lightテーマの now-line 色は従来色 #FF3B30 = rgb(255, 59, 48) のまま(P11: light/dark非影響)",
      (await nowLineBorderColor()) === NOW_LINE_LEGACY, await nowLineBorderColor());

    // ============================================================
    // ==== ここから B5(F1/F2/F3/F5)追記セクション [30]〜[34] ====
    // 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md §12 の F1/F2/F3/F5 行
    //   (2026-07-29改訂版。K裁定②=F3は加点表現・ストリーク/連続日数は出さない)。
    // 現物調査: workbench/out/2026-07-29-today-cockpit-impl/b5-survey.md(部品実名の正)。
    // DOM契約(実装側と共有済み):
    //   F1: 既存 #blockTitle(renderTasksのform-strip) / F2: .drift-panel / .time-comb /
    //   .time-comb-gap[data-start][data-end] / F3: .routine-week-days / .routine-trend /
    //   F5: .wish-ripeness / .wish-ripeness-bar
    // 実装(別担当が並行作業中)より先に仕様から書いた。前提が実装と食い違った場合は
    // テストを弱めるのではなく、前提の側を実装と突合して直すこと:
    //   前提B5-1: F1のEnter確定は #blockTitle のkeydown(Enter)。IME変換中は既存の
    //            _imeComposing(document委譲のcompositionstart/end)ガードで無視される
    //   前提B5-2: F1の確定は既存 addBlock() 相当(getOtherTask()紐づけ+defaultPlannedTimes())。
    //            「当日固定」= selectedDateが過去日でも date/planned は今日になる(§12 F1)
    //   前提B5-3: F1の入力保護は既存 renderDeferringForFocus 相乗り(§4・C5。新フラグを作らない)。
    //            検証はhighlights.json応答の保留→入力中に解放→hydrateStaticMarkdown(v133で
    //            tasksもライブ再描画対象)が発火するrenderDeferringForFocusの延期で行う
    //   前提B5-4: DRIFTのズレ分数は textHasMin() の許容形式(「n分」等)で表示される。
    //            ズレ = computeProjectedEnd(今日, now) − 当日blocksの最大plannedEnd(b5-survey §2-2)
    //   前提B5-5: 「送る」は既存carryOverBlockのセマンティクス踏襲(翌日に新Block・元Blockに
    //            migratedTo・carryCount+1)。追加UIは挟まない
    //   前提B5-6: .time-comb-gap の data-start/data-end は "HH:MM"系文字列か分数値のどちらか
    //            (両対応で解釈する)。タップは「先にBlockを作ってから」編集モーダルを開く(§12 F2)
    //   前提B5-7: F3の「直近7日」は当日を含む7日窓。「実施できた日」= done≥1。当日ぶんは
    //            gardenLog[今日]とroutineRate(当日blocks)を同値にseedし、どちらの実装でも一致させる
    //   前提B5-8: F3トレンドの点は .routine-trend 内の [data-date] 要素(キー存在日のみ描画・
    //            30日窓は当日を含む)。欠測日・窓外日には要素を作らない
    //   前提B5-9: F5の熟成度は .wish-ripeness-bar のインラインstyle width%(30日=50%・90日=100%
    //            の固定写像・90日以降は100%で頭打ち)。45日は50〜100%の中間
    //            (30〜90日を線形補間するなら 50 + (45-30)×(50/60) = 62.5%)
    // ============================================================

    // B5用seed: 既存seed()/seedB2()/seedB3()と同じ流儀に selectedDate / gardenLog を足した拡張
    // (既存関数は変更禁止のため別名で追加。pomodoro/zeroThinkingは前セクションの持ち越し防止で毎回リセット)
    async function seedB5({ blocks = [], view = "tasks", settings = {}, selectedDate = TODAY, projects = null, tasks = null, gardenLog = null } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, selectedDate, projects, tasks, gardenLog }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = selectedDate;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        s.gardenLog = gardenLog || {};
        s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
        s.pomodoro = { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        if (projects) s.projects = projects;
        if (tasks) s.tasks = tasks;
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, view, settings, selectedDate, projects, tasks, gardenLog });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    }

    // ============================================================
    // [30] F1: #blockTitle+Enterで当日Blockが追加され、既存フィルタを通って一覧に出る
    //   (IME変換中のEnterは確定されない=_imeComposingガードの検証を同居)
    // ============================================================
    console.log("[30] F1: #blockTitleでEnter→当日Blockが増え(taskId紐づけで一覧に出る)、IME変換中のEnterは無視される");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({ view: "tasks", blocks: [] });
    await page.waitForSelector("#blockTitle", { state: "attached" });
    const defaultCategory = await page.locator("#blockCategory").inputValue();  // カテゴリ既定値(先頭option)
    await page.locator("#blockTitle").click();
    await page.keyboard.type("QUICKADD-Enter追加");
    // IME変換中のEnter(無視されるべき): 既存のdocument委譲compositionstartリスナー(app.js)へ
    // バブリングで届く合成イベントを発火してから押す(前提B5-1)
    await page.evaluate(() => {
      document.getElementById("blockTitle").dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      document.getElementById("blockTitle").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    });
    // 確定後(非変換中)のEnter → 追加される。もしIME中Enterも確定されていればblocksは2件になり
    // 下の「ちょうど1件」判定で落ちる(固定waitなしで負の検証を含める読み方)
    await page.keyboard.press("Enter");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.length >= 1, KEY);
    const stQuickAdd = await stateNow();
    check("Enterで state.blocks がちょうど1件増える(IME変換中のEnterは確定されない。前提B5-1)",
      stQuickAdd.blocks.length === 1, `blocks=${stQuickAdd.blocks.length}`);
    const added = stQuickAdd.blocks[0];
    check("追加Blockのtitleが入力値になる", added?.title === "QUICKADD-Enter追加", JSON.stringify(added));
    check("追加Blockが当日日付になる(§12 F1: 当日固定)", added?.date === TODAY, added?.date);
    check("追加Blockにカテゴリ既定値(selectの現在値)が入る", added?.category === defaultCategory,
      `category=${added?.category} 既定値=${defaultCategory}`);
    check("defaultPlannedTimes()を通る(固定12:00 → plannedStartAt=T12:00)(前提B5-2)",
      (added?.plannedStartAt || "").includes("T12:00"), added?.plannedStartAt);
    const addedTask = stQuickAdd.tasks.find((t) => t.id === added?.taskId);
    check("taskIdが「その他」受け皿Taskに紐づく(taskId無しBlockは一覧に出ないため必須。§12 F1)",
      !!added?.taskId && !!addedTask && addedTask.kind === "other" && !!addedTask.projectId,
      JSON.stringify({ taskId: added?.taskId, task: addedTask }));
    check("追加Blockが実行ビューの一覧(既存フィルタ通過後)に表示される",
      await page.locator(".block-row", { hasText: "QUICKADD-Enter追加" }).count() === 1);
    check("追加後は #blockTitle が空に戻る(再描画で入力欄がリセットされる)",
      (await page.locator("#blockTitle").inputValue()) === "");

    // ============================================================
    // [30b] F1: 過去日を選択中でも追加先は当日(当日固定)
    // ============================================================
    console.log("[30b] F1: selectedDate=昨日の実行ビューからEnter追加しても、Blockは今日の日付で作られる(当日固定)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({ view: "tasks", selectedDate: YESTERDAY, blocks: [] });
    await page.waitForSelector("#blockTitle", { state: "attached" });
    await page.locator("#blockTitle").click();
    await page.keyboard.type("QUICKADD-昨日画面から");
    await page.keyboard.press("Enter");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.length === 1, KEY);
    const addedFromPast = (await stateNow()).blocks[0];
    check("過去日表示中でも追加Blockの date は今日になる(§12 F1: 当日固定。前提B5-2)",
      addedFromPast?.date === TODAY, addedFromPast?.date);
    check("plannedStartAt も今日の日付で組み立てられる",
      (addedFromPast?.plannedStartAt || "").startsWith(`${TODAY}T`), addedFromPast?.plannedStartAt);

    // ============================================================
    // [30c] F1: 入力中の再描画トリガで文字が消えない(renderDeferringForFocus相乗り。[17f]の発展形)
    //   手順: highlights.json応答を保留したままseed → #blockTitleに入力 → 応答を解放して
    //   hydrateStaticMarkdown(changed=true・tasksは再描画対象)にrenderDeferringForFocusを
    //   発火させる → フォーカス中は再描画が延期され入力が残る → blurで延期分がflushされる
    //   (プローブDOMの消滅で「延期→flush」が実際に起きたことを正の証拠として確認する)
    // ============================================================
    console.log("[30c] F1: 入力中にhydrate由来の再描画トリガが発火しても文字が残る(isFocusInEditableElement保護・前提B5-3)");
    const kindleHold = { active: false, held: [] };
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (kindleHold.active && p.endsWith("/contents/taskchute/reading/highlights.json")) {
        kindleHold.held.push(route);  // 応答保留(下で明示的にfulfillする)
        return;
      }
      return route.fallback();  // 保留しない時はB2登録済みのフィクスチャ応答へ
    });
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    kindleHold.active = true;
    const heldReq = page.waitForRequest((r) => r.url().includes("reading/highlights.json"));
    await seedB5({ view: "tasks", blocks: [] });
    await heldReq;  // リクエスト到達=保留成立(この時点でhydrateは未完了のまま待っている)
    await page.waitForSelector("#blockTitle", { state: "attached" });
    await page.locator("#blockTitle").click();
    await page.keyboard.type("PROTECT-入力保持");
    // 全再描画で消えるプローブを差しておく(延期中は生存・flushで消える)
    await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.id = "b5RenderProbe";
      document.getElementById("main").appendChild(probe);
    });
    const heldResp = page.waitForResponse((r) => r.url().includes("reading/highlights.json"));
    kindleHold.active = false;
    for (const r of kindleHold.held.splice(0)) {
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KINDLE_HIGHLIGHTS_FIXTURE) });
    }
    await heldResp;
    // hydrate継続(promise連鎖)がrenderDeferringForFocusの判定へ到達するまでイベントループを回す
    // (固定waitではなくprotocolラウンドトリップでマクロタスクを消化する)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("再描画トリガ発火後も入力値が残る(フォーカス中はrenderDeferringForFocusが延期する)",
      (await page.locator("#blockTitle").inputValue()) === "PROTECT-入力保持",
      await page.locator("#blockTitle").inputValue());
    check("フォーカスも #blockTitle に残る", await page.evaluate(() => document.activeElement?.id === "blockTitle"));
    check("延期中はプローブDOMが生きている(全再描画がまだ走っていない)",
      await page.evaluate(() => !!document.getElementById("b5RenderProbe")));
    // blur(focusout)→ attemptFlushDeferredRender が延期分をflush → プローブ消滅が正の証拠。
    // ここが消えない場合は「hydrateがchanged=trueにならず再描画自体が無かった」= 前提B5-3の破れ
    await page.evaluate(() => document.getElementById("blockTitle")?.blur());
    const probeFlushed = await page.waitForFunction(() => !document.getElementById("b5RenderProbe"), null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    check("blurで延期されていた再描画がflushされる(プローブ消滅=延期が実際に起きていた証拠)", probeFlushed);

    // ============================================================
    // [31] F2 DRIFT: 当日+未完了ありで表示され、ズレ分数が手計算と一致する
    // ============================================================
    console.log("[31] F2 DRIFT: 固定フィクスチャでズレ85分(computeProjectedEnd 15:25 − 最終plannedEnd 14:00)が表示される");
    // 手計算(12:00固定): 残見積 = d-run(est120, 11:00着手→残60) + d-send(90) + d-small(55) = 205分
    //   → 着地 = 12:00+205分 = 15:25(925)。最終plannedEnd = d-small 14:00(840)。ズレ = +85分。
    //   85は分表示(00-59)にも時表示(00-24)にも現れない判別値(「13:55」等との包含誤マッチがない)
    const driftBlocks = [
      block("d-done", { title: "DRIFT-完了済", category: "仕事", completed: true, plannedStartAt: at("09:00"), plannedEndAt: at("10:00"), actualStartAt: at("09:00"), actualEndAt: at("10:00"), estimateMin: 60 }),
      block("d-run", { title: "DRIFT-実行中", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("12:00"), estimateMin: 120 }),
      // carryCount:2 → nextCount=3でも追加UIを挟まず送る(前提B5-5の検証用)
      block("d-send", { title: "DRIFT-送る対象", plannedStartAt: at("12:30"), plannedEndAt: at("13:15"), estimateMin: 90, carryCount: 2 }),
      block("d-small", { title: "DRIFT-小粒", plannedStartAt: at("13:30"), plannedEndAt: at("14:00"), estimateMin: 55 })
    ];
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({ view: "timeline", blocks: driftBlocks });
    await page.waitForSelector(".drift-panel", { state: "attached" });
    check("当日+未完了ありで .drift-panel が表示される(DOM契約・§12 F2表示条件)",
      await page.locator(".drift-panel").count() === 1);
    const driftText = await panelText(".drift-panel");
    check("ズレ分数 85分が手計算と一致して表示される(前提B5-4)", textHasMin(driftText, 85), driftText);

    // ============================================================
    // [31b] F2 DRIFT「送る」: 対象Blockが翌日へ移り(migratedTo記録・追加UIなし)、着地が再計算される
    // ============================================================
    console.log("[31b] F2: 「送る」で決定論選出の1件(残90分のd-sendのみがズレ85分を吸収可能)が翌日へ移る");
    await page.locator(".drift-panel button", { hasText: "送る" }).first().click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.migratedTo), KEY);
    const stAfterSend = await stateNow();
    const movedSrc = stAfterSend.blocks.find((b) => b.migratedTo);
    check("決定論選出: 送られるのは d-send(残90分。d-run残60/d-small残55ではズレ85分に収まらない)",
      movedSrc?.id === "d-send", movedSrc?.id);
    const movedNew = stAfterSend.blocks.find((b) => b.id === movedSrc?.migratedTo);
    check("翌日に新Blockが作られ元Blockの migratedTo が新Block idを指す(既存セマンティクス踏襲)",
      !!movedNew && movedNew.date === TOMORROW, JSON.stringify({ migratedTo: movedSrc?.migratedTo, newDate: movedNew?.date }));
    check("新Blockのタイトルが引き継がれる", movedNew?.title === "DRIFT-送る対象", movedNew?.title);
    check("carryCount が +1 される(2→3。既存carryOverBlockと同じ積み上げ)", movedNew?.carryCount === 3,
      String(movedNew?.carryCount));
    check("追加モーダルが出ない(nextCount=3でも直接送る。前提B5-5)",
      await page.locator(".modal-card").count() === 0);
    check("送られていない残Block(d-run/d-small)に migratedTo が付かない",
      !stAfterSend.blocks.find((b) => b.id === "d-run")?.migratedTo && !stAfterSend.blocks.find((b) => b.id === "d-small")?.migratedTo);
    // 着地再計算: 送った後の残 = 60+55 = 115分 → 着地13:55 ≦ 計画14:00 → ズレ85分の表示は残らない
    const driftText2 = await panelText(".drift-panel");
    check("「送る」後にズレ85分の表示が消える(着地予定が再計算される)",
      driftText2 === null || !textHasMin(driftText2, 85), driftText2);
    // v186レビューT-2: 二重送り防止(postponeBlockToNextDayのsrc.migratedToガード)。
    // 送済みBlockのidで直接actionを再発火してもBlock数が増えない
    const blocksBeforeResend = stAfterSend.blocks.length;
    await page.evaluate((id) => {
      const btn = document.createElement("button");
      btn.dataset.action = "drift-postpone"; btn.dataset.id = id;
      document.body.appendChild(btn); btn.click(); btn.remove();
    }, movedSrc?.id);
    const stAfterResend = await stateNow();
    check("送済みBlockへの再送はブロックされる(blocks数不変・二重送り防止)",
      stAfterResend.blocks.length === blocksBeforeResend, `${blocksBeforeResend}→${stAfterResend.blocks.length}`);

    // ============================================================
    // [31c] F2 DRIFT表示条件: 過去日selectedDate・未完了0件では表示されない
    // ============================================================
    console.log("[31c] F2: 過去日表示・未完了0件では .drift-panel が出ない(§12 F2表示条件)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({
      view: "timeline", selectedDate: YESTERDAY,
      blocks: [block("y-open", { title: "昨日の未完了", date: YESTERDAY, plannedStartAt: atOn(YESTERDAY, "13:00"), plannedEndAt: atOn(YESTERDAY, "14:00"), estimateMin: 60 })]
    });
    await waitView("timeline");
    check("過去日(selectedDate=昨日)では未完了があっても .drift-panel が出ない",
      await page.locator(".drift-panel").count() === 0);
    await seedB5({
      view: "timeline",
      blocks: [block("all-done", { title: "全部完了", completed: true, plannedStartAt: at("09:00"), plannedEndAt: at("10:00"), actualStartAt: at("09:00"), actualEndAt: at("10:00") })]
    });
    await waitView("timeline");
    check("当日でも未完了0件なら .drift-panel が出ない", await page.locator(".drift-panel").count() === 0);

    // ============================================================
    // [32] F2 TIME COMB: 実績間15分以上の隙間が列挙され、タップでBlock作成+編集モーダル
    // ============================================================
    console.log("[32] F2 TIME COMB: 実績間の30分の隙間(10:00-10:30)が列挙され、5分の隙間は列挙されない。タップでBlock作成→編集モーダル");
    // data-start/data-end の解釈("HH:MM"系文字列でも分数値でも成立。前提B5-6)
    const combMin = (v) => {
      if (v == null) return NaN;
      const s = String(v);
      const t = s.includes("T") ? s.slice(s.indexOf("T") + 1) : s;
      if (/^\d+$/.test(t)) return Number(t);
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    };
    const combBlocks = [
      block("c-1", { title: "COMB-1", completed: true, actualStartAt: at("09:00"), actualEndAt: at("10:00") }),
      block("c-2", { title: "COMB-2", completed: true, actualStartAt: at("10:30"), actualEndAt: at("11:30") }),
      // 11:30→11:35 の5分間は15分未満なので隙間として列挙されない
      block("c-3", { title: "COMB-3", completed: true, actualStartAt: at("11:35"), actualEndAt: at("11:50") }),
      // 未完了1件(DRIFT/COMBの表示条件「未完了≥1」を満たすため。実績なしなので隙間計算には関与しない)
      block("c-plan", { title: "COMB-未着手", plannedStartAt: at("14:00"), plannedEndAt: at("14:30"), estimateMin: 30 })
    ];
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({ view: "timeline", blocks: combBlocks });
    await page.waitForSelector(".time-comb", { state: "attached" });
    check("当日の時間ビューに .time-comb が表示される(DOM契約)", await page.locator(".time-comb").count() === 1);
    const combGaps = await page.evaluate(() =>
      [...document.querySelectorAll(".time-comb-gap")].map((el) => ({ start: el.dataset.start, end: el.dataset.end })));
    check("実績間の隙間 10:00→10:30(30分)が data-start/data-end 付きで列挙される",
      combGaps.some((g) => combMin(g.start) === 600 && combMin(g.end) === 630), JSON.stringify(combGaps));
    check("15分未満の隙間(11:30→11:35)は列挙されない(全gapが15分以上)",
      combGaps.length >= 1 && combGaps.every((g) => combMin(g.end) - combMin(g.start) >= 15), JSON.stringify(combGaps));
    // タップ → 「先にBlockを作ってから」編集モーダルが開く(§12 F2・前提B5-6)
    const gapIdx = combGaps.findIndex((g) => combMin(g.start) === 600 && combMin(g.end) === 630);
    const combSeededIds = new Set(combBlocks.map((b) => b.id));
    await page.locator(".time-comb-gap").nth(gapIdx).click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    await page.waitForFunction(({ KEY, n }) => JSON.parse(localStorage.getItem(KEY)).blocks.length === n + 1, { KEY, n: combBlocks.length });
    const stAfterGapTap = await stateNow();
    const gapBlock = stAfterGapTap.blocks.find((b) => !combSeededIds.has(b.id));
    check("タップで新規Blockが作成される(seed 4件 → 5件)", !!gapBlock, JSON.stringify(stAfterGapTap.blocks.map((b) => b.id)));
    check("新規Blockが隙間の時間帯(10:00-10:30)を予定時刻に持つ",
      (gapBlock?.plannedStartAt || "").includes("T10:00") && (gapBlock?.plannedEndAt || "").includes("T10:30"),
      JSON.stringify({ start: gapBlock?.plannedStartAt, end: gapBlock?.plannedEndAt }));
    check("新規Blockは当日日付+「その他」Task紐づけ(makeBlock({taskId: getOtherTask()?.id})の契約)",
      gapBlock?.date === TODAY && !!gapBlock?.taskId &&
      stAfterGapTap.tasks.find((t) => t.id === gapBlock?.taskId)?.kind === "other",
      JSON.stringify({ date: gapBlock?.date, taskId: gapBlock?.taskId }));
    check("既存のBlock編集モーダルが開いている", await page.locator(".modal-card").count() === 1);
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });

    // ============================================================
    // [33] F3: 「直近7日で実施できた日数 n/7」が gardenLog フィクスチャの期待値と一致する
    // ============================================================
    console.log("[33] F3: gardenLogフィクスチャで「直近7日 4/7」(今日・-1・-3・-6が実施。-2/-5は0件、-4は欠測)が一致する");
    // 実施できた日(done≥1): 今日(2/3)・-1(2/3)・-3(1/1)・-6(3/3)= 4日。
    // -2(0/3)・-5(0/2)は記録ありの0件日、-4は欠測(キーなし)、-40は30日トレンド窓外の検証用。
    // 当日ぶんはgardenLog[今日]={2,3}と実blocks(ルーティン3件中2完了)を同値にし、
    // 実装が当日をgardenLog/routineRateのどちらで読んでも同じ結果にする(前提B5-7)
    const gardenFixture = {
      [TODAY]: { done: 2, total: 3 },
      [daysAgoISO(1)]: { done: 2, total: 3 },
      [daysAgoISO(2)]: { done: 0, total: 3 },
      [daysAgoISO(3)]: { done: 1, total: 1 },
      [daysAgoISO(5)]: { done: 0, total: 2 },
      [daysAgoISO(6)]: { done: 3, total: 3 },
      [daysAgoISO(40)]: { done: 1, total: 1 }
    };
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({
      view: "routine",
      gardenLog: gardenFixture,
      blocks: [
        block("f3-r1", { title: "F3-ルーティン1", category: "ルーティン", plannedStartAt: at("07:00"), plannedEndAt: at("07:15"), completed: true, actualStartAt: at("07:00"), actualEndAt: at("07:15") }),
        block("f3-r2", { title: "F3-ルーティン2", category: "ルーティン", plannedStartAt: at("08:00"), plannedEndAt: at("08:15"), completed: true, actualStartAt: at("08:00"), actualEndAt: at("08:15") }),
        block("f3-r3", { title: "F3-ルーティン3", category: "ルーティン", plannedStartAt: at("21:00"), plannedEndAt: at("21:15") })
      ]
    });
    await page.waitForSelector(".routine-week-days", { state: "attached" });
    const weekDaysText = await panelText(".routine-week-days");
    check("「直近7日 4/7」が表示される(gardenLog生データからの期待値と一致)",
      /4\s*\/\s*7/.test(weekDaysText || ""), weekDaysText);
    check("3/7ではない(今日を含む7日窓。-1〜-7窓だと3/7になる。前提B5-7)", !/3\s*\/\s*7/.test(weekDaysText || ""), weekDaysText);
    check("5/7ではない(欠測日-4を実施扱いにしない)", !/5\s*\/\s*7/.test(weekDaysText || ""), weekDaysText);

    // ============================================================
    // [33b] F3 トレンド: データ点数=キー存在日数。欠測日を0%として描かない
    // ============================================================
    console.log("[33b] F3: 30日トレンドの点はキー存在日のみ(6点)。0件日(-2)は点になり、欠測日(-4)・窓外(-40)は点にならない");
    await page.waitForSelector(".routine-trend", { state: "attached" });
    const trendDates = await page.evaluate(() =>
      [...document.querySelectorAll(".routine-trend [data-date]")].map((el) => el.dataset.date));
    check("トレンドのデータ点数=30日窓内のキー存在日数(6点: 今日・-1・-2・-3・-5・-6)(前提B5-8)",
      trendDates.length === 6, JSON.stringify(trendDates));
    check("記録ありの0件日(-2)は点として描かれる(欠測との区別)", trendDates.includes(daysAgoISO(2)), JSON.stringify(trendDates));
    // v186レビューT-1: 点の%値が生データと一致することを1点で突合(-1日 = 2/3 = 67%)
    const trendPct1 = await page.evaluate((d) =>
      document.querySelector(`.routine-trend [data-date="${d}"]`)?.style.getPropertyValue("--routine-rate"), daysAgoISO(1));
    check("トレンド点の%値が生データと一致(-1日: 2/3=67%)", (trendPct1 || "").trim() === "67%", trendPct1);
    check("欠測日(-4)は0%として描かれない(点が無い)", !trendDates.includes(daysAgoISO(4)), JSON.stringify(trendDates));
    check("30日窓の外(-40)は描かれない", !trendDates.includes(daysAgoISO(40)), JSON.stringify(trendDates));

    // ============================================================
    // [33c] F3 K裁定の回帰ガード: 新パネルに「ストリーク」「連続」の語が出ない
    // ============================================================
    console.log("[33c] F3: 新パネル(.routine-week-days / .routine-trend)に「ストリーク」「連続」が出ない(K裁定②の回帰ガード)");
    // 判定は新パネル2要素にスコープする(ルーティンビュー全体には既存の「連続ルーティン(チェーン)」
    // 「連続欠落」表示が正当に存在するため。K裁定の対象はF3の新規指標表現)
    const f3PanelText = `${(await panelText(".routine-week-days")) || ""}\n${(await panelText(".routine-trend")) || ""}`;
    check("F3パネルに「ストリーク」が出ない", !f3PanelText.includes("ストリーク"), f3PanelText);
    check("F3パネルに「連続」が出ない(加点表現のみ)", !f3PanelText.includes("連続"), f3PanelText);
    check("F3パネルに streak 表記も出ない", !/streak/i.test(f3PanelText), f3PanelText);

    // ============================================================
    // [33d] F3: gardenLog空でも崩れない
    // ============================================================
    console.log("[33d] F3: gardenLogが空でもルーティンビューがエラーなく描画される");
    const failuresBeforeF3Empty = failures;  // この区間のpageerror検出用([13]と同じ方式)
    await seedB5({ view: "routine", gardenLog: {}, blocks: [] });
    await waitView("routine");
    check("gardenLog空でも #main が空にならない",
      await page.evaluate(() => document.getElementById("main").innerHTML.trim().length > 0));
    check("gardenLog空のパネルに NaN/undefined が出ない",
      await page.evaluate(() => {
        const t = [".routine-week-days", ".routine-trend"].map((sel) => document.querySelector(sel)?.textContent || "").join("");
        return !/NaN|undefined|Infinity/.test(t);
      }));
    check("[33d]区間の描画で pageerror が発生しない", failures === failuresBeforeF3Empty);

    // ============================================================
    // [34] F5: Wish熟成度ゲージ — 固定写像(30日=50%・90日=100%)との一致
    // ============================================================
    console.log("[34] F5: createdAtからの経過日数で熟成度ゲージ(30日=50%・90日=100%・以降頭打ち)が描かれる");
    const failuresBeforeF5 = failures;  // [34]区間のpageerror検出用
    const WISH_PID = "wish-b5";
    const wishProjectB5 = {
      id: WISH_PID, kind: "wish", title: "Wish", category: "回復", status: "active",
      twelveWeekStartDate: "", createdAt: atOn(daysAgoISO(200), "00:00"), updatedAt: atOn(daysAgoISO(200), "00:00"), deleted: false
    };
    const wishTaskB5 = (id, title, createdAt) => ({
      id, projectId: WISH_PID, parentTaskId: "", title, status: "todo", dueDate: "", description: "",
      targetYear: null, targetMonth: null, lifeArea: "", motivation: "", realized: false, realizedDate: "",
      deleted: false, createdAt, updatedAt: createdAt || atOn(TODAY, "00:00")
    });
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({
      view: "wish",
      projects: [wishProjectB5],
      tasks: [
        wishTaskB5("w-30", "WRIPE-30日前", atOn(daysAgoISO(30), "00:00")),
        wishTaskB5("w-45", "WRIPE-45日前", atOn(daysAgoISO(45), "00:00")),
        wishTaskB5("w-90", "WRIPE-90日前", atOn(daysAgoISO(90), "00:00")),
        wishTaskB5("w-180", "WRIPE-180日前", atOn(daysAgoISO(180), "00:00")),
        wishTaskB5("w-none", "WRIPE-作成日不明", "")
      ]
    });
    await page.waitForSelector(".wish-card", { state: "attached" });
    // カード単位でゲージ幅を読む(タイトル包含でカードを特定 → .wish-ripeness-bar のインラインwidth%。前提B5-9)
    async function ripeInfo(titlePart) {
      return page.evaluate((tp) => {
        const card = [...document.querySelectorAll(".wish-card")].find((c) => c.textContent.includes(tp));
        if (!card) return { found: false };
        const root = card.querySelector(".wish-ripeness");
        const bar = card.querySelector(".wish-ripeness-bar") || (root ? root.querySelector('[style*="width"]') : null);
        const w = bar && bar.style && bar.style.width ? parseFloat(bar.style.width) : null;
        return { found: true, hasGauge: !!(root || bar), width: w, cardText: card.textContent };
      }, titlePart);
    }
    check("熟成度ゲージ(.wish-ripeness)がWishカードに描画される(DOM契約)",
      await page.locator(".wish-ripeness").count() >= 4);
    const ripe30 = await ripeInfo("WRIPE-30日前");
    const ripe45 = await ripeInfo("WRIPE-45日前");
    const ripe90 = await ripeInfo("WRIPE-90日前");
    const ripe180 = await ripeInfo("WRIPE-180日前");
    check("30日前作成 → ゲージ約50%(固定写像アンカー)", ripe30.hasGauge && Math.abs(ripe30.width - 50) <= 1.5, JSON.stringify(ripe30.width));
    check("90日前作成 → ゲージ100%(固定写像アンカー)", ripe90.hasGauge && ripe90.width >= 99 && ripe90.width <= 100.5, JSON.stringify(ripe90.width));
    check("180日前作成 → 100%で頭打ち(100%を超えない)", ripe180.hasGauge && ripe180.width >= 99 && ripe180.width <= 100.5, JSON.stringify(ripe180.width));
    check("45日前作成 → 50%と100%の中間になる", ripe45.hasGauge && ripe45.width > 50 && ripe45.width < 100, JSON.stringify(ripe45.width));
    check("45日前作成の値が線形写像近傍(55〜70%。線形補間なら 50+(45-30)×50/60 = 62.5%)",
      ripe45.width >= 55 && ripe45.width <= 70, JSON.stringify(ripe45.width));
    check("経過日数に対して単調増加(30日 < 45日 < 90日)",
      ripe30.width < ripe45.width && ripe45.width < ripe90.width,
      JSON.stringify({ d30: ripe30.width, d45: ripe45.width, d90: ripe90.width }));

    // ============================================================
    // [34b] F5: createdAt無しTaskで崩れない(normalizeStateは補完しないため表示側フォールバック)
    // ============================================================
    console.log("[34b] F5: createdAtが空のWish Taskでもカードが崩れず、NaN等が表示されない");
    const ripeNone = await ripeInfo("WRIPE-作成日不明");
    check("createdAt無しのWishカードも描画される", ripeNone.found);
    check("createdAt無しでカードに NaN/undefined/Infinity が出ない",
      ripeNone.found && !/NaN|undefined|Infinity/.test(ripeNone.cardText || ""), (ripeNone.cardText || "").slice(0, 120));
    check("createdAt無しのゲージはフォールバック(非表示、または0〜100%の有限値)",
      !ripeNone.hasGauge || ripeNone.width === null || (Number.isFinite(ripeNone.width) && ripeNone.width >= 0 && ripeNone.width <= 100),
      JSON.stringify(ripeNone.width));
    check("[34]〜[34b]区間の描画で pageerror が発生しない", failures === failuresBeforeF5);

    // ============================================================
    // [34c] F5: 表示のみ(state不変)— 再訪・保存契機を跨いで tasks/projects が変化しない
    // ============================================================
    console.log("[34c] F5: wishビューの表示・再訪を跨いでも tasks/projects のJSONが変化しない(表示のみの検証)");
    // 保存契機(setView)を踏んでlocalStorageへ書き戻させてからスナップショットを取り、
    // wish再訪→再び保存契機、の前後で突合する(初回ロード時のnormalize補完分を比較から除くための手順)
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    const wishSnapA = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, projects: s.projects });
    }, KEY);
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="wish"]').click();
    await waitView("wish");
    await page.waitForSelector(".wish-card", { state: "attached" });
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    const wishSnapB = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, projects: s.projects });
    }, KEY);
    check("熟成度ゲージの描画前後で tasks/projects が不変(§12 F5: 表示のみ・state変更なし)",
      wishSnapA === wishSnapB);

    async function w1GoView(view) {
      await page.locator(`#sidebar .nav-button[data-action="nav"][data-view="${view}"]`).click();
      await waitView(view);
    }

    // ============================================================
    // ==== ここから B6(F7 vision ALIGNMENT)追記セクション [50]〜[51c] ====
    // F7用seed: settings.visionDirectCategoriesを直接seedする。
    // visionDirectCats は null=キー自体を削除(migration検証用)/配列=その値でseed。
    async function seedB6({ blocks = [], view = "vision", settings = {}, visionDirectCats = null } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, visionDirectCats, TODAY }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = TODAY;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        s.gardenLog = {};
        s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
        s.pomodoro = { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        if (visionDirectCats === null) delete s.settings.visionDirectCategories;
        else s.settings.visionDirectCategories = visionDirectCats;
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, view, settings, visionDirectCats, TODAY });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    }

    // ============================================================
    // [50] F7 migration: visionDirectCategoriesキー無し→[]補完・既存値は非上書き
    // ============================================================
    console.log("[50] F7 migration: visionDirectCategoriesキー無し→[]補完、既存値(['仕事'])は上書きされない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB6({ view: "vision", visionDirectCats: null });  // null = キー自体を削除してseed(旧state再現)
    await waitView("vision");
    await w1GoView("tasks");  // 保存契機(setView)で書き戻し([21]・前提B6-5)
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.currentView === "tasks" && Array.isArray(s.settings.visionDirectCategories);
    }, KEY);
    const vdcMigrated = (await stateNow()).settings.visionDirectCategories;
    check("キー無しの旧stateに [] が補完される(§12 F7 migration)",
      Array.isArray(vdcMigrated) && vdcMigrated.length === 0, JSON.stringify(vdcMigrated));
    await seedB6({ view: "vision", visionDirectCats: ["仕事"] });  // マスタ外の名前でも値はそのまま保持される想定
    await waitView("vision");
    await w1GoView("tasks");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "tasks", KEY);
    const vdcKept = (await stateNow()).settings.visionDirectCategories;
    check("既存値 ['仕事'] は上書きされない(既存優先)",
      JSON.stringify(vdcKept) === JSON.stringify(["仕事"]), JSON.stringify(vdcKept));

    // ============================================================
    // [51] F7: 未設定([])では .vision-alignment が誘導のみ(比率なし)で、segmentedの上に置かれる
    // ============================================================
    console.log("[51] F7: 未設定では .vision-alignment に誘導文言のみ(%なし)。パネルは3タブsegmentedの上(共通領域)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB6({
      view: "vision", visionDirectCats: [],
      // 実績があっても未設定なら比率を出さない、の判別用に実績Blockを1件同居させる
      blocks: [block("va-any", { title: "VA-実績あり", category: "開発", completed: true, actualStartAt: at("09:00"), actualEndAt: at("10:00"), plannedStartAt: at("09:00"), plannedEndAt: at("10:00"), estimateMin: 60 })]
    });
    await waitView("vision");
    await page.waitForSelector(".vision-alignment", { state: "attached" });
    check(".vision-alignment がvisionビューに描画される(DOM契約)", await page.locator(".vision-alignment").count() === 1);
    const vaUnset = await panelText(".vision-alignment");
    check("未設定では比率(%)を表示しない(実績Blockがあっても誘導のみ。前提B6-8)",
      !/[0-9]\s*%/.test(vaUnset || ""), vaUnset);
    check("未設定では設定への誘導文言(「設定」または「直結」を含む)が出る(§12 F7: vision側は導線のみ)",
      /設定|直結/.test(vaUnset || ""), vaUnset);
    check("パネルは3タブsegmentedの上(共通領域)に置かれる(§12 F7・DOM順で先行する)",
      await page.evaluate(() => {
        const a = document.querySelector(".vision-alignment");
        const s = document.querySelector("#main .segmented");
        return !!a && !!s && !!(a.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
      }));

    // ============================================================
    // [51b] F7: 設定ビューのカテゴリマスタ節でチェック→保存契機→visionビューの当日実績比率が手計算と一致
    // ============================================================
    console.log("[51b] F7: 設定ビューで直結カテゴリ(開発)をチェック→保存→visionビューで当日実績比率 60/90=67% が一致する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    // 手計算: 当日実績 = 開発60分(09:00-10:00) + 回復30分(10:30-11:00)。直結=開発 → 60/90 = 66.7%。
    //   計画のみ45分(実績なし)は分子にも分母にも入らない(混入すると (60+45)/135=78% 等になり
    //   下の範囲判定 66〜67.5% で落ちる判別フィクスチャ。前提B6-7)
    const b6VisionBlocks = [
      block("va-dev", { title: "VA-開発60分", category: "開発", completed: true, actualStartAt: at("09:00"), actualEndAt: at("10:00"), plannedStartAt: at("09:00"), plannedEndAt: at("10:00"), estimateMin: 60 }),
      block("va-rec", { title: "VA-回復30分", category: "回復", completed: true, actualStartAt: at("10:30"), actualEndAt: at("11:00"), plannedStartAt: at("10:30"), plannedEndAt: at("11:00"), estimateMin: 30 }),
      block("va-plan", { title: "VA-計画のみ45分", category: "開発", plannedStartAt: at("13:00"), plannedEndAt: at("13:45"), estimateMin: 45 })
    ];
    await seedB6({ view: "settings", visionDirectCats: [], blocks: b6VisionBlocks });
    await waitView("settings");
    await page.waitForSelector(".vision-direct-option", { state: "attached" });
    const vdcCatNames = await page.evaluate(() =>
      [...document.querySelectorAll('.vision-direct-option [data-category]')].map((el) => el.dataset.category));
    check("カテゴリマスタ節に .vision-direct-option のチェック列が出る(既定マスタ6件ぶん・data-category=カテゴリ名)",
      vdcCatNames.length === 6 && vdcCatNames.includes("開発") && vdcCatNames.includes("回復"), JSON.stringify(vdcCatNames));
    // 「開発」をチェック(要素自身がcheckboxでも内包でも成立する読み方。設定foldが閉じていても
    // 動くようevaluateでclickする。checkboxのclickはchange発火を伴う。前提B6-6)
    await page.evaluate(() => {
      const el = document.querySelector('.vision-direct-option [data-category="開発"]');
      const input = el?.matches?.('input[type="checkbox"]') ? el : (el?.querySelector?.('input[type="checkbox"]') || el);
      input.click();
    });
    await w1GoView("tasks");  // 保存契機(setView)。チェック時点で即保存する実装でもこの後の突合は同じ
    await page.waitForFunction((KEY) =>
      (JSON.parse(localStorage.getItem(KEY)).settings.visionDirectCategories || []).includes("開発"), KEY);
    check("チェックで settings.visionDirectCategories に '開発' が入り永続化される(前提B6-6)", true);
    await w1GoView("vision");
    await page.waitForSelector(".vision-alignment", { state: "attached" });
    const vaSet = await panelText(".vision-alignment");
    const vaPctM = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(vaSet || "");
    const vaPct = vaPctM ? parseFloat(vaPctM[1]) : null;
    check("当日実績比率が手計算と一致(60/90 = 66.7% → 66〜67.5%の表示を一致とみなす。前提B6-8)",
      vaPct !== null && vaPct >= 66 && vaPct <= 67.5, JSON.stringify({ pct: vaPct, text: vaSet }));

    // ============================================================
    // [51c] F7: 実績ゼロ日(計画のみ)でも崩れない(NaN非表示・pageerrorゼロ)
    // ============================================================
    console.log("[51c] F7: 実績ゼロ日(計画のみ)でも .vision-alignment が崩れない(0除算ガード・NaN非表示)");
    const failuresBefore51c = failures;  // この区間のpageerror検出用([13]と同じ方式)
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB6({
      view: "vision", visionDirectCats: ["開発"],
      blocks: [block("va-plan-only", { title: "VA-計画のみ", category: "開発", plannedStartAt: at("13:00"), plannedEndAt: at("14:00"), estimateMin: 60 })]
    });
    await waitView("vision");
    await page.waitForSelector(".vision-alignment", { state: "attached" });
    const vaZero = await panelText(".vision-alignment");
    check("実績ゼロ日に NaN/undefined/Infinity が出ない(分母0のガード)", !/NaN|undefined|Infinity/.test(vaZero || ""), vaZero);
    check("[51c]区間の描画で pageerror が発生しない", failures === failuresBefore51c);

    // ============================================================
    // [53] v189レビュー反映: カテゴリ改名/削除のvisionDirectCategoriesカスケード(M1/M2)
    // ============================================================
    console.log("[53] v189: カテゴリ改名/削除がvisionDirectCategoriesへカスケードする");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB6({
      view: "settings",
      visionDirectCats: ["開発", "回復"]
    });
    // カテゴリ改名カスケード(M1): 「開発」→「開発X」
    await page.evaluate(() => {
      const cat = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).settings.categories.find((c) => c.name === "開発");
      window.__catId53 = cat && cat.id;
    });
    const catId53 = await page.evaluate(() => window.__catId53);
    check("(準備)カテゴリマスタに「開発」が存在する", !!catId53);
    await page.evaluate((id) => {
      const el = document.querySelector(`input[data-cat-field="name"][data-cat-id="${id}"]`);
      if (!el) { window.__renameFailed = true; return; }
      el.value = "開発X";
      el.dispatchEvent(new Event("input", { bubbles: true }));  // カテゴリ編集はinputイベント委譲(app.js:1336)
    }, catId53);
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return (s.settings.visionDirectCategories || []).includes("開発X");
    }, KEY);
    const vdc53 = (await stateNow()).settings.visionDirectCategories;
    check("カテゴリ改名がvisionDirectCategoriesへカスケードする(開発→開発X。レビューM1)",
      vdc53.includes("開発X") && !vdc53.includes("開発"), JSON.stringify(vdc53));
    // カテゴリ削除カスケード(M2): 「回復」を削除→直結からも除去
    page.once("dialog", (d) => d.accept());
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const cat = s.settings.categories.find((c) => c.name === "回復");
      const btn = document.querySelector(`[data-action="delete-category"][data-cat-id="${cat.id}"]`);
      if (btn) btn.click();
    }, KEY);
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return !(s.settings.visionDirectCategories || []).includes("回復");
    }, KEY);
    check("カテゴリ削除でvisionDirectCategoriesからも除去される(レビューM2)",
      !((await stateNow()).settings.visionDirectCategories || []).includes("回復"));

    // ============================================================
    // ==== ここから B7(F8 AIパネルビューア v188)追記セクション [54]〜[59] ====
    // 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md §12 の F8 行+「F8ファイル契約」節。
    //   完了条件の正: (a)fetchが空文字 (b)不正JSON (c)フィールド型不一致 の3フィクスチャで例外なし /
    //   generatedAt 26時間超で「古い」/ ファイル無しで一切エラーなし。
    // ファイル契約(バッチ側=loop/の別発注。アプリはこの形だけを読む):
    //   { generatedAt: "YYYY-MM-DDTHH:MM:SS"(T区切り秒あり),
    //     routineSuggestions: [{ routineTitle, suggestion, reason }],
    //     wishRipe: [{ taskId, title, reason }],   ← 参照は projectId でなく taskId(実体はTask。F5と同じ)
    //     zeroPattern: { body } }
    // DOM契約(実装側と共有済み):
    //   パネルroot .ai-insights[data-insight="routine|wish|zero"] /
    //   鮮度 .ai-insights-freshness(26時間超で .is-stale +「古い」を含む文言)
    // 実装(別担当が並行作業中)より先に仕様から書いた。前提が実装と食い違った場合は
    // テストを弱めるのではなく、前提の側を実装と突合して直すこと:
    //   前提B7-1: ai-insights.json は kindle highlights と同じ Contents API 経路
    //            (パス末尾 /contents/taskchute/ai-insights.json)で取得され、hydrateStaticMarkdown
    //            相乗せの energy-curve型TTL30分方式により起動(reload)ごとに毎回fetchされる
    //            (キャッシュはメモリのみ。同一セッション内のビュー往復では再fetchしない)。
    //            同名の別スキーマとはパスで区別する(§12 F8「同名紛らわしいが別物」。
    //            routeのendsWith判定が別パスに一致しないことを維持する)
    //   前提B7-2: パネルは routine / wish / zero 各ビューのrender内で描画され、fetch完了時は
    //            hydrateStaticMarkdown 末尾の再描画で開いたままのビューへも反映される(§12 F8
    //            「再描画view一覧に routine/wish を追加」)。検証は fetch応答後のDOM出現
    //            (waitForSelector)/不在(応答待ち+マクロタスク2周。[45b]と同手法)で行う
    //   前提B7-3: 鮮度は localDateTimeToMs(generatedAt) 基準で、26時間超のとき .ai-insights-freshness に
    //            .is-stale が付き「古い」を含む文言になる。鮮度内では .is-stale は付かない。
    //            鮮度要素の置き場所(パネル毎/共通1箇所)と個数は契約にしない(全該当要素の走査で読む)
    //   前提B7-4: スキーマ不一致フィールドは個別に無視される(§12 F8ファイル契約「1フィールド壊れて
    //            全滅させない」)。壊れたフィールドのパネルだけが出ず、正常フィールドのパネルは通常表示
    //   前提B7-5: F8は表示のみ(提案の適用は手動・アプリ内AI呼び出しなし)。正常表示しても
    //            state.tasks/blocks/settings は変化しない。突合は保存契機(setView)を踏んで
    //            localStorageへ書き戻させてから行う([34c]と同じ手順。初回normalize補完分を比較から除く)
    //   前提B7-6: 各パネルにフィクスチャ本文(routineSuggestions=suggestion/routineTitle・
    //            wishRipe=title/reason・zeroPattern=body)が表示される。レイアウト・
    //            件数・整形は契約にしない(マーカー文字列 AI-ROUTINE/AI-WISH/AI-ZERO の包含で読む)
    //   前提B7-7: 404・壊れJSON・空文字(fetchGitHubRawTextの失敗時空文字と同型)では .ai-insights が
    //            1枚も出ず、pageerrorゼロ・各ビューの既存要素は無傷(フェイルソフト。[45b]/[48]と同思想)
    // ============================================================

    // B7正常フィクスチャ(F8ファイル契約どおり。wishRipe.taskId はseedB7が必ず入れる既存wishタスクを指す)
    const B7_WISH_TASK_ID = "w-b7-ripe";
    const B7_AI_OK = {
      generatedAt: `${TODAY}T07:00:00`,  // 当日朝生成=鮮度内(T区切り秒あり。FORMAT_CONTRACT整合)
      routineSuggestions: [{ routineTitle: "AIRT-TITLE-朝の散歩", suggestion: "AIRT-SUG-7時台へ前倒し", reason: "AIRT-REASON-起床後実績が7時台に集中" }],
      wishRipe: [{ taskId: B7_WISH_TASK_ID, title: "AIWS-TITLE-熟成やりたい", reason: "AIWS-REASON-作成から90日経過" }],
      zeroPattern: { body: "AI-ZERO-仕事テーマへの偏りが続いている" }
    };
    // 可変フィクスチャ+後発route(scheduleInboxFx/w3InboxFxと同方式。後発登録なのでこちらが優先され、
    // ai-insights.json 以外は route.fallback() で W3→W1→既定404ブロッカーへ委ねる)
    const aiInsightsFx = { status: 200, body: null };  // body=null なら B7_AI_OK を返す
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/contents/taskchute/ai-insights.json")) {
        if (aiInsightsFx.status !== 200) return route.fulfill({ status: aiInsightsFx.status, body: "not found" });
        if (aiInsightsFx.body != null) return route.fulfill({ status: 200, contentType: "application/json", body: aiInsightsFx.body });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(B7_AI_OK) });
      }
      return route.fallback();
    });
    const aiPanelSel = (kind) => `.ai-insights[data-insight="${kind}"]`;
    const b7WaitAiResponse = () =>
      page.waitForResponse((r) => r.url().includes("/contents/taskchute/ai-insights.json"));
    // 不在断定の前にfetch応答後の描画反映猶予としてマクロタスクを2周回す([45b]/[30c]と同手法)
    const b7FlushMacrotasks = async () => {
      await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
      await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    };

    // B7用seed: seedB6と同じ流儀に「wishタスク1件(B7_WISH_TASK_ID)+wishプロジェクト」を必ず同居させる
    // 拡張(既存関数は変更禁止のため別名で追加)。wishビューの既存要素(.wish-card)の無傷検証と、
    // wishRipe.taskId=既存wishタスク の契約フィクスチャを兼ねる。
    const b7WishTask = wishTaskB5(B7_WISH_TASK_ID, "B7-熟成やりたい", atOn(daysAgoISO(90), "00:00"));
    async function seedB7({ blocks = [], view = "routine", settings = {} } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, TODAY, wishProject, wishTask }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = TODAY;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        s.gardenLog = {};
        s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
        s.pomodoro = { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        s.projects = (s.projects || []).filter((p) => p.id !== wishProject.id).concat([wishProject]);
        s.tasks = (s.tasks || []).filter((t) => t.id !== wishTask.id).concat([wishTask]);
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, {
        KEY, blocks, view, settings, TODAY,
        wishProject: wishProjectB5, wishTask: b7WishTask
      });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    }
    // 各ビューの既存要素の無傷判定(404/壊れJSON区間で使う。[45b]の「タブ本体は無傷」と同思想)
    async function b7CheckViewIntact(view, label) {
      if (view === "routine") {
        check(`${label}: routineビューの既存要素(.segmented表示切替)が無傷`,
          await page.locator("#main .segmented").count() >= 1);
      } else if (view === "wish") {
        check(`${label}: wishビューの既存要素(.wish-card)が無傷`,
          await page.locator(".wish-card").count() >= 1);
      } else if (view === "zero") {
        check(`${label}: zeroビューの既存要素(.zt-toptab-row)が無傷`,
          await page.locator(".zt-toptab-row").count() === 1);
      }
    }

    // ============================================================
    // [54] F8: 正常フィクスチャ → routine/wish/zero 各ビューに .ai-insights が出て本文が表示される
    // ============================================================
    console.log("[54] F8: 正常フィクスチャで3ビューすべてに .ai-insights パネルが出て、各フィクスチャ本文が表示される");
    const failuresBefore54 = failures;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "routine" });
    // fetch完了→hydrateStaticMarkdown末尾の再描画で、開いたままのroutineビューにパネルが出る(前提B7-2)
    await page.waitForSelector(aiPanelSel("routine"), { state: "attached" });
    check("routineビューに .ai-insights[data-insight='routine'] が1つ描画される(DOM契約)",
      await page.locator(aiPanelSel("routine")).count() === 1);
    const rtText54 = (await panelText(aiPanelSel("routine"))) || "";
    check("routineパネルに suggestion と reason がそれぞれ表示される(フィールド別マーカーで弁別。レビューM2)",
      rtText54.includes("AIRT-SUG") && rtText54.includes("AIRT-REASON"), rtText54);
    await w1GoView("wish");
    await page.waitForSelector(aiPanelSel("wish"), { state: "attached" });
    check("wishビューに .ai-insights[data-insight='wish'] が1つ描画される",
      await page.locator(aiPanelSel("wish")).count() === 1);
    check("wishパネルに wishRipe の reason が表示される(titleは既存Wishカードが担うため非表示=実装仕様。レビューM2)",
      ((await panelText(aiPanelSel("wish"))) || "").includes("AIWS-REASON"),
      await panelText(aiPanelSel("wish")));
    await w1GoView("zero");
    await page.waitForSelector(aiPanelSel("zero"), { state: "attached" });
    check("zeroビューに .ai-insights[data-insight='zero'] が1つ描画される",
      await page.locator(aiPanelSel("zero")).count() === 1);
    check("zeroパネルに zeroPattern.body が表示される",
      ((await panelText(aiPanelSel("zero"))) || "").includes("AI-ZERO"),
      await panelText(aiPanelSel("zero")));
    check("鮮度内(当日朝07:00生成・5時間前)では .is-stale が付かない(前提B7-3の対照)",
      await page.locator(".ai-insights-freshness.is-stale").count() === 0);
    check("[54]区間の描画で pageerror が発生しない", failures === failuresBefore54);

    // ============================================================
    // [55] F8: ファイル無し(404)→ 全ビューで .ai-insights が存在しない・pageerrorゼロ・既存要素は無傷
    // ============================================================
    console.log("[55] F8: ai-insights.json 404 では3ビューとも .ai-insights が出ず、既存要素は無傷(一切エラーなし)");
    const failuresBefore55 = failures;
    aiInsightsFx.status = 404;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    const b7Resp404 = b7WaitAiResponse();
    await seedB7({ view: "routine" });
    await b7Resp404;
    await waitView("routine");
    await b7FlushMacrotasks();
    check("404: routineビューに .ai-insights が1枚も出ない(ファイル無しで一切エラーなし)",
      await page.locator(".ai-insights").count() === 0);
    await b7CheckViewIntact("routine", "404");
    // 同一セッション内の残り2ビュー(TTL30分キャッシュにより再fetchなし=失敗結果のまま。前提B7-1)
    for (const v of ["wish", "zero"]) {
      await w1GoView(v);
      check(`404: ${v}ビューに .ai-insights が1枚も出ない`,
        await page.locator(".ai-insights").count() === 0);
      await b7CheckViewIntact(v, "404");
    }
    check("[55]区間の描画で pageerror が発生しない(完了条件「ファイル無しで一切エラーなし」)",
      failures === failuresBefore55);
    aiInsightsFx.status = 200;

    // ============================================================
    // [56] F8: 壊れJSON("{broken")と空文字 → 例外なし・パネルなし・既存要素無傷(完了条件(a)(b))
    // ============================================================
    console.log("[56] F8: 壊れJSON・空文字レスポンスでもpageerrorゼロで、パネルは出ず既存要素は無傷");
    const failuresBefore56 = failures;
    aiInsightsFx.body = "{broken";
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    const b7RespBroken = b7WaitAiResponse();
    await seedB7({ view: "routine" });
    await b7RespBroken;
    await waitView("routine");
    await b7FlushMacrotasks();
    check("壊れJSON('{broken')では .ai-insights が出ない(例外を投げず無傷スキップ。完了条件(b))",
      await page.locator(".ai-insights").count() === 0);
    await b7CheckViewIntact("routine", "壊れJSON");
    await w1GoView("zero");
    check("壊れJSON: zeroビューにも .ai-insights が出ない",
      await page.locator(".ai-insights").count() === 0);
    await b7CheckViewIntact("zero", "壊れJSON");
    // 空文字(200 + 空body。fetchGitHubRawText失敗時の空文字戻りと同型。完了条件(a))
    aiInsightsFx.body = "";
    const b7RespEmpty = b7WaitAiResponse();
    await seedB7({ view: "wish" });
    await b7RespEmpty;
    await waitView("wish");
    await b7FlushMacrotasks();
    check("空文字レスポンスでは .ai-insights が出ない(パネル生成関数が例外を投げない。完了条件(a))",
      await page.locator(".ai-insights").count() === 0);
    await b7CheckViewIntact("wish", "空文字");
    check("[56]区間の描画で pageerror が発生しない", failures === failuresBefore56);
    aiInsightsFx.body = null;

    // ============================================================
    // [57] F8: フィールド型不一致 → 壊れたフィールドのパネルだけ非表示・正常フィールドは表示(個別無視)
    // ============================================================
    console.log("[57] F8: routineSuggestions=文字列・wishRipe=数値の型不一致では routine/wish パネルだけが出ず、zero は通常表示");
    const failuresBefore57 = failures;
    aiInsightsFx.body = JSON.stringify({
      ...B7_AI_OK,
      routineSuggestions: "壊れ文字列",  // 配列であるべき所に文字列(完了条件(c))
      wishRipe: 12345                    // 配列であるべき所に数値
    });
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "zero" });
    // 正常フィールド側のパネル出現をfetch完了の合図にする(その後の不在断定は描画反映後で安全)
    await page.waitForSelector(aiPanelSel("zero"), { state: "attached" });
    check("正常フィールド(zeroPattern)のパネルも通常表示される",
      ((await panelText(aiPanelSel("zero"))) || "").includes("AI-ZERO"),
      await panelText(aiPanelSel("zero")));
    await w1GoView("routine");
    await b7FlushMacrotasks();
    check("壊れたフィールド(routineSuggestions=文字列)のパネルだけが出ない(1フィールド壊れて全滅させない)",
      await page.locator(aiPanelSel("routine")).count() === 0);
    await b7CheckViewIntact("routine", "型不一致");
    await w1GoView("wish");
    await b7FlushMacrotasks();
    check("壊れたフィールド(wishRipe=数値)のパネルも出ない",
      await page.locator(aiPanelSel("wish")).count() === 0);
    await b7CheckViewIntact("wish", "型不一致");
    check("[57]区間の描画で pageerror が発生しない(完了条件(c): 型不一致フィクスチャで例外なし)",
      failures === failuresBefore57);
    aiInsightsFx.body = null;

    // ============================================================
    // [58] F8: 鮮度27時間超 → パネルは出るが .ai-insights-freshness.is-stale に「古い」を含む文言
    // ============================================================
    console.log("[58] F8: generatedAt=前日09:00(27時間前)ではパネル表示のまま .is-stale +「古い」の鮮度表示になる");
    // 固定時刻12:00基準で27時間前 = 前日09:00(ISO文字列リテラルで組み立て。new Date('文字列')は使わない)
    aiInsightsFx.body = JSON.stringify({ ...B7_AI_OK, generatedAt: `${YESTERDAY}T09:00:00` });
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "routine" });
    await page.waitForSelector(aiPanelSel("routine"), { state: "attached" });
    check("鮮度超過でもパネル自体は表示される(データは見える。[45c]の鮮度方針と同じ)",
      await page.locator(aiPanelSel("routine")).count() === 1
      && ((await panelText(aiPanelSel("routine"))) || "").includes("AIRT-SUG"));
    await page.waitForSelector(".ai-insights-freshness.is-stale", { state: "attached" });
    const b7StaleTexts = await page.evaluate(() =>
      [...document.querySelectorAll(".ai-insights-freshness.is-stale")].map((el) => el.textContent || ""));
    check("鮮度26時間超で .ai-insights-freshness.is-stale に「古い」を含む文言が出る(DOM契約・前提B7-3)",
      b7StaleTexts.some((t) => t.includes("古い")), JSON.stringify(b7StaleTexts));
    aiInsightsFx.body = null;

    // ============================================================
    // [59] F8: 提案の自動適用が無い(表示のみ)— 正常表示後に state.tasks/blocks/settings のJSONが不変
    // ============================================================
    console.log("[59] F8: 正常フィクスチャを3ビューで表示しても tasks/blocks/settings のJSONが変化しない(表示のみ)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "routine" });
    await page.waitForSelector(aiPanelSel("routine"), { state: "attached" });
    // 保存契機(setView)を踏んで初回normalize補完分をlocalStorageへ書き戻させてから基準を取る([34c]と同手順)
    await w1GoView("tasks");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "tasks", KEY);
    const b7SnapA = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, blocks: s.blocks, settings: s.settings });
    }, KEY);
    // 3ビューを巡回してパネルを表示させる(wishRipe提案のtask変更・routine提案のblock変更等が
    // 勝手に走っていればこの間にstateが変わり、下の突合で落ちる)
    for (const v of ["routine", "wish", "zero"]) {
      await w1GoView(v);
      await page.waitForSelector(aiPanelSel(v), { state: "attached" });
    }
    await w1GoView("tasks");  // 再び保存契機を踏んで書き戻し後に突合
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "tasks", KEY);
    const b7SnapB = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, blocks: s.blocks, settings: s.settings });
    }, KEY);
    check("パネル表示の前後で tasks/blocks/settings のJSONが不変(提案の適用は手動のみ。前提B7-5)",
      b7SnapA === b7SnapB);

    // ============================================================
    // ==== C2: ルーティン分離(v191) [60]〜[65] ====
    // 委譲仕様1〜7: NOW FOCUS/ポモドーロ/NEXT QUEUE/FLIGHT PLANからルーティン系タスクを除外し、
    // ROUTINEパネルに「未実施ルーティンのチップ列(タップで完了&消える)」を追加する。
    // ============================================================

    // ============================================================
    // [60] C2仕様1: NOW FOCUS はルーティンBlockが実行中でも対象にしない
    // ============================================================
    console.log("[60] C2仕様1: NOW FOCUSは実行中ルーティンBlockを対象にせず、フォールバック(次の1手)へ回る");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      blocks: [
        block("c2-routine-run", { title: "C2-ROUTINE-RUN-実行中ルーティン", category: "ルーティン", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("11:15") }),
        block("c2-next", { title: "C2-NEXT-未着手", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") })
      ]
    });
    await page.waitForSelector(".today-now-focus", { state: "attached" });
    const nfRoutineText = await panelText(".today-now-focus");
    check("実行中ルーティンBlockのタイトルはNOW FOCUSに出ない",
      !(nfRoutineText || "").includes("C2-ROUTINE-RUN-実行中ルーティン"), nfRoutineText);
    check("実行中ルーティンしかない場合、NOW FOCUSは非実行(READY)表示になり次の未着手Blockを提示する",
      (nfRoutineText || "").includes("C2-NEXT-未着手"), nfRoutineText);

    // ============================================================
    // [61] C2仕様2: NEXT QUEUE はルーティンBlockを出さない
    // ============================================================
    console.log("[61] C2仕様2: NEXT QUEUEは未着手ルーティンBlockを対象にしない");
    await seed({
      view: "today",
      blocks: [
        block("c2-q-routine", { title: "C2-Q-ROUTINE-未着手ルーティン", category: "ルーティン", plannedStartAt: at("09:00"), plannedEndAt: at("09:15") }),
        block("c2-q-normal", { title: "C2-Q-NORMAL-未着手通常", plannedStartAt: at("10:00"), plannedEndAt: at("10:30") })
      ]
    });
    await page.waitForSelector(".today-next-queue", { state: "attached" });
    const c2QueueText = await panelText(".today-next-queue");
    check("未着手ルーティンBlockはNEXT QUEUEに出ない",
      !(c2QueueText || "").includes("C2-Q-ROUTINE-未着手ルーティン"), c2QueueText);
    check("通常の未着手Blockは引き続きNEXT QUEUEに出る(対照)",
      (c2QueueText || "").includes("C2-Q-NORMAL-未着手通常"), c2QueueText);

    // ============================================================
    // [62] C2仕様3: FLIGHT PLAN はルーティンBlockの帯を描画しない
    // ============================================================
    console.log("[62] C2仕様3: FLIGHT PLANはルーティンBlockの帯を出さない(TimeTree外部予定帯は対象外・現状維持)");
    await seed({
      view: "today",
      blocks: [
        block("c2-flight-routine", { title: "C2-FLIGHT-ROUTINE", category: "ルーティン", plannedStartAt: at("08:00"), plannedEndAt: at("08:15") }),
        block("c2-flight-normal", { title: "C2-FLIGHT-NORMAL", plannedStartAt: at("09:00"), plannedEndAt: at("09:30") })
      ]
    });
    await page.waitForSelector(".today-flight-plan", { state: "attached" });
    check("ルーティンBlockのFLIGHT PLAN帯(.today-flight-block)が描画されない",
      await page.locator('.today-flight-block[data-id="c2-flight-routine"]').count() === 0);
    check("通常BlockのFLIGHT PLAN帯は引き続き描画される(対照)",
      await page.locator('.today-flight-block[data-id="c2-flight-normal"]').count() === 1);

    // ============================================================
    // [63] C2仕様4: ポモドーロパネルは実行中ポモがルーティンBlockに紐づく場合タスク名を出さない
    // ============================================================
    console.log("[63] C2仕様4: 実行中ポモがルーティンBlockに紐づく場合、タスク名を出さずタイマー自体は継続表示する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("c2-pomo-routine", { title: "C2-POMO-ROUTINE-秘密のルーティン名", category: "ルーティン", actualStartAt: at("11:50"), plannedStartAt: at("11:50"), plannedEndAt: at("12:20") })
      ],
      pomodoro: { running: true, blockId: "c2-pomo-routine", startedAt: at("11:50"), endsAt: at("12:15"), mode: "focus" }
    });
    await page.waitForSelector(".today-pomodoro", { state: "attached" });
    const pomoRoutineText = await panelText(".today-pomodoro");
    check("ルーティンBlockに紐づく実行中ポモは、タスク名(C2-POMO-ROUTINE-秘密のルーティン名)を表示しない",
      !(pomoRoutineText || "").includes("C2-POMO-ROUTINE-秘密のルーティン名"), pomoRoutineText);
    check("タイマー自体は継続表示される(停止導線 stop-pomodoro が引き続き出る)",
      await page.locator('.today-pomodoro [data-action="stop-pomodoro"]').count() >= 1);

    // ============================================================
    // [64] C2仕様5: ROUTINEパネルに未実施ルーティンのチップ列(タップで完了→消える、確認なし)
    // ============================================================
    console.log("[64] C2仕様5: ROUTINEパネルに未実施ルーティンのチップが出て、タップで即完了して消える(確認なし)");
    await seed({
      view: "today",
      blocks: [
        block("c2-chip-1", { title: "C2-CHIP-未実施1", category: "ルーティン", plannedStartAt: at("07:00"), plannedEndAt: at("07:15") }),
        block("c2-chip-2", { title: "C2-CHIP-未実施2", category: "ルーティン", plannedStartAt: at("10:00"), plannedEndAt: at("10:15") }),
        block("c2-chip-done", { title: "C2-CHIP-完了済み", category: "ルーティン", completed: true, plannedStartAt: at("08:00"), plannedEndAt: at("08:15"), actualStartAt: at("08:00"), actualEndAt: at("08:15") })
      ]
    });
    await page.waitForSelector(".today-routine-undone", { state: "attached" });
    const undoneLabelText = await panelText(".today-routine-undone-label");
    check("見出し「未実施 — タップで完了」が表示される",
      (undoneLabelText || "").includes("未実施") && (undoneLabelText || "").includes("タップで完了"), undoneLabelText);
    check("未完了ルーティンのみチップとして2件出る(完了済みは出ない)",
      await page.locator(".today-routine-undone-chips .today-routine-chip").count() === 2);
    const chipsText = await panelText(".today-routine-undone-chips");
    check("未実施チップに完了済みルーティンのタイトルは含まれない", !(chipsText || "").includes("C2-CHIP-完了済み"), chipsText);
    // レビュー修正7(2周目)で data-action を toggle-block → now-conveyor-complete(app.js既存)へ
    // 変更した(ポモ実行中ルーティンをチップ完了させたときstate.pomodoroが残る穴の修正)。
    // now-conveyor-complete は pomodoro.blockId 不一致なら従来どおり toggleBlock(id) に委譲するため、
    // このケース(ポモ未連動)の完了結果自体は変わらない。
    check("チップは既存アクション data-action='now-conveyor-complete' を再利用する(新規ビジネスロジックを作らない)",
      await page.locator('.today-routine-undone-chips [data-action="now-conveyor-complete"][data-id="c2-chip-1"]').count() === 1);
    await page.locator('.today-routine-undone-chips [data-action="now-conveyor-complete"][data-id="c2-chip-1"]').click();
    check("タップ直後に確認ダイアログ(.modal-card)は出ない(確認なし即完了)",
      await page.locator(".modal-card").count() === 0);
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const b = s.blocks.find((x) => x.id === "c2-chip-1");
      return b && b.completed === true;
    }, KEY);
    await page.waitForFunction(() =>
      !document.querySelector('.today-routine-undone-chips [data-id="c2-chip-1"]'));
    check("完了後は再描画でチップ自体が消える(タップで完了&消える)",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-1"]').count() === 0);
    check("残り1件の未実施チップはまだ表示される",
      await page.locator(".today-routine-undone-chips .today-routine-chip").count() === 1);

    console.log("[64b] C2仕様5: 未実施ルーティンが0件ならチップ列自体を出さない");
    await seed({
      view: "today",
      blocks: [
        block("c2-allcomplete", { title: "C2-ALL-完了", category: "ルーティン", completed: true, plannedStartAt: at("07:00"), plannedEndAt: at("07:15"), actualStartAt: at("07:00"), actualEndAt: at("07:15") })
      ]
    });
    await page.waitForSelector(".today-routine", { state: "attached" });
    check("未実施が0件のとき .today-routine-undone 自体が描画されない(チップ列を出さない)",
      await page.locator(".today-routine-undone").count() === 0);

    // ============================================================
    // [64c] レビュー修正2: 未実施チップは旧版oneTapルーティンBlockを対象にしない
    // ============================================================
    console.log("[64c] レビュー修正2: 旧版oneTapルーティンBlockはチップに出ない(誤完了防止)");
    await seed({
      view: "today",
      blocks: [
        block("c2-chip-onetap", { title: "C2-CHIP-ONETAP-旧版記録", category: "ルーティン", oneTap: true, plannedStartAt: at("06:00"), plannedEndAt: at("06:15") }),
        block("c2-chip-normal2", { title: "C2-CHIP-通常未実施", category: "ルーティン", plannedStartAt: at("07:30"), plannedEndAt: at("07:45") })
      ]
    });
    await page.waitForSelector(".today-routine-undone", { state: "attached" });
    check("oneTapルーティンBlockは未実施チップとして出ない",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-onetap"]').count() === 0);
    check("非oneTapの未実施ルーティンは引き続きチップに出る(対照)",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-normal2"]').count() === 1);
    check("未実施チップは1件だけ(oneTap分は混入しない)",
      await page.locator(".today-routine-undone-chips .today-routine-chip").count() === 1);

    // ============================================================
    // [64d] レビュー修正3: 実行中ルーティンはチップに残り、is-running(視覚区別)が付く
    // ============================================================
    console.log("[64d] レビュー修正3: 実行中ルーティンはチップ列に残り、is-runningクラス+「▶ 」接頭辞で視覚区別される");
    await seed({
      view: "today",
      blocks: [
        block("c2-chip-running", { title: "C2-CHIP-実行中ルーティン", category: "ルーティン", actualStartAt: at("11:40"), plannedStartAt: at("11:40"), plannedEndAt: at("11:55") }),
        block("c2-chip-idle", { title: "C2-CHIP-未着手ルーティン", category: "ルーティン", plannedStartAt: at("08:00"), plannedEndAt: at("08:15") })
      ]
    });
    await page.waitForSelector(".today-routine-undone", { state: "attached" });
    check("実行中ルーティンも未実施チップ列に残る(K仕様: タップで正しい終了時刻のまま完了できる)",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-running"]').count() === 1);
    check("実行中ルーティンのチップに is-running クラスが付く",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-running"].is-running').count() === 1);
    const runningChipText = await page.locator('.today-routine-undone-chips [data-id="c2-chip-running"]').textContent();
    check("実行中ルーティンのチップタイトルに「▶ 」接頭辞が付く",
      (runningChipText || "").trim().startsWith("▶"), runningChipText);
    check("未着手ルーティンのチップには is-running が付かない(対照)",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-idle"].is-running').count() === 0);
    const idleChipText = await page.locator('.today-routine-undone-chips [data-id="c2-chip-idle"]').textContent();
    check("未着手ルーティンのチップタイトルには「▶ 」が付かない(対照)",
      !(idleChipText || "").trim().startsWith("▶"), idleChipText);
    // レビュー修正7(2周目): このケースはポモがc2-chip-runningに連動していないため、
    // now-conveyor-completeはtoggleBlock(id)に委譲され、確認なしで正しい終了時刻のまま完了する。
    check("実行中ルーティンチップをタップすると now-conveyor-complete で正しい終了時刻のまま完了する(確認なし)",
      await page.locator('.today-routine-undone-chips [data-id="c2-chip-running"][data-action="now-conveyor-complete"]').count() === 1);
    await page.locator('.today-routine-undone-chips [data-id="c2-chip-running"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const b = s.blocks.find((x) => x.id === "c2-chip-running");
      return !!b && b.completed === true && !!b.actualEndAt;
    }, KEY);
    check("タップ後に確認ダイアログは出ない(確認なし即完了)", await page.locator(".modal-card").count() === 0);

    // ============================================================
    // [66] レビュー修正1(P1・重): 実行中ルーティンを放置したまま次タスク(ポモ)を開始すると自動クローズされる
    // ============================================================
    console.log("[66] レビュー修正1: 実行中ルーティンBlockがあるままポモ開始→ルーティンにactualEndAtが付き、実行中が1本になる");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("fix1-routine-run", { title: "FIX1-ROUTINE-放置ルーティン", category: "ルーティン", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("11:15") }),
        block("fix1-next", { title: "FIX1-NEXT-次タスク", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") })
      ]
    });
    await page.waitForSelector('.today-pomodoro [data-action="start-pomodoro"][data-block-id="fix1-next"]', { state: "attached" });
    await page.locator('.today-pomodoro [data-action="start-pomodoro"][data-block-id="fix1-next"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.pomodoro.running === true && s.pomodoro.blockId === "fix1-next";
    }, KEY);
    const st66 = await stateNow();
    const routine66 = st66.blocks.find((b) => b.id === "fix1-routine-run");
    check("ポモ開始経路: 放置されていたルーティンBlockにactualEndAtが付く(自動クローズ)",
      !!routine66.actualEndAt, JSON.stringify(routine66));
    check("ポモ開始経路: 放置ルーティンはcompletedにはならない(completedは立てない・裁定どおり)",
      routine66.completed === false, JSON.stringify(routine66));
    const running66 = st66.blocks.filter((b) => b.actualStartAt && !b.actualEndAt);
    check("ポモ開始経路: 実行中Blockが新タスク(fix1-next)の1本だけになる(2本走行の穴が塞がれている)",
      running66.length === 1 && running66[0].id === "fix1-next", JSON.stringify(running66.map((b) => b.id)));

    // ============================================================
    // [67] レビュー修正1(now-start経路): NEXT QUEUEの繰上げ開始でも実行中ルーティンが自動クローズされる
    // ============================================================
    console.log("[67] レビュー修正1: NEXT QUEUEの繰上げ開始(now-start→宣言モーダル)でも実行中ルーティンが自動クローズされる");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      blocks: [
        block("fix1b-routine-run", { title: "FIX1B-ROUTINE-放置ルーティン", category: "ルーティン", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("11:15") }),
        block("fix1b-next", { title: "FIX1B-NEXT-次タスク", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") })
      ]
    });
    await page.waitForSelector('.today-next-queue [data-action="now-start"][data-id="fix1b-next"]', { state: "attached" });
    await page.locator('.today-next-queue [data-action="now-start"][data-id="fix1b-next"]').click();
    await page.waitForSelector('[data-action="declare-skip"]', { state: "attached" });
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const t = s.blocks.find((b) => b.id === "fix1b-next");
      return !!t && !!t.actualStartAt;
    }, KEY);
    const st67 = await stateNow();
    const routine67 = st67.blocks.find((b) => b.id === "fix1b-routine-run");
    check("now-start経路: 放置ルーティンにactualEndAtが付く(自動クローズ)",
      !!routine67.actualEndAt, JSON.stringify(routine67));
    check("now-start経路: 放置ルーティンはcompletedにならない",
      routine67.completed === false, JSON.stringify(routine67));
    const running67 = st67.blocks.filter((b) => b.actualStartAt && !b.actualEndAt);
    check("now-start経路: 実行中Blockが新タスク(fix1b-next)の1本だけになる",
      running67.length === 1 && running67[0].id === "fix1b-next", JSON.stringify(running67.map((b) => b.id)));

    // ============================================================
    // [68] レビュー修正7(2周目): ポモ実行中ルーティンのチップをタップ→Block完了+ポモ後始末が両方起きる
    // ============================================================
    console.log("[68] レビュー修正7: ポモが連動している実行中ルーティンのチップをタップすると、Block完了とポモ後始末(停止・クリア)が両方起きる");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("fix7-routine-pomo", { title: "FIX7-ROUTINE-POMO連動", category: "ルーティン", actualStartAt: at("11:50"), plannedStartAt: at("11:50"), plannedEndAt: at("12:05") })
      ],
      pomodoro: { running: true, blockId: "fix7-routine-pomo", startedAt: at("11:50"), endsAt: at("12:15"), mode: "focus" }
    });
    await page.waitForSelector('.today-routine-undone-chips [data-id="fix7-routine-pomo"]', { state: "attached" });
    check("ポモ連動チップにも is-running が付く(実行中表示のまま)",
      await page.locator('.today-routine-undone-chips [data-id="fix7-routine-pomo"].is-running').count() === 1);
    await page.locator('.today-routine-undone-chips [data-id="fix7-routine-pomo"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const b = s.blocks.find((x) => x.id === "fix7-routine-pomo");
      return !!b && b.completed === true && !!b.actualEndAt;
    }, KEY);
    const st68 = await stateNow();
    const routine68 = st68.blocks.find((b) => b.id === "fix7-routine-pomo");
    check("Blockはcompleted:true+actualEndAtが付いて完了する(completePomodoro経由・now-conveyor-complete)",
      routine68.completed === true && !!routine68.actualEndAt, JSON.stringify(routine68));
    check("state.pomodoroが後始末される(running:false・blockId空、放置されない)",
      st68.pomodoro.running === false && st68.pomodoro.blockId === "", JSON.stringify(st68.pomodoro));
    // completePomodoro()は既存の身体スキャンモーダル(post-completion。完了を止める確認ゲートではない)を
    // 開く。完了自体は直前のwaitForFunctionで既に成立しているため、閉じるだけで後続テストへ影響を残さない。
    check("既存の身体スキャンモーダルが開く(completePomodoro経由の既存挙動。完了はすでに成立済み)",
      await page.locator('.modal-title:has-text("いまの疲労感")').count() === 1);
    await page.locator('[data-action="body-scan-discard"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });
    check("身体スキャンモーダルを閉じてもcompleted状態は変わらない(記録せず閉じるでロールバックされない)",
      (await stateNow()).blocks.find((b) => b.id === "fix7-routine-pomo")?.completed === true);

    // ============================================================
    // [69] レビュー修正8(2周目): ポモ連動ルーティンがある状態でnow-start経由の新タスク開始
    //      → ルーティンクローズ+旧ポモクリア+新Blockの自動ポモが正常起動する
    // ============================================================
    console.log("[69] レビュー修正8: ポモ実行中ルーティンがある状態でnow-start(宣言スキップ)→ルーティンにactualEndAt付与+旧ポモクリア+新タスクの自動ポモが正常起動する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB2({
      view: "today",
      blocks: [
        block("fix8-routine-pomo", { title: "FIX8-ROUTINE-POMO連動", category: "ルーティン", actualStartAt: at("11:45"), plannedStartAt: at("11:45"), plannedEndAt: at("12:00") }),
        block("fix8-next", { title: "FIX8-NEXT-次タスク", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") })
      ],
      // endsAtは固定時刻12:00より未来にする(過去だと自動でbreakへ遷移し、focusTimerAutoの
      // 「!running」判定に引っかからず新セッションが始まらない=このテストの検証対象外の別挙動を踏む)。
      // v215: このテストの前提「focusTimerAuto既定ON」を明示seedする。[15e]がOFFをseedした後、
      // 従来はタブ削除で消えた中間セクションが暗黙にONへ戻していた(セクション間結合の解消)。
      settings: { focusTimerAuto: true },
      pomodoro: { running: true, blockId: "fix8-routine-pomo", startedAt: at("11:45"), endsAt: at("12:10"), mode: "focus" }
    });
    await page.waitForSelector('.today-next-queue [data-action="now-start"][data-id="fix8-next"]', { state: "attached" });
    await page.locator('.today-next-queue [data-action="now-start"][data-id="fix8-next"]').click();
    await page.waitForSelector('[data-action="declare-skip"]', { state: "attached" });
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const t = s.blocks.find((b) => b.id === "fix8-next");
      return !!t && !!t.actualStartAt;
    }, KEY);
    const st69 = await stateNow();
    const routine69 = st69.blocks.find((b) => b.id === "fix8-routine-pomo");
    check("ルーティンがクローズされる(actualEndAtが付く)", !!routine69.actualEndAt, JSON.stringify(routine69));
    check("ルーティンはcompletedにならない", routine69.completed === false, JSON.stringify(routine69));
    check("旧ポモ(ルーティン連動)は放置されず、新Block(fix8-next)へ連動した新セッションに置き換わる(focusTimerAuto既定ON)",
      st69.pomodoro.blockId === "fix8-next" && st69.pomodoro.running === true, JSON.stringify(st69.pomodoro));
    const running69 = st69.blocks.filter((b) => b.actualStartAt && !b.actualEndAt);
    check("実行中Blockが新タスク(fix8-next)の1本だけになる",
      running69.length === 1 && running69[0].id === "fix8-next", JSON.stringify(running69.map((b) => b.id)));

    // ============================================================
    // [70] レビュー修正9(3周目): saveBlockFromModal()は検証失敗時にルーティンを閉じたままにしない
    // ============================================================
    console.log("[70] レビュー修正9: Block編集モーダルの保存が必須欄不足で失敗しても実行中ルーティンは閉じられたままにならず、正しい保存では従来どおりクローズされる");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      blocks: [
        block("fix9-routine-run", { title: "FIX9-ROUTINE-放置ルーティン", category: "ルーティン", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("11:15") }),
        block("fix9-target", { title: "FIX9-TARGET-編集対象", plannedStartAt: at("13:00"), plannedEndAt: at("13:30") })
      ]
    });
    await page.waitForSelector('.today-next-queue [data-action="edit-block"][data-id="fix9-target"]', { state: "attached" });
    await page.locator('.today-next-queue [data-action="edit-block"][data-id="fix9-target"]').click();
    await page.waitForSelector('.modal-title:has-text("を編集")', { state: "attached" });
    // actualStartAtを入れて「保存後は実行中になる」状態を作りつつ、plannedEndAtを空にして
    // 既存の必須欄検証(app.js:16019付近)をわざと失敗させる。
    await page.locator('[data-modal-field="actualStartAt"]').fill(at("12:00").slice(0, 16));
    await page.locator('[data-modal-field="plannedEndAt"]').fill("");
    await page.locator('[data-action="modal-save"]').click();
    // 検証失敗パスはcloseModal()を呼ばない(app.js該当コード確認済み)ため、モーダルは開いたまま残る。
    // 固定waitではなくその状態(モーダル残存)自体を待つ。
    await page.waitForFunction(() => document.querySelectorAll(".modal-card").length === 1);
    check("必須欄不足の保存はモーダルを閉じない(closeModal()未実行の証拠)",
      await page.locator(".modal-card").count() === 1);
    const st70a = await stateNow();
    const routine70a = st70a.blocks.find((b) => b.id === "fix9-routine-run");
    check("検証失敗時、実行中ルーティンはactualEndAtが付かず実行継続している(修正9の検証観点)",
      !routine70a.actualEndAt, JSON.stringify(routine70a));
    const target70a = st70a.blocks.find((b) => b.id === "fix9-target");
    check("検証失敗時、編集対象Block自体も保存されていない(actualStartAt未反映。保存が本当に中断されたことの裏付け)",
      !target70a.actualStartAt, JSON.stringify(target70a));
    // plannedEndAtを正しく埋めて再保存する(修正9後も「検証成功パスは従来どおり」であることの確認)
    await page.locator('[data-modal-field="plannedEndAt"]').fill(at("13:30").slice(0, 16));
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const t = s.blocks.find((b) => b.id === "fix9-target");
      return !!t && !!t.actualStartAt;
    }, KEY);
    check("正しい保存後はモーダルが閉じる", await page.locator(".modal-card").count() === 0);
    const st70b = await stateNow();
    const routine70b = st70b.blocks.find((b) => b.id === "fix9-routine-run");
    check("正しい保存では従来どおり実行中ルーティンがクローズされる(actualEndAtが付く)",
      !!routine70b.actualEndAt, JSON.stringify(routine70b));
    check("クローズされたルーティンはcompletedにならない(修正1の契約を維持)",
      routine70b.completed === false, JSON.stringify(routine70b));

    // ============================================================
    // [65] C2仕様6: ROUTINE時間帯別合計は oneTap Block を除外し routineRate と一致する
    // ============================================================
    console.log("[65] C2仕様6: ROUTINEの時間帯別合計はoneTap Blockを除外し、routineRate(D5)と一致する");
    await seed({
      view: "today",
      blocks: [
        block("c2-band-1", { title: "C2-BAND-1", category: "ルーティン", plannedStartAt: at("07:00"), plannedEndAt: at("07:15"), completed: true, actualStartAt: at("07:00"), actualEndAt: at("07:15") }),
        block("c2-band-2", { title: "C2-BAND-2", category: "ルーティン", plannedStartAt: at("10:00"), plannedEndAt: at("10:15") }),
        // oneTap = 実績記録専用Block。routine.js routineRate() と同じ除外ルールを帯集計にも適用する(仕様6)。
        block("c2-band-onetap", { title: "C2-BAND-ONETAP", category: "ルーティン", oneTap: true, completed: true, plannedStartAt: at("11:00"), plannedEndAt: at("11:15"), actualStartAt: at("11:00"), actualEndAt: at("11:15") })
      ]
    });
    await page.waitForSelector(".today-routine", { state: "attached" });
    const bandText = await panelText(".today-routine-list");
    const bandPairs = [...(bandText || "").matchAll(/(\d+)\s*\/\s*(\d+)/g)];
    const bandDoneSum = bandPairs.reduce((a, m) => a + Number(m[1]), 0);
    const bandTotalSum = bandPairs.reduce((a, m) => a + Number(m[2]), 0);
    check("oneTap Blockを含めても時間帯別合計の done は1(oneTap除外、routineRateと一致)",
      bandDoneSum === 1, `doneSum=${bandDoneSum} text=${bandText}`);
    check("oneTap Blockを含めても時間帯別合計の total は2(oneTap除外、routineRateと一致)",
      bandTotalSum === 2, `totalSum=${bandTotalSum} text=${bandText}`);

    // ============================================================
    // [71]〜[76] C1(v192): NOW FOCUSは完了を押すまで計測継続
    // ============================================================
    console.log("[71] C1仕様1/2: 見積超過で is-warn/is-late が付かず、#todayNowProgress に over クラス+中立文言が付く(初期描画時点)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({
      view: "today",
      blocks: [
        block("c1-over", { title: "C1-OVER-超過タスク", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("11:10"), estimateMin: 10 })
      ]
    });
    await page.waitForSelector(".today-now-focus", { state: "attached" });
    const overBar0 = (await page.locator("#todayNowProgress").getAttribute("class")) || "";
    check("初期描画時点でis-warn/is-lateクラスが付かない",
      !overBar0.includes("is-warn") && !overBar0.includes("is-late"), overBar0);
    check("初期描画時点で見積超過(60分経過/見積10分)を検知しoverクラスが付く", overBar0.includes("over"), overBar0);
    const estText0 = await page.locator("#todayNowEstimate").textContent();
    check("初期描画時点で超過文言「見積 10分 超過 — 完了まで計測継続」になる",
      (estText0 || "").includes("見積 10分 超過") && (estText0 || "").includes("完了まで計測継続"), estText0);
    const elapsedClass0 = (await page.locator("#todayNowElapsed").getAttribute("class")) || "";
    check("経過表示自体にも警告色クラスが付かない(非懲罰原則: 赤・琥珀を出さない)",
      !elapsedClass0.includes("is-warn") && !elapsedClass0.includes("is-late"), elapsedClass0);
    const barWidthOver0 = await page.locator("#todayNowProgress").evaluate((el) => el.style.width);
    check("超過時もバー幅は100%で張り付く(clamp維持)", barWidthOver0 === "100%", barWidthOver0);
    // レビュー修正⑤: 通常(非reduced-motion)文脈ではover状態の縞模様アニメが実際に動くことを
    // animation-name自体で検証する(keyframes名typoや::beforeルール欠落を検知できるように)。
    const overAnimName0 = await page.locator("#todayNowProgress").evaluate((el) => getComputedStyle(el, "::before").animationName);
    check("通常文脈ではover状態の縞模様アニメが動く(animation-name: today-over-flow)",
      overAnimName0 === "today-over-flow", overAnimName0);

    console.log("[72] C1仕様1/2: tickでも同様(80%地点ではoverが付かず、100%到達でoverへ切り替わる)");
    await seed({
      view: "today",
      blocks: [
        block("c1-tick", { title: "C1-TICK-tick経由", actualStartAt: at("11:51"), plannedStartAt: at("11:51"), plannedEndAt: at("12:01"), estimateMin: 10 })
      ]
    });
    await page.clock.setFixedTime(fixedTime(11, 59, 0));  // 経過8分(80%)
    await page.waitForFunction(() => (document.getElementById("todayNowElapsed")?.textContent || "").startsWith("08:"));
    const barAt80 = (await page.locator("#todayNowProgress").getAttribute("class")) || "";
    check("80%到達時点でもoverクラスが付かない(is-warn相当の中間警告を出さない)", !barAt80.includes("over"), barAt80);
    await page.clock.setFixedTime(fixedTime(12, 1, 30));  // 経過10分30秒(105%)
    await page.waitForFunction(() => (document.getElementById("todayNowProgress")?.className || "").includes("over"));
    // レビュー修正⑥: waitForFunctionの成立を検証済み扱いにする恒真checkではなく、
    // 実DOMのclassを再取得した値をcheckへ渡す(assertion自体が失敗し得る形にする)。
    const barAfterOver = (await page.locator("#todayNowProgress").getAttribute("class")) || "";
    check("100%超過後はtickでoverクラスへ切り替わる(毎tick再取得、C1)", barAfterOver.includes("over"), barAfterOver);
    const estTextTick = await page.locator("#todayNowEstimate").textContent();
    check("tick後も超過文言(見積 n分 超過 — 完了まで計測継続)に切り替わる",
      (estTextTick || "").includes("超過") && (estTextTick || "").includes("完了まで計測継続"), estTextTick);

    console.log("[73] C1仕様5: ポモドーロのタイマー満了(自動発火のgoBreakPomodoro)ではblock.actualEndAtを書かず、NOW FOCUSに残り続ける");
    await page.clock.setFixedTime(fixedTime(9, 0, 0));
    await seed({
      view: "today",
      blocks: [
        block("c1-pomo", { title: "C1-POMO-満了タスク", actualStartAt: at("09:00"), plannedStartAt: at("09:00"), plannedEndAt: at("09:25"), estimateMin: 25 })
      ]
    });
    await page.evaluate(({ KEY, startedAt, endsAt }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.pomodoro = { running: true, blockId: "c1-pomo", startedAt, endsAt, mode: "focus" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, startedAt: at("09:00"), endsAt: at("09:25") });
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    // endsAt(09:25)を過ぎた時刻へ固定時刻を進める。常時稼働のtimerTicker(500ms周期)が
    // 自動でgoBreakPomodoro()を呼ぶのを実時間で待つ(reload・クリックなし)。
    await page.clock.setFixedTime(fixedTime(9, 25, 1));
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro?.mode === "break", KEY, { timeout: 10000 });
    const stAfterAutoBreak = await stateNow();
    const pomoBlockAfter = stAfterAutoBreak.blocks.find((b) => b.id === "c1-pomo");
    check("自動休憩遷移後もblock.actualEndAtは空のまま(C1: 完了を押すまで計測継続)",
      !pomoBlockAfter.actualEndAt, JSON.stringify(pomoBlockAfter));
    check("actualStartAtは維持されたまま(計測は継続中)", pomoBlockAfter.actualStartAt === at("09:00"));
    check("pomodoroCountは従来どおり加算される(タイマー機能自体は維持)",
      pomoBlockAfter.pomodoroCount === 1, JSON.stringify(pomoBlockAfter));
    check("state.pomodoro.modeが休憩(break)へ遷移する(休憩自体は維持)", stAfterAutoBreak.pomodoro.mode === "break");
    const nfTextAfterBreak = await panelText(".today-now-focus");
    check("自動休憩遷移後もNOW FOCUSに実行中Blockが残り続ける(C1)",
      (nfTextAfterBreak || "").includes("C1-POMO-満了タスク"), nfTextAfterBreak);

    console.log("[76] prefers-reduced-motion時は縞模様アニメが停止する(静的表示+文言のみで状態を伝える)");
    // レビュー修正⑦: 既存ctx/pageは閉じずに残す(以後の追記が閉じたpageへ触れてしまう事故を防ぐ)。
    // reduced-motion確認専用の別contextを並行して開き、使い終わったらreducedCtxだけを閉じる。
    const reducedCtx = await browser.newContext({
      serviceWorkers: "block", viewport: { width: 1100, height: 1400 }, reducedMotion: "reduce"
    });
    const reducedPage = await reducedCtx.newPage();
    reducedPage.on("pageerror", (e) => { failures++; console.log("  ❌ reducedPage pageerror:", e.message); });
    await blockGithubApiByDefault(reducedPage);
    await reducedPage.clock.setFixedTime(fixedTime(12, 0, 0));
    await reducedPage.goto(`http://localhost:${PORT}/`);
    await reducedPage.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(reducedPage);
    await reducedPage.evaluate(({ KEY, blocks, view, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.currentView = view;
      s.selectedDate = TODAY;
      s.settings.todaySkin = "cockpit";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, {
      KEY,
      blocks: [block("c1-reduced", { title: "C1-REDUCED-超過タスク", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("11:10"), estimateMin: 10 })],
      view: "today",
      TODAY
    });
    // seed()と同様、reload後はまずナビ要素の出現を待ってからパネルを待つ(早すぎるDOM参照を避ける)。
    await reducedPage.reload();
    await reducedPage.waitForSelector('[data-action="nav"]', { state: "attached" });
    await reducedPage.waitForSelector(".today-now-focus", { state: "attached" });
    const reducedAnim = await reducedPage.locator("#todayNowProgress").evaluate((el) =>
      getComputedStyle(el, "::before").animationName);
    check("reduced-motion時は縞模様の流れるアニメが止まる(animation-name: none)", reducedAnim === "none", reducedAnim);
    const reducedOverClass = (await reducedPage.locator("#todayNowProgress").getAttribute("class")) || "";
    check("reduced-motion時もoverクラス自体(静的な縞表示)は付いたまま", reducedOverClass.includes("over"), reducedOverClass);
    await reducedCtx.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
