const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/features/vision-overview.js"), "utf8");
  const { validateVisionOverview, createVisionOverview } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const fixture = () => ({ schemaVersion: 1, themes: ["A", "B", "C"].map(id => ({
    id, title: `架空テーマ ${id}`, core: "核となる架空の文章", question: "今日試すことは？",
    imageFile: `vision-overview/${id.toLowerCase()}.png`, detailMarkdown: "既存目標を消さず全文へ到達する架空の判断ガイド"
  })), affirmationMarkdown: "毎朝読む架空の宣言" });
  let checks = 0;
  const check = (value, label) => { assert(value, label); checks++; };
  check(validateVisionOverview(fixture()).themes.length === 3, "three ordered themes");
  for (const mutate of [x => x.schemaVersion = 2, x => x.themes.reverse(), x => x.themes.pop(),
    x => x.themes[1].id = "A", x => x.themes[0].detailMarkdown = "", x => x.affirmationMarkdown = "",
    x => x.themes[0].imageFile = "../../secret.png", x => x.themes[0].imageFile = "https://example.invalid/a.png",
    x => x.themes[0].imageFile = "vision-overview/a.svg", x => x.themes[0].core = "x".repeat(2001)]) {
    const data = fixture(); mutate(data); assert.throws(() => validateVisionOverview(data)); checks++;
  }
  let key = "fixture-account-1", data = fixture(), failure = false, imagesFail = false, serial = 0;
  const revoked = [], paths = [];
  const overview = createVisionOverview({ connectionKey: () => key,
    escape: text => String(text).replace(/[<>&"]/g, x => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[x])),
    markdown: text => `<p>${text}</p>`,
    urls: { createObjectURL: () => `blob:fixture-${++serial}`, revokeObjectURL: url => revoked.push(url) },
    read: async (name, kind) => {
      paths.push(name);
      if (failure) return { ok: false, status: 500 };
      if (kind === "blob") {
        if (imagesFail) throw new Error("isolated read failure");
        return { ok: true, blob: new Blob(["synthetic"], { type: "image/png" }) };
      }
      return { ok: true, text: JSON.stringify(data) };
    }
  });
  check(overview.render("vision") === "", "legacy fallback before hydration");
  await overview.hydrate();
  check((overview.render("vision").match(/<img /g) || []).length === 3, "all images loaded");
  check(paths.length === 4 && paths[1] === "content/vision-overview/a.png", "private relative route");
  check(overview.render("affirmation").includes(data.affirmationMarkdown), "full affirmation");
  check(overview.render("vision").includes(data.themes[0].detailMarkdown), "full guide kept");
  failure = true; await overview.hydrate();
  check(overview.render("vision").includes("前回取得") && overview.render("vision").includes("blob:fixture-1"), "failed refresh retains marked previous content");
  key = "fixture-account-2";
  check(overview.render("vision") === "" && revoked.length === 3, "connection change clears old content and URLs immediately");
  await overview.hydrate(); check(overview.render("vision") === "", "unavailable new connection falls back");
  failure = false; imagesFail = true; await overview.hydrate();
  check((overview.render("vision").match(/画像を取得できませんでした/g) || []).length === 3, "all image failures leave readable copy");
  imagesFail = false; data.themes[0].title = '<img src=x onerror="bad()">'; await overview.hydrate();
  check(overview.render("vision").includes("&lt;img") && !overview.render("vision").includes('<h2><img'), "theme text escaped");
  overview.reset(); check(overview.render("vision") === "" && revoked.length === 6, "reset releases assets");
  {
    let resolveOld, account = "one";
    const pending = new Promise(resolve => { resolveOld = resolve; });
    const race = createVisionOverview({ connectionKey: () => account, escape: x => x, markdown: x => x,
      read: () => pending, urls: { createObjectURL: () => { throw Error("must not load images"); }, revokeObjectURL() {} } });
    const work = race.hydrate(); account = "two";
    resolveOld({ ok: true, text: JSON.stringify(fixture()) });
    check(await work === false && race.render("vision") === "", "late previous-account result ignored");
  }
  {
    let resolveOld, calls = 0;
    const old = new Promise(resolve => { resolveOld = resolve; });
    const latest = fixture(); latest.themes[0].core = "newest response";
    const race = createVisionOverview({ connectionKey: () => "one", escape: x => x, markdown: x => x,
      urls: { createObjectURL: () => "blob:race", revokeObjectURL() {} },
      read: async (_name, kind) => kind === "blob" ? { ok: false } : ++calls === 1 ? old : { ok: true, text: JSON.stringify(latest) } });
    const first = race.hydrate(); await race.hydrate(); resolveOld({ ok: true, text: JSON.stringify(fixture()) }); await first;
    check(race.render("vision").includes("newest response"), "out-of-order same-account fetch keeps latest");
  }
  console.log(`PASS vision overview (${checks} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
