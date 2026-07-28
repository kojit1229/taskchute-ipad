"use strict";

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "app.js");
const jsonPath = path.join(root, "docs", "code-index.generated.json");
const markdownPath = path.join(root, "docs", "code-index.generated.md");
const args = process.argv.slice(2);
const writeMode = args.includes("--write");
const checkMode = args.includes("--check");

if (writeMode === checkMode) {
  console.error("使い方: node scripts/code-index.js --write|--check");
  process.exit(1);
}

const source = fs.readFileSync(appPath, "utf8");
const lines = source.split(/\r?\n/);
// v164: app.js分割・段階1でapp.js冒頭に最初のimport文が入ったため、sourceType:"script"では
// 「'import' and 'export' may appear only with 'sourceType: module'」でparseできなくなった。
// index.htmlは既に<script type="module">でapp.jsを読み込んでおり(ビルド工程なしのESM化。
// claude-review-result.md Blocker-1)、実行時の解釈と一致させるためmoduleへ変更する。
const program = acorn.parse(source, {
  ecmaVersion: "latest",
  sourceType: "module",
  locations: true,
  allowHashBang: true
});
const declarations = [];

for (const node of program.body) {
  if (node.type === "FunctionDeclaration" && node.id) {
    declarations.push({ name: node.id.name, node });
    continue;
  }
  if (node.type !== "VariableDeclaration") continue;
  for (const declaration of node.declarations) {
    if (
      declaration.id?.type === "Identifier"
      && ["ArrowFunctionExpression", "FunctionExpression"].includes(declaration.init?.type)
    ) {
      declarations.push({ name: declaration.id.name, node: declaration.init });
    }
  }
}
for (const node of program.body) {
  if (node.type !== "ExpressionStatement" || node.expression?.type !== "CallExpression") continue;
  const call = node.expression;
  const callee = call.callee;
  const propertyName = callee?.type === "MemberExpression"
    ? (callee.computed ? callee.property?.value : callee.property?.name)
    : null;
  const eventName = call.arguments[0]?.type === "Literal" ? call.arguments[0].value : null;
  const callback = call.arguments[1];
  if (
    propertyName === "addEventListener"
    && typeof eventName === "string"
    && ["ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type)
  ) {
    declarations.push({
      name: `event:${eventName}@${node.loc.start.line}`,
      node: callback,
      startLine: node.loc.start.line,
      kind: "event-listener"
    });
  }
}
declarations.sort((left, right) =>
  (left.startLine || left.node.loc.start.line) - (right.startLine || right.node.loc.start.line)
);

// 独立レビュー Must-2 対応: 旧実装は「関数名+本文全文」に対して正規表現を先勝ちで当てていたため、
// 本文中の `.push(`(Array.prototype.push)や汎用語(merge等)を誤ってsyncと判定していた
// (area="sync"の228関数中100関数が誤判定、43.9%)。
// 新実装は判定対象を「関数名 + 実際に呼び出している識別子(CallExpression/NewExpressionの
// callee)」だけに絞る。MemberExpression経由の呼び出し(`arr.push(...)`、`Math.max(...)`等の
// 組み込みメソッド呼び出し)はcallee.typeが"MemberExpression"になるため、Identifier呼び出し
// だけを集めるこの実装では構造的に除外される。
// area は単一値ではなく配列(1関数が複数areaに属せる)。該当areaが無ければ["core"]。
const AREA_RULES = [
  ["sync", /github|sync|fetch/i],
  ["state", /normalize|state|persist|save|load|migration/i],
  ["execution", /timeline|block|schedule|pomodoro|triage|routine|chain/i],
  ["journal-health", /journal|sleep|health|battery|energy|weekly|cycle/i],
  ["ui", /render|modal|toast|nav|view|ui/i],
  ["content", /wish|avoid|vision|question|theme|feedback|report/i]
];
// mergeById/mergeByIdPreferNewer等の「merge系純粋関数」はGitHub同期の道具として使われるが、
// それ自体は同期I/Oを一切持たないためsyncから外しcore(該当areaなし)側へ倒す
// (独立レビュー Must-2 修正案1)。したがって上記ルールに汎用語の"merge"は含めない。
// computeSyncMerge/applySyncMergeToLocal等、同期の本体自体は関数名に"sync"を含むため
// 上のsyncルールで引き続き捕捉できる。

function collectCalleeNames(fnNode) {
  const names = new Set();
  const visited = new Set();
  (function walk(node) {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    if (typeof node.type !== "string") return;
    visited.add(node);
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      if (node.callee?.type === "Identifier") names.add(node.callee.name);
      // MemberExpression callee(`obj.method()`)は組み込み/汎用メソッド呼び出しなので除外する。
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  })(fnNode);
  return names;
}

function areaFor(name, calleeNames) {
  const value = `${name} ${[...calleeNames].join(" ")}`;
  const areas = AREA_RULES.filter(([, pattern]) => pattern.test(value)).map(([area]) => area);
  return areas.length ? areas : ["core"];
}

function effectNames(body) {
  const checks = {
    fetch: /\bfetch\(|fetchGitHub|fetchPersonalData/,
    localStorage: /localStorage\./,
    save: /\bsaveState\(|persistLocalNoSchedule|saveAndRender/,
    render: /\brender\(|renderMain|innerHTML\s*=/,
    timer: /setTimeout|setInterval/,
    dom: /document\.|querySelector|createElement/,
    clock: /new Date\(|Date\.now\(/,
    file: /FileReader|Blob|download/
  };
  return Object.entries(checks).filter(([, pattern]) => pattern.test(body)).map(([name]) => name);
}

const functions = declarations.map((declaration) => {
  const startLine = declaration.startLine || declaration.node.loc.start.line;
  const endLine = declaration.node.loc.end.line;
  const body = source.slice(declaration.node.start, declaration.node.end);
  const stateKeys = [...body.matchAll(/\bstate(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1]);
  const calleeNames = collectCalleeNames(declaration.node);
  return {
    name: declaration.name,
    kind: declaration.kind || "function",
    startLine,
    endLine,
    lines: endLine - startLine + 1,
    area: areaFor(declaration.name, calleeNames),
    stateKeys: [...new Set(stateKeys)].sort(),
    effects: effectNames(body)
  };
});

const index = {
  schemaVersion: 2, // v2: areaが単一文字列から配列へ変更(独立レビュー Must-2)
  generatedBy: "scripts/code-index.js",
  parser: `acorn@${require("acorn/package.json").version}`,
  source: "app.js",
  sourceLines: lines.length,
  functions
};
const jsonText = `${JSON.stringify(index, null, 2)}\n`;
const rows = functions.map((fn) => {
  const keys = fn.stateKeys.length > 8
    ? `${fn.stateKeys.slice(0, 8).join(", ")} +${fn.stateKeys.length - 8}`
    : fn.stateKeys.join(", ");
  return `| ${fn.name} | ${fn.kind} | ${fn.startLine} | ${fn.lines} | ${fn.area.join(", ")} | ${keys || "-"} | ${fn.effects.join(", ") || "-"} |`;
});
const markdownText = `<!-- generated by scripts/code-index.js; edit app.js or the generator instead -->\n`
  + `# Code index\n\n`
  + `Source: app.js (${lines.length} lines, ${functions.length} top-level functions)\n\n`
  + `| Entry | Kind | Line | Lines | Area hint | State-key signals | Effect signals |\n`
  + `|---|---|---:|---:|---|---|---|\n${rows.join("\n")}\n`;

if (checkMode) {
  const currentJson = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "";
  const currentMarkdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf8") : "";
  if (currentJson !== jsonText || currentMarkdown !== markdownText) {
    console.error("OUTDATED: code-index.generated.json または code-index.generated.md");
    process.exit(1);
  }
  console.log(`PASS: code index ${functions.length} functions`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, jsonText, "utf8");
fs.writeFileSync(markdownPath, markdownText, "utf8");
console.log(`WROTE: code index ${functions.length} functions`);
