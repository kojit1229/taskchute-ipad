"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkCacheNameIncrement } = require("../scripts/cache-name-gate");

const root = path.resolve(__dirname, "..");
// Gate command plans must not depend on the checkout's current release or SW.
const planRoot = createFixtureRepo(163);
for (const file of ["scripts/release-gate.js", "scripts/impact-regression.js",
  "scripts/cache-name-gate.js", "scripts/release-record.js", "tests/core-suites.js"]) {
  fs.mkdirSync(path.dirname(path.join(planRoot, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(planRoot, file));
}
const fixtureSuites = ["v50", "v54", "v160", "v161", "v162", "v163", "v164"];
for (const suite of fixtureSuites) fs.writeFileSync(path.join(planRoot, "tests", `${suite}.test.js`), "");
fs.writeFileSync(path.join(planRoot, "tests/suite-manifest.json"), JSON.stringify({
  suites: fixtureSuites.map((suite) => ({ file: `${suite}.test.js`, tier: suite === "v50" ? "smoke" : "full" }))
}));
fs.writeFileSync(path.join(planRoot, "tests/impact-regression-map.json"), JSON.stringify({
  runtimePaths: ["app.js", "sw.js", "src/"], baseline: ["v50"], finalBaseline: ["v50", "v54"],
  areas: {
    "fixture-shell": { paths: ["^sw\\.js$"], suites: ["v164"] },
    "fixture-module": { paths: ["^src/uncached\\.js$"], suites: ["v164"] }
  }
}));
writeSw(planRoot, 164);
fs.appendFileSync(path.join(planRoot, "sw.js"), "const APP_SHELL = [];\n");
fs.writeFileSync(path.join(planRoot, "releases/v164.json"), JSON.stringify({
  version: 164, date: "2026-01-01", title: "fixture", summary: "fixture",
  changedFiles: ["sw.js"], intent: ["fixture"], changes: ["fixture"],
  uncertainties: ["none"], reviewFocus: ["fixture"], verification: ["fixture"]
}));
const gate = path.join(planRoot, "scripts", "release-gate.js");

function run(...args) {
  return spawnSync(process.execPath, [gate, ...args], {
    cwd: planRoot,
    encoding: "utf8",
    timeout: 30000
  });
}

try {
const schema = spawnSync(process.execPath, ["scripts/release-record.js", "releases/v164.json", "--validate"],
  { cwd: planRoot, encoding: "utf8", timeout: 30000 });
assert.strictEqual(schema.status, 0, schema.stderr);
const missing = run("releases/does-not-exist.json", "--suite=v163");
assert.notStrictEqual(missing.status, 0, "存在しないrelease記録を通常gateが拒否する");
assert(`${missing.stdout}\n${missing.stderr}`.includes("release記録がありません"),
  "release schema検証で早期失敗する");

const validRecord = fs.readFileSync(path.join(planRoot, "releases/v164.json"), "utf8");
for (const [label, content] of [["invalid JSON", "{"], ["missing title", JSON.stringify({ ...JSON.parse(validRecord), title: "" })]]) {
  fs.writeFileSync(path.join(planRoot, "releases/v164.json"), content);
  for (const mode of [[], ["--dry-run"]]) {
    const invalid = run("releases/v164.json", "--suite=v164", "--impact-base=HEAD", ...mode);
    assert.strictEqual(invalid.status, 1, `${label} must fail ${mode.join(" ")}: ${invalid.stderr}`);
    assert(!invalid.stdout.includes("=== impact-selection ==="), "schema error must stop before impact selection");
  }
}
fs.writeFileSync(path.join(planRoot, "releases/v164.json"), validRecord);
const missingDry = run("releases/does-not-exist.json", "--suite=v163", "--dry-run", "--impact-base=HEAD");
assert.strictEqual(missingDry.status, 1);
assert(missingDry.stderr.includes("release記録がありません"));

const finalPlan = run("releases/v164.json", "--suite=v54", "--final", "--dry-run", "--impact-base=HEAD");
assert.strictEqual(finalPlan.status, 0, finalPlan.stderr);
assert(finalPlan.stdout.indexOf("=== release-record ===") < finalPlan.stdout.indexOf("=== impact-regression ==="),
  "--finalは生成物checkを長い回帰テストより先に実行する");
assert(finalPlan.stdout.indexOf("=== impact-regression ===") < finalPlan.stdout.indexOf("=== core ==="),
  "--finalは追加suiteをimpact回帰へ統合し、coreより先に実行する");
assert(!finalPlan.stdout.match(/impact-regression[\s\S]*run-all\.js[^\n]*\bv50\b/),
  "--finalはcore対象をimpact回帰で二重実行しない");

const plan = run("releases/v164.json", "--suite=v164", "--dry-run", "--impact-base=HEAD");
assert.strictEqual(plan.status, 0, plan.stderr);
assert(plan.stdout.includes("impact-selection"), "release gateが差分影響選定を表示する");
assert(plan.stdout.includes("related+impact-regression"), "関連suiteと自動回帰束を一本化する");

fs.mkdirSync(path.join(planRoot, "src"));
fs.writeFileSync(path.join(planRoot, "src/uncached.js"), "export const value = 1;\n");
const uncached = run("releases/v164.json", "--suite=v164", "--dry-run", "--impact-base=HEAD");
assert.strictEqual(uncached.status, 1, "新規runtimeがAPP_SHELLに無ければ拒否する");
assert(uncached.stderr.includes("app-shell-precache") && uncached.stderr.includes("./src/uncached.js"),
  "欠落したruntimeの名前を報告する");
const shell = fs.readFileSync(path.join(planRoot, "sw.js"), "utf8").replace("APP_SHELL = []", 'APP_SHELL = ["./src/uncached.js"]');
fs.writeFileSync(path.join(planRoot, "sw.js"), shell);
const cached = run("releases/v164.json", "--suite=v164", "--dry-run", "--impact-base=HEAD");
assert.strictEqual(cached.status, 0, cached.stderr);
console.log("PASS: isolated gate plan and precache negative/positive fixtures");
console.log("PASS: release gate argument/schema guards");
} finally {
  removeFixture(planRoot);
}

// --- unit6: cache-name-increment（sw.jsのCACHE_NAME増分）フィクスチャテスト ---
// 一時ディレクトリにミニgitリポジトリを作り、sw.js/releases/vN.jsonのコピーだけを置いて
// checkCacheNameIncrement()を直接呼ぶ。git HEADが「直前リリース」の役を果たす。
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.strictEqual(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function writeSw(dir, version) {
  fs.writeFileSync(path.join(dir, "sw.js"), `const CACHE_NAME = "taskchute-journal-pwa-v${version}";\n`);
}

function writeRelease(dir, version) {
  fs.mkdirSync(path.join(dir, "releases"), { recursive: true });
  fs.writeFileSync(path.join(dir, "releases", `v${version}.json`), JSON.stringify({ version }));
}

function createFixtureRepo(initialVersion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-name-gate-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "test");
  writeSw(dir, initialVersion);
  writeRelease(dir, initialVersion);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", `v${initialVersion}`);
  return dir;
}

function removeFixture(dir) {
  assert.strictEqual(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert(path.basename(dir).startsWith("cache-name-gate-"));
  fs.rmSync(dir, { recursive: true, force: true });
}

// (a) 一致+1でPASS
{
  const dir = createFixtureRepo(1);
  writeSw(dir, 2);
  writeRelease(dir, 2);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v2.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, true, `(a) +1でPASSするはず: ${result.message}`);
  removeFixture(dir);
}

// (b) CACHE_NAME据え置きでFAIL（実行差分ありなのに増分していない）
{
  const dir = createFixtureRepo(1);
  // sw.js/release記録は据え置き（N===Mは保ったまま）。実行差分だけ発生している想定。
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v1.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, false, "(b) 据え置きはFAILするはず");
  assert(result.message.includes("増分していません"), `(b) 増分不足メッセージのはず: ${result.message}`);
  removeFixture(dir);
}

// (c) +2飛びの扱い: 「>直前値」であれば増分要件自体は満たすためPASS（警告メッセージ付き）とした。
// 根拠: area-4-ios-sw-css.md 修正1が要求するのは「M > M0」(厳密+1ではない)。
// CLAUDE.md/SKILLの「必ずv+1」は運用上の推奨であり、複数版をまとめてbumpするリリースを
// 誤ってFAILさせない方が実害が小さいと判断した（過検知よりは警告に留める）。
{
  const dir = createFixtureRepo(1);
  writeSw(dir, 3);
  writeRelease(dir, 3);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v3.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, true, `(c) +2飛びはPASS(警告)扱いのはず: ${result.message}`);
  assert(result.message.includes("+1超"), `(c) 飛び幅の注記が出るはず: ${result.message}`);
  removeFixture(dir);
}

// (d) release記録のversionとCACHE_NAMEが不一致ならFAIL（実行差分がある通常のリリース想定）
{
  const dir = createFixtureRepo(1);
  writeSw(dir, 2);
  writeRelease(dir, 5);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v5.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, false, "(d) version不一致はFAILするはず");
  assert(result.message.includes("不一致"), `(d) 不一致メッセージのはず: ${result.message}`);
  removeFixture(dir);
}

// (3) 実行差分なしならCACHE_NAME不問でPASS（app.js等に変更が無ければ増分チェック自体をskip）
{
  const dir = createFixtureRepo(1);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v1.json`, hasRuntimeDiff: false });
  assert.strictEqual(result.ok, true, `(3) 差分なしはPASSするはず: ${result.message}`);
  assert(result.message.includes("不問"), `(3) 不問メッセージのはず: ${result.message}`);
  removeFixture(dir);
}

// (e) baseRef切替: unit6差し戻し#1の再発防止。「直前値」の比較元をHEAD固定ではなく
// baseRefパラメータで切り替えられることを確認する。同一の作業ツリー状態(v2据え置き)でも、
// baseRef=HEAD（直前コミットがv2）ならFAIL、baseRef=1つ前のコミット（v1）ならPASSになる
// ことを両方確認し、比較元を呼び出し側から選べることを保証する。
{
  const dir = createFixtureRepo(1); // コミット1: v1
  const firstCommit = git(dir, "rev-parse", "HEAD").trim();
  writeSw(dir, 2);
  writeRelease(dir, 2);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "v2"); // コミット2: v2（これがHEAD）
  // 作業ツリー/release記録はv2のまま据え置き（実運用の「bumpとリリース記録を同一コミットに
  // 含めた直後の再実行」を模す。HEAD:sw.jsも既にv2のため、HEAD比較だと必ずFAILする）。
  const viaHead = checkCacheNameIncrement({ repoRoot: dir, manifestPath: "releases/v2.json", hasRuntimeDiff: true });
  assert.strictEqual(viaHead.ok, false, `(e) baseRef=HEAD(既定)は据え置き扱いでFAILするはず: ${viaHead.message}`);

  const viaFirstCommit = checkCacheNameIncrement({
    repoRoot: dir,
    manifestPath: "releases/v2.json",
    hasRuntimeDiff: true,
    baseRef: firstCommit
  });
  assert.strictEqual(viaFirstCommit.ok, true,
    `(e) baseRef=1つ前のコミット(v1)ならv2は増分ありでPASSするはず: ${viaFirstCommit.message}`);
  removeFixture(dir);
}

console.log("PASS: cache-name-increment fixtures (a)+1 / (b)据え置き / (c)+2飛び / (d)version不一致 / (3)差分なし / (e)baseRef切替");
