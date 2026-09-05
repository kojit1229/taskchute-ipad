// v363: IRON LOGの中立化(CONCEPT §6)。目標線・達成バッジ・緑グロー/パルスを撤去し、
// 「今日/今月/前回」の事実表示へ置換する。削除×ボタンは44pxのヒット領域を確認し、
// PAYLOAD等の航空用語ラベルの日本語副題を11px以上で表示する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-05";
const YESTERDAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 5, 12, 0, 0, 0);
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

function gymSet(exercise, weight, reps, hhmm) {
  return { id: `v363-${exercise}-${hhmm}`, exercise, weight, reps, at: `${TODAY}T${hhmm}`, createdAt: `${TODAY}T${hhmm}`, updatedAt: `${TODAY}T${hhmm}` };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  async function seed({ target = 2000, todayGym = [], yesterdayGym = [] } = {}) {
    await page.evaluate(({ stateKey, today, yesterday, target, todayGym, yesterdayGym }) => {
      const state = JSON.parse(localStorage.getItem(stateKey));
      state.currentView = "iron-log";
      state.blocks = [];
      state.settings = state.settings || {};
      state.settings.ironDailyTarget = target;
      state.condition = state.condition || {};
      state.condition.logs = state.condition.logs || {};
      state.condition.logs[today] = state.condition.logs[today] || {};
      state.condition.logs[today].gym = todayGym;
      state.condition.logs[yesterday] = state.condition.logs[yesterday] || {};
      state.condition.logs[yesterday].gym = yesterdayGym;
      localStorage.setItem(stateKey, JSON.stringify(state));
    }, { stateKey: STATE_KEY, today: TODAY, yesterday: YESTERDAY, target, todayGym, yesterdayGym });
    await page.reload();
    await page.waitForSelector('#app[data-view="iron-log"]', { state: "attached" });
  }

  try {
    await page.addInitScript(() => {
      window.__v363StorageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage) window.__v363StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
        return originalSetItem.call(this, key, value);
      };
    });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    console.log("[1] 未達成(600kg<2,000kg): 目標線・達成バッジ・パルス/グローがDOM/CSSに無い");
    await seed({
      target: 2000,
      todayGym: [gymSet("ベンチプレス", 60, 10, "09:00")], // 600kg
      yesterdayGym: [gymSet("ベンチプレス", 50, 10, "09:00")] // 500kg
    });
    check("iron-goal-line(DAILY TARGET行)はDOMに存在しない", await page.locator(".iron-goal-line").count() === 0);
    check("iron-achieved(達成バッジ)はDOMに存在しない", await page.locator(".iron-achieved").count() === 0);
    check("goal-hitクラスは付かない", await page.locator(".iron.goal-hit").count() === 0);
    check("目標比ゲージ(.iron-bar)はDOMに存在しない(差し戻し対応M1: 進捗バーも撤去)", await page.locator(".iron-bar").count() === 0);
    check("ゲージの外枠(.iron-bar-wrap)・目盛(.iron-bar-ticks)もDOMに存在しない", await page.locator(".iron-bar-wrap").count() === 0
      && await page.locator(".iron-bar-ticks").count() === 0);
    const totalShadowUnhit = await page.locator(".iron-total").evaluate((el) => getComputedStyle(el).textShadow);
    const totalColorUnhit = await page.locator(".iron-total").evaluate((el) => getComputedStyle(el).color);

    console.log("[2] 事実表示: 今日/今月/前回の3値がfixtureの計算値と一致・目標設定時の文言");
    check("PAYLOAD大数字は今日600kg", (await page.locator(".iron-total span").textContent()) === "600");
    const factText = (await page.locator(".iron-fact").textContent()) || "";
    // 今月は当該月内の全記録の合計(前日500kg+当日600kg=1,100kg)。ironTotals().monthKgの仕様どおり。
    check("今月1,100kg(前日500kg+当日600kgの月内合計)を表示", /今月\s*1,100\s*kg/.test(factText), factText);
    // 差し戻し対応M2: 「前回」に記録日(M/D、当fixtureでは前日=9/4)を添える書式。
    check("前回9/4・500kg(前日記録の日付+kg)を表示", /前回\s*9\/4\s*・\s*500\s*kg/.test(factText), factText);
    const targetNoteUnhit = (await page.locator(".iron-target-note").textContent()) || "";
    check("目標設定時の文言(目標2,000kgに対し今日600kg)", /目標\s*2,000\s*kg\s*に対し今日\s*600\s*kg/.test(targetNoteUnhit), targetNoteUnhit);
    check("達成/未達の語を使わない(あと・達成・超過が出ない)", !/あと|達成|超過/.test(factText + targetNoteUnhit), factText + targetNoteUnhit);

    console.log("[3] 達成条件(今日≥目標)のfixtureでも色・バッジ・パルスは出ない");
    await seed({
      target: 1000,
      todayGym: [gymSet("ベンチプレス", 60, 10, "09:00"), gymSet("デッドリフト", 100, 8, "09:10")], // 600+800=1,400 >= 1,000
      yesterdayGym: []
    });
    check("goal-hitクラスは達成時も付かない", await page.locator(".iron.goal-hit").count() === 0);
    check("iron-achieved(達成バッジ)は達成時もDOMに存在しない", await page.locator(".iron-achieved").count() === 0);
    check("達成時も目標比ゲージ(.iron-bar)はDOMに存在しない", await page.locator(".iron-bar").count() === 0);
    check("達成時もゲージの外枠(.iron-bar-wrap)・目盛(.iron-bar-ticks)はDOMに存在しない", await page.locator(".iron-bar-wrap").count() === 0
      && await page.locator(".iron-bar-ticks").count() === 0);
    const totalShadowHit = await page.locator(".iron-total").evaluate((el) => getComputedStyle(el).textShadow);
    const totalColorHit = await page.locator(".iron-total").evaluate((el) => getComputedStyle(el).color);
    check("達成時も総重量のtext-shadowは未達成時[1]と同一(緑グロー無し)", totalShadowHit === totalShadowUnhit, `${totalShadowHit} / ${totalShadowUnhit}`);
    check("達成時も総重量の文字色は未達成時[1]と同一(色分けなし)", totalColorHit === totalColorUnhit, `${totalColorHit} / ${totalColorUnhit}`);
    const targetNoteHit = (await page.locator(".iron-target-note").textContent()) || "";
    check("達成時の文言も中立(目標1,000kgに対し今日1,400kg、達成/超過の語なし)",
      /目標\s*1,000\s*kg\s*に対し今日\s*1,400\s*kg/.test(targetNoteHit) && !/達成|超過/.test(targetNoteHit), targetNoteHit);

    console.log("[4] 削除×ボタンのヒット領域44px以上・削除動作は従来どおり");
    const delButtons = page.locator(".iron-set-del");
    check("削除×ボタンが2件描画されている", await delButtons.count() === 2);
    const box0 = await delButtons.nth(0).boundingBox();
    check("削除×ボタンのヒット領域は44px以上(幅)", (box0?.width || 0) >= 44, JSON.stringify(box0));
    check("削除×ボタンのヒット領域は44px以上(高さ)", (box0?.height || 0) >= 44, JSON.stringify(box0));
    await delButtons.nth(0).click();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 1
      || document.querySelector(".iron-empty") !== null);
    const afterDelete = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    const remaining = (afterDelete.condition.logs[TODAY].gym || []).filter((s) => !s.deleted);
    check("削除は従来どおり1件分だけtombstone化される(残り1件)", remaining.length === 1, JSON.stringify(remaining));

    console.log("[5] 航空用語ラベルの日本語副題が11px以上で表示される・差し戻し対応M3: IRON LOGタブ配下の全テキストが11px以上");
    const subtitleChecks = [
      ["LINKED FLIGHT", "連動中のタスク"],
      ["PAYLOAD", "今日の総重量"],
      ["LOAD SET", "セットを追加"],
      ["TOTALS", "積み上げ"]
    ];
    for (const [label, subtitle] of subtitleChecks) {
      const h2 = page.locator(".iron-box h2", { hasText: label });
      const span = h2.locator("span").first();
      check(`${label}の副題「${subtitle}」を表示`, ((await span.textContent()) || "").includes(subtitle));
      const fontSize = await span.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      check(`${label}副題のfont-sizeは11px以上`, fontSize >= 11, String(fontSize));
    }
    // 差し戻し対応M3: 個別ラベルだけでなく、#ironRoot配下で実際に文字を持つ全要素をDOM走査し、
    // 直接のテキストノード(子要素の重複計上を避けるため各要素の直下テキストだけを見る)を持つ
    // ものについてcomputed font-sizeが11px未満で無いことを一括検査する。
    const tinyTexts = await page.evaluate(() => {
      const root = document.querySelector("#ironRoot");
      if (!root) return [{ tag: "MISSING_ROOT", text: "", fontSize: 0 }];
      const offenders = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        const ownText = Array.from(node.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join("")
          .trim();
        if (ownText.length > 0) {
          const fontSize = parseFloat(getComputedStyle(node).fontSize);
          if (fontSize < 11) offenders.push({ tag: node.tagName, className: node.className, text: ownText.slice(0, 30), fontSize });
        }
        node = walker.nextNode();
      }
      return offenders;
    });
    check("IRON LOGタブ配下で文字を持つ全要素のfont-sizeが11px以上(11px未満は0件)", tinyTexts.length === 0, JSON.stringify(tinyTexts));

    console.log("[6] 390px/1280pxで横スクロールなし・pageerror 0・state非書込(閲覧のみ)");
    check("390pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".iron-box");
    check("1280pxで横スクロールなし", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

    await page.evaluate(() => { window.__v363StorageWrites.length = 0; });
    await page.locator(".iron-box").first().scrollIntoViewIfNeeded();
    await page.mouse.move(200, 200);
    const writesAfterView = await page.evaluate(() => window.__v363StorageWrites.filter((w) => w.changed).length);
    check("閲覧操作だけではstateを書き換えない(setItemフック、変更ありwrite=0件)", writesAfterView === 0, String(writesAfterView));

    check("pageerrorは0件", pageErrors.length === 0, JSON.stringify(pageErrors));
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v363 全チェック成功" : `\n❌ v363: ${failures}件の失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
