"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
let acorn;
try { acorn = require("acorn"); }
catch { acorn = null; }

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
  "exec-layout-media.test.js": ["planning-execution", "ui-responsive"],
  "fill-gap-layout-inputs-e2e.test.js": ["planning-execution", "ui-responsive", "sync-storage"],
  "feedback-readonly-scroll.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-date-contract.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-canonical-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-recovery-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-lifecycle-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-input-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-canonical-wiring.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-canonical.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-refresh-guard.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-busy-coordinator.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-busy-boundary.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-http-entry.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-save-proof.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "feedback-ui-core.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "vision-connection-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "vision-connection.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "vision-overview.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "iron-log-core.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "iron-input-safety-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "iron-log-input-core.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "placement-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "placement-core.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "karada-import-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "karada-import-core.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "v356.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "v301.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "v281.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "fund-integration-e2e.test.js": ["content-ai", "sync-storage", "ui-responsive", "security-offline"],
  "today-detail-integration-e2e.test.js": ["sync-storage", "planning-execution", "journal-health", "ui-responsive"],
  "work-list-e2e.test.js": ["planning-execution", "ui-responsive"],
  "ui-a-layout.test.js": ["planning-execution", "journal-health", "ui-responsive"],
  "detail-draft-e2e.test.js": ["sync-storage", "planning-execution", "ui-responsive"],
  "zero-draft-e2e.test.js": ["sync-storage", "content-ai", "ui-responsive"],
  "archive-date-protection-e2e.test.js": ["sync-storage", "journal-health", "ui-responsive"],
  "state-container-recovery-e2e.test.js": ["sync-storage"],
  "r2-twelveweek-plan.test.js": ["planning-execution", "ui-responsive"],
  "v319.test.js": ["ui-responsive"],
  "v321.test.js": ["planning-execution", "ui-responsive"],
  "v323.test.js": ["ui-responsive"],
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
  "v193.test.js": ["content-ai", "sync-storage", "planning-execution", "ui-responsive"],
  "v254.test.js": ["planning-execution", "sync-storage"],
  "v263.test.js": ["planning-execution", "sync-storage", "ui-responsive"],
  "v264.test.js": ["planning-execution", "sync-storage", "ui-responsive"],
  "v266.test.js": ["planning-execution", "sync-storage", "ui-responsive"],
  "v267.test.js": ["planning-execution", "sync-storage", "journal-health", "ui-responsive"],
  "v275.test.js": ["ui-responsive"],
  "v276.test.js": ["planning-execution", "ui-responsive"],
  "v277.test.js": ["ui-responsive"],
  "v278.test.js": ["planning-execution", "ui-responsive"],
  "v280.test.js": ["planning-execution", "ui-responsive"],
  "v282.test.js": ["planning-execution"],
  "v283.test.js": ["content-ai", "sync-storage", "ui-responsive"],
  "v284.test.js": ["sync-storage", "journal-health", "planning-execution", "ui-responsive"],
  "v285.test.js": ["content-ai", "sync-storage", "planning-execution", "ui-responsive"],
  "v286.test.js": ["content-ai", "ui-responsive"],
  "v287.test.js": ["content-ai", "planning-execution", "ui-responsive"],
  "v288.test.js": ["sync-storage", "planning-execution", "ui-responsive"],
  "track-crud-core.test.js": ["planning-execution", "sync-storage"],
  // A3-H1修正フェーズ単位2レビューFAIL是正: 先頭要約コメントの2行目が空スペーサー行のため
  // domainRules正規表現が本文(backup/localStorage等)まで届かず自動分類がlegacy-crosscuttingへ
  // 落ちていた(suite-manifest.test.js:34の「製品E2Eは明示domainへ分類」に違反)。normalizeState/
  // local.jsのstorage層を対象とするtrack-normalize.test.jsと同じ語彙(sync-storage)を明示指定する。
  "normalize-null-defense.test.js": ["sync-storage"]
};

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

// 保守的な構文検査。候補の報告だけを行い、既存テストを失敗にしない。
function testPitfalls(source) {
  const warnings = { "fixed-date": [], "request-counter": [], "missing-timezone": [] };
  if (!acorn) return { ...warnings, "scan-unavailable": [1] };
  const walk = (node, visit) => {
    if (!node || typeof node.type !== "string") return;
    visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
      else if (value && typeof value === "object") walk(value, visit);
    }
  };
  const has = (node, predicate) => {
    let found = false;
    walk(node, (child) => { if (predicate(child)) found = true; });
    return found;
  };
  const name = (node) => node?.name ?? node?.value;
  const method = (node, key) => node?.type === "CallExpression"
    && node.callee.type === "MemberExpression" && name(node.callee.property) === key;
  const property = (node, key) => node.type === "Property" && name(node.key) === key;
  let tree;
  try { tree = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true }); }
  catch { return { ...warnings, "scan-unavailable": [1] }; }
  const declarations = new Map();
  walk(tree, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") declarations.set(node.id.name, node.init);
  });
  const resolves = (node, predicate, seen = new Set()) => has(node, (child) => {
    if (predicate(child)) return true;
    if (child.type !== "Identifier" || seen.has(child.name) || !declarations.has(child.name)) return false;
    seen.add(child.name);
    return resolves(declarations.get(child.name), predicate, seen);
  });
  const clockInjected = has(tree, (node) => property(node, "now")
    || (method(node, "install") && (name(node.callee.object) === "clock" || name(node.callee.object?.property) === "clock")));
  const fixedDate = (node) => node.type === "Literal" && typeof node.value === "string"
    && /20\d\d-\d\d-\d\d/.test(node.value);
  const requestWait = (node) => method(node, "waitForRequest");
  walk(tree, (node) => {
    const dateCall = node.type === "NewExpression" && name(node.callee) === "Date";
    const utcCall = method(node, "UTC") && name(node.callee.object) === "Date";
    if (!clockInjected && ((dateCall && node.arguments.some((arg) => resolves(arg, fixedDate)))
      || (utcCall && (resolves(node, fixedDate) || /^20\d\d$/.test(String(node.arguments[0]?.value))))
      || (property(node, "generatedAt") && resolves(node.value, fixedDate)))) {
      warnings["fixed-date"].push(node.loc.start.line);
    }
    if (method(node, "newContext") && !node.arguments.some((arg) => resolves(arg, (child) =>
      property(child, "timezoneId") || method(child, "defaultContextOptions")
      || (child.type === "CallExpression" && name(child.callee) === "defaultContextOptions")))) {
      warnings["missing-timezone"].push(node.loc.start.line);
    }
    if (node.type !== "BlockStatement" && node.type !== "Program") return;
    node.body.forEach((statement, index) => {
      // await page.waitForRequest(...) と、保存したPromiseの await の両方を扱う。
      if (!has(statement, requestWait) && !has(statement, (child) => child.type === "AwaitExpression"
        && resolves(child.argument, requestWait))) return;
      const next = node.body[index + 1];
      const reads = next?.type === "VariableDeclaration" ? next.declarations.map((d) => d.init)
        : next?.expression?.type === "AssignmentExpression" ? [next.expression.right] : [];
      if (reads.some((read) => read && ["Identifier", "MemberExpression"].includes(read.type))) {
        warnings["request-counter"].push(next.loc.start.line);
      }
    });
  });
  return Object.fromEntries(Object.entries(warnings).map(([key, lines]) => [key, [...new Set(lines)].sort((a, b) => a - b)]));
}

function generatePitfallReport(files) {
  const rows = [];
  for (const file of files) {
    const warnings = testPitfalls(fs.readFileSync(path.join(testsDir, file), "utf8"));
    for (const [kind, lines] of Object.entries(warnings)) {
      if (lines.length) rows.push({ file, kind, lines });
    }
  }
  const total = rows.reduce((sum, row) => sum + row.lines.length, 0);
  if (checkMode) console.warn(`WARN: test pitfalls ${total} candidates in ${new Set(rows.map((r) => r.file)).size} files (advisory; see docs/test-impact-map.generated.md)`);
  return `\n## Test pitfall warnings (advisory)\n\n`
    + `警告候補 ${total} 件 / ${new Set(rows.map((r) => r.file)).size} ファイル。警告自体は終了コードに影響しない。\n\n`
    + `fixed-date: 時計注入のない固定日付、request-counter: 通信開始待ち直後の基準値読み取り、missing-timezone: 地域未指定。\n`
    + `構文上の候補であり、変数解決は同名宣言の最後を使う簡易検査。別ファイルの設定や時計注入先の対応は追跡しない。scan-unavailable は構文解析不可。\n\n`
    + `| Warning | Count | File | Lines |\n|---|---:|---|---|\n`
    + rows.map((r) => `| ${r.kind} | ${r.lines.length} | tests/${r.file} | ${r.lines.join(", ")} |`).join("\n") + "\n";
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
    kind: (["feedback-input-e2e.test.js", "feedback-lifecycle-e2e.test.js", "feedback-recovery-e2e.test.js", "feedback-canonical-e2e.test.js"].includes(file) || /launchChromium|playwright-core|chromium\.launch/.test(source)) ? "e2e" : "node",
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
      browser: ["feedback-input-e2e.test.js", "feedback-lifecycle-e2e.test.js", "feedback-recovery-e2e.test.js", "feedback-canonical-e2e.test.js"].includes(file) || /launchChromium|playwright-core|chromium\.launch/.test(source),
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
// Reject invalid classification before either checking or writing generated artifacts.
const unclassifiedE2E = manifest.suites.filter((suite) =>
  suite.kind === "e2e" && suite.domains.includes("legacy-crosscutting"));
if (unclassifiedE2E.length) {
  console.error(`INVALID: 製品E2Eは明示domainへ分類: ${unclassifiedE2E.map((suite) => suite.file).join(", ")}`);
  process.exit(1);
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const impactRows = manifest.suites.map((suite) =>
  `| ${suite.file} | ${suite.kind} | ${suite.tier} | ${suite.domains.join(", ")} | ${suite.assertionSignals} | ${suite.waits.fixedCount} | ${suite.waits.numericMilliseconds} |`
);
const impactText = `<!-- generated by scripts/test-manifest.js; edit the generator/rules instead -->\n`
  + `# Test impact map\n\n`
  + `| Suite | Kind | Tier | Domains | Assertion signals | Fixed waits | Numeric wait ms |\n`
  + `|---|---|---|---|---:|---:|---:|\n${impactRows.join("\n")}\n`
  + generateAreaSuiteMap(manifest.suites)
  + generatePitfallReport(files);

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
