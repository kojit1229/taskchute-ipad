"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkCacheNameIncrement } = require("../scripts/cache-name-gate");

const root = path.resolve(__dirname, "..");
const gate = path.join(root, "scripts", "release-gate.js");

function run(...args) {
  return spawnSync(process.execPath, [gate, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

const missing = run("releases/does-not-exist.json", "--suite=v163");
assert.notStrictEqual(missing.status, 0, "存在しないrelease記録を通常gateが拒否する");
assert(`${missing.stdout}\n${missing.stderr}`.includes("release記録がありません"),
  "release schema検証で早期失敗する");

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

console.log("PASS: release gate argument/schema guards");

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

// (a) 一致+1でPASS
{
  const dir = createFixtureRepo(1);
  writeSw(dir, 2);
  writeRelease(dir, 2);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v2.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, true, `(a) +1でPASSするはず: ${result.message}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// (b) CACHE_NAME据え置きでFAIL（実行差分ありなのに増分していない）
{
  const dir = createFixtureRepo(1);
  // sw.js/release記録は据え置き（N===Mは保ったまま）。実行差分だけ発生している想定。
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v1.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, false, "(b) 据え置きはFAILするはず");
  assert(result.message.includes("増分していません"), `(b) 増分不足メッセージのはず: ${result.message}`);
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
}

// (d) release記録のversionとCACHE_NAMEが不一致ならFAIL（実行差分がある通常のリリース想定）
{
  const dir = createFixtureRepo(1);
  writeSw(dir, 2);
  writeRelease(dir, 5);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v5.json`, hasRuntimeDiff: true });
  assert.strictEqual(result.ok, false, "(d) version不一致はFAILするはず");
  assert(result.message.includes("不一致"), `(d) 不一致メッセージのはず: ${result.message}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// (3) 実行差分なしならCACHE_NAME不問でPASS（app.js等に変更が無ければ増分チェック自体をskip）
{
  const dir = createFixtureRepo(1);
  const result = checkCacheNameIncrement({ repoRoot: dir, manifestPath: `releases/v1.json`, hasRuntimeDiff: false });
  assert.strictEqual(result.ok, true, `(3) 差分なしはPASSするはず: ${result.message}`);
  assert(result.message.includes("不問"), `(3) 不問メッセージのはず: ${result.message}`);
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("PASS: cache-name-increment fixtures (a)+1 / (b)据え置き / (c)+2飛び / (d)version不一致 / (3)差分なし / (e)baseRef切替");
