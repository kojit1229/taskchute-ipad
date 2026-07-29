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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
