"use strict";
// Execute the real consumer graph with synthetic state and a network-free fetch boundary.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(process.argv[2]);
const acorn = require('acorn');
const expected = { fable: 'dashboard/fund.json', codex: 'dashboard/fund-codex.json',
  status: 'dashboard/fund-codex-status.json', comparison: 'dashboard/fund-comparison.json' };
async function probe() {
  const calls = [], timers = new Set();
  const state = { settings: { github: {} }, currentView: 'fund' };
  const context = vm.createContext({ console, AbortController, navigator: { onLine: true },
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout(id) { clearTimeout(id); timers.delete(id); },
    fetch: async (url, options) => { calls.push({ url, method: options?.method }); return { ok: false, status: 404 }; }
  });
  const modules = new Map();
  async function load(file) {
    file = path.resolve(file);
    if (!file.startsWith(root + path.sep)) throw new Error('module_outside_source_root');
    if (modules.has(file)) return modules.get(file);
    let module;
    if (file === path.join(root, 'src/state/store.js')) {
      module = new vm.SyntheticModule(['state'], function () { this.setExport('state', state); }, { context });
    } else if (file === path.join(root, 'src/ui/actions.js')) {
      module = new vm.SyntheticModule(['registerActions'], function () { this.setExport('registerActions', () => {}); }, { context });
    } else {
      module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
    }
    modules.set(file, module);
    return module;
  }
  try {
    const fund = await load(path.join(root, 'src/features/fund.js'));
    await fund.link((specifier, parent) => {
      if (!specifier.startsWith('.')) throw new Error('external_module');
      return load(path.resolve(path.dirname(parent.identifier), specifier));
    });
    await fund.evaluate({ timeout: 5000 });
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const ast = acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'module' });
    const binding = ast.body.find(n => n.type === 'ImportDeclaration' && n.source.value === './src/features/fund.js');
    if (!binding?.specifiers.some(s => s.type === 'ImportSpecifier' && s.imported.name === 'configureFund' && s.local.name === 'configureFund')) throw new Error('missing_app_import');
    const setup = ast.body.filter(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.name === 'configureFund');
    if (setup.length !== 1) throw new Error('missing_app_setup');
    Object.assign(context, { configureFund: fund.namespace.configureFund,
      main: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
      escapeHTML: v => String(v ?? ''), renderHeader: () => '', renderMarkdown: () => '',
      personalDataReady: () => true, personalDataConn: () => ({ owner: 'contract-owner', repo: 'contract-repo', branch: 'contract-branch', token: 'synthetic' }),
      githubHeaders: () => ({}), render() {}, setView() {}, requestDraftLeave: () => false,
      maybeMarkAiReportRead() {}, clearPersonalDataAuthError() {}, setPersonalDataAuthError() {}
    });
    new vm.Script(app.slice(setup[0].start, setup[0].end)).runInContext(context, { timeout: 5000 });
    await fund.namespace.hydrateFundData(0);
    const contract = modules.get(path.join(root, 'src/features/fund/read-contract.js'))?.namespace.FUND_SOURCES;
    if (!contract || JSON.stringify(Object.entries(contract).sort()) !== JSON.stringify(Object.entries(expected).sort())) throw new Error('source_table_mismatch');
    const actual = calls.map(c => `${c.method} ${c.url}`).sort();
    const wanted = Object.values(expected).map(p => `GET https://api.github.com/repos/contract-owner/contract-repo/contents/taskchute/${p}?ref=contract-branch`).sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error('consumer_route_mismatch');
    console.log(JSON.stringify({ ok: true, paths: Object.values(expected).map(p => `taskchute/${p}`), calls }));
  } finally { for (const timer of timers) clearTimeout(timer); }
}
probe().catch(error => { console.error(error.message); process.exitCode = 1; });
