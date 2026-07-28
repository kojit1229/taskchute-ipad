"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "taskchute-size-gate-"));
const scriptRel = path.join(".github", "workflows", "scripts", "check-commit-size.sh");
const scriptDest = path.join(temp, scriptRel);
const bash = process.platform === "win32"
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(fs.existsSync)
  : "bash";

function run(command, args, expect = 0) {
  const result = spawnSync(command, args, { cwd: temp, encoding: "utf8" });
  assert.strictEqual(result.status, expect, result.stderr || result.stdout);
  return `${result.stdout}\n${result.stderr}`;
}

function git(...args) {
  return run("git", args);
}

function commit(subject, body = "") {
  git("add", "-A");
  const args = ["commit", "-m", subject];
  if (body) args.push("-m", body);
  git(...args);
  return git("rev-parse", "HEAD").trim();
}

try {
  assert(bash, "Git Bashが必要");
  fs.mkdirSync(path.dirname(scriptDest), { recursive: true });
  fs.copyFileSync(path.join(root, scriptRel), scriptDest);
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");

  fs.writeFileSync(path.join(temp, "README.md"), "base\n");
  const base = commit("base");

  fs.mkdirSync(path.join(temp, "tests"));
  fs.writeFileSync(path.join(temp, "tests", "large.test.js"), "assert(true);\n".repeat(250));
  const testOnly = commit("large test only");
  const testOutput = run(bash, [scriptRel, base, testOnly]);
  assert(testOutput.includes("実行コード0行"), "tests/**は実行コード集計から除外する");

  fs.writeFileSync(path.join(temp, "app.js"), "const value = 1;\n".repeat(201));
  const oversized = commit("oversized runtime");
  const failure = run(bash, [scriptRel, testOnly, oversized], 1);
  assert(failure.includes("実行コード201行"), "実行コード201行を検出する");

  fs.writeFileSync(path.join(temp, "more.js"), "const more = 1;\n".repeat(201));
  const exempt = commit("approved indivisible change", "Size-Exempt: fixture");
  const exemptOutput = run(bash, [scriptRel, oversized, exempt]);
  assert(exemptOutput.includes("[SKIP]") && exemptOutput.includes("Size-Exempt: fixture"),
    "理由付きSize-Exemptを認識する");

  // Must-4: 行数とは独立の第2判定(tests/suite-manifest.jsonのスイート総数/assertionSignals
  // 合計の減少をTest-Reductionトレーラーで検知する)。
  function writeManifest(entries) {
    const suites = entries.map(([file, assertionSignals]) => ({ file, assertionSignals }));
    fs.writeFileSync(
      path.join(temp, "tests", "suite-manifest.json"),
      `${JSON.stringify({ suites }, null, 2)}\n`
    );
  }

  writeManifest([["a.test.js", 5], ["b.test.js", 5]]);
  const manifestBase = commit("add suite manifest baseline");

  fs.writeFileSync(path.join(temp, "README.md"), "base\nupdated\n");
  const manifestUnchanged = commit("touch readme, manifest unchanged");
  const noReductionOutput = run(bash, [scriptRel, manifestBase, manifestUnchanged]);
  assert(noReductionOutput.includes("PASS"),
    "正常系: manifestが減っていなければテスト削減チェックも通過する");

  writeManifest([["a.test.js", 5]]); // suite総数2→1、assertionSignals合計10→5
  const reduced = commit("remove suite b from manifest");
  const reducedOutput = run(bash, [scriptRel, manifestUnchanged, reduced], 1);
  assert(reducedOutput.includes("Test-Reduction") && reducedOutput.includes("FAIL"),
    "違反系: 無届けのテスト削減を検知してFAILする");

  writeManifest([]); // さらに0件へ削減。今回はTest-Reductionトレーラーで届出する
  const exemptReduction = commit(
    "remove remaining suite from manifest",
    "Test-Reduction: aへ統合済み、bの検証内容はa.test.jsに移植済み"
  );
  const exemptReductionOutput = run(bash, [scriptRel, reduced, exemptReduction]);
  assert(exemptReductionOutput.includes("[SKIP]") && exemptReductionOutput.includes("Test-Reduction:"),
    "トレーラー免除系: 理由付きTest-Reductionがあれば通過する");

  console.log("PASS: executable-only commit size gate + test-reduction gate");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
