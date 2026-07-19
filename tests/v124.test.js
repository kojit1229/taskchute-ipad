// v124 検証: apple-design反映②(押下フィードバック+モーションの磨き+reduced-motion対応)。
// CHANGES_v124.md参照。
//
// (a) 静的検査: styles.cssに @media (prefers-reduced-motion: reduce) ブロックが存在し、
//     transform系のtransition/animationを無効化している(opacity系のフェードは残す)
// (b) 静的検査: .btn:active に押下フィードバック(transform: scale(0.97))が存在する
// (c) 静的検査: .timeline-card に transform を付ける :active/:hover 規則が新設されていない
//     (不可侵領域。タイムライン絶対配置のドリフト再発防止)
// (d) ブラウザ検証: アプリが正常起動し、モーダル(横断検索)が開閉できる(機能回帰)
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, ROOT } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// 対応する閉じ括弧までを愚直にカウントして@media/ルールブロックの中身を取り出す。
// (styles.cssの@media (prefers-reduced-motion) はその中に複数の通常ルールをネストしており、
//  単純な `\{[^}]*\}` 正規表現では1階層しか拾えないため専用のブレースカウンタを使う。
//  また同じメディアクエリのブロックが複数箇所に存在しうる(v40の.just-started用の既存1行と、
//  v124で追加した本体)ため、すべてのブロックの中身を連結して返す)
function extractAllBlockBodies(css, headerRe) {
  const bodies = [];
  let m;
  while ((m = headerRe.exec(css))) {
    let i = css.indexOf("{", m.index + m[0].length - 1);
    if (i === -1) continue;
    let depth = 0;
    let start = i;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) { bodies.push(css.slice(start + 1, i)); break; }
      }
    }
  }
  return bodies;
}

(async () => {
  // ============================================================
  // 静的検査(ブラウザ起動不要)
  // ============================================================
  console.log("[0] 静的検査: styles.css");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

  // (b) 押下フィードバック
  check(".btn:active に transform: scale(0.97) が存在する",
    /\.btn:active\s*\{[^}]*transform:\s*scale\(0\.97\)/.test(css));
  check(".bottom-nav button:active に transform: scale(0.97) が存在する(ボトムナビのタップ要素)",
    /\.bottom-nav button:active\s*\{[^}]*transform:\s*scale\(0\.97\)/.test(css) ||
    /\.bottom-nav button:active\s*,?[^{]*\{[^}]*transform:\s*scale\(0\.97\)/.test(css));

  // (c) .timeline-card は不可侵(transformを付ける:active/:hover規則の新設禁止)
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let timelineViolation = null;
  while ((m = ruleRe.exec(css))) {
    const selector = m[1].trim();
    const body = m[2];
    if (!/\.timeline-card\b/.test(selector)) continue;
    if (/\.timeline-cards-area/.test(selector)) continue; // 別クラス(コンテナ)は対象外
    if (/:active|:hover/.test(selector) && /transform\s*:/.test(body)) {
      timelineViolation = `${selector} { ${body.trim()} }`;
      break;
    }
  }
  check(".timeline-card の :active/:hover に transform を付ける規則が無い(不可侵領域)",
    timelineViolation === null, timelineViolation || "");
  check(".draft-* にも transform を付ける規則が無い(不可侵領域)",
    !/\.draft-[\w-]*\s*[^{}]*\{[^{}]*transform\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));

  // (a) prefers-reduced-motion ブロックの存在+中身(複数ブロックがあれば連結して見る)
  const reducedMotionBodies = extractAllBlockBodies(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*/g);
  const reducedMotionBody = reducedMotionBodies.join("\n");
  check("@media (prefers-reduced-motion: reduce) ブロックが存在する", reducedMotionBodies.length > 0, "");
  if (reducedMotionBodies.length > 0) {
    check("reduced-motionブロックがtransformを無効化している(transform: none)",
      /transform:\s*none/.test(reducedMotionBody));
    check("reduced-motionブロックがtransition/animationを止めている箇所を含む",
      /transition:\s*none/.test(reducedMotionBody) && /animation:\s*none/.test(reducedMotionBody));
    check("reduced-motionブロック自体は新たなtransform移動量(scale/translate)を追加していない",
      !/transform:\s*(scale|translate)/.test(reducedMotionBody));
    check("モーダルのreduced-motion版アニメーションが指定されている(.modal-card)",
      /\.modal-card\s*\{[^}]*animation:\s*modal-materialize-reduced/.test(reducedMotionBody));
    check("完了演出(.ce-particle/.ce-message/.ce-next)が短いフェードに縮退している",
      /\.ce-particle\s*\{[^}]*animation:\s*ce-fade-reduced/.test(reducedMotionBody) &&
      /\.ce-message\s*\{[^}]*animation:\s*ce-fade-reduced/.test(reducedMotionBody) &&
      /\.ce-next\s*\{[^}]*animation:\s*ce-fade-reduced/.test(reducedMotionBody));
  }

  // 縮退フェード側のkeyframes自体がopacityのみで、transformを一切使っていないこと
  // (transformを一切指定しなければ、各要素の基本ルールの静的transformが保たれ位置ズレしない)
  const modalReducedKeyframes = (css.match(/@keyframes\s+modal-materialize-reduced\s*\{[\s\S]*?\n\}/) || [""])[0];
  check("modal-materialize-reduced keyframesはopacityのみでtransformを使わない",
    /opacity/.test(modalReducedKeyframes) && !/transform/.test(modalReducedKeyframes), modalReducedKeyframes);
  const ceReducedKeyframes = (css.match(/@keyframes\s+ce-fade-reduced\s*\{[\s\S]*?\n\}/) || [""])[0];
  check("ce-fade-reduced keyframesはopacityのみでtransformを使わない",
    /opacity/.test(ceReducedKeyframes) && !/transform/.test(ceReducedKeyframes), ceReducedKeyframes);

  // モーダルの通常(non-reduced)マテリアライズがtransform+opacityのみ(compositor-friendly)
  const modalKeyframes = (css.match(/@keyframes\s+modal-materialize\s*\{[\s\S]*?\n\}/) || [""])[0];
  check("modal-materialize keyframesはtransform+opacityのみ使用(compositor-friendly)",
    /opacity/.test(modalKeyframes) && /transform:\s*scale/.test(modalKeyframes));

  // ============================================================
  // (d) ブラウザ検証: 起動+モーダル開閉(機能回帰)
  // ============================================================
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    console.log("[1] アプリ起動確認");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("アプリが起動しホーム画面が表示される",
      await page.locator("#app").count() >= 1);

    console.log("[2] モーダル(横断検索)の開閉");
    await page.locator('[data-action="open-search"]').first().click();
    await page.waitForTimeout(350); // マテリアライズ(200ms)の完了を待つ
    const modalOpenState = await page.evaluate(() => {
      const root = document.querySelector(".modal-root");
      const card = document.querySelector(".modal-card");
      const cs = card ? getComputedStyle(card) : null;
      return {
        rootOpen: root?.classList.contains("open") ?? false,
        cardExists: !!card,
        cardOpacity: cs ? parseFloat(cs.opacity) : null,
      };
    });
    check("モーダルが開く(.modal-root.open + .modal-card)",
      modalOpenState.rootOpen && modalOpenState.cardExists, JSON.stringify(modalOpenState));
    check("マテリアライズ完了後、.modal-cardのopacityが1", modalOpenState.cardOpacity === 1, JSON.stringify(modalOpenState));

    await page.locator('[data-action="modal-close"]').first().click();
    await page.waitForTimeout(150);
    const modalClosedState = await page.evaluate(() => {
      const root = document.querySelector(".modal-root");
      return {
        rootOpen: root?.classList.contains("open") ?? false,
        cardExists: !!document.querySelector(".modal-card"),
      };
    });
    check("モーダルが閉じる(.modal-root.open解除 + .modal-card除去)",
      !modalClosedState.rootOpen && !modalClosedState.cardExists, JSON.stringify(modalClosedState));

    console.log("[3] .btn:active の押下フィードバック(computed transform)が実際に反映される");
    // Playwrightにはpointerホールドを維持するAPIがあるため、mouse.downのまま計測する
    const searchBtn = page.locator('[data-action="open-search"]').first();
    const box = await searchBtn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120); // transition: transform 100ms の完了を待つ
    const activeTransform = await searchBtn.evaluate((el) => getComputedStyle(el).transform);
    await page.mouse.up();
    check(":active中はtransformがscale(0.97)相当(matrix)になっている",
      activeTransform !== "none" && activeTransform !== "matrix(1, 0, 0, 1, 0, 0)",
      activeTransform);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
