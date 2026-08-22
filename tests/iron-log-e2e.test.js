// tests/iron-log-e2e.test.js(先行執筆・結線前) — P4 IRON LOG専用画面のE2E契約。
// 正典: p4-interface.md §3(iron-log.js界面凍結)、slim-spec.md §2-2・§3(仕様)。
// v233の対象は画面結線・表示・当日セット追加・実行中Block連動まで。
// NOW LANDING導線・Block完了時の自動転記・未記録確認はv234以降のため本E2Eの対象外。
// tower-core.test.js / helpers.js の書式・helpers利用・seed流儀をそのまま踏襲する。
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
  const fixedTime = (h = 12, m = 0, s = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, s, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const today = isoOf(base);
  const atMinute = (date, minute) => `${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00`;
  const block = (id, title, date, minute, extra = {}) => ({
    id, title, date, category: "開発", plannedStartAt: atMinute(date, minute), plannedEndAt: "",
    actualStartAt: "", actualEndAt: "", completed: false, deleted: false, orderIndex: 0, ...extra
  });
  // ジム系Block(既定キーワード ["ジム","筋トレ"] に一致させる)。
  const gymBlock = (id, title, minute, extra = {}) => block(id, title, today, minute, { category: "ジム", ...extra });

  // condition.logs[today].gym の1セット。at はfixed clock範囲内のHH:mm。
  const set = (exercise, weight, reps, minute, extra = {}) => ({ exercise, weight, reps, at: atMinute(today, minute), ...extra });

  async function seed({ view = "iron-log", blocks = [], gym = [], settings = {}, reload = true } = {}) {
    await page.evaluate(({ KEY, view, blocks, gym, settings, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = view;
      s.blocks = blocks;
      s.condition = s.condition || {};
      s.condition.logs = s.condition.logs || {};
      s.condition.logs[today] = s.condition.logs[today] || {};
      s.condition.logs[today].gym = gym;
      s.settings = { ...s.settings, ...settings };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, view, blocks, gym, settings, today });
    if (reload) {
      await page.reload();
      await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
    }
  }

  async function readState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    console.log("[1] gym[]ありでIRON LOG画面がPAYLOAD/TODAY'S SETS/TOTALSを描画する");
    await seed({
      gym: [set("ベンチプレス", 60, 10, 9 * 60), set("スクワット", 80, 5, 9 * 60 + 10)]
    });
    check("ヘッダはIRON LOG/筋トレ", (await page.locator(".eyebrow").textContent()) === "IRON LOG"
      && (await page.locator(".view-header h1").textContent()) === "筋トレ");
    check("PAYLOADは合計1,000kgを表示", (await page.locator(".iron-total span").textContent()) === "1,000");
    check("DAILY TARGETは既定2,000kg", ((await page.locator(".iron-goal-line").textContent()) || "").includes("2,000 kg"));
    check("ゲージ幅は目標比50%", (await page.locator(".iron-bar").getAttribute("style") || "").includes("width:50%"));
    check("未達成時はgoal-hitクラスなし", await page.locator(".iron.goal-hit").count() === 0);
    const remain = await page.locator(".iron-remain").textContent();
    check("残量とセット換算ヒントを表示(直近セット80kg×5であと3セット)", /あと\s*1,000\s*kg/.test(remain || "")
      && /80kg×5回 をあと 3 セット/.test(remain || ""), remain);
    const rows = page.locator(".iron-set-row");
    check("TODAY'S SETSは新しいセットが先頭(新→旧)", await rows.count() === 2
      && (await rows.nth(0).locator(".iron-set-name").textContent()) === "スクワット"
      && (await rows.nth(1).locator(".iron-set-name").textContent()) === "ベンチプレス");
    check("各行に重量×回数と小計kgを表示", (await rows.nth(0).locator(".iron-set-detail").textContent()) === "80kg × 5"
      && (await rows.nth(0).locator(".iron-set-kg").textContent()) === "+400");
    check("TOTALSは累計/今月/自己ベストの3枚", await page.locator(".iron-totals-cell").count() === 3
      && (await page.locator(".iron-totals-cell").nth(1).locator("strong").textContent()) === "1,000 kg");
    check("実行中ジムタスクが無ければLINKED FLIGHTは未連動表示", await page.locator(".iron-linked-status.is-idle").count() === 1
      && ((await page.locator(".iron-linked-status.is-idle").textContent()) || "").includes("未連動"));

    console.log("[2] 1行フォームでセット追加→当日総重量とゲージが即時更新");
    await seed({ gym: [] });
    check("初期状態は0kg・0%", (await page.locator(".iron-total span").textContent()) === "0"
      && (await page.locator(".iron-bar").getAttribute("style") || "").includes("width:0%"));
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelector(".iron-total span")?.textContent !== "0");
    check("既定値(ベンチプレス60kg×10)追加で600kgへ更新", (await page.locator(".iron-total span").textContent()) === "600");
    check("ゲージ幅が30%へ更新", (await page.locator(".iron-bar").getAttribute("style") || "").includes("width:30%"));
    const afterAdd = await readState();
    const addedSet = afterAdd.condition.logs[today].gym[0];
    check("state.condition.logs[当日].gymへ1件追加される", afterAdd.condition.logs[today].gym.length === 1
      && addedSet.exercise === "ベンチプレス" && addedSet.weight === 60 && addedSet.reps === 10, JSON.stringify(addedSet));

    console.log("[3] 2,000kg目標達成でTARGET ACHIEVEDバナーが点灯する");
    await seed({ gym: [set("ベンチプレス", 110, 10, 9 * 60), set("ベンチプレス", 110, 10, 9 * 60 + 10)] }); // 2,200kg
    check("合計2,200kgでgoal-hitクラスが付く", await page.locator(".iron.goal-hit").count() === 1);
    const achievedDisplay = await page.locator(".iron-achieved").evaluate((el) => getComputedStyle(el).display);
    check("TARGET ACHIEVEDバナーが表示状態(display!=none)", achievedDisplay !== "none", achievedDisplay);
    check("TARGET ACHIEVEDの文言を表示", ((await page.locator(".iron-achieved").textContent()) || "").includes("TARGET ACHIEVED"));
    check("達成時は目標超過表示に切替", ((await page.locator(".iron-remain").textContent()) || "").includes("目標超過")
      && ((await page.locator(".iron-remain").textContent()) || "").includes("+200"));

    console.log("[4] 実行中ジムBlockはLINKED FLIGHTに表示され、追加セットがblockIdで紐づく");
    const running = gymBlock("gym-running", "本日の筋トレ", 9 * 60, { actualStartAt: atMinute(today, 9 * 60) });
    await page.clock.setFixedTime(fixedTime(9, 30, 0)); // 開始から30分経過
    await seed({ blocks: [running], gym: [] });
    check("LINKED FLIGHTが実行中表示", await page.locator(".iron-linked-status:not(.is-idle)").count() === 1
      && ((await page.locator(".iron-linked-status").textContent()) || "").includes("実行中"));
    check("連動タスク名を表示", (await page.locator(".iron-linked-name").textContent()) === "本日の筋トレ");
    const linkedTime = await page.locator(".iron-linked-time").textContent();
    check("開始時刻09:00と経過00:30を表示", /09:00 開始/.test(linkedTime || "") && /00:30/.test(linkedTime || ""), linkedTime);
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 1);
    const linkedState = await readState();
    const linkedAddedSet = linkedState.condition.logs[today].gym[0];
    check("追加したセットのblockIdが実行中Blockに一致", linkedAddedSet.blockId === "gym-running", JSON.stringify(linkedAddedSet));

    console.log(failures === 0 ? "[iron-log-e2e] 全PASS" : `[iron-log-e2e] ${failures}件失敗`);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
})();

