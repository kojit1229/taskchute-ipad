"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

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
