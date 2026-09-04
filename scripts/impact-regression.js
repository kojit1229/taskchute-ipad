"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const config = require("../tests/impact-regression-map.json");
const manifest = require("../tests/suite-manifest.json");

function unique(items) {
  return [...new Set(items)];
}

function normalize(file) {
  return file.replace(/\\/g, "/");
}

function runtimeFile(file, rules = config) {
  const normalized = normalize(file);
  return rules.runtimePaths.some((entry) => entry.endsWith("/")
    ? normalized.startsWith(entry)
    : normalized === entry);
}

function analyzeDiff(patch, rules = config, options = {}) {
  const files = unique([...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)]
    .flatMap((match) => [normalize(match[1]), normalize(match[2])])
    .filter((file) => runtimeFile(file, rules)));
  if (!files.length) {
    return { files: [], areas: [], suites: options.final ? [...rules.finalBaseline] : [] };
  }

  const changedLines = patch.split(/\r?\n/)
    .filter((line) => /^[+-](?![+-])/.test(line) || line.startsWith("@@"))
    .join("\n");
  const areas = Object.entries(rules.areas)
    .filter(([, rule]) => {
      const pathHit = (rule.paths || []).some((pattern) =>
        files.some((file) => new RegExp(pattern, "i").test(file)));
      const contentHit = (rule.patterns || []).some((pattern) =>
        new RegExp(pattern, "im").test(changedLines));
      return pathHit || contentHit;
    })
    .map(([name]) => name);
  const suites = unique([
    ...rules.baseline,
    ...(options.final ? rules.finalBaseline : []),
    ...areas.flatMap((name) => rules.areas[name].suites)
  ]);
  return { files, areas, suites };
}

function runGit(args, cwd, optional = false) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status === 0) return result.stdout;
  if (optional) return "";
  throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${(result.stderr || result.stdout).trim()}`);
}

// unit6差し戻し#1: 影響範囲選定(impact-regression)とCACHE_NAME増分チェック(cache-name-gate)が
// それぞれ独自に比較元refを決めていると、両者がズレて偽FAIL/偽PASSを生む(実例:
// cache-name-gateがHEAD固定のため、bumpとリリース記録を同一コミットに含めるこのリポでは
// コミット後の再実行で常にFAILしていた)。比較元の決定ロジックをここに一本化し、
// release-gate.js から両チェックへ同じ解決結果を渡す。
function resolveBaseRef(cwd = repoRoot, base) {
  const resolved = base || runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd, true
  ).trim() || runGit(["rev-parse", "--verify", "--quiet", "origin/main"], cwd, true).trim();
  return resolved || null;
}

function repositoryDiff(cwd = repoRoot, base) {
  const targets = [...config.runtimePaths.filter((item) => !item.endsWith("/")),
    ...config.runtimePaths.filter((item) => item.endsWith("/")).map((item) => item.slice(0, -1))];
  const worktree = runGit(["diff", "--unified=0", "HEAD", "--", ...targets], cwd);
  const upstream = resolveBaseRef(cwd, base);
  if (!upstream) {
    throw new Error("比較元を特定できません。--base=<ref>（release gateは--impact-base=<ref>）を指定してください");
  }
  const committed = runGit(["diff", "--unified=0", `${upstream}...HEAD`, "--", ...targets], cwd);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "--", ...targets], cwd)
    .split(/\r?\n/).filter(Boolean).filter((file) => runtimeFile(file));
  const additions = untracked.map((file) => {
    const source = fs.readFileSync(path.join(cwd, file), "utf8");
    return `diff --git a/${normalize(file)} b/${normalize(file)}\n`
      + source.split(/\r?\n/).map((line) => `+${line}`).join("\n");
  }).join("\n");
  return [committed, worktree, additions].filter(Boolean).join("\n");
}

function collectRepositoryImpact(options = {}) {
  return analyzeDiff(repositoryDiff(options.cwd || repoRoot, options.base), config, options);
}

function validateConfig(rules = config, suiteManifest = manifest) {
  const known = new Set(suiteManifest.suites.map((suite) => suite.file.replace(/\.test\.js$/, "")));
  const configured = unique([
    ...rules.baseline,
    ...rules.finalBaseline,
    ...Object.values(rules.areas).flatMap((area) => area.suites)
  ]);
  const errors = configured.filter((suite) => !known.has(suite));
  const smoke = suiteManifest.suites
    .filter((suite) => suite.tier === "smoke")
    .map((suite) => suite.file.replace(/\.test\.js$/, ""));
  errors.push(...smoke.filter((suite) => !rules.finalBaseline.includes(suite))
    .map((suite) => `${suite}(final baseline smoke未登録)`));
  return errors;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const baseArg = args.find((arg) => arg.startsWith("--base="));
  const unknown = validateConfig();
  if (unknown.length) {
    console.error(`impact mapの検証エラー: ${unknown.join(", ")}`);
    process.exit(1);
  }
  const impact = collectRepositoryImpact({
    base: baseArg?.slice("--base=".length),
    final: args.includes("--final")
  });
  if (args.includes("--json")) console.log(JSON.stringify(impact, null, 2));
  else {
    console.log(`変更実行ファイル: ${impact.files.join(", ") || "(なし)"}`);
    console.log(`影響領域: ${impact.areas.join(", ") || "(なし)"}`);
    console.log(`回帰スイート: ${impact.suites.join(", ") || "(なし)"}`);
  }
}

module.exports = { analyzeDiff, collectRepositoryImpact, repositoryDiff, resolveBaseRef, validateConfig };
