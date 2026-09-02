// v315: IRON LOGの前回値プリフィルと、既存記録を超えた重量だけの静かなPR表示を固定する。
const path = require("path");
const { pathToFileURL } = require("url");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const TODAY = "2026-09-02";
const PAST = "2026-09-01";
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function gymSet(id, date, exercise, weight, reps, time = "09:00", blockId = "past-gym") {
  const at = `${date}T${time}`;
  return { id, exercise, weight, reps, at, createdAt: at, updatedAt: at, blockId };
}

(async () => {
  const { lastSetForExercise, bestWeightForExercise } = await import(
    pathToFileURL(path.join(ROOT, "src", "features", "iron-log.js")).href
  );

  console.log("[1] 純粋関数は日付・時刻降順、tombstone除外、beforeAt未満を守る");
  const pureState = { condition: { logs: {
    "2026-09-01": { gym: [
      gymSet("old", "2026-09-01", "ベンチプレス", 60, 8, "09:00"),
      gymSet("deleted", "2026-09-01", "ベンチプレス", 90, 1, "10:00"),
      { ...gymSet("latest", "2026-09-01", "ベンチプレス", 62.5, 6, "11:00") }
    ] },
    "2026-09-02": { gym: [
      { ...gymSet("tombstone", "2026-09-02", "ベンチプレス", 100, 1, "08:00"), deleted: true },
      gymSet("today", "2026-09-02", "ベンチプレス", 65, 5, "09:00")
    ] }
  } } };
  pureState.condition.logs["2026-09-01"].gym[1].deleted = true;
  check("lastSetForExerciseは当日を含む最新activeセット",
    lastSetForExercise(pureState, "ベンチプレス", TODAY)?.id === "today");
  check("bestWeightForExerciseはbeforeAtと同時刻を除外して最大重量を返す",
    bestWeightForExercise(pureState, "ベンチプレス", `${TODAY}T09:00`) === 62.5);
  check("履歴無しは両関数ともnull",
    lastSetForExercise(pureState, "スクワット", TODAY) === null
      && bestWeightForExercise(pureState, "スクワット", `${TODAY}T12:00`) === null);

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  async function storedTodaySets() {
    return page.evaluate(({ key, today }) =>
      JSON.parse(localStorage.getItem(key)).condition.logs[today].gym, { key: STATE_KEY, today: TODAY });
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 8, 2, 12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate(({ key, today, past }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "iron-log";
      state.selectedDate = today;
      state.settings.gymExerciseList = ["ベンチプレス", "スクワット", "デッドリフト"];
      state.blocks = [{
        id: "running-gym", title: "筋トレ", category: "ジム", date: today,
        actualStartAt: `${today}T11:00`, actualEndAt: "", deleted: false
      }];
      state.condition.logs[past] = { gym: [
        { id: "past-bench", exercise: "ベンチプレス", weight: 60, reps: 8,
          at: `${past}T18:00`, createdAt: `${past}T18:00`, updatedAt: `${past}T18:00`, blockId: "past-gym" },
        { id: "past-squat", exercise: "スクワット", weight: 80, reps: 5,
          at: `${past}T19:00`, createdAt: `${past}T19:00`, updatedAt: `${past}T19:00`, blockId: "past-gym" }
      ] };
      state.condition.logs[today] = { gym: [] };
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, today: TODAY, past: PAST });
    await page.reload();
    await page.waitForSelector('#app[data-view="iron-log"] #ironFormExercise');

    console.log("[2] 初期プリフィル所有権とchange限定ガード");
    check("(a) 初期表示で先頭種目Aの60kg×8をプリフィル",
      (await page.locator("#ironFormWeight").inputValue()) === "60"
        && (await page.locator("#ironFormReps").inputValue()) === "8");
    await page.locator("#ironFormReps").fill("");
    await page.click("#ironFormExercise");
    check("(d) selectのclickだけでは欄を変更しない",
      (await page.locator("#ironFormWeight").inputValue()) === "60"
        && (await page.locator("#ironFormReps").inputValue()) === "");
    await page.selectOption("#ironFormExercise", "スクワット");
    check("(a) 種目Bへの切替で80kg×5へ更新",
      (await page.locator("#ironFormWeight").inputValue()) === "80"
        && (await page.locator("#ironFormReps").inputValue()) === "5");
    await page.selectOption("#ironFormExercise", "デッドリフト");
    check("(b) 履歴なし種目Cへの切替で両欄を空にする",
      (await page.locator("#ironFormWeight").inputValue()) === ""
        && (await page.locator("#ironFormReps").inputValue()) === "");

    console.log("[3] ユーザー編集済みの欄だけ所有権を外す");
    await page.selectOption("#ironFormExercise", "ベンチプレス");
    await page.locator("#ironFormWeight").fill("70");
    await page.selectOption("#ironFormExercise", "スクワット");
    check("(c) Bへの切替で編集済み70を維持し、回数だけ5へ更新",
      (await page.locator("#ironFormWeight").inputValue()) === "70"
        && (await page.locator("#ironFormReps").inputValue()) === "5");

    console.log("[4] 65kg更新だけにPRタグと自己ベストトースト、続く60kgには付かない");
    await page.locator("#ironFormWeight").fill("");
    await page.locator("#ironFormReps").fill("");
    await page.selectOption("#ironFormExercise", "ベンチプレス");
    await page.locator("#ironFormWeight").fill("65");
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 1);
    check("65kg行にPRタグ", await page.locator(".iron-set-row").first().locator(".iron-pr").count() === 1);
    check("PR追加トーストに自己ベストを含む", (await page.locator("#toast").textContent()).includes("自己ベスト"));

    await page.selectOption("#ironFormExercise", "ベンチプレス");
    await page.locator("#ironFormWeight").fill("60");
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 2);
    const rows = page.locator(".iron-set-row");
    check("新しい60kg行にPR無し、先の65kg行にはPRを維持",
      await rows.nth(0).locator(".iron-pr").count() === 0
        && await rows.nth(1).locator(".iron-pr").count() === 1);

    console.log("[5] 初記録種目はPRにせず、gym[]スキーマを増やさない");
    await page.selectOption("#ironFormExercise", "デッドリフト");
    check("履歴無し種目は再描画後も空欄",
      (await page.locator("#ironFormWeight").inputValue()) === ""
        && (await page.locator("#ironFormReps").inputValue()) === "");
    await page.locator("#ironFormWeight").fill("50");
    await page.locator("#ironFormReps").fill("5");
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 3);
    check("履歴無し種目の初回セットにはPRタグも自己ベストトーストも出ない",
      await page.locator(".iron-set-row").first().locator(".iron-pr").count() === 0
        && !(await page.locator("#toast").textContent()).includes("自己ベスト"));

    const todaySets = await storedTodaySets();
    const expectedKeys = ["at", "blockId", "createdAt", "exercise", "id", "reps", "updatedAt", "weight"];
    check("新規gym[]要素のキー集合は従来8キーだけ",
      todaySets.length === 3
        && todaySets.every((set) => JSON.stringify(Object.keys(set).sort()) === JSON.stringify(expectedKeys)),
      JSON.stringify(todaySets));
    check("全ケースでpageerror 0件", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v315: 全テスト成功" : `\n❌ v315: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
