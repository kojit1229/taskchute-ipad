// tests/timeline-tick-wiring.test.js — v175(タイムライン段階B抽出)の独立レビューMust対応
// (2026-07-29、Claude系統レビュー Must-1/Must-2)。prep-stage4-timeline.md §6-2/§6-3の
// 完了条件を実ブラウザE2Eで機械検証する。timeline-render-core.test.js(Node dynamic import)
// では発火できないため(document/setInterval/compositionイベントが必要)、新規e2eスイートとして
// 追加した。
//
// [1](§6-2) updateBatteryTick(app.js残留)→renderEnergyGraph(v175でsrc/features/timeline.js
//     へ移動)への配線が、移動後も実際に生きていることを検証する。時刻をpage.clock.setFixedTime
//     で固定し、500ms周期のstartTimerTickerに実時間で1回以上ティックさせる手法はv144.test.js
//     [10]と同じ(Date.now()の差分で60秒スロットルを判定するため、実待機は800ms程度で足りる)。
//     `.energy-graph-overlay`へテスト用marker属性を付け、ティック後に(a)marker属性が消えている
//     こと(=outerHTMLで実際に新しいDOM要素へ差し替わった証拠。innerTextの部分書換え等ではないこと
//     の確認)と、(b)表示中の残量ラベルが減衰後の値へ実際に変わっていること(=移動後の
//     renderEnergyGraphが新しい引数で正しく再計算されていること)の両方を確認する。
//
// [2](§6-3) prep-stage4-timeline.md §2の結論(「updateBatteryTickのタイムライン差分パッチは
//     `.energy-graph-overlay`という、フォーカス可能/編集可能な子要素を持たない要素だけを
//     outerHTMLで差し替えるため、_imeComposing自体はここでは判定していないが実害が無いのが
//     前提」)を実機で裏取りする。Block編集モーダル(タイムラインのカードをタップして開く、
//     `#modalRoot`は`#main`と別のDOM部分木)のタイトル入力欄で日本語IME変換中
//     (compositionstart〜未確定)に、[1]と同じ手法でupdateBatteryTickの`.energy-graph-overlay`
//     パッチを強制発火させ、モーダル側の入力中テキスト・フォーカス・IME状態が一切壊れないこと
//     (marker属性・入力値がティックの前後で保持されること)を確認する。
//
//     補足(既存コードの事実確認、v175での新規変更ではない): hydrateStaticMarkdownの
//     renderDeferringForFocus()呼び出しはstate.currentViewが vision/journal/weekly/home/zero/
//     tasks/stats/dashboard の場合のみ発火し、"timeline"はこの一覧に含まれない(app.js
//     L13961)。そのためv137.test.jsと同じ「フォアグラウンド復帰で全体再描画が延期される」
//     契約をタイムライン画面で再現する経路は現状存在しない(v175で変えていない、既存の
//     view許可リストの仕様)。renderDeferringForFocus経由でstate.currentView非依存に発火する
//     唯一の経路(起動時の回復Block下書き提案、app.js L16195/L16199)は起動シーケンス専用で
//     再現条件が複雑なため、本ファイルでは採用せず、実際に存在するタイムライン⇔IMEの
//     交差点(updateBatteryTickの直接パッチ経路)を対象にした。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);

  // localStorageのblocks/settingsを丸ごと差し替えてreloadする(v144.test.jsのseed()と同じ流儀)。
  async function seed({ blocks = [] } = {}) {
    await page.evaluate(({ KEY, TODAY, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.selectedDate = TODAY;
      s.currentView = "timeline";
      s.timelineMode = "planned";
      s.settings = s.settings || {};
      s.settings.timelineEnergyGraphMode = "battery";  // バッテリー残量ラベル("残量N")を表示させる
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, blocks });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function batteryLabelText() {
    const loc = page.locator(".battery-curve-label");
    if ((await loc.count()) === 0) return null;
    return (await loc.textContent()).trim();
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1](§6-2) updateBatteryTick → renderEnergyGraph(移動後)の配線が実際に生きている
    // ============================================================
    console.log("[1] updateBatteryTick→renderEnergyGraph(v175移動後)の配線: .energy-graph-overlayが実際に更新される");
    await page.clock.setFixedTime(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), 10, 0, 0, 0));  // 07:00起点+3h減衰=50-9=41
    await seed({ blocks: [] });
    check("タイムライン画面が表示されている(前提)", (await page.locator(".energy-graph-overlay").count()) === 1);

    await page.waitForTimeout(700);  // 500ms周期のティッカーを最低1回は通す(_lastBatteryTickAtの基準を作る)
    const label0 = await batteryLabelText();
    check("初回ティック後: 残量41(50-9、defaultBatterySettings decayPerHour=3の3時間分)",
      label0?.includes("残量 41"), label0);

    await page.evaluate(() => {
      document.querySelector(".energy-graph-overlay")?.setAttribute("data-wiring-marker", "before-tick-v175");
    });
    const markerPresentBefore = await page.evaluate(() =>
      document.querySelector(".energy-graph-overlay")?.getAttribute("data-wiring-marker") === "before-tick-v175");
    check("(準備)markerが付与されている", markerPresentBefore);

    await page.clock.setFixedTime(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), 11, 0, 0, 0));  // 60分進める(reload・クリックなし)
    await page.waitForTimeout(800);  // 500ms周期のティッカーが新しい固定時刻を検知するのを待つ

    const markerGoneAfterTick = await page.evaluate(() =>
      document.querySelector(".energy-graph-overlay")?.getAttribute("data-wiring-marker") !== "before-tick-v175");
    check("ティック後: markerが消えている(outerHTMLで実際に新しいDOM要素へ差し替わった証拠。移動後のrenderEnergyGraphが呼ばれていないと旧DOM要素が残ってmarkerが残留するはず)",
      markerGoneAfterTick);
    const label1 = await batteryLabelText();
    check("ティック後: 残量38(50-12)へ実際に更新される(reload・クリック無し)", label1?.includes("残量 38"), label1);
    check("battery-curveのpolylineが引き続き描画される", (await page.locator(".battery-curve").count()) === 1);

    // ============================================================
    // [2](§6-3) Block編集モーダルで日本語IME変換中に、[1]と同じティックを強制発火させても
    //     入力中テキスト・フォーカス・IME状態が壊れない(モーダルは#main外の別部分木のため)
    // ============================================================
    console.log("[2] Block編集モーダルIME変換中にupdateBatteryTickのタイムラインパッチを強制発火させても、入力状態が壊れない");
    await seed({
      blocks: [{
        id: "b-ime", date: TODAY, title: "IME確認用Block", category: "",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
        actualStartAt: "", actualEndAt: "",
        completed: false, charge: 0, discharge: 0, estimateMin: 0, deleted: false
      }]
    });
    await page.clock.setFixedTime(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), 10, 0, 0, 0));
    await page.waitForTimeout(700);  // ティッカーのベースラインを作る(_lastBatteryTickAt)

    await page.click('.timeline-card[data-id="b-ime"]');
    await page.waitForTimeout(300);
    const titleInput = page.locator('[data-modal-field="title"]');
    check("Block編集モーダルのタイトル欄が開く", (await titleInput.count()) === 1);
    await titleInput.click();
    await titleInput.pressSequentially("編集中_v175");
    await page.evaluate(() => {
      document.activeElement.setAttribute("data-test-marker", "ime-composing-v175");
      document.activeElement.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    });
    const selectionBefore = await page.evaluate(() => ({
      value: document.activeElement.value,
      marker: document.activeElement.getAttribute("data-test-marker")
    }));
    check("IME変換開始直後: 入力中テキストとmarkerがある(前提)",
      selectionBefore.value.includes("編集中_v175") && selectionBefore.marker === "ime-composing-v175", JSON.stringify(selectionBefore));

    // [1]と同じ手法でupdateBatteryTickのタイムラインパッチを強制発火させる(モーダル表示中でも
    // state.currentViewは"timeline"のまま。state.modalは別プロパティのため干渉しない)。
    await page.clock.setFixedTime(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), 11, 0, 0, 0));
    await page.waitForTimeout(800);

    const overlayPatched = await page.evaluate(() => {
      const overlay = document.querySelector(".energy-graph-overlay");
      return overlay ? overlay.textContent.includes("38") : false;
    });
    check("IME変換中でも.energy-graph-overlay自体は正しくパッチされる(残量38へ更新、IME経由でブロックされない設計どおり)",
      overlayPatched);

    const afterTick = await page.evaluate(() => ({
      value: document.activeElement ? document.activeElement.value : null,
      marker: document.activeElement ? document.activeElement.getAttribute("data-test-marker") : null,
      isTitleInput: document.activeElement ? document.activeElement.getAttribute("data-modal-field") === "title" : false
    }));
    check("ティック後もタイトル入力欄がフォーカスされたまま(モーダルは#main外の別部分木のため無傷)",
      afterTick.isTitleInput, JSON.stringify(afterTick));
    check("ティック後も入力中テキストが保持される(消えていない)", afterTick.value?.includes("編集中_v175"), JSON.stringify(afterTick));
    check("ティック後もIME変換中を示すmarkerが保持される(モーダルが再構築されていない証拠)",
      afterTick.marker === "ime-composing-v175", JSON.stringify(afterTick));

    await page.evaluate(() => document.activeElement.dispatchEvent(new Event("compositionend", { bubbles: true })));
    await page.waitForTimeout(200);
    const afterCompositionEnd = await page.evaluate(() => ({
      value: document.activeElement ? document.activeElement.value : null,
      isTitleInput: document.activeElement ? document.activeElement.getAttribute("data-modal-field") === "title" : false
    }));
    check("compositionend後も入力欄・入力値は正常なまま(モーダルは無関係のまま維持)",
      afterCompositionEnd.isTitleInput && afterCompositionEnd.value?.includes("編集中_v175"), JSON.stringify(afterCompositionEnd));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
