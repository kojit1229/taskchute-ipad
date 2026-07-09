// v56 検証: Codexレビュー反映(入力16px / hoverオフセット撤去 / 下書き削除の前面化 /
//            アイコン404解消 / placeholder引用符 / AIフィードバックfetchの404ノイズ解消)
const { chromium, launchOptions, startServer } = require("./helpers");

const PORT = 4192;
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

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(new Date());
  const now = new Date();
  const YESTERDAY = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);

  // ---- [1] 入力の font-size 16px 以上(#2 クラス指定 / #3 インラインstyle)----
  console.log("[1] 入力の font-size 16px 以上");
  // クラス指定(.zt-add-text / .zt-search-input / .home-cd)を注入要素で検証
  const clsSizes = await page.evaluate(() => {
    const mk = (tag, cls) => {
      const el = document.createElement(tag);
      el.className = cls;
      document.body.appendChild(el);
      return parseFloat(getComputedStyle(el).fontSize);
    };
    return {
      add: mk("textarea", "zt-add-text"),
      search: mk("input", "zt-search-input"),
      cd: mk("select", "home-cd")
    };
  });
  check(".zt-add-text が16px以上", clsSizes.add >= 16, clsSizes.add);
  check(".zt-search-input が16px以上", clsSizes.search >= 16, clsSizes.search);
  check(".home-cd(充放電select)が16px以上", clsSizes.cd >= 16, clsSizes.cd);

  // #3: inline style で font-size を指定した textarea も 16px 未満に落ちない(グローバル既定への
  //     依存だけでなく、inline style の値自体が 16px 以上であることの回帰確認)。
  //     v60でこの回帰の元ネタだった設定画面のAIプロンプトtextareaは機能ごと削除されたため、
  //     同じ属性を持つ要素を都度生成して検証する(クラス指定と同じ手法)。
  const inlineFs = await page.evaluate(() => {
    const el = document.createElement("textarea");
    el.setAttribute("style", "min-height:110px; font-size:16px");
    document.body.appendChild(el);
    return parseFloat(getComputedStyle(el).fontSize);
  });
  check("inline style指定のtextareaが16px以上", inlineFs >= 16, inlineFs);

  // ---- [2] タイムラインカードのhoverは位置をずらさない(#4)----
  console.log("[2] タイムラインカードのhoverは位置をずらさない");
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "timeline-card";
    el.id = "__tl_probe";
    el.setAttribute("data-action", "edit-block");
    el.style.cssText = "position:fixed; top:200px; left:200px; width:200px; height:44px; z-index:99999;";
    document.body.appendChild(el);
  });
  const before = await page.locator("#__tl_probe").boundingBox();
  await page.locator("#__tl_probe").hover();
  await page.waitForTimeout(120);
  const hovered = await page.locator("#__tl_probe").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform, boxShadow: cs.boxShadow };
  });
  const after = await page.locator("#__tl_probe").boundingBox();
  check("hover時 transform でずらさない(none)", hovered.transform === "none", hovered.transform);
  check("hover前後で left が動かない", Math.abs(before.x - after.x) < 0.5, `${before.x}->${after.x}`);
  check("hoverフィードバックは box-shadow で表現", hovered.boxShadow !== "none");

  // ---- [3] 下書き削除(×)は下端リサイズ帯より前面(#5)----
  console.log("[3] 下書き削除は下端リサイズ帯より前面");
  const zc = await page.evaluate(() => {
    const block = document.createElement("div");
    block.className = "draft-block";
    block.style.cssText = "position:fixed; top:300px; left:300px; width:200px; height:24px;";
    const rm = document.createElement("button");
    rm.className = "draft-remove";
    const rz = document.createElement("div");
    rz.className = "draft-resize";
    block.appendChild(rm); block.appendChild(rz);
    document.body.appendChild(block);
    const z = (el) => getComputedStyle(el).zIndex;
    return { remove: z(rm), resize: z(rz) };
  });
  const removeZ = zc.remove === "auto" ? 0 : Number(zc.remove);
  const resizeZ = zc.resize === "auto" ? 0 : Number(zc.resize);
  check(".draft-remove の z-index が .draft-resize より大きい", removeZ > resizeZ, `remove=${zc.remove} resize=${zc.resize}`);

  // ---- [4] アイコンが 404 にならない(#6)----
  console.log("[4] アイコンが404にならない");
  const iconRes = await page.evaluate(async () => {
    const r = await fetch("./assets/icon.svg", { cache: "no-cache" });
    const t = r.ok ? await r.text() : "";
    return { ok: r.ok, isSvg: t.includes("<svg") };
  });
  check("assets/icon.svg が 200 で取得できる", iconRes.ok);
  check("assets/icon.svg が SVG として妥当", iconRes.isSvg);
  // manifest / index.html が参照するパスが実在するか
  const refsOk = await page.evaluate(async () => {
    const man = await (await fetch("./manifest.webmanifest")).json();
    const src = man.icons[0].src;
    const r = await fetch(src.replace(/^\.\//, "./"), { cache: "no-cache" });
    return r.ok;
  });
  check("manifest の icon src が実在する", refsOk);

  // ---- [5] 問いモーダルの placeholder が壊れていない(#7)----
  console.log("[5] 問いモーダルの placeholder が壊れていない");
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.currentView = "zero";
    s.settings.zeroTab = "question";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="question-add"]');
  await page.waitForTimeout(300);
  const ph = await page.locator('[data-modal-field="text"]').getAttribute("placeholder");
  check("placeholder が全文保持されている(属性が途中で壊れていない)",
    !!ph && ph.includes("経営指標提案") && ph.includes("変えるには何が要るか"), ph || "(null)");
  await page.click('[data-action="modal-close"]');
  await page.waitForTimeout(200);

  // ---- [6] AIフィードバック fetch の404ノイズ解消(#8)----
  console.log("[6] AIフィードバック fetch の404ノイズ解消");
  // fetch 監視は addInitScript で app.js より前に仕込む(reload でも毎回入る)
  await page.addInitScript(() => {
    window.__fbReqs = [];
    const orig = window.fetch;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes("AIフィードバック_")) window.__fbReqs.push(u);
      return orig(url, opts);
    };
  });

  // (a) 旧state(feedbackFiles 無し)→ 補完される / (b) 空なら fetch しない
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    delete s.feedbackFiles;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(700);
  const reqsEmpty = await page.evaluate(() => (window.__fbReqs || []).slice());
  // 補完は正規化時(メモリ)→ 保存で永続化されるため、nav操作で書き出してから確認
  await page.click('[data-action="nav"][data-view="home"]');
  await page.waitForTimeout(200);
  check("旧stateから feedbackFiles(配列)が補完される",
    await page.evaluate((KEY) => Array.isArray(JSON.parse(localStorage.getItem(KEY)).feedbackFiles), KEY));
  // v57: feedbackFiles が空でも「今日から見た昨日」1日分だけは無条件fetchする例外が入った
  //      (ローカルAIコーチングの直push検知)。ここでの selectedDate は TODAY のままなので、
  //      許容されるfetchは AIフィードバック_<YESTERDAY>.md ちょうど1件のみ。
  //      それ以外の日付への fetch が1件でもあれば失敗とする(F1: 過去日ブラウズ時の
  //      無条件fetchは v57.test.js 側で回帰確認する)。
  check("feedbackFiles が空でも fetch は「今日から見た昨日」1件のみ(それ以外は出さない)",
    reqsEmpty.length === 1 && reqsEmpty[0].includes(`AIフィードバック_${YESTERDAY}.md`),
    JSON.stringify(reqsEmpty));

  // (c) feedbackFiles に日付があり手元本文が無い → その日付だけ fetch する
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.feedbackFiles = [TODAY];
    if (s.feedback) delete s.feedback[TODAY];
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(700);
  const reqsKnown = await page.evaluate(() => (window.__fbReqs || []).slice());
  check("記録済みかつ本文未取得の日付は fetch する",
    reqsKnown.some((u) => u.includes(`AIフィードバック_${TODAY}.md`)), JSON.stringify(reqsKnown));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
