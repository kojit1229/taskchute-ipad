// v90 検証: 0秒思考タブのテーマ一覧に「大テーマ/小テーマ」の階層構造を追加。CHANGES_v90.md参照。
//
// K指示(2026-07-14)「WBSのプロジェクトのように大テーマ、小テーマの階層構造にしてください」への対応。
// データ契約: state.zeroThinking.groups = [{ id, title, order, createdAt }]
//             state.zeroThinking.themes[].groupId = uuid | null (null=未分類)
//
// ①グループ作成・テーマ所属表示 ②グループ折りたたみ記憶 ③グループ削除で配下が未分類へ
// ④未分類テーマの従来動作 ⑤AI取り込みが未分類に入る ⑥normalizeState後方互換
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4225;
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

  async function seed({ zeroThinkingThemes = [], zeroThinkingGroups = [], zeroSecThemeLog = [], view = "zero" } = {}) {
    await page.evaluate(({ KEY, zeroThinkingThemes, zeroThinkingGroups, zeroSecThemeLog, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = { themes: zeroThinkingThemes, entries: [], groups: zeroThinkingGroups };
      s.zeroSecThemeLog = zeroSecThemeLog;
      s.feedback = {};
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, zeroThinkingThemes, zeroThinkingGroups, zeroSecThemeLog, view });
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
    // [1] グループ作成・テーマ所属表示
    // ============================================================
    console.log("[1] 「+ 大テーマ」でグループを作成し、テーマをグループへ割り当てると見出し配下に表示される");
    await seed({
      zeroThinkingThemes: [theme("t1", "テーマ1_v90"), theme("t2", "テーマ2_v90"), theme("t3", "テーマ3_v90")]
    });

    check("グループが無い間はグループ見出しが出ない(既存の見た目のまま)", await page.locator(".zt-group").count() === 0);

    page.once("dialog", (d) => d.accept("マイ大テーマ_v90"));
    await page.click('[data-action="zt-group-add"]');
    await page.waitForTimeout(300);
    const s1 = await readState();
    const group1 = (s1.zeroThinking.groups || [])[0];
    check("グループがzeroThinking.groupsへ1件追加される", !!group1 && group1.title === "マイ大テーマ_v90", JSON.stringify(s1.zeroThinking.groups));

    check("グループ作成直後は見出しではなく『未分類』ゾーンに全テーマが入る(所属テーマがまだ無いため)",
      await page.locator(".zt-group-unclassified").count() === 1 && await page.locator(".zt-group:not(.zt-group-unclassified)").count() === 0);

    await page.locator('[data-action="zt-theme-set-group"][data-id="t1"]').selectOption({ label: "マイ大テーマ_v90" });
    await page.waitForTimeout(200);
    await page.locator('[data-action="zt-theme-set-group"][data-id="t2"]').selectOption({ label: "マイ大テーマ_v90" });
    await page.waitForTimeout(200);

    const s1b = await readState();
    const byId = Object.fromEntries(s1b.zeroThinking.themes.map((t) => [t.id, t]));
    check("t1のgroupIdがグループのidになる", byId.t1.groupId === group1.id, byId.t1.groupId);
    check("t2のgroupIdがグループのidになる", byId.t2.groupId === group1.id, byId.t2.groupId);
    check("t3は未分類のまま(groupId:null)", byId.t3.groupId === null);

    check("グループ見出しが表示される", await page.locator(".zt-group-title", { hasText: "マイ大テーマ_v90" }).count() >= 1);
    const groupCountText = await page.locator(".zt-group:not(.zt-group-unclassified) .zt-plabel-count").first().textContent();
    check("グループ見出しの件数表示が2件になる", /2\s*件/.test(groupCountText || ""), groupCountText);
    const unclassifiedCountText = await page.locator(".zt-group-unclassified .zt-plabel-count").first().textContent();
    check("未分類ゾーンの件数表示が1件になる(t3のみ)", /1\s*件/.test(unclassifiedCountText || ""), unclassifiedCountText);

    console.log("[1b] グループ名のリネーム");
    page.once("dialog", (d) => d.accept("改名後グループ_v90"));
    await page.click(`[data-action="zt-group-rename"][data-id="${group1.id}"]`);
    await page.waitForTimeout(300);
    const s1c = await readState();
    check("グループ名が変更される", s1c.zeroThinking.groups[0].title === "改名後グループ_v90", JSON.stringify(s1c.zeroThinking.groups));

    // ============================================================
    // [2] グループ折りたたみ記憶
    // ============================================================
    console.log("[2] グループの折りたたみが、リロードを跨いで記憶される");
    check("初期状態はグループが開いている(配下テーマが見える)",
      await page.locator(".zt-group:not(.zt-group-unclassified) .zt-group-body .zt-theme-item").count() === 2);

    await page.click(`[data-action="zt-group-toggle"][data-id="${group1.id}"]`);
    await page.waitForTimeout(200);
    check("折りたたむと配下テーマのDOMが消える", await page.locator(".zt-group:not(.zt-group-unclassified) .zt-group-body").count() === 0);

    await page.reload();
    await page.waitForTimeout(500);
    check("リロード後も折りたたみ状態が記憶されている", await page.locator(".zt-group:not(.zt-group-unclassified) .zt-group-body").count() === 0);

    await page.click(`[data-action="zt-group-toggle"][data-id="${group1.id}"]`);
    await page.waitForTimeout(200);
    check("再度タップすれば展開できる", await page.locator(".zt-group:not(.zt-group-unclassified) .zt-group-body .zt-theme-item").count() === 2);

    // ============================================================
    // [3] グループ削除で配下が未分類へ(テーマ自体は消えない)
    // ============================================================
    console.log("[3] グループを削除しても配下テーマは消えず、未分類に戻る");
    page.once("dialog", (d) => d.accept());
    await page.click(`[data-action="zt-group-delete"][data-id="${group1.id}"]`);
    await page.waitForTimeout(300);
    const s3 = await readState();
    check("グループがzeroThinking.groupsから消える", (s3.zeroThinking.groups || []).length === 0, JSON.stringify(s3.zeroThinking.groups));
    check("配下テーマ(t1,t2)は消えずに残る", s3.zeroThinking.themes.some((t) => t.id === "t1") && s3.zeroThinking.themes.some((t) => t.id === "t2"));
    const byId3 = Object.fromEntries(s3.zeroThinking.themes.map((t) => [t.id, t]));
    check("配下テーマのgroupIdがnull(未分類)へ戻る", byId3.t1.groupId === null && byId3.t2.groupId === null);
    check("削除後はグループ見出し自体が消え、従来のフラット表示に戻る", await page.locator(".zt-group").count() === 0);

    // ============================================================
    // [4] 未分類テーマの従来動作(既存機能の完全互換)
    // ============================================================
    console.log("[4] グループ機構があっても、既存のお気に入り・削除・0秒思考の実施フローは従来どおり動く");
    await seed({
      zeroThinkingThemes: [theme("fav-t", "お気に入り候補_v90"), theme("write-t", "書く対象テーマ_v90"), theme("del-t", "削除対象テーマ_v90")],
      zeroThinkingGroups: [{ id: "g-existing", title: "既存グループ_v90", order: 0, createdAt: `${TODAY}T00:00` }]
    });
    await page.click('[data-action="zt-fav-toggle"][data-id="fav-t"]');
    await page.waitForTimeout(200);
    const s4a = await readState();
    check("お気に入りトグルは従来どおり動く", s4a.zeroThinking.themes.find((t) => t.id === "fav-t").fav === true);

    await page.click('[data-action="zt-write"][data-id="write-t"]');
    await page.waitForTimeout(200);
    await page.fill("#zt-write-input", "0秒思考の本文_v90");
    await page.click('[data-action="zt-save"]');
    await page.waitForTimeout(300);
    const s4b = await readState();
    check("0秒思考の実施フロー(書く→保存)は従来どおり動き、entriesへ記録される",
      s4b.zeroThinking.entries.some((e) => e.theme === "書く対象テーマ_v90" && e.body === "0秒思考の本文_v90"));
    check("非お気に入りテーマは書いたらテーマ一覧から消える(従来どおり)", !s4b.zeroThinking.themes.some((t) => t.id === "write-t"));

    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="zt-theme-delete"][data-id="del-t"]');
    await page.waitForTimeout(300);
    const s4c = await readState();
    check("テーマのワンタップ削除は従来どおり動く", !s4c.zeroThinking.themes.some((t) => t.id === "del-t"));

    // ============================================================
    // [5] AI自動取り込みテーマは未分類に入る
    // ============================================================
    console.log("[5] AI由来(source:\"ai-feedback\")テーマは、グループが存在しても未分類ゾーンに入る");
    await seed({
      zeroThinkingThemes: [
        theme("ai-t", "AI提案テーマ_v90", { source: "ai-feedback" }),
        theme("grouped-t", "グループ所属テーマ_v90", { groupId: "g-existing" })
      ],
      zeroThinkingGroups: [{ id: "g-existing", title: "既存グループ_v90", order: 0, createdAt: `${TODAY}T00:00` }]
    });
    const aiThemeInUnclassified = await page.locator(".zt-group-unclassified .zt-theme-text", { hasText: "AI提案テーマ_v90" }).count();
    const aiThemeInGroup = await page.locator(".zt-group:not(.zt-group-unclassified) .zt-theme-text", { hasText: "AI提案テーマ_v90" }).count();
    check("AI由来テーマは未分類ゾーンに表示される", aiThemeInUnclassified === 1, `unclassified=${aiThemeInUnclassified}`);
    check("AI由来テーマは既存グループの配下には表示されない", aiThemeInGroup === 0, `inGroup=${aiThemeInGroup}`);
    check("groupId指定済みのテーマはグループ配下に表示される(比較対象の前提確認)",
      await page.locator(".zt-group:not(.zt-group-unclassified) .zt-theme-text", { hasText: "グループ所属テーマ_v90" }).count() === 1);

    // ============================================================
    // [6] normalizeStateの後方互換
    // ============================================================
    console.log("[6a] zeroThinking.groups キー自体が無い旧データでもクラッシュせず[]に補完される");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = {
        themes: [{ id: "legacy-1", text: "旧データテーマ_v90", fav: false, questionId: null, source: null, createdAt: `${TODAY}T00:00` }],
        entries: []
        // groups キー自体が無い(旧端末データを模す)
      };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    const s6a = await readState();
    check("旧データでもpageerrorが出ずに描画される(#bottomNavが存在)", await page.locator("#bottomNav").count() === 1);
    check("groups欠損は空配列[]に補完される(消えない・落ちない)", Array.isArray(s6a.zeroThinking.groups) && s6a.zeroThinking.groups.length === 0, JSON.stringify(s6a.zeroThinking.groups));
    check("既存テーマ(旧データ)にgroupId:nullが補完される", s6a.zeroThinking.themes.find((t) => t.id === "legacy-1").groupId === null);

    console.log("[6b] themes[].groupId が無い旧テーマ + 既にgroupIdを持つテーマが混在していても、既存値を壊さず補完される");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = {
        themes: [
          { id: "legacy-2", text: "groupId無し旧テーマ_v90", fav: false, questionId: null, source: null, createdAt: `${TODAY}T00:00` }, // groupIdキー自体が無い
          { id: "has-group-3", text: "既にgroupId有りテーマ_v90", fav: false, questionId: null, source: null, groupId: "g-real", createdAt: `${TODAY}T00:00` }
        ],
        entries: [],
        groups: [{ id: "g-real", title: "実在グループ_v90", order: 0, createdAt: `${TODAY}T00:00` }]
      };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    const s6b = await readState();
    const byId6b = Object.fromEntries(s6b.zeroThinking.themes.map((t) => [t.id, t]));
    check("groupIdキーが無かった旧テーマにnullが補完される", byId6b["legacy-2"].groupId === null, JSON.stringify(byId6b["legacy-2"]));
    check("既にgroupIdを持つテーマは既存値優先で上書きされない", byId6b["has-group-3"].groupId === "g-real", JSON.stringify(byId6b["has-group-3"]));
    check("既存のgroups配列も保持される(消えない)", (s6b.zeroThinking.groups || []).some((g) => g.id === "g-real"));
    check("旧データ・混在データでもpageerrorが出ずに描画される", await page.locator("#bottomNav").count() === 1);

    console.log(failures === 0 ? "\n✅ v90 ALL PASS" : `\n❌ v90: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
