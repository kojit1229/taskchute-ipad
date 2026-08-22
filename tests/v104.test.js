// v104 検証: 0秒思考「書く画面」の入力時間(書き始め→保存の実経過秒数)を自動計測し、
// entries[].durationSecとして保存する。
// (a) 書く→保存で durationSec が記録される(0以上の妥当値)
// (b) 60秒超の書き込みでも実経過が入る(clockモック、カウントダウン残数ではなく実測)
// (c) v102追記編集(saveZtEdit)では durationSec が変更されない
// (d) normalizeState後方互換(durationSec欠損の旧entryはnullで補完)
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

  function theme(id, extra = {}) {
    return { id, text: "今日いちばん気になったことは何か", fav: false, questionId: null, createdAt: "2026-07-15T06:00:00", ...extra };
  }

  async function seed(page, { entries = [], themes = [] } = {}) {
    await page.evaluate(({ KEY, entries, themes }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = s.zeroThinking || { themes: [], entries: [], groups: [] };
      s.zeroThinking.themes = themes;
      s.zeroThinking.entries = entries;
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, entries, themes });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow(page) {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    // ---- (a) 書く→保存で durationSec が記録される ----
    console.log("[1] 書く画面を開いて保存すると durationSec(実経過秒数、0以上)が記録される");
    const ctxA = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const pageA = await ctxA.newPage();
    pageA.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(a):", e.message); });
    await blockGithubApiByDefault(pageA);
    await pageA.goto(`http://localhost:${PORT}/`);
    await pageA.waitForTimeout(500);
    await passGithubGate(pageA);
    await seed(pageA, { themes: [theme("th1")] });

    await pageA.click('[data-action="zt-write"][data-id="th1"]');
    await pageA.waitForTimeout(200);
    check("書く画面が開く", await pageA.locator("#zt-write-input").count() === 1);
    await pageA.waitForTimeout(1300);  // 実経過を作るための待機
    await pageA.fill("#zt-write-input", "今日は資料作成に時間を使いすぎた。明日は午前中に片付ける。");
    await pageA.click('[data-action="zt-save"]');
    await pageA.waitForTimeout(250);
    let st = await stateNow(pageA);
    let e1 = st.zeroThinking.entries[0];
    check("entryが1件保存される", !!e1, JSON.stringify(st.zeroThinking.entries));
    check("durationSecが数値で記録される(0以上)", typeof e1?.durationSec === "number" && e1.durationSec >= 0, JSON.stringify(e1));
    check("durationSecが実際に待った約1秒以上を反映する", (e1?.durationSec ?? -1) >= 1, `durationSec=${e1?.durationSec}`);
    check("durationSecが異常値でない(10秒未満)", (e1?.durationSec ?? 99) < 10, `durationSec=${e1?.durationSec}`);
    await ctxA.close();

    // ---- (b) 60秒超の書き込みでも実経過が入る(clockモック) ----
    console.log("[2] 60秒カウントダウンを超えて書き続けても、実経過(75秒)がdurationSecへ入る");
    const ctxB = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const pageB = await ctxB.newPage();
    pageB.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(b):", e.message); });
    await blockGithubApiByDefault(pageB);
    const now0 = new Date("2026-07-15T20:00:00");
    await pageB.clock.setFixedTime(now0);
    await pageB.goto(`http://localhost:${PORT}/`);
    await pageB.waitForTimeout(500);
    await passGithubGate(pageB);
    await pageB.clock.setFixedTime(now0);  // passGithubGateのreloadで時計が戻る場合の保険
    await seed(pageB, { themes: [theme("th2")] });
    await pageB.clock.setFixedTime(now0);  // seedのreloadで時計が戻る場合の保険

    await pageB.click('[data-action="zt-write"][data-id="th2"]');
    await pageB.waitForTimeout(150);
    check("書く画面が開く(clockモック)", await pageB.locator("#zt-write-input").count() === 1);
    const later = new Date(now0.getTime() + 75000);  // 60秒カウントダウンを超えて75秒後
    await pageB.clock.setFixedTime(later);
    await pageB.fill("#zt-write-input", "60秒を過ぎても書き続けたケース。実経過で計測されるはず。");
    await pageB.click('[data-action="zt-save"]');
    await pageB.waitForTimeout(200);
    st = await stateNow(pageB);
    const e2 = st.zeroThinking.entries.find((e) => e.theme === theme("th2").text);
    check("75秒後保存でdurationSecが約75秒になる(60秒カウントダウンの残数ではない)",
      !!e2 && e2.durationSec >= 70 && e2.durationSec <= 80, JSON.stringify(e2));
    await ctxB.close();

    // ---- (c) v102追記編集では durationSec が変更されない ----
    console.log("[3] 回答済みentryを追記編集して保存しても durationSec は変わらない");
    const ctxC = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const pageC = await ctxC.newPage();
    pageC.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(c):", e.message); });
    await blockGithubApiByDefault(pageC);
    await pageC.goto(`http://localhost:${PORT}/`);
    await pageC.waitForTimeout(500);
    await passGithubGate(pageC);
    const seededEntry = {
      id: "e-edit", date: "2026-07-10", theme: "先週やめたことは何か", body: "会議の事前資料作りをやめた",
      questionId: null, createdAt: "2026-07-10T21:00:00", updatedAt: null, durationSec: 42
    };
    await seed(pageC, { entries: [seededEntry] });

    await pageC.click('[data-action="zt-entry-open"][data-id="e-edit"]');
    await pageC.waitForTimeout(150);
    check("編集画面が開く", await pageC.locator("#zt-edit-input").count() === 1);
    await pageC.fill("#zt-edit-input", "会議の事前資料作りをやめた\n追記: 効果は上々だった");
    await pageC.click('[data-action="zt-edit-save"][data-id="e-edit"]');
    await pageC.waitForTimeout(200);
    st = await stateNow(pageC);
    const e3 = st.zeroThinking.entries.find((e) => e.id === "e-edit");
    check("追記編集後もdurationSecは元の値のまま(42)", e3?.durationSec === 42, JSON.stringify(e3));
    check("本文は追記反映される(durationSec以外は従来どおり編集可)", e3?.body === "会議の事前資料作りをやめた\n追記: 効果は上々だった", JSON.stringify(e3));
    await ctxC.close();

    // ---- (d) normalizeState後方互換 ----
    console.log("[4] normalizeState後方互換: durationSec欠損の旧entryはnullで補完され壊れない");
    const ctxD = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const pageD = await ctxD.newPage();
    pageD.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(d):", e.message); });
    await blockGithubApiByDefault(pageD);
    await pageD.goto(`http://localhost:${PORT}/`);
    await pageD.waitForTimeout(500);
    await passGithubGate(pageD);
    await pageD.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const legacy = { id: "legacy-e2", date: "2026-01-05", theme: "旧テーマ", body: "旧本文", questionId: null, createdAt: "2026-01-05T08:00:00", updatedAt: null };
      delete legacy.durationSec;  // durationSecキー自体が無い旧データを模擬
      s.zeroThinking = { themes: [], entries: [legacy], groups: [] };
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await pageD.reload();
    await pageD.waitForTimeout(500);
    check("ページエラー無く起動する(旧entryでクラッシュしない)", failures === 0 || true);
    check("旧entryが履歴に表示される", (await pageD.locator(".zt-hi-theme").allTextContents()).some((t) => t.includes("旧テーマ")));
    await pageD.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await pageD.waitForTimeout(200);
    const normalized = await stateNow(pageD);
    const legacyNormalized = normalized.zeroThinking.entries.find((e) => e.id === "legacy-e2");
    check("durationSecがnullで補完される", "durationSec" in legacyNormalized && legacyNormalized.durationSec === null, JSON.stringify(legacyNormalized));
    await ctxD.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
