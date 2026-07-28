const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const script = path.join(repoRoot, "scripts", "release-record.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskchute-release-record-"));
const manifestPath = path.join(tempDir, "v164.json");
const changesPath = path.join(tempDir, "CHANGES_v164.md");
const handoffPath = path.join(tempDir, "handoff.md");

const record = {
  version: 164,
  date: "2026-07-28",
  title: "生成テスト",
  summary: "単一記録から二つの文書を生成する。",
  changedFiles: ["app.js", "tests/v164.test.js"],
  intent: ["重複記述をなくす。"],
  changes: ["生成処理を追加した。"],
  uncertainties: ["なし"],
  reviewFocus: ["冪等性"],
  verification: ["node tests/release-record.test.js"],
  knownLimitations: ["なし"]
};

function run(mode) {
  return spawnSync(process.execPath, [script, manifestPath, mode], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_CHANGES_PATH: changesPath,
      RELEASE_HANDOFF_PATH: handoffPath
    }
  });
}

try {
  fs.writeFileSync(manifestPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  fs.writeFileSync(handoffPath, "# Handoff Log\n", "utf8");

  assert.strictEqual(run("--validate").status, 0, "schemaとファイル名が正しければvalidateが成功する");
  assert.notStrictEqual(run("--check").status, 0, "未生成ならcheckは失敗する");
  assert.strictEqual(run("--write").status, 0, "writeが成功する");
  assert.strictEqual(run("--check").status, 0, "生成後のcheckが成功する");

  const firstHandoff = fs.readFileSync(handoffPath, "utf8");
  assert.strictEqual((firstHandoff.match(/release-record:v164:start/g) || []).length, 1);

  record.summary = "更新後の要約。";
  fs.writeFileSync(manifestPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  assert.notStrictEqual(run("--check").status, 0, "正本更新後はcheckが失敗する");
  assert.strictEqual(run("--write").status, 0, "再生成が成功する");

  const secondHandoff = fs.readFileSync(handoffPath, "utf8");
  assert.strictEqual((secondHandoff.match(/release-record:v164:start/g) || []).length, 1, "再生成で重複しない");
  assert.ok(fs.readFileSync(changesPath, "utf8").includes("更新後の要約。"));

  fs.writeFileSync(handoffPath, "# Handoff Log\n\n## 2026-07-28 / v164\n- 手書き\n", "utf8");
  assert.notStrictEqual(run("--write").status, 0, "手書き同版があれば上書き・重複生成しない");

  record.version = 165;
  fs.writeFileSync(manifestPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  assert.notStrictEqual(run("--validate").status, 0, "ファイル名とrecord.versionの不一致を拒否する");

  console.log("PASS: release-record generation/check/idempotency");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
