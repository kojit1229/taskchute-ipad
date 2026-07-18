// v119 検証: 0秒思考テーマへの重要度「高」ラベル導入。CHANGES_v119.md参照。
// K指示(2026-07-18)。データ契約: state.zeroThinking.themes[].importance = "" | "高"
//
// ①normalizeStateマイグレーション(欠損→""補完・既存値優先) ②高バッジ表示
// ③グループ内で高が先頭(安定ソート、既存相対順序は保持) ④重要度トグル(""⇔"高")
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  async function seed({ zeroThinkingThemes = [], zeroThinkingGroups = [], view = "zero" } = {}) {
    await page.evaluate(({ KEY, zeroThinkingThemes, zeroThinkingGroups, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = { themes: zeroThinkingThemes, entries: [], groups: zeroThinkingGroups };
      s.feedback = {};
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, zeroThinkingThemes, zeroThinkingGroups, view });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function readState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function theme(id, text, extra = {}) {
    return { id, text, fav: false, questionId: null, source: null, groupId: null, createdAt: `${TODAY}T00:00`, ...extra };
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] normalizeStateマイグレーション
    // ============================================================
    console.log("[1] importanceキーが無い旧テーマは\"\"に補完され、既存値ありは上書きされない");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = {
        themes: [
          { id: "legacy-1", text: "importanceキー無し旧テーマ_v119", fav: false, questionId: null, source: null, groupId: null, createdAt: `${TODAY}T00:00` },
          { id: "has-imp-2", text: "既にimportance有りテーマ_v119", fav: false, questionId: null, source: null, groupId: null, importance: "高", createdAt: `${TODAY}T00:00` }
        ],
        entries: [],
        groups: []
      };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    const s1 = await readState();
    const byId1 = Object.fromEntries(s1.zeroThinking.themes.map((t) => [t.id, t]));
    check("importanceキーが無かった旧テーマに\"\"が補完される", byId1["legacy-1"].importance === "", JSON.stringify(byId1["legacy-1"]));
    check("既にimportance:\"高\"を持つテーマは既存値優先で上書きされない", byId1["has-imp-2"].importance === "高", JSON.stringify(byId1["has-imp-2"]));
    check("旧データでもpageerrorが出ずに描画される", await page.locator("#bottomNav").count() === 1);

    // ============================================================
    // [2] 高バッジ表示
    // ============================================================
    console.log("[2] importance:\"高\"のテーマにだけ「高」バッジが表示される");
    await seed({
      zeroThinkingThemes: [
        theme("imp-t", "重要テーマ_v119", { importance: "高" }),
        theme("normal-t", "通常テーマ_v119", { importance: "" })
      ]
    });
    const impBadgeCount = await page.locator('.zt-theme-item:has-text("重要テーマ_v119") .zt-theme-important').count();
    check("重要度「高」テーマにバッジが表示される", impBadgeCount === 1, `count=${impBadgeCount}`);
    const badgeText = await page.locator('.zt-theme-item:has-text("重要テーマ_v119") .zt-theme-important').first().textContent().catch(() => "");
    check("バッジのテキストが「高」", (badgeText || "").trim() === "高", badgeText);
    const normalBadgeCount = await page.locator('.zt-theme-item:has-text("通常テーマ_v119") .zt-theme-important').count();
    check("通常テーマにはバッジが出ない", normalBadgeCount === 0, `count=${normalBadgeCount}`);

    // ============================================================
    // [3] 高が先頭ソート(安定ソート、既存相対順序は保持)
    // ============================================================
    console.log("[3] 同一ゾーン内で重要度「高」のテーマが先頭に来る(それ以外は元の相対順序を保つ)");
    await seed({
      zeroThinkingThemes: [
        theme("a1", "順序A1_v119", { importance: "" }),
        theme("a2", "順序A2_v119", { importance: "高" }),
        theme("a3", "順序A3_v119", { importance: "" }),
        theme("a4", "順序A4_v119", { importance: "高" })
      ]
    });
    const order3 = await page.locator(".zt-theme-item .zt-theme-text").allTextContents();
    const idx = (label) => order3.findIndex((t) => t.includes(label));
    check("高(A2)が非高(A1)より前に来る", idx("順序A2_v119") < idx("順序A1_v119"), JSON.stringify(order3));
    check("高(A4)が非高(A3)より前に来る", idx("順序A4_v119") < idx("順序A3_v119"), JSON.stringify(order3));
    check("高同士(A2→A4)は元の相対順序を保つ", idx("順序A2_v119") < idx("順序A4_v119"), JSON.stringify(order3));
    check("非高同士(A1→A3)は元の相対順序を保つ", idx("順序A1_v119") < idx("順序A3_v119"), JSON.stringify(order3));

    console.log("[3b] グループ配下でも同様に高が先頭へ来る");
    await seed({
      zeroThinkingThemes: [
        theme("g1", "グループ内A_v119", { importance: "", groupId: "grp-1" }),
        theme("g2", "グループ内B_v119", { importance: "高", groupId: "grp-1" })
      ],
      zeroThinkingGroups: [{ id: "grp-1", title: "テストグループ_v119", order: 0, createdAt: `${TODAY}T00:00` }]
    });
    const order3b = await page.locator(".zt-group:not(.zt-group-unclassified) .zt-theme-text").allTextContents();
    const idxB = (label) => order3b.findIndex((t) => t.includes(label));
    check("グループ配下でも高(B)が非高(A)より前に来る", idxB("グループ内B_v119") < idxB("グループ内A_v119"), JSON.stringify(order3b));

    // ============================================================
    // [4] 重要度トグル
    // ============================================================
    console.log("[4] トグルボタンで重要度が\"\"⇔\"高\"を切り替える");
    await seed({
      zeroThinkingThemes: [theme("toggle-t", "トグル対象テーマ_v119", { importance: "" })]
    });
    check("初期状態はバッジ無し", await page.locator('.zt-theme-item:has-text("トグル対象テーマ_v119") .zt-theme-important').count() === 0);
    await page.click('[data-action="zt-importance-toggle"][data-id="toggle-t"]');
    await page.waitForTimeout(200);
    const s4a = await readState();
    check("1回目クリックでimportanceが\"高\"になる", s4a.zeroThinking.themes.find((t) => t.id === "toggle-t").importance === "高");
    check("バッジが表示される", await page.locator('.zt-theme-item:has-text("トグル対象テーマ_v119") .zt-theme-important').count() === 1);

    await page.click('[data-action="zt-importance-toggle"][data-id="toggle-t"]');
    await page.waitForTimeout(200);
    const s4b = await readState();
    check("2回目クリックでimportanceが\"\"に戻る", s4b.zeroThinking.themes.find((t) => t.id === "toggle-t").importance === "");
    check("バッジが消える", await page.locator('.zt-theme-item:has-text("トグル対象テーマ_v119") .zt-theme-important').count() === 0);

    console.log(failures === 0 ? "\n✅ v119 ALL PASS" : `\n❌ v119: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
