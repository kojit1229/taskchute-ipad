// tests/tower-core.test.js — v228 JOURNAL/FLIGHT LOG・日報再生成と1秒ticker契約E2E。
// today-core.test.jsと同じく、localStorage seed + 既存nav + Playwright clockで検証する。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY, dismissBodyScanIfOpen } = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
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
  const yesterday = isoOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1));
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

  async function seedBoard(blocks, tasks = null) {
    await page.evaluate(({ KEY, blocks, tasks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      s.blocks = blocks;
      if (tasks) s.tasks = tasks;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks });
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

    console.log("[2] 廃止したAI集約UIを設定・today・tasksのどこにも戻さない");
    await seedSkin("cockpit", "settings");
    check("todaySkinの設定selectが存在しない", await page.locator('select[data-setting-field="todaySkin"]').count() === 0);
    await page.evaluate(() => { const fold = document.querySelector('details[data-fold-id="settings-daily"]'); if (fold) fold.open = true; });
    check("削除済みtoday-replan actionがソースに存在しない", !appSource.includes('"today-replan"'));
    await page.evaluate(({ KEY, yesterday }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journalMeta[yesterday] = { ...(s.journalMeta[yesterday] || {}), aiMitCandidates: ["旧MIT候補"], aiTaskCandidates: ["旧タスク候補"] };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, yesterday });
    await page.reload();
    await page.waitForSelector('#app[data-view="settings"]');
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".sec-journal");
    check("削除済み朝プランactionがソースに存在しない", !appSource.includes('"ai-morning-plan"'));
    check("todayに維持対象の下書きスケジュールボタンを重複描画しない",
      await page.locator('[data-action="ai-schedule"]').count() === 0);
    check("旧候補stateが残っていてもMIT/タスク候補UIを描画しない",
      await page.locator('[data-action="ai-mit-adopt"], [data-action="mit-candidate-add"], [data-action="ai-task-adopt"], [data-action="ai-task-dismiss"]').count() === 0);
    await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').click();
    await page.waitForSelector('#app[data-view="tasks"]');
    check("tasks側に維持対象の下書き操作・候補チップの重複がない",
      await page.locator('[data-action="ai-schedule"], .ai-mit-chips, .ai-task-chips').count() === 0);
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector(".today-tower");
    check("今日タブは常に.today-towerを描画する", await page.locator(".today-tower").count() === 1);
    check("削除パネルは今日タブに描画されない", await page.locator(".tower-radar, .tower-gauges, .tower-apron, .tower-radio, .tower-annex").count() === 0);
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
      const els = [".clock-box time", ".clock-box .dayleft", ".life-title", ".tower-beacon i", ".tower-status"]
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
      block(`arr-${index}`, `本日便${index + 1}`, today, 9 * 60 + 30 + index * 30, { estimateMin: index === 0 ? 45 : null }));
    arrivals.push(block("routine-hidden", "除外ルーティン", today, 11 * 60, { category: "ルーティン" }));
    arrivals.push(block("onetap-hidden", "除外ワンタップ", today, 11 * 60 + 15, { oneTap: true }));
    arrivals.push(block("arr-completed", "完了済み便", today, 8 * 60, {
      completed: true, actualStartAt: atMinute(today, 8 * 60), actualEndAt: atMinute(today, 8 * 60 + 25)
    }));
    const tomorrowBlocks = [
      block("dep-late", "明日15時", tomorrow, 15 * 60), block("dep-first", "明日8時半", tomorrow, 8 * 60 + 30),
      block("dep-third", "明日13時", tomorrow, 13 * 60), block("dep-second", "明日10時", tomorrow, 10 * 60)
    ];
    await seedBoard([...arrivals, ...tomorrowBlocks]);
    check("ARRIVALSは最大11行", await page.locator(".tower-arrival-row").count() === 11);
    check("窓外2便を数字だけで要約する", (await page.locator(".tower-flight-summary").textContent())?.trim() === "他 2 便");
    check("callsign列は存在しない", await page.locator(".tower-arrival-row .tower-callsign").count() === 0);
    const arrivalEstimates = await page.locator(".tower-arrival-row .tower-flight-est").allTextContents();
    check("見積列は手入力45分とresolveEstimateMin既定30分を表示", arrivalEstimates[0] === "45分" && arrivalEstimates.slice(1).every((text) => text === "30分"), JSON.stringify(arrivalEstimates));
    const labels = await page.locator(".tower-arrival-row .tower-status").allTextContents();
    const allowedLabels = new Set(["到着", "着陸中", "リスロット", "最終進入", "待機"]);
    check("状態ラベルは確定語彙だけ", labels.every((label) => allowedLabels.has(label)), JSON.stringify(labels));
    check("ルーティンはARRIVALSに出ない", await page.locator('.tower-flight-title:has-text("除外ルーティン")').count() === 0);
    check("oneTapはARRIVALSに出ない", await page.locator('.tower-flight-title:has-text("除外ワンタップ")').count() === 0);
    check("完了便はARRIVALSから除外", await page.locator('.tower-arrival-row[data-flight-id="arr-completed"]').count() === 0);
    const completedLog = page.locator('.tower-log-row[data-flight-id="arr-completed"]');
    check("完了便はFLIGHT LOGへ時系列表示", await completedLog.count() === 1
      && (await completedLog.locator("time").textContent()) === "08:00-08:25"
      && (await completedLog.locator(".tower-log-title").textContent()) === "完了済み便"
      && (await completedLog.locator(".tower-log-dur").textContent()) === "25分");
    check("FLIGHT LOG行は44px以上のbutton", await completedLog.evaluate((el) =>
      el.tagName === "BUTTON" && parseFloat(getComputedStyle(el).minHeight) >= 44));
    check("復元描画の最新完了行はフラッシュしない", await completedLog.evaluate((el) => !el.classList.contains("is-flip"))
      && await page.locator('.sec-log .tower-touchdown').count() === 0);

    console.log("[7-b] JOURNALは既存単一文字列を自由記述として読み、2枠をsaveAndRender保存する");
    await page.evaluate(({ KEY, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journals[today] = "既存の自由記述";
      s.journalMeta[today] = { aiMitCandidates: [], aiImported: false, ideal: "", aiTaskCandidates: [] };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, today });
    await page.reload();
    await page.waitForSelector("#towerJournalFree");
    check("既存文字列はFREE NOTEへ表示されAI依頼は空で正規化", await page.locator("#towerJournalFree").inputValue() === "既存の自由記述"
      && await page.locator("#towerJournalAi").inputValue() === ""
      && await page.evaluate(({ KEY, today }) => JSON.parse(localStorage.getItem(KEY)).journalMeta[today]?.aiRequest === "", { KEY, today }));
    // v229: locator解決後の再描画detachでcomputed styleがnullになる競合の恒久対策(v123と同型)。
    // 評価時点でquerySelectorし直し、数値の成立自体を待ってから同じassertを行う。
    const journalStyle = await page.waitForFunction(() => {
      const el = document.querySelector("#towerJournalFree");
      if (!el) return false;
      const cs = getComputedStyle(el);
      const v = { minHeight: parseFloat(cs.minHeight), fontSize: parseFloat(cs.fontSize) };
      return Number.isFinite(v.minHeight) && Number.isFinite(v.fontSize) ? v : false;
    }, null, { timeout: 10000 }).then((h) => h.jsonValue());
    check("JOURNAL textareaは130px以上・16px以上", journalStyle.minHeight >= 130 && journalStyle.fontSize >= 16, JSON.stringify(journalStyle));
    await page.locator("#towerJournalFree").fill("更新した自由記述");
    await page.locator("#towerJournalAi").fill("明日の計画に運動を入れて");
    await page.locator('[data-action="save-tower-journal"]').click();
    await page.waitForFunction(({ KEY, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.journals[today] === "更新した自由記述" && s.journalMeta[today]?.aiRequest === "明日の計画に運動を入れて";
    }, { KEY, today });
    const savedJournal = await page.evaluate(({ KEY, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return { free: s.journals[today], ai: s.journalMeta[today].aiRequest, updatedAt: s.journalMeta[today].textUpdatedAt };
    }, { KEY, today });
    check("SAVEでjournals/dateとjournalMeta.aiRequestを保存", savedJournal.free === "更新した自由記述"
      && savedJournal.ai === "明日の計画に運動を入れて" && !!savedJournal.updatedAt, JSON.stringify(savedJournal));

    console.log("[8] ARRIVALSのタスク名タップは既存Blockモーダルを開く");
    await page.locator('.tower-arrival-row[data-flight-id="arr-0"] .tower-flight-title').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("既存Block編集モーダルが開く", await page.locator(".modal-card").count() === 1);
    check("buildBlockModalのフルスペックを流用", await page.locator('[data-modal-field="plannedStartAt"]').count() === 1
      && await page.locator('[data-modal-field="estimateMin"]').count() === 1
      && await page.locator('[data-modal-field="comment"]').count() === 1
      && await page.locator('[data-modal-field="recurrenceKind"]').count() === 1);
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.waitForSelector(".modal-card", { state: "detached" });

    console.log("[8-b] 終了のみBlockと見積時間付き未Block化Taskを3パネルへ反映する");
    const endedOnlyBlock = block("ended-only", "終了のみ便", today, 9 * 60, {
      actualStartAt: atMinute(today, 9 * 60), actualEndAt: atMinute(today, 9 * 60 + 20)
    });
    const completedBlock = block("completed-actual", "完了実績便", today, 9 * 60 + 30, {
      completed: true, actualStartAt: atMinute(today, 9 * 60 + 30), actualEndAt: atMinute(today, 10 * 60)
    });
    const nextBlock = block("next-open", "次のBlock", today, 13 * 60);
    const taskBlock = block("already-blocked", "Block生成済みTask", today, 14 * 60, { taskId: "task-blocked" });
    const tasks = [
      { id: "task-plan", title: "予定時間付きTask", status: "todo", dueDate: today, estimateMin: 35, deleted: false },
      { id: "task-blocked", title: "Block生成済みTask", status: "todo", dueDate: today, estimateMin: 40, deleted: false },
      { id: "task-no-estimate", title: "見積なしTask", status: "todo", dueDate: today, estimateMin: null, deleted: false },
      { id: "task-future", title: "未来期日Task", status: "todo", dueDate: tomorrow, estimateMin: 50, deleted: false }
    ];
    await seedBoard([endedOnlyBlock, completedBlock, nextBlock, taskBlock, ...tomorrowBlocks], tasks);
    check("終了のみBlockはARRIVALSから消える", await page.locator('[data-flight-id="ended-only"].tower-arrival-row').count() === 0);
    check("終了のみBlockはFLIGHT LOGへ終了ラベル付きで出る", await page.locator('[data-flight-id="ended-only"] .tower-log-state[data-state="ended"]', { hasText: "終了" }).count() === 1);
    check("completed+actualEndAtは従来どおり完了実績として出る", await page.locator('[data-flight-id="completed-actual"] .tower-log-state[data-state="completed"]', { hasText: "完了" }).count() === 1);
    await page.locator('.tower-log-row[data-flight-id="ended-only"]').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("終了のみFLIGHT LOG行タップで対象Block編集モーダルを開く",
      await page.locator('[data-modal-field="title"]').inputValue() === "終了のみ便");
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.locator('.tower-log-row[data-flight-id="completed-actual"]').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("完了済みFLIGHT LOG行タップでも対象Block編集モーダルを開く",
      await page.locator('[data-modal-field="title"]').inputValue() === "完了実績便");
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    const runwayReadyId = await page.locator('.tower-nowhud[data-status="ready"] [data-action="now-start"]').getAttribute("data-id");
    check("NOW LANDINGは終了のみBlockでなく次の未着手Blockを選ぶ", runwayReadyId === "next-open", `actual=${runwayReadyId}`);
    const taskPlan = page.locator('.tower-task-plan[data-id="task-plan"]');
    check("見積時間付き未Block化Taskは予定行でARRIVALSへ出る", await taskPlan.count() === 1
      && (await taskPlan.locator(".tower-flight-est").textContent()) === "35分"
      && (await taskPlan.locator(".tower-status").textContent()) === "予定");
    check("Block生成済み・見積なし・未来期日のTaskは予定行に出ない",
      await page.locator('.tower-task-plan[data-id="task-blocked"], .tower-task-plan[data-id="task-no-estimate"], .tower-task-plan[data-id="task-future"]').count() === 0);
    await taskPlan.click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.some((item) => item.taskId === "task-plan"), KEY);
    check("予定行タップは既存task-todayでBlockを生成し二重表示を消す", await page.locator('.tower-task-plan[data-id="task-plan"]').count() === 0);

    console.log("[9] DEPARTURESは明日便データがあっても描画せず周辺セクションを維持する");
    check("DEPARTURES要素・旧action・明日便タイトルを描画しない",
      await page.locator('.tower-departures, [data-action="departures-open-tomorrow"], .tower-board :text("明日8時半")').count() === 0);
    const leftSectionOrder = await page.locator(".tower-col-left > section").evaluateAll((sections) =>
      sections.map((section) => [...section.classList].find((name) => name.startsWith("sec-"))));
    check("左列はNOW LANDING→ARRIVALS→FLIGHT LOG順を維持", JSON.stringify(leftSectionOrder) === JSON.stringify(["sec-rwy", "sec-arrivals", "sec-log", "sec-bodymind"]),
      JSON.stringify(leftSectionOrder));
    check("ARRIVALSとGATEは引き続き表示", await page.locator(".sec-arrivals .tower-arrivals").count() === 1
      && await page.locator(".sec-gates").count() === 1);

    console.log("[10] tickerは行を再構築せず状態文字列をフリップ更新する");
    const crossing = [block("flip-first", "境界便", today, 12 * 60), block("flip-next", "次便", today, 13 * 60)];
    await page.clock.setFixedTime(fixedTime(0));
    await seedBoard(crossing, []);
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
    check("既定queue先頭が窓外でもselectを保ち、表示候補はARRIVALS窓と一致",
      await page.locator("[data-tower-arrival-select]").inputValue() === "w0"
      && JSON.stringify(await page.locator("[data-tower-arrival-select] option:not([hidden])").evaluateAll((options) => options.map((option) => option.value)))
        === JSON.stringify(Array.from({ length: 11 }, (_, index) => `w${index + 1}`)));
    await page.locator("[data-tower-arrival-select]").focus();
    await page.locator("[data-tower-arrival-select]").selectOption("w1");
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.querySelector("[data-tower-arrival-select]")?.value === "w1");
    await page.locator('.tower-arrival-row[data-flight-id="w6"] .tower-flight-title').focus();
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 30, 30, 0));
    await page.waitForFunction(() => document.getElementById("towerClock")?.textContent === "12:30:30");
    check("フォーカス中は行を作り直さない(先頭はw1のまま)", (await page.locator(".tower-arrival-row").first().getAttribute("data-flight-id")) === "w1");
    check("フォーカスは失われない", await page.evaluate(() => document.activeElement?.closest?.('[data-flight-id="w6"]') !== null));
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.querySelector(".tower-arrival-row")?.dataset.flightId === "w2"
      && document.querySelector("[data-tower-arrival-select]")?.value === "w0");
    check("フォーカス解除後のtickで窓がw2..w12へずれる", (await page.locator(".tower-arrival-row").first().getAttribute("data-flight-id")) === "w2");
    check("tick窓移動でselectもw2..w12へ追従し、窓外選択w1はqueue先頭w0へ戻る",
      JSON.stringify(await page.locator("[data-tower-arrival-select] option:not([hidden])").evaluateAll((options) => options.map((option) => option.value)))
        === JSON.stringify(Array.from({ length: 11 }, (_, index) => `w${index + 2}`)));
    check("窓ずれ後も他 n 便のサマリが正しい", ((await page.locator("#towerArrivalSummary").textContent()) || "").trim() === "他 2 便");
    const focusedSelect = page.locator("[data-tower-arrival-select]");
    const focusedSelectHandle = await focusedSelect.elementHandle();
    await focusedSelect.focus();
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 13, 0, 30, 0));
    await page.waitForFunction(() => document.querySelector(".tower-arrival-row")?.dataset.flightId === "w3");
    check("selectフォーカス中はtick候補更新を保留してpicker要素を維持", await focusedSelectHandle.evaluate((el) =>
      el.isConnected && document.activeElement === el && el.querySelector('option:not([hidden])')?.value === "w2"));
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.querySelector('[data-tower-arrival-select] option:not([hidden])')?.value === "w3");
    check("selectのblur後の次tickで保留候補をw3..w12へ反映",
      (await page.locator("[data-tower-arrival-select] option:not([hidden])").first().getAttribute("value")) === "w3");

    console.log("[12] 実行中BlockをRWYとNOW LANDINGへ表示する");
    await page.clock.setFixedTime(fixedTime(0));
    const landing = block("rwy-landing", "RWY検証タスク", today, 11 * 60, {
      actualStartAt: atMinute(today, 11 * 60 + 30), estimateMin: 60
    });
    await seedBoard([landing]);
    check(".tower-runwayと#towerPlaneが存在", await page.locator(".tower-runway #towerPlane").count() === 1);
    check("滑走路パネル名はNOW LANDING", ((await page.locator(".tower-runway h2").textContent()) || "").includes("NOW LANDING"));
    const landingX = await page.locator("#towerPlane").evaluate((el) => parseFloat(el.style.getPropertyValue("--tower-plane-x")));
    check("11:30開始・60分見積の12:00位置は約50%", Math.abs(landingX - 50) < 0.1, String(landingX));
    check("実開始11:30と開始+見積の着陸予定12:30を表示", (await page.locator(".tower-rwy-mark.start").textContent()) === "11:30 開始"
      && (await page.locator(".tower-rwy-mark.end").textContent()) === "12:30 着陸予定");
    check("経過/見積の進捗50%を表示", (await page.locator("#towerNowPct").textContent()) === "進捗 50%");
    check("残り30分を表示", (await page.locator("#towerNowRemain").textContent()) === "残り 30分");
    const pctHandle = await page.locator("#towerNowPct").elementHandle();
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 15, 1, 0));
    await page.waitForFunction(() => document.getElementById("towerNowPct")?.textContent === "進捗 75%");
    // v229: 残り分の更新はtick到達直後だと未反映のことがあるため、成立自体を待ってからassert(検証意図不変)
    await page.waitForFunction(() => document.getElementById("towerNowRemain")?.textContent === "残り 15分");
    check("tickで全再描画せず進捗%・残り分を差分更新", await pctHandle.evaluate((el) => el.isConnected && el.textContent === "進捗 75%")
      && (await page.locator("#towerNowRemain").textContent()) === "残り 15分");
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

    console.log("[14] NOW LANDINGはARRIVALS候補を一時選択し、既存edit-block/now-startへ追従する");
    const selectable = [
      block("rwy-first", "既定の次便", today, 12 * 60 + 30, { updatedAt: "2026-08-26T08:00:00" }),
      block("rwy-second", "選び替える便", today, 13 * 60, { updatedAt: "2026-08-26T08:05:00" }),
      block("rwy-completed-hidden", "完了済み候補外", today, 12 * 60 + 15, { completed: true }),
      block("rwy-ended-hidden", "終了済み候補外", today, 12 * 60 + 20, {
        actualStartAt: atMinute(today, 12 * 60), actualEndAt: atMinute(today, 12 * 60 + 20)
      }),
      block("rwy-routine-hidden", "ルーティン候補外", today, 12 * 60 + 45, { category: "ルーティン" }),
      block("rwy-suspended-hidden", "中断タスク候補外", today, 13 * 60 + 15, { taskId: "task-suspended" }),
      block("rwy-cancelled-hidden", "中止タスク候補外", today, 13 * 60 + 30, { taskId: "task-cancelled" }),
      block("rwy-deleted-hidden", "削除タスク候補外", today, 13 * 60 + 45, { taskId: "task-deleted" })
    ];
    const staleTasks = [
      { id: "task-suspended", title: "中断", status: "suspended", deleted: false },
      { id: "task-cancelled", title: "中止", status: "cancelled", deleted: false },
      { id: "task-deleted", title: "削除", status: "todo", deleted: true }
    ];
    await seedBoard(selectable, staleTasks);
    const arrivalSelect = page.locator("[data-tower-arrival-select]");
    check("既定はqueue先頭の次便", await arrivalSelect.inputValue() === "rwy-first"
      && await page.locator('.tower-nowhud [data-action="now-start"]').getAttribute("data-id") === "rwy-first");
    check("候補ラベルは時刻+タイトルで、完了/終了/ルーティンと中断/中止/削除タスク由来を除外",
      JSON.stringify(await arrivalSelect.locator("option").allTextContents()) === JSON.stringify(["12:30 既定の次便", "13:00 選び替える便"]));
    const selectionTimestamps = await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return { dataModifiedAt: s.dataModifiedAt, updatedAt: Object.fromEntries(s.blocks.map((item) => [item.id, item.updatedAt])) };
    }, { KEY });
    await page.evaluate((KEY) => {
      window.__towerStateWrites = 0;
      window.__towerOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage && key === KEY) window.__towerStateWrites += 1;
        return window.__towerOriginalSetItem.call(this, key, value);
      };
    }, KEY);
    const guardedSelectHandle = await arrivalSelect.elementHandle();
    await arrivalSelect.focus();
    await arrivalSelect.selectOption("rwy-second");
    check("selectフォーカス中は全体renderを保留しつつ編集・開始IDは即時追従", await guardedSelectHandle.evaluate((el) =>
      el.isConnected && document.activeElement === el)
      && await page.locator('.tower-now-title').getAttribute("data-id") === "rwy-second"
      && await page.locator('.tower-nowhud [data-action="now-start"]').getAttribute("data-id") === "rwy-second");
    check("選択操作はstate保存0回", await page.evaluate(() => window.__towerStateWrites) === 0);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.querySelector("[data-tower-arrival-select]")?.value === "rwy-second");
    await page.evaluate(() => { Storage.prototype.setItem = window.__towerOriginalSetItem; });
    await page.locator('#sidebar [data-action="nav"][data-view="tasks"]').click();
    await page.waitForSelector('#app[data-view="tasks"]');
    await page.locator('#sidebar [data-action="nav"][data-view="today"]').click();
    await page.waitForSelector("[data-tower-arrival-select]");
    check("有効選択は無関係の全体renderをもう1回跨いでも保持",
      await page.locator("[data-tower-arrival-select]").inputValue() === "rwy-second");
    const timestampsAfterSelection = await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return { dataModifiedAt: s.dataModifiedAt, updatedAt: Object.fromEntries(s.blocks.map((item) => [item.id, item.updatedAt])) };
    }, { KEY });
    check("選択操作はstate.dataModifiedAtとBlock.updatedAtも変更しない",
      JSON.stringify(timestampsAfterSelection) === JSON.stringify(selectionTimestamps));
    await page.locator('.tower-now-title[data-id="rwy-second"]').click();
    await page.waitForSelector(".modal-card", { state: "attached" });
    check("選択後のタイトル編集は選び替えたBlockを開く", await page.locator('[data-modal-field="title"]').inputValue() === "選び替える便");
    await page.locator('.modal-card [data-action="modal-close"]').first().click();
    await page.locator('.tower-nowhud [data-action="now-start"][data-id="rwy-second"]').click();
    await page.waitForSelector('[data-action="declare-confirm"]', { state: "attached" });
    check("既存now-startは選び替えたBlockで発火", ((await page.locator(".modal-card").textContent()) || "").includes("選び替える便"));
    await page.locator('[data-action="declare-confirm"]').click();
    await page.waitForFunction(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return !!s.blocks.find((item) => item.id === "rwy-second")?.actualStartAt
        && !s.blocks.find((item) => item.id === "rwy-first")?.actualStartAt;
    }, { KEY });
    check("declare-confirm後のactualStartAtは選択Blockだけに付く", await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return !!s.blocks.find((item) => item.id === "rwy-second")?.actualStartAt
        && !s.blocks.find((item) => item.id === "rwy-first")?.actualStartAt;
    }, { KEY }));

    console.log("[14-a] NOW LANDING選択の負例マトリクスを固定する");
    await page.clock.setFixedTime(fixedTime(0));
    const completionCandidates = [
      block("complete-first", "完了時の戻り先", today, 12 * 60 + 30),
      block("complete-selected", "完了にする選択便", today, 13 * 60, { plannedEndAt: atMinute(today, 13 * 60 + 30) })
    ];
    await seedBoard(completionCandidates, []);
    await page.locator("[data-tower-arrival-select]").selectOption("complete-selected");
    await page.evaluate(() => document.activeElement.blur());
    await page.locator('.tower-now-title[data-id="complete-selected"]').click();
    await page.locator('[data-modal-field="completed"]').check();
    await page.locator('.modal-card [data-action="modal-save"]').click();
    await page.waitForFunction(() => document.querySelector("[data-tower-arrival-select]")?.value === "complete-first");
    check("選択中Blockが完了したら既定の次便へフォールバック",
      await page.locator('.tower-now-title').getAttribute("data-id") === "complete-first"
      && await page.locator('.tower-nowhud [data-action="now-start"]').getAttribute("data-id") === "complete-first");

    const deletionCandidates = [block("delete-first", "削除時の戻り先", today, 12 * 60 + 30), block("delete-selected", "削除する選択便", today, 13 * 60)];
    await seedBoard(deletionCandidates, []);
    await page.locator("[data-tower-arrival-select]").selectOption("delete-selected");
    await page.evaluate(() => document.activeElement.blur());
    await page.locator('.tower-now-title[data-id="delete-selected"]').click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('.modal-card [data-action="modal-delete"]').click();
    await page.waitForFunction(() => document.querySelector("[data-tower-arrival-select]")?.value === "delete-first");
    check("選択候補が削除されたら既定の次便へフォールバック",
      await page.locator('.tower-now-title').getAttribute("data-id") === "delete-first");

    const runningWithQueue = [block("negative-running", "実行中", today, 11 * 60, { actualStartAt: atMinute(today, 11 * 60) }), block("negative-queue", "待機便", today, 13 * 60)];
    await seedBoard(runningWithQueue, []);
    check("実行中BlockがあればARRIVALS selectを表示しない", await page.locator("[data-tower-arrival-select]").count() === 0);

    const taskPlanOnly = [{ id: "only-task-plan", title: "予定便のみ", status: "todo", dueDate: today, estimateMin: 30, deleted: false }];
    await seedBoard([], taskPlanOnly);
    check("task-planだけで選択可能Block 0件ならselectを表示しない",
      await page.locator('.tower-task-plan[data-id="only-task-plan"]').count() === 1
      && await page.locator("[data-tower-arrival-select]").count() === 0);

    const crossDayBlocks = [
      block("cross-today-first", "今日の次便", today, 23 * 60 + 30), block("cross-today-second", "今日の選択便", today, 23 * 60 + 45),
      block("cross-next-first", "翌日の次便", tomorrow, 8 * 60), block("cross-next-second", "翌日の別便", tomorrow, 9 * 60)
    ];
    await page.clock.setFixedTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 0));
    await seedBoard(crossDayBlocks, []);
    await page.locator("[data-tower-arrival-select]").selectOption("cross-today-second");
    await page.evaluate(() => document.activeElement.blur());
    const nextDayForSelection = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 1, 0);
    await page.clock.setFixedTime(nextDayForSelection);
    await page.waitForFunction(() => document.querySelector("[data-tower-arrival-select]")?.value === "cross-next-first");
    check("日跨ぎで前日選択を持ち越さず翌日のqueue先頭へフォールバック",
      await page.locator('.tower-now-title').getAttribute("data-id") === "cross-next-first");

    console.log("[14-b] runningなし・queueありはREADYから既存now-startで開始する");
    await page.clock.setFixedTime(fixedTime(0));
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

    const seedT5 = async (blocks) => {
      await page.evaluate(({ KEY, blocks }) => {
        const s = JSON.parse(localStorage.getItem(KEY));
        s.currentView = "today";
        s.blocks = blocks;
        localStorage.setItem(KEY, JSON.stringify(s));
      }, { KEY, blocks });
      await page.reload();
      await page.waitForSelector(".today-tower", { state: "attached" });
    };
    const seedT6 = async (blocks) => {
      await seedT5(blocks);
      await page.waitForSelector(".tower-gates", { state: "attached" });
    };
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
    check("候補0件ではARRIVALS選択プルダウンを描画しない", await page.locator("[data-tower-arrival-select]").count() === 0);
    check("Block 0件でもDEPARTURESは復活しない", await page.locator('.tower-departures, [data-action="departures-open-tomorrow"]').count() === 0);

    console.log("[19-b] 実績モーダル完了で当日日報mdを再生成する");
    const actualPath = block("report-actual", "実績モーダル経路", today, 11 * 60, { actualStartAt: atMinute(today, 11 * 60) });
    await page.evaluate(({ KEY, actualPath, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      s.blocks = [actualPath];
      s.reports[today] = "STALE_ACTUAL";
      s.pomodoro = { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, actualPath, today });
    await page.reload();
    await page.waitForSelector('.tower-now-actions [data-action="complete-block-with-actual"]');
    await page.locator('.tower-now-actions [data-action="complete-block-with-actual"]').click();
    await page.locator('[data-modal-field="actualStartAt"]').fill(atMinute(today, 11 * 60).slice(0, 16));
    await page.locator('[data-modal-field="actualEndAt"]').fill(atMinute(today, 11 * 60 + 40).slice(0, 16));
    await page.locator('.modal-card [data-action="modal-save"]').click();
    await page.waitForFunction(({ KEY, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks[0]?.completed && s.reports[today] !== "STALE_ACTUAL";
    }, { KEY, today });
    check("saveActualEntryFromModal後のstate.reportsへ完了便を反映", await page.evaluate(({ KEY, today }) =>
      JSON.parse(localStorage.getItem(KEY)).reports[today].includes("実績モーダル経路"), { KEY, today }));

    console.log("[19-c] ポモドーロ完了で当日日報mdを再生成する");
    const pomodoroPath = block("report-pomodoro", "ポモドーロ経路", today, 11 * 60, { actualStartAt: atMinute(today, 11 * 60) });
    await page.evaluate(({ KEY, pomodoroPath, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      s.blocks = [pomodoroPath];
      s.reports[today] = "STALE_POMODORO";
      s.pomodoro = { running: true, blockId: pomodoroPath.id, startedAt: pomodoroPath.actualStartAt, endsAt: `${today}T12:50:00`, mode: "focus" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, pomodoroPath, today });
    await page.reload();
    await page.waitForSelector('.tower-now-actions [data-action="now-conveyor-complete"]');
    await page.locator('.tower-now-actions [data-action="now-conveyor-complete"]').click();
    await page.waitForFunction(({ KEY, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks[0]?.completed && s.reports[today] !== "STALE_POMODORO";
    }, { KEY, today });
    check("completePomodoro後のstate.reportsへ完了便を反映", await page.evaluate(({ KEY, today }) =>
      JSON.parse(localStorage.getItem(KEY)).reports[today].includes("ポモドーロ経路"), { KEY, today }));
    if (await page.locator('[data-action="body-scan-discard"]').count()) await page.locator('[data-action="body-scan-discard"]').first().click();

    console.log("[20] GATE数と就航数はroutineRateと同じ母集団を使う");
    const gateSeed = [
      block("gate-done", "朝便", today, 7 * 60, { category: "ルーティン", completed: true, actualEndAt: atMinute(today, 7 * 60 + 5) }),
      block("gate-open", "昼便", today, 12 * 60, { category: "ルーティン" }),
      block("gate-onetap", "記録専用", today, 13 * 60, { category: "ルーティン", oneTap: true }),
      block("gate-deleted", "削除便", today, 14 * 60, { category: "ルーティン", deleted: true })
    ];
    await seedT6(gateSeed);
    await page.evaluate(({ KEY, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.reports[today] = "STALE_TOGGLE";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, today });
    await page.reload();
    await page.waitForSelector(".tower-gates");
    check("oneTapを除く通常ゲート2基+☀固定枠", await page.locator(".tower-gate:not(.tower-gate-fixed)").count() === 2
      && await page.locator(".tower-gate-fixed").count() === 1);
    check("☀未チェックを含め1/3便 就航を表示", (await page.locator("#towerGateCount").textContent()) === "1/3便 就航");

    console.log("[21] GATEタップは既存action経由で完了し就航灯とカウントを更新する");
    await page.locator('.tower-gate[data-id="gate-open"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed === true, KEY);
    check("実DOMクリックでBlock.completedが保存される", await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed, KEY));
    check("タップしたゲートが就航灯になる", await page.locator('.tower-gate[data-id="gate-open"][data-docked="1"]').count() === 1);
    check("新規就航はis-dockingの700ms演出", await page.locator('.tower-gate[data-id="gate-open"]').evaluate((el) => {
      const cs = getComputedStyle(el);
      return el.classList.contains("is-docking") && cs.animationName === "tower-gate-docking" && cs.animationDuration === "0.7s";
    }));
    check("就航数が2/3へ増える", (await page.locator("#towerGateCount").textContent()) === "2/3便 就航");
    check("toggleBlock後のstate.reportsへ完了便を反映", await page.evaluate(({ KEY, today }) => {
      const report = JSON.parse(localStorage.getItem(KEY)).reports[today] || "";
      return report !== "STALE_TOGGLE" && report.includes("昼便");
    }, { KEY, today }));
    const latestLog = page.locator('.tower-log-row[data-flight-id="gate-open"]');
    check("最新完了行に既存is-flip/tower-touchdownの1回演出", await latestLog.evaluate((el) => el.classList.contains("is-flip")
      && getComputedStyle(el).animationName === "tower-board-flip")
      && await latestLog.locator(".tower-touchdown").count() === 1);
    // K判断(2026-08-17): 就航済みゲートの再タップは確認なしの完了取消(既存toggleBlockのトグル)を仕様として維持する。
    // v293追随: 直前のタップは新規完了(justCompleted)のため身体スキャンモーダルが開いたまま
    // になっている。次のタップがこれに遮られるため先に片付ける(完了取消方向は身体スキャンを
    // 開かないため、以降のタップは対象外)。
    await dismissBodyScanIfOpen(page);
    await page.locator('.tower-gate[data-id="gate-open"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed !== true, KEY);
    check("就航済み再タップで取消される(トグル仕様)", await page.locator('.tower-gate[data-id="gate-open"][data-docked="0"]').count() === 1
      && (await page.locator("#towerGateCount").textContent()) === "1/3便 就航");
    await page.locator('.tower-gate[data-id="gate-open"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.find((b) => b.id === "gate-open")?.completed === true, KEY);
    // v293追随: 直前のタップは再び新規完了(justCompleted)のため身体スキャンモーダルが開く。
    await dismissBodyScanIfOpen(page);

    console.log("[21-b] ☀早起きゲートはEARLY BIRD正本へローカル時刻を書き、遅チェックを警告する");
    await page.locator('.tower-gate-fixed[data-action="early-bird-check"]').click();
    await page.waitForFunction(({ KEY, today }) => Boolean(JSON.parse(localStorage.getItem(KEY)).earlyBird?.logs?.[today]), { KEY, today });
    const earlyBird = await page.evaluate(({ KEY, today }) => JSON.parse(localStorage.getItem(KEY)).earlyBird.logs[today], { KEY, today });
    check("state.earlyBird.logs[当日].checkedAtへ書き込む", /^\d{4}-\d{2}-\d{2}T12:00:\d{2}$/.test(earlyBird.checkedAt), JSON.stringify(earlyBird));
    check("G01☀は二重罫線の固定枠で削除UIを持たない", await page.locator('.tower-gate-fixed .tower-gate-lock', { hasText: "固定枠(削除不可)" }).count() === 1
      && await page.locator('.tower-gate-fixed [data-action="tower-gate-delete"]').count() === 0);
    check("06:00より遅い12:00チェックも有効のまま警告表示", await page.locator('.tower-gate-fixed[data-docked="1"].is-late').count() === 1
      && await page.locator('.tower-gate-warning', { hasText: "目標06:00より遅い" }).count() === 1);

    console.log("[22] 全就航だけis-fullになり、満灯フラッシュは遷移の瞬間だけ");
    check("全就航ではis-full", await page.locator(".tower-gates.is-full").count() === 1);
    check("就航遷移の瞬間はis-full-flashが付く", await page.locator(".tower-gates.is-full-flash").count() === 1);
    await page.addInitScript(() => {
      const observation = { classHistory: [], tickerCycles: 0 };
      window.__towerGateRestoreObservation = observation;
      const hasTowerGatesClass = (className) => String(className || "").split(/\s+/).includes("tower-gates");
      const recordAddedSections = (node) => {
        if (!(node instanceof Element)) return;
        const sections = [node, ...node.querySelectorAll(".tower-gates")];
        sections.filter((el) => el.matches(".tower-gates")).forEach((el) => {
          observation.classHistory.push({
            phase: "added",
            className: el.getAttribute("class") || "",
            atMs: Math.round(performance.now())
          });
        });
      };
      new MutationObserver((mutations) => {
        mutations.forEach((mutation, index) => {
          if (mutation.type === "childList") {
            if (mutation.target instanceof Element && mutation.target.id === "towerClock") observation.tickerCycles++;
            mutation.addedNodes.forEach(recordAddedSections);
            return;
          }
          if (mutation.type !== "attributes") return;
          const currentClass = mutation.target.getAttribute("class") || "";
          if (!hasTowerGatesClass(mutation.oldValue) && !hasTowerGatesClass(currentClass)) return;
          const nextMutation = mutations.slice(index + 1)
            .find((candidate) => candidate.type === "attributes" && candidate.target === mutation.target);
          observation.classHistory.push({
            phase: "class-change",
            oldClassName: mutation.oldValue || "",
            className: nextMutation ? (nextMutation.oldValue || "") : currentClass,
            atMs: Math.round(performance.now())
          });
        });
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"],
        attributeOldValue: true
      });
    });
    await page.reload();
    await page.waitForSelector(".tower-gates");
    check("復元描画はis-fullのみでフラッシュを出さない", await page.locator(".tower-gates.is-full").count() === 1
      && await page.locator(".tower-gates.is-full-flash").count() === 0);
    await page.waitForFunction(() => window.__towerGateRestoreObservation?.tickerCycles >= 2);
    const restoredFullObservation = await page.evaluate(() => {
      const section = document.querySelector(".tower-gates");
      const observation = window.__towerGateRestoreObservation;
      return {
        classHistory: observation?.classHistory || [],
        tickerCycles: observation?.tickerCycles || 0,
        isFull: section?.classList.contains("is-full") || false,
        animationName: section ? getComputedStyle(section).animationName : "<missing>"
      };
    });
    const restoredFlashHistory = restoredFullObservation.classHistory.filter((entry) =>
      String(entry.oldClassName || "").split(/\s+/).includes("is-full-flash")
      || String(entry.className || "").split(/\s+/).includes("is-full-flash"));
    check("復元描画のis-fullは満灯アニメが走らない",
      restoredFullObservation.isFull && restoredFlashHistory.length === 0 && restoredFullObservation.animationName === "none",
      `classHistory=${JSON.stringify(restoredFullObservation.classHistory)} animationName=${restoredFullObservation.animationName} tickerCycles=${restoredFullObservation.tickerCycles}`);
    await page.locator('.tower-gate-fixed[data-action="early-bird-check"]').click();
    await page.waitForFunction(({ KEY, today }) => !JSON.parse(localStorage.getItem(KEY)).earlyBird?.logs?.[today], { KEY, today });
    check("当日再タップで早起き記録を取り消し警告も消える", await page.locator('.tower-gate-fixed[data-docked="0"]').count() === 1
      && await page.locator('.tower-gate-warning').count() === 0);
    await seedT6(gateSeed);
    check("部分就航ではis-fullなし", await page.locator(".tower-gates.is-full").count() === 0);
    await seedT6([block("gate-none", "非ルーティンのみ", today, 9 * 60, { completed: true })]);
    check("ルーティン0件でも☀固定枠を残し0/1便 就航", await page.locator(".tower-gates.is-full").count() === 0
      && await page.locator(".tower-gate-fixed").count() === 1
      && (await page.locator("#towerGateCount").textContent()) === "0/1便 就航");

    console.log("[23] GATE編集モードで登録・削除(シリーズ終了)・上下並び替えを行う");
    const editRules = [
      { id: "gate-rule-a", title: "朝の準備", category: "ルーティン", taskId: "", kind: "daily", startTime: "06:30", endTime: "", anchorDate: today, order: 0, exceptionDates: [], deleted: false },
      { id: "gate-rule-b", title: "日報確認", category: "ルーティン", taskId: "", kind: "daily", startTime: "07:00", endTime: "", anchorDate: today, order: 1, exceptionDates: [], deleted: false }
    ];
    await page.evaluate(({ KEY, editRules }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      s.blocks = [];
      s.recurrences = editRules;
      s.earlyBird = { logs: {} };
      delete s.settings.earlyRiseTarget;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, editRules });
    await page.reload();
    await page.waitForSelector('.tower-gate-edit[data-action="tower-gate-edit-toggle"]');
    check("earlyRiseTarget未定義は06:00へ正規化", ((await page.locator(".tower-gate-fixed").textContent()) || "").includes("06:00まで"));
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector(".tower-gate-editor");
    check("編集モードでも☀固定枠に削除ボタンなし", await page.locator('.tower-gate-fixed [data-action="tower-gate-delete"]').count() === 0);
    const gateInputs = await page.locator(".tower-gate-add input").evaluateAll((els) => els.map((el) => ({
      type: el.type, step: el.step, fontSize: parseFloat(getComputedStyle(el).fontSize)
    })));
    check("登録入力はタイトル+time(step=300)かつ16px", gateInputs[0]?.type === "text" && gateInputs[0]?.fontSize >= 16
      && gateInputs[1]?.type === "time" && gateInputs[1]?.step === "300" && gateInputs[1]?.fontSize >= 16, JSON.stringify(gateInputs));

    await page.locator("#towerGateTitle").fill("読書");
    await page.locator("#towerGateTime").fill("08:15");
    await page.locator('[data-action="tower-gate-add"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences.some((rule) => !rule.deleted && rule.title === "読書"), KEY);
    const addedGate = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const rule = s.recurrences.find((item) => !item.deleted && item.title === "読書");
      return { rule, hasBlock: s.blocks.some((block) => block.recurrenceGroupId === rule.id) };
    }, KEY);
    check("登録はcreateRecurrenceRuleの日次ルールを作り実体化", addedGate.rule.kind === "daily" && addedGate.rule.category === "ルーティン"
      && addedGate.rule.startTime === "08:15" && Number.isFinite(addedGate.rule.order) && addedGate.hasBlock, JSON.stringify(addedGate));

    await page.locator('.tower-gate-edit-row[data-rule-id="gate-rule-a"] [data-action="tower-gate-move"][data-direction="1"]').click();
    await page.waitForFunction(() => document.querySelector(".tower-gate-edit-row")?.dataset.ruleId === "gate-rule-b");
    const movedOrders = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences
      .filter((rule) => !rule.deleted && rule.category === "ルーティン")
      .sort((a, b) => a.order - b.order).map((rule) => rule.id), KEY);
    check("↓でrecurrences[].orderを書き換え表示順も反映", movedOrders[0] === "gate-rule-b" && movedOrders[1] === "gate-rule-a", JSON.stringify(movedOrders));

    await page.locator('.tower-gate-edit-row[data-rule-id="gate-rule-b"] [data-action="tower-gate-delete"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).recurrences.find((rule) => rule.id === "gate-rule-b")?.deleted === true, KEY);
    const endedGate = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return { deleted: s.recurrences.find((rule) => rule.id === "gate-rule-b")?.deleted,
        liveInstances: s.blocks.filter((block) => block.recurrenceGroupId === "gate-rule-b").length };
    }, KEY);
    check("削除はルールを論理削除し当日以降の未編集実体を除去", endedGate.deleted === true && endedGate.liveInstances === 0, JSON.stringify(endedGate));
    check("削除後も固定枠は残る", await page.locator(".tower-gate-fixed").count() === 1);
    await page.locator('[data-action="tower-gate-edit-toggle"]').click();
    await page.waitForSelector('.tower-gate[data-action="now-conveyor-complete"]');

    console.log("[33] 1440pxでLIFE BAND 70%+時計30%・SO全幅と340px/320px/可変の3列骨格");
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
        log: rect(".sec-log"), journal: rect(".sec-journal"),
        right: rect(".tower-col-right"), life: rect(".life-band"), clock: rect(".clock-box"), so: rect(".so-row"), root: rect(".today-tower")
      };
    });
    const columnParts = desktopLayout.columns.trim().split(/\s+/);
    check("grid列は340px/320px/可変の順", columnParts.length === 3 && columnParts[0] === "340px" && columnParts[1] === "320px" && parseFloat(columnParts[2]) > 0, desktopLayout.columns);
    check("NOW LANDINGとARRIVALSは左、GATEは中央、右列はその右", Math.abs(desktopLayout.board.x - desktopLayout.runway.x) < 1
      && Math.abs(desktopLayout.log.x - desktopLayout.runway.x) < 1
      && desktopLayout.runway.x < desktopLayout.gates.x && desktopLayout.gates.x < desktopLayout.right.x
       && Math.abs(desktopLayout.journal.x - desktopLayout.right.x) < 1,
      JSON.stringify(desktopLayout));
    const bandRatio = desktopLayout.life.width / (desktopLayout.life.width + 12 + desktopLayout.clock.width);
    check("PC上帯はLIFE BAND 70%+時計30%", Math.abs(bandRatio - 0.7) < 0.01 && desktopLayout.life.x < desktopLayout.clock.x, JSON.stringify(desktopLayout));
    check("STANDING ORDERSは上帯コンテンツ全幅", Math.abs(desktopLayout.so.x - desktopLayout.life.x) < 1
      && Math.abs(desktopLayout.so.width - (desktopLayout.life.width + 12 + desktopLayout.clock.width)) < 1, JSON.stringify(desktopLayout));
    check("PCでもLIFE BAND/SOは各1マークアップ", await page.locator(".life-band").count() === 1
      && await page.locator(".so-row").count() === 1 && await page.locator(".so-item").count() === 3);
    // 下限境界1280px(最も中央列が潰れやすい点)でも3面卓が成立し中央列が実用幅を持つこと(レビューm1)。
    await page.setViewportSize({ width: 1280, height: 800 });
    const boundaryColumns = await page.evaluate(() => getComputedStyle(document.querySelector(".today-tower")).gridTemplateColumns);
    const boundaryParts = boundaryColumns.trim().split(/\s+/);
    check("境界1280pxでも340px/320px/可変の3カラム", boundaryParts.length === 3
      && boundaryParts[0] === "340px" && boundaryParts[1] === "320px" && parseFloat(boundaryParts[2]) > 0, boundaryColumns);

    console.log("[34] 390/768/1024pxで1カラム・横はみ出しなし");
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await page.waitForLoadState("networkidle");
      const mobileLayout = await page.evaluate(() => {
        const board = document.querySelector(".tower-board").getBoundingClientRect();
        const runway = document.querySelector(".tower-runway").getBoundingClientRect();
        const gates = document.querySelector(".tower-gates").getBoundingClientRect();
        const log = document.querySelector(".sec-log").getBoundingClientRect();
        const journal = document.querySelector(".sec-journal").getBoundingClientRect();
        const life = document.querySelector(".life-band").getBoundingClientRect();
        const clock = document.querySelector(".clock-box").getBoundingClientRect();
        const standing = document.querySelector(".so-row").getBoundingClientRect();
        const focus = document.querySelector(".today-focus-bar").getBoundingClientRect();
        const timer = document.querySelector(".today-pomodoro").getBoundingClientRect();
        return {
          boardX: board.x, runwayX: runway.x, scrollWidth: document.scrollingElement.scrollWidth, innerWidth,
          panelX: [life.x, clock.x, standing.x],
          order: [life.top, clock.top, standing.top, focus.top, runway.top, board.top, gates.top, log.top, timer.top, journal.top]
        };
      });
      check(`${viewport.width}pxはboard/runwayが縦積み`, Math.abs(mobileLayout.boardX - mobileLayout.runwayX) < 1, JSON.stringify(mobileLayout));
      check(`${viewport.width}pxは横はみ出しなし`, mobileLayout.scrollWidth <= mobileLayout.innerWidth, JSON.stringify(mobileLayout));
      check(`${viewport.width}pxはLIFE→時計→SO→FOCUS→NOW→ARRIVALS→GATE→LOG→TIMER→JOURNAL順`, mobileLayout.order.every((top, index, list) => index === 0 || list[index - 1] < top), JSON.stringify(mobileLayout));
      check(`${viewport.width}pxは上帯3パネルも同じ左端`, mobileLayout.panelX.every((x) => Math.abs(x - mobileLayout.runwayX) < 1), JSON.stringify(mobileLayout));
    }

    console.log("[36] reduced-motionは演出を止めても数字を更新する");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(fixedTime(0));
    await seedT6([]);
    const reducedTransitions = await page.evaluate(() => ({
      plane: getComputedStyle(document.querySelector("#towerPlane")).transitionProperty,
      beacon: getComputedStyle(document.querySelector(".tower-beacon i")).animationName,
      // 接地フラッシュはanimationend削除に依存するため、animationが止まる環境では出さない契約(2系統レビューM1)。
      touchdown: (() => {
        const strip = document.querySelector(".tower-runway-strip");
        strip.insertAdjacentHTML("beforeend", '<i class="tower-touchdown"></i>');
        const display = getComputedStyle(strip.querySelector(".tower-touchdown")).display;
        strip.querySelector(".tower-touchdown").remove();
        return display;
      })()
    }));
    check("reduced-motionでplaneのtransitionがnone", reducedTransitions.plane === "none",
      JSON.stringify(reducedTransitions));
    check("reduced-motionでビーコンが止まり接地フラッシュは出ない", reducedTransitions.beacon === "none" && reducedTransitions.touchdown === "none",
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
      playState: getComputedStyle(document.querySelector(".tower-beacon i")).animationPlayState
    }));
    check("hidden=trueでdata-paused=1かつビーコンpaused", pausedState.paused === "1" && pausedState.playState === "paused", JSON.stringify(pausedState));
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const resumedState = await page.evaluate(() => ({
      paused: document.querySelector(".today-tower").dataset.paused,
      playState: getComputedStyle(document.querySelector(".tower-beacon i")).animationPlayState
    }));
    check("hidden=falseでdata-paused=0かつビーコンrunning", resumedState.paused === "0" && resumedState.playState === "running", JSON.stringify(resumedState));

    console.log("[38] 21:00〜4:59は夜間色温度へ切り替わる");
    const clockAt = (hour, minute = 0, second = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, second, 0);
    await page.clock.setFixedTime(clockAt(22));
    await seedT6([]);
    const towerTokens = () => ({
      night: document.querySelector(".today-tower").dataset.night,
      cyan: getComputedStyle(document.querySelector(".today-tower")).getPropertyValue("--tower-cyan").trim(),
      amber: getComputedStyle(document.querySelector(".today-tower")).getPropertyValue("--tower-amber").trim()
    });
    const nightStyle = await page.evaluate(towerTokens);
    await page.clock.setFixedTime(clockAt(12));
    await seedT6([]);
    const dayStyle = await page.evaluate(towerTokens);
    check("22時はdata-night=1で昼とcyan/amberが異なる", nightStyle.night === "1" && dayStyle.night === "0"
      && nightStyle.cyan !== dayStyle.cyan && nightStyle.amber !== dayStyle.amber,
      JSON.stringify({ nightStyle, dayStyle }));
    await page.clock.setFixedTime(clockAt(4, 59));
    await seedT6([]);
    const beforeDawn = await page.locator(".today-tower").getAttribute("data-night");
    await page.clock.setFixedTime(clockAt(5));
    await page.waitForFunction(() => document.querySelector(".today-tower")?.dataset.night === "0");
    check("4:59は夜間で5:00にtickで昼へ戻る", beforeDawn === "1");
    await page.clock.setFixedTime(clockAt(20, 59, 59));
    await seedT6([]);
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
    check("offはstate保存されビーコンanimation-nameがnone", await page.locator(".tower-beacon i").evaluate((el) => getComputedStyle(el).animationName) === "none");
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
    await seedT6([block("calm-event", "イベント演出確認", today, 13 * 60)]);
    await page.waitForSelector('.today-tower[data-motion="calm"]');
    const calmAnimations = await page.evaluate(() => ({
      beacon: getComputedStyle(document.querySelector(".tower-beacon i")).animationName,
      event: (() => {
        const status = document.querySelector(".tower-status");
        status.classList.add("is-flip");
        return getComputedStyle(status).animationName;
      })()
    }));
    check("calmは常時ビーコンだけ止めイベント演出を残す", calmAnimations.beacon === "none" && calmAnimations.event !== "none", JSON.stringify(calmAnimations));

  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
