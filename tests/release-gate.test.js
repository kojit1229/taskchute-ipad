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

const ambiguous = run("releases/v164.json", "--suite=v163", "--final");
assert.notStrictEqual(ambiguous.status, 0, "--finalと--suiteの併用を拒否する");

console.log("PASS: release gate argument/schema guards");
