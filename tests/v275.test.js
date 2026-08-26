// v275: TOWER上帯1(LIFE BAND+時計)と全幅STANDING ORDERSの単一DOM契約を固定する。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.resolve(__dirname, "..");
const PORT = randomPort();
const ARTIFACTS = path.join(ROOT, "artifacts", "v275");
const topbandSource = fs.readFileSync(path.join(ROOT, "src", "features", "topband.js"), "utf8");
const towerSource = fs.readFileSync(path.join(ROOT, "src", "features", "today-tower.js"), "utf8");
const todaySource = fs.readFileSync(path.join(ROOT, "src", "features", "today.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

(async () => {
  console.log("[1] 静的契約・200行分割境界・iOS/SWガード");
  check("topbandはrenderLifeBand/renderStandingOrdersの単一API", topbandSource.includes("export function renderLifeBand()")
    && topbandSource.includes("export function renderStandingOrders()")
    && !/export function (?:renderCountdown|renderTopbandPC|creedRotationLine)/.test(topbandSource));
  check("today-towerは旧ヘッダ信条・二重上帯を参照しない", !/towerEyebrow|creedRotationLine|renderTopbandPC|renderCountdown/.test(towerSource));
  check("Today ticker登録値は1000ms", /setInterval\(updateTodayTick,\s*1000\)/.test(todaySource));
  check("旧二重DOMクラスは実行コード/CSSから消滅", !/sec-(?:life|creed)(?:-pc)?|tower-topband-pc/.test(`${topbandSource}\n${towerSource}\n${stylesSource}`));
  check("LIFE BANDはGLASS共通クラス・ビーコン・12WY内訳を含む", /tower-glass-panel life-band/.test(topbandSource)
    && /tower-beacon/.test(topbandSource) && /twyScoreHTML\(digest\).*twyCommitBannerHTML\(digest\)/s.test(topbandSource));
  check("PC上帯は7:3、SOは3列、外側grid順はlife→so→focus", /grid-template-columns:\s*minmax\(0, 7fr\) minmax\(0, 3fr\)/.test(stylesSource)
    && /\.so-grid\s*\{\s*grid-template-columns:\s*repeat\(3/.test(stylesSource)
    && /"life\s+life\s+life"\s*\n\s*"so\s+so\s+so"\s*\n\s*"focus\s+focus\s+focus"/.test(stylesSource));
  check("新3パネルは角丸内の罫線をoverflow hiddenでクリップ", /\.so-row\s*\{[^}]*overflow:\s*hidden/.test(stylesSource)
    && /\.life-band\s*\{[^}]*overflow:\s*hidden/.test(stylesSource)
    && /\.clock-box\s*\{[^}]*overflow:\s*hidden/.test(stylesSource));
  const executableTopband = topbandSource.replace(/\/\/.*$/gm, "");
  check("iOS禁止の日付文字列パース・個別listenerを追加しない", !/new Date\s*\(\s*["'`]/.test(executableTopband)
    && !topbandSource.includes("addEventListener"));
  // v276: 本スイートのUI契約は維持しつつ、後続実行コード変更に必要なCACHE_NAME +1へ期待値を追従する。
  check("CACHE_NAMEは後続v276", /^const CACHE_NAME = "taskchute-journal-pwa-v276";/m.test(swSource));
  const topband = await import(pathToFileURL(path.join(ROOT, "src", "features", "topband.js")).href);
  topband.configureTopband({ escapeHTML: (value) => String(value), todayISO: () => "2026-08-26",
    getSettings: () => ({ twelveWeekStartDate: "2026-08-15", birthDate: "" }), getTrackDigest: () => null });
  const noBirthHTML = topband.renderLifeBand();
  check("birthDate未設定分岐は45/80歳セルを描画しない", (noBirthHTML.match(/class="life-sig(?: |")/g) || []).length === 2
    && !noBirthHTML.includes("45歳まで") && !noBirthHTML.includes("80歳まで"));

  const server = startServer(PORT);
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(new Date(2026, 7, 26, 14, 3, 27));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const TODAY = "2026-08-26", WEEK = "2026-08-22", CYCLE = "2026-08-15", NOW = `${TODAY}T10:00:00`;
    async function seed({ birthDate = "1980-01-01", hasMeta = true, candidate = false, tracks = false, blurOff = false } = {}) {
      await page.evaluate(({ key, today, week, cycle, now, birthDate, hasMeta, candidate, tracks, blurOff }) => {
        const state = JSON.parse(localStorage.getItem(key));
        state.currentView = "today"; state.selectedDate = today;
        state.settings.twelveWeekStartDate = cycle; state.settings.birthDate = birthDate;
        state.weeklyCommitments = hasMeta ? [
          { id: `wcw_${week}`, recordType: "week", weekStart: week, cycleStartDate: cycle,
            committedAt: now, committedVia: "manual", selectedBlockIds: ["score-1"], updatedAt: now, deleted: false },
          { id: `wci_${week}_score-1`, recordType: "item", weekStart: week, lane: "cycle", blockId: "score-1",
            taskId: "task-1", projectId: "project-1", trackId: "", title: "score-1", plannedDate: today,
            completedAt: now, completedChangedAt: now, excused: false, excusedReason: "", source: "confirmed", updatedAt: now, deleted: false }
        ] : [];
        state.projects = candidate ? [{ id: "project-1", kind: "normal", title: "候補", status: "active", priority: "中",
          category: "", startDate: cycle, dueDate: "", description: "", twelveWeekStartDate: cycle,
          showProgress: false, collapsed: false, createdAt: now, updatedAt: now, deleted: false }] : tracks ? [
          { id: "project-track-a", kind: "normal", title: "TRACK A", status: "active", priority: "中", category: "", startDate: cycle, dueDate: "", description: "", twelveWeekStartDate: cycle, showProgress: false, collapsed: false, createdAt: now, updatedAt: now, deleted: false },
          { id: "project-track-b", kind: "normal", title: "TRACK B", status: "active", priority: "中", category: "", startDate: cycle, dueDate: "", description: "", twelveWeekStartDate: cycle, showProgress: false, collapsed: false, createdAt: now, updatedAt: now, deleted: false }
        ] : [];
        state.tasks = candidate ? [{ id: "task-1", projectId: "project-1", parentTaskId: "", title: "候補", category: "",
          status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 1, createdAt: now, updatedAt: now, deleted: false }] : [];
        state.blocks = candidate ? [{ id: "score-1", taskId: "task-1", date: today, title: "候補", plannedStart: "10:00",
          plannedEnd: "10:30", completed: false, actualStartAt: "", actualEndAt: "", createdAt: now, updatedAt: now, deleted: false }] : [];
        state.tracks = tracks ? [
          { id: "track-a", ownerType: "project", ownerId: "project-track-a", cycleStartDate: cycle, kind: "numeric", name: "非常に長いTRACK名でもLIFE BANDの角丸外へはみ出さないことを確認する航路", unit: "章", startDate: cycle, deadline: "2026-08-25", baselineValue: 0, goalValue: 100, valueStep: 1, milestones: [], status: "active", closedAt: "", closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: now, updatedAt: now, deleted: false },
          { id: "track-b", ownerType: "project", ownerId: "project-track-b", cycleStartDate: cycle, kind: "numeric", name: "SECOND TRACK", unit: "件", startDate: cycle, deadline: "2026-09-30", baselineValue: 0, goalValue: 100, valueStep: 1, milestones: [], status: "active", closedAt: "", closedReason: "", supersedesTrackId: "", carriedFromTrackId: "", createdAt: now, updatedAt: now, deleted: false }
        ] : [];
        state.trackMeasurements = tracks ? [
          { id: "measure-a", trackId: "track-a", value: 10, observedAt: now, updatedAt: now, deleted: false },
          { id: "measure-b", trackId: "track-b", value: 0, observedAt: now, updatedAt: now, deleted: false }
        ] : [];
        localStorage.setItem(key, JSON.stringify(state));
        if (blurOff) localStorage.setItem("taskchute-journal-glass-blur-off", "1");
        else localStorage.removeItem("taskchute-journal-glass-blur-off");
      }, { key: STATE_KEY, today: TODAY, week: WEEK, cycle: CYCLE, now: NOW, birthDate, hasMeta, candidate, tracks, blurOff });
      await page.reload(); await page.waitForSelector(".life-band");
    }

    async function layout() {
      return page.evaluate(() => {
        const rect = (selector) => { const box = document.querySelector(selector).getBoundingClientRect();
          return { x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
        const root = document.querySelector(".today-tower");
        const sigRows = [...new Set([...document.querySelectorAll(".life-band .life-sig")].map((el) => Math.round(el.getBoundingClientRect().top)))];
        return { root: rect(".today-tower"), band: rect(".tower-band1"), life: rect(".life-band"), clock: rect(".clock-box"), so: rect(".so-row"), focus: rect(".today-focus-bar"),
          sigs: document.querySelectorAll(".life-band .life-sig").length, soItems: document.querySelectorAll(".so-row .so-item").length,
          score: document.querySelectorAll(".life-band .twy-score").length,
          duplicateCount: document.querySelectorAll(".life-band, .clock-box, .so-row").length,
          headerCount: document.querySelectorAll(".tower-header, #towerEyebrow").length,
          soColumns: getComputedStyle(document.querySelector(".so-grid")).gridTemplateColumns, sigRows: sigRows.length,
          clockAlign: getComputedStyle(document.querySelector(".clock-box")).textAlign,
          gridAreas: getComputedStyle(root).gridTemplateAreas, scrollWidth: document.scrollingElement.scrollWidth, innerWidth,
          blurOff: root.dataset.glassBlur === "off" };
      });
    }

    console.log("[2] モバイル単一DOM・情報順・時計ticker");
    await seed();
    let mobile;
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      mobile = await layout();
      check(`${width}pxはLIFE→時計→SO→FOCUSの縦順・全幅`, mobile.life.top < mobile.clock.top && mobile.clock.bottom < mobile.so.top
        && mobile.so.bottom < mobile.focus.top && [mobile.life.width, mobile.clock.width, mobile.so.width].every((value) => Math.abs(value - mobile.band.width) < 1), JSON.stringify(mobile));
      check(`${width}pxは横溢れなし・LIFE指標2x2・時計左寄せ`, mobile.scrollWidth <= mobile.innerWidth
        && mobile.sigRows === 2 && mobile.clockAlign === "left", JSON.stringify(mobile));
    }
    check("4指標+12WYスコア+信条3件を単一DOM表示", mobile.sigs === 4 && mobile.score === 1
      && mobile.soItems === 3 && mobile.duplicateCount === 3, JSON.stringify(mobile));
    check("ヘッダ信条ローテDOMは完全に消滅", mobile.headerCount === 0);
    check("モバイルのSTANDING ORDERSは縦1列", mobile.soColumns.trim().split(/\s+/).length === 1, mobile.soColumns);
    await page.setViewportSize({ width: 390, height: 844 });
    const clockBefore = await page.locator("#towerClock").textContent();
    await page.clock.setFixedTime(new Date(2026, 7, 26, 14, 3, 28));
    await page.waitForFunction((before) => document.getElementById("towerClock")?.textContent !== before, clockBefore);
    check("移設後も時計は1秒tickerで更新", await page.locator("#towerClock").textContent() === "14:03:28");
    const creedTexts = ["決めた一つは、必ずやり切れる", "進んだ量で測る。実行率で自分を裁かない", "朝に全部を注ぐ。夜は手放して充電する"];
    const creedLocations = () => page.evaluate((texts) => {
      const count = (value, text) => value.split(text).length - 1;
      const so = document.querySelector(".so-row");
      const outside = document.querySelector(".today-tower").cloneNode(true); outside.querySelector(".so-row")?.remove();
      return texts.map((text) => ({ total: count(document.querySelector(".today-tower").textContent, text),
        so: count(so.textContent, text), outside: count(outside.textContent, text) }));
    }, creedTexts);
    const creedBefore = await creedLocations();
    await page.clock.setFixedTime(new Date(2026, 7, 26, 14, 3, 36));
    await page.waitForFunction(() => document.getElementById("towerClock")?.textContent === "14:03:36");
    const creedAfter = await creedLocations();
    check("3信条はSO内に各1回だけで8秒後もSO外へ再導入されない", [creedBefore, creedAfter].every((probe) =>
      probe.every((item) => item.total === 1 && item.so === 1 && item.outside === 0)), JSON.stringify({ creedBefore, creedAfter }));
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS, "tower-r2-mobile.png"), fullPage: true });

    console.log("[3] 1280px境界/PC 70:30・全grid順・SO全幅");
    let pc, boundaryPc;
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      pc = await layout();
      if (width === 1280) boundaryPc = pc;
      const ratio = pc.life.width / (pc.life.width + 12 + pc.clock.width);
      check(`${width}pxはLIFE 70%+時計30%・横溢れなし`, Math.abs(ratio - 0.7) < 0.01
        && Math.abs(pc.life.top - pc.clock.top) < 1 && pc.scrollWidth <= pc.innerWidth, JSON.stringify(pc));
      check(`${width}pxはSOが上帯全幅で直下`, Math.abs(pc.so.x - pc.life.x) < 1
        && Math.abs(pc.so.width - (pc.life.width + 12 + pc.clock.width)) < 1 && pc.so.top > pc.life.bottom, JSON.stringify(pc));
    }
    const expectedAreas = '"alert alert alert" "life life life" "so so so" "focus focus focus" "left center right" "timer timer timer"';
    check("1280px境界の外側grid全順序を固定", boundaryPc.gridAreas.replace(/\s+/g, " ") === expectedAreas, boundaryPc.gridAreas);
    check("PCは信条横3列・新3パネル各1件", pc.soColumns.trim().split(/\s+/).length === 3
      && pc.sigs === 4 && pc.soItems === 3 && pc.duplicateCount === 3, JSON.stringify(pc));
    const soType = await page.locator(".so-item").first().evaluate((item) => {
      const num = item.querySelector(".so-num"), em = item.querySelector("em"), small = item.querySelector("small");
      return { numWidth: num.getBoundingClientRect().width, numHeight: num.getBoundingClientRect().height,
        numFlex: getComputedStyle(num).flexShrink, numFont: getComputedStyle(num).fontSize,
        emFont: getComputedStyle(em).fontSize, smallFont: getComputedStyle(small).fontSize, smallFamily: getComputedStyle(small).fontFamily };
    });
    check("SOタイポグラフィはmock v5寸法・非monospace", soType.numWidth === 30 && soType.numHeight === 30
      && soType.numFlex === "0" && soType.numFont === "13px" && soType.emFont === "12.5px"
      && soType.smallFont === "8.5px" && !/mono|consolas/i.test(soType.smallFamily), JSON.stringify(soType));
    await page.screenshot({ path: path.join(ARTIFACTS, "tower-r2-pc.png"), fullPage: true });
    const geometry = (selectors) => page.evaluate((items) => {
      const life = document.querySelector(".life-band").getBoundingClientRect(), so = document.querySelector(".so-row").getBoundingClientRect();
      const boxes = items.map((selector) => { const el = document.querySelector(selector), box = el?.getBoundingClientRect();
        return { selector, present: Boolean(el), left: box?.left, right: box?.right, bottom: box?.bottom,
          internalFit: Boolean(el) && el.scrollWidth <= el.clientWidth + 1,
          visualFit: Boolean(el) && [...el.children].every((child) => { const childBox = child.getBoundingClientRect();
            return childBox.left >= box.left - 1 && childBox.right <= box.right + 1 && childBox.bottom <= box.bottom + 1; }) }; });
      return { life: { left: life.left, right: life.right, bottom: life.bottom }, soTop: so.top,
        pageFit: document.scrollingElement.scrollWidth <= innerWidth, boxes };
    }, selectors);

    console.log("[4] 12WY TRACKS/長文/未確定バナーの390/1280px幾何");
    await seed({ tracks: true });
    if (await page.locator('[data-action="twy-score-toggle"]').getAttribute("aria-expanded") === "false") {
      await page.locator('[data-action="twy-score-toggle"]').click();
    }
    let trackNameClippedAt390 = false;
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const expanded = await geometry([".twy-score-detail", ".twy-tracks-foot", ".twy-track-line"]);
      if (width === 390) trackNameClippedAt390 = await page.locator(".twy-track-line .t-name").first().evaluate((el) => el.scrollWidth > el.clientWidth);
      check(`${width}px TRACKS展開はLIFE内・SO押下げ・横溢れなし`, expanded.pageFit && expanded.soTop >= expanded.life.bottom
        && expanded.boxes.every((box) => box.present && box.left >= expanded.life.left - 1 && box.right <= expanded.life.right + 1
          && box.bottom <= expanded.life.bottom + 1 && box.visualFit), JSON.stringify(expanded));
    }
    const trackNameStyle = await page.locator(".twy-track-line .t-name").first().evaluate((el) => ({
      overflow: getComputedStyle(el).overflow, ellipsis: getComputedStyle(el).textOverflow,
      whiteSpace: getComputedStyle(el).whiteSpace, clipped: el.scrollWidth > el.clientWidth }));
    check("TRACKS fixtureは複数行・長文を省略記号付きで実描画", await page.locator(".twy-track-line").count() === 2
      && (await page.locator(".twy-track-line").first().textContent()).includes("非常に長いTRACK名")
      && trackNameStyle.overflow === "hidden" && trackNameStyle.ellipsis === "ellipsis"
      && trackNameStyle.whiteSpace === "nowrap" && trackNameClippedAt390, JSON.stringify({ trackNameStyle, trackNameClippedAt390 }));
    await page.screenshot({ path: path.join(ARTIFACTS, "tower-r2-pc-expanded.png"), fullPage: true });

    console.log("[5] 負例: birthDate未設定・hasMeta=false・blur縮退");
    await seed({ birthDate: "", hasMeta: false, candidate: true });
    check("既存normalize既定birthDateでもLIFE BANDは4指標を維持", await page.locator(".life-band .life-sig").count() === 4
      && (await page.locator(".life-band").textContent()).includes("45歳まで")
      && (await page.locator(".life-band").textContent()).includes("80歳まで"));
    check("hasMeta=false候補ありは12WYセル内バナーを維持", await page.locator('.life-sig.wy > .twy-commit-banner [data-action="twy-open-commit"]').count() === 1
      && await page.locator(".life-band > .twy-commit-banner").count() === 0);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const banner = await geometry([".life-sig.wy > .twy-commit-banner", '.twy-commit-banner [data-action="twy-open-commit"]']);
      check(`${width}px未確定バナーはLIFE内・SO押下げ・横溢れなし`, banner.pageFit && banner.soTop >= banner.life.bottom
        && banner.boxes.every((box) => box.present && box.left >= banner.life.left - 1 && box.right <= banner.life.right + 1
          && box.bottom <= banner.life.bottom + 1 && box.internalFit), JSON.stringify(banner));
    }
    await page.screenshot({ path: path.join(ARTIFACTS, "tower-r2-pc-banner.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await seed({ blurOff: true });
    const off = await page.locator(".life-band, .clock-box, .so-row").evaluateAll((panels) => panels.map((panel) => ({
      blur: getComputedStyle(panel).backdropFilter, overflow: getComputedStyle(panel).overflow,
      radius: getComputedStyle(panel).borderRadius, width: panel.getBoundingClientRect().width
    })));
    check("blur-offでも新3パネルはぼかしだけ無効", off.length === 3 && off.every((panel) => panel.blur === "none"
      && panel.overflow === "hidden" && panel.radius === "18px" && panel.width > 0), JSON.stringify(off));
  } catch (error) {
    failures++; console.error(error.stack || error.message);
  } finally {
    try { if (browser) await browser.close(); } finally { server.close(); }
  }

  console.log(failures === 0 ? "\n✅ v275 ALL PASS" : `\n❌ v275: ${failures}件失敗`);
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
