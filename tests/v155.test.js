// v155 検証: ADHD支援「②今日の庭 S2」(月間ピクセル、CHANGES_v155.md参照)。
// 罰なしゲーミフィケーション(designs/11-habit-garden.md §④「罰なしルールの仕様化」)。
//
// 実装差分メモ(完了報告にも記載): 設計書§④は「達成順の累積方式」(モチーフ絵、未達日は
// 穴としてすら見せない)を本命としていたが、decisions.md 2026-07-27でK確定した点灯仕様は
// 「完了1件=薄緑/50%以上=緑/全完了=濃緑、0件の日は空白」という段階表示であり、これは
// 実カレンダー(日付位置固定)を前提とする仕様(累積方式には「50%以上」の段階概念が無い)。
// 本実装はK確定のこの段階表示をそのまま実カレンダーへ適用し、累積方式・モチーフ絵は不採用。
//
// (A) 3段階の描画: 完了1件(rank1=薄緑・lv1)/ 50%以上(rank2=緑・lv2)/ 全完了(rank3=濃緑・lv3)
// (B) 空白の描画: 0件(done=0)の日・gardenLogにエントリが無い日はどちらもlvクラスが付かない
//     (in-monthの罫線のみ。罰なし=バツ・警告色を使わない)
// (C) 月境界: 月初の曜日オフセット分だけpaddingセル(in-monthクラス無し)が入り、当月の
//     日数ぶんだけin-monthセルが並ぶ(前月・翌月の日付を巻き込まない)
// (D) gardenLog無し月: gardenLogが空でもクラッシュせず、全セルが空白のまま描画される
// (E) 罰なし表現の不在: カード内のテキストに連続日数・比較・催促の文言が無い
// (F) 月送り: ◀/▶クリックで表示月が変わり、当月より先(未来月)へは進めない(▶がdisabled)
//
// 2系統レビュー対応(2026-07-28)で追加:
// (G) 月境界の実式検証: page.clock.setFixedTime()でブラウザの「現在時刻」自体をうるう年2月
//     (2028-02=29日)/平年2月(2026-02=28日)/30日の月(2026-04=30日)へ固定してから初回描画させ、
//     in-monthセル数がそれぞれ29/28/30になることを確認する(実装式のトートロジーではなく、
//     うるう年・月末日数のズレを外部から検証する。内部変数_gardenPixelMonthへのpage.evaluate
//     直接注入は、app.jsが非モジュールscriptでトップレベルlet/functionがpage.evaluateの
//     実行スコープから読み書きできない(ReferenceError)ことを確認したため不採用にした)
// (H) 年跨ぎ: 1月表示から◀(前月)クリックで前年12月(31日)へ遷移することを確認する
// (H2) 月跨ぎの回帰確認: reloadせず(=PWAを開きっぱなしのまま)時計だけ月をまたがせ、
//     タブ切替(renderRoutine()の再実行)で当月へ自動同期されることを確認する
// (I) VoiceOver: in-monthセルにrole="listitem"+加点表現のみのaria-label、gridに
//     role="list"が付いていることを確認する
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function pad2(n) { return String(n).padStart(2, "0"); }
const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth() + 1;  // 1-12
const MONTH_KEY = `${Y}-${pad2(M)}`;
const DAYS_IN_MONTH = new Date(Y, M, 0).getDate();
const FIRST_DOW = new Date(Y, M - 1, 1).getDay();

function dISO(day) { return `${MONTH_KEY}-${pad2(day)}`; }

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  // ============================================================
  // Part A/B/C/D/E: 描画(単一コンテキストで状態を差し替えながら検証)
  // ============================================================
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  await passGithubGate(page);

  async function gotoRoutineWith(gardenLog) {
    await page.evaluate(({ KEY, gardenLog }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.gardenLog = gardenLog;
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, gardenLog });
    await page.reload();
    await page.waitForTimeout(400);
  }

  console.log("[D] gardenLog無し月(空オブジェクト)でもクラッシュせず、月間ピクセルは表示される");
  await gotoRoutineWith({});
  check("garden-pixel-cardが表示される", await page.locator(".garden-pixel-card").count() === 1);
  const totalCellsD = await page.locator(".garden-pixel-grid .garden-pixel-cell").count();
  check("グリッドのセル数はpadding+当月日数(=firstDow+daysInMonth)", totalCellsD === FIRST_DOW + DAYS_IN_MONTH, `got=${totalCellsD} want=${FIRST_DOW + DAYS_IN_MONTH}`);
  check("gardenLogが空なら点灯セル(lv1/2/3)が1つも無い", await page.locator(".garden-pixel-grid .garden-pixel-cell[class*='lv']").count() === 0);

  console.log("[C] 月境界: paddingセル(in-monthクラス無し)の数=月初の曜日オフセット、in-monthセルの数=当月日数");
  const paddingCells = await page.locator(".garden-pixel-grid > .garden-pixel-cell:not(.in-month)").count();
  check("paddingセル数=当月1日の曜日オフセット", paddingCells === FIRST_DOW, `got=${paddingCells} want=${FIRST_DOW}`);
  const inMonthCells = await page.locator(".garden-pixel-grid .garden-pixel-cell.in-month").count();
  check("in-monthセル数=当月の日数", inMonthCells === DAYS_IN_MONTH, `got=${inMonthCells} want=${DAYS_IN_MONTH}`);
  const firstDate = await page.locator(".garden-pixel-grid .garden-pixel-cell.in-month").first().getAttribute("data-date");
  const lastDate = await page.locator(".garden-pixel-grid .garden-pixel-cell.in-month").last().getAttribute("data-date");
  check("先頭のin-monthセルは当月1日", firstDate === dISO(1), firstDate);
  check("末尾のin-monthセルは当月末日", lastDate === dISO(DAYS_IN_MONTH), lastDate);

  console.log("[A/B] 3段階(薄緑/緑/濃緑)+空白の描画(1件=lv1、50%以上=lv2、全完了=lv3、0件/エントリ無し=空白)");
  // 月の前半に収まる日だけを使う(月末近辺の日を使うと月境界と衝突しテストが読みにくくなるため)。
  const gardenLog = {
    [dISO(2)]: { done: 1, total: 4 },  // 25% → lv1(薄緑)
    [dISO(3)]: { done: 2, total: 4 },  // 50% → lv2(緑、境界値ちょうど)
    [dISO(4)]: { done: 4, total: 4 },  // 100% → lv3(濃緑)
    [dISO(5)]: { done: 0, total: 4 }   // 0件 → 空白(K確定の罰なし仕様)
    // dISO(6) はエントリ自体を作らない → 空白
  };
  await gotoRoutineWith(gardenLog);
  async function cellClass(day) {
    return page.locator(`.garden-pixel-cell[data-date="${dISO(day)}"]`).getAttribute("class");
  }
  check("1件(25%)はlv1(薄緑)", (await cellClass(2)).includes("lv1"), await cellClass(2));
  check("2件(50%、境界値)はlv2(緑)", (await cellClass(3)).includes("lv2"), await cellClass(3));
  check("4件(全完了)はlv3(濃緑)", (await cellClass(4)).includes("lv3"), await cellClass(4));
  const cls5 = await cellClass(5);
  check("0件の日はlvクラスが無い(空白のまま、罰なし)", !/lv[123]/.test(cls5), cls5);
  const cls6 = await cellClass(6);
  check("gardenLogにエントリが無い日もlvクラスが無い(空白のまま)", !/lv[123]/.test(cls6), cls6);

  console.log("[I] VoiceOver: role/aria-labelが加点表現のみで付与される");
  check("グリッドにrole=\"list\"が付く", await page.locator('.garden-pixel-grid[role="list"]').count() === 1);
  check("in-monthセルにrole=\"listitem\"が付く(当月日数ぶん)", await page.locator('.garden-pixel-grid .garden-pixel-cell.in-month[role="listitem"]').count() === DAYS_IN_MONTH);
  const ariaLv3 = await page.locator(`.garden-pixel-cell[data-date="${dISO(4)}"]`).getAttribute("aria-label");
  check("全完了セルのaria-labelは加点表現(「全部できた」)", ariaLv3 && ariaLv3.includes("全部できた"), ariaLv3);
  const ariaLv1 = await page.locator(`.garden-pixel-cell[data-date="${dISO(2)}"]`).getAttribute("aria-label");
  check("1件セルのaria-labelは加点表現(「少しできた」)", ariaLv1 && ariaLv1.includes("少しできた"), ariaLv1);
  const ariaBlank = await page.locator(`.garden-pixel-cell[data-date="${dISO(5)}"]`).getAttribute("aria-label");
  check("0件セルのaria-labelは日付のみ(否定語なし)", ariaBlank === `${M}月5日`, ariaBlank);
  const forbiddenAria = ["未達", "できなかった", "0件", "残り", "あと"];
  forbiddenAria.forEach((word) => {
    check(`0件セルのaria-labelに否定語「${word}」が無い`, !ariaBlank.includes(word), ariaBlank);
  });

  console.log("[E] 罰なし表現の不在: 月間ピクセルのカード内テキストに連続日数・比較・催促の文言が無い");
  const cardText = await page.locator(".garden-pixel-card").textContent();
  const forbidden = ["連続", "streak", "先月", "平均", "もったいない", "あと", "未達", "残り"];
  forbidden.forEach((word) => {
    check(`カード内に禁止語「${word}」が無い`, !cardText.includes(word), cardText);
  });

  await ctx.close();

  // ============================================================
  // Part F: 月送り
  // ============================================================
  console.log("[F] 月送り: ◀/▶で表示月が変わる。当月より先(未来)へは進めない");
  const ctxF = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 1200 } });
  const pageF = await ctxF.newPage();
  pageF.on("pageerror", (e) => { failures++; console.log("  ❌ [F] pageerror:", e.message); });
  await blockGithubApiByDefault(pageF);
  await pageF.goto(`http://localhost:${PORT}/`);
  await pageF.waitForTimeout(500);
  await passGithubGate(pageF);
  await pageF.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.currentView = "routine";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await pageF.reload();
  await pageF.waitForTimeout(400);

  const labelNow = await pageF.locator(".garden-pixel-month-label").textContent();
  check("初期表示は当月", labelNow.trim() === `${Y}年${M}月`, labelNow);
  check("当月表示では▶(次の月)がdisabled(未来月へ進ませない)",
    await pageF.locator('[data-action="garden-pixel-month"][data-delta="1"]').isDisabled());

  await pageF.click('[data-action="garden-pixel-month"][data-delta="-1"]');
  await pageF.waitForTimeout(200);
  const labelPrev = await pageF.locator(".garden-pixel-month-label").textContent();
  const prevY = M === 1 ? Y - 1 : Y;
  const prevM = M === 1 ? 12 : M - 1;
  check("◀クリックで前月表示になる", labelPrev.trim() === `${prevY}年${prevM}月`, labelPrev);
  check("前月表示では▶が有効化される(disabledでない)",
    !(await pageF.locator('[data-action="garden-pixel-month"][data-delta="1"]').isDisabled()));

  await pageF.click('[data-action="garden-pixel-month"][data-delta="1"]');
  await pageF.waitForTimeout(200);
  const labelBack = await pageF.locator(".garden-pixel-month-label").textContent();
  check("▶クリックで当月表示に戻る", labelBack.trim() === `${Y}年${M}月`, labelBack);

  console.log("[F2] 当月表示から▶をクリックしても(disabled経由でなくアプリのガードとして)未来月へは進まない");
  await pageF.evaluate(() => {
    // disabled属性を無視して強制的にクリック相当のイベントを発火させ、アプリ側ガード
    // (addMonthsKey結果がtodayISO().slice(0,7)より先なら無視する分岐)自体を検証する。
    const btn = document.querySelector('[data-action="garden-pixel-month"][data-delta="1"]');
    btn.removeAttribute("disabled");
    btn.click();
  });
  await pageF.waitForTimeout(200);
  const labelAfterForce = await pageF.locator(".garden-pixel-month-label").textContent();
  check("disabledを外して強制クリックしても表示月は当月のまま(アプリ側ガードが効く)", labelAfterForce.trim() === `${Y}年${M}月`, labelAfterForce);

  await ctxF.close();

  // ============================================================
  // Part G: 月境界の実式検証(うるう年2月/平年2月/30日の月)
  // ============================================================
  // 実装の内部変数(_gardenPixelMonth等)を直接注入する方式はいったん試したが、app.jsは
  // モジュールではない通常scriptのため、page.evaluate内のトップレベルlet/function宣言は
  // 別スコープになり読み書きできない(ReferenceError)ことを確認した。かわりに
  // page.clock.setFixedTime()でブラウザの「現在時刻」自体を固定する(v153.test.js Part Dで
  // 既に確立済みのテクニック)。_gardenPixelMonthはnullな限り`todayISO().slice(0,7)`で
  // 初期化されるだけなので、時計を固定してから初回描画させれば、実装の内部変数に触れずに
  // 「その月の初期表示」を外部から検証できる(実装式のトートロジーにもならない)。
  console.log("[G] 月境界: 時計をうるう年2月/平年2月/30日の月へ固定し、in-monthセル数が実際の日数と一致することを確認する");
  async function inMonthCountForFrozenDate(y, m, d) {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 1200 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => { failures++; console.log("  ❌ [G/H] pageerror:", e.message); });
    await blockGithubApiByDefault(p);
    await p.clock.setFixedTime(new Date(y, m - 1, d, 12, 0, 0));
    await p.goto(`http://localhost:${PORT}/`);
    await p.waitForTimeout(500);
    await passGithubGate(p);
    await p.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await p.reload();
    await p.waitForTimeout(400);
    const count = await p.locator(".garden-pixel-grid .garden-pixel-cell.in-month").count();
    const label = (await p.locator(".garden-pixel-month-label").textContent()).trim();
    return { ctx, p, count, label };
  }

  const g1 = await inMonthCountForFrozenDate(2028, 2, 15);
  check("うるう年2028年2月の初期表示ラベル", g1.label === "2028年2月", g1.label);
  check("うるう年2028年2月のin-monthセル数=29", g1.count === 29, g1.count);
  await g1.ctx.close();

  const g2 = await inMonthCountForFrozenDate(2026, 2, 15);
  check("平年2026年2月の初期表示ラベル", g2.label === "2026年2月", g2.label);
  check("平年2026年2月のin-monthセル数=28", g2.count === 28, g2.count);
  await g2.ctx.close();

  const g3 = await inMonthCountForFrozenDate(2026, 4, 15);
  check("30日の月(2026年4月)の初期表示ラベル", g3.label === "2026年4月", g3.label);
  check("30日の月(2026年4月)のin-monthセル数=30", g3.count === 30, g3.count);
  await g3.ctx.close();

  // ============================================================
  // Part H: 年跨ぎ(1月表示で◀ → 前年12月)+ 月跨ぎでの当月自動同期
  // ============================================================
  console.log("[H] 年跨ぎ: 1月表示から◀(前月)クリックで前年12月(31日)へ遷移する");
  const h = await inMonthCountForFrozenDate(2027, 1, 10);
  check("時計固定2027年1月10日の初期表示ラベルは2027年1月", h.label === "2027年1月", h.label);
  check("当月(2027年1月)表示では▶がdisabled", await h.p.locator('[data-action="garden-pixel-month"][data-delta="1"]').isDisabled());

  await h.p.click('[data-action="garden-pixel-month"][data-delta="-1"]');
  await h.p.waitForTimeout(200);
  const labelDec = (await h.p.locator(".garden-pixel-month-label").textContent()).trim();
  check("◀クリックで前年12月表示になる(年を跨いで戻る)", labelDec === "2026年12月", labelDec);
  const decCount = await h.p.locator(".garden-pixel-grid .garden-pixel-cell.in-month").count();
  check("前年12月のin-monthセル数=31", decCount === 31, decCount);
  await h.ctx.close();

  console.log("[H2] 月跨ぎ: PWAを閉じずに(reloadせず)月をまたいでも、月送り未操作なら再訪時に当月へ自動同期される(Codex指摘の回帰確認)");
  // reloadは常にJSの状態(_gardenPixelMonth含む)を作り直してしまい、「開きっぱなしのPWAが
  // 月をまたぐ」というバグの再現にならない。reloadせずに時計だけ進め、タブを切り替えて
  // 戻る(=renderRoutine()の再実行、実際のタブ再訪と同じ経路)ことで、_gardenPixelMonthが
  // モジュール変数として前回値を保持したまま次のrenderが走る状況を再現する。
  // v155レビュー対応(サイドバーnav-buttonをクリックするため、モバイル幅(bottom-nav・5項目の
  // overflow対象になりうる)ではなくデスクトップ幅を使う。v153.test.js Part B以降と同じ配慮)。
  const h2ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const h2p = await h2ctx.newPage();
  h2p.on("pageerror", (e) => { failures++; console.log("  ❌ [H2] pageerror:", e.message); });
  await blockGithubApiByDefault(h2p);
  await h2p.clock.setFixedTime(new Date(2026, 6, 31, 23, 0, 0));  // 2026-07-31(月末)23時
  await h2p.goto(`http://localhost:${PORT}/`);
  await h2p.waitForTimeout(500);
  await passGithubGate(h2p);
  await h2p.click('[data-action="nav"][data-view="routine"]');
  await h2p.waitForTimeout(300);
  const labelJul = (await h2p.locator(".garden-pixel-month-label").textContent()).trim();
  check("7月31日時点でルーティンタブを開くと7月が表示される", labelJul === "2026年7月", labelJul);

  await h2p.clock.setFixedTime(new Date(2026, 7, 1, 0, 30, 0));  // reloadせず時計だけ8月1日0:30へ進める
  await h2p.click('[data-action="nav"][data-view="home"]');  // 一旦ホームへ(タブ切替)
  await h2p.waitForTimeout(200);
  await h2p.click('[data-action="nav"][data-view="routine"]');  // ルーティンタブへ再訪(reloadなし)
  await h2p.waitForTimeout(300);
  const labelAug = (await h2p.locator(".garden-pixel-month-label").textContent()).trim();
  check("reloadせず月をまたいだ後の再訪では8月(当月)へ自動で同期される(月送り未操作のため)", labelAug === "2026年8月", labelAug);
  await h2ctx.close();

  await browser.close();
  server.close();

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
