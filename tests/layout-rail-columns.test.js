// remediation/css-rail 検証: 「railを出すか」の判断をrenderTimelineRail 1か所へ一本化し、
// #app(.app-shell)へ appRootEl.dataset.rail("on"/"off")を立て、styles.css側はそれと
// .sidebar.collapsed / @media(max-width:1020px) だけを見て列数・サイドバー幅を決める方式へ
// 直した(css-1020-review.md 推奨1〜4)。従来はrenderTimelineRailが毎render #app へ
// inline style.gridTemplateColumns を書いており、@media(max-width:1020px) の .app-shell が
// 常にinlineへ負けて一度も効いていなかった(同reviewの真因)。
//
// 確認観点:
// (1) 1400px: exec(計画/実績とも)=2列・rail非表示(v335が明示的に見送った「execの計画モードでも
//     railを表示する」拡張は復活させない。timeline.js:88-94のコメント参照・関心事1つ/Blockロジック
//     不変のため対象外) / 旧tasksビューへ直接setView=3列・railは同じ行(y===mainのy) /
//     gate画面(トークン未設定)=2列・rail非表示
// (2) 1000px・768px: 全ビュー2列、サイドバー184px、本文幅=ビューポート-184
// (3) 折りたたみ(.sidebar.collapsed): 1400pxで56px、1000pxでも56px
// (4) 720px以下: display:block(既存のモバイルレイアウトへ切り替わる)
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-05";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return {
    id, title: "プロジェクトA", kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}
function task(id, extra = {}) {
  return {
    id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}
function block(id, taskId, extra = {}) {
  return {
    id, taskId, date: TODAY, title: id, category: "仕事",
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false, isMIT: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const layoutOf = async () => page.evaluate(() => {
    const appEl = document.querySelector("#app");
    const sidebarEl = document.querySelector(".sidebar");
    const mainEl = document.querySelector(".main-pane") || document.querySelector("#main");
    const railEl = document.querySelector(".timeline-rail");
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    return {
      dataRail: appEl.dataset.rail || "",
      display: getComputedStyle(appEl).display,
      columns: getComputedStyle(appEl).gridTemplateColumns.trim().split(/\s+/).filter(Boolean),
      sidebarWidth: sidebarEl ? rect(sidebarEl).width : null,
      mainWidth: mainEl ? rect(mainEl).width : null,
      railDisplay: railEl ? getComputedStyle(railEl).display : null,
      railY: railEl ? rect(railEl).y : null,
      mainY: mainEl ? rect(mainEl).y : null,
      clientWidth: document.documentElement.clientWidth
    };
  });

  const setState = async (values) => {
    await page.evaluate(({ key, values }) => {
      const current = JSON.parse(localStorage.getItem(key));
      Object.assign(current, values);
      localStorage.setItem(key, JSON.stringify(current));
    }, { key: STATE_KEY, values });
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
  };

  try {
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    await setState({
      selectedDate: TODAY,
      projects: [project("p1")],
      tasks: [task("t1"), task("t2")],
      blocks: [block("b1", "t1"), block("b2", "t2", {
        plannedStartAt: `${TODAY}T10:00:00`, plannedEndAt: `${TODAY}T10:30:00`
      })],
      currentView: "exec"
    });

    // ============================================================
    console.log("[1] 1400px: exec(計画/実績とも)=2列・rail非表示 / gate=2列・rail非表示 / 旧tasks直接=3列・railは同じ行");
    // ============================================================
    // v335が明示的に見送った「execの計画モードでもrailを表示する」拡張(timeline.js:88-94の
    // コメント参照)は本変更単位では復活させない(関心事1つ・Blockロジック不変)。
    // execはcurrentView !== "tasks"のため計画/実績いずれのモードでも常に2列・rail非表示。
    await setState({ currentView: "exec", timelineMode: "planned" });
    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForTimeout(150);
    let L = await layoutOf();
    check("exec+計画: data-rail=off", L.dataRail === "off", JSON.stringify(L));
    check("exec+計画: 2列", L.columns.length === 2, JSON.stringify(L));
    check("exec+計画: railが非表示", L.railDisplay === "none", JSON.stringify(L));

    await page.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForTimeout(150);
    L = await layoutOf();
    check("exec+実績: data-rail=off", L.dataRail === "off", JSON.stringify(L));
    check("exec+実績: 2列", L.columns.length === 2, JSON.stringify(L));
    check("exec+実績: railが非表示", L.railDisplay === "none", JSON.stringify(L));

    // gate画面(トークン未設定)。settings.github.tokenを空にして再読込。
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    L = await layoutOf();
    check("gate画面: data-rail属性なし(未設定)", L.dataRail === "", JSON.stringify(L));
    check("gate画面: 2列", L.columns.length === 2, JSON.stringify(L));
    check("gate画面: railが非表示", L.railDisplay === "none", JSON.stringify(L));
    await passGithubGate(page);

    // 旧tasksビューへ直接setView(テストのseedによる直接注入)。renderTimelineRailの
    // 表示条件(state.currentView !== "tasks")が生きている唯一の導線。
    await setState({ currentView: "tasks" });
    L = await layoutOf();
    check("旧tasksビュー直接: data-rail=on", L.dataRail === "on", JSON.stringify(L));
    check("旧tasksビュー直接: 3列(rail 360px)", L.columns.length === 3 && L.columns[2] === "360px", JSON.stringify(L));
    check("旧tasksビュー直接: railが可視かつ#mainと同じ行(display!=none かつ y一致、折り返し無しの複合条件)",
      L.railDisplay !== "none" && L.railY !== null && Math.abs(L.railY - L.mainY) < 2, JSON.stringify(L));

    // ============================================================
    console.log("[2] 1000px/768px: 全ビュー2列・サイドバー184px・本文幅=ビューポート-184");
    // ============================================================
    for (const width of [1000, 768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["exec", "tasks", "today", "more"]) {
        await setState({ currentView: view, timelineMode: "planned" });
        L = await layoutOf();
        check(`${width}px/${view}: 2列`, L.columns.length === 2, JSON.stringify(L));
        check(`${width}px/${view}: サイドバー184px`, Math.round(L.sidebarWidth) === 184, JSON.stringify(L));
        check(`${width}px/${view}: 本文幅=ビューポート-184`,
          Math.abs(L.mainWidth - (width - 184)) <= 2, JSON.stringify(L));
      }
    }

    // ============================================================
    console.log("[3] 折りたたみ(.sidebar.collapsed): 1400pxで56px、1000pxでも56px");
    // ============================================================
    await page.setViewportSize({ width: 1400, height: 900 });
    await setState({ currentView: "exec" });
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.sidebarCollapsed = true;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    L = await layoutOf();
    check("1400px折りたたみ: サイドバー56px", Math.round(L.sidebarWidth) === 56, JSON.stringify(L));

    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(100);
    L = await layoutOf();
    check("1000px折りたたみ: サイドバー56px", Math.round(L.sidebarWidth) === 56, JSON.stringify(L));

    // 折りたたみ解除
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.sidebarCollapsed = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });

    // ============================================================
    console.log("[4] 720px以下: display:block");
    // ============================================================
    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForTimeout(100);
    L = await layoutOf();
    check("720px: .app-shellはdisplay:block", L.display === "block", JSON.stringify(L));

    check("一連の操作でpageerrorが発生しない", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
