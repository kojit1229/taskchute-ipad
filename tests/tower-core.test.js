// tests/tower-core.test.js — v208 TOWERのスキン・発着ボード・GATE/APRON・RADAR/無線契約E2E。
// today-core.test.jsと同じく、localStorage seed + 既存nav + Playwright clockで検証する。
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const fixedTime = (seconds) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, seconds, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const today = isoOf(base);
  const tomorrow = isoOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));
  const atMinute = (date, minute) => `${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00`;
  const block = (id, title, date, minute, extra = {}) => ({
    id, title, date, category: "開発", plannedStartAt: atMinute(date, minute), plannedEndAt: "",
    actualStartAt: "", actualEndAt: "", completed: false, deleted: false, orderIndex: 0, ...extra
  });

  async function seedSkin(value, view = "today") {
    await page.evaluate(({ KEY, value, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = view;
      if (value === "__missing__") delete s.settings.todaySkin;
      else s.settings.todaySkin = value;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, value, view });
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
  }

  async function storedSkin() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.todaySkin, KEY);
  }

  async function seedBoard(arrivals, departures = []) {
    await page.evaluate(({ KEY, arrivals, departures }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      s.blocks = [...arrivals, ...departures];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, arrivals, departures });
    await page.reload();
    await page.waitForSelector(".today-tower", { state: "attached" });
  }

  try {
    await page.clock.setFixedTime(fixedTime(0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    console.log("[1] todaySkinの旧stateは値にかかわらずtowerへ正規化される");
    await seedSkin("__missing__");
    check("未設定では.today-towerが描画される", await page.locator(".today-tower").count() === 1);
    await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').click();
    await page.waitForSelector('#app[data-view="tasks"]');
    check("未設定値は保存時にtowerへ正規化される", await storedSkin() === "tower", await storedSkin());

    await seedSkin("unknown-skin");
    check("不正値でも.today-towerが描画される", await page.locator(".today-tower").count() === 1);
    await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').click();
    await page.waitForSelector('#app[data-view="tasks"]');
    check("不正値は保存時にtowerへ正規化される", await storedSkin() === "tower", await storedSkin());

    await seedSkin("cockpit");
    check("旧cockpit値でも.today-towerが描画される", await page.locator(".today-tower").count() === 1);
    check("旧cockpit値はtowerへ固定正規化される", await storedSkin() === "tower", await storedSkin());

    console.log("[2] todaySkin設定UIは廃止され、設定にAI再プラン導線がある");
    await seedSkin("cockpit", "settings");
    check("todaySkinの設定selectが存在しない", await page.locator('select[data-setting-field="todaySkin"]').count() === 0);
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-daily"]'); if (fold) fold.open = true; });
    check("設定にAI再プラン実行ボタンがある", await page.locator('[data-action="today-replan"]', { hasText: "AI再プラン実行" }).count() === 1);
    await page.locator('[data-action="today-replan"]', { hasText: "AI再プラン実行" }).click();
    // v221: seed済みトークンがあるためトークン未設定案内は出ない。requestReplanが呼ばれた証拠として
    // _replanUiのフィードバック(送信中/排他エラー/通信エラーのいずれか)が設定画面の状態行に出ることを待つ
    await page.waitForFunction(() => {
      const spans = Array.from(document.querySelectorAll("#main .muted"));
      return spans.some((el) => /再プラン|依頼|送信|下書き|処理中|失敗|エラー/.test(el.textContent || ""));
    }, null, { timeout: 15000 });
    check("AI再プラン実行ボタンが既存requestReplanを呼びフィードバックが表示される", true);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".today-tower");
    check("今日タブは常に.today-towerを描画する", await page.locator(".today-tower").count() === 1);
    const firstLeft = (await page.locator("#towerDayLeft").textContent()) || "";
    check("#towerDayLeftはHH:MM:SS形式", /^\d{2}:\d{2}:\d{2}$/.test(firstLeft), firstLeft);

    console.log("[3] 既存1秒tickerで本日残りが減る");
    await page.clock.setFixedTime(fixedTime(1));
    await page.waitForFunction((before) => document.getElementById("towerDayLeft")?.textContent !== before, firstLeft);
    const secondLeft = (await page.locator("#towerDayLeft").textContent()) || "";
    const toSeconds = (text) => text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
    check("1秒進行で#towerDayLeftが1秒減る", toSeconds(firstLeft) - toSeconds(secondLeft) === 1, `${firstLeft} -> ${secondLeft}`);

    console.log("[5] TOWERの色トークン・実描画色に赤系を使わない(D7)");
    await seedSkin("tower");
    await page.waitForSelector(".today-tower");
    // レビューM1反映: inline style走査は常に空で空振りだったため、computed styleの実値で検査する。
    const towerColors = await page.evaluate(() => {
      const root = document.querySelector(".today-tower");
      const cs = getComputedStyle(root);
      const tokens = ["bg", "panel", "line", "text", "amber", "green", "cyan", "purple"]
        .map((key) => [`--tower-${key}`, cs.getPropertyValue(`--tower-${key}`).trim()]);
      const els = [".tower-time time", ".tower-day-left strong", ".tower-eyebrow", ".tower-beacon i", ".tower-status"]
        .map((sel) => { const el = root.querySelector(sel); return [sel, el ? getComputedStyle(el).color : ""]; });
      return { tokens, els };
    });
    const parseColor = (text) => {
      let m = String(text).trim().match(/^#([0-9a-f]{6})$/i);
      if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
      m = String(text).trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    };
    const isReddish = (c) => {
      if (!c) return false;
      const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
      if (max === 0 || (max - min) / max < 0.3) return false;
      const d = max - min;
      let h = max === c.r ? ((c.g - c.b) / d) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
      h = (h * 60 + 360) % 360;
      return h >= 340 || h <= 20;
    };
    check("8つの--tower-*トークンが全て定義されている", towerColors.tokens.every(([, v]) => v.length > 0),
      JSON.stringify(towerColors.tokens));
    check("トークンに赤系(hue340-20)が無い", towerColors.tokens.every(([, v]) => !isReddish(parseColor(v))),
      JSON.stringify(towerColors.tokens));
    check("主要要素のcomputed colorに赤系が無い", towerColors.els.every(([, v]) => !isReddish(parseColor(v))),
      JSON.stringify(towerColors.els));

    console.log("[6] towerの日跨ぎで全再描画される(レビューM2反映)");
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 0));
    await page.waitForFunction(() => document.getElementById("towerClock")?.textContent === "23:59:59");
    const towerDateBefore = (await page.locator("#towerDate").textContent()) || "";
    const nextDay = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 1, 0);
    await page.clock.setFixedTime(nextDay);
    await page.waitForFunction((before) => document.getElementById("towerDate")?.textContent !== before, towerDateBefore);
    const towerDateAfter = (await page.locator("#towerDate").textContent()) || "";
    const nextISO = `${nextDay.getFullYear()}-${pad2(nextDay.getMonth() + 1)}-${pad2(nextDay.getDate())}`;
    check("日跨ぎで#towerDateが翌日日付になる", towerDateAfter.startsWith(nextISO), towerDateAfter);
    check("日跨ぎで#towerDayLeftがほぼ丸一日へ戻る", /^23:59:/.test((await page.locator("#towerDayLeft").textContent()) || ""),
      await page.locator("#towerDayLeft").textContent());

    console.log("[7] ARRIVALSは本日便の現在前後5便だけを表示する");
    await page.clock.setFixedTime(fixedTime(0));
    const arrivals = Array.from({ length: 13 }, (_, index) =>
      block(`arr-${index}`, `本日便${index + 1}`, today, 9 * 60 + 30 + index * 30));
    arrivals.push(block("routine-hidden", "除外ルーティン", today, 11 * 60, { category: "ルーティン" }));
    arrivals.push(block("onetap-hidden", "除外ワンタップ", today, 11 * 60 + 15, { oneTap: true }));
    const departures = [
      block("dep-late", "明日15時", tomorrow, 15 * 60), block("dep-first", "明日8時半", tomorrow, 8 * 60 + 30),
      block("dep-third", "明日13時", tomorrow, 13 * 60), block("dep-second", "明日10時", tomorrow, 10 * 60)
    ];
    await seedBoard(arrivals, departures);
    check("ARRIVALSは最大11行", await page.locator(".tower-arrival-row").count() === 11);
    check("窓外2便を数字だけで要約する", (await page.locator(".tower-flight-summary").textContent())?.trim() === "他 2 便");
    const arrivalCallsigns = await page.locator(".tower-arrival-row .tower-callsign").allTextContents();
    check("本日の便名はTC-701起点", arrivalCallsigns[0] === "TC-701", JSON.stringify(arrivalCallsigns));
    const labels = await page.locator(".tower-arrival-row .tower-status").allTextContents();
    const allowedLabels = new Set(["到着", "着陸中", "リスロット", "最終進入", "待機"]);
    check("状態ラベルは確定語彙だけ", labels.every((label) => allowedLabels.has(label)), JSON.stringify(labels));
    check("ルーティンはARRIVALSに出ない", await page.locator('.tower-flight-title:has-text("除外ルーティン")').count() === 0);
    check("oneTapはARRIVALSに出ない", await page.locator('.tower-flight-title:has-text("除外ワンタップ")').count() === 0);

    console.log("[8] ARRIVALSのタスク名タップは既存Blockモーダルを開く");
    await page.locator('.tower-arrival-row[data-flight-id="arr-0"] .tower-flight-title').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("既存Block編集モーダルが開く", await page.locator(".modal-card").count() === 1);
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });

    console.log("[9] DEPARTURESは明日の定刻順で3便まで表示する");
    const departureRows = page.locator(".tower-departure-row");
    check("DEPARTURESは3行上限", await departureRows.count() === 3);
    check("DEPARTURESは定刻昇順", JSON.stringify(await departureRows.locator("time").allTextContents()) === JSON.stringify(["08:30", "10:00", "13:00"]));
    check("明日の便名もTC-701から振り直す", JSON.stringify(await departureRows.locator(".tower-callsign").allTextContents()) === JSON.stringify(["TC-701", "TC-703", "TC-705"]));

    console.log("[10] tickerは行を再構築せず状態文字列をフリップ更新する");
    const crossing = [block("flip-first", "境界便", today, 12 * 60), block("flip-next", "次便", today, 13 * 60)];
    await page.clock.setFixedTime(fixedTime(0));
    await seedBoard(crossing);
    // 起動時同期(404)後のアプリ全体render()がDOMを一度差し替えるため、沈静化してから同一性を計測する。
    await page.waitForLoadState("networkidle");
    const crossingStatus = page.locator('.tower-arrival-row[data-flight-id="flip-first"] .tower-status');
    check("境界前は最終進入", (await crossingStatus.textContent()) === "最終進入");
    // レビューM2反映: locator再解決ではDOM同一性を検証できないため、遷移前のElementHandleの生存で「再構築していない」を固定する。
    // fixed clock下ではアニメーションイベントが発火しない(=is-flipはanimationendで外れず残る)ため、クラス+computedで検証する。
    const statusHandle = await crossingStatus.elementHandle();
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 1, 0, 0));
    await page.waitForFunction(() => document.querySelector('[data-flight-id="flip-first"] .tower-status')?.textContent === "リスロット");
    check("時刻経過後はリスロットへ差分更新", (await crossingStatus.textContent()) === "リスロット");
    check("状態セルのDOM要素は再構築されず同一のまま", await statusHandle.evaluate((el) => el.isConnected && el.textContent === "リスロット"));
    check("遷移した状態セルにis-flipが付与されflipアニメが適用される",
      await statusHandle.evaluate((el) => el.classList.contains("is-flip") && getComputedStyle(el).animationName === "tower-board-flip"));

    console.log("[11] 11便超の日は時間経過の窓ずれをtickが追従する(フォーカス中は保留)");
    const many = Array.from({ length: 13 }, (_, i) => block(`w${i}`, `便${i}`, today, 9 * 60 + i * 30));
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 30, 0));
    await seedBoard(many);
    await page.waitForLoadState("networkidle");
    check("12:00時点の窓は w1..w11", (await page.locator(".tower-arrival-row").first().getAttribute("data-flight-id")) === "w1");
    await page.locator('.tower-arrival-row[data-flight-id="w6"] .tower-flight-title').focus();
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 30, 30, 0));
    await page.waitForFunction(() => document.getElementById("towerClock")?.textContent === "12:30:30");
    check("フォーカス中は行を作り直さない(先頭はw1のまま)", (await page.locator(".tower-arrival-row").first().getAttribute("data-flight-id")) === "w1");
    check("フォーカスは失われない", await page.evaluate(() => document.activeElement?.closest?.('[data-flight-id="w6"]') !== null));
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.querySelector(".tower-arrival-row")?.dataset.flightId === "w2");
    check("フォーカス解除後のtickで窓がw2..w12へずれる", (await page.locator(".tower-arrival-row").first().getAttribute("data-flight-id")) === "w2");
    check("窓ずれ後も他 n 便のサマリが正しい", ((await page.locator("#towerArrivalSummary").textContent()) || "").trim() === "他 2 便");

    console.log("[12] 実行中BlockをRWYとNOW LANDINGへ表示する");
    await page.clock.setFixedTime(fixedTime(0));
    const landing = block("rwy-landing", "RWY検証タスク", today, 11 * 60, {
      actualStartAt: atMinute(today, 11 * 60 + 30), estimateMin: 60
    });
    await seedBoard([landing]);
    check(".tower-runwayと#towerPlaneが存在", await page.locator(".tower-runway #towerPlane").count() === 1);
    const landingX = await page.locator("#towerPlane").evaluate((el) => parseFloat(el.style.getPropertyValue("--tower-plane-x")));
    check("11:30開始・60分見積の12:00位置は約50%", Math.abs(landingX - 50) < 0.1, String(landingX));
    check("残り30分を表示", (await page.locator("#towerNowRemain").textContent()) === "残り 30分");
    check("定刻11:00を表示", (await page.locator(".tower-now-sched").textContent()) === "定刻 11:00");
    // 復元(起動時から実行中)は接地の瞬間ではないためフラッシュを出さない。出す側は[14]の開始遷移で検証する。
    check("復元描画では接地フラッシュを出さない", await page.locator(".tower-touchdown").count() === 0);
    await page.locator('.tower-now-title[data-id="rwy-landing"]').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("タスク名クリックで既存Block編集モーダルが開く", await page.locator(".modal-card").count() === 1);
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });

    console.log("[13] NOW LANDINGの完了導線は既存実績モーダルを開く");
    await page.locator('.tower-now-actions [data-action="complete-block-with-actual"]').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("■ 完了で既存実績モーダルが開く", await page.locator('.modal-title:has-text("実績を登録")').count() === 1);
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });

    console.log("[14] runningなし・queueありはREADYから既存now-startで開始する");
    const ready = block("rwy-ready", "待機タスク", today, 13 * 60, { estimateMin: 45 });
    await seedBoard([ready]);
    check("queue先頭はdata-status=ready", await page.locator('.tower-nowhud[data-status="ready"]').count() === 1);
    check("READYは開始だけを表示", await page.locator('.tower-nowhud [data-action="now-start"]').count() === 1
      && await page.locator('.tower-nowhud [data-action="complete-block-with-actual"], .tower-nowhud [data-action="now-conveyor-complete"]').count() === 0);
    await page.locator('.tower-nowhud [data-action="now-start"][data-id="rwy-ready"]').click();
    await page.waitForSelector('[data-action="declare-skip"]', { state: "attached" });
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForSelector('.tower-nowhud[data-status="landing"] #towerNowRemain', { state: "attached" });
    check("開始後は実行中の機体と残り表示へ遷移", await page.locator("#towerPlane").count() === 1
      && await page.locator('.tower-now-title[data-id="rwy-ready"]').count() === 1);
    // fixed clock下ではanimationendが発火しない=要素が残るので、クラス存在+computed animationNameで接地フラッシュを固定する。
    check("開始遷移で接地フラッシュが1要素出る", await page.locator(".tower-touchdown").count() === 1
      && await page.locator(".tower-touchdown").evaluate((el) => getComputedStyle(el).animationName === "tower-touchdown"));
    // レビューM1再発防止: フラッシュはCSS変数を継承できない兄弟要素のため、機体と同じ位置を自身のinline styleに持つ。
    check("接地フラッシュは機体位置と同じ--tower-plane-xを持つ", await page.evaluate(() => {
      const plane = document.getElementById("towerPlane");
      const flash = document.querySelector(".tower-touchdown");
      return !!plane && !!flash && flash.style.getPropertyValue("--tower-plane-x") === plane.style.getPropertyValue("--tower-plane-x");
    }));

    console.log("[15] 見積超過は琥珀のロングフライト表示になりtickでも遷移する");
    const long = block("rwy-long", "ロング検証", today, 9 * 60 + 30, {
      actualStartAt: atMinute(today, 10 * 60), estimateMin: 60
    });
    await page.clock.setFixedTime(fixedTime(0));
    await seedBoard([long]);
    check("見積超過はdata-status=long", await page.locator('.tower-nowhud[data-status="long"]').count() === 1);
    check("120分経過はロングフライト +60分", (await page.locator("#towerNowRemain").textContent()) === "ロングフライト +60分");
    const longColor = parseColor(await page.locator("#towerNowRemain").evaluate((el) => getComputedStyle(el).color));
    check("ロングフライト表示色は赤系でない", !isReddish(longColor), JSON.stringify(longColor));

    const crossingLong = block("rwy-crossing", "境界ロング検証", today, 10 * 60 + 30, {
      actualStartAt: atMinute(today, 11 * 60), estimateMin: 60
    });
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 11, 59, 30, 0));
    await seedBoard([crossingLong]);
    check("境界前はlanding", await page.locator('.tower-nowhud[data-status="landing"]').count() === 1);
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 1, 0));
    await page.waitForFunction(() => document.querySelector(".tower-nowhud")?.dataset.status === "long");
    const crossedX = await page.locator("#towerPlane").evaluate((el) => el.style.getPropertyValue("--tower-plane-x"));
    check("tickでlandingからlongへ遷移", (await page.locator("#towerNowRemain").textContent()) === "ロングフライト +1分");
    check("境界通過後の機体は100%で停止", parseFloat(crossedX) === 100, crossedX);

    const seedT5 = async (blocks, meals = [], dailyKcal = 2278) => {
      await page.evaluate(({ KEY, blocks, meals, dailyKcal }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.currentView = "today";
        s.blocks = blocks;
        s.coachLog = { meals, settings: { dailyKcal } };
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, meals, dailyKcal });
      await page.reload();
      await page.waitForSelector(".tower-gauges", { state: "attached" });
    };
    const seedT6 = async (blocks) => {
      await seedT5(blocks);
      await page.waitForSelector(".tower-gates", { state: "attached" });
    };
    const needleDeg = (id) => page.locator(id).evaluate((el) => parseFloat(el.style.getPropertyValue("--tower-needle-deg")));

    console.log("[16] FUEL表示・既存食事記録導線・針スプリング");
    await page.clock.setFixedTime(fixedTime(0));
    const meal700 = { id: "meal-700", date: today, time: "11:30", kind: "quick", quickKcal: 700, label: "定食", updatedAt: new Date().toISOString() };
    await seedT5([], [meal700]);
    const fuel1578Deg = -90 + (1578 / 2278) * 180;
    await page.waitForFunction((expected) => Math.abs(parseFloat(document.getElementById("towerFuelNeedle")?.style.getPropertyValue("--tower-needle-deg")) - expected) < .5, fuel1578Deg);
    check("700kcal記録済みの残りは1,578", (await page.locator("#towerFuelValue").textContent()) === "1,578");
    check("FUEL針は残量比の角度", Math.abs(await needleDeg("#towerFuelNeedle") - fuel1578Deg) < .5);
    check("残り1,578ではwarn非表示", await page.locator('.tower-fuel[data-warn="0"] #towerFuelWarn').isHidden());
    const needleTransition = await page.locator("#towerFuelNeedle").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { property: cs.transitionProperty, duration: cs.transitionDuration };
    });
    check("針にtransform 800ms transitionがある", needleTransition.property.includes("transform") && needleTransition.duration === "0.8s", JSON.stringify(needleTransition));
    const beforeMealDeg = await needleDeg("#towerFuelNeedle");
    const renderAfterMealDeg = await page.evaluate(() => {
      document.querySelector('[data-action="coach-quick-add"][data-label="軽食"]')?.click();
      document.querySelector('#sidebar [data-action="nav"][data-view="tasks"]')?.click();
      document.querySelector('#sidebar [data-action="nav"][data-view="today"]')?.click();
      return parseFloat(document.getElementById("towerFuelNeedle")?.style.getPropertyValue("--tower-needle-deg"));
    });
    check("食事記録後の全体render直後は旧角度", Math.abs(renderAfterMealDeg - beforeMealDeg) < .01, `${beforeMealDeg} -> ${renderAfterMealDeg}`);
    check("軽食300追加で残り1,278", (await page.locator("#towerFuelValue").textContent()) === "1,278");
    const fuel1278Deg = -90 + (1278 / 2278) * 180;
    await page.waitForFunction((expected) => Math.abs(parseFloat(document.getElementById("towerFuelNeedle")?.style.getPropertyValue("--tower-needle-deg")) - expected) < .5, fuel1278Deg);
    check("次tickで新しい目標角度へ更新", Math.abs(await needleDeg("#towerFuelNeedle") - fuel1278Deg) < .5);
    await page.reload();
    await page.waitForSelector("#towerFuelValue");
    check("軽食記録はリロード後も保持", (await page.locator("#towerFuelValue").textContent()) === "1,278");
    await page.locator(".tower-fuel-undo").click();
    await page.waitForFunction(() => document.getElementById("towerFuelValue")?.textContent === "1,578");
    check("取り消すで直近の軽食だけ消える", (await page.locator("#towerFuelValue").textContent()) === "1,578");

    console.log("[17] FUEL warn境界・負値clamp・赤系禁止");
    const meal1979 = { ...meal700, id: "meal-1979", quickKcal: 1979 };
    await seedT5([], [meal1979]);
    check("remaining 299はdata-warn=1", await page.locator('.tower-fuel[data-warn="1"]').count() === 1);
    check("warn文言は今日はここまでの合図", (await page.locator("#towerFuelWarn").textContent()) === "今日はここまでの合図" && await page.locator("#towerFuelWarn").isVisible());
    const warnColor = parseColor(await page.locator("#towerFuelWarn").evaluate((el) => getComputedStyle(el).color));
    check("warn色は赤系でない", !isReddish(warnColor), JSON.stringify(warnColor));
    const meal2500 = { ...meal700, id: "meal-2500", quickKcal: 2500 };
    await seedT5([], [meal2500]);
    await page.waitForFunction(() => parseFloat(document.getElementById("towerFuelNeedle")?.style.getPropertyValue("--tower-needle-deg")) === -90);
    check("負のremainingも数値表示", (await page.locator("#towerFuelValue").textContent()) === "-222");
    check("負のremainingでは針がE(-90deg)で止まる", await needleDeg("#towerFuelNeedle") === -90);
    const negativeColors = await page.locator(".tower-fuel").evaluate((root) => [...root.querySelectorAll("*")].map((el) => getComputedStyle(el).color));
    check("負値表示にも赤系色が無い", negativeColors.every((color) => !isReddish(parseColor(color))), JSON.stringify(negativeColors));

    console.log("[18] TRAFFIC 3ゾーンと重複区間union");
    const trafficCases = [
      { blocks: [], zone: "calm", label: "凪" },
      { blocks: [block("traffic-90", "90分", today, 12 * 60, { plannedEndAt: atMinute(today, 13 * 60 + 30) })], zone: "cruise", label: "巡航" },
      { blocks: [block("traffic-150", "150分", today, 12 * 60, { plannedEndAt: atMinute(today, 14 * 60 + 30) })], zone: "dense", label: "過密" }
    ];
    for (const trafficCase of trafficCases) {
      await seedT5(trafficCase.blocks);
      check(`${trafficCase.label}はdata-zone=${trafficCase.zone}`, await page.locator(`.tower-traffic[data-zone="${trafficCase.zone}"]`).count() === 1);
      check(`TRAFFIC表示は${trafficCase.label}`, (await page.locator("#towerTrafficZone").textContent()) === trafficCase.label);
    }
    const overlap = [
      block("traffic-overlap-a", "重複A", today, 12 * 60, { plannedEndAt: atMinute(today, 15 * 60) }),
      block("traffic-overlap-b", "重複B", today, 12 * 60, { plannedEndAt: atMinute(today, 15 * 60) })
    ];
    await seedT5(overlap);
    await page.waitForFunction(() => parseFloat(document.getElementById("towerTrafficNeedle")?.style.getPropertyValue("--tower-needle-deg")) === 90);
    check("重複予定はunionされ100%を超えない", await needleDeg("#towerTrafficNeedle") === 90);
    // 2系統レビュー共通指摘: 日跨ぎ(23:30→翌00:30)はminutesOfが日付を捨てるためend<startとなり占有0分に落ちていた。
    // +1440正規化後は窓[23:00,26:00]内の60分=ちょうど1/3で巡航(ゾーン境界の検証を兼ねる)。
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 0, 0, 0));
    const crossMidnight = [block("traffic-cross", "日跨ぎ便", today, 23 * 60 + 30, { plannedEndAt: atMinute(tomorrow, 30) })];
    await seedT5(crossMidnight);
    check("日跨ぎ予定の占有60分はdata-zone=cruise", await page.locator('.tower-traffic[data-zone="cruise"]').count() === 1, await page.locator(".tower-traffic").getAttribute("data-zone"));
    check("日跨ぎ予定の針は-30deg(境界1/3ちょうど)", Math.abs(await needleDeg("#towerTrafficNeedle") - (-30)) < .5, String(await needleDeg("#towerTrafficNeedle")));
    await page.clock.setFixedTime(fixedTime(0));

    console.log("[19] 見積なし実行中とBlock 0件の空状態");
    const noEstimate = block("rwy-no-estimate", "見積なし検証", today, 11 * 60, {
      actualStartAt: atMinute(today, 11 * 60 + 30), estimateMin: 0
    });
    await seedT5([noEstimate]);
    check("estimateMin:0の機体は0%固定", parseFloat(await page.locator("#towerPlane").evaluate((el) => el.style.getPropertyValue("--tower-plane-x"))) === 0);
    check("estimateMin:0は見積なし", (await page.locator("#towerNowRemain").textContent()) === "見積なし");
    await seedT5([]);
    check("Block 0件はempty空状態", await page.locator('.tower-nowhud[data-status="empty"]').count() === 1
      && (await page.locator(".tower-nowhud").textContent())?.trim() === "本日の着陸予定はありません");

    console.log("[20] GATE数と就航数はroutineRateと同じ母集団を使う");
    const gateSeed = [
      block("gate-done", "朝便", today, 7 * 60, { category: "ルーティン", completed: true, actualEndAt: atMinute(today, 7 * 60 + 5) }),
      block("gate-open", "昼便", today, 12 * 60, { category: "ルーティン" }),
      block("gate-onetap", "記録専用", today, 13 * 60, { category: "ルーティン", oneTap: true }),
      block("gate-deleted", "削除便", today, 14 * 60, { category: "ルーティン", deleted: true })
    ];
    await seedT6(gateSeed);
    check("oneTapを除くゲートは2基", await page.locator(".tower-gate").count() === 2);
    check("1/2便 就航を表示", (await page.locator("#towerGateCount").textContent()) === "1/2便 就航");

    console.log("[21] GATEタップは既存action経由で完了し就航灯とカウントを更新する");
    await page.locator('.tower-gate[data-id="gate-open"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed === true, KEY);
    check("実DOMクリックでBlock.completedが保存される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed, KEY));
    check("タップしたゲートが就航灯になる", await page.locator('.tower-gate[data-id="gate-open"][data-docked="1"]').count() === 1);
    check("新規就航はis-dockingの700ms演出", await page.locator('.tower-gate[data-id="gate-open"]').evaluate((el) => {
      const cs = getComputedStyle(el);
      return el.classList.contains("is-docking") && cs.animationName === "tower-gate-docking" && cs.animationDuration === "0.7s";
    }));
    check("就航数が2/2へ増える", (await page.locator("#towerGateCount").textContent()) === "2/2便 就航");
    // K判断(2026-08-17): 就航済みゲートの再タップは確認なしの完了取消(既存toggleBlockのトグル)を仕様として維持する。
    await page.locator('.tower-gate[data-id="gate-open"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed !== true, KEY);
    check("就航済み再タップで取消される(トグル仕様)", await page.locator('.tower-gate[data-id="gate-open"][data-docked="0"]').count() === 1
      && (await page.locator("#towerGateCount").textContent()) === "1/2便 就航");
    await page.locator('.tower-gate[data-id="gate-open"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed === true, KEY);

    console.log("[22] 全就航だけis-fullになり、満灯フラッシュは遷移の瞬間だけ");
    check("全就航ではis-full", await page.locator(".tower-gates.is-full").count() === 1);
    check("就航遷移の瞬間はis-full-flashが付く", await page.locator(".tower-gates.is-full-flash").count() === 1);
    await page.reload();
    await page.waitForSelector(".tower-gates");
    check("復元描画はis-fullのみでフラッシュを出さない", await page.locator(".tower-gates.is-full").count() === 1
      && await page.locator(".tower-gates.is-full-flash").count() === 0);
    check("復元描画のis-fullは満灯アニメが走らない", await page.locator(".tower-gates.is-full").evaluate((el) => getComputedStyle(el).animationName === "none"));
    await seedT6(gateSeed);
    check("部分就航ではis-fullなし", await page.locator(".tower-gates.is-full").count() === 0);
    await seedT6([block("gate-none", "非ルーティンのみ", today, 9 * 60, { completed: true })]);
    check("ルーティン0件はis-fullなし・0/0便 就航", await page.locator(".tower-gates.is-full").count() === 0
      && (await page.locator("#towerGateCount").textContent()) === "0/0便 就航");

    console.log("[23] 非ルーティン完了BlockがAPRONへ到着順に並びリロード後も保持される");
    const apronSeed = [
      block("apron-late", "午後便", today, 9 * 60, { completed: true, actualEndAt: atMinute(today, 11 * 60) }),
      block("apron-first", "午前便", today, 10 * 60, { completed: true, actualEndAt: atMinute(today, 10 * 60 + 30) }),
      block("apron-routine", "定期便", today, 8 * 60, { category: "ルーティン", completed: true, actualEndAt: atMinute(today, 9 * 60) }),
      // レビューB1再発防止: 計時タブのワンタップ計時が作るoneTap完了Blockを混ぜても、
      // APRONに駐機せず、ARRIVALSと同じ母集団でcallsign採番がずれないこと。
      block("apron-onetap", "ワンタップ計時", today, 8 * 60 + 30, { oneTap: true, completed: true, actualEndAt: atMinute(today, 9 * 60 + 30) })
    ];
    await seedT6(apronSeed);
    check("APRONは非ルーティン到着2機だけ(oneTap・ルーティンは駐機しない)", await page.locator(".tower-apron-plane").count() === 2);
    check("実績終了の到着順でcallsignを表示", JSON.stringify(await page.locator(".tower-apron-plane").allTextContents()) === JSON.stringify(["✈ TC-703", "✈ TC-701"]));
    await page.reload();
    await page.waitForSelector(".tower-apron");
    check("リロード後もAPRONの機体を保持", await page.locator(".tower-apron-plane").count() === 2);

    console.log("[24] GATE/APRONは確定語彙と非赤系色だけを使う");
    const t6Surface = await page.locator(".tower-gates, .tower-apron").allTextContents();
    const forbidden = ["まもなく", "急いで", "遅延", "DELAYED", "未達", "遅れています", "オーバー", "超過しています",
      "失敗", "未消化", "積み残し", "食べ過ぎ", "オーバーカロリー", "未実施", "未就航", "残り"];
    check("禁止語を表示しない", forbidden.every((word) => !t6Surface.join(" ").includes(word)), JSON.stringify(t6Surface));
    const t6Colors = await page.locator(".tower-gates, .tower-apron").evaluateAll((roots) => roots.flatMap((root) =>
      [root, ...root.querySelectorAll("*")].flatMap((el) => {
        const cs = getComputedStyle(el);
        // 影・グロー(box-shadow/text-shadow)内の色も抽出して検査する(Codexレビュー反映)。
        return [cs.color, cs.backgroundColor, cs.borderTopColor,
          ...[cs.boxShadow, cs.textShadow].flatMap((shadow) => shadow.match(/rgba?\([^)]*\)/g) || [])];
      })));
    check("GATE/APRONの実描画色に赤系が無い", t6Colors.every((color) => !isReddish(parseColor(color))), JSON.stringify(t6Colors));

    console.log("[25] RADARは未来5時間のboardFlightsだけを20件まで表示する");
    await page.clock.setFixedTime(fixedTime(0));
    // 300分境界は少数seedで独立検証する(25件seedだと20件切り捨てでも301分先が消え、境界を検証できない。レビューm5反映)。
    const radarEdge = [
      block("radar-edge", "300分ちょうど", today, 12 * 60 + 300),
      block("radar-far", "301分先", today, 12 * 60 + 301),
      block("radar-past", "過去便", today, 12 * 60 - 1),
      block("radar-routine", "除外ルーティン", today, 12 * 60 + 5, { category: "ルーティン" }),
      block("radar-onetap", "除外ワンタップ", today, 12 * 60 + 6, { oneTap: true })
    ];
    await seedT6(radarEdge);
    const edgeSet = (await page.locator("#towerRadarScope").getAttribute("data-radar-set")) || "";
    check("300分ちょうどは表示・301分先は除外(20件切り捨てと独立)", await page.locator(".tower-blip").count() === 1
      && edgeSet.includes(encodeURIComponent("radar-edge")) && !edgeSet.includes(encodeURIComponent("radar-far")), edgeSet);
    check("過去便・ルーティン・oneTapは対象外", ["radar-past", "radar-routine", "radar-onetap"]
      .every((id) => !edgeSet.includes(encodeURIComponent(id))), edgeSet);
    const radarCrowd = Array.from({ length: 25 }, (_, index) =>
      block(`radar-${index}`, `接近便${index}`, today, 12 * 60 + index * 10));
    await seedT6(radarCrowd);
    const radarSet = (await page.locator("#towerRadarScope").getAttribute("data-radar-set")) || "";
    check("未来便25件でもblipはMAX_BLIPS=20", await page.locator(".tower-blip").count() === 20);
    check("近い順の先頭20便だけを表示", radarSet.split(",").length === 20 && radarSet.includes("radar-0:0") && radarSet.includes("radar-19:190") && !radarSet.includes("radar-20:200"), radarSet);

    console.log("[26] RADAR blip座標は定刻とuntilから決定論的に算出する");
    const radarPair = [block("radar-near", "近距離", today, 13 * 60), block("radar-farther", "遠距離", today, 17 * 60)];
    await seedT6(radarPair);
    const readBlips = () => page.locator(".tower-blip").evaluateAll((els) => els.map((el) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) })));
    const firstBlips = await readBlips();
    const expectedPoint = (plannedMin, until) => {
      const radius = 10 + until / 300 * 32;
      const angle = (plannedMin % 720) / 720 * 2 * Math.PI - Math.PI / 2;
      return { left: 50 + Math.cos(angle) * radius, top: 50 + Math.sin(angle) * radius };
    };
    const expectedBlips = [expectedPoint(13 * 60, 60), expectedPoint(17 * 60, 300)];
    check("left/topは仕様式の許容誤差0.1%以内", firstBlips.every((point, index) =>
      Math.abs(point.left - expectedBlips[index].left) <= .1 && Math.abs(point.top - expectedBlips[index].top) <= .1), JSON.stringify(firstBlips));
    await seedT6(radarPair);
    const secondBlips = await readBlips();
    check("同じ入力を2回描くと同じ座標", JSON.stringify(firstBlips) === JSON.stringify(secondBlips), JSON.stringify(secondBlips));
    const distance = (point) => Math.hypot(point.left - 50, point.top - 50);
    check("untilが小さい便ほど中心に近い", distance(firstBlips[0]) < distance(firstBlips[1]), JSON.stringify(firstBlips));
    // tick経路: 分が進んでもblipは同一ノードのままin-placeで座標が変わる(remove→再生成だとtransitionが発火しない。レビューm2/m4反映)。
    // DOM同一性を計るため、起動時同期404後の全体render()を先に消化する([10][11]と同じ作法)。
    await page.waitForLoadState("networkidle");
    await page.locator(".tower-blip").first().evaluate((el) => { el.__t7marker = true; });
    const movedExpected = expectedPoint(13 * 60, 59);
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 1, 0, 0));
    await page.waitForFunction((left) => {
      const blip = document.querySelector(".tower-blip");
      return blip && Math.abs(parseFloat(blip.style.left) - left) <= .1;
    }, movedExpected.left);
    check("tickで同一ノードのままin-place移動する", await page.locator(".tower-blip").first().evaluate((el, top) =>
      el.__t7marker === true && Math.abs(parseFloat(el.style.top) - top) <= .1, movedExpected.top));
    await page.clock.setFixedTime(fixedTime(0));

    console.log("[27] 無線ログは復元で騒がず状態遷移だけを最新3行で実況する");
    const radioSeed = [block("radio-active", "着陸便", today, 11 * 60, { actualStartAt: atMinute(today, 11 * 60 + 30) }),
      block("radio-cross", "管制便", today, 12 * 60 + 5)];
    await seedT6(radioSeed);
    check("初回renderは挨拶1行だけ", await page.locator(".tower-radio-line").count() === 1
      && (await page.locator(".tower-radio-line").textContent()) === "TWR TASKCHUTE TOWER 運用開始");
    await page.locator('.tower-now-actions [data-action="now-conveyor-complete"][data-id="radio-active"]').click();
    await page.waitForFunction(() => document.getElementById("towerRadioLines")?.textContent.includes("スポット入り。おつかれさま"));
    const radioTexts = ["TWR TASKCHUTE TOWER 運用開始", (await page.locator(".tower-radio-line.is-new").textContent()) || ""];
    check("landing→arrivedでスポット入り実況が増える", radioTexts[1].includes("TC-701〈着陸便〉スポット入り。おつかれさま"), radioTexts[1]);
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 6, 0, 0));
    await page.waitForFunction(() => document.querySelector(".tower-radio-line.is-new")?.textContent.includes("リスロット"));
    radioTexts.push((await page.locator(".tower-radio-line.is-new").textContent()) || "");
    await page.clock.setFixedTime(fixedTime(0));
    await page.waitForFunction(() => document.querySelector(".tower-radio-line.is-new")?.textContent.includes("最終進入"));
    radioTexts.push((await page.locator(".tower-radio-line.is-new").textContent()) || "");
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 6, 0, 0));
    await page.waitForFunction(() => document.querySelector(".tower-radio-line.is-new")?.textContent.includes("リスロット"));
    radioTexts.push((await page.locator(".tower-radio-line.is-new").textContent()) || "");
    check("4遷移後も最新3行だけを保持", await page.locator(".tower-radio-line").count() === 3
      && !(await page.locator("#towerRadioLines").textContent()).includes("スポット入り。おつかれさま"));
    check("is-newは最新行だけ", await page.locator(".tower-radio-line.is-new").count() === 1
      && await page.locator(".tower-radio-line:last-child.is-new").count() === 1);
    // landingテンプレートも実生成して検証する(4テンプレ中landingだけ未検証だった。Codexレビュー反映)。
    // now-startは宣言モーダルを挟むため「宣言せず開始」で確定する(既存導線どおり)。
    await page.locator('.tower-nowhud [data-action="now-start"][data-id="radio-cross"]').click();
    await page.locator('[data-action="declare-skip"]').click();
    await page.waitForFunction(() => document.querySelector(".tower-radio-line.is-new")?.textContent.includes("着陸中"));
    radioTexts.push((await page.locator(".tower-radio-line.is-new").textContent()) || "");
    check("開始操作でlanding実況(着陸中)が増える", radioTexts[radioTexts.length - 1] === "TC-703〈管制便〉着陸中", radioTexts[radioTexts.length - 1]);

    console.log("[28] 無線文は確定語彙だけ、RADAR/無線色は非赤系だけを使う");
    const allowedRadio = /^(?:TWR TASKCHUTE TOWER 運用開始|TC-\d+〈[^〉]+〉(?:最終進入 定刻 \d{2}:\d{2}|着陸中|スポット入り。おつかれさま|リスロット))$/;
    const forbiddenT7 = ["遅延", "DELAYED", "未達", "失敗", "急いで", "オーバー"];
    check("生成した全無線文が確定テンプレだけ", radioTexts.every((line) => allowedRadio.test(line)), JSON.stringify(radioTexts));
    check("無線文に禁止語を含まない", forbiddenT7.every((word) => radioTexts.every((line) => !line.includes(word))), JSON.stringify(radioTexts));
    const t7Colors = await page.locator(".tower-radar, .tower-radio").evaluateAll((roots) => roots.flatMap((root) =>
      [root, ...root.querySelectorAll("*")].flatMap((el) => {
        const cs = getComputedStyle(el);
        // 走査線・スコープ地のグラデーション色(background-image)も抽出して検査する(Codexレビュー反映)。
        return [cs.color, cs.backgroundColor, cs.borderTopColor,
          ...[cs.boxShadow, cs.textShadow, cs.backgroundImage].flatMap((value) => value.match(/rgba?\([^)]*\)/g) || [])];
      })));
    check("RADAR/無線の実描画色に赤系が無い", t7Colors.every((color) => !isReddish(parseColor(color))), JSON.stringify(t7Colors));

    const seedT8 = async ({ blocks = [], zeroThinking = null, pomodoro = null } = {}) => {
      await page.evaluate(({ KEY, blocks, zeroThinking, pomodoro }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.currentView = "today";
        s.blocks = blocks;
        s.pomodoro = pomodoro
          ? { ...s.pomodoro, ...pomodoro }
          : { ...s.pomodoro, running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
        s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [], ...(zeroThinking || {}) };
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks, zeroThinking, pomodoro });
      await page.reload();
      await page.waitForSelector(".tower-annex", { state: "attached" });
    };

    console.log("[29] annex収容と航空語彙見出し");
    await page.clock.setFixedTime(fixedTime(0));
    await seedT8();
    await page.waitForLoadState("networkidle");
    check("highlights未取得時はINFLIGHT MAGパネルだけ存在しない", await page.locator(".tower-annex .today-kindle").count() === 0
      && await page.locator(".tower-annex .today-pomodoro, .tower-annex .today-zero, .tower-annex .today-replan").count() === 3);
    const highlightsFixture = { generatedAt: "2026-08-17T00:00:00Z", books: [{
      id: "tower-book", title: "TOWER BOOK", author: "T8", count: 1,
      highlights: [{ ref: "tower-ref", text: "T8 INFLIGHT HIGHLIGHT", location: 1 }]
    }] };
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path.endsWith("/contents/taskchute/reading/highlights.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(highlightsFixture) });
      }
      return route.fallback();
    });
    await seedT8();
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".tower-annex .today-kindle", { state: "attached" });
    const annexHeadings = await page.locator(".tower-annex h2.today-panel-title").allTextContents();
    check("annexにCABIN TIMER / INFLIGHT MAG / LOGBOOK / RESEQUENCEを収容",
      ["CABIN TIMER", "INFLIGHT MAG", "LOGBOOK", "RESEQUENCE"].every((label) => annexHeadings.some((text) => text.includes(label))),
      JSON.stringify(annexHeadings));
    check("annex見出しにcockpit語彙を残さない",
      ["POMODORO", "ZERO-SEC LAUNCH", "REPLAN"].every((label) => annexHeadings.every((text) => !text.includes(label))),
      JSON.stringify(annexHeadings));
    check("tower-annexは無線ログ直後のDOM末尾", await page.evaluate(() => {
      const tower = document.querySelector(".today-tower");
      const annex = tower?.querySelector(":scope > .tower-annex");
      return annex === tower?.lastElementChild && annex?.previousElementSibling?.classList.contains("tower-radio");
    }));

    console.log("[30] CABIN TIMER実働");
    const pomoT8 = block("pomo-t8", "CABIN TIMER検証", today, 12 * 60 + 30, { estimateMin: 25 });
    await seedT8({ blocks: [pomoT8] });
    await page.locator('.tower-annex .today-pomodoro [data-action="start-pomodoro"]').click();
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.pomodoro.running === true && s.pomodoro.blockId === "pomo-t8";
    }, KEY);
    check("既存start-pomodoroでLIVE表示へ変わる", await page.locator(".tower-annex .today-pomodoro .today-panel-title b").textContent() === "LIVE"
      && (await page.locator("#todayPomodoroMode").textContent())?.includes("作業中"));
    const pomoBefore = (await page.locator(".tower-annex .today-pomodoro .pomo-time-overlay").textContent()) || "";
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 1, 0));
    await page.waitForFunction((before) => document.querySelector(".tower-annex .today-pomodoro .pomo-time-overlay")?.textContent !== before, pomoBefore);
    check("tower tickでCABIN TIMER残り時間が更新される",
      (await page.locator(".tower-annex .today-pomodoro .pomo-time-overlay").textContent()) !== pomoBefore);

    console.log("[31] LOGBOOK実働");
    const zeroTheme = { id: "zero-t8", text: "T8 LOGBOOKテーマ", fav: false, groupId: null, createdAt: atMinute(today, 8 * 60) };
    await seedT8({ zeroThinking: { themes: [zeroTheme] } });
    await page.locator('.tower-annex .today-zero [data-action="today-zero-write"]').click();
    await page.waitForSelector(".tower-annex #todayZeroText", { state: "visible" });
    await page.locator(".tower-annex #todayZeroText").fill("T8 LOGBOOK本文");
    await page.locator('.tower-annex .today-zero [data-action="today-zero-save"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).zeroThinking.entries.length === 1, KEY);
    const zeroEntry = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).zeroThinking.entries[0], KEY);
    check("既存actionでLOGBOOK entryを保存", zeroEntry.theme === "T8 LOGBOOKテーマ" && zeroEntry.body === "T8 LOGBOOK本文", JSON.stringify(zeroEntry));

    console.log("[32] RESEQUENCE実働");
    check("annexに既存today-replanボタンが存在", await page.locator('.tower-annex [data-action="today-replan"]').count() === 1);

    console.log("[33] 1440pxで3面卓");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState("networkidle");
    const desktopLayout = await page.evaluate(() => {
      const root = document.querySelector(".today-tower");
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { x: box.x, width: box.width };
      };
      return {
        columns: getComputedStyle(root).gridTemplateColumns,
        board: rect(".tower-board"), runway: rect(".tower-runway"), gates: rect(".tower-gates"),
        radio: rect(".tower-radio"), annex: rect(".tower-annex")
      };
    });
    const columnParts = desktopLayout.columns.trim().split(/\s+/);
    check("grid列は340pxで始まり320pxで終わる", columnParts[0] === "340px" && columnParts[columnParts.length - 1] === "320px", desktopLayout.columns);
    // サイドバー分を差し引いても中央列が実用幅を持つこと(1024px時に18pxへ潰れた盲点の再発防止)。
    check("中央列は300px以上", columnParts.length === 3 && parseFloat(columnParts[1]) >= 300, desktopLayout.columns);
    check("board < runway < gatesの3カラム実配置", desktopLayout.board.x < desktopLayout.runway.x && desktopLayout.runway.x < desktopLayout.gates.x,
      JSON.stringify(desktopLayout));
    check("radioとannexは同じ全幅", Math.abs(desktopLayout.radio.x - desktopLayout.annex.x) < 1
      && Math.abs(desktopLayout.radio.width - desktopLayout.annex.width) < 1, JSON.stringify(desktopLayout));
    // 下限境界1280px(最も中央列が潰れやすい点)でも3面卓が成立し中央列が実用幅を持つこと(レビューm1)。
    await page.setViewportSize({ width: 1280, height: 800 });
    const boundaryColumns = await page.evaluate(() => getComputedStyle(document.querySelector(".today-tower")).gridTemplateColumns);
    const boundaryParts = boundaryColumns.trim().split(/\s+/);
    check("境界1280pxでも3カラムかつ中央列300px以上", boundaryParts.length === 3
      && boundaryParts[0] === "340px" && boundaryParts[2] === "320px" && parseFloat(boundaryParts[1]) >= 300, boundaryColumns);

    console.log("[34] 390/768/1024pxで1カラム・横はみ出しなし");
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await page.waitForLoadState("networkidle");
      const mobileLayout = await page.evaluate(() => {
        const board = document.querySelector(".tower-board").getBoundingClientRect();
        const runway = document.querySelector(".tower-runway").getBoundingClientRect();
        return { boardX: board.x, runwayX: runway.x, scrollWidth: document.scrollingElement.scrollWidth, innerWidth };
      });
      check(`${viewport.width}pxはboard/runwayが縦積み`, Math.abs(mobileLayout.boardX - mobileLayout.runwayX) < 1, JSON.stringify(mobileLayout));
      check(`${viewport.width}pxは横はみ出しなし`, mobileLayout.scrollWidth <= mobileLayout.innerWidth, JSON.stringify(mobileLayout));
    }

    console.log("[35] annexでspan-2が無効");
    await page.setViewportSize({ width: 1440, height: 900 });
    const annexDesktopWidths = await page.evaluate(() => ({
      annex: document.querySelector(".tower-annex").getBoundingClientRect().width,
      pomodoro: document.querySelector(".tower-annex .today-pomodoro").getBoundingClientRect().width
    }));
    check("1440pxはpomodoroがannex幅の約半分", annexDesktopWidths.pomodoro / annexDesktopWidths.annex > .45
      && annexDesktopWidths.pomodoro / annexDesktopWidths.annex < .55, JSON.stringify(annexDesktopWidths));
    // 768pxは.today-span-2のspan 2が生きる帯(>720px)。annex側の無効化が外れると暗黙2カラム化して横溢れする(レビューm2)。
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      const annexMobileWidths = await page.evaluate(() => ({
        annex: document.querySelector(".tower-annex").getBoundingClientRect().width,
        pomodoro: document.querySelector(".tower-annex .today-pomodoro").getBoundingClientRect().width
      }));
      check(`${viewport.width}pxはpomodoroがannex全幅`, annexMobileWidths.pomodoro / annexMobileWidths.annex > .95, JSON.stringify(annexMobileWidths));
    }

    console.log("[36] reduced-motionは演出を止めても数字を更新する");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(fixedTime(0));
    await seedT8();
    const reducedTransitions = await page.evaluate(() => ({
      needle: getComputedStyle(document.querySelector(".tower-gauge-needle")).transitionProperty,
      plane: getComputedStyle(document.querySelector("#towerPlane")).transitionProperty,
      sweep: getComputedStyle(document.querySelector(".tower-radar-sweep")).animationName,
      // 接地フラッシュはanimationend削除に依存するため、animationが止まる環境では出さない契約(2系統レビューM1)。
      touchdown: (() => {
        const strip = document.querySelector(".tower-runway-strip");
        strip.insertAdjacentHTML("beforeend", '<i class="tower-touchdown"></i>');
        const display = getComputedStyle(strip.querySelector(".tower-touchdown")).display;
        strip.querySelector(".tower-touchdown").remove();
        return display;
      })()
    }));
    check("reduced-motionでneedle/planeのtransitionがnone", reducedTransitions.needle === "none" && reducedTransitions.plane === "none",
      JSON.stringify(reducedTransitions));
    check("reduced-motionで走査線が止まり接地フラッシュは出ない", reducedTransitions.sweep === "none" && reducedTransitions.touchdown === "none",
      JSON.stringify(reducedTransitions));
    const reducedClockBefore = await page.locator("#towerClock").textContent();
    await page.clock.setFixedTime(fixedTime(1));
    await page.waitForFunction((before) => document.querySelector("#towerClock")?.textContent !== before, reducedClockBefore);
    check("reduced-motionでも時計の数字は更新される", await page.locator("#towerClock").textContent() !== reducedClockBefore);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    console.log("[37] data-pausedで非表示中のCSS animationを停止する");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const pausedState = await page.evaluate(() => ({
      paused: document.querySelector(".today-tower").dataset.paused,
      playState: getComputedStyle(document.querySelector(".tower-radar-sweep")).animationPlayState
    }));
    check("hidden=trueでdata-paused=1かつ走査線paused", pausedState.paused === "1" && pausedState.playState === "paused", JSON.stringify(pausedState));
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const resumedState = await page.evaluate(() => ({
      paused: document.querySelector(".today-tower").dataset.paused,
      playState: getComputedStyle(document.querySelector(".tower-radar-sweep")).animationPlayState
    }));
    check("hidden=falseでdata-paused=0かつ走査線running", resumedState.paused === "0" && resumedState.playState === "running", JSON.stringify(resumedState));

    console.log("[38] 21:00〜4:59は夜間色温度へ切り替わる");
    const clockAt = (hour, minute = 0, second = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, second, 0);
    await page.clock.setFixedTime(clockAt(22));
    await seedT8();
    const towerTokens = () => ({
      night: document.querySelector(".today-tower").dataset.night,
      cyan: getComputedStyle(document.querySelector(".today-tower")).getPropertyValue("--tower-cyan").trim(),
      amber: getComputedStyle(document.querySelector(".today-tower")).getPropertyValue("--tower-amber").trim()
    });
    const nightStyle = await page.evaluate(towerTokens);
    await page.clock.setFixedTime(clockAt(12));
    await seedT8();
    const dayStyle = await page.evaluate(towerTokens);
    check("22時はdata-night=1で昼とcyan/amberが異なる", nightStyle.night === "1" && dayStyle.night === "0"
      && nightStyle.cyan !== dayStyle.cyan && nightStyle.amber !== dayStyle.amber,
      JSON.stringify({ nightStyle, dayStyle }));
    await page.clock.setFixedTime(clockAt(4, 59));
    await seedT8();
    const beforeDawn = await page.locator(".today-tower").getAttribute("data-night");
    await page.clock.setFixedTime(clockAt(5));
    await page.waitForFunction(() => document.querySelector(".today-tower")?.dataset.night === "0");
    check("4:59は夜間で5:00にtickで昼へ戻る", beforeDawn === "1");
    await page.clock.setFixedTime(clockAt(20, 59, 59));
    await seedT8();
    await page.clock.setFixedTime(clockAt(21));
    await page.waitForFunction(() => document.querySelector(".today-tower")?.dataset.night === "1");
    check("tickで20:59から21:00をまたぐとdata-night=1", await page.locator(".today-tower").getAttribute("data-night") === "1");

    console.log("[39] towerMotionはnormal/calm/offの3段で保存・描画される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.settings.towerMotion;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForSelector(".today-tower");
    check("towerMotion未定義はnormalへ正規化", await page.locator(".today-tower").getAttribute("data-motion") === "normal");
    await page.locator('#sidebar [data-action="nav"][data-view="settings"]').click();
    await page.waitForSelector('#app[data-view="settings"]');
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-display"]'); if (fold) fold.open = true; });
    const motionSelect = page.locator('select[data-setting-field="towerMotion"]');
    check("towerMotion selectは3択", await motionSelect.locator("option").count() === 3);
    await motionSelect.selectOption("off");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.towerMotion === "off", KEY);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector('.today-tower[data-motion="off"]');
    check("offはstate保存され走査線animation-nameがnone", await page.locator(".tower-radar-sweep").evaluate((el) => getComputedStyle(el).animationName) === "none");
    const offExtras = await page.evaluate(() => {
      const strip = document.querySelector(".tower-runway-strip");
      strip.insertAdjacentHTML("beforeend", '<i class="tower-touchdown"></i>');
      const touchdown = getComputedStyle(strip.querySelector(".tower-touchdown")).display;
      strip.querySelector(".tower-touchdown").remove();
      return { touchdown };
    });
    check("offでも接地フラッシュは出ない(残留防止)", offExtras.touchdown === "none", JSON.stringify(offExtras));
    const offClockBefore = await page.locator("#towerClock").textContent();
    await page.clock.setFixedTime(clockAt(12, 0, 30));
    await page.waitForFunction((before) => document.querySelector("#towerClock")?.textContent !== before, offClockBefore);
    check("offでも時計の数字は更新される", await page.locator("#towerClock").textContent() !== offClockBefore);
    await page.locator('#sidebar [data-action="nav"][data-view="settings"]').click();
    await page.waitForSelector('#app[data-view="settings"]');
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-display"]'); if (fold) fold.open = true; });
    await page.locator('select[data-setting-field="towerMotion"]').selectOption("calm");
    await seedT8({ blocks: [block("calm-event", "イベント演出確認", today, 13 * 60)] });
    await page.waitForSelector('.today-tower[data-motion="calm"]');
    const calmAnimations = await page.evaluate(() => ({
      sweep: getComputedStyle(document.querySelector(".tower-radar-sweep")).animationName,
      event: (() => {
        const status = document.querySelector(".tower-status");
        status.classList.add("is-flip");
        return getComputedStyle(status).animationName;
      })()
    }));
    check("calmは常時走査線だけ止めイベント演出を残す", calmAnimations.sweep === "none" && calmAnimations.event !== "none", JSON.stringify(calmAnimations));

    console.log("[40] m7文言とm4の1280px内部横スクロールを回収する");
    await page.locator('#sidebar [data-action="nav"][data-view="settings"]').click();
    await page.waitForSelector('#app[data-view="settings"]');
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-display"]'); if (fold) fold.open = true; });
    check("todaySkin設定UIは後半の設定再訪でも復活しない", await page.locator('select[data-setting-field="todaySkin"]').count() === 0);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".tower-annex .today-pomodoro-stage");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForLoadState("networkidle");
    const pomodoroOverflow = await page.locator(".tower-annex .today-pomodoro-stage").evaluate((el) => ({
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth
    }));
    check("1280pxでpomodoro stageに内部横スクロールなし", pomodoroOverflow.scrollWidth <= pomodoroOverflow.clientWidth,
      JSON.stringify(pomodoroOverflow));

    console.log("[41] annexテキストの効果コントラストがテーマ非依存で4.5:1以上(v212)");
    // v212: T8/T9/v211と3連続でlightテーマの可読性指摘が出たため機械検査に固定する。
    // 効果コントラスト=要素と祖先のopacity・祖先背景のalpha合成を含むWCAG比。祖先opacityは
    // テキスト側にのみ乗じ背景層へは乗じないため、常に保守側(低め)の見積もりになり偽PASSは生まない。
    // CSS側のスコープは.today-tower、本検査は.tower-annex内に実在する要素に限る(annex外へ同クラスを
    // 使う場合は別途対象追加が要る)。annexへ検査対象を足すときは該当配列へ1行追加する。
    const measureContrast = (selectors) => page.evaluate((selectors) => {
      const toLin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const luminance = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
      const parseColor = (str) => (str.match(/[\d.]+/g) || []).map(Number);
      const blend = (top, alpha, bottom) => bottom.map((c, i) => top[i] * alpha + c * (1 - alpha));
      const contrastOf = (el) => {
        // 祖先を遡り、最初の不透明背景を基底に半透明背景を遠い側から合成する
        const layers = [];
        let node = el.parentElement;
        let base = [255, 255, 255];
        while (node && node !== document.documentElement) {
          const bg = parseColor(getComputedStyle(node).backgroundColor);
          if (bg.length >= 3 && (bg.length < 4 || bg[3] > 0)) {
            if (bg.length < 4 || bg[3] >= 1) { base = bg.slice(0, 3); break; }
            layers.push({ rgb: bg.slice(0, 3), a: bg[3] });
          }
          node = node.parentElement;
        }
        for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i].rgb, layers[i].a, base);
        // テキスト実効色=color×(color alpha×要素と祖先のopacity積)を背景へ合成
        const cs = getComputedStyle(el);
        const text = parseColor(cs.color);
        let alpha = (text.length >= 4 ? text[3] : 1);
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          alpha *= parseFloat(getComputedStyle(n).opacity);
        }
        const effective = blend(text.slice(0, 3), alpha, base);
        const [l1, l2] = [luminance(effective), luminance(base)].sort((a, b) => b - a);
        return (l1 + 0.05) / (l2 + 0.05);
      };
      return selectors.map((selector) => {
        const els = [...document.querySelectorAll(selector)];
        return { selector, count: els.length, ratios: els.map((el) => Math.round(contrastOf(el) * 100) / 100) };
      });
    }, selectors);
    const checkContrast = (theme, results) => {
      for (const r of results) {
        check(`${theme}: ${r.selector} が存在する`, r.count > 0, JSON.stringify(r));
        check(`${theme}: ${r.selector} の効果コントラスト>=4.5`, r.count > 0 && r.ratios.every((v) => v >= 4.5), JSON.stringify(r));
      }
    };
    const annexContrastTargets = [
      ".tower-annex .today-replan-status > span:not(.sync-dot)",
      ".tower-annex .today-empty",
      ".tower-annex .today-deck-nav > span"
    ];
    const writebarContrastTargets = [
      ".tower-annex .today-zero-writebar > span",
      ".tower-annex .today-zero-writebar time"
    ];
    for (const theme of ["light", "dark"]) {
      await page.evaluate(({ KEY, theme }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.settings.theme = theme;
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, theme });
      // 空queue(CABIN TIMERのtoday-empty)と0秒思考テーマあり(LOGBOOKのdeck-nav)を同時に出す
      await seedT8({ zeroThinking: { themes: [
        { id: "zero-v212", text: "v212コントラスト検査テーマ", fav: false, groupId: null, createdAt: atMinute(today, 8 * 60) }
      ] } });
      await page.waitForLoadState("networkidle");
      // normalizeStateが許可値外をdarkへ落とすため、light側が黙ってdarkを測る空回りを防ぐ(レビューm-2)
      check(`${theme}テーマが適用されている`, await page.evaluate(() => document.documentElement.dataset.theme) === theme);
      checkContrast(theme, await measureContrast(annexContrastTargets));
      // LOGBOOK書き込みモードのwritebar(レビューB-2: deck-navと排他描画のため書き込みモードで測る)
      await page.locator('.tower-annex [data-action="today-zero-write"]').click();
      await page.waitForSelector(".tower-annex #todayZeroText", { state: "visible" });
      checkContrast(theme, await measureContrast(writebarContrastTargets));
      await page.evaluate(() => document.querySelector(".tower-annex .today-zero-writebar time").classList.add("is-over"));
      checkContrast(theme, await measureContrast([".tower-annex .today-zero-writebar time.is-over"]));
    }
    // Codexレビュー(v212 P2)の再発防止: .sync-dotの祖先にopacityを掛けるとドット自身の.7へ複合して
    // 図形基準3:1を割る。ドットの祖先opacity積が1のままであることを固定する。
    const dotAncestorOpacity = await page.evaluate(() => {
      const dot = document.querySelector(".tower-annex .today-replan-status .sync-dot");
      if (!dot) return null;
      let product = 1;
      for (let n = dot.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        product *= parseFloat(getComputedStyle(n).opacity);
      }
      return product;
    });
    check("RESEQUENCEのsync-dotへ祖先opacityが複合しない", dotAncestorOpacity === 1, String(dotAncestorOpacity));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
