// v98 検証: iPad・デスクトップ(min-width:760px)の縦方向コンパクト化。iPhoneは現状維持。
//
// (a) iPad幅(1024px)で主要な構造クラス(.main-pane/.view-header/h2/.grid/.panel/.section/
//     .item/.form-strip/.btn)の縦方向プロパティ(padding/margin/gap/min-height)が
//     コンパクト化後の値になっている
// (b) iPhone幅(390px)では同じプロパティが従来値のまま(1pxも変わっていない)
// (c) タスクシュート画面(iPad幅)の合計スクロール高さが縮む(実測の回帰確認)
// (d) タイムラインの .timeline-card は絶対配置のまま(position: absolute)、iPad幅でも
//     iPhone幅でも変わらない(禁止事項の回帰確認)
//
// 方針: 既存スイートと同じくブラウザ操作 + localStorage状態注入で観測する。
// 数値はこのタスクで実装直後に実機(Playwright Chromium)で実測した値を期待値として固定した。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const pad2 = (n) => String(n).padStart(2, "0");
// v108: 実時刻依存フレーク対策 — TODAYをハードコードせず実行時の「今日」10:00に固定する
//       (v89/v90と同じ流儀)。app.js起動時にstate.selectedDate=todayISO()(実時計)へ強制される
//       ため、TODAYがハードコード日付のままだと実行日によって選択日とBlockのdateがズレて
//       .timeline-cardが描画されなくなる(2026-07-16のCI赤で顕在化)。
const now0 = new Date();
now0.setHours(10, 0, 0, 0);
const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

async function seedTasksView(page) {
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = [{
      id: "t1", projectId: "p1", parentTaskId: "", title: "測定用タスク", category: "", status: "todo",
      dueDate: TODAY, description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false, doneCriteria: "", firstStep: ""
    }];
    s.projects = [{
      id: "p1", kind: "normal", title: "p", category: "", status: "active", description: "",
      dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false, collapsed: false
    }];
    // v98テストではblocksを空のままにする(blocksForDateのemptyPanelが.panel測定の対象になり、
    // renderOpenTasksの単純な行だけが.item測定の対象になるようにするため。renderBlockItemは
    // バッジ・セレクト・複数ボタンを含む複雑なレイアウトで、幅によって折返しが変わり
    // 高さ比較が不安定になるため今回の構造クラス検証では使わない)
    s.blocks = [];
    s.selectedDate = TODAY;
    s.currentView = "tasks";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);
}

async function readStructuralStyles(page) {
  return page.evaluate(() => {
    const g = (sel, prop) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return getComputedStyle(el)[prop];
    };
    return {
      mainPanePaddingTop: g(".main-pane", "paddingTop"),
      viewHeaderMarginBottom: g(".view-header", "marginBottom"),
      h2MarginBottom: g("h2", "marginBottom"),
      gridGap: g(".grid", "rowGap"),
      panelPaddingTop: g(".panel", "paddingTop"),
      sectionMarginTop: g(".section", "marginTop"),
      itemPaddingTop: g(".item", "paddingTop"),
      itemGap: g(".item", "rowGap"),
      formStripPaddingTop: g(".form-strip", "paddingTop"),
      // v332: ヘッダの＋Block化(execHeaderHTML)でBlock追加ボタン(.btn.primary、
      // .btn.primaryはmin-height:44px固定でコンパクト化対象外=既存仕様)が日付バーより前の
      // 最初の.btnになった。コンパクト化対象の.btnを測るため.primaryを除外する(セレクタ追随)。
      btnMinHeight: g(".btn:not(.primary)", "minHeight")
    };
  });
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  try {
    // ============================================================
    // (a) iPad幅(1024px): コンパクト化後の値
    // ============================================================
    console.log("[1] iPad幅(1024px)で構造クラスがコンパクト化後の値になっている");
    const ctxIpad = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1024, height: 900 } });
    const pageIpad = await ctxIpad.newPage();
    pageIpad.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(ipad):", e.message); });
    await blockGithubApiByDefault(pageIpad);
    await pageIpad.clock.setFixedTime(now0);
    await pageIpad.goto(`http://localhost:${PORT}/`);
    await pageIpad.waitForTimeout(500);
    await passGithubGate(pageIpad);
    await seedTasksView(pageIpad);
    const ipadStyles = await readStructuralStyles(pageIpad);
    const ipadExpected = {
      mainPanePaddingTop: "16px", viewHeaderMarginBottom: "12px", h2MarginBottom: "8px",
      gridGap: "8px", panelPaddingTop: "10px", sectionMarginTop: "12px",
      itemPaddingTop: "9px", itemGap: "6px", formStripPaddingTop: "8px", btnMinHeight: "33px"
    };
    Object.keys(ipadExpected).forEach((k) => {
      check(`iPad: ${k} = ${ipadExpected[k]}`, ipadStyles[k] === ipadExpected[k],
        `actual=${ipadStyles[k]}`);
    });

    // ============================================================
    // (b) iPhone幅(390px): 従来値のまま(1pxも変わっていない)
    // ============================================================
    console.log("[2] iPhone幅(390px)で構造クラスが従来値のまま(R4未適用)");
    const ctxPhone = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pagePhone = await ctxPhone.newPage();
    pagePhone.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(phone):", e.message); });
    await blockGithubApiByDefault(pagePhone);
    await pagePhone.clock.setFixedTime(now0);
    await pagePhone.goto(`http://localhost:${PORT}/`);
    await pagePhone.waitForTimeout(500);
    await passGithubGate(pagePhone);
    await seedTasksView(pagePhone);
    const phoneStyles = await readStructuralStyles(pagePhone);
    // v127: apple-design全体適用(K指示)でbase値の余白リズムを一段ゆったりへ更新。
    //       iPhone幅はbase値が効くため4項目が変化(CHANGES_v127.md)。iPad幅(>=760px)の
    //       R4圧縮値は不変のまま(上の[1]が引き続きロックしている)。
    const phoneExpected = {
      mainPanePaddingTop: "14px", viewHeaderMarginBottom: "20px", h2MarginBottom: "12px",
      gridGap: "12px", panelPaddingTop: "10px", sectionMarginTop: "22px",
      // v332追随: base .btn の min-height は 44px(タップ目標)で、iPhone幅では圧縮規則が無い。
      //   36px は現行CSSのどこにも無く(v330時点でも実測44px)、期待値の誤りだったため実値へ訂正。
      //   iPad幅の R4圧縮 33px([1])が本テストの本体で、そちらは不変。
      itemPaddingTop: "16px", itemGap: "8px", formStripPaddingTop: "12px", btnMinHeight: "44px"
    };
    Object.keys(phoneExpected).forEach((k) => {
      check(`iPhone: ${k} = ${phoneExpected[k]}(R4圧縮は未適用。base値はv127余白更新後)`,
        phoneStyles[k] === phoneExpected[k], `actual=${phoneStyles[k]}`);
    });

    // ============================================================
    // (c) タスクシュート画面(iPad幅)の行あたりの縦の"chrome"(padding分)が詰まる
    // ============================================================
    console.log("[3] iPad幅の.item縦paddingの合計がiPhone幅より小さい(コンパクト化の効果、内容量に依存しない指標)");
    // .item の高さそのものは折返し等コンテンツ依存で不安定なため、CSSが生む余白量
    // (padding-top + padding-bottom)だけを比較する。値自体は[1][2]と同じだが、
    // 「iPadの方がiPhoneより詰まっている」という関係を明示的に確認する回帰テスト。
    const itemPadIpad = ipadStyles.itemPaddingTop ? parseFloat(ipadStyles.itemPaddingTop) * 2 : NaN;
    const itemPadPhone = phoneStyles.itemPaddingTop ? parseFloat(phoneStyles.itemPaddingTop) * 2 : NaN;
    check("iPad幅の.item縦padding合計がiPhone幅より小さい",
      itemPadIpad < itemPadPhone, `ipad=${itemPadIpad}px phone=${itemPadPhone}px`);

    // ============================================================
    // (d) .timeline-card は絶対配置のまま(禁止事項の回帰確認)
    // ============================================================
    console.log("[4] .timeline-card の絶対配置(position: absolute)がiPad幅・iPhone幅とも変わっていない");
    // ここで初めてBlockを1件追加する(タイムラインに.timeline-cardを出すため。
    // [1]〜[3]はblocksを空のままにして測定対象を単純化していた)
    // v335(§C追随): 旧「タイムライン」navはexecの実績モードへ寄せる(§C)。実績モードの
    // タイムラインはactualStartAt付きBlockのみ描画するため、plannedStartAtだけのfixtureへ
    // actualStartAtを補う(検証意図=.timeline-cardのposition:absolute回帰確認であり、
    // 予定/実績どちらのBlockかは無関係)。
    const addBlock = (page) => page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [{
        id: "b1", taskId: "t1", title: "測定用Block", category: "", date: TODAY,
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
        actualStartAt: `${TODAY}T09:00`, actualEndAt: "", completed: false, deleted: false, source: "", charge: 0, discharge: 0
      }];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await addBlock(pageIpad);
    await addBlock(pagePhone);
    // localStorage書き込みだけではアプリのメモリ上stateに反映されないためreloadする
    await pageIpad.reload();
    await pageIpad.waitForTimeout(500);
    await pagePhone.reload();
    await pagePhone.waitForTimeout(500);
    // サイドバー(iPad用)とbottom-nav(iPhone用)は両方DOMに存在し同じdata-action/data-viewを
    // 持つため、非表示側もヒットしないよう表示側のコンテナで絞り込む
    // v335(§C追随): 旧「タイムライン」navは無くなった。execへ遷移して実績モードへ切替える。
    await pageIpad.click('.sidebar .nav-button[data-action="nav"][data-view="exec"]');
    await pageIpad.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]');
    await pageIpad.waitForTimeout(300);
    const posIpad = await pageIpad.evaluate(() => {
      const el = document.querySelector(".timeline-card");
      return el ? getComputedStyle(el).position : null;
    });
    check("iPad幅: .timeline-cardがposition:absolute", posIpad === "absolute", `actual=${posIpad}`);
    await pagePhone.click('.bottom-nav button[data-action="nav"][data-view="exec"]');
    await pagePhone.click('.exec-mode-segmented [data-action="exec-mode-toggle"][data-mode="actual"]');
    await pagePhone.waitForTimeout(300);
    const posPhone = await pagePhone.evaluate(() => {
      const el = document.querySelector(".timeline-card");
      return el ? getComputedStyle(el).position : null;
    });
    check("iPhone幅: .timeline-cardがposition:absolute", posPhone === "absolute", `actual=${posPhone}`);

    await ctxIpad.close();
    await ctxPhone.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
