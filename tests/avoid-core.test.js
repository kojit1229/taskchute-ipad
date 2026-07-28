// avoid-core.test.js — 段階2抽出(Avoid Listの読み取り専用render)のcharacterization test。
// 監督者裁定(prep-stage2-avoid.mdの案からの変更点): 移すのはrenderAvoidのみ。
// addAvoid/deleteAvoid/updateAvoidTextは操作系(state書き込み+保存ヘルパー依存)のため
// dispatcher整理の段階までapp.jsに残す。
//
// 抽出前はv163.test.jsのsourceBetween+vmパターンでapp.js:6805-6844のrenderAvoid本体を
// 切り出し(escapeHTML/renderHeader/stateをvmコンテキストのグローバルとして注入)、
// 下記と同じ6挙動で赤→緑を確認済み。抽出後の現在はsrc/features/avoid.jsをdynamic import
// し、renderAvoid(state, escapeHTML, renderHeader) の明示引数呼び出しで同じ挙動を固定する。
//
// 固定する6挙動(抽出前のapp.js:6805-6844の実装から導出。「こうあるべき」ではなく実挙動を固定する):
// 1. 空リスト時: 空状態文言が出て、ヒントセクションは出ない
// 2. 複数件: 各itemのテキストがinput valueに入り、配列順が維持される
// 3. HTMLエスケープ: text中の<,>,&,",'がエスケープされる(app.js:6830、XSS対策)
// 4. createdAtの先頭10文字だけが日付欄に表示される(app.js:6831)
// 5. createdAtが無い項目は日付欄が空文字になる(app.js:6831の三項演算子)
// 6. items.length>0のときだけヒントセクションが表示される(app.js:6837の条件分岐)
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const MODULE_PATH = path.join(ROOT, "src", "features", "avoid.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// app.js:18153のescapeHTMLと同一ロジック(avoid.jsは引数で受け取るだけで実体を持たないため、
// テスト側で本物と同じ実装を再現して渡す)。
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// app.js:2603のrenderHeaderのスタブ(renderAvoidは戻り値をそのまま埋め込むだけで中身は関知しない)。
function renderHeader(eyebrow, title) {
  return `<div class="stub-header">${eyebrow}/${title}</div>`;
}

function makeState(avoidList) {
  return { settings: { avoidList }, currentView: "avoid" };
}

async function loadRenderAvoid() {
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  return mod.renderAvoid;
}

(async () => {
  const renderAvoid = await loadRenderAvoid();

  console.log("[1] 空リスト時: 空状態文言が出て、ヒントセクションは出ない");
  {
    const html = renderAvoid(makeState([]), escapeHTML, renderHeader);
    check("空状態文言が含まれる", html.includes("まだ何も書かれていません"));
    check("ヒントセクションが含まれない", !html.includes("💡 ヒント"));
  }

  console.log("[2] 複数件: 各itemのテキストがinput valueに入り、配列順が維持される");
  {
    const items = [
      { id: "a1", text: "深夜アイテムA", createdAt: "2026-07-01T09:00:00" },
      { id: "a2", text: "深夜アイテムB", createdAt: "2026-07-02T09:00:00" }
    ];
    const html = renderAvoid(makeState(items), escapeHTML, renderHeader);
    const idxA = html.indexOf("深夜アイテムA");
    const idxB = html.indexOf("深夜アイテムB");
    check("両方の項目が出力される", idxA >= 0 && idxB >= 0, html);
    check("配列順(a1が先)が維持される", idxA < idxB, `idxA=${idxA} idxB=${idxB}`);
    check("value属性に項目textが入る", html.includes('value="深夜アイテムA"'));
  }

  console.log("[3] HTMLエスケープ: text中の<,>,&,\",'がエスケープされる(XSS対策)");
  {
    const items = [{ id: "x1", text: `<script>&"'</script>`, createdAt: "2026-07-01T09:00:00" }];
    const html = renderAvoid(makeState(items), escapeHTML, renderHeader);
    check("生の<script>タグが出力に含まれない", !html.includes(`<script>&"'</script>`));
    check(
      "エスケープ後の文字列が含まれる",
      html.includes("&lt;script&gt;&amp;&quot;&#039;&lt;/script&gt;")
    );
  }

  console.log("[4] createdAtの先頭10文字だけが日付欄に表示される");
  {
    const items = [{ id: "d1", text: "テスト", createdAt: "2026-07-15T23:45:00" }];
    const html = renderAvoid(makeState(items), escapeHTML, renderHeader);
    check("先頭10文字(2026-07-15)のみ表示", html.includes(">2026-07-15<"), html);
    check("時刻部分は表示されない", !html.includes("23:45"));
  }

  console.log("[5] createdAtが無い項目は日付欄が空文字になる");
  {
    const items = [{ id: "e1", text: "テスト2" }];
    const html = renderAvoid(makeState(items), escapeHTML, renderHeader);
    check(
      "空のspanタグが出力される(日付なし)",
      html.includes('class="muted" style="font-size:11px; white-space:nowrap"></span>'),
      html
    );
  }

  console.log("[6] items.length>0のときだけヒントセクションが表示される");
  {
    const items = [{ id: "f1", text: "テスト3", createdAt: "2026-07-01T09:00:00" }];
    const html = renderAvoid(makeState(items), escapeHTML, renderHeader);
    check("項目が1件以上あればヒントセクションが表示される", html.includes("💡 ヒント"));
  }

  console.log(failures === 0 ? "\navoid-core: 全件成功" : `\navoid-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
