// v285: Todayの旧AI集約パネル/FOCUS AIチップ削除と、残存TOWER・旧state互換を検証する。
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const appSource = read("app.js");
const todaySource = read("src/features/today.js");
const towerSource = read("src/features/today-tower.js");
const stylesSource = read("styles.css");
const actionTestSource = read("tests/action-registry-core.test.js").replace(/\/\/.*$/gm, "");
const towerTestSource = read("tests/tower-core.test.js");
const PORT = randomPort();
const FOCUS_KEY = "taskchute-journal-today-focus-v1";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

console.log("[1] 旧AI集約UIのrenderer・依存注入・DOM生成を実行コードから除去する");
const removedHelpers = [
  "renderAtisPanel", "aiFreshnessLine", "atisFeedbackReadHTML", "extractFeedbackSummary",
  "aiWorkResultRowHTML", "pendingAiWorkResults", "aiTaskChips"
];
check("旧UI専用helper定義・参照が無い", removedHelpers.every((name) => !new RegExp(`\\b${name}\\b`).test(`${appSource}\n${todaySource}\n${towerSource}`)));
check("実行コードに旧DOMセレクタ文字列が無い", !/sec-atis|data-atis|tower-atis/.test(`${appSource}\n${todaySource}\n${towerSource}`));
check("today-towerの右カラムはJOURNALだけを条件描画", towerSource.includes('${focusVisibility.journal ? renderTowerJournal(today) : ""}')
  && !towerSource.includes("focusVisibility.atis"));
const legacyPomoVariable = ["pomodoro", "Right"].join("");
check("CABIN TIMERは旧JOURNAL連動右寄せを持たずband2へ固定",
  !towerSource.includes(legacyPomoVariable)
  && towerSource.includes('<div class="tower-band2 band2"')
  && towerSource.includes("${renderTodayPomodoro(blocks, queueBlocksOf(blocks))}"));

console.log("[2] VIEWはside/journal/lifeだけを正規化・描画・登録する");
check("既定/正規化stateに旧atisキーを持たない", !/\batis\s*:/.test(todaySource));
check("FOCUS AIチップと旧action登録が無い", !todaySource.includes('chip("atis", "AI")') && !todaySource.includes('"focus-toggle-atis"'));
check("actionゴールデンから旧actionを除去", !actionTestSource.includes("focus-toggle-atis"));

console.log("[3] v270から移したDEPARTURES削除・ARRIVALS共有経路のtripwire");
check("today-towerからDEPARTURES描画・helperを除去済み", !/DEPARTURES|tower-departures|departures-open-tomorrow|departureSummary|firstDeparture/.test(towerSource));
check("app/CSS/actionゴールデンにも旧導線が無い", !appSource.includes("departures-open-tomorrow")
  && !stylesSource.includes("tower-departures") && !actionTestSource.includes("departures-open-tomorrow"));
const boardFlightsReferences = towerSource.match(/\bboardFlights\b/g) || [];
check("共有boardFlightsは定義とARRIVALS描画・ticker参照を維持", boardFlightsReferences.length >= 3, `references=${boardFlightsReferences.length}`);
check("ARRIVALS・FLIGHT LOGはsideでガードし、GATEの描画呼び出しを常時維持",
  towerSource.includes('focusVisibility.side ? renderTowerBoard(flights) : ""')
  && towerSource.includes('focusVisibility.side ? renderFlightLog(today, blocks) : ""')
  && towerSource.includes('focusVisibility.side ? renderTowerBodyMind(today, blocks) : ""')
  && towerSource.includes('<div class="tower-col-center">${renderTowerGates(blocks)}</div>'));
check("tower-coreの負方向・現行モバイル順序を維持", towerTestSource.includes("DEPARTURES要素・旧action・明日便タイトルを描画しない")
  && towerTestSource.includes("Block 0件でもDEPARTURESは復活しない")
  && towerTestSource.includes("LIFE→時計→SO→NOW LANDING(いま)→ポモドーロ→FOCUS→次の予定→ルーティン→やったこと→からだのきろく→ジャーナル順"));

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ stateKey, focusKey }) => {
      const state = JSON.parse(localStorage.getItem(stateKey));
      state.currentView = "today";
      state.aiLinkFreshness = { feedbackAt: "2026-08-27", planAt: null };
      state.aiWorkProcessedIds = ["legacy-result"];
      state.journalMeta["2026-08-27"] = { aiRequest: "legacy-request", aiTaskCandidates: ["legacy-candidate"] };
      localStorage.setItem(stateKey, JSON.stringify(state));
      localStorage.setItem(focusKey, JSON.stringify({
        sections: { gate: true, atis: false, journal: true },
        restore: { gate: true, atis: true, journal: true }
      }));
    }, { stateKey: STATE_KEY, focusKey: FOCUS_KEY });
    await page.reload();
    await page.waitForSelector(".today-tower .sec-journal");

    console.log("[4] legacy localStorage/stateを読み捨て・保持しつつtodayを正常描画する");
    check("today DOMに旧パネル/data属性/専用子要素が無い",
      await page.locator('.sec-atis, [data-atis-panel], [data-atis-status], [data-atis-task-candidates], .tower-atis-body').count() === 0);
    check("右カラムはJOURNALだけ", await page.locator(".tower-col-right > .sec-journal").count() === 1);
    check("右カラム直下要素はJOURNAL 1個だけ", await page.locator(".tower-col-right > *").count() === 1);
    const focusActions = await page.$$eval(".today-focus-bar [data-action]", (nodes) => nodes.map((node) => node.dataset.action));
    check("VIEWバーは本体+side/journal/lifeの4操作だけ", JSON.stringify(focusActions) === JSON.stringify(["focus-mode", "focus-toggle-side", "focus-toggle-journal", "focus-toggle-life"]), JSON.stringify(focusActions));
    check("FOCUSバーにAIラベルが無い", !(await page.locator(".today-focus-bar").textContent()).includes("AI"));
    const normalizedState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("B-3の旧同期stateを削除せず保持", normalizedState.aiWorkProcessedIds?.[0] === "legacy-result"
      && normalizedState.journalMeta?.["2026-08-27"]?.aiTaskCandidates?.[0] === "legacy-candidate", JSON.stringify(normalizedState));

    console.log("[5] 現行VIEWトグルは退行せず、旧action名は発火しない");
    await page.click('[data-action="focus-toggle-side"]');
    await page.waitForSelector('.today-tower[data-view-side="0"]');
    check("sideだけを非表示にして固定GATE/JOURNALを維持",
      await page.locator(".tower-col-left > *").count() === 0
      && await page.locator(".sec-gates").count() === 1 && await page.locator(".sec-journal").count() === 1);
    const persistedFocus = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), FOCUS_KEY);
    check("VIEW sections実測キーはside/journal/lifeだけ",
      JSON.stringify(Object.keys(persistedFocus.sections).sort()) === JSON.stringify(["journal", "life", "side"]), JSON.stringify(persistedFocus));
    check("VIEW restore実測キーもside/journal/lifeだけ",
      JSON.stringify(Object.keys(persistedFocus.restore).sort()) === JSON.stringify(["journal", "life", "side"]), JSON.stringify(persistedFocus));
    const beforeLegacyClick = await page.evaluate((key) => localStorage.getItem(key), FOCUS_KEY);
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "focus-toggle-atis";
      document.body.appendChild(button);
      button.click();
      button.remove();
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const afterLegacyClick = await page.evaluate((key) => localStorage.getItem(key), FOCUS_KEY);
    check("旧action名をクリックしても表示stateを変更しない", afterLegacyClick === beforeLegacyClick);
    await page.click('[data-action="focus-toggle-journal"]');
    await page.waitForSelector(".sec-journal", { state: "detached" });
    check("journalトグルは現行どおり動作", await page.locator(".sec-journal").count() === 0);
    check("pageerrorなし", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v285 ALL PASS" : `\n❌ v285: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
