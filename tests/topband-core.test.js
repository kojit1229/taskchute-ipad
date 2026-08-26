// topband-core.test.js — src/features/topband.jsのcharacterization test。
// ブラウザ不要の自己完結Nodeテスト(tests/store-core.test.js / tests/journal-core.test.js と
// 同じ形式: CJS requireのテストランナーからESMモジュールをdynamic importする)。
// 実行: node tests/topband-core.test.js
const path = require("path");
const fs = require("fs");
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
  const { configureTopband, renderStandingOrders, renderLifeBand } = mod;
  const topbandSource = fs.readFileSync(TOPBAND_PATH, "utf8");
  const internals = await import(`data:text/javascript;base64,${Buffer.from(`${topbandSource}\nexport { dateSpanMetric };`).toString("base64")}`);

  // ---- configure用の可変フィクスチャ ----
  let fixedToday = "2026-02-18";
  let fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
  configureTopband({
    escapeHTML,
    todayISO: () => fixedToday,
    getSettings: () => fixedSettings
  });

  // ==== 1. renderStandingOrders(): 三つの信条・単一マークアップ ====
  {
    const html = renderStandingOrders();
    check("so-row全幅クラスを持つ", /class="tower-glass-panel so-row"/.test(html), html);
    check("STANDING ORDERSのaria-labelを含む", html.includes('aria-label="STANDING ORDERS"'));
    check("信条行が3件(so-item)", (html.match(/so-item/g) || []).length === 3);
    check("一/二/三の採番を含む", html.includes(">一<") && html.includes(">二<") && html.includes(">三<"));
    check("1行目の文言を含む", html.includes("決めた一つは、必ずやり切れる"));
    check("1行目の英語ラベルを含む", html.includes("MIT COMPLETION 100%"));
    check("3行目(充電)の文言を含む", html.includes("夜は手放して充電する"));
  }
  {
    const htmlAgain = renderStandingOrders();
    check("旧PC/モバイルvariantクラスを持たない", !/sec-creed(?:-pc)?/.test(htmlAgain), htmlAgain);
    check("再描画も同じ信条3件を持つ", (htmlAgain.match(/so-item/g) || []).length === 3);
  }

  // ==== 2. renderLifeBand(): 12週サイクル境界値 ====
  {
    const middle = internals.dateSpanMetric("2026-02-18", "2026-01-01", "2026-03-26");
    const end = internals.dateSpanMetric("2026-03-26", "2026-01-01", "2026-03-26");
    check("12WY残日数算式は48日経過=残り36日", JSON.stringify(middle) === JSON.stringify({ total: 84, elapsed: 48, remaining: 36, progress: 57 }), JSON.stringify(middle));
    check("12WY残日数算式は終端で0へクランプ", end.remaining === 0 && end.elapsed === 84 && end.progress === 100, JSON.stringify(end));
  }
  {
    fixedToday = "2026-01-01"; // サイクル開始日当日(elapsed=0)
    let html = renderLifeBand();
    check("開始日当日はWeek 1/12", /12WY WEEK[\s\S]*?>1<em>\/12/.test(html), html);
    check("開始日当日はLIFE BAND見出し", html.includes("LIFE BAND"), html);
    check("開始日当日は進捗0%", /life-sig wy[\s\S]*?width:0%/.test(html), html);
  }
  {
    fixedToday = "2026-01-08"; // ちょうど7日後(elapsed=7) → Week境界の切り替わり
    let html = renderLifeBand();
    check("7日後はWeek 2/12(週境界で切り替わる)", /12WY WEEK[\s\S]*?>2<em>\/12/.test(html), html);
    check("7日後は進捗8%(round(7/84*100))", /life-sig wy[\s\S]*?width:8%/.test(html), html);
  }
  {
    fixedToday = "2026-02-18"; // elapsed=48日(mockup-today-home-v2.htmlの例と同一シナリオ)
    let html = renderLifeBand();
    check("48日経過はWeek 7/12(mockのWeek 7/12例と一致)", /12WY WEEK[\s\S]*?>7<em>\/12/.test(html), html);
    check("48日経過も12WY値は残日数でなく週番号", !html.includes(">36<em>日"), html);
    // mockの静的width:58%は概算値(実装の正しい算式ではround(48/84*100)=57%)。
    // 算式の正しさ(裁定10: computeMetricsのmetric()と同一ロジック)を優先し、58%とは一致させない。
    check("48日経過の進捗は57%(round(48/84*100))", /life-sig wy[\s\S]*?width:57%/.test(html), html);
  }
  {
    fixedToday = "2026-03-26"; // end12ちょうど(elapsed=84、クランプでtotalに張り付く)
    let html = renderLifeBand();
    check("サイクル終端日はWeek 12/12にクランプ", /12WY WEEK[\s\S]*?>12<em>\/12/.test(html), html);
    check("サイクル終端日は進捗100%", /life-sig wy[\s\S]*?width:100%/.test(html), html);
  }
  {
    fixedToday = "2026-05-01";
    fixedSettings = { twelveWeekStartDate: "", birthDate: "" }; // 未設定 → todayを起点に開始
    let html = renderLifeBand();
    check("twelveWeekStartDate未設定はWeek 1/12から開始", /12WY WEEK[\s\S]*?>1<em>\/12/.test(html), html);
    check("twelveWeekStartDate未設定は進捗0%", /life-sig wy[\s\S]*?width:0%/.test(html), html);
  }

  // ==== 3. renderCountdown(): 今年カウントダウン ====
  {
    fixedToday = "2026-01-01";
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
    const html = renderLifeBand();
    check("元日は今年364日残り(2026年は非うるう年)", /今年[\s\S]*?>364<em>日/.test(html), html);
    check("元日は今年進捗0%", /今年[\s\S]*?width:0%/.test(html), html);
  }

  // ==== 4. renderCountdown(): birthDate未設定/設定でセル数が変わる ====
  {
    fixedToday = "2026-02-18";
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
    const html = renderLifeBand();
    check("birthDate未設定はセル2枚(12週+今年のみ)", (html.match(/life-sig(?: |")/g) || []).length === 2, html);
    check("birthDate未設定は45歳/80歳ラベルを含まない", !html.includes("45歳まで") && !html.includes("80歳まで"));
  }
  {
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "2000-01-01" };
    const html = renderLifeBand();
    check("birthDate設定はセル4枚", (html.match(/life-sig(?: |")/g) || []).length === 4, html);
    check("45歳までラベルを含む", html.includes("45歳まで"));
    check("80歳までラベルを含む", html.includes("80歳まで"));
    check("年齢セルは日単位を2件表示", (html.match(/<em>日<\/em>/g) || []).length === 3, html);
    check("年齢セルの残り日数はカンマ区切り(toLocaleString)", /45歳まで[\s\S]*?>[\d,]*,\d{3}<em>日/.test(html), html);
  }
  {
    const htmlPc = renderLifeBand();
    check("単一life-bandクラスを持つ", /class="tower-glass-panel life-band"/.test(htmlPc), htmlPc);
    check("LIFE BANDは4つのlife-sigを持つ", (htmlPc.match(/life-sig(?: |")/g) || []).length === 4, htmlPc);
  }
  {
    const htmlMobile = renderLifeBand();
    check("旧variantクラスを持たない", !/sec-life|tower-life-row/.test(htmlMobile), htmlMobile);
  }

  // ==== 5. 単一マークアップ契約 ====
  {
    fixedSettings = { twelveWeekStartDate: "2026-01-01", birthDate: "" };
    const html = `${renderLifeBand()}${renderStandingOrders()}`;
    check("旧tower-topband-pcを持たない", !html.includes("tower-topband-pc"), html);
    check("STANDING ORDERSは単一so-row", (html.match(/class="tower-glass-panel so-row"/g) || []).length === 1);
    check("LIFE BANDは単一life-band", (html.match(/class="tower-glass-panel life-band"/g) || []).length === 1);
  }

  // ==== 6. ヘッダ信条ローテーション廃止 ====
  {
    check("creedRotationLine exportを持たない", !("creedRotationLine" in mod));
    check("renderTopbandPC exportを持たない", !("renderTopbandPC" in mod));
    check("renderCountdown exportを持たない", !("renderCountdown" in mod));
    check("renderLifeBand exportを持つ", typeof mod.renderLifeBand === "function");
    check("renderStandingOrders exportを持つ", typeof mod.renderStandingOrders === "function");
    check("信条文言はSO行に一度ずつ存在", ["決めた一つは、必ずやり切れる", "進んだ量で測る", "朝に全部を注ぐ"]
      .every((text) => (renderStandingOrders().match(new RegExp(text, "g")) || []).length === 1));
    check("LIFE BANDにビーコンを一つ持つ", (renderLifeBand().match(/tower-beacon/g) || []).length === 1);
    check("LIFE BANDに時計IDを混ぜない", !/towerClock|towerDayLeft/.test(renderLifeBand()));
    check("SO行にローテーション注記を持たない", !renderStandingOrders().includes("ローテーション"));
  }

  console.log(failures === 0 ? "\ntopband-core: 全件成功" : `\ntopband-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
