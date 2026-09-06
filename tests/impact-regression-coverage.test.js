"use strict";
// Impact selection and fail-closed runtime coverage contracts.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const override = process.argv.find((arg) => arg.startsWith("--module="));
const modulePath = override ? override.slice(9) : path.join(__dirname, "../scripts/impact-regression.js");
const { analyzeDiff, validateConfig, collectRuntimeFiles } = require(modulePath);
const rules = require(path.join(path.dirname(modulePath), "../tests/impact-regression-map.json"));
const manifest = require(path.join(path.dirname(modulePath), "../tests/suite-manifest.json"));
const clone = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
const check = (value, name) => { assert(value, name); checks++; };
const patch = (file) => `diff --git a/${file} b/${file}\n+// neutral change`;
const paths = ["src/core/plan.js", "src/features/twelve-week.js"];
for (const file of paths) {
  const impact = analyzeDiff(patch(file));
  check(impact.suites.includes("r1-twelveweek") && impact.suites.includes("r2-twelveweek-plan"), `${file} selects 12WY UI regressions`);
  if (file.includes("core/")) check(impact.suites.includes("plan-core") && impact.suites.includes("r0-twyplan"), "plan contracts selected");
}
check(validateConfig(rules, manifest, paths).length === 0, "known runtime paths covered");
check(validateConfig(rules, manifest, ["src/new-module.js"]).some((e) => e.includes("src/new-module.js") && e.includes("未分類")), "new runtime fails closed");
const explicit = clone(rules);
explicit.areas.newModule = { paths: ["^src/new-module\\.js$"], suites: ["plan-core"] };
check(validateConfig(explicit, manifest, ["src/new-module.js"]).length === 0, "explicit new module coverage passes");
check(validateConfig(rules, manifest, ["src\\core\\plan.js"]).length === 0, "Windows path coverage normalized");
check(analyzeDiff(patch("src\\core\\plan.js")).suites.includes("plan-core"), "Windows diff path selection normalized");
check(validateConfig(rules, manifest, ["docs/readme.md", "tests/other.test.js"]).length === 0, "nonruntime excluded");
check(analyzeDiff(patch("docs/readme.md")).suites.length === 0, "nonruntime diff does not select suites");
const noSuites = clone(explicit); noSuites.areas.newModule.suites = [];
check(validateConfig(noSuites, manifest, ["src/new-module.js"]).some((e) => e.includes("未分類")), "empty area suites do not fake coverage");
const keyword = clone(rules); keyword.areas.keywordOnly = { patterns: [".*"], suites: ["plan-core"] };
check(validateConfig(keyword, manifest, ["src/new-module.js"]).some((e) => e.includes("未分類")), "content keyword and baseline do not fake path coverage");
const unknown = clone(rules); unknown.baseline.push("does-not-exist");
check(validateConfig(unknown, manifest, paths).includes("does-not-exist"), "unknown suite guard retained");
const noSmoke = clone(rules); noSmoke.finalBaseline = [];
check(validateConfig(noSmoke, manifest, paths).some((e) => e.includes("smoke未登録")), "smoke guard retained");
const archiveSuites = ["archive-date-protection", "archive-date-protection-e2e", "archive-tombstone-sync", "archive-snapshot-safety"];
const archiveDeletions = [
  ["app.js", "if (isArchivedDate(state,date)) return showToast(ARCHIVED_READONLY_MESSAGE);"],
  ["src/features/journal.js", "if (isArchivedDate(state,date)) return;"],
  ["src/features/today.js", "archived: isArchivedDate(state,date),"],
  ["src/features/today-tower.js", '${journal.archived ? "readonly" : ""}'],
  ["src/features/today-tower.js", '${journal.archived ? "disabled" : ""}'],
  ["src/features/today-tower.js", '${ARCHIVED_READONLY_MESSAGE}'],
  ["src/features/archive-date-protection.js", "evidence = new Set();"],
  ["src/sync/github.js", "await prepareArchiveMerge(remoteNorm);"],
];
for (const [file, line] of archiveDeletions) {
  const impact = analyzeDiff(`diff --git a/${file} b/${file}\n@@ -1 +0,0 @@\n-${line}`);
  check(archiveSuites.every((suite) => impact.suites.includes(suite)), `${file}: deleted archive guard selects protection suites`);
}
const unrelated = analyzeDiff('diff --git a/app.js b/app.js\n@@ -1 +1 @@\n-label = "old";\n+label = "new";');
check(archiveSuites.every((suite) => !unrelated.suites.includes(suite)), "unrelated label does not select archive suites");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "tc-impact-"));
try {
  fs.mkdirSync(path.join(fixture, "src/nested"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "scripts")); fs.mkdirSync(path.join(fixture, "tests"));
  fs.writeFileSync(path.join(fixture, "src/nested/new.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(fixture, "app.js"), "");
  fs.writeFileSync(path.join(fixture, "docs.txt"), "");
  check(JSON.stringify(collectRuntimeFiles(fixture, rules)) === JSON.stringify(["app.js", "src/nested/new.js"]), "scanner finds nested untracked runtime only");
  fs.copyFileSync(modulePath, path.join(fixture, "scripts/impact-regression.js"));
  fs.writeFileSync(path.join(fixture, "tests/impact-regression-map.json"), JSON.stringify(rules));
  fs.writeFileSync(path.join(fixture, "tests/suite-manifest.json"), JSON.stringify(manifest));
  const result = spawnSync(process.execPath, ["scripts/impact-regression.js", "--json"], { cwd: fixture, encoding: "utf8", timeout: 10000 });
  check(result.status === 1 && result.stderr.includes("src/nested/new.js(runtime path未分類)"), "CLI rejects uncovered runtime before git selection");
} finally {
  assert.strictEqual(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert(path.basename(fixture).startsWith("tc-impact-"));
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(`PASS: impact regression coverage (${checks} checks)`);
