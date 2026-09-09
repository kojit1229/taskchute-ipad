// Self-contained snapshot graph, fingerprints and failure injection (no browser or real mock).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('../scripts/daily-snapshot.js');
const script = path.resolve(__dirname, '../scripts/daily-snapshot.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function write(root, name, data) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}
function setup(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-snapshot-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'product'), version = path.join(temp, 'm04');
  write(source, 'src/ui/daily-parts/row.js', 'export { value } from "./helper.js";\n');
  write(source, 'src/ui/daily-parts/helper.js', 'export const value = 1;\n');
  write(source, 'src/ui/daily-parts/daily-parts.css', '.row{color:black}\n');
  write(source, 'scripts/daily-mock/adapter.js', 'import { value } from "../../src/ui/daily-parts/row.js"; export { value };\n');
  write(source, 'scripts/daily-mock/fixtures.json', '{"synthetic":true}\n');
  git(source, 'init', '--quiet');
  git(source, 'config', 'core.autocrlf', 'false');
  git(source, 'add', '.');
  // The order explicitly requires one commit in this disposable synthetic repository only.
  git(source, '-c', 'user.name=Snapshot Test', '-c', 'user.email=snapshot@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic fixture');
  write(source, 'src/ui/daily-parts/assets/icon.png', Buffer.from([137, 80, 78, 71, 0, 255]));
  write(source, 'src/ui/daily-parts/assets/font.woff2', Buffer.from([119, 79, 70, 50, 0]));
  write(source, 'src/ui/daily-parts/daily-parts.css',
    '.row{background:url("./assets/icon.png")}@font-face{font-family:mock;src:url(./assets/font.woff2)}\n');
  write(version, 'preview.html', '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src http://127.0.0.1:*/product/">' +
    '<link href="/product/src/ui/daily-parts/daily-parts.css" rel="stylesheet"><link href="./preview.css" rel="stylesheet"><script type="module" src="./preview.js"></script>');
  write(version, 'preview.js', 'import { value } from "/product/scripts/daily-mock/adapter.js";\n' +
    'export const data = await fetch("/product/scripts/daily-mock/fixtures.json").then(r => r.json());\n');
  write(version, 'preview.css', 'body{font-size:16px}\n');
  write(version, 'version.json', JSON.stringify({ status: '作成中', storage_key: 'synthetic-m04' }));
  write(version, 'coverage.md', '# 範囲\n\n既存の説明。\n');
  return { source, version };
}
function cli(fixture, ...args) {
  return spawnSync(process.execPath, [script, '--version-dir', fixture.version,
    '--source-root', fixture.source, ...args], { encoding: 'utf8', windowsHide: true });
}
function inventory(root) {
  return fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile())
    .sort().map(name => [name.replace(/\\/g, '/'), hash(fs.readFileSync(path.join(root, name)))]);
}
test('normal snapshot: closed imports, independent hashes, untracked assets and check', t => {
  const f = setup(t), before = inventory(f.version);
  const result = cli(f);
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(fs.readFileSync(path.join(f.version, 'version.json'), 'utf8'));
  assert.equal(metadata.source_mode, 'shared-ui-snapshot');
  assert.equal(metadata.source_commit, git(f.source, 'rev-parse', 'HEAD').toString().trim());
  assert.equal(metadata.source_diff_hash, hash(git(f.source, 'diff', '--binary')));
  assert.equal(metadata.applied_state, '未統合');
  assert.equal(metadata.storage_key, 'synthetic-m04');
  assert.deepEqual(metadata.files, inventory(f.version).filter(([name]) => name !== 'version.json')
    .map(([file, sha256]) => ({ path: file, sha256 })));
  assert.equal(metadata.source_manifest_hash, hash(JSON.stringify(metadata.shared_files
    .map(file => ({ path: file.source_path, sha256: file.source_sha256 })))));
  for (const file of metadata.shared_files) {
    assert.equal(file.source_sha256, hash(fs.readFileSync(path.join(f.source, file.source_path))));
    assert.equal(file.snapshot_sha256, hash(fs.readFileSync(path.join(f.version, file.snapshot_path))));
  }
  assert.ok(metadata.shared_files.some(file => file.source_path.endsWith('icon.png') && file.snapshot_path.startsWith('assets/')));
  assert.ok(metadata.shared_files.some(file => file.source_path.endsWith('font.woff2')));
  const generated = ['preview.fixed.html', 'preview.fixed.js', 'preview.fixed.css',
    ...metadata.shared_files.filter(file => /\.(js|css)$/.test(file.snapshot_path)).map(file => file.snapshot_path)];
  for (const file of generated) {
    const text = fs.readFileSync(path.join(f.version, file), 'utf8');
    assert.doesNotMatch(text, /\/product\/|http:\/\/127\.0\.0\.1/);
    for (const match of text.matchAll(/(?:from\s*|fetch\(|(?:href|src)=|url\()["']([^"']+)["']/g)) {
      const target = path.resolve(f.version, path.dirname(file), match[1]);
      assert.ok(target.startsWith(f.version + path.sep), `${file}: ${match[1]}`);
      assert.ok(fs.existsSync(target), target);
    }
  }
  for (const [name, sha256] of before.filter(([name]) => /^preview\./.test(name)))
    assert.equal(hash(fs.readFileSync(path.join(f.version, name))), sha256);
  assert.equal(cli(f, '--check').status, 0);
  const fixed = inventory(f.version);
  assert.equal(cli(f).status, 0);
  assert.deepEqual(inventory(f.version), fixed, 'repeat build is idempotent');
});
test('source changes during staging: refusal leaves no output', t => {
  const f = setup(t), before = inventory(f.version), originalWrite = fs.writeFileSync;
  let injected = false;
  fs.writeFileSync = function (file, ...args) {
    const result = originalWrite.call(this, file, ...args);
    if (!injected && String(file).includes('.daily-snapshot-')) {
      injected = true;
      originalWrite(path.join(f.source, 'src/ui/daily-parts/row.js'), 'export const changed = true;');
    }
    return result;
  };
  try { assert.throws(() => snapshot(f.version, f.source), /changed/i); }
  finally { fs.writeFileSync = originalWrite; }
  assert.equal(injected, true, 'change happens after staging starts, without timing waits');
  assert.deepEqual(inventory(f.version), before);
});
test('forbidden dependencies and unresolved references produce no output', t => {
  const f = setup(t), before = inventory(f.version);
  const forbidden = ['../../../app.js', '../../state/store.js', './storage.js', './sync.js',
    './auth.js', './assets/personal-data.png', 'https://example.invalid/production.js',
    '/product/app.js', './%2e%2e/app.js'];
  for (const reference of forbidden) {
    write(f.source, 'src/ui/daily-parts/row.js', `import "${reference}";`);
    const result = cli(f);
    assert.equal(result.status, 1, reference);
    assert.deepEqual(inventory(f.version), before);
  }
  for (const content of ['import(variable);', 'fetch(variable);', 'import(`./${variable}.js`);',
    'fetch("./ok.json" + variable);', 'import /* comment */ "../../../app.js";',
    'import { secret } /* comment */ from "../../../app.js";', 'new URL("./helper.js", externalBase);']) {
    write(f.source, 'src/ui/daily-parts/row.js', content);
    assert.equal(cli(f).status, 1, content);
    assert.deepEqual(inventory(f.version), before);
  }
});
test('HTML unquoted outside references and CSS external dependencies are rejected', t => {
  const f = setup(t);
  const html = fs.readFileSync(path.join(f.version, 'preview.html'));
  for (const suffix of ['<script src=/app.js></script>', '<base href="#">', '<img srcset="/outside.png 2x">']) {
    write(f.version, 'preview.html', html + suffix);
    const before = inventory(f.version);
    assert.equal(cli(f).status, 1, suffix);
    assert.deepEqual(inventory(f.version), before);
  }
  write(f.version, 'preview.html', html);
  write(f.version, 'preview.css', '@import "https://example.invalid/production.css";');
  const before = inventory(f.version);
  assert.equal(cli(f).status, 1);
  assert.deepEqual(inventory(f.version), before);
});
test('check detects source, snapshot, metadata and inventory tampering without writing', t => {
  const f = setup(t);
  assert.equal(cli(f, '--check').status, 1, 'unbuilt snapshot is not valid');
  assert.equal(cli(f).status, 0);
  for (const [root, name] of [[f.source, 'src/ui/daily-parts/assets/icon.png'],
    [f.version, 'shared/src/ui/daily-parts/row.js'], [f.version, 'preview.html'],
    [f.version, 'coverage.md']]) {
    const file = path.join(root, name), bytes = fs.readFileSync(file);
    fs.appendFileSync(file, 'changed');
    const before = inventory(f.version);
    assert.equal(cli(f, '--check').status, 1, name);
    assert.deepEqual(inventory(f.version), before);
    fs.writeFileSync(file, bytes);
    assert.equal(cli(f, '--check').status, 0, name);
  }
  write(f.version, 'extra.txt', 'unexpected asset');
  assert.equal(cli(f, '--check').status, 1);
  fs.unlinkSync(path.join(f.version, 'extra.txt'));
  const file = path.join(f.version, 'version.json');
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  metadata.source_commit = '0'.repeat(40);
  write(f.version, 'version.json', JSON.stringify(metadata));
  assert.equal(cli(f, '--check').status, 1);
});
test('invalid inputs, missing metadata initialization and broken metadata refusal', t => {
  const f = setup(t), before = inventory(f.version);
  assert.equal(cli({ ...f, version: path.join(f.version, 'missing') }).status, 1);
  assert.equal(cli(f, '--unknown').status, 1);
  assert.deepEqual(inventory(f.version), before);
  for (const invalid of ['{broken', 'null', '[]']) {
    write(f.version, 'version.json', invalid);
    const broken = inventory(f.version);
    assert.equal(cli(f).status, 1);
    assert.deepEqual(inventory(f.version), broken);
  }
  fs.unlinkSync(path.join(f.version, 'version.json'));
  fs.unlinkSync(path.join(f.version, 'coverage.md'));
  assert.equal(cli(f).status, 0);
  assert.equal(cli(f, '--check').status, 0);
});
