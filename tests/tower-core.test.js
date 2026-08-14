// tests/tower-core.test.js — v203 TOWER T2のスキン切替・TWRヘッダ契約E2E。
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
      const els = [".tower-time time", ".tower-day-left strong", ".tower-eyebrow", ".tower-beacon i"]
        .map((sel) => [sel, getComputedStyle(root.querySelector(sel)).color]);
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
    const pad2 = (n) => String(n).padStart(2, "0");
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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
