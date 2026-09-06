"use strict";

// Manifest generation: classification guards run before either artifact is written.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const manifest = require("./suite-manifest.json");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "tc-manifest-generator-"));
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
function run(mode) {
  return spawnSync(process.execPath, ["scripts/test-manifest.js", mode], {
    cwd: fixture, encoding: "utf8", timeout: 30000
  });
}
const outputs = ["tests/suite-manifest.json", "docs/test-impact-map.generated.md"];
const snapshot = () => outputs.map((file) => fs.readFileSync(path.join(fixture, file)));
function unchanged(before, label) {
  outputs.forEach((file, index) =>
    check(fs.readFileSync(path.join(fixture, file)).equals(before[index]), `${label}: ${file} unchanged`));
}
try {
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.mkdirSync(path.join(fixture, "tests"));
  fs.copyFileSync(path.join(root, "scripts/test-manifest.js"), path.join(fixture, "scripts/test-manifest.js"));
  const browserSource = "const browser = chromium" + ".launch();\n";
  for (const suite of manifest.suites.filter((item) => item.tier === "smoke")) {
    fs.writeFileSync(path.join(fixture, "tests", suite.file), "// offline contract\n" + browserSource);
  }
  fs.writeFileSync(path.join(fixture, "tests/opaque-node.test.js"), '"use strict";\n');
  check(run("--write").status === 0, "valid write succeeds");
  check(run("--check").status === 0, "valid check succeeds");
  const generated = JSON.parse(fs.readFileSync(path.join(fixture, outputs[0]), "utf8"));
  check(generated.suites.find((s) => s.file === "opaque-node.test.js").domains.includes("legacy-crosscutting"),
    "node-only legacy classification remains allowed");
  const invalidSources = [
    browserSource,
    "// opaque\n" + browserSource,
    "// opaque\n//\n// task\n" + browserSource,
    '"use strict";\n// task\n' + browserSource
  ];
  for (let index = 0; index < invalidSources.length; index++) {
    const file = `opaque-${index}.test.js`;
    fs.writeFileSync(path.join(fixture, "tests", file), invalidSources[index]);
    const before = snapshot();
    for (const mode of ["--write", "--check"]) {
      const result = run(mode);
      check(result.status === 1, `${file} ${mode}: rejects unclassified E2E`);
      check(result.stderr.includes(file) && result.stderr.includes("INVALID:"), `${file} ${mode}: identifies invalid suite`);
      unchanged(before, `${file} ${mode}`);
    }
    fs.unlinkSync(path.join(fixture, "tests", file));
  }
  const accepted = {
    "r2-twelveweek-plan.test.js": ["planning-execution", "ui-responsive"],
    "v319.test.js": ["ui-responsive"],
    "v321.test.js": ["planning-execution", "ui-responsive"],
    "v323.test.js": ["ui-responsive"]
  };
  for (const [file, domains] of Object.entries(accepted)) {
    const suite = manifest.suites.find((item) => item.file === file);
    check(suite?.kind === "e2e" && domains.every((domain) => suite.domains.includes(domain))
      && !suite.domains.includes("legacy-crosscutting"), `${file}: correct product domains`);
  }
  check(run("--check").status === 0, "valid artifacts remain fresh after rejected writes");
  console.log(`PASS: test manifest generator (${checks} checks)`);
} finally {
  assert.strictEqual(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert(path.basename(fixture).startsWith("tc-manifest-generator-"));
  fs.rmSync(fixture, { recursive: true, force: true });
}
