// tests/today-core.test.js — 今日TOWERビューと共有ANNEX機能の仕様ベースE2Eスイート。
// cockpit専用5パネルはv221で削除。TOWERの描画・ブロック実行・AI/テーマ契約とGATEを検証する。
// 日時はISO文字列を組み立て、文字列をnew Dateへ渡さない。
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
  // v217: 12週サイクル削除でB3セクションと共に消えた共有日付部品のうち、後続セクションが
  // 使い続けるものだけを外側スコープへ復元(ISO文字列リテラルの組み立て。new Date("文字列")不使用)
  const dateISOof = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const daysAgoISO = (n) => dateISOof(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - n));
  const atOn = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;
  const YESTERDAY = daysAgoISO(1);
  // 分数nの表示として許容する形式群(旧B3-1前提。B3削除後もF系セクションが使用)
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
    await seed({ view: "timeline" });
    check("currentView='timeline' がそのまま復元される(today導入で既存復元が壊れない)",
      (await currentDataView()) === "timeline", await currentDataView());

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
    check("遷移後にTOWERが存在する", await page.locator(".today-tower").count() === 1);
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
    // [6] #towerClock が毎秒tickし、固定時刻の前進へ追随する
    // ============================================================
    console.log("[6] #towerClock が tick で進む(page.clockの固定時刻を前進させ、reload・クリック無しで表示が追随する)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ view: "today" });
    await page.waitForFunction(() => (document.getElementById("towerClock")?.textContent || "").includes("12:00"));
    check("固定時刻12:00:00で時計に '12:00' が表示される", true);
    // 固定時刻を12:01:05へ前進(実タイマーは動き続けるため、1秒周期のtickerが新時刻を拾って書き換える)
    await page.clock.setFixedTime(fixedTime(12, 1, 5));
    await page.waitForFunction(() => (document.getElementById("towerClock")?.textContent || "").includes("12:01"));
    check("固定時刻の前進(+65秒)が reload なしで時計表示へ反映される(tickerが生きている証拠)", true);

    // ============================================================
    // [7] ビューを離れると ticker が停止する + 再入場で再開する
    // ============================================================
    console.log("[7] today を離れると ticker が停止し(おとり#towerClockが書き換えられない)、再入場で再開する");
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="tasks"]').click();
    await waitView("tasks");
    check("ビュー離脱で #towerClock がDOMから消える(時計はtodayビュー内のみ)",
      await page.locator("#towerClock").count() === 0);
    // 離脱直後のtickが自分でclearIntervalする猶予として、まずticker 1周期分を実時間で待つ
    // (固定wait例外: ticker周期1秒そのものが仕様(§4)。この待機と次の待機のみ)
    await page.waitForTimeout(1300);
    // おとり: 同idの要素を注入し、tickerが生きていれば毎秒の再取得(getElementById)で
    // 書き換えられてしまうはず。2周期分待っても書き換わらなければ停止している。
    await page.evaluate(() => {
      const decoy = document.createElement("span");
      decoy.id = "towerClock";
      decoy.textContent = "DECOY-v-today";
      document.getElementById("main").appendChild(decoy);
    });
    await page.clock.setFixedTime(fixedTime(12, 3, 0));
    await page.waitForTimeout(2300);  // 固定wait例外(上記コメント参照): 負の検証はticker 2周期分の実時間経過が必要
    check("離脱後は ticker が停止している(おとり#towerClockが2周期経っても書き換えられない)",
      (await page.evaluate(() => document.getElementById("towerClock")?.textContent)) === "DECOY-v-today");
    await page.evaluate(() => document.getElementById("towerClock")?.remove());
    // 再入場: tickerが再開し、新しい固定時刻(12:03)が表示される
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').click();
    await waitView("today");
    await page.waitForFunction(() => (document.getElementById("towerClock")?.textContent || "").includes("12:03"));
    check("再入場で ticker が再開し現在の固定時刻(12:03)を表示する", true);
    // v221: cockpit専用5パネルの描画検証は実装削除に合わせて撤去。
    // TOWERのNOW LANDING/ARRIVALS/GATEはtower-coreで継続検証する。
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
    check("darkテーマでも today TOWERが描画される", await page.locator(".today-tower").count() === 1);

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
    await page.waitForFunction(() => (document.getElementById("towerClock")?.textContent || "").includes("12:01"));
    check("highlights未取得(404)では .today-kindle が存在しない(§4-6: 未取得/空でパネル非表示)",
      await page.locator(".today-kindle").count() === 0);
    check("404でもTOWER本体は通常描画される(フェイルソフト)",
      await page.locator(".today-tower").count() === 1);
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
    check("フォールバック後もTOWERが描画される", await page.locator(".today-tower").count() === 1);
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
    console.log("[28] P11: cockpitテーマで today/home/timeline/settings を巡回し、pageerrorゼロ・#main非空");
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
    for (const view of ["today", "home", "timeline", "settings"]) {
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
    // ==== ここから B5(F1/F2/F5)追記セクション [30]〜[34] ====
    // 設計の正: ../taskchute-notes/designs/v169-today-cockpit.md §12 の F1/F2/F5 行。
    // 現物調査: workbench/out/2026-07-29-today-cockpit-impl/b5-survey.md(部品実名の正)。
    // DOM契約(実装側と共有済み):
    //   F1: 既存 #blockTitle(renderTasksのform-strip) / F2: .drift-panel / .time-comb /
    //   .time-comb-gap[data-start][data-end] / F5: .wish-ripeness / .wish-ripeness-bar
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
    //   前提B5-7: F5の熟成度は .wish-ripeness-bar のインラインstyle width%(30日=50%・90日=100%
    //            の固定写像・90日以降は100%で頭打ち)。45日は50〜100%の中間
    //            (30〜90日を線形補間するなら 50 + (45-30)×(50/60) = 62.5%)
    // ============================================================

    // B5用seed: 既存seed()/seedB2()/seedB3()と同じ流儀に selectedDate を足した拡張
    // (既存関数は変更禁止のため別名で追加。pomodoro/zeroThinkingは前セクションの持ち越し防止で毎回リセット)
    async function seedB5({ blocks = [], view = "tasks", settings = {}, selectedDate = TODAY, projects = null, tasks = null } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, selectedDate, projects, tasks }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = selectedDate;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
        s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [] };
        s.pomodoro = { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        if (projects) s.projects = projects;
        if (tasks) s.tasks = tasks;
        Object.assign(s.settings, settings);
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, view, settings, selectedDate, projects, tasks });
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
    //     wishRipe: [{ taskId, title, reason }],   ← 参照は projectId でなく taskId(実体はTask。F5と同じ)
    //     zeroPattern: { body } }
    // DOM契約(実装側と共有済み):
    //   パネルroot .ai-insights[data-insight="wish|zero"] /
    //   鮮度 .ai-insights-freshness(26時間超で .is-stale +「古い」を含む文言)
    // 実装(別担当が並行作業中)より先に仕様から書いた。前提が実装と食い違った場合は
    // テストを弱めるのではなく、前提の側を実装と突合して直すこと:
    //   前提B7-1: ai-insights.json は kindle highlights と同じ Contents API 経路
    //            (パス末尾 /contents/taskchute/ai-insights.json)で取得され、hydrateStaticMarkdown
    //            相乗せの energy-curve型TTL30分方式により起動(reload)ごとに毎回fetchされる
    //            (キャッシュはメモリのみ。同一セッション内のビュー往復では再fetchしない)。
    //            同名の別スキーマとはパスで区別する(§12 F8「同名紛らわしいが別物」。
    //            routeのendsWith判定が別パスに一致しないことを維持する)
    //   前提B7-2: パネルは wish / zero 各ビューのrender内で描画され、fetch完了時は
    //            hydrateStaticMarkdown 末尾の再描画で開いたままのビューへも反映される(§12 F8
    //            「再描画view一覧にwishを追加」)。検証は fetch応答後のDOM出現
    //            (waitForSelector)/不在(応答待ち+マクロタスク2周。[45b]と同手法)で行う
    //   前提B7-3: 鮮度は localDateTimeToMs(generatedAt) 基準で、26時間超のとき .ai-insights-freshness に
    //            .is-stale が付き「古い」を含む文言になる。鮮度内では .is-stale は付かない。
    //            鮮度要素の置き場所(パネル毎/共通1箇所)と個数は契約にしない(全該当要素の走査で読む)
    //   前提B7-4: スキーマ不一致フィールドは個別に無視される(§12 F8ファイル契約「1フィールド壊れて
    //            全滅させない」)。壊れたフィールドのパネルだけが出ず、正常フィールドのパネルは通常表示
    //   前提B7-5: F8は表示のみ(提案の適用は手動・アプリ内AI呼び出しなし)。正常表示しても
    //            state.tasks/blocks/settings は変化しない。突合は保存契機(setView)を踏んで
    //            localStorageへ書き戻させてから行う([34c]と同じ手順。初回normalize補完分を比較から除く)
    //   前提B7-6: 各パネルにフィクスチャ本文(wishRipe=title/reason・zeroPattern=body)が表示される。
    //            レイアウト・件数・整形は契約にしない(マーカー文字列 AI-WISH/AI-ZERO の包含で読む)
    //   前提B7-7: 404・壊れJSON・空文字(fetchGitHubRawTextの失敗時空文字と同型)では .ai-insights が
    //            1枚も出ず、pageerrorゼロ・各ビューの既存要素は無傷(フェイルソフト。[45b]/[48]と同思想)
    // ============================================================

    // B7正常フィクスチャ(F8ファイル契約どおり。wishRipe.taskId はseedB7が必ず入れる既存wishタスクを指す)
    const B7_WISH_TASK_ID = "w-b7-ripe";
    const B7_AI_OK = {
      generatedAt: `${TODAY}T07:00:00`,  // 当日朝生成=鮮度内(T区切り秒あり。FORMAT_CONTRACT整合)
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
    async function seedB7({ blocks = [], view = "wish", settings = {} } = {}) {
      await page.evaluate(({ KEY, blocks, view, settings, TODAY, wishProject, wishTask }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.blocks = blocks;
        s.currentView = view;
        s.selectedDate = TODAY;
        s.sleep = s.sleep || { logs: {} };
        s.sleep.logs = {};
        s.condition = s.condition || { logs: {} };
        s.condition.logs = {};
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
      if (view === "wish") {
        check(`${label}: wishビューの既存要素(.wish-card)が無傷`,
          await page.locator(".wish-card").count() >= 1);
      } else if (view === "zero") {
        check(`${label}: zeroビューの既存要素(.zt-toptab-row)が無傷`,
          await page.locator(".zt-toptab-row").count() === 1);
      }
    }

    // ============================================================
    // [54] F8: 正常フィクスチャ → wish/zero各ビューに .ai-insights が出て本文が表示される
    // ============================================================
    console.log("[54] F8: 正常フィクスチャでwish/zeroに .ai-insights パネルが出て、各フィクスチャ本文が表示される");
    const failuresBefore54 = failures;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "wish" });
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
    // [55] F8: ファイル無し(404)→ 両ビューで .ai-insights が存在しない・pageerrorゼロ・既存要素は無傷
    // ============================================================
    console.log("[55] F8: ai-insights.json 404 ではwish/zeroとも .ai-insights が出ず、既存要素は無傷(一切エラーなし)");
    const failuresBefore55 = failures;
    aiInsightsFx.status = 404;
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    const b7Resp404 = b7WaitAiResponse();
    await seedB7({ view: "wish" });
    await b7Resp404;
    await waitView("wish");
    await b7FlushMacrotasks();
    check("404: wishビューに .ai-insights が1枚も出ない(ファイル無しで一切エラーなし)",
      await page.locator(".ai-insights").count() === 0);
    await b7CheckViewIntact("wish", "404");
    // 同一セッション内の残りビュー(TTL30分キャッシュにより再fetchなし=失敗結果のまま。前提B7-1)
    for (const v of ["zero"]) {
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
    await seedB7({ view: "zero" });
    await b7RespBroken;
    await waitView("zero");
    await b7FlushMacrotasks();
    check("壊れJSON('{broken')では .ai-insights が出ない(例外を投げず無傷スキップ。完了条件(b))",
      await page.locator(".ai-insights").count() === 0);
    await b7CheckViewIntact("zero", "壊れJSON");
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
    console.log("[57] F8: wishRipe=数値の型不一致ではwishパネルだけが出ず、zeroは通常表示");
    const failuresBefore57 = failures;
    aiInsightsFx.body = JSON.stringify({
      ...B7_AI_OK,
      wishRipe: 12345                    // 配列であるべき所に数値
    });
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "zero" });
    // 正常フィールド側のパネル出現をfetch完了の合図にする(その後の不在断定は描画反映後で安全)
    await page.waitForSelector(aiPanelSel("zero"), { state: "attached" });
    check("正常フィールド(zeroPattern)のパネルも通常表示される",
      ((await panelText(aiPanelSel("zero"))) || "").includes("AI-ZERO"),
      await panelText(aiPanelSel("zero")));
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
    await seedB7({ view: "wish" });
    await page.waitForSelector(aiPanelSel("wish"), { state: "attached" });
    check("鮮度超過でもパネル自体は表示される(データは見える。[45c]の鮮度方針と同じ)",
      await page.locator(aiPanelSel("wish")).count() === 1
      && ((await panelText(aiPanelSel("wish"))) || "").includes("AIWS-REASON"));
    await page.waitForSelector(".ai-insights-freshness.is-stale", { state: "attached" });
    const b7StaleTexts = await page.evaluate(() =>
      [...document.querySelectorAll(".ai-insights-freshness.is-stale")].map((el) => el.textContent || ""));
    check("鮮度26時間超で .ai-insights-freshness.is-stale に「古い」を含む文言が出る(DOM契約・前提B7-3)",
      b7StaleTexts.some((t) => t.includes("古い")), JSON.stringify(b7StaleTexts));
    aiInsightsFx.body = null;

    // ============================================================
    // [59] F8: 提案の自動適用が無い(表示のみ)— 正常表示後に state.tasks/blocks/settings のJSONが不変
    // ============================================================
    console.log("[59] F8: 正常フィクスチャをwish/zeroで表示しても tasks/blocks/settings のJSONが変化しない(表示のみ)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB7({ view: "wish" });
    await page.waitForSelector(aiPanelSel("wish"), { state: "attached" });
    // 保存契機(setView)を踏んで初回normalize補完分をlocalStorageへ書き戻させてから基準を取る([34c]と同手順)
    await w1GoView("tasks");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "tasks", KEY);
    const b7SnapA = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, blocks: s.blocks, settings: s.settings });
    }, KEY);
    // 2ビューを巡回してパネルを表示させる(wishRipe提案のtask変更等が
    // 勝手に走っていればこの間にstateが変わり、下の突合で落ちる)
    for (const v of ["wish", "zero"]) {
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

    // v221: cockpit専用NOW FOCUS/NEXT QUEUE/FLIGHT PLAN検証は実装削除に合わせて撤去。

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

    // v221: cockpit専用ROUTINE検証は撤去し、GATE検証はtower-coreへ集約。

    console.log("[73] ポモドーロのタイマー満了ではblock.actualEndAtを書かず、NOW LANDINGに残り続ける");
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
    const nfTextAfterBreak = await panelText(".tower-nowhud");
    check("自動休憩遷移後もNOW LANDINGに実行中Blockが残り続ける",
      (nfTextAfterBreak || "").includes("C1-POMO-満了タスク"), nfTextAfterBreak);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
