// A3-H1(2026-09-04コードレビュー修正、修正フェーズ単位2)のブラウザcharacterization test。
//
// 対象: app.js normalizeState() の要素側null/非オブジェクト防御(compactArr/compactMap)と
// src/storage/local.js loadState() の退避経路(-corrupt-backup)。
//
// 背景(area-3-date-boundary-import.md A3-H1): 修正前は tasks/blocks/projects/declarations/
// bodyScans/storeVisits/zeroThinking.themes/zeroThinking.entries/journalMeta の9箇所が
// 「コンテナ(配列/オブジェクト自体)は守るが要素は守らない」実装で、要素にnullが混ざると
// `Cannot use 'in' operator ...` 等の例外を投げ、local.jsのcatchが全stateを-corrupt-backupへ
// 退避してseedState(デモデータ)で起動していた。レビュー原文はここで「退避時settings.autoSyncが
// falseに落ちないため、autoSync ON端末ではデモデータがリモートへpushされうる」と指摘していたが、
// 実装フェーズの独立レビュー(単位2)で現行コードを再確認した結果、normalizeState()は
// settings.autoSyncが真偽値でなければ既定falseへ正規化する実装が既にあり、seedState()自体は
// autoSyncを設定しないため、この被害筋書きは**現行コードでは元々成立しない**(local.jsの
// `seeded.settings.autoSync = false` は多重防御であり、単体では挙動を変えないno-op)。
// 本テストは (a) [1] compactArr/compactMapの要素側防御が例外なく機能すること、
// (b) [2] 退避経路でautoSave/autoSyncが共にfalseになる現状の挙動(の回帰)を固定するに留める。
//
// [1] null注入行列: 12コレクション(9件の修正対象+既に保護済みの3件=questions/condition.logs/
//     sleep.logs)へ {null, "str"(文字列), 42(数値), {}(空オブジェクト)} を注入する。
//     JSON経由でのlocalStorage永続化を通す都合上、配列要素のundefinedはJSON.stringifyの時点で
//     nullへ丸められ(null と undefined を区別してlocalStorageへ書き込むことは不可能)、
//     compactArr/compactMap自体も `x && typeof x === "object"` でnull/undefinedを同一に扱う
//     ため、undefinedはnullで代表させる(コード側の一次情報: app.js compactArr/compactMap定義)。
// [2] loadState退避経路: 生のlocalStorage値をJSONとして壊し、catch経由の退避で
//     settings.github.autoSave/settings.autoSyncの両方がfalseになる現状挙動の回帰確認
//     (正常ロード時にautoSyncが勝手にfalseへ倒されないことも合わせて確認)。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await blockGithubApiByDefault(page);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction((key) => {
      try { return !!JSON.parse(localStorage.getItem(key)); } catch { return false; }
    }, STATE_KEY);
    await passGithubGate(page);

    console.log("[normalize-null-1] 12コレクション×{null,文字列,数値,空オブジェクト}の注入行列");
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      const bad = [null, "corrupt-str", 42, {}];
      // 9箇所(修正対象): 各コレクションへ bad の4要素+有効な要素1件を注入
      s.tasks = [...bad, { id: "task-valid", title: "有効タスク" }];
      s.blocks = [...bad, { id: "block-valid", title: "有効Block" }];
      s.projects = [...bad, { id: "project-valid", kind: "goal", title: "有効Project" }];
      s.declarations = [...bad, { id: "decl-valid" }];
      s.bodyScans = [...bad, { id: "scan-valid" }];
      s.storeVisits = [...bad, { id: "visit-valid" }];
      s.zeroThinking = s.zeroThinking || {};
      s.zeroThinking.themes = [...bad, { id: "theme-valid", text: "有効テーマ" }];
      s.zeroThinking.entries = [...bad, { id: "entry-valid", text: "有効エントリ" }];
      s.journalMeta = {
        "2026-09-01": null,
        "2026-09-02": "corrupt-str",
        "2026-09-03": 42,
        "2026-09-04": {},
        "2026-09-05": { ideal: "有効メタ" }
      };
      // 既に保護済みの3件(regression確認。修正前から例外を投げない側)
      s.questions = [...bad, { id: "question-valid", text: "有効な問い" }];
      s.condition = s.condition || {};
      s.condition.logs = {
        "2026-09-01": null,
        "2026-09-02": "corrupt-str",
        "2026-09-03": 42,
        "2026-09-04": { capacity: "有効ログ" }
      };
      s.sleep = s.sleep || {};
      s.sleep.logs = {
        "2026-09-01": null,
        "2026-09-02": "corrupt-str",
        "2026-09-03": 42,
        "2026-09-04": { hours: 7 }
      };
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);

    let pageError = null;
    page.once("pageerror", (err) => { pageError = err; });
    await page.reload();
    // 例外なく起動し、ナビが描画されること(=デモデータへ退避せずロードできたこと)の確認。
    await page.waitForSelector('[data-action="nav"]', { timeout: 10000 });
    await page.waitForFunction((key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key));
        return Array.isArray(s.tasks) && s.tasks.some((t) => t && t.id === "task-valid");
      } catch { return false; }
    }, STATE_KEY, { timeout: 10000 });

    check("normalizeStateがpageerrorを起こさず起動する", pageError === null, String(pageError));

    const normalized = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);

    check("-corrupt-backupへ退避していない(=正常ロード)",
      (await page.evaluate((key) => localStorage.getItem(`${key}-corrupt-backup`), STATE_KEY)) === null);

    check("tasks: null/文字列/数値は除外(id自動採番なし+other Task自動追加を除く)",
      normalized.tasks.some((t) => t.id === "task-valid")
      && !normalized.tasks.some((t) => t === null || typeof t !== "object"),
      JSON.stringify(normalized.tasks.map((t) => t && t.id)));
    check("blocks: null/文字列/数値は除外、空オブジェクトと有効要素は保持",
      normalized.blocks.length === 2 && normalized.blocks.some((b) => b.id === "block-valid"),
      JSON.stringify(normalized.blocks.map((b) => b.id)));
    check("projects: null/文字列/数値は除外(wish/other自動追加分を除く)",
      normalized.projects.some((p) => p.id === "project-valid")
      && !normalized.projects.some((p) => p === null || typeof p !== "object"),
      JSON.stringify(normalized.projects.map((p) => p && p.id)));
    check("declarations: null/文字列/数値は除外、空オブジェクトと有効要素は保持",
      normalized.declarations.length === 2 && normalized.declarations.some((d) => d.id === "decl-valid"),
      JSON.stringify(normalized.declarations.map((d) => d.id)));
    check("bodyScans: null/文字列/数値は除外、空オブジェクトと有効要素は保持",
      normalized.bodyScans.length === 2 && normalized.bodyScans.some((s) => s.id === "scan-valid"),
      JSON.stringify(normalized.bodyScans.map((s) => s.id)));
    check("storeVisits: null/文字列/数値は除外、空オブジェクトと有効要素は保持",
      normalized.storeVisits.length === 2 && normalized.storeVisits.some((v) => v.id === "visit-valid"),
      JSON.stringify(normalized.storeVisits.map((v) => v.id)));
    check("zeroThinking.themes: null/文字列/数値は除外、空オブジェクトと有効要素は保持",
      normalized.zeroThinking.themes.length === 2
      && normalized.zeroThinking.themes.some((t) => t.id === "theme-valid"),
      JSON.stringify(normalized.zeroThinking.themes.map((t) => t.id)));
    check("zeroThinking.entries: null/文字列/数値は除外、空オブジェクトと有効要素は保持",
      normalized.zeroThinking.entries.length === 2
      && normalized.zeroThinking.entries.some((e) => e.id === "entry-valid"),
      JSON.stringify(normalized.zeroThinking.entries.map((e) => e.id)));
    check("journalMeta: null/文字列/数値キーは除外、空オブジェクトと有効要素は保持",
      Object.keys(normalized.journalMeta).length === 2
      && "2026-09-04" in normalized.journalMeta
      && normalized.journalMeta["2026-09-05"].ideal === "有効メタ",
      JSON.stringify(Object.keys(normalized.journalMeta)));

    // regression: 修正前から保護済みだった3コレクションが本修正で壊れていないこと
    check("questions(既存保護)は引き続き例外なく有効要素を保持",
      normalized.questions.some((q) => q && q.id === "question-valid"), JSON.stringify(normalized.questions));
    check("condition.logs(既存保護)は引き続き例外なく有効要素を保持",
      normalized.condition.logs["2026-09-04"].capacity === "有効ログ", JSON.stringify(normalized.condition.logs));
    check("sleep.logs(既存保護)は引き続き例外なく有効要素を保持",
      normalized.sleep.logs["2026-09-04"].hours === 7, JSON.stringify(normalized.sleep.logs));

    console.log("[normalize-null-2] loadStateの退避経路でsettings.autoSave/autoSyncがfalseになる(現状挙動の回帰確認)");
    // 正の対照: 正常なJSONを一旦autoSync=trueで保存→reloadしても退避しないこと(負例)
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.settings.autoSync = true;
      s.settings.github.autoSave = true;
      localStorage.setItem(key, JSON.stringify(s));
    }, STATE_KEY);
    await page.reload();
    await page.waitForFunction((key) => {
      try { return !!JSON.parse(localStorage.getItem(key)); } catch { return false; }
    }, STATE_KEY);
    const okState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    check("正常ロードではautoSyncを勝手にfalseへ倒さない(負例)", okState.settings.autoSync === true);

    // 負の対照からの反転: localStorageの生値をJSONとして壊し、catch経由の退避を強制発火させる
    await page.evaluate((key) => {
      localStorage.setItem(key, "{this is not valid json");
    }, STATE_KEY);
    await page.reload();
    await page.waitForFunction((key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key));
        return !!s && typeof s.settings.autoSync === "boolean";
      } catch { return false; }
    }, STATE_KEY, { timeout: 10000 });
    const recovered = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
    const backup = await page.evaluate((key) => localStorage.getItem(`${key}-corrupt-backup`), STATE_KEY);

    check("壊れたJSONは-corrupt-backupへ退避される", backup === "{this is not valid json");
    check("退避後settings.github.autoSaveはfalse(既存挙動の回帰確認)",
      recovered.settings.github.autoSave === false);
    // 注意: normalizeState()はsettings.autoSyncが真偽値でなければ既定falseへ正規化し、
    // seedState()はautoSyncを設定しないため、local.js側の`seeded.settings.autoSync = false`を
    // 外してもこのチェックは通る(恒真)。ここはseed既定値の回帰確認(多重防御。単体では挙動を
    // 変えない)であり、「autoSync=falseによりpush拡散を防いだ」ことの証明ではない。
    check("退避後settings.autoSyncはfalse(seed既定値の回帰確認。多重防御・単体では挙動を変えない)",
      recovered.settings.autoSync === false);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nnormalize-null-defense: 全件成功" : `\nnormalize-null-defense: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
