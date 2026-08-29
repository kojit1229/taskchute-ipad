// v295 検証: 身体スキャン2軸化(K裁定2026-08-29「モックbodyscan-2axis-mock.html確定+追加裁定2点」)。
// v129/v293の身体スキャンモーダル(疲労のみ・2ステップ)を、疲労(身体)0-5+回復(ココロ)0-5の
// 1シート+Blockコメント欄へ拡張した。
//   1. 両軸ともデフォルト0で最初から「記録」ボタンが活性(0/0=「疲労なし・回復なし」も
//      有効な記録として保存できる)。
//   2. モーダル内にそのBlockの既存コメントを初期表示するtextareaを併設し、保存時に
//      Block.commentへ反映する(空のままなら既存commentは変更しない=空文字で上書きしない)。
// §8-1(a)〜(d)を網羅する。v293(手動完了5導線の接続点)・v129(モーダル本体の起源)は
// 別ファイルで2軸UIへ追随済み(このファイルはモーダル自体の新規挙動に専念する)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, generateReportThroughGate } = require("./helpers");
const path = require("path");
const { pathToFileURL } = require("url");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  // ------------------------------------------------------------
  // 静的確認(ブラウザ不要): src/sync/github.jsのmergeById挙動を実行して検証する。
  // (注)normalizeStateのbodyScans[].recovery補完(0とnullを区別する)は、以前ここで
  // ソース文字列存在確認をしていたが削除した(Test-Reduction手続き不要=同一ファイル内の
  // [7](0/0がreload=normalizeState再実行後も保持される)と[9](recoveryキー無し旧レコードが
  // recovery: nullで補完される)が実際にnormalizeStateを実行して両分岐=0保持/nullへ補完を
  // 検出しており、ソース文字列一致より検出力が高い上位互換の検証として現存するため)。
  // ------------------------------------------------------------
  console.log("[0] mergeByIdの動作確認: recovery 0/4/nullを持つbodyScan要素がマージ後も丸ごと保持される");
  {
    // v294のsync系NodeテストとNode ESM直import方式を踏襲(store.js/state経由の
    // computeSyncMergeより依存が薄い純粋関数のmergeByIdを直接検証する)。
    const mergeMod = await import(pathToFileURL(path.join(__dirname, "..", "src", "core", "merge.js")).href);
    const local = [
      { id: "bs-local", dateTime: "2026-08-29T08:00:00", fatigue: 1, recovery: 0, part: "", pomodoroBlockId: "", updatedAt: "2026-08-29T08:00:00" },
      { id: "bs-both", dateTime: "2026-08-29T07:00:00", fatigue: 2, recovery: null, part: "肩", pomodoroBlockId: "blkX", updatedAt: "2026-08-29T07:00:00" }
    ];
    const remote = [
      { id: "bs-remote", dateTime: "2026-08-29T09:00:00", fatigue: 4, recovery: 4, part: "頭", pomodoroBlockId: "blkY", updatedAt: "2026-08-29T09:00:00" },
      // 同idの側はupdatedAtが新しい方が丸ごと勝つ(部分マージではない)ことも合わせて確認する。
      { id: "bs-both", dateTime: "2026-08-29T07:30:00", fatigue: 5, recovery: 5, part: "腰", pomodoroBlockId: "blkX", updatedAt: "2026-08-29T09:30:00" }
    ];
    const merged = mergeMod.mergeById(local, remote);
    const byId = Object.fromEntries(merged.map((x) => [x.id, x]));
    check("マージ結果は3件の和集合(local限定+remote限定+両側)", merged.length === 3, JSON.stringify(merged.map((x) => x.id)));
    check("local限定要素(recovery=0)が丸ごと保持される",
      byId["bs-local"]?.recovery === 0 && byId["bs-local"]?.fatigue === 1, JSON.stringify(byId["bs-local"]));
    check("remote限定要素(recovery=4)が丸ごと保持される",
      byId["bs-remote"]?.recovery === 4 && byId["bs-remote"]?.fatigue === 4, JSON.stringify(byId["bs-remote"]));
    check("両側に存在するid(recovery=null→5)はupdatedAtが新しいremote側が丸ごと採用される",
      byId["bs-both"]?.recovery === 5 && byId["bs-both"]?.part === "腰", JSON.stringify(byId["bs-both"]));
  }

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // 実行時刻依存のフレーク回避(v117/v129/v293等と同じ方針)
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

  function makeBlock({ id, title, startMin, comment = "" }) {
    return {
      id, taskId: "", date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`, plannedEndAt: `${TODAY}T${hhmm(startMin + 30)}`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment, recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      carryCount: 0, isMIT: false, source: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
      deleted: false
    };
  }

  async function seed(p, { blocks = [], bodyScans = [], view = "timeline" } = {}) {
    await p.evaluate(({ KEY, blocks, bodyScans, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = [];
      s.bodyScans = bodyScans;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.timelineMode = "planned";
      s.pomodoro = { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, bodyScans, TODAY, view });
    await p.reload();
    await p.waitForSelector(`#app[data-view="${view}"]`);
  }
  async function stateNow(p) {
    return p.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }
  async function clickReal(p, selector) {
    await p.locator(selector).first().evaluate((el) => el.click());
  }
  const scanTitle = (p) => p.locator(".modal-title", { hasText: "身体スキャン" });
  async function openScanFor(p, blockId) {
    await clickReal(p, `[data-action="toggle-block"][data-id="${blockId}"]`);
    await scanTitle(p).waitFor();
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction((KEY) => !!localStorage.getItem(KEY), KEY);
    await passGithubGate(page);

    // ============================================================
    // (a) 全経路
    // ============================================================
    console.log("[1] 既定0/0のまま「記録」→有効な記録として保存される(疲労なし・回復なしも記録)");
    await seed(page, { blocks: [makeBlock({ id: "a1", title: "対象1", startMin: 9 * 60 })] });
    await openScanFor(page, "a1");
    check("疲労0〜5の6ボタンが出る", await page.locator('[data-action="body-scan-fatigue"]').count() === 6);
    check("回復0〜5の6ボタンが出る", await page.locator('[data-action="body-scan-recovery"]').count() === 6);
    check("初期状態で疲労0が選択表示になっている",
      await page.locator('[data-action="body-scan-fatigue"][data-value="0"]').evaluate((el) => el.classList.contains("primary")));
    check("初期状態で回復0が選択表示になっている",
      await page.locator('[data-action="body-scan-recovery"][data-value="0"]').evaluate((el) => el.classList.contains("primary")));
    check("初期状態で部位チップは出ない(疲労0<3)", await page.locator('[data-action="body-scan-part"]').count() === 0);
    check("「記録」ボタンにdisabled属性が無い(常時活性)",
      await page.locator('[data-action="body-scan-record"]').evaluate((el) => !el.hasAttribute("disabled")));
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    let s = await stateNow(page);
    check("bodyScansに1件、fatigue=0・recovery=0・part=\"\"で記録される(0/0も有効な記録)",
      s.bodyScans.length === 1 && s.bodyScans[0].fatigue === 0 && s.bodyScans[0].recovery === 0 && s.bodyScans[0].part === "",
      JSON.stringify(s.bodyScans));

    console.log("[2] 疲労3+回復4+部位2件+コメントを記録→bodyScans・Block.commentとも反映される(コメントは選択操作をまたいで保持される)");
    await seed(page, { blocks: [makeBlock({ id: "a2", title: "対象2", startMin: 10 * 60 })] });
    await openScanFor(page, "a2");
    await page.fill("#bodyScanComment", "運動後、頭も少し重い");
    await page.click('[data-action="body-scan-fatigue"][data-value="3"]');  // 再描画をまたぐ
    await page.locator('[data-action="body-scan-part"][data-part="肩"]').waitFor();
    check("疲労選択の再描画をまたいでもコメント入力が消えない",
      await page.locator("#bodyScanComment").inputValue() === "運動後、頭も少し重い");
    await page.click('[data-action="body-scan-part"][data-part="肩"]');
    await page.click('[data-action="body-scan-part"][data-part="頭"]');
    await page.click('[data-action="body-scan-recovery"][data-value="4"]');
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    s = await stateNow(page);
    const scanA2 = s.bodyScans[0];
    check("bodyScansにfatigue=3・recovery=4・部位2件(肩・頭)が記録される",
      scanA2?.fatigue === 3 && scanA2?.recovery === 4 && scanA2?.part === "肩・頭", JSON.stringify(scanA2));
    const blockA2 = s.blocks.find((b) => b.id === "a2");
    check("Block.commentへコメントが反映される", blockA2?.comment === "運動後、頭も少し重い", JSON.stringify(blockA2));

    console.log("[3] 片軸のみ変更(回復だけ2に、疲労は既定0のまま)して記録→両軸とも独立して保存される");
    await seed(page, { blocks: [makeBlock({ id: "a3", title: "対象3", startMin: 11 * 60 })] });
    await openScanFor(page, "a3");
    await page.click('[data-action="body-scan-recovery"][data-value="2"]');
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    s = await stateNow(page);
    check("fatigue=0(未変更)・recovery=2(変更)で記録される",
      s.bodyScans[0]?.fatigue === 0 && s.bodyScans[0]?.recovery === 2, JSON.stringify(s.bodyScans[0]));

    // ============================================================
    // (b) 負例
    // ============================================================
    console.log("[4] 疲労2以下では部位チップが表示されない(3で表示→2以下に戻すと非表示・選択も破棄)");
    await seed(page, { blocks: [makeBlock({ id: "b1", title: "対象B1", startMin: 12 * 60 })] });
    await openScanFor(page, "b1");
    check("疲労0では部位チップ非表示", await page.locator('[data-action="body-scan-part"]').count() === 0);
    await page.click('[data-action="body-scan-fatigue"][data-value="2"]');
    check("疲労2でも部位チップ非表示", await page.locator('[data-action="body-scan-part"]').count() === 0);
    await page.click('[data-action="body-scan-fatigue"][data-value="3"]');
    await page.locator('[data-action="body-scan-part"]').first().waitFor();
    check("疲労3で部位チップが4個表示される", await page.locator('[data-action="body-scan-part"]').count() === 4);
    await page.click('[data-action="body-scan-part"][data-part="肩"]');
    await page.click('[data-action="body-scan-fatigue"][data-value="1"]');
    check("疲労1に戻すと部位チップが再び非表示になる(選択も破棄)", await page.locator('[data-action="body-scan-part"]').count() === 0);
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    s = await stateNow(page);
    check("非表示時に破棄された部位は記録に含まれない(part=\"\")", s.bodyScans[0]?.part === "", JSON.stringify(s.bodyScans[0]));

    console.log("[5] discard 3経路(×/背景タップ/フッター)いずれもbodyScans・Block.commentとも不変(入力中のコメントも破棄される)");
    const discardCases = [
      { id: "b2a", label: "×(modal-close)", act: () => page.click('.modal-close[data-action="body-scan-discard"]') },
      { id: "b2b", label: "背景タップ", act: () => page.locator("#modalRoot").click({ position: { x: 5, y: 5 } }) },
      { id: "b2c", label: "フッター「記録せず閉じる」", act: () => page.click('.modal-footer [data-action="body-scan-discard"]') }
    ];
    for (const c of discardCases) {
      await seed(page, { blocks: [makeBlock({ id: c.id, title: `discard-${c.id}`, startMin: 13 * 60, comment: "元コメント" })] });
      await openScanFor(page, c.id);
      await page.click('[data-action="body-scan-fatigue"][data-value="5"]');
      await page.fill("#bodyScanComment", "破棄されるはずのコメント");
      await c.act();
      await scanTitle(page).waitFor({ state: "detached" });
      s = await stateNow(page);
      const b = s.blocks.find((x) => x.id === c.id);
      check(`${c.label}: bodyScansは追加されない`, s.bodyScans.length === 0, JSON.stringify(s.bodyScans));
      check(`${c.label}: Block.commentは元のまま(不変)`, b?.comment === "元コメント", JSON.stringify(b));
    }

    console.log("[6] コメント欄を空のまま記録→bodyScansは記録されるがBlock.commentは既存値のまま保持される(空文字で上書きしない)");
    await seed(page, { blocks: [makeBlock({ id: "b3", title: "対象B3", startMin: 14 * 60, comment: "既存コメント" })] });
    await openScanFor(page, "b3");
    check("(前提)textareaに既存コメントが初期表示される", await page.locator("#bodyScanComment").inputValue() === "既存コメント");
    await page.fill("#bodyScanComment", "");
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    s = await stateNow(page);
    check("bodyScansには記録される(コメントの有無に関わらず本体は保存される)", s.bodyScans.length === 1);
    check("Block.commentは既存値のまま保持される", s.blocks.find((b) => b.id === "b3")?.comment === "既存コメント",
      JSON.stringify(s.blocks.find((b) => b.id === "b3")));

    // ============================================================
    // (c) 永続化
    // ============================================================
    console.log("[7] fatigue=0/recovery=0がreload(normalizeState再実行)後もnullへ丸められず保持される");
    // (注意)ここまでの[2]〜[6]は毎回seed()でstate.bodyScansを丸ごと置き換えている
    // ([1]で記録したa1分はもう残っていない)ため、この検証専用に新しいBlockで0/0記録し直す。
    await seed(page, { blocks: [makeBlock({ id: "g1", title: "対象G1", startMin: 17 * 60 })] });
    await openScanFor(page, "g1");
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    const zeroScanBefore = (await stateNow(page)).bodyScans.find((x) => x.pomodoroBlockId === "g1");
    check("reload前はfatigue=0/recovery=0", zeroScanBefore?.fatigue === 0 && zeroScanBefore?.recovery === 0, JSON.stringify(zeroScanBefore));
    await page.reload();
    await page.waitForFunction((KEY) => !!localStorage.getItem(KEY), KEY);
    const zeroScanAfter = (await stateNow(page)).bodyScans.find((x) => x.pomodoroBlockId === "g1");
    check("reload後もfatigue=0/recovery=0が保持される(0はnullに丸められない)",
      zeroScanAfter?.fatigue === 0 && zeroScanAfter?.recovery === 0, JSON.stringify(zeroScanAfter));

    console.log("[8] Block.commentへコメントを書き込んだ時、updatedAtが記録前より新しくなる(既存コメント編集導線と同じ性質)");
    await seed(page, { blocks: [makeBlock({ id: "c1", title: "対象C1", startMin: 15 * 60 })] });
    await openScanFor(page, "c1");
    // 基準値は完了操作(toggle-block)・モーダル表示後、コメント記録の直前に取る
    // (完了処理自体のupdatedAt更新と分離し、コメント記録操作だけの差分を検証する。
    // 完了直後に取ると、完了自体のupdatedAt更新を「コメント記録による更新」と誤認する
    // 偽陽性になっていた=2系統レビュー指摘)。
    const beforeUpdatedAt = (await stateNow(page)).blocks.find((b) => b.id === "c1").updatedAt;
    // 固定時刻(page.clock)のままだとnowDateTime()が変化しないため記録直前に時刻を進める
    // (実行時刻依存フレーク回避の方針。v293[10]と同じ)。
    await page.clock.setFixedTime(new Date(now0.getTime() + 5 * 60 * 1000));
    await page.fill("#bodyScanComment", "更新確認用コメント");
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    s = await stateNow(page);
    const blockC1 = s.blocks.find((b) => b.id === "c1");
    check("コメントを書き込んだBlockのupdatedAtが更新される",
      blockC1.updatedAt > beforeUpdatedAt, JSON.stringify({ before: beforeUpdatedAt, after: blockC1.updatedAt }));

    console.log("[8b] コメント欄を編集せず(既存値のまま)記録→Block.updatedAtは完了時のまま変わらない(無変更再保存でupdatedAtを進めない)");
    await seed(page, { blocks: [makeBlock({ id: "c2", title: "対象C2", startMin: 15 * 60 + 30, comment: "既存コメント" })] });
    await openScanFor(page, "c2");
    check("(前提)textareaに既存コメントが初期表示される(c2)",
      await page.locator("#bodyScanComment").inputValue() === "既存コメント");
    const beforeUpdatedAtC2 = (await stateNow(page)).blocks.find((b) => b.id === "c2").updatedAt;
    await page.clock.setFixedTime(new Date(now0.getTime() + 10 * 60 * 1000));
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    s = await stateNow(page);
    const blockC2 = s.blocks.find((b) => b.id === "c2");
    check("コメント欄未編集(trim後が既存Block.commentと同一)ならBlock.updatedAtは変化しない",
      blockC2.updatedAt === beforeUpdatedAtC2, JSON.stringify({ before: beforeUpdatedAtC2, after: blockC2.updatedAt }));
    check("Block.commentも既存値のまま保持される(書き換えられない)",
      blockC2.comment === "既存コメント", JSON.stringify(blockC2));

    console.log("[9] 過去レコード(recovery無し)がnormalizeStateで壊れない(0とnullを区別する)");
    await seed(page, {
      blocks: [],
      bodyScans: [
        { id: "legacy-1", dateTime: `${TODAY}T08:00:00`, fatigue: 4, part: "肩", pomodoroBlockId: "legacy-blk" }  // recoveryキー無し(v295以前の形式)
      ]
    });
    s = await stateNow(page);
    const legacy = s.bodyScans.find((x) => x.id === "legacy-1");
    check("recoveryキーが無い旧レコードはrecovery: nullで補完される(0とは区別)", legacy?.recovery === null, JSON.stringify(legacy));
    check("fatigueは既存値のまま保持される(旧スキーマのフィールドは破壊されない)", legacy?.fatigue === 4, JSON.stringify(legacy));

    // ============================================================
    // (d) 退行
    // ============================================================
    console.log("[10] 日報: 身体スキャンから反映したBlock.commentが既存「## 7. Block 内のコメント」節にそのまま乗る");
    await seed(page, { blocks: [makeBlock({ id: "d1", title: "対象D1", startMin: 16 * 60 })] });
    await openScanFor(page, "d1");
    await page.click('[data-action="body-scan-fatigue"][data-value="3"]');
    await page.click('[data-action="body-scan-recovery"][data-value="2"]');
    await page.fill("#bodyScanComment", "日報連携確認用コメント");
    await page.click('[data-action="body-scan-record"]');
    await scanTitle(page).waitFor({ state: "detached" });
    await clickReal(page, '[data-action="nav"][data-view="journal"]');
    await page.waitForSelector('#app[data-view="journal"]');
    await generateReportThroughGate(page);
    const reportText = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY] || "", { KEY, TODAY });
    check("`### 身体スキャン`表に回復列を含めて出る(疲労3・回復2)", /\| 3 \| 2 \| —/.test(reportText), reportText.slice(0, 800));
    check("既存の「## 7. Block 内のコメント」節にBlock.commentが乗る(新設節ではない)",
      reportText.includes("## 7. Block 内のコメント") && reportText.includes("日報連携確認用コメント"), reportText);

    // ============================================================
    console.log("[11] 390px幅・モーダル内スクロール: 部位チップ+コメント欄併存時も画面幅からはみ出さずスクロールで操作できる");
    await ctx.close();
    // 縦を敢えて低くし(390x520)、疲労スケール+部位チップ+回復スケール+コメント欄をすべて
    // 表示するとmodal-body内でスクロールが必須になる状況を作る。
    const narrowCtx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 520 } });
    const narrowPage = await narrowCtx.newPage();
    narrowPage.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(390px):", e.message); });
    await blockGithubApiByDefault(narrowPage);
    await narrowPage.clock.setFixedTime(now0);
    await narrowPage.goto(`http://localhost:${PORT}/`);
    await narrowPage.waitForFunction((KEY) => !!localStorage.getItem(KEY), KEY);
    await passGithubGate(narrowPage);
    await seed(narrowPage, { blocks: [makeBlock({ id: "e1", title: "対象E1", startMin: 9 * 60 })] });
    await openScanFor(narrowPage, "e1");
    const box = await narrowPage.locator(".modal-card").boundingBox();
    check("390px幅でモーダルが画面幅からはみ出さない", Boolean(box) && box.x >= 0 && box.x + box.width <= 390 + 1, JSON.stringify(box));
    await narrowPage.click('[data-action="body-scan-fatigue"][data-value="3"]');  // 部位チップを表示させ縦を伸ばす
    await narrowPage.locator('[data-action="body-scan-part"]').first().waitFor();
    const overflowY = await narrowPage.locator(".modal-body").evaluate((el) => getComputedStyle(el).overflowY);
    check("modal-bodyがoverflow-y: auto(スクロール可能)", overflowY === "auto" || overflowY === "scroll", overflowY);
    const scrollable = await narrowPage.locator(".modal-body").evaluate((el) => el.scrollHeight > el.clientHeight);
    check("コンテンツが縦に収まらず実際にスクロールが必要な状態になっている(520px高でも検証できる)", scrollable === true);
    // スクロールしないと見えない位置にある「記録」ボタンを、scrollIntoViewIfNeeded経由で押せることを確認する。
    await narrowPage.locator('[data-action="body-scan-record"]').scrollIntoViewIfNeeded();
    await narrowPage.click('[data-action="body-scan-part"][data-part="肩"]');
    await narrowPage.click('[data-action="body-scan-record"]');
    await narrowPage.locator(".modal-title", { hasText: "身体スキャン" }).waitFor({ state: "detached" });
    const narrowState = await stateNow(narrowPage);
    check("スクロール後も「記録」ボタン操作でbodyScansへ記録できる",
      narrowState.bodyScans.length === 1 && narrowState.bodyScans[0].fatigue === 3 && narrowState.bodyScans[0].part === "肩",
      JSON.stringify(narrowState.bodyScans));
    await narrowCtx.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
