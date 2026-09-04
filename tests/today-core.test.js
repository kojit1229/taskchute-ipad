// tests/today-core.test.js — 今日TOWERビューと共有ANNEX機能の仕様ベースE2Eスイート。
// cockpit専用5パネルはv221で削除。TOWERの描画・ブロック実行・AI/テーマ契約とGATEを検証する。
// 日時はISO文字列を組み立て、文字列をnew Dateへ渡さない。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY, dispatchRegisteredAction } = require("./helpers");

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
    // v250で削除された旧読書UIが別ビューへ残存・再出現しないことをtoday-coreへ移管する。
    check("旧読書カード・入力・保存セレクタはDOMに出現しない",
      await page.locator('details[data-fold-id="home-reading"], [data-reading-reflection-input], [data-action="reading-save"]').count() === 0);

    // ============================================================
    // [2] 既存stateは最後のビュー復元が壊れない
    // ============================================================
    console.log("[2] 既存stateの currentView(既知ビュー)は従来どおり復元される");
    await seed({ view: "timeline" });
    check("currentView='timeline' がそのまま復元される(today導入で既存復元が壊れない)",
      (await currentDataView()) === "timeline", await currentDataView());

    // ============================================================
    // [3] normalizeState が未知の currentView を "today" へ補完する
    // ============================================================
    console.log("[3] 未知の currentView は normalizeState が 'today' へ補完する(home撤去後の白画面防止)");
    await seed({ view: "no-such-view-v999" });
    check("未知view('no-such-view-v999')が 'today' に補完される", (await currentDataView()) === "today", await currentDataView());
    check("補完後にTOWERが描画され白画面にならない", await page.locator(".today-tower").count() === 1);

    // ============================================================
    // [4] サイドバーから today へ遷移できる
    // ============================================================
    console.log("[4] サイドバー(.nav-button)から today へ遷移できる");
    await seed({ view: "tasks" });
    check("サイドバーに today のナビボタンがある",
      await page.locator('#sidebar .nav-button[data-action="nav"][data-view="today"]').count() === 1);
    check("サイドバーからhomeナビが撤去されている",
      await page.locator('#sidebar [data-action="nav"][data-view="home"]').count() === 0);
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
    check("bottom-navからhomeナビが撤去されている",
      await page.locator('#bottomNav [data-action="nav"][data-view="home"]').count() === 0);
    await page.locator('#bottomNav button[data-action="nav"][data-view="today"]').click();
    await waitView("today");
    check("bottom-nav から today ビューへ遷移できる", (await currentDataView()) === "today");
    check("bottom-nav の today ボタンが active になる",
      await page.locator('#bottomNav button[data-view="today"].active').count() === 1);
    console.log("[5b] more画面滞在時はbottom-navの「その他」がactiveになる");
    await seed({ view: "more" });
    check("more滞在時はbottom-navの「その他」がactiveになる",
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
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="exec"]').click();
    await waitView("exec");
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

    const parseRgbB4 = (s) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || "");
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    };
    async function resolvedBgVar() {
      return page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--bg)";
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
    }
    const LEGACY_DARK_BG = "rgb(17, 18, 22)";
    const LEGACY_LIGHT_BG = "rgb(247, 247, 250)";
    const NOW_LINE_LEGACY = "rgb(255, 59, 48)";

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
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="exec"]').click();
    await waitView("exec");
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
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="exec"]').click();
    await waitView("exec");
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
    // v335(§C追随): サイドバーの「タスクシュート」「タイムライン」は「実行」1項目へ統合されたため、
    // 巡回対象をtasks/timelineからexecへ差し替える(旧ビュー自体は内部に残るが直接nav不可のため)。
    console.log("[28] P11: cockpitテーマで today/exec/settings を巡回し、pageerrorゼロ・#main非空");
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
    for (const view of ["today", "exec", "settings"]) {
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
    //            検証はVision.md応答の保留→入力中に解放→hydrateStaticMarkdown(v133で
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

    // B5用seed: 既存seed()/seedB3()と同じ流儀に selectedDate を足した拡張
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
    // v332: ＋Blockフォームはdetails折りたたみ(既定閉)になったため、操作前に開く(セレクタ追随)。
    await page.click("details.exec-add summary");
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
      // v331 A-1a: renderTasksのBlock一覧markupが.block-rowから.exec-row(いま/これから)へ変わった。
      await page.locator(".exec-row", { hasText: "QUICKADD-Enter追加" }).count() === 1);
    check("追加後は #blockTitle が空に戻る(再描画で入力欄がリセットされる)",
      (await page.locator("#blockTitle").inputValue()) === "");

    // ============================================================
    // [30b] F1: 過去日を選択中でも追加先は当日(当日固定)
    // ============================================================
    console.log("[30b] F1: selectedDate=昨日の実行ビューからEnter追加しても、Blockは今日の日付で作られる(当日固定)");
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({ view: "tasks", selectedDate: YESTERDAY, blocks: [] });
    await page.waitForSelector("#blockTitle", { state: "attached" });
    await page.click("details.exec-add summary");  // v332: ＋Blockフォームはdetails既定閉(セレクタ追随)
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
    //   手順: Vision.md応答を保留したままseed → #blockTitleに入力 → 応答を解放して
    //   hydrateStaticMarkdown(changed=true・tasksは再描画対象)にrenderDeferringForFocusを
    //   発火させる → フォーカス中は再描画が延期され入力が残る → blurで延期分がflushされる
    //   (プローブDOMの消滅で「延期→flush」が実際に起きたことを正の証拠として確認する)
    // ============================================================
    console.log("[30c] F1: 入力中にhydrate由来の再描画トリガが発火しても文字が残る(isFocusInEditableElement保護・前提B5-3)");
    const visionHold = { active: false, held: [] };
    const deadHydrationRequests = [];
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (/\/contents\/taskchute\/(?:今日の敵_[^/]+\.md|勝手に格言_[^/]+\.json|reading\/(?:highlights\.json|reflections\.json|summary_[^/]+\.md))$/.test(p)) {
        deadHydrationRequests.push(p);
        return route.fallback();
      }
      if (visionHold.active && p.endsWith("/contents/taskchute/content/Vision.md")) {
        visionHold.held.push(route);  // 応答保留(下で明示的にfulfillする)
        return;
      }
      return route.fallback();  // 保留しない時はB2登録済みのフィクスチャ応答へ
    });
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    visionHold.active = true;
    const heldReq = page.waitForRequest((r) => r.url().includes("/contents/taskchute/content/Vision.md"));
    await seedB5({ view: "tasks", blocks: [] });
    await heldReq;  // リクエスト到達=保留成立(この時点でhydrateは未完了のまま待っている)
    await page.waitForSelector("#blockTitle", { state: "attached" });
    await page.click("details.exec-add summary");  // v332: ＋Blockフォームはdetails既定閉(セレクタ追随)
    await page.locator("#blockTitle").click();
    await page.keyboard.type("PROTECT-入力保持");
    // 全再描画で消えるプローブを差しておく(延期中は生存・flushで消える)
    await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.id = "b5RenderProbe";
      document.getElementById("main").appendChild(probe);
    });
    const heldResp = page.waitForResponse((r) => r.url().includes("/contents/taskchute/content/Vision.md"));
    visionHold.active = false;
    for (const r of visionHold.held.splice(0)) {
      await r.fulfill({ status: 200, contentType: "text/markdown", body: "# VISION-HYDRATE-INPUT-PROTECTION" });
    }
    await heldResp;
    check("表示先を失った今日の敵・勝手に格言・reading 3種へAPIリクエストしない",
      deadHydrationRequests.length === 0, JSON.stringify(deadHydrationRequests));
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
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="exec"]').click();
    await waitView("exec");
    const wishSnapA = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, projects: s.projects });
    }, KEY);
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="wish"]').click();
    await waitView("wish");
    await page.waitForSelector(".wish-card", { state: "attached" });
    await page.locator('#sidebar .nav-button[data-action="nav"][data-view="exec"]').click();
    await waitView("exec");
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
    await w1GoView("exec");  // 保存契機(setView)で書き戻し([21]・前提B6-5)
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.currentView === "exec" && Array.isArray(s.settings.visionDirectCategories);
    }, KEY);
    const vdcMigrated = (await stateNow()).settings.visionDirectCategories;
    check("キー無しの旧stateに [] が補完される(§12 F7 migration)",
      Array.isArray(vdcMigrated) && vdcMigrated.length === 0, JSON.stringify(vdcMigrated));
    await seedB6({ view: "vision", visionDirectCats: ["仕事"] });  // マスタ外の名前でも値はそのまま保持される想定
    await waitView("vision");
    await w1GoView("exec");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "exec", KEY);
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
    await w1GoView("exec");  // 保存契機(setView)。チェック時点で即保存する実装でもこの後の突合は同じ
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
    //            (パス末尾 /contents/taskchute/dashboard/ai-insights.json)で取得され、hydrateStaticMarkdown
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
      if (p.endsWith("/contents/taskchute/dashboard/ai-insights.json")) {
        if (aiInsightsFx.status !== 200) return route.fulfill({ status: aiInsightsFx.status, body: "not found" });
        if (aiInsightsFx.body != null) return route.fulfill({ status: 200, contentType: "application/json", body: aiInsightsFx.body });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(B7_AI_OK) });
      }
      return route.fallback();
    });
    const aiPanelSel = (kind) => `.ai-insights[data-insight="${kind}"]`;
    const b7WaitAiResponse = () =>
      page.waitForResponse((r) => r.url().includes("/contents/taskchute/dashboard/ai-insights.json"));
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
    await w1GoView("exec");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "exec", KEY);
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
    await w1GoView("exec");  // 再び保存契機を踏んで書き戻し後に突合
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView === "exec", KEY);
    const b7SnapB = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return JSON.stringify({ tasks: s.tasks, blocks: s.blocks, settings: s.settings });
    }, KEY);
    check("パネル表示の前後で tasks/blocks/settings のJSONが不変(提案の適用は手動のみ。前提B7-5)",
      b7SnapA === b7SnapB);

    // v221: cockpit専用NOW FOCUS/NEXT QUEUE/FLIGHT PLAN検証は実装削除に合わせて撤去。

    // ============================================================

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
    // ============================================================
    // [74] 1-H1(修正フェーズ 単位8): taskchuteBlocks/computeFreeGaps の migratedTo 除外
    //   K16「送済Blockは今日の占有として残さない」+2026-09-05 K回答「computeFreeGapsでも外す」
    // ============================================================
    console.log("[74] 1-H1: 送済(migratedTo付き)Blockが着手率の分母と空き時間占有から除外される");
    const H1_PROJECT = {
      id: "h1-proj", kind: "normal", title: "1-H1テスト案件", category: "", status: "active",
      description: "", dueDate: "", twelveWeekStartDate: "", createdAt: at("00:00"),
      updatedAt: at("00:00"), deleted: false, collapsed: false
    };
    const h1Task = (id, title) => ({
      id, projectId: "h1-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
      description: "", createdAt: at("00:00"), updatedAt: at("00:00"), deleted: false
    });

    // --- (a)(b) taskchuteStartRate(ジャーナルタブ「着手率」)の分母から送済Blockが外れる ---
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seedB5({
      view: "journal",
      projects: [H1_PROJECT],
      tasks: [h1Task("h1-t-open", "H1-未着手"), h1Task("h1-t-done", "H1-完了済"), h1Task("h1-t-sent", "H1-送済")],
      blocks: [
        block("h1-open", { title: "H1-未着手", taskId: "h1-t-open", plannedStartAt: at("09:00"), plannedEndAt: at("09:30") }),
        block("h1-done", {
          title: "H1-完了済", taskId: "h1-t-done", completed: true,
          plannedStartAt: at("10:00"), plannedEndAt: at("10:30"), actualStartAt: at("10:00"), actualEndAt: at("10:30")
        }),
        // 修正前は分母に含まれ着手率を歪める(1-H1指摘: DRIFTで送るほど着手率が下がる逆インセンティブ)
        block("h1-sent", {
          title: "H1-送済", taskId: "h1-t-sent",
          plannedStartAt: at("11:00"), plannedEndAt: at("11:30"), migratedTo: "dummy-sent-target"
        })
      ]
    });
    await waitView("journal");
    const daysummaryText = await panelText(".journal-daysummary");
    // 分母 = open+done の2件(sentを除く)。done = h1-done の1件 → 50%。
    // 修正前(sent込み3件・done1件)なら33%になり、この期待値と食い違う。
    check("送済Blockが taskchuteStartRate の分母から除外される(2件中1件着手済=50%)",
      (daysummaryText || "").includes("着手率 50%"), daysummaryText);
    check("誤って送済Block込みの旧分母(3件・33%)が出ていない",
      !(daysummaryText || "").includes("着手率 33%"), daysummaryText);

    // --- (c) computeFreeGaps: 送済Blockは占有から外れ、その時間帯へAI再配置が候補を置ける ---
    await page.clock.setFixedTime(fixedTime(6, 0, 0));
    await seedB5({
      view: "tasks",
      projects: [H1_PROJECT],
      tasks: [h1Task("h1-t-cand", "H1-配置候補")],
      blocks: [
        // 05:00〜10:00・10:30〜23:00 を固定占有で埋め、10:00〜10:30の30分だけを空きにする
        block("h1-fixed-a", { title: "H1-固定A", plannedStartAt: at("05:00"), plannedEndAt: at("10:00") }),
        block("h1-fixed-b", { title: "H1-固定B", plannedStartAt: at("10:30"), plannedEndAt: at("23:00") }),
        // 唯一の空き枠(10:00〜10:30)に送済Block(migratedTo付き)が居座っている状態を再現。
        // 修正前はこれも占有として残るため配置候補が入れず「空き時間不足」でskipされる。
        block("h1-fixed-sent", {
          title: "H1-送済占有", plannedStartAt: at("10:00"), plannedEndAt: at("10:30"), migratedTo: "dummy-sent-target-2"
        }),
        // 配置候補(プライベート窓8-21内・estimateMin既定30分・taskchuteBlocks対象)
        block("h1-cand", { title: "H1-配置候補", taskId: "h1-t-cand" })
      ]
    });
    await page.click('[data-action="nav"][data-view="timeline"]');
    await page.waitForTimeout(150);
    await dispatchRegisteredAction(page, "ai-schedule");
    await page.waitForTimeout(500);
    const h1DraftTitles = await page.locator(".draft-block-title").allTextContents();
    const h1DraftTimeTexts = await page.locator(".draft-block-time").allTextContents();
    check("送済Blockに占有されていた10:00〜10:30がcomputeFreeGapsで空きとして扱われ、配置候補がそこへ入る",
      h1DraftTitles.some((t) => t.includes("H1-配置候補")) && h1DraftTimeTexts.some((t) => t.includes("10:00〜10:30")),
      JSON.stringify({ h1DraftTitles, h1DraftTimeTexts }));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
