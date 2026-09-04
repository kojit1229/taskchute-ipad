"use strict";

// 注意: --dry-run はコマンドプランを表示するだけで実テストは実行しないが、
// release-record-schema検証・impact map検証・app-shell-precache・cache-name-increment
// の各静的チェックは --dry-run でも実行され、不正があれば exit 1 する(コマンド実行だけをskipする)。

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { collectRepositoryImpact, resolveBaseRef, validateConfig } = require("./impact-regression");
const { getCoreSuites } = require("../tests/core-suites");
const { checkCacheNameIncrement } = require("./cache-name-gate");

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
const impactBase = args.find((arg) => arg.startsWith("--impact-base="))?.slice("--impact-base=".length);

if (!manifest) {
  console.error(
    "使い方: node scripts/release-gate.js releases/vNNN.json [--suite=追加対象] [--final] "
      + "[--impact-base=<ref>] [--dry-run]\n"
      + "  --dry-run はテスト実行のみskipする。schema/impact map/app-shell-precache/"
      + "cache-name-incrementの各静的チェックは--dry-runでも実行され、不正があればexit 1する。"
  );
  process.exit(1);
}
console.log("\n=== release-record-schema ===");
const schemaArgs = [path.join(repoRoot, "scripts", "release-record.js"), manifest, "--validate"];
console.log([process.execPath, ...schemaArgs].join(" "));
if (!dryRun) {
  const schema = spawnSync(process.execPath, schemaArgs, { cwd: repoRoot, stdio: "inherit" });
  if (schema.status !== 0) process.exit(schema.status ?? 1);
}
const unknownImpactSuites = validateConfig();
if (unknownImpactSuites.length) {
  console.error(`impact mapの検証エラー: ${unknownImpactSuites.join(", ")}`);
  process.exit(1);
}
// unit6差し戻し#1: impact選定とcache-name-incrementの比較元を同じ解決結果に揃える
// (--impact-base → @{upstream} → origin/main。いずれも無ければ fail-close)。
// baseRef が解決できない(上流も origin/main も無い)場合は HEAD へ落とさず、従来どおり
// collectRepositoryImpact 側の throw(--impact-base を指定してください)で fail-close にする。
const baseRef = resolveBaseRef(repoRoot, impactBase);
const impact = collectRepositoryImpact({ cwd: repoRoot, base: baseRef, final: finalMode });
const releaseSuite = path.basename(manifest, path.extname(manifest));
const releaseTestExists = fs.existsSync(path.join(repoRoot, "tests", `${releaseSuite}.test.js`));
const selectedSuites = [...new Set([
  ...suites,
  ...(releaseTestExists ? [releaseSuite] : []),
  ...impact.suites
])];
const coreSuites = finalMode ? new Set(getCoreSuites()) : new Set();
const impactOnlySuites = selectedSuites.filter((suite) => !coreSuites.has(suite));
if (!finalMode && !selectedSuites.length) {
  console.error("実行差分または--suiteがありません。対象スイートを指定してください");
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
    ...(impactOnlySuites.length ? [{
      label: "impact-regression",
      command: process.execPath,
      args: [path.join(repoRoot, "tests", "run-all.js"), ...impactOnlySuites]
    }] : []),
    {
      label: "core",
      command: process.execPath,
      args: [path.join(repoRoot, "tests", "run-core.js")]
    }
  );
} else {
  commands.push({
    label: "related+impact-regression",
    command: process.execPath,
    args: [path.join(repoRoot, "tests", "run-all.js"), ...selectedSuites]
  });
}

console.log("\n=== impact-selection ===");
console.log(`変更実行ファイル: ${impact.files.join(", ") || "(なし)"}`);
console.log(`影響領域: ${impact.areas.join(", ") || "(なし)"}`);
console.log(`自動回帰スイート: ${impact.suites.join(", ") || "(なし)"}`);
console.log(`統合実行スイート: ${selectedSuites.join(", ") || "(なし)"}`);
if (finalMode) console.log(`coreとの重複除外後: ${impactOnlySuites.join(", ") || "(なし)"}`);

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

console.log("\n=== cache-name-increment ===");
const cacheNameCheck = checkCacheNameIncrement({
  repoRoot,
  manifestPath: manifest,
  hasRuntimeDiff: impact.files.length > 0,
  baseRef: baseRef || "HEAD"
});
if (!cacheNameCheck.ok) {
  console.error(`FAIL: ${cacheNameCheck.message}`);
  process.exit(1);
}
console.log(`PASS: ${cacheNameCheck.message}`);

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
