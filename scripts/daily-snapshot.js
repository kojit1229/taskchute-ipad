'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const ordered = map => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const asset = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;
const forbidden = /(?:^|\/)(?:app|state|store|storage|sync|auth[^/]*|firebase[^/]*|production|personal[^/]*)(?:[./-]|$)/i;
function safe(root, relative) {
  if (!relative || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')))
    throw new Error(`Unsafe path: ${relative}`);
  let file = root;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Symlink refused: ${file}`);
  }
  return file;
}
function inventory(root, prefix = '', files = new Map()) {
  for (const entry of fs.readdirSync(prefix ? safe(root, prefix.slice(0, -1)) : root, { withFileTypes: true })) {
    const name = prefix + entry.name, file = safe(root, name);
    if (entry.isDirectory()) inventory(root, name + '/', files);
    else if (entry.isFile()) files.set(name, fs.readFileSync(file));
    else throw new Error(`Unsupported file: ${name}`);
  }
  return files;
}
function snapshot(versionDir, sourceRoot, check = false) {
  if (!path.isAbsolute(versionDir) || !path.isAbsolute(sourceRoot)) throw new Error('Absolute directories required');
  const version = fs.realpathSync(versionDir), source = fs.realpathSync(sourceRoot);
  if (version === source || version.startsWith(source + path.sep) || source.startsWith(version + path.sep)) throw new Error('Separate roots required');
  const original = inventory(version), inputs = new Map(), output = new Map(), shared = new Map();
  const metadata = original.has('version.json') ? JSON.parse(original.get('version.json').toString('utf8')) : {};
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Invalid version.json');
  const git = (...args) => execFileSync('git', args, { cwd: source, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const commit = git('rev-parse', 'HEAD').toString('utf8').trim(), diff = sha(git('diff', '--binary'));
  const allowed = name => !forbidden.test(name) && (/^src\/ui\/daily-parts\/[\w-]+\.js$/.test(name)
    || name === 'src/ui/daily-parts/daily-parts.css' || /^scripts\/daily-mock\/[\w-]+\.(js|json)$/.test(name)
    || /^(?:src\/ui\/daily-parts|scripts\/daily-mock)\/assets\/[\w/.-]+$/.test(name) && asset.test(name));
  function visit(name, product) {
    if (product ? !allowed(name) : !/^preview\.(html|js|css)$/.test(name) && !(name.startsWith('assets/') && asset.test(name)))
      throw new Error(`Forbidden dependency: ${name}`);
    const destination = product ? `${asset.test(name) ? 'assets' : 'shared'}/${name}` : name.replace(/^preview\./, 'preview.fixed.');
    if (output.has(destination)) return destination;
    const file = safe(product ? source : version, name), bytes = fs.readFileSync(file);
    inputs.set(file, sha(bytes));
    output.set(destination, bytes); // Reserve before recursion, including cyclic module imports.
    if (/\.(html|js|css)$/.test(name)) {
      let text = bytes.toString('utf8');
      if (/\.(js|css)$/.test(name)) text = text.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\//g,
        (_, quoted) => quoted || ' ');
      if (name.endsWith('.html')) text = text.replace(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\'; font-src \'self\'; base-uri \'none\'; form-action \'none\'">');
      const reference = raw => {
        if (raw.startsWith('#')) return raw;
        if (!raw || /[\\%?#\s]|\$\{|^[a-z]+:/i.test(raw)) throw new Error(`Unresolved reference: ${raw}`);
        const isProduct = raw.startsWith('/product/') || product;
        if (raw.startsWith('/') && !raw.startsWith('/product/')) throw new Error(`Outside reference: ${raw}`);
        if (!raw.startsWith('/') && !raw.startsWith('.')) throw new Error(`Bare reference: ${raw}`);
        const target = raw.startsWith('/product/') ? raw.slice(9) : path.posix.normalize(path.posix.join(path.posix.dirname(name), raw));
        const copied = visit(target, isProduct);
        const relative = path.posix.relative(path.posix.dirname(destination), copied);
        return relative.startsWith('.') ? relative : './' + relative;
      };
      // Only static dependencies are supported; dynamic paths fail closed instead of escaping the graph.
      for (const call of text.matchAll(/\b(?:import|fetch|new\s+URL)\s*\(\s*([^\n]*)/g))
        if (!/^["'`][^"'`]*["'`]\s*[,)]/.test(call[1])) throw new Error(`Dynamic dependency: ${name}`);
      for (const call of text.matchAll(/\bnew\s+URL\s*\(([^)]*)\)/g))
        if (!/^[\s]*["'`][^"'`]*["'`]\s*,\s*import\.meta\.url\s*$/.test(call[1])) throw new Error(`Dynamic URL base: ${name}`);
      text = text.replace(/(\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s*)?|\b(?:import|fetch|new\s+URL)\s*\(\s*|@import\s*|\b(?:src|href|poster)\s*=\s*|\burl\(\s*)(["'`])([^"'`]*?)\2/g,
        (_, prefix, quote, raw) => prefix + quote + reference(raw) + quote);
      text = text.replace(/(\burl\(\s*)([^\s"')]+)(\s*\))/g, (_, prefix, raw, suffix) => prefix + reference(raw) + suffix);
      if (name.endsWith('.html')) text = text.replace(/(\b(?:src|href|poster)\s*=\s*)([^\s"'`=<>]+)/g,
        (_, prefix, raw) => prefix + '"' + reference(raw) + '"');
      if (/\/product\/|\bsrcset\b|<base\b/i.test(text)) throw new Error(`Unresolved dependency: ${name}`);
      output.set(destination, Buffer.from(text));
    }
    if (product) shared.set(name, { source_path: name, snapshot_path: destination,
      source_sha256: sha(bytes), snapshot_sha256: sha(output.get(destination)) });
    return destination;
  }
  for (const ext of ['html', 'js', 'css']) visit(`preview.${ext}`, false);
  const sharedFiles = ordered(shared).map(([, value]) => value);
  const heading = '\n## 固定コピー（daily-snapshot）\n';
  const coverage = (original.get('coverage.md') || Buffer.from('# Coverage\n')).toString('utf8')
    .replace(/\n## 固定コピー（daily-snapshot）\n[\s\S]*?(?=\n## |$)/, '');
  output.set('coverage.md', Buffer.from(coverage + heading + '\n入口: preview.fixed.html（元のpreviewは作成中のまま）。\n'
    + '\n固定範囲:\n' + sharedFiles.map(file => `- ${file.source_path} → ${file.snapshot_path}`).join('\n')
    + '\n\n未接続: 本番state・保存・同期・認証。架空データ用の接続だけを含み、製品への統合・公開は未実施。\n'));
  const files = new Map([...original, ...output]);
  files.delete('version.json');
  const expected = { ...metadata, source_mode: 'shared-ui-snapshot', source_commit: commit, source_diff_hash: diff,
    shared_files: sharedFiles, source_manifest_hash: sha(JSON.stringify(sharedFiles.map(file => ({ path: file.source_path, sha256: file.source_sha256 })))),
    applied_state: '未統合', integrated_commit: null, fixed_entry: 'preview.fixed.html',
    files: ordered(files).map(([name, bytes]) => ({ path: name, sha256: sha(bytes) })) };
  const unchanged = () => {
    for (const [file, fingerprint] of inputs) if (sha(fs.readFileSync(file)) !== fingerprint) throw new Error(`Source changed: ${file}`);
    if (git('rev-parse', 'HEAD').toString('utf8').trim() !== commit || sha(git('diff', '--binary')) !== diff) throw new Error('Source git changed');
    const current = inventory(version);
    if (JSON.stringify(ordered(current).map(([p, b]) => [p, sha(b)])) !== JSON.stringify(ordered(original).map(([p, b]) => [p, sha(b)])))
      throw new Error('Version changed during copy');
  };
  if (check) {
    unchanged();
    if (JSON.stringify(metadata) !== JSON.stringify(expected) || [...output].some(([name, bytes]) => !original.get(name)?.equals(bytes)))
      throw new Error('Snapshot mismatch');
    return expected;
  }
  output.set('version.json', json(expected));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), '.daily-snapshot-'));
  try {
    for (const [name, bytes] of output) {
      const target = safe(stage, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      if (sha(fs.readFileSync(target)) !== sha(bytes)) throw new Error(`Copy mismatch: ${name}`);
    }
    unchanged(); // No destination output is published until all source hashes agree after copying.
    const published = [];
    try {
      for (const [name] of output) {
        const target = safe(version, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        published.push(name);
        fs.copyFileSync(safe(stage, name), target);
      }
    } catch (error) {
      for (const name of published.reverse()) {
        if (original.has(name)) fs.writeFileSync(safe(version, name), original.get(name));
        else fs.rmSync(safe(version, name), { force: true });
      }
      throw error;
    }
    return expected;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { snapshot };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    while (args.length) {
      const flag = args.shift();
      if (!['--version-dir', '--source-root', '--check'].includes(flag) || flag in options) throw new Error(`Invalid argument: ${flag}`);
      options[flag] = flag === '--check' ? true : args.shift();
    }
    if (!options['--version-dir'] || !options['--source-root']) throw new Error('Usage: --version-dir <absolute> --source-root <absolute> [--check]');
    const result = snapshot(options['--version-dir'], options['--source-root'], !!options['--check']);
    console.log(JSON.stringify({ checked: !!options['--check'], entry: result.fixed_entry, files: result.files.length, shared: result.shared_files.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
