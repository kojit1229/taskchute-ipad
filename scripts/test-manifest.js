"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "tests");
const manifestPath = path.join(testsDir, "suite-manifest.json");
const impactPath = path.join(root, "docs", "test-impact-map.generated.md");
const args = process.argv.slice(2);
const writeMode = args.includes("--write");
const checkMode = args.includes("--check");

if (writeMode === checkMode) {
  console.error("使い方: node scripts/test-manifest.js --write|--check");
  process.exit(1);
}

const smoke = new Set([
  "sw-integration.test.js",
  "v50.test.js",
  "v59.test.js",
  "v67.test.js",
  "v70.test.js",
  "v72.test.js",
  "v105.test.js",
  "v136.test.js",
  "xss-sanitizer.test.js"
]);
const domainRules = {
  "sync-storage": /github|sync|push|pull|merge|tombstone|localstorage|backup|import|export|同期|保存|競合|移行|取込|書出/i,
  "planning-execution": /timeline|block|task|schedule|routine|pomodoro|triage|wbs|タイムライン|ブロック|タスク|計画|実行|ルーティン|スケジュール/i,
  "journal-health": /journal|sleep|health|battery|energy|condition|weekly|cycle|report|ジャーナル|日報|睡眠|健康|体調|週次|サイクル/i,
  "content-ai": /ai|feedback|vision|wish|avoid|question|theme|markdown|フィードバック|ビジョン|願望|回避|質問|テーマ/i,
  "ui-responsive": /responsive|viewport|font-size|modal|nav|sidebar|drag|swipe|css|render|レスポンシブ|表示|描画|画面|ドラッグ/i,
  "security-offline": /sanitize|xss|service.?worker|cache|offline|token|privacy|サニタイ|セキュリティ|オフライン/i
};
// 独立レビュー Must-2 修正案5対応: code-index(scripts/code-index.js)のarea語彙
// (sync/state/execution/journal-health/ui/content/core)と、このファイルのdomains語彙
// (sync-storage/planning-execution/journal-health/content-ai/ui-responsive/
// security-offline/legacy-crosscutting)は別々の入力(関数名+呼び出し識別子 vs
// テストファイル名+先頭コメント)から独立に決めているため、文字列としては一致しない。
// 「同一の語彙に揃える」ため、area→domainの対応表をここで確定し、
// generateAreaSuiteMap()で「変更した関数のarea → そのdomainを持つsuite一覧」を
// 引ける表を組み立てる(既存のdomainRulesは他エージェントが並行して触る
// tests/suite-manifest.test.jsの前提を崩さないよう変更しない)。
const AREA_TO_DOMAIN = {
  sync: "sync-storage",
  state: "sync-storage",
  execution: "planning-execution",
  "journal-health": "journal-health",
  ui: "ui-responsive",
  content: "content-ai",
  core: "legacy-crosscutting"
};

function generateAreaSuiteMap(suites) {
  const codeIndexPath = path.join(root, "docs", "code-index.generated.json");
  let codeIndex = null;
  try {
    codeIndex = JSON.parse(fs.readFileSync(codeIndexPath, "utf8"));
  } catch {
    return "";
  }
  if (!Array.isArray(codeIndex.functions)) return "";

  const areaCounts = new Map();
  for (const fn of codeIndex.functions) {
    for (const area of fn.area || []) {
      areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
    }
  }
  if (!areaCounts.size) return "";

  const rows = [...areaCounts.keys()].sort().map((area) => {
    const domain = AREA_TO_DOMAIN[area] || "legacy-crosscutting";
    const matchingSuites = suites.filter((s) => s.domains.includes(domain)).map((s) => s.file);
    return `| ${area} | ${domain} | ${areaCounts.get(area)} | ${matchingSuites.length} | ${matchingSuites.join(", ") || "-"} |`;
  });

  return `\n## Area → suite map (code-index area ⇔ test-manifest domain)\n\n`
    + `変更した関数の \`area\`(scripts/code-index.js が付与)から、対応する \`domain\` を持つ`
    + `スイート一覧を引くための対応表(独立レビュー Must-2 修正案5)。\n\n`
    + `| Code-index area | Test-manifest domain | Functions | Suites | Suite list |\n`
    + `|---|---|---:|---:|---|\n${rows.join("\n")}\n`;
}

const explicitDomains = {
  "v49.test.js": ["sync-storage", "content-ai"],
  "v53.test.js": ["sync-storage", "journal-health"],
  "v54.test.js": ["journal-health", "ui-responsive"],
  "v58.test.js": ["planning-execution", "content-ai", "ui-responsive"],
  "v60.test.js": ["content-ai", "security-offline"],
  "v61.test.js": ["planning-execution"],
  "v65.test.js": ["planning-execution"],
  "v66.test.js": ["planning-execution", "ui-responsive"],
  "v74.test.js": ["content-ai"],
  "v85.test.js": ["sync-storage", "journal-health", "content-ai"],
  "v98.test.js": ["ui-responsive"],
  "v117.test.js": ["planning-execution"],
  "v123.test.js": ["ui-responsive"],
  "v127.test.js": ["ui-responsive"],
  "v129.test.js": ["planning-execution", "journal-health"],
  "v132.test.js": ["planning-execution", "journal-health"],
  "v133.test.js": ["planning-execution", "content-ai"],
  "v151.test.js": ["ui-responsive"],
  "v155.test.js": ["planning-execution", "ui-responsive"],
  "v163.test.js": ["journal-health", "ui-responsive"],
  "v254.test.js": ["planning-execution", "sync-storage"],
  "v263.test.js": ["planning-execution", "sync-storage", "ui-responsive"],
  "v264.test.js": ["planning-execution", "sync-storage", "ui-responsive"],
  "v266.test.js": ["planning-execution", "sync-storage", "ui-responsive"],
  "v267.test.js": ["planning-execution", "sync-storage", "journal-health", "ui-responsive"],
  "track-crud-core.test.js": ["planning-execution", "sync-storage"]
};

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

function classify(file) {
  const source = fs.readFileSync(path.join(testsDir, file), "utf8").replace(/\r\n/g, "\n");
  const summaryComments = [];
  let startedSummary = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/");
    const isCommentSpacer = trimmed === "//" || trimmed === "*" || trimmed === "/*" || trimmed === "*/";
    if (!startedSummary && !isComment) {
      if (!trimmed) continue;
      break;
    }
    if (isComment) {
      if (startedSummary && isCommentSpacer) break;
      startedSummary = true;
      summaryComments.push(line);
      continue;
    }
    if (startedSummary && !trimmed) break;
    break;
  }
  const domainText = `${file}\n${summaryComments.join("\n")}`;
  const waitArgs = [...source.matchAll(/waitForTimeout\(\s*([^)]+?)\s*\)/g)].map((match) => match[1]);
  const numericWaits = waitArgs.filter((value) => /^\d+$/.test(value));
  const assertionLines = source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\bcheck\(|\bassert(?:\.|\()|throw new Error|failures\+\+/.test(line));
  const domains = explicitDomains[file]
    ? [...explicitDomains[file]]
    : Object.entries(domainRules)
      .filter(([, pattern]) => pattern.test(domainText))
      .map(([name]) => name);
  if (!domains.length) domains.push("legacy-crosscutting");

  return {
    file,
    kind: /launchChromium|playwright-core|chromium\.launch/.test(source) ? "e2e" : "node",
    tier: smoke.has(file) ? "smoke" : "full",
    domains,
    assertionSignals: assertionLines.length,
    assertionHash: crypto.createHash("sha256").update(assertionLines.join("\n")).digest("hex").slice(0, 16),
    sourceHash: crypto.createHash("sha256").update(source).digest("hex").slice(0, 16),
    waits: {
      fixedCount: waitArgs.length,
      numericMilliseconds: numericWaits.reduce((sum, value) => sum + Number(value), 0),
      unresolvedCount: waitArgs.length - numericWaits.length
    },
    sideEffects: {
      browser: /launchChromium|playwright-core|chromium\.launch/.test(source),
      server: /\bstartServer\(/.test(source),
      fileWrite: /writeFile|appendFile|unlink|rmSync|renameSync|screenshot\s*\(\s*\{\s*path/.test(source),
      networkMock: /\.route\(/.test(source),
      clock: /\.clock\./.test(source)
    }
  };
}

const files = fs.readdirSync(testsDir).filter((file) => file.endsWith(".test.js")).sort();
const missingSmoke = [...smoke].filter((file) => !files.includes(file));
if (missingSmoke.length) {
  console.error(`smoke指定ファイルがありません: ${missingSmoke.join(", ")}`);
  process.exit(1);
}

const manifest = {
  schemaVersion: 1,
  generatedBy: "scripts/test-manifest.js",
  suites: files.map(classify)
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const impactRows = manifest.suites.map((suite) =>
  `| ${suite.file} | ${suite.kind} | ${suite.tier} | ${suite.domains.join(", ")} | ${suite.assertionSignals} | ${suite.waits.fixedCount} | ${suite.waits.numericMilliseconds} |`
);
const impactText = `<!-- generated by scripts/test-manifest.js; edit the generator/rules instead -->\n`
  + `# Test impact map\n\n`
  + `| Suite | Kind | Tier | Domains | Assertion signals | Fixed waits | Numeric wait ms |\n`
  + `|---|---|---|---|---:|---:|---:|\n${impactRows.join("\n")}\n`
  + generateAreaSuiteMap(manifest.suites);

if (checkMode) {
  const currentManifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  const currentImpact = fs.existsSync(impactPath) ? fs.readFileSync(impactPath, "utf8") : "";
  if (currentManifest !== manifestText || currentImpact !== impactText) {
    console.error("OUTDATED: suite-manifest.json または test-impact-map.generated.md");
    process.exit(1);
  }
  console.log(`PASS: test manifest ${manifest.suites.length} suites`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(impactPath), { recursive: true });
fs.writeFileSync(manifestPath, manifestText, "utf8");
fs.writeFileSync(impactPath, impactText, "utf8");
console.log(`WROTE: ${manifest.suites.length} suites`);
