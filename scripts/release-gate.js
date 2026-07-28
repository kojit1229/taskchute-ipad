"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const manifest = args.find((arg) => !arg.startsWith("--"));
const suites = args
  .filter((arg) => arg.startsWith("--suite="))
  .flatMap((arg) => arg.slice("--suite=".length).split(","))
  .map((item) => item.trim())
  .filter(Boolean);
const finalMode = args.includes("--final");
const dryRun = args.includes("--dry-run");

if (!manifest || (!finalMode && !suites.length)) {
  console.error("使い方: node scripts/release-gate.js releases/vNNN.json --suite=vNNN[,回帰対象] [--final] [--dry-run]");
  process.exit(1);
}
if (finalMode && suites.length) {
  console.error("--finalでは--suiteを指定しません。最終coreだけを実行します");
  process.exit(1);
}

function collectRuntimeJavaScript() {
  const files = ["app.js", "sw.js"];
  const srcRoot = path.join(repoRoot, "src");
  const visit = (directory) => {
    if (!require("fs").existsSync(directory)) return;
    for (const entry of require("fs").readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path.relative(repoRoot, fullPath));
    }
  };
  visit(srcRoot);
  return files.sort();
}

// Blocker-2: SWがJSファイルをファイル単位でnetwork-first解決するため、`src/**/*.js`を
// 追加してもsw.jsのAPP_SHELLへ追加し忘れると「新app.js × 旧src/*.js」の版ズレで
// iOS PWAが起動不能になりうる。collectRuntimeJavaScript()が既に src/ を再帰走査しているので、
// その結果とsw.jsのAPP_SHELLを突合するだけの静的チェックを追加する(src/が存在しない現状は
// srcファイルが0件なので自明にパスする)。
function checkAppShellPrecache() {
  const fs = require("fs");
  const swPath = path.join(repoRoot, "sw.js");
  const swSource = fs.existsSync(swPath) ? fs.readFileSync(swPath, "utf8") : "";
  const shellMatch = swSource.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/);
  const appShellEntries = shellMatch
    ? [...shellMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    : [];
  const srcFiles = collectRuntimeJavaScript()
    .filter((file) => file.split(path.sep).join("/").startsWith("src/"))
    .map((file) => `./${file.split(path.sep).join("/")}`);
  const missing = srcFiles.filter((file) => !appShellEntries.includes(file));
  return { srcFiles, missing };
}

const commands = [
  {
    label: "release-record-schema",
    command: process.execPath,
    args: [path.join(repoRoot, "scripts", "release-record.js"), manifest, "--validate"]
  },
  {
    label: "test-manifest",
    command: process.execPath,
    args: [path.join(repoRoot, "scripts", "test-manifest.js"), "--check"]
  },
  {
    label: "code-index",
    command: process.execPath,
    args: [path.join(repoRoot, "scripts", "code-index.js"), "--check"]
  },
  ...collectRuntimeJavaScript().map((file) => ({
    label: `syntax:${file}`,
    command: process.execPath,
    args: ["--check", path.join(repoRoot, file)]
  }))
];

if (finalMode) {
  commands.push(
    {
      label: "release-record",
      command: process.execPath,
      args: [path.join(repoRoot, "scripts", "release-record.js"), manifest, "--check"]
    },
    {
      label: "core",
      command: process.execPath,
      args: [path.join(repoRoot, "tests", "run-core.js")]
    }
  );
} else {
  commands.push({
    label: "related",
    command: process.execPath,
    args: [path.join(repoRoot, "tests", "run-all.js"), ...suites]
  });
}

console.log("\n=== app-shell-precache ===");
const appShellCheck = checkAppShellPrecache();
if (appShellCheck.missing.length) {
  console.error(`FAIL: app-shell-precache -- sw.jsのAPP_SHELLに未列挙: ${appShellCheck.missing.join(", ")}`);
  process.exit(1);
}
console.log(
  appShellCheck.srcFiles.length
    ? `PASS: app-shell-precache (src/ ${appShellCheck.srcFiles.length}件すべてAPP_SHELLに列挙済み)`
    : "PASS: app-shell-precache (src/ 未使用のため自明にpass)"
);

for (const step of commands) {
  console.log(`\n=== ${step.label} ===`);
  console.log([step.command, ...step.args].join(" "));
  if (dryRun) continue;
  const result = spawnSync(step.command, step.args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`FAIL: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log(dryRun ? "\nPASS: gate command plan" : "\nPASS: release gate");
