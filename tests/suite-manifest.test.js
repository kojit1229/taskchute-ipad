"use strict";

// Must-3-2: `scripts/test-manifest.js --check`(生成物のバイト完全一致)をここから外した。
// バイト一致は`app.js`やテストファイルの1行修正だけでsourceHashがずれてCIを落としてしまうため
// (レビュー指摘 Must-3)。バイト一致の検証は release-gate.js の push前ゲートに1本化し、
// ここでは manifest が満たすべき不変条件だけを検証する。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const manifest = require("./suite-manifest.json");

const testsDir = __dirname;
const actualFiles = fs.readdirSync(testsDir).filter((file) => file.endsWith(".test.js")).sort();

const files = manifest.suites.map((suite) => suite.file);
const nodeSuites = manifest.suites.filter((suite) => suite.kind === "node");
const e2eSuites = manifest.suites.filter((suite) => suite.kind === "e2e");
const smokeSuites = manifest.suites.filter((suite) => suite.tier === "smoke");

assert.strictEqual(new Set(files).size, files.length, "suite名は一意");
assert.deepStrictEqual([...files].sort(), actualFiles,
  "manifestはtests/*.test.jsの実ファイル一覧と一致(欠落・余剰なし)");
assert.strictEqual(nodeSuites.length + e2eSuites.length, files.length,
  "全suiteをnode/e2eのどちらかに分類(fast-node ∩ domain-e2e = ∅ かつ和集合 = 全量)");
assert(smokeSuites.every((suite) => suite.kind === "e2e"), "smokeはdomain-e2e(kind=e2e)の部分集合");
assert(manifest.suites.every((suite) => typeof suite.assertionHash === "string" && suite.assertionHash.length === 16),
  "assertion hashを保持");
assert(manifest.suites.every((suite) => typeof suite.sourceHash === "string" && suite.sourceHash.length === 16),
  "source hashを保持");
assert(manifest.suites.every((suite) => Number.isInteger(suite.assertionSignals) && suite.assertionSignals >= 0),
  "assertionSignalsを整数で保持");
assert(manifest.suites.every((suite) => Array.isArray(suite.domains) && suite.domains.length > 0),
  "全suiteにdomainを付与(必須フィールド)");
assert(e2eSuites.every((suite) => !suite.domains.includes("legacy-crosscutting")),
  "製品E2Eは明示domainへ分類");

console.log(`PASS: suite manifest invariants (${files.length} suites)`);
