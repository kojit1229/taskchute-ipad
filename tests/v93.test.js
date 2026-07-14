// v93 検証: 0秒思考タブがiPhone表示(狭幅viewport)で崩れる不具合の回帰テスト。CHANGES_v93.md参照。
//
// K報告(2026-07-14)「0秒思考のタブがiphone表示だと崩れる」への対応。
// 原因: .zt-theme-item(☆ + 本文 + 大テーマselect + 書く→ + ×の1行flex)で、本文
// (.zt-theme-text、flex:1 min-width:0)以外がすべてflex:noneの固定幅のため、390px幅では
// 本文の割当幅が数十px未満まで潰れ、日本語が1文字ずつ縦積みになって行の高さが数百pxへ
// 膨張していた(294件規模・28グループの実データ相当で発覚)。
// 修正: styles.css に @media (max-width: 480px) を追加し、.zt-theme-item を flex-wrap: wrap、
// .zt-theme-text を order:-1 + flex-basis:100% にして、本文を独立した全幅の1行にし、
// ☆/select/書く→/×は次の行へ折り返す。
//
// ①390px幅で横スクロールが発生しない ②本文が極端に潰れない(過去の崩れの再発防止)
// ③グループ階層(v90)配下でも同様 ④デスクトップ幅(720px超)では従来の1行表示のまま
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
  const page0 = await browser.newPage();
  await page0.close(); // warm up executable resolution (helpers互換のため何もしない)

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  // 合成データ(実データはコピーしない): 3グループ・グループあたり4件・長めの日本語テーマ名 + 未分類2件
  function buildSyntheticThemes() {
    const groups = [
      { id: "g0", title: "仕事の進め方を見直す大テーマ", order: 0, createdAt: `${TODAY}T00:00` },
      { id: "g1", title: "家族との時間配分について考える", order: 1, createdAt: `${TODAY}T00:00` },
      { id: "g2", title: "健康習慣を継続するための工夫", order: 2, createdAt: `${TODAY}T00:00` }
    ];
    const themes = [];
    let tid = 0;
    groups.forEach((g) => {
      for (let k = 0; k < 4; k++) {
        themes.push({
          id: `t${tid++}`,
          text: `${g.title}に関する具体的で長めの検討テーマ文言その${k + 1}番目`,
          fav: false, questionId: null, source: null, groupId: g.id, createdAt: `${TODAY}T00:00`
        });
      }
    });
    for (let k = 0; k < 2; k++) {
      themes.push({
        id: `u${k}`, text: `未分類のまま残っている長い日本語テーマ文言サンプル${k + 1}`,
        fav: false, questionId: null, source: null, groupId: null, createdAt: `${TODAY}T00:00`
      });
    }
    return { groups, themes };
  }

  async function seedAndReload(page, { groups, themes }) {
    await page.evaluate(({ KEY, themes, groups }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = { themes, entries: [], groups };
      s.zeroSecThemeLog = [];
      s.feedback = {};
      s.currentView = "zero";
      s.settings = s.settings || {};
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, themes, groups });
    await page.reload();
    await page.waitForTimeout(500);
  }

  try {
    // ============================================================
    // [1] 390px幅(iPhone相当)で横スクロールが発生せず、本文が極端に潰れない
    // ============================================================
    console.log("[1] 390px幅の0秒思考タブで横スクロールが発生せず、本文行が異常に潰れない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    await seedAndReload(pageMobile, buildSyntheticThemes());

    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      const items = Array.from(document.querySelectorAll(".zt-theme-item"));
      const texts = Array.from(document.querySelectorAll(".zt-theme-text"));
      const minTextWidth = texts.length ? Math.min(...texts.map((t) => t.getBoundingClientRect().width)) : null;
      const maxItemHeight = items.length ? Math.max(...items.map((el) => el.getBoundingClientRect().height)) : null;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        itemCount: items.length,
        minTextWidth,
        maxItemHeight
      };
    });
    console.log("  metrics:", JSON.stringify(metricsMobile));

    check("390px幅でテーマが描画される(前提確認)", metricsMobile.itemCount === 14, `itemCount=${metricsMobile.itemCount}`);
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    // 修正前は本文(.zt-theme-text)の割当幅が数十px未満まで潰れ、1文字ずつ縦積みになって
    // 1行(.zt-theme-item)の高さが数百pxへ膨張していた。修正後は本文が独立した全幅行になり
    // 幅200px以上を確保でき、高さも1行分(120px程度)に収まる。
    check("本文(.zt-theme-text)が極端に潰れていない(幅200px以上)",
      metricsMobile.minTextWidth !== null && metricsMobile.minTextWidth >= 200,
      `minTextWidth=${metricsMobile.minTextWidth}`);
    check("テーマ1行の高さが異常に膨張していない(150px未満)",
      metricsMobile.maxItemHeight !== null && metricsMobile.maxItemHeight < 150,
      `maxItemHeight=${metricsMobile.maxItemHeight}`);

    // ============================================================
    // [2] グループ階層(v90)配下でも同様に折り返される(グループ見出し・件数表示は従来どおり)
    // ============================================================
    console.log("[2] グループ配下のテーマでも本文が独立行になり、グループ機能自体は壊れない");
    check("グループ見出しが表示される(v90機能が壊れていない前提確認)",
      await pageMobile.locator(".zt-group-title", { hasText: "仕事の進め方を見直す大テーマ" }).count() >= 1);
    const groupedTextWidth = await pageMobile.evaluate(() => {
      const body = document.querySelector(".zt-group:not(.zt-group-unclassified) .zt-group-body");
      const t = body ? body.querySelector(".zt-theme-text") : null;
      return t ? t.getBoundingClientRect().width : null;
    });
    check("グループ配下(インデント22px分狭い)でも本文幅200px以上を確保できる",
      groupedTextWidth !== null && groupedTextWidth >= 200, `groupedTextWidth=${groupedTextWidth}`);

    await ctxMobile.close();

    // ============================================================
    // [3] デスクトップ幅(720px超)では従来どおり1行表示のまま(回帰防止)
    // ============================================================
    console.log("[3] デスクトップ幅(844px)では従来どおり☆・本文・selectなどが同じ行に並ぶ");
    const ctxDesktop = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const pageDesktop = await ctxDesktop.newPage();
    await blockGithubApiByDefault(pageDesktop);
    await pageDesktop.goto(`http://localhost:${PORT}/`);
    await pageDesktop.waitForTimeout(500);
    await passGithubGate(pageDesktop);
    await seedAndReload(pageDesktop, buildSyntheticThemes());

    const desktopMetrics = await pageDesktop.evaluate(() => {
      const item = document.querySelector(".zt-theme-item");
      if (!item) return null;
      const text = item.querySelector(".zt-theme-text");
      const star = item.querySelector(".zt-star");
      return {
        textTop: text.getBoundingClientRect().top,
        starTop: star.getBoundingClientRect().top
      };
    });
    check("デスクトップ幅では本文と☆が同じ行(top座標がほぼ一致)にある(1行表示のまま)",
      !!desktopMetrics && Math.abs(desktopMetrics.textTop - desktopMetrics.starTop) < 5,
      JSON.stringify(desktopMetrics));

    await ctxDesktop.close();

    console.log(failures === 0 ? "\n✅ v93 ALL PASS" : `\n❌ v93: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
