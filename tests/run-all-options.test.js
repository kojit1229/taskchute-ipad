"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const runner = path.join(__dirname, "run-all.js");

function list(...args) {
  const result = spawnSync(process.execPath, [runner, "--list", ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout.split(/\r?\n/).filter((line) => line.endsWith(".test.js"));
}

const all = list();
const fast = list("--group=fast-node");
const smoke = list("--group=smoke");
const domain = list("--group=domain-e2e");

assert(all.includes("run-all-options.test.js"), "runner自身の高速Nodeテストが一覧に含まれる");
assert(fast.includes("release-record.test.js"), "release記録テストはfast-node");
assert(fast.includes("v163.test.js"), "ブラウザ不要のv163契約テストはfast-node");
assert(smoke.includes("v72.test.js"), "同期ゲートの代表をsmokeに含める");
assert.strictEqual(fast.filter((file) => domain.includes(file)).length, 0, "fast-nodeとdomain-e2eは重複しない");
assert.deepStrictEqual([...fast, ...domain].sort(), [...all].sort(), "fast-nodeとdomain-e2eの和集合が全スイート");
assert(smoke.every((file) => domain.includes(file)), "smokeはdomain-e2eの部分集合");

const shards = [1, 2, 3, 4].flatMap((index) => list(`--shard=${index}/4`));
assert.strictEqual(new Set(shards).size, shards.length, "4シャード間に重複がない");
assert.deepStrictEqual([...shards].sort(), [...all].sort(), "4シャードの和集合が全スイート");

const invalidWorkers = spawnSync(process.execPath, [runner, "--list", "--workers=0"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});
assert.notStrictEqual(invalidWorkers.status, 0, "不正なworkers指定は失敗する");

const runnerSource = fs.readFileSync(runner, "utf8");
const baseMax = Number(runnerSource.match(/TEST_PORT_BASE_MAX = (\d+)/)?.[1]);
const baseStep = Number(runnerSource.match(/TEST_PORT_BASE_STEP = (\d+)/)?.[1]);
assert(baseStep >= 200 * 10, "最大200スイート分のport帯が隣接baseと重ならない");
assert(baseMax + baseStep - 10 < 65536, "最大baseのport帯がTCP上限内");

console.log("PASS: run-all groups/shards/options");
