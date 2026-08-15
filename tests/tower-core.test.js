// tests/tower-core.test.js — v204 TOWERのスキン・TWRヘッダ・発着ボード契約E2E。
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
      s.settings.todaySkin = "tower";
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

    console.log("[1] todaySkin未設定・不正値はcockpitへ正規化される");
    await seedSkin("__missing__");
    check("未設定では既存.today-cockpitが描画される", await page.locator(".today-cockpit").count() === 1);
    check("未設定では.today-towerを描画しない", await page.locator(".today-tower").count() === 0);
    await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').click();
    await page.waitForSelector('#app[data-view="tasks"]');
    check("未設定値は保存時にcockpitへ正規化される", await storedSkin() === "cockpit", await storedSkin());

    await seedSkin("unknown-skin");
    check("不正値でも既存.today-cockpitが描画される", await page.locator(".today-cockpit").count() === 1);
    await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').click();
    await page.waitForSelector('#app[data-view="tasks"]');
    check("不正値は保存時にcockpitへ正規化される", await storedSkin() === "cockpit", await storedSkin());

    console.log("[2] 設定UIでtowerへ切り替えるとTWRヘッダが描画される");
    await seedSkin("cockpit", "settings");
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-display"]'); if (fold) fold.open = true; });
    const skinSelect = page.locator('select[data-setting-field="todaySkin"]');
    check("今日タブの表示selectにtower選択肢がある", await skinSelect.locator('option[value="tower"]').count() === 1);
    await skinSelect.selectOption("tower");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.todaySkin === "tower", KEY);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".today-tower");
    check("tower選択で.today-towerが描画される", await page.locator(".today-tower").count() === 1);
    check("tower選択では.today-cockpitを描画しない", await page.locator(".today-cockpit").count() === 0);
    const firstLeft = (await page.locator("#towerDayLeft").textContent()) || "";
    check("#towerDayLeftはHH:MM:SS形式", /^\d{2}:\d{2}:\d{2}$/.test(firstLeft), firstLeft);

    console.log("[3] 既存1秒tickerで本日残りが減る");
    await page.clock.setFixedTime(fixedTime(1));
    await page.waitForFunction((before) => document.getElementById("towerDayLeft")?.textContent !== before, firstLeft);
    const secondLeft = (await page.locator("#towerDayLeft").textContent()) || "";
    const toSeconds = (text) => text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
    check("1秒進行で#towerDayLeftが1秒減る", toSeconds(firstLeft) - toSeconds(secondLeft) === 1, `${firstLeft} -> ${secondLeft}`);

    console.log("[4] cockpitへ戻すと既存DOM契約が復元される");
    await page.locator('#sidebar [data-action="nav"][data-view="settings"]').click();
    await page.waitForSelector('#app[data-view="settings"]');
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-display"]'); if (fold) fold.open = true; });
    await page.locator('select[data-setting-field="todaySkin"]').selectOption("cockpit");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.todaySkin === "cockpit", KEY);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".today-now-focus");
    check("cockpit復帰で.today-cockpitが描画される", await page.locator(".today-cockpit").count() === 1);
    check("cockpit復帰で既存.today-now-focusが復元される", await page.locator(".today-now-focus").count() === 1);

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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
