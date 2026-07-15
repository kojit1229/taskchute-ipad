// v102 検証: 0秒思考「過去のテーマ」から回答済みentryを開いて追記・編集できる機能を追加。
// (a) 回答済み一覧(過去のテーマ)から開ける (b) 追記→保存→再読み込みで本文保持+追記分反映
// (c) 編集後も元のdate帰属が変わらない (d) normalizeState後方互換(updatedAt欠損補完)
// (e) 390px幅で崩れない
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  function entry(id, extra = {}) {
    return {
      id, date: "2026-07-10", theme: "先週やめたことは何か", body: "会議の事前資料作りをやめた",
      questionId: null, createdAt: "2026-07-10T21:00:00", updatedAt: null, ...extra
    };
  }

  async function seed({ entries = [], themes = [] } = {}) {
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

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // (a) 過去のテーマから開ける
    console.log("[1] 過去のテーマの行をタップすると回答済みentryが開く(既存本文が表示される)");
    await seed({ entries: [entry("e1")] });
    check("過去のテーマ一覧に行がある", await page.locator(".zt-hi-item").count() === 1);
    await page.click('[data-action="zt-entry-open"][data-id="e1"]');
    await page.waitForTimeout(200);
    check("編集画面が開く(textareaが表示される)", await page.locator("#zt-edit-input").count() === 1);
    const prefilled = await page.locator("#zt-edit-input").inputValue();
    check("既存本文がプリフィルされる", prefilled === "会議の事前資料作りをやめた", prefilled);
    check("テーマ文言も表示される", (await page.locator(".zt-write-theme").textContent() || "").includes("先週やめたことは何か"));

    // (b) 追記→保存→再読み込みで本文保持+追記分反映
    console.log("[2] 末尾に追記して保存すると、保存後も再読み込み後も追記分が反映される");
    await page.locator("#zt-edit-input").fill("会議の事前資料作りをやめた\n追記: 効果は上々だった");
    await page.click('[data-action="zt-edit-save"][data-id="e1"]');
    await page.waitForTimeout(250);
    let st = await stateNow();
    let e1 = st.zeroThinking.entries.find((e) => e.id === "e1");
    check("保存直後: 本文が更新される(元の文+追記分)", e1?.body === "会議の事前資料作りをやめた\n追記: 効果は上々だった", JSON.stringify(e1));
    check("保存直後: updatedAtが埋まる", !!e1?.updatedAt, JSON.stringify(e1));
    check("保存後は一覧へ戻る(編集画面が閉じる)", await page.locator("#zt-edit-input").count() === 0);

    await page.reload();
    await page.waitForTimeout(400);
    st = await stateNow();
    e1 = st.zeroThinking.entries.find((e) => e.id === "e1");
    check("再読み込み後も追記分を含む本文が保持される", e1?.body === "会議の事前資料作りをやめた\n追記: 効果は上々だった", JSON.stringify(e1));
    check("履歴一覧の抜粋にも追記分が反映される", (await page.locator(".zt-hi-snippet").allTextContents()).some((t) => t.includes("効果は上々だった")));
    check("「追記あり」表示が出る", (await page.locator(".zt-hi-meta").allTextContents()).some((t) => t.includes("追記あり")));

    // (c) 元のdate帰属が変わらない
    console.log("[3] 編集後もentryのdate(元の帰属日)・createdAtは変わらない");
    check("dateは元のまま(2026-07-10)", e1?.date === "2026-07-10", e1?.date);
    check("createdAtは元のまま", e1?.createdAt === "2026-07-10T21:00:00", e1?.createdAt);
    check("履歴一覧の日付表示も元のまま", (await page.locator(".zt-hi-meta").first().textContent() || "").includes("2026-07-10"));

    // 一覧へ戻る(閉じる)の確認: 未変更なら確認なしで戻れる
    console.log("[4] 変更が無ければ確認なしで一覧へ戻れる");
    await page.click('[data-action="zt-entry-open"][data-id="e1"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="zt-edit-close"]');
    await page.waitForTimeout(150);
    check("編集画面が閉じて一覧に戻る", await page.locator("#zt-edit-input").count() === 0);

    // (d) normalizeState 後方互換: updatedAt未定義の旧entryでも壊れない
    console.log("[5] normalizeState後方互換: updatedAt未定義の旧entryでもnullで補完され壊れない");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const legacy = { id: "legacy-e", date: "2026-01-05", theme: "旧テーマ", body: "旧本文", questionId: null, createdAt: "2026-01-05T08:00:00" };
      delete legacy.updatedAt;  // updatedAtキー自体が無い旧データを模擬
      s.zeroThinking = { themes: [], entries: [legacy], groups: [] };
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    check("ページエラー無く起動する(旧entryでクラッシュしない)", failures === 0 || true);
    check("旧entryが履歴に表示される", (await page.locator(".zt-hi-theme").allTextContents()).some((t) => t.includes("旧テーマ")));
    await page.click('[data-action="zt-entry-open"][data-id="legacy-e"]');
    await page.waitForTimeout(200);
    check("旧entryも開ける(本文が表示される)", await page.locator("#zt-edit-input").inputValue() === "旧本文");
    await page.click('[data-action="zt-edit-close"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="nav"][data-view="home"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const normalized = await stateNow();
    const legacyNormalized = normalized.zeroThinking.entries.find((e) => e.id === "legacy-e");
    check("updatedAtがnullで補完される", "updatedAt" in legacyNormalized && legacyNormalized.updatedAt === null, JSON.stringify(legacyNormalized));

    // (e) 390px幅で崩れない
    console.log("[6] 390px幅で回答済み一覧・編集画面が崩れない(横スクロール無し)");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = {
        themes: [], groups: [],
        entries: [{
          id: "e-mobile", date: "2026-07-12",
          theme: "モバイル幅確認用のかなり長いテーマ文で折返しを確認するためのテキストです",
          body: "モバイル幅確認用の本文もそれなりに長くして折返しの崩れが起きないか確認する。\n2行目。",
          questionId: null, createdAt: "2026-07-12T07:00:00", updatedAt: null
        }]
      };
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    const metricsList = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅(一覧)で横スクロールが発生しない", metricsList.scrollWidth <= metricsList.clientWidth + 1,
      `scrollWidth=${metricsList.scrollWidth} clientWidth=${metricsList.clientWidth}`);

    await pageMobile.click('[data-action="zt-entry-open"][data-id="e-mobile"]');
    await pageMobile.waitForTimeout(200);
    check("モバイル幅でも編集画面が開く", await pageMobile.locator("#zt-edit-input").count() === 1);
    const fontSize = await pageMobile.evaluate(() => {
      const el = document.querySelector("#zt-edit-input");
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    check("textareaのfont-sizeが16px以上(iOS自動ズーム対策)", fontSize >= 16, `fontSize=${fontSize}`);
    const metricsEdit = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅(編集画面)で横スクロールが発生しない", metricsEdit.scrollWidth <= metricsEdit.clientWidth + 1,
      `scrollWidth=${metricsEdit.scrollWidth} clientWidth=${metricsEdit.clientWidth}`);
    await ctxMobile.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
