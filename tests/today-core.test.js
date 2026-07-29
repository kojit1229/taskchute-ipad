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
    //            migratedTo・carryCount+1)。この経路では儀式モーダルを出さない
    //            (carryCount=2 → nextCount=3 = MIGRATION_RITUAL_THRESHOLD 到達でも出ない)
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
      // carryCount:2 → nextCount=3 = 儀式閾値。旧requestCarryOver経路なら儀式モーダルが開く値(前提B5-5の検証用)
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
    // [31b] F2 DRIFT「送る」: 対象Blockが翌日へ移り(migratedTo記録・儀式モーダルなし)、着地が再計算される
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
    check("儀式モーダルが出ない(nextCount=3=閾値到達でも、この経路では儀式を出さない。前提B5-5)",
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

    // ============================================================
    // ==== ここから W1(計時タブ=TIME SWITCH独立ビュー)追記セクション [35]〜[45b] ====
    // 設計の正: workbench/out/2026-07-29-today-cockpit-ideas/design-onetap-timetree.md
    //   §2全体(§2.3遷移表=全セルが検証対象・§2.4データモデル)+§5裁定表 #2/#3/#4 に加え
    //   **#15〜#19(2026-07-29 K指示。本改訂の主因)**:
    //     #15 独立タブ(view id "timeswitch"・ラベル「計時」・サイドバー+「その他」・bottom-nav不変・記録専用)
    //     #16 3群表示 (a)カテゴリタイル (b)当日タスクBlockタイル(未着手・実行中) (c)当日予定タイル(こーじのみ)
    //     #17 タスクタイル=宣言なし即開始 / 予定タイル=Block化+即開始 / タスク実行中の他タイル=確認1回
    //     #18 タスクタイル再タップ=完了。完了済みタイルは残り、再タップで同taskId/title/categoryの新Block生成+開始
    //     #19 タスクタイル開始のみ focusTimerAuto 連動維持。カテゴリ・予定タイルはポモ非連動
    // 予定データの契約: 同設計書 §3.4 schedule-inbox.json スキーマ(generatedAtはT区切り秒あり)。
    // DOM契約(実装側と共有):
    //   パネルroot .timeswitch(計時ビュー内のみ。今日ビューには置かない=[35]/[35c]の一本化回帰ガード)/
    //   カテゴリタイル button.timeswitch-tile[data-category="カテゴリ名"] /
    //   タスクタイル button.timeswitch-task[data-block-id] /
    //   予定タイル button.timeswitch-event[data-external-id] /
    //   計時中タイル .is-active(+経過表示要素 .timeswitch-elapsed)/
    //   タスク由来アクティブのカテゴリタイル .is-task(▶TASKラベル)/
    //   確認オーバーレイ #cc-overlay(OK=data-action="timeswitch-confirm-ok"、
    //   キャンセル=data-action="timeswitch-confirm-cancel")
    // 実装(未着手)より先に仕様から書いた。前提が実装と食い違った場合はテストを弱めるのではなく、
    // 前提の側を実装と突合して直すこと:
    //   前提W1-1: カテゴリタイル一覧はカテゴリマスタ全件(§2.4第1弾)。タイル数=マスタ件数で、
    //            data-category はマスタの name(新規state既定 = 開発/内省/営業/学習/休息/回復)
    //   前提W1-2: ワンタップBlockの「完了」= actualEndAt付与+completed:true(同一タイル停止・
    //            別タイル切替・タスク開始時の自動完了すべて同じ)
    //   前提W1-3: 今日ビューのタスク開始(now-start)は従来どおり既存宣言モーダル(v87)経由
    //            (裁定#17が宣言を省くのは計時タブのタスクタイルだけ)。ワンタップ自動完了の検証は
    //            宣言スキップ後の最終状態で行う。裁定#2の「無確認」= #cc-overlay を出さないこと
    //   前提W1-4: 確認オーバーレイのOKで実行中タスクへ打つ実績終了時刻は現在時刻。タスクの
    //            interruptions への理由記録はしない(「理由ピッカーを開かない」だけを契約とする)
    //   前提W1-5: 経過表示は§4の単一1秒tickerに相乗りし、毎tickクラスセレクタで再取得して更新する
    //            (停止の負検証は[7]/[18]/[20]と同じおとり方式が成立する前提)
    //   前提W1-6: DAY GAUGE 残り見積の oneTap 除外は「表示値が変わらない」outcome基準で検証する
    //            (oneTap Blockの estimateMin 実装値を契約にしない)。加えて合成フィクスチャ
    //            (未開始oneTap Block)で NEXT QUEUE / 残り見積のフィルタを直接判別する
    //   前提W1-7: 孤児補完の永続化は次の保存契機(setView)で行われる([21]と同じ踏み方)。
    //            補完値は前日T23:59。補完時の completed フラグ付与の有無は契約にしない
    //   前提W1-8: タスクタイル群は当日Blockを data-block-id で表す。oneTap:true Blockはタスクタイル群に
    //            出ない(カテゴリタイルが担う)。完了済みタスクBlockのタイルは残る(裁定#18)。
    //            タイル総数・並び順は契約にしない(存在確認は data-block-id 指名で行う)
    //   前提W1-9: 実行中のタスク/予定タイルのアクティブ表示も .is-active。タスク実行中は
    //            そのカテゴリのカテゴリタイルが .is-task(§2.2の読み替え。裁定#15)
    //   前提W1-10: タイル再タップの完了は実績登録モーダルを開かず actualEndAt=now+completed:true を
    //            直接打つ(さくさく特化。裁定#17)。ポモ実行中に完了した際のポモ側の扱いは契約にしない
    //   前提W1-11: schedule-inbox.json は kindle highlights.json と同じ Contents API 経路
    //            (パス末尾 /contents/taskchute/schedule-inbox.json)で取得される。
    //            タイル化は date=当日 かつ label="こーじ" のみ(裁定#16)
    //   前提W1-12: 予定タイルからのBlockは title=予定title・date=当日・category空・
    //            externalRef=externalId・label自動。planned時刻・taskId・oneTapフラグは契約にしない。
    //            取込済みexternalIdのBlock再生成はしない(§3.4重複解決)。再タップの停止/無視の別も
    //            契約にしない(「増えない」ことだけを検証する)
    //   前提W1-13: 完了済みタスクタイル再タップの新Blockは「実績のみ」(裁定#18)。planned時刻の値と
    //            新Block開始時のポモ連動は契約にしない([43c]は台帳の形だけを検証する)
    // ============================================================

    // W1用seed: seedB5と同じ流儀(pomodoro/zeroThinking/gardenLogを毎回リセットし持ち越しを防ぐ。
    // 既存関数は変更禁止のため別名で追加。カテゴリマスタは初期seedStateの既定6件を維持する。
    // extraTasks は既存tasks(「その他」受け皿等)を保ったまま同idだけ差し替えて追記する)
    async function seedW1({ blocks = [], view = "timeswitch", settings = {}, selectedDate = TODAY, extraTasks = [] } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, selectedDate, extraTasks }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = selectedDate;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        s.gardenLog = {};
        s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
        s.pomodoro = { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        if (extraTasks.length) {
          s.tasks = (s.tasks || []).filter((t) => !extraTasks.some((x) => x.id === t.id)).concat(extraTasks);
        }
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, view, settings, selectedDate, extraTasks });
      await page.reload();
      await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    }

    // タスクタイル用のTaskフィクスチャ(seedB3のtaskFxと同形。既存tasksへ追記して使う)
    const w1TaskFx = (id) => ({
      id, projectId: "", title: id, status: "todo", dueDate: "", deleted: false,
      createdAt: at("00:00"), updatedAt: at("00:00")
    });

    // W1小物: running走査(§2.3不変条件「StartありEndなし・未削除は常に最大1」の判定はこの1関数に集約)
    const w1Running = (s) => (s.blocks || []).filter((b) => !b.deleted && b.actualStartAt && !b.actualEndAt);
    const w1TileSel = (cat) => `.timeswitch button.timeswitch-tile[data-category="${cat}"]`;
    const w1TaskTileSel = (blockId) => `.timeswitch button.timeswitch-task[data-block-id="${blockId}"]`;
    const w1EventTileSel = (externalId) => `.timeswitch button.timeswitch-event[data-external-id="${externalId}"]`;
    async function w1Tap(cat) { await page.locator(w1TileSel(cat)).first().click(); }
    async function w1GoView(view) {
      await page.locator(`#sidebar .nav-button[data-action="nav"][data-view="${view}"]`).click();
      await waitView(view);
    }
    async function w1BlocksJSON() {
      return page.evaluate((KEY) => JSON.stringify(JSON.parse(localStorage.getItem(KEY)).blocks), KEY);
    }
    // #cc-overlay の可視判定(DOM常設display切替でも動的生成でも成立する読み方。
    // オーバーレイはposition:fixed想定のためoffsetParentは使わない)
    async function w1OverlayVisible() {
      return page.evaluate(() => {
        const el = document.getElementById("cc-overlay");
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      });
    }
    async function w1WaitOverlayShown() {
      await page.waitForFunction(() => {
        const el = document.getElementById("cc-overlay");
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      });
    }
    async function w1WaitOverlayHidden() {
      await page.waitForFunction(() => {
        const el = document.getElementById("cc-overlay");
        if (!el) return true;
        const cs = getComputedStyle(el);
        return cs.display === "none" || cs.visibility === "hidden";
      });
    }

    // 予定タイル用フィクスチャ+ルート(B2のkindle highlightsと同じContents API偽装。前提W1-11。
    // schedule-inbox.json 以外は route.fallback() で既存モック/既定404ブロッカーへ委ねる)
    const scheduleInboxFx = { status: 200 };
    const W1_SCHEDULE_INBOX = {
      generatedAt: `${TODAY}T07:00:00`,  // 当日朝生成=鮮度内(T区切り秒あり。FORMAT_CONTRACT整合)
      events: [
        { externalId: "tt-koji-1", title: "TT-こーじ-歯医者", date: TODAY, startAt: "16:00", endAt: "17:00", allDay: false, label: "こーじ", calendarName: "家族" },
        { externalId: "tt-midori-1", title: "TT-翠-習い事", date: TODAY, startAt: "15:00", endAt: "16:00", allDay: false, label: "翠", calendarName: "家族" },
        { externalId: "tt-koji-tomorrow", title: "TT-こーじ-明日の予定", date: TOMORROW, startAt: "10:00", endAt: "11:00", allDay: false, label: "こーじ", calendarName: "家族" }
      ]
    };
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/contents/taskchute/schedule-inbox.json")) {
        if (scheduleInboxFx.status !== 200) return route.fulfill({ status: scheduleInboxFx.status, body: "not found" });
        // [45c]用: 生bodyの差し替え(壊れJSON)と鮮度超過(generatedAtを過去へずらす)
        if (scheduleInboxFx.body != null) return route.fulfill({ status: 200, contentType: "application/json", body: scheduleInboxFx.body });
        if (scheduleInboxFx.staleHours) {
          const h = 7 - scheduleInboxFx.staleHours;  // 固定時刻12:00基準で27h前=前日09:00
          const d = h < 0 ? YESTERDAY : TODAY;
          const hh = String(((h % 24) + 24) % 24).padStart(2, "0");
          const staled = { ...W1_SCHEDULE_INBOX, generatedAt: `${d}T${hh}:00:00` };
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staled) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(W1_SCHEDULE_INBOX) });
      }
      return route.fallback();
    });

    // ============================================================
    // [35] W1: 計時タブの遷移とDOM契約 — 無計時→カテゴリタイルタップで oneTap Block 生成・実行開始
    //   (§2.3表1行目・裁定#4・裁定#15。今日ビュー側に .timeswitch 系を置かない一本化回帰ガード込み)
    // ============================================================
    console.log("[35] W1: サイドバー「計時」→ timeswitch ビュー。無計時→タイルタップで oneTap Block が生成・開始・保存される");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "today",
      blocks: [
        // 残り見積の対照用: 未着手の通常Block 2件(見積合計105分)。[35c]で表示値の不変を突合する
        block("w1-q1", { title: "W1-未着手A", plannedStartAt: at("13:00"), plannedEndAt: at("14:00"), estimateMin: 60 }),
        block("w1-q2", { title: "W1-未着手B", plannedStartAt: at("14:00"), plannedEndAt: at("14:45"), estimateMin: 45 })
      ]
    });
    await page.waitForSelector(".today-next-queue", { state: "attached" });
    check("今日ビューに .timeswitch 系パネルが存在しない(裁定#15: 今日ビュー内パネルは作らない一本化)",
      await page.evaluate(() => !document.querySelector(".timeswitch, .timeswitch-tile, .timeswitch-task, .timeswitch-event")));
    const w1RemBefore = await page.locator("#todayRemainingEstimate").textContent();
    check("サイドバーに計時タブのナビボタン(data-view='timeswitch')がある(裁定#15)",
      await page.locator('#sidebar .nav-button[data-action="nav"][data-view="timeswitch"]').count() === 1);
    check("ナビボタンのラベルが「計時」を含む(裁定#15)",
      ((await page.locator('#sidebar .nav-button[data-view="timeswitch"]').textContent()) || "").includes("計時"));
    check("bottom-nav に timeswitch ボタンが無い(裁定#15: bottom-nav 5枠は当面不変)",
      await page.locator('#bottomNav button[data-view="timeswitch"]').count() === 0);
    await w1GoView("timeswitch");
    await page.waitForSelector(".timeswitch", { state: "attached" });
    check("計時ビューにパネルroot .timeswitch が描画される(DOM契約)",
      await page.locator(".timeswitch").count() === 1);
    const w1MasterNames = await page.evaluate((KEY) =>
      (JSON.parse(localStorage.getItem(KEY)).settings.categories || []).map((c) => c.name), KEY);
    const w1TileInfo = await page.evaluate(() => {
      const all = [...document.querySelectorAll(".timeswitch button.timeswitch-tile")];
      return { total: all.length, cats: all.map((el) => el.dataset.category) };
    });
    check("カテゴリタイルは button.timeswitch-tile[data-category](DOM契約)",
      w1TileInfo.total >= 1 && w1TileInfo.cats.every((c) => !!c), JSON.stringify(w1TileInfo));
    check("カテゴリタイルがカテゴリマスタ全件と一致する(§2.4第1弾: 出典=既存カテゴリマスタ全件。前提W1-1)",
      w1MasterNames.length >= 1 && w1TileInfo.total === w1MasterNames.length
      && w1MasterNames.every((n) => w1TileInfo.cats.includes(n)),
      JSON.stringify({ master: w1MasterNames, tiles: w1TileInfo.cats }));
    check("無計時では .is-active タイルが1つも無い(アクティブ表示は常に最大1つ)",
      await page.locator(".timeswitch .is-active").count() === 0);
    await w1Tap("学習");
    // タップ(イベント)時点で saveState されることを localStorage の変化で待つ(§2.4の保存側)
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true), KEY);
    check("タイルタップ(イベント)で即 saveState される(localStorageにoneTap Blockが現れる。§2.4)", true);
    const st35 = await stateNow();
    const ot35 = st35.blocks.find((b) => b.oneTap === true);
    check("oneTap:true・title=カテゴリ名('学習')のBlockが生成される(裁定#4: 台帳はblocks一本)",
      !!ot35 && ot35.title === "学習", JSON.stringify(ot35));
    check("block.category にもカテゴリ名が入る(TIME LOG集計・配色のキー。§2.4)",
      ot35?.category === "学習", ot35?.category);
    check("date=今日・actualStartAt=12:00 で実行開始される",
      ot35?.date === TODAY && (ot35?.actualStartAt || "").includes("T12:00"),
      JSON.stringify({ date: ot35?.date, actualStartAt: ot35?.actualStartAt }));
    check("plannedStartAt が actualStartAt と同値(§2.4: planned時刻は開始時点のactualと同値)",
      !!ot35?.plannedStartAt && ot35.plannedStartAt === ot35.actualStartAt,
      JSON.stringify({ planned: ot35?.plannedStartAt, actual: ot35?.actualStartAt }));
    const w1OtherTask = st35.tasks.find((t) => t.kind === "other" && !t.deleted);
    check("taskId が「その他」受け皿Taskに紐づく(taskId無しBlockは実行ビューに出ない罠の回避。§2.1)",
      !!ot35?.taskId && !!w1OtherTask && ot35.taskId === w1OtherTask.id,
      JSON.stringify({ taskId: ot35?.taskId, otherTaskId: w1OtherTask?.id }));
    check("running(StartありEndなし)が全stateで1件のみ(§2.3不変条件)",
      w1Running(st35).length === 1, JSON.stringify(w1Running(st35).map((b) => b.id)));
    check("タップしたカテゴリタイルだけが .is-active になる",
      await page.locator(".timeswitch .timeswitch-tile.is-active").count() === 1
      && await page.locator(`${w1TileSel("学習")}.is-active`).count() === 1);
    await page.waitForSelector(".timeswitch .timeswitch-elapsed", { state: "attached" });
    check("計時中タイルに経過表示要素 .timeswitch-elapsed がある(DOM契約)", true);

    // ============================================================
    // [35b] W1: 経過表示が毎秒進み(既存ticker相乗り。[8]と同手法)、tickではstateが変わらない(D9)
    // ============================================================
    console.log("[35b] W1: 経過表示が固定時刻+65秒で進み、経過tickでは state(blocks)が変わらない(D9)");
    const w1Elapsed0 = await page.locator(".timeswitch .timeswitch-elapsed").first().textContent();
    const w1BlocksSnap0 = await w1BlocksJSON();
    await page.clock.setFixedTime(fixedTime(12, 1, 5));
    await page.waitForFunction((prev) => {
      const el = document.querySelector(".timeswitch .timeswitch-elapsed");
      return el && el.textContent !== prev;
    }, w1Elapsed0);
    check("固定時刻+65秒で経過表示が reload なしで更新される(§4単一tickerへの相乗り。前提W1-5)", true);
    check("経過tickでは state(blocks)が一切変わらない(保存はイベント時のみ。§2.4・D9)",
      (await w1BlocksJSON()) === w1BlocksSnap0);

    // ============================================================
    // [35c] W1: 計時中に今日ビューへ戻っても DAY GAUGE 残り見積が変わらない(oneTapフィルタ・§2.2)
    // ============================================================
    console.log("[35c] W1: 計時中に今日ビューへ戻っても残り見積(通常Block分105分)が変わらず、.timeswitch系パネルも出ない");
    await w1GoView("today");
    await page.waitForSelector(".today-day-gauge", { state: "attached" });
    check("残り見積 #todayRemainingEstimate が計時開始前と同じ表示のまま(oneTap Blockが母集合に入らない。前提W1-6)",
      (await page.locator("#todayRemainingEstimate").textContent()) === w1RemBefore,
      `before=${w1RemBefore} after=${await page.locator("#todayRemainingEstimate").textContent()}`);
    check("ワンタップ計時中でも今日ビューに .timeswitch 系パネルが出ない(一本化の回帰ガード)",
      await page.evaluate(() => !document.querySelector(".timeswitch, .timeswitch-tile, .timeswitch-task, .timeswitch-event")));

    // ============================================================
    // [36] W1: 同一タイル再タップで actualEndAt が打たれ完了・無計時へ。実績が TIME LOG 集計に乗る
    // ============================================================
    console.log("[36] W1: 同一タイル再タップで完了・無計時へ戻り、実績47分が計器盤 TIME LOG に乗る(§2.1/§2.3表2行目)");
    await page.clock.setFixedTime(fixedTime(12, 47, 0));
    await w1GoView("timeswitch");
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await w1Tap("学習");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && !!b.actualEndAt), KEY);
    const st36 = await stateNow();
    const ot36 = st36.blocks.find((b) => b.oneTap === true);
    check("再タップで actualEndAt=12:47 が打たれる", (ot36?.actualEndAt || "").includes("T12:47"), ot36?.actualEndAt);
    check("完了になる(completed=true。前提W1-2)", ot36?.completed === true, JSON.stringify(ot36));
    check("無計時へ戻る(runningが0件・.is-activeタイルが無い)",
      w1Running(st36).length === 0 && await page.locator(".timeswitch .is-active").count() === 0);
    // TIME LOG(計器盤・当日実績集計)にワンタップ実績が無改修で乗る(§2.1・裁定#4の本丸)
    await w1GoView("stats");
    await page.waitForSelector('.stats-time-log-row[data-category="学習"]', { state: "attached" });
    const w1TimeLogRow = await timeLogRowText("学習");
    check("ワンタップ実績47分(12:00→12:47)が TIME LOG のカテゴリ集計に乗る(blocks一本化で無改修集計)",
      textHasMin(w1TimeLogRow, 47), w1TimeLogRow);

    // ============================================================
    // [37] W1: 別タイルへの切替 — Xが完了しYが開始。runningは常に最大1(§2.3表3行目・不変条件)
    // ============================================================
    console.log("[37] W1: 計時中(開発)→別タイル(回復)で切替。開発が完了し回復が開始、runningは常に1件");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({ view: "timeswitch" });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await w1Tap("開発");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && !b.actualEndAt), KEY);
    const st37a = await stateNow();
    check("切替前: running=1(開発のみ)",
      w1Running(st37a).length === 1 && w1Running(st37a)[0].title === "開発",
      JSON.stringify(w1Running(st37a).map((b) => b.title)));
    await page.clock.setFixedTime(fixedTime(12, 10, 0));
    await w1Tap("回復");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && b.title === "回復" && !b.actualEndAt), KEY);
    const st37 = await stateNow();
    const w1Dev = st37.blocks.find((b) => b.oneTap === true && b.title === "開発");
    const w1Rec = st37.blocks.find((b) => b.oneTap === true && b.title === "回復");
    check("旧カテゴリ(開発)が actualEndAt=12:10 で完了する(前提W1-2)",
      (w1Dev?.actualEndAt || "").includes("T12:10") && w1Dev?.completed === true, JSON.stringify(w1Dev));
    check("新カテゴリ(回復)が actualStartAt=12:10 で開始される",
      (w1Rec?.actualStartAt || "").includes("T12:10") && !w1Rec?.actualEndAt, JSON.stringify(w1Rec));
    check("state走査: running(StartありEndなし・未削除)が最大1(§2.3不変条件「最後の操作が勝つ」)",
      w1Running(st37).length === 1 && w1Running(st37)[0].id === w1Rec?.id,
      JSON.stringify(w1Running(st37).map((b) => b.id)));
    check(".is-active が回復タイルだけに付く(切替でアクティブ表示も移る)",
      await page.locator(".timeswitch .timeswitch-tile.is-active").count() === 1
      && await page.locator(`${w1TileSel("回復")}.is-active`).count() === 1);

    // ============================================================
    // [37b] W1: oneTap Block は NEXT QUEUE・DAY GAUGE残り見積の母集合に出ない(oneTapフィルタ・§2.2)
    // ============================================================
    console.log("[37b] W1: 未開始のoneTap Block(合成フィクスチャ)が NEXT QUEUE・残り見積に混入しない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "today",
      blocks: [
        block("w1-normal-q", { title: "W1-QUEUE-通常未着手", plannedStartAt: at("13:00"), plannedEndAt: at("13:45"), estimateMin: 45 }),
        // 合成フィクスチャ: 未開始のoneTap Block。通常フローでは生じない形だが、
        // 「started除外」ではなく「oneTapフィルタ」で除外されていることを直接判別する(前提W1-6)
        block("w1-onetap-q", { title: "W1-ONETAP-未開始", oneTap: true, plannedStartAt: at("13:00"), plannedEndAt: at("13:30"), estimateMin: 30 })
      ]
    });
    await page.waitForSelector(".today-next-queue", { state: "attached" });
    const w1QueueText = await panelText(".today-next-queue");
    check("通常の未着手Blockは NEXT QUEUE に出る(対照)",
      (w1QueueText || "").includes("W1-QUEUE-通常未着手"), w1QueueText);
    check("oneTap Block は NEXT QUEUE に出ない(oneTapフィルタ。§2.2)",
      !(w1QueueText || "").includes("W1-ONETAP-未開始"), w1QueueText);
    const w1RemFiltered = await page.locator("#todayRemainingEstimate").textContent();
    check("残り見積=45分のみ(oneTapの30分が混入すると75分になる判別値。§2.2)",
      textHasMin(w1RemFiltered, 45) && !textHasMin(w1RemFiltered, 75), w1RemFiltered);

    // ============================================================
    // [38] W1: 計時中のタスク開始(今日ビューnow-start)はワンタップBlockを無確認で自動完了する(裁定#2・§2.3表)
    // ============================================================
    console.log("[38] W1: 計時タブで計時開始→今日ビューの now-start でタスク開始 → oneTap Blockが確認なしで自動完了する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      blocks: [
        block("w1-task1", { title: "W1-TASK1", category: "回復", plannedStartAt: at("12:30"), plannedEndAt: at("13:00"), estimateMin: 30 })
      ]
    });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await w1Tap("学習");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && !b.actualEndAt), KEY);
    await w1GoView("today");
    // NEXT QUEUE 先頭の「繰上げ開始」(既存 now-start 実名)→ 既存宣言モーダル(v87)を経由(前提W1-3)
    await page.locator('.today-next-queue [data-action="now-start"][data-id="w1-task1"]').click();
    await page.waitForSelector('[data-action="declare-skip"]', { state: "attached" });
    check("宣言モーダル時点で確認オーバーレイ #cc-overlay は出ていない(タスク開始方向は無確認。裁定#2)",
      !(await w1OverlayVisible()));
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const t = s.blocks.find((b) => b.id === "w1-task1");
      return !!t && !!t.actualStartAt;
    }, KEY);
    const st38 = await stateNow();
    const ot38 = st38.blocks.find((b) => b.oneTap === true);
    check("タスク開始でワンタップBlockが自動完了する(actualEndAt+completed。前提W1-2/W1-3)",
      !!ot38?.actualEndAt && ot38?.completed === true, JSON.stringify(ot38));
    check("running はタスク(w1-task1)1件のみ(§2.3不変条件・タスク優先)",
      w1Running(st38).length === 1 && w1Running(st38)[0].id === "w1-task1",
      JSON.stringify(w1Running(st38).map((b) => b.id)));
    check("タスク開始後も #cc-overlay は出ていない(確認ゼロでの遷移)", !(await w1OverlayVisible()));

    // ============================================================
    // [38b] W1: タスク完了後は無計時になる(直前のワンタップカテゴリを自動再開しない。§2.3表)
    // ============================================================
    console.log("[38b] W1: タスク完了(complete系)後は無計時。直前のワンタップカテゴリ(学習)を自動再開しない");
    await page.waitForSelector('.today-now-focus [data-action="complete-block-with-actual"]', { state: "attached" });
    await page.locator('.today-now-focus [data-action="complete-block-with-actual"]').first().click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    await page.locator('[data-action="modal-save"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const t = s.blocks.find((b) => b.id === "w1-task1");
      return !!t && t.completed === true && !!t.actualEndAt;
    }, KEY);
    const st38b = await stateNow();
    check("タスク完了後 running が0件(無計時へ)", w1Running(st38b).length === 0,
      JSON.stringify(w1Running(st38b).map((b) => b.id)));
    check("直前のワンタップカテゴリを自動再開しない(oneTap Blockが増えない。再開は明示タップのみ)",
      st38b.blocks.filter((b) => b.oneTap === true).length === 1 && st38b.blocks.length === 2,
      JSON.stringify(st38b.blocks.map((b) => b.id)));
    await w1GoView("timeswitch");
    await page.waitForSelector(".timeswitch", { state: "attached" });
    check("完了後 計時タブに .is-active タイルが無い",
      await page.locator(".timeswitch .is-active").count() === 0);
    check("完了済みタスクのタイルは残る(data-block-id指名。1日複数回記録の入口=裁定#18前段・前提W1-8)",
      await page.locator(w1TaskTileSel("w1-task1")).count() === 1);

    // ============================================================
    // [39] W1: タスク実行中のタイルタップは確認を1回挟む — キャンセルでは何も変わらない(裁定#3/#17)
    // ============================================================
    console.log("[39] W1: タスク実行中のカテゴリタイルタップで #cc-overlay が出る(即開始しない)。キャンセルで何も変わらない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      blocks: [
        block("w1-run", { title: "W1-RUN-実行中タスク", category: "回復", actualStartAt: at("11:00"), plannedStartAt: at("11:00"), plannedEndAt: at("12:30"), estimateMin: 90 })
      ]
    });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    const w1BlocksBeforeCancel = await w1BlocksJSON();
    await w1Tap("学習");
    await w1WaitOverlayShown();
    check("タイルタップで確認オーバーレイ #cc-overlay が表示される(即開始しない。裁定#3)", true);
    check("OKボタン(data-action='timeswitch-confirm-ok')がある(DOM契約)",
      await page.locator('#cc-overlay [data-action="timeswitch-confirm-ok"]').count() >= 1);
    check("キャンセルボタン(data-action='timeswitch-confirm-cancel')がある(DOM契約)",
      await page.locator('#cc-overlay [data-action="timeswitch-confirm-cancel"]').count() >= 1);
    check("オーバーレイ表示中はまだ何も起きていない(oneTap未生成・タスク実行中のまま)",
      (await w1BlocksJSON()) === w1BlocksBeforeCancel);
    await page.locator('#cc-overlay [data-action="timeswitch-confirm-cancel"]').first().click();
    await w1WaitOverlayHidden();
    // イベント処理は同期(dispatch→saveAndRender)。反映猶予にマクロタスクを1周だけ回す([30c]と同手法)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("キャンセルで何も変わらない(blocks不変。§2.3表)", (await w1BlocksJSON()) === w1BlocksBeforeCancel);
    const st39 = await stateNow();
    check("キャンセル後も running はタスク1件のみ",
      w1Running(st39).length === 1 && w1Running(st39)[0].id === "w1-run",
      JSON.stringify(w1Running(st39).map((b) => b.id)));

    // ============================================================
    // [39b] W1: 確認OKで実行中タスクに実績終了(未完了のまま・理由ピッカーなし)+ワンタップ開始(裁定#3)
    // ============================================================
    console.log("[39b] W1: OKで実行中タスクが未完了のまま中断(実績終了・理由ピッカーなし)され、ワンタップが開始する");
    await w1Tap("学習");
    await w1WaitOverlayShown();
    await page.locator('#cc-overlay [data-action="timeswitch-confirm-ok"]').first().click();
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && !b.actualEndAt), KEY);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const st39b = await stateNow();
    const w1RunAfterOk = st39b.blocks.find((b) => b.id === "w1-run");
    check("OKで実行中タスクに実績終了(actualEndAt=現在時刻12:00)が打たれる(前提W1-4)",
      (w1RunAfterOk?.actualEndAt || "").includes("T12:00"), w1RunAfterOk?.actualEndAt);
    check("タスクは未完了のまま中断される(completed=false)",
      w1RunAfterOk?.completed === false, JSON.stringify(w1RunAfterOk));
    check("中断理由ピッカーは開かない(理由は後から既存編集で付与可。裁定#3)",
      await page.locator('[data-action="interrupt-reason"]').count() === 0);
    check("ワンタップBlock(学習)が開始され running は1件のみ(§2.3不変条件)",
      w1Running(st39b).length === 1 && w1Running(st39b)[0].oneTap === true && w1Running(st39b)[0].title === "学習",
      JSON.stringify(w1Running(st39b).map((b) => ({ id: b.id, oneTap: b.oneTap }))));
    check("学習タイルが .is-active になる", await page.locator(`${w1TileSel("学習")}.is-active`).count() === 1);

    // ============================================================
    // [40] W1: タスク実行中の▶TASKカテゴリタイル(.is-task)再タップは何もしない(誤爆防止・§2.3表)
    // ============================================================
    console.log("[40] W1: 実行中タスクのカテゴリタイルが .is-task(▶TASK)表示になり、再タップしても何も起きない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      blocks: [
        block("w1-run2", { title: "W1-RUN2", category: "回復", actualStartAt: at("11:30"), plannedStartAt: at("11:30"), plannedEndAt: at("12:30"), estimateMin: 60 })
      ]
    });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    check("実行中タスクのカテゴリ(回復)のカテゴリタイルが .is-task になる(DOM契約・前提W1-9)",
      await page.locator(`${w1TileSel("回復")}.is-task`).count() === 1);
    check("▶TASKラベルがタイルに出る(ワンタップ由来との視覚区別。§2.2)",
      /TASK/.test((await page.locator(w1TileSel("回復")).first().textContent()) || ""),
      await page.locator(w1TileSel("回復")).first().textContent());
    check("実行中タスクのタスクタイル自体は .is-active になる(前提W1-9)",
      await page.locator(`${w1TaskTileSel("w1-run2")}.is-active`).count() === 1);
    const w1BlocksBefore40 = await w1BlocksJSON();
    await page.locator(`${w1TileSel("回復")}.is-task`).first().click();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("▶TASKタイルの再タップでは確認オーバーレイも出ない", !(await w1OverlayVisible()));
    check("▶TASKタイルの再タップで state が一切変わらない(タスク終了はタスクタイル/NOW FOCUS側に限定)",
      (await w1BlocksJSON()) === w1BlocksBefore40);
    const st40 = await stateNow();
    check("タスクは実行中のまま(running=1・w1-run2)",
      w1Running(st40).length === 1 && w1Running(st40)[0].id === "w1-run2",
      JSON.stringify(w1Running(st40).map((b) => b.id)));

    // ============================================================
    // [41] W1: 孤児処理 — 前日のoneTap runningは前日23:59のactualEndAtが補完される(§2.4)
    // ============================================================
    console.log("[41] W1: 前日のoneTap runningをseed→リロードで前日23:59の実績終了が補完され、通常runningは補完されない(対照)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      blocks: [
        block("w1-orphan", { title: "回復", category: "回復", date: YESTERDAY, oneTap: true, actualStartAt: atOn(YESTERDAY, "22:00"), plannedStartAt: atOn(YESTERDAY, "22:00") }),
        // 対照: 通常タスクの前日runningは既存挙動のまま(補完されない。oneTap限定の決定論処理)
        block("w1-orphan-normal", { title: "W1-通常running", category: "仕事", date: YESTERDAY, actualStartAt: atOn(YESTERDAY, "21:00"), plannedStartAt: atOn(YESTERDAY, "21:00"), plannedEndAt: atOn(YESTERDAY, "22:00") })
      ]
    });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    // リロード時のnormalize結果はメモリ上にあるだけなので、保存契機(setView)を踏んで
    // localStorageへ書き戻させてから突合する([21]と同手法。前提W1-7)
    await w1GoView("tasks");
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const b = s.blocks.find((x) => x.id === "w1-orphan");
      return !!b && !!b.actualEndAt;
    }, KEY);
    const st41 = await stateNow();
    const w1Orphan = st41.blocks.find((b) => b.id === "w1-orphan");
    check("前日oneTap runningに前日23:59のactualEndAtが補完される(§2.4孤児処理)",
      (w1Orphan?.actualEndAt || "").startsWith(`${YESTERDAY}T23:59`), w1Orphan?.actualEndAt);
    check("通常タスクの前日runningは補完されない(oneTap限定。対照)",
      !st41.blocks.find((b) => b.id === "w1-orphan-normal")?.actualEndAt,
      JSON.stringify(st41.blocks.find((b) => b.id === "w1-orphan-normal")));
    check("補完後の running は通常runningの1件だけ(oneTap孤児が解消されている)",
      w1Running(st41).length === 1 && w1Running(st41)[0].id === "w1-orphan-normal",
      JSON.stringify(w1Running(st41).map((b) => b.id)));

    // ============================================================
    // [41b] v187レビューH1回帰: 前日の「通常」runningが残った状態でタイルをタップしても、
    //       前日Blockに当日時刻のactualEndAtが書かれない(過去実績の捏造防止)
    // ============================================================
    console.log("[41b] W1: 前日の通常runningはタイルタップで閉じられない(H1回帰・過去実績の捏造防止)");
    // [41]の続きの状態: w1-orphan-normal(前日・通常・running)が残っている。
    // [41]は保存契機のためtasksビューに居るので、計時タブへ戻ってから操作する
    await w1GoView("timeswitch");
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await w1Tap("開発");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && b.actualStartAt && !b.actualEndAt), KEY);
    const st41b = await stateNow();
    const orphanNormalAfter = st41b.blocks.find((b) => b.id === "w1-orphan-normal");
    check("前日の通常runningに actualEndAt が付かない(当日時刻で閉じない=H1)",
      !orphanNormalAfter?.actualEndAt, JSON.stringify(orphanNormalAfter?.actualEndAt));
    const todayRunning41b = w1Running(st41b).filter((b) => b.date === TODAY);
    check("当日の running は開始した oneTap の1件のみ", todayRunning41b.length === 1 && todayRunning41b[0].oneTap === true,
      JSON.stringify(todayRunning41b.map((b) => b.id)));
    // 後続セクションへの持ち越し防止: 開始したoneTapを停止
    await w1Tap("開発");
    await page.waitForFunction((KEY) =>
      !JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true && b.actualStartAt && !b.actualEndAt), KEY);

    // ============================================================
    // [41c] v187レビューM2: 前日の予定タイル由来(externalRef)runningも23:59補完される
    // ============================================================
    console.log("[41c] W1: 前日のexternalRef runningも前日23:59で孤児補完される(計時タブ由来の同一扱い)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      blocks: [
        // v188: timeswitchStart=計時タブが開始した印。帯取込(未開始/タイムライン開始)の
        //       externalRef Blockは孤児補完の対象外になったため、印付きで「予定タイル開始の止め忘れ」を表す
        { ...block("w1-orphan-event", { title: "昨日の予定計時", category: "", date: YESTERDAY, actualStartAt: atOn(YESTERDAY, "20:00"), plannedStartAt: atOn(YESTERDAY, "20:00"), plannedEndAt: atOn(YESTERDAY, "20:30") }), externalRef: "tt-orphan-1", label: "こーじ", timeswitchStart: true }
      ]
    });
    await page.waitForFunction((KEY) => {
      const b = JSON.parse(localStorage.getItem(KEY)).blocks.find((x) => x.id === "w1-orphan-event");
      return !!b && !!b.actualEndAt;
    }, KEY);
    const orphanEvent = (await stateNow()).blocks.find((b) => b.id === "w1-orphan-event");
    check("前日のexternalRef runningに前日23:59のactualEndAtが補完される(M2)",
      (orphanEvent?.actualEndAt || "").startsWith(`${YESTERDAY}T23:59`), orphanEvent?.actualEndAt);

    // ============================================================
    // [42] W1: ビュー離脱で経過表示のtickerが停止する(おとり方式=[7]/[18]/[20]と同手法)
    // ============================================================
    console.log("[42] W1: 計時タブを離れると経過tickerが停止する(おとり.timeswitch-elapsedが書き換えられない)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({ view: "timeswitch" });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await w1Tap("開発");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true), KEY);
    await page.waitForSelector(".timeswitch .timeswitch-elapsed", { state: "attached" });
    await w1GoView("tasks");
    check("ビュー離脱で .timeswitch がDOMから消える", await page.locator(".timeswitch").count() === 0);
    // 離脱直後のtickが自分でclearIntervalする猶予として1周期分待つ
    // (固定wait例外: ticker周期1秒そのものが仕様(§4)。既存[7]/[18]/[20]と同根拠)
    await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const decoy = document.createElement("section");
      decoy.className = "timeswitch";
      decoy.id = "timeswitchDecoyRoot";
      decoy.innerHTML = '<button class="timeswitch-tile is-active"><span class="timeswitch-elapsed">DECOY-TIMESWITCH</span></button>';
      document.getElementById("main").appendChild(decoy);
    });
    await page.clock.setFixedTime(fixedTime(12, 3, 0));
    await page.waitForTimeout(2300);  // 固定wait例外([7]と同根拠): 負の検証はticker 2周期分の実時間経過が必要
    check("離脱後は経過tickerが停止している(おとり経過表示が2周期経っても書き換えられない。前提W1-5)",
      (await page.evaluate(() => document.querySelector("#timeswitchDecoyRoot .timeswitch-elapsed")?.textContent)) === "DECOY-TIMESWITCH");
    await page.evaluate(() => document.getElementById("timeswitchDecoyRoot")?.remove());

    // ============================================================
    // [43] W1新規: タスクタイル タップ=宣言なし即開始+focusTimerAuto:ONでポモ自動開始(裁定#17/#19)
    // ============================================================
    console.log("[43] W1: タスクタイルのタップで宣言モーダルなしに即実行開始し、focusTimerAuto:ONならポモが自動開始する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      settings: { focusTimerAuto: true },
      extraTasks: [w1TaskFx("w1-task-tt")],
      blocks: [
        block("w1-tt1", { title: "W1-TT1", taskId: "w1-task-tt", category: "回復", plannedStartAt: at("13:00"), plannedEndAt: at("13:30"), estimateMin: 30 })
      ]
    });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await page.waitForSelector(w1TaskTileSel("w1-tt1"), { state: "attached" });
    check("当日の未着手Blockがタスクタイル button.timeswitch-task[data-block-id] として出る(裁定#16・DOM契約)", true);
    await page.locator(w1TaskTileSel("w1-tt1")).first().click();
    await page.waitForFunction((KEY) => {
      const b = JSON.parse(localStorage.getItem(KEY)).blocks.find((x) => x.id === "w1-tt1");
      return !!b && !!b.actualStartAt;
    }, KEY);
    check("宣言モーダルを経由しない(モーダル・declare-skipが出ないまま開始済み。裁定#17の軽量開始)",
      await page.locator(".modal-card").count() === 0
      && await page.locator('[data-action="declare-skip"]').count() === 0);
    check("確認オーバーレイも出ない(無計時→タスク開始は確認ゼロ)", !(await w1OverlayVisible()));
    const st43 = await stateNow();
    const tt43 = st43.blocks.find((b) => b.id === "w1-tt1");
    check("actualStartAt=12:00 で実行開始される(実績開始のみ付与・完了はまだ)",
      (tt43?.actualStartAt || "").includes("T12:00") && !tt43?.actualEndAt && tt43?.completed === false,
      JSON.stringify(tt43));
    check("running が w1-tt1 の1件のみ(§2.3不変条件)",
      w1Running(st43).length === 1 && w1Running(st43)[0].id === "w1-tt1",
      JSON.stringify(w1Running(st43).map((b) => b.id)));
    check("タスクタイルが .is-active になる(前提W1-9)",
      await page.locator(`${w1TaskTileSel("w1-tt1")}.is-active`).count() === 1);
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro.running === true, KEY);
    const pomo43 = (await stateNow()).pomodoro;
    check("focusTimerAuto:ON でポモが自動開始し blockId が w1-tt1 に連結される(既存連動の維持。裁定#19)",
      pomo43.running === true && pomo43.blockId === "w1-tt1", JSON.stringify(pomo43));

    // ============================================================
    // [43b] W1新規: 実行中タスクタイルの再タップ=完了(モーダルなし・無計時へ。裁定#18前段)
    // ============================================================
    console.log("[43b] W1: 実行中タスクタイルの再タップで完了(actualEndAt+completed)し、無計時へ戻る");
    await page.clock.setFixedTime(fixedTime(12, 30, 0));
    await page.locator(w1TaskTileSel("w1-tt1")).first().click();
    await page.waitForFunction((KEY) => {
      const b = JSON.parse(localStorage.getItem(KEY)).blocks.find((x) => x.id === "w1-tt1");
      return !!b && b.completed === true && !!b.actualEndAt;
    }, KEY);
    const st43b = await stateNow();
    const tt43b = st43b.blocks.find((b) => b.id === "w1-tt1");
    check("再タップで actualEndAt=12:30+completed:true が直接打たれる(前提W1-10)",
      (tt43b?.actualEndAt || "").includes("T12:30") && tt43b?.completed === true, JSON.stringify(tt43b));
    check("実績登録モーダルは開かない(さくさく特化。前提W1-10)",
      await page.locator(".modal-card").count() === 0);
    check("無計時へ戻る(running 0件・.is-active 無し)",
      w1Running(st43b).length === 0 && await page.locator(".timeswitch .is-active").count() === 0);
    check("完了でBlock数は増えない(1件のまま)",
      st43b.blocks.length === 1, JSON.stringify(st43b.blocks.map((b) => b.id)));

    // ============================================================
    // [43c] W1新規: 完了済みタスクタイルは残り、再タップで同taskId/title/categoryの新Blockが
    //   生成され開始する(1日複数回記録。裁定#18)
    // ============================================================
    console.log("[43c] W1: 完了済みタスクタイルの再タップで新Block(同taskId・実績のみ)が生成され開始する(裁定#18)");
    check("完了後もタスクタイルが残る(裁定#18)",
      await page.locator(w1TaskTileSel("w1-tt1")).count() === 1);
    await page.clock.setFixedTime(fixedTime(13, 0, 0));
    await page.locator(w1TaskTileSel("w1-tt1")).first().click();
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.id !== "w1-tt1" && b.actualStartAt && !b.actualEndAt), KEY);
    const st43c = await stateNow();
    const tt43cOrig = st43c.blocks.find((b) => b.id === "w1-tt1");
    const tt43cNew = st43c.blocks.find((b) => b.id !== "w1-tt1");
    check("blocks数が+1(2件)になる(新Block生成)",
      st43c.blocks.length === 2, JSON.stringify(st43c.blocks.map((b) => b.id)));
    check("元Blockは完了のまま変わらない(actualEndAt=12:30・completed維持。裁定#18)",
      tt43cOrig?.completed === true && (tt43cOrig?.actualEndAt || "").includes("T12:30"), JSON.stringify(tt43cOrig));
    check("新Blockが同taskId/title/categoryを引き継ぐ(裁定#18)",
      tt43cNew?.taskId === "w1-task-tt" && tt43cNew?.title === "W1-TT1" && tt43cNew?.category === "回復",
      JSON.stringify(tt43cNew));
    check("新Blockが actualStartAt=13:00 で開始され running は新Blockの1件のみ",
      (tt43cNew?.actualStartAt || "").includes("T13:00") && !tt43cNew?.actualEndAt
      && w1Running(st43c).length === 1 && w1Running(st43c)[0].id === tt43cNew?.id,
      JSON.stringify(w1Running(st43c).map((b) => b.id)));
    check("新Blockは当日日付になる", tt43cNew?.date === TODAY, tt43cNew?.date);

    // ============================================================
    // [43d] W1新規: focusTimerAuto:OFF ではタスクタイル開始でポモが自動開始されない(裁定#19の対照)
    // ============================================================
    console.log("[43d] W1: focusTimerAuto:OFF ではタスクタイル開始でポモが始まらない(タスク自体は開始される)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeswitch",
      settings: { focusTimerAuto: false },
      extraTasks: [w1TaskFx("w1-task-off")],
      blocks: [
        block("w1-off1", { title: "W1-OFF1", taskId: "w1-task-off", category: "学習", plannedStartAt: at("13:00"), plannedEndAt: at("13:30"), estimateMin: 30 })
      ]
    });
    await page.waitForSelector(w1TaskTileSel("w1-off1"), { state: "attached" });
    await page.locator(w1TaskTileSel("w1-off1")).first().click();
    await page.waitForFunction((KEY) => {
      const b = JSON.parse(localStorage.getItem(KEY)).blocks.find((x) => x.id === "w1-off1");
      return !!b && !!b.actualStartAt;
    }, KEY);
    // 開始の保存(イベント同期処理)後にマクロタスクを1周回してから負の判定([30c]と同手法)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const st43d = await stateNow();
    check("focusTimerAuto:OFF ではポモが開始されない(裁定#19)",
      st43d.pomodoro.running === false, JSON.stringify(st43d.pomodoro));
    check("タスク自体は開始される(running=w1-off1)",
      w1Running(st43d).length === 1 && w1Running(st43d)[0].id === "w1-off1",
      JSON.stringify(w1Running(st43d).map((b) => b.id)));

    // ============================================================
    // [44] W1新規: カテゴリ計時は focusTimerAuto:ON でもポモ非連動(純粋計時。裁定#19の対照)
    // ============================================================
    console.log("[44] W1: カテゴリタイル開始は focusTimerAuto:ON でもポモが自動開始されない(純粋計時)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({ view: "timeswitch", settings: { focusTimerAuto: true } });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await w1Tap("学習");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.oneTap === true), KEY);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const st44 = await stateNow();
    check("focusTimerAuto:ON でもカテゴリタイル開始ではポモが開始されない(裁定#19)",
      st44.pomodoro.running === false, JSON.stringify(st44.pomodoro));
    check("oneTap計時自体は開始されている(running=1・oneTap)",
      w1Running(st44).length === 1 && w1Running(st44)[0].oneTap === true,
      JSON.stringify(w1Running(st44).map((b) => ({ id: b.id, oneTap: b.oneTap }))));

    // ============================================================
    // [45] W1新規: 予定タイル — schedule-inbox.json の当日こーじ分のみタイル化。
    //   タップでBlock化(externalRef/label自動・category空)+即開始・二重Block化なし(裁定#16/#17・§3.4)
    // ============================================================
    console.log("[45] W1: 予定タイルは当日こーじのみ。タップでBlock化+即開始し、同一externalIdの二重Block化は起きない");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({ view: "timeswitch", settings: { focusTimerAuto: true } });
    await page.waitForSelector(w1EventTileSel("tt-koji-1"), { state: "attached" });
    check("当日のこーじ予定が button.timeswitch-event[data-external-id] としてタイル化される(DOM契約・前提W1-11)", true);
    check("こーじ以外のラベル(翠)はタイル化されない(裁定#16)",
      await page.locator(w1EventTileSel("tt-midori-1")).count() === 0);
    check("当日以外(明日のこーじ予定)はタイル化されない(裁定#16: 当日予定タイル)",
      await page.locator(w1EventTileSel("tt-koji-tomorrow")).count() === 0);
    await page.locator(w1EventTileSel("tt-koji-1")).first().click();
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.externalRef === "tt-koji-1"), KEY);
    const st45 = await stateNow();
    const ev45 = st45.blocks.find((b) => b.externalRef === "tt-koji-1");
    check("タップでBlock化される(externalRef=externalId 自動。§3.4重複解決の鍵)",
      !!ev45, JSON.stringify(st45.blocks.map((b) => b.id)));
    check("label が自動セットされる(裁定#9/#17)", ev45?.label === "こーじ", ev45?.label);
    check("category は空のまま(カテゴリ付与は後から編集タブ。裁定#17)", ev45?.category === "", ev45?.category);
    check("title=予定タイトル・date=当日でBlock化される(前提W1-12)",
      ev45?.title === "TT-こーじ-歯医者" && ev45?.date === TODAY,
      JSON.stringify({ title: ev45?.title, date: ev45?.date }));
    check("actualStartAt=12:00 で即実行開始され running は1件のみ(裁定#17)",
      (ev45?.actualStartAt || "").includes("T12:00") && !ev45?.actualEndAt
      && w1Running(st45).length === 1 && w1Running(st45)[0].id === ev45?.id,
      JSON.stringify(w1Running(st45).map((b) => b.id)));
    check("予定タイルが .is-active になる(前提W1-9)",
      await page.locator(`${w1EventTileSel("tt-koji-1")}.is-active`).count() === 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("予定タイル開始ではポモが自動開始されない(focusTimerAuto:ONでも非連動。裁定#19)",
      (await stateNow()).pomodoro.running === false);
    // 二重Block化なし: 同じタイルを再タップしても externalRef=tt-koji-1 のBlockは増えない
    // (再タップの停止/無視の別は契約にしない。前提W1-12。予定計時はタスク実行中扱いではないので確認も出ない)
    const w1EvBlocksBefore = st45.blocks.length;
    await page.locator(w1EventTileSel("tt-koji-1")).first().click();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const st45b = await stateNow();
    check("再タップで確認オーバーレイは出ない(予定計時はタスク実行中扱いではない)", !(await w1OverlayVisible()));
    check("同一externalIdの二重Block化が起きない(externalRef=tt-koji-1 のBlockは1件のまま)",
      st45b.blocks.filter((b) => b.externalRef === "tt-koji-1").length === 1,
      JSON.stringify(st45b.blocks.map((b) => ({ id: b.id, externalRef: b.externalRef }))));
    check("Block総数も増えない(再タップでの再生成なし。§3.4)",
      st45b.blocks.length === w1EvBlocksBefore, `${w1EvBlocksBefore}→${st45b.blocks.length}`);

    // ============================================================
    // [45b] W1新規: schedule-inbox.json 404 でも計時タブは通常描画される(F8式フェイルソフト)
    // ============================================================
    console.log("[45b] W1: schedule-inbox 404 では予定タイル群だけが出ず、カテゴリタイル・タブ本体は無傷");
    const failuresBefore45b = failures;  // この区間のpageerror検出用([13]と同じ方式)
    scheduleInboxFx.status = 404;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    const w1Resp404 = page.waitForResponse((r) => r.url().includes("schedule-inbox.json"));
    await seedW1({ view: "timeswitch" });
    await w1Resp404;
    await page.waitForSelector(".timeswitch", { state: "attached" });
    // 404応答後の描画反映猶予にマクロタスクを回してから不在を断定する([30c]と同手法)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("404では予定タイルが1枚も出ない(ファイル不在で一切エラーなし。§3.4)",
      await page.locator(".timeswitch button.timeswitch-event").count() === 0);
    check("404でもカテゴリタイル群は通常描画される(フェイルソフト)",
      await page.locator(".timeswitch button.timeswitch-tile").count() >= 1);
    check("[45b]区間の描画で pageerror が発生しない", failures === failuresBefore45b);
    scheduleInboxFx.status = 200;

    // ============================================================
    // [45c] v187レビューM1/L7: 壊れJSONは無傷スキップ・鮮度26時間超は「古い」警告付きでタイル表示
    // ============================================================
    console.log("[45c] W1: 壊れJSONでpageerrorゼロ、鮮度26時間超は .timeswitch-stale 警告付きでタイルは出る");
    const failuresBefore45c = failures;
    scheduleInboxFx.body = "{broken json";
    await seedW1({ view: "timeswitch" });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    check("壊れJSONでは予定タイルが出ない(例外を投げず無傷スキップ)",
      await page.locator(".timeswitch button.timeswitch-event").count() === 0);
    check("壊れJSON区間で pageerror が発生しない", failures === failuresBefore45c);
    // 鮮度超過(27時間前のgeneratedAt)
    scheduleInboxFx.body = null;
    scheduleInboxFx.staleHours = 27;
    await seedW1({ view: "timeswitch" });
    await page.waitForSelector(".timeswitch", { state: "attached" });
    await page.waitForSelector(".timeswitch .timeswitch-stale", { state: "attached" });
    check("鮮度26時間超では .timeswitch-stale の警告行が出る(『予定なし』と区別できる。§3.5)",
      /古い|バッチ/.test((await page.locator(".timeswitch .timeswitch-stale").textContent()) || ""));
    check("鮮度超過でも予定タイル自体は表示される(データは見える)",
      await page.locator(".timeswitch button.timeswitch-event").count() >= 1);
    scheduleInboxFx.body = null;
    scheduleInboxFx.staleHours = 0;

    // ============================================================
    // ==== ここから W3(TT帯=外部予定帯 v188)追記セクション [46]〜[48] ====
    // 設計の正: workbench/out/2026-07-29-today-cockpit-ideas/design-onetap-timetree.md
    //   §3.4(帯の仕様・ファイル契約・重複解決・取込済表示)/ §3.6(block.label)/
    //   §5裁定表 #10(帯=こーじのみ。予定/翠/デートは非表示)#12(終日は帯に表示しない)
    //   #13(帯は今日FLIGHT PLAN+時間ビューの両方・読み取り専用・重複はレーン分離)
    //   #14(Block化はeditor経由でカテゴリ選択=帯タップ→Block生成(label/externalRef自動・
    //   category空)→既存Block編集モーダル。即開始はしない=計時タブとの役割分担)
    // DOM契約(実装側と共有):
    //   今日ビューFLIGHT PLAN内の帯 .today-flight-tt[data-external-id](既存Blockレーンと別レーン)/
    //   時間ビューの帯 .timeline-tt[data-external-id](同じ意味論)/ 取込済の帯 .is-imported
    // 実装(未着手)より先に仕様から書いた。前提が食い違ったらテストを弱めず実装と突合して直す:
    //   前提W3-1: schedule-inbox.json の取得経路は W1 と同じ Contents API
    //            (パス末尾 /contents/taskchute/schedule-inbox.json。前提W1-11)。Playwrightの
    //            後発 page.route 優先仕様で、この区間からは終日予定入りの W3 フィクスチャに差し替える
    //   前提W3-2: 帯タップ(未取込)の Block 生成はタップ(イベント)時点で saveState され、
    //            続けて既存 Block 編集モーダル(.modal-card。既存カテゴリ select を含む)が開く。
    //            実行開始はしない(actualStartAt を打たない。裁定#14)
    //   前提W3-3: 取込済(.is-imported)の判定は block.externalRef === externalId の存在(§3.4
    //            重複解決)。取込済帯の再タップの詳細挙動(既存Blockの編集を開く/無視する)は
    //            契約にしない(「Blockが増えない」ことだけを検証する。前提W1-12と同思想)
    //   前提W3-4: 帯からのBlockの planned時刻・estimateMin・oneTapフラグの値は契約にしない。
    //            検証は externalRef / label / category空 / title / date と「実行開始されない」に絞る
    //   前提W3-5: 「別レーン」の検証はDOM構造(帯が .today-flight-block 要素を兼ねない・内包され
    //            ない)で行う(見た目のレーン座標は契約にしない)
    // ============================================================

    // W3フィクスチャ: こーじ当日(時間帯)・翠当日・こーじ終日allDay・こーじ明日(観点1の4種)。
    // W1のscheduleInboxFxルートより後に登録するのでこちらが優先される(前提W3-1)。
    const w3InboxFx = { status: 200 };
    const W3_SCHEDULE_INBOX = {
      generatedAt: `${TODAY}T07:00:00`,  // 当日朝生成=鮮度内(T区切り秒あり。FORMAT_CONTRACT整合)
      events: [
        { externalId: "tt3-koji-day", title: "TT3-こーじ-通院", date: TODAY, startAt: "16:00", endAt: "17:00", allDay: false, label: "こーじ", calendarName: "家族" },
        { externalId: "tt3-midori-day", title: "TT3-翠-習い事", date: TODAY, startAt: "15:00", endAt: "16:00", allDay: false, label: "翠", calendarName: "家族" },
        { externalId: "tt3-koji-allday", title: "TT3-こーじ-終日", date: TODAY, startAt: "00:00", endAt: "00:00", allDay: true, label: "こーじ", calendarName: "家族" },
        { externalId: "tt3-koji-tomorrow", title: "TT3-こーじ-明日", date: TOMORROW, startAt: "10:00", endAt: "11:00", allDay: false, label: "こーじ", calendarName: "家族" }
      ]
    };
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/contents/taskchute/schedule-inbox.json")) {
        if (w3InboxFx.status !== 200) return route.fulfill({ status: w3InboxFx.status, body: "not found" });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(W3_SCHEDULE_INBOX) });
      }
      return route.fallback();
    });
    const w3TodayTtSel = (externalId) => `.today-flight-tt[data-external-id="${externalId}"]`;
    const w3TimelineTtSel = (externalId) => `.timeline-tt[data-external-id="${externalId}"]`;

    // ============================================================
    // [46] W3: 今日ビューFLIGHT PLANのTT帯 — こーじ当日の時間帯予定のみ帯表示
    //   (翠×=裁定#10・終日×=裁定#12・明日×。既存Blockレーンとの共存とレーン分離=裁定#13)
    // ============================================================
    console.log("[46] W3: FLIGHT PLANにTT帯が出る(こーじ当日の時間帯予定のみ)。既存Blockレーンと別レーンで共存する");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "today",
      blocks: [
        block("w3-plan", { title: "W3-通常予定Block", plannedStartAt: at("10:00"), plannedEndAt: at("11:00"), estimateMin: 60 })
      ]
    });
    await page.waitForSelector(w3TodayTtSel("tt3-koji-day"), { state: "attached" });
    check("こーじ当日(時間帯あり)の予定が .today-flight-tt[data-external-id] として帯表示される(DOM契約・裁定#13)", true);
    check("TT帯はFLIGHT PLANパネル内に描画される(帯の置き場=今日FLIGHT PLAN。裁定#13)",
      await page.locator(`.today-flight-plan ${w3TodayTtSel("tt3-koji-day")}`).count() === 1);
    check("翠ラベルの当日予定は帯に出ない(タイムライン系はこーじのみ。裁定#10)",
      await page.locator(w3TodayTtSel("tt3-midori-day")).count() === 0);
    check("こーじの終日予定(allDay)は帯に出ない(カレンダービューでのみ見える。裁定#12)",
      await page.locator(w3TodayTtSel("tt3-koji-allday")).count() === 0);
    check("こーじの明日の予定は今日の帯に出ない",
      await page.locator(w3TodayTtSel("tt3-koji-tomorrow")).count() === 0);
    check("TT帯の総数が1本(こーじ当日の時間帯予定のみが母集合)",
      await page.locator(".today-flight-tt").count() === 1);
    check("未取込の帯に .is-imported が付いていない(取込前の初期表示)",
      await page.locator(".today-flight-tt.is-imported").count() === 0);
    check("既存BlockレーンのBlock帯(.today-flight-block)と共存して描画される",
      await page.locator('.today-flight-block[data-id="w3-plan"]').count() === 1);
    check("TT帯は既存Blockレーンの要素と別物(=別レーン。.today-flight-block を兼ねず内包もされない。前提W3-5)",
      await page.evaluate(() => {
        const el = document.querySelector('.today-flight-tt[data-external-id="tt3-koji-day"]');
        return !!el && !el.classList.contains("today-flight-block") && !el.closest(".today-flight-block");
      }));

    // ============================================================
    // [46b] W3: 帯タップ(未取込)= Block生成(externalRef/label自動・category空)+編集モーダル。
    //   実行開始はしない。再タップで二重生成なし+.is-imported 表示(裁定#14・§3.4)
    // ============================================================
    console.log("[46b] W3: 帯タップでBlock生成+編集モーダルが開く(即開始なし)。再タップは二重生成せず取込済表示になる");
    const w3BlocksBeforeTap = (await stateNow()).blocks.length;
    await page.locator(w3TodayTtSel("tt3-koji-day")).first().click();
    // タップ(イベント)時点の saveState を localStorage の変化で待つ(前提W3-2)
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.externalRef === "tt3-koji-day"), KEY);
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("タップで既存Block編集モーダルが開く(裁定#14: F2 TIME COMBと同パターン・新規UIなし)", true);
    check("編集モーダル内に既存カテゴリselectがある(カテゴリはモーダルのselectで選ぶ。裁定#14)",
      await page.locator(".modal-card select").count() >= 1);
    const st46 = await stateNow();
    const w3Ev = st46.blocks.find((b) => b.externalRef === "tt3-koji-day");
    check("externalRef=externalId が自動記録される(§3.4重複解決の鍵)",
      !!w3Ev, JSON.stringify(st46.blocks.map((b) => b.id)));
    check("label='こーじ' が自動セットされる(§3.6・裁定#9)", w3Ev?.label === "こーじ", w3Ev?.label);
    check("category は空のまま(裁定#14)", w3Ev?.category === "", w3Ev?.category);
    check("title=予定タイトル・date=当日でBlock化される",
      w3Ev?.title === "TT3-こーじ-通院" && w3Ev?.date === TODAY,
      JSON.stringify({ title: w3Ev?.title, date: w3Ev?.date }));
    check("実行開始はされない(actualStartAt無し・runningゼロ=計時タブとの役割分担。前提W3-2)",
      !w3Ev?.actualStartAt && w3Ev?.completed === false && w1Running(st46).length === 0,
      JSON.stringify({ actualStartAt: w3Ev?.actualStartAt, running: w1Running(st46).map((b) => b.id) }));
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });
    await page.waitForSelector(`${w3TodayTtSel("tt3-koji-day")}.is-imported`, { state: "attached" });
    check("取込済の帯に .is-imported が付く(§3.4取込済表示)", true);
    const w3BlocksAfterImport = (await stateNow()).blocks.length;
    check("取込でBlockが1件だけ増える(通常Block1+取込1=2件)",
      w3BlocksAfterImport === w3BlocksBeforeTap + 1, `${w3BlocksBeforeTap}→${w3BlocksAfterImport}`);
    // 再タップ: Block再生成しない(取込済帯の詳細挙動は契約にしない。モーダルが開いたら閉じるだけ。前提W3-3)
    await page.locator(w3TodayTtSel("tt3-koji-day")).first().click();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    if (await page.locator(".modal-card").count()) {
      await page.locator('.modal-card [data-action="modal-close"]').first().click();
      await page.waitForSelector(".modal-card", { state: "detached" });
    }
    const st46b = await stateNow();
    check("同一externalIdの再タップで二重生成が起きない(externalRef=tt3-koji-day のBlockは1件のまま。§3.4)",
      st46b.blocks.filter((b) => b.externalRef === "tt3-koji-day").length === 1,
      JSON.stringify(st46b.blocks.map((b) => ({ id: b.id, externalRef: b.externalRef }))));
    check("Block総数も増えない(再タップでの再生成なし)",
      st46b.blocks.length === w3BlocksAfterImport, `${w3BlocksAfterImport}→${st46b.blocks.length}`);

    // ============================================================
    // [47] W3: 時間ビューのTT帯 — .timeline-tt がこーじ当日のみ出て、既存の絶対配置Blockカードと
    //   共存する(pageerrorなし)。タップの意味論は今日ビューの帯と同じ(裁定#13)
    // ============================================================
    console.log("[47] W3: 時間ビューに .timeline-tt が出る(こーじのみ)。既存タイムラインBlockカードと共存し、タップの意味論も同じ");
    const failuresBefore47 = failures;  // この区間のpageerror検出用([13]と同じ方式)
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedW1({
      view: "timeline",
      blocks: [
        block("w3-tl", { title: "W3-TL-通常Block", plannedStartAt: at("09:00"), plannedEndAt: at("10:00"), estimateMin: 60 })
      ]
    });
    // timelineModeは前セクションから持ち越される(seedW1は触らない)ため、
    // 帯が出る「予定」モードへ明示的に切り替える(帯はplannedモード限定=§3.4のplanned重畳)
    await page.waitForSelector('[data-action="timeline-mode"][data-mode="planned"]', { state: "attached" });
    await page.locator('[data-action="timeline-mode"][data-mode="planned"]').first().click();
    await page.waitForSelector(w3TimelineTtSel("tt3-koji-day"), { state: "attached" });
    check("時間ビューにこーじ当日のTT帯 .timeline-tt[data-external-id] が出る(DOM契約・裁定#13)", true);
    check("時間ビューのTT帯も1本のみ(翠・終日・明日は出ない。裁定#10/#12)",
      await page.locator(".timeline-tt").count() === 1
      && await page.locator(w3TimelineTtSel("tt3-midori-day")).count() === 0
      && await page.locator(w3TimelineTtSel("tt3-koji-allday")).count() === 0
      && await page.locator(w3TimelineTtSel("tt3-koji-tomorrow")).count() === 0);
    check("既存タイムラインの絶対配置Blockカード(.timeline-card)と共存して描画される",
      await page.locator('.timeline-card[data-id="w3-tl"]').count() === 1);
    // 同じ意味論: タップ→Block生成(externalRef/label自動・category空)+編集モーダル(即開始なし)→取込済表示
    await page.locator(w3TimelineTtSel("tt3-koji-day")).first().click();
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).blocks.some((b) => b.externalRef === "tt3-koji-day"), KEY);
    await page.waitForSelector(".modal-card", { state: "attached" });
    const st47 = await stateNow();
    const w3TlEv = st47.blocks.find((b) => b.externalRef === "tt3-koji-day");
    check("時間ビューの帯タップでも externalRef/label自動・category空でBlock化される(同じ意味論)",
      !!w3TlEv && w3TlEv.label === "こーじ" && w3TlEv.category === "", JSON.stringify(w3TlEv));
    check("時間ビューの帯タップでも実行開始はされない(actualStartAt無し・runningゼロ)",
      !w3TlEv?.actualStartAt && w1Running(st47).length === 0,
      JSON.stringify(w1Running(st47).map((b) => b.id)));
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });
    await page.waitForSelector(`${w3TimelineTtSel("tt3-koji-day")}.is-imported`, { state: "attached" });
    check("時間ビューの帯にも取込済 .is-imported が付く(同じ意味論)", true);
    check("[47]区間の描画・操作で pageerror が発生しない", failures === failuresBefore47);

    // ============================================================
    // [48] W3: schedule-inbox.json 404 でも帯は今日ビュー・時間ビューとも出ず、
    //   既存描画は無傷(ファイル不在で一切エラーなし=F8式フェイルソフト。§3.4)
    // ============================================================
    console.log("[48] W3: schedule-inbox 404 ではTT帯が出ず、FLIGHT PLAN・時間ビューの既存描画は無傷(pageerrorゼロ)");
    const failuresBefore48 = failures;  // この区間のpageerror検出用
    w3InboxFx.status = 404;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    const w3Resp404 = page.waitForResponse((r) => r.url().includes("schedule-inbox.json"));
    await seedW1({
      view: "today",
      blocks: [
        block("w3-404", { title: "W3-404-通常Block", plannedStartAt: at("10:00"), plannedEndAt: at("11:00"), estimateMin: 60 })
      ]
    });
    await w3Resp404;
    await page.waitForSelector(".today-flight-plan", { state: "attached" });
    // 404応答後の描画反映猶予にマクロタスクを回してから不在を断定する([30c]/[45b]と同手法)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    check("404では今日ビューにTT帯が1本も出ない(§3.4: ファイル不在で一切エラーなし)",
      await page.locator(".today-flight-tt").count() === 0);
    check("404でもFLIGHT PLANの既存Blockレーンは通常描画される(フェイルソフト)",
      await page.locator('.today-flight-block[data-id="w3-404"]').count() === 1);
    await w1GoView("timeline");
    await page.waitForSelector('.timeline-card[data-id="w3-404"]', { state: "attached" });
    check("404では時間ビューにもTT帯が出ず、既存Blockカードは通常描画される",
      await page.locator(".timeline-tt").count() === 0
      && await page.locator('.timeline-card[data-id="w3-404"]').count() === 1);
    check("[48]区間の描画で pageerror が発生しない", failures === failuresBefore48);
    w3InboxFx.status = 200;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
