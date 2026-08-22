// topband-core.test.js — src/features/topband.jsのcharacterization test。
// ブラウザ不要の自己完結Nodeテスト(tests/store-core.test.js / tests/journal-core.test.js と
// 同じ形式: CJS requireのテストランナーからESMモジュールをdynamic importする)。
// 実行: node tests/topband-core.test.js
const path = require("path");
const { pathToFileURL } = require("url");

const TOPBAND_PATH = path.join(__dirname, "../src/features/topband.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

(async () => {
  const mod = await import(pathToFileURL(TOPBAND_PATH).href);
  const { configureTopband, renderStandingOrders, renderCountdown, renderTopbandPC, creedRotationLine } = mod;

  // ---- configure用の可変フィクスチャ ----
  let fixedToday = "2026-02-18";
  let fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
  configureTopband({
    escapeHTML,
    todayISO: () => fixedToday,
    getSettings: () => fixedSettings
  });

  // ==== 1. renderStandingOrders(): 三つの信条・モバイル/PCクラス ====
  {
    const html = renderStandingOrders();
    check("sec-creed(モバイル)クラスを持つ", /class="tower-panel-box sec-creed"/.test(html), html);
    check("見出しSTANDING ORDERSを含む", html.includes("<h2>STANDING ORDERS <span>三つの信条</span></h2>"));
    check("信条行が3件(tower-creed-row)", (html.match(/tower-creed-row/g) || []).length === 3);
    check("一/二/三の採番を含む", html.includes(">一<") && html.includes(">二<") && html.includes(">三<"));
    check("1行目の文言を含む", html.includes("決めた一つは、必ずやり切れる"));
    check("1行目の英語ラベルを含む", html.includes("MIT COMPLETION 100%"));
    check("3行目(充電)の文言を含む", html.includes("夜は手放して充電する"));
  }
  {
    const htmlPc = renderStandingOrders("-pc");
    check("sec-creed-pc(PC)クラスを持つ", /class="tower-panel-box sec-creed-pc"/.test(htmlPc), htmlPc);
    check("PC版も信条3件を持つ", (htmlPc.match(/tower-creed-row/g) || []).length === 3);
  }

  // ==== 2. renderCountdown(): 12週サイクル境界値 ====
  {
    fixedToday = "2026-01-01"; // サイクル開始日当日(elapsed=0)
    let html = renderCountdown();
    check("開始日当日はWeek 1/12", html.includes("Week 1/12"), html);
    check("開始日当日は残り84日", html.includes(">84<small>"), html);
    check("開始日当日は進捗0%(sec-life)", /tower-life-cell is-cycle[\s\S]*?width:0%/.test(html), html);
  }
  {
    fixedToday = "2026-01-08"; // ちょうど7日後(elapsed=7) → Week境界の切り替わり
    let html = renderCountdown();
    check("7日後はWeek 2/12(週境界で切り替わる)", html.includes("Week 2/12"), html);
    check("7日後は残り77日", html.includes(">77<small>"), html);
  }
  {
    fixedToday = "2026-02-18"; // elapsed=48日(mockup-today-home-v2.htmlの例と同一シナリオ)
    let html = renderCountdown();
    check("48日経過はWeek 7/12(mockのWeek 7/12例と一致)", html.includes("Week 7/12"), html);
    check("48日経過は残り36日(mockの36日例と一致)", html.includes(">36<small>"), html);
    // mockの静的width:58%は概算値(実装の正しい算式ではround(48/84*100)=57%)。
    // 算式の正しさ(裁定10: computeMetricsのmetric()と同一ロジック)を優先し、58%とは一致させない。
    check("48日経過の進捗は57%(round(48/84*100))", /tower-life-cell is-cycle[\s\S]*?width:57%/.test(html), html);
  }
  {
    fixedToday = "2026-03-26"; // end12ちょうど(elapsed=84、クランプでtotalに張り付く)
    let html = renderCountdown();
    check("サイクル終端日はWeek 12/12にクランプ", html.includes("Week 12/12"), html);
    check("サイクル終端日は残り0日", html.includes(">0<small>"), html);
  }
  {
    fixedToday = "2026-05-01";
    fixedSettings = { twelveWeekStartDate: "", birthDate: "" }; // 未設定 → todayを起点に開始
    let html = renderCountdown();
    check("twelveWeekStartDate未設定はWeek 1/12から開始", html.includes("Week 1/12"), html);
    check("twelveWeekStartDate未設定は残り84日", html.includes(">84<small>"), html);
  }

  // ==== 3. renderCountdown(): 今年カウントダウン ====
  {
    fixedToday = "2026-01-01";
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
    const html = renderCountdown();
    check("元日は今年364日残り(2026年は非うるう年)", html.includes(">364<small>"), html);
    check("元日は今年0%経過", html.includes("0%経過"), html);
  }

  // ==== 4. renderCountdown(): birthDate未設定/設定でセル数が変わる ====
  {
    fixedToday = "2026-02-18";
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
    const html = renderCountdown();
    check("birthDate未設定はセル2枚(12週+今年のみ)", (html.match(/tower-life-cell/g) || []).length === 2, html);
    check("birthDate未設定は45歳/80歳ラベルを含まない", !html.includes("45歳まで") && !html.includes("80歳まで"));
  }
  {
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "2000-01-01" };
    const html = renderCountdown();
    check("birthDate設定はセル4枚", (html.match(/tower-life-cell/g) || []).length === 4, html);
    check("45歳までラベルを含む", html.includes("45歳まで"));
    check("80歳までラベルを含む", html.includes("80歳まで"));
    check("年齢セルのpctは常に—(パーセント非表示)", (html.match(/tower-life-pct">—</g) || []).length === 2, html);
    check("年齢セルの残り日数はカンマ区切り(toLocaleString)", /tower-life-num">[\d,]*,\d{3}<small>/.test(html), html);
  }
  {
    // PC variant: class名とtower-life-row付与を確認
    const htmlPc = renderCountdown("-pc");
    check("sec-life-pcクラスを持つ", /class="tower-panel-box sec-life-pc"/.test(htmlPc), htmlPc);
    check("PC variantはtower-life-rowを持つ(4列グリッド)", /class="tower-life tower-life-row"/.test(htmlPc), htmlPc);
  }
  {
    const htmlMobile = renderCountdown();
    check("モバイルvariantはtower-life-rowを持たない", !/tower-life-row/.test(htmlMobile), htmlMobile);
  }

  // ==== 5. renderTopbandPC(): 横並び合成 ====
  {
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
    const html = renderTopbandPC();
    check("外枠tower-topband-pcを持つ", html.startsWith('<div class="tower-topband-pc">'), html);
    check("STANDING ORDERS(PC)を含む", html.includes('class="tower-panel-box sec-creed-pc"'));
    check("COUNTDOWN(PC)を含む", html.includes('class="tower-panel-box sec-life-pc"'));
  }

  // ==== 6. creedRotationLine(index): ヘッダeyebrow用ローテーション ====
  {
    const l0 = creedRotationLine(0);
    check("index0はSTANDING ORDER 1/3", l0.includes("STANDING ORDER 1/3"), l0);
    check("index0は1行目の文言を含む", l0.includes("決めた一つは、必ずやり切れる"));
    check("index0はローテーション注記を含む", l0.includes("⟳ 3行ローテーション"));

    const l1 = creedRotationLine(1);
    check("index1はSTANDING ORDER 2/3", l1.includes("STANDING ORDER 2/3"), l1);
    check("index1は2行目の文言を含む", l1.includes("進んだ量で測る"));

    const l2 = creedRotationLine(2);
    check("index2はSTANDING ORDER 3/3", l2.includes("STANDING ORDER 3/3"), l2);

    const l3 = creedRotationLine(3);
    check("index3は0へ循環(mod)", l3 === l0, l3);

    const lNeg = creedRotationLine(-1);
    check("index-1は最後(index2)へ循環", lNeg === l2, lNeg);
  }

  console.log(failures === 0 ? "\ntopband-core: 全件成功" : `\ntopband-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();

