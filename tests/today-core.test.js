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
    console.log("[1] 新規state(seedState)の起動ビューが today で、5パネル+時計が描画される");
    await page.goto(`http://localhost:${PORT}/`);
    // 新規プロファイル = トークン未設定なのでまずゲートが出る(既存挙動)。通過後に起動ビューを判定する。
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);
    check("seedState(新規state)の起動ビューが today になる(D3)", (await currentDataView()) === "today", await currentDataView());
    for (const sel of PANELS) {
      check(`パネルroot ${sel} が描画される`, await page.locator(sel).count() === 1);
    }
    check("ヘッダ時計 #todayClock が描画される", await page.locator("#todayClock").count() === 1);

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
    // [15b] P5: 今日ビューで開始したセッションがポモドーロ単体ビューでも見え、
    //        既存の2倍速表示(実25分=50:00表示)が不変であること
    // ============================================================
    console.log("[15b] P5: 単体ビューに同セッションが 50:00(2倍速)で表示され、+1分で 48:00 に進む(既存表示仕様の不変検証)");
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="pomodoro"]').click();
    await waitView("pomodoro");
    await page.waitForFunction(() => (document.getElementById("main")?.textContent || "").includes("50:00"));
    check("単体ビューの残り表示が 50:00(実25分の2倍速換算。今日ビュー統合で壊れていない)", true);
    await page.clock.setFixedTime(fixedTime(12, 1, 0));
    await page.waitForFunction(() => (document.getElementById("main")?.textContent || "").includes("48:00"));
    check("実時間+1分で残り表示が 48:00 に進む(2倍速仕様=実1分で表示2分減が維持されている)", true);

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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
