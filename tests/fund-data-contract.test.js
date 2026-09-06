"use strict";
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const { CONTRACT, runGate } = require('../scripts/data-contract-gate.js');
const fund = CONTRACT.filter(e => e.consumerProbe === 'fund');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fund-contract-'));
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; console.log(`PASS ${label}`); };
const write = (file, text) => { const p = path.join(fixture, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const run = (entries = fund, pdata = path.join(fixture, 'no-pdata')) => runGate(entries, path.join(fixture, 'no-loop'), pdata, fixture, () => {});
const probe = path.join(root, 'scripts/fund-contract-probe.js');
try {
  fs.cpSync(path.join(root, 'src/features/fund'), path.join(fixture, 'src/features/fund'), { recursive: true });
  for (const file of ['app.js', 'src/features/fund.js']) write(file, fs.readFileSync(path.join(root, file), 'utf8'));
  check(fund.length === 4 && fund.filter(e => e.optionalFile).length === 3, 'four sources, only three additions optional');
  check(fund.find(e => e.resolvedPath === 'taskchute/dashboard/fund.json').optionalFile !== true, 'legacy FABLE remains required');
  check(run().failures === 0, 'actual configured graph requests all four exact GET paths');
  check(run(fund.map(e => ({ ...e, resolvedPath: 'taskchute/dashboard/wrong.json' }))).failures === 4, 'contract table must match observed request paths');
  const pdata = path.join(fixture, 'pdata');
  write('pdata/taskchute/dashboard/fund.json', '{}');
  check(run(fund, pdata).failures === 0, 'uncreated additional sources allowed with legacy FABLE present');
  fs.unlinkSync(path.join(pdata, 'taskchute/dashboard/fund.json'));
  check(run(fund, pdata).failures === 1, 'legacy FABLE missing remains exactly one failure');
  const mutations = [
    ['src/features/fund/read-contract.js', "codex: 'dashboard/fund-codex.json'", "codex: 'dashboard/wrong.json' // dashboard/fund-codex.json\n", 'wrong source with decoy comment'],
    ['src/features/fund.js', "prefix: 'taskchute'", "prefix: 'wrong' /* prefix: 'taskchute' */", 'wrong prefix with decoy comment'],
    ['src/features/fund.js', 'return bridge.hydrate(interval);', 'return Promise.resolve(false);', 'entry hydration disconnected'],
    ['src/features/fund/controller.js', 'getConnection: connection', 'getConnection: () => ({ ready: false })', 'controller transport disconnected'],
    ['src/features/fund/workspace.js', "['fable', 'codex', 'status', 'comparison']", "['fable', 'status', 'comparison']", 'source omitted by workspace'],
    ['src/features/fund/read-gateway.js', 'read(FUND_SOURCES[source],', "read('dashboard/fund.json',", 'gateway ignores source table'],
    ['src/features/fund/read-transport.js', "method: 'GET'", "method: 'PUT'", 'write request rejected'],
    ['src/features/fund/read-transport.js', '${captured.prefix}/${path}', '${path}', 'transport prefix omitted'],
    ['app.js', 'configureFund({ root: main,', '/* configureFund({ root: main, */\nconfigureFund({ root: null,', 'actual app injection broken'],
    ['src/features/fund.js', 'export function configureFund(deps)', 'export function wrongConfigureFund(deps)', 'missing export'],
    ['src/features/fund/read-contract.js', 'export const FUND_SOURCES', 'invalid syntax ! export const FUND_SOURCES', 'malformed module']
  ];
  for (const [file, before, after, label] of mutations) {
    const original = fs.readFileSync(path.join(fixture, file), 'utf8');
    assert(original.includes(before), `mutation anchor: ${label}`);
    write(file, original.replace(before, after));
    try { check(run().failures === 4, label); } finally { write(file, original); }
  }
  for (const file of ['src/features/fund.js', 'src/features/fund/read-contract.js', 'src/features/fund/read-gateway.js', 'src/features/fund/read-transport.js', 'src/features/fund/controller.js', 'src/features/fund/workspace.js']) {
    const original = fs.readFileSync(path.join(fixture, file));
    fs.unlinkSync(path.join(fixture, file));
    try { check(run().failures === 4, `missing ${file} rejected`); } finally { write(file, original); }
  }
  for (const fields of [
    { consumerProbe: 'fund-typo' }, { consumerProbe: undefined },
    { consumerProbe: undefined, consumerSnippet: '' }, { consumerProbe: undefined, consumerSnippet: '  ' },
    { consumerProbe: undefined, consumerSnippet: 1 }, { consumerProbe: undefined, consumerSnippet: null },
    { consumerProbe: 'fund-typo', consumerSnippet: 'undefined' }
  ]) check(run(fund.map(entry => ({ ...entry, ...fields }))).failures === 4, `invalid consumer contract ${JSON.stringify(fields)} rejected`);
  // Probe process errors must never turn into a successful synchronous runGate result.
  const Module = require('module'), gateSource = fs.readFileSync(path.join(root, 'scripts/data-contract-gate.js'), 'utf8');
  for (const result of [{ status: 1, stdout: '{"ok":true}' }, { status: null, error: { code: 'ETIMEDOUT' }, stdout: '{"ok":true}' }, { status: 0, stdout: 'invalid' }, { status: 0, stdout: '{"ok":false}' }]) {
    const isolated = new Module(path.join(root, 'scripts/data-contract-gate.js'), module);
    isolated.filename = path.join(root, 'scripts/data-contract-gate.js');
    isolated.paths = module.paths;
    isolated.require = name => name === 'child_process' ? { spawnSync: () => result } : require(name);
    isolated._compile(gateSource, isolated.filename);
    check(isolated.exports.runGate(fund, path.join(fixture, 'no-loop'), path.join(fixture, 'no-data'), fixture, () => {}).failures === 4, `abnormal subprocess ${JSON.stringify(result)} rejected`);
  }
  const originalFund = fs.readFileSync(path.join(fixture, 'src/features/fund.js'), 'utf8');
  write('src/features/fund.js', originalFund.replace('bridge = createFundDOMBridge', 'while (true) {}\n  bridge = createFundDOMBridge'));
  const stuck = spawnSync(process.execPath, ['--experimental-vm-modules', probe, fixture], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  check(stuck.status !== 0 && /timed out/.test(stuck.stderr), 'real synchronous infinite loop bounded by VM timeout');
  write('src/features/fund.js', originalFund);
  const { analyzeDiff } = require('../scripts/impact-regression.js');
  const rules = require('./impact-regression-map.json');
  for (const file of ['src/features/fund.js', 'src/features/fund/read-contract.js', 'src/features/fund/read-gateway.js', 'src/features/fund/read-transport.js', 'scripts/data-contract-gate.js', 'scripts/fund-contract-probe.js']) {
    const patch = `diff --git a/${file} b/${file}\n+// neutral`;
    const impact = analyzeDiff(patch, rules, { final: file.startsWith('scripts/') });
    if (file.startsWith('scripts/')) check(impact.files.length === 0, `${file} does not trigger runtime/SW change`);
    check(['data-contract-gate', 'fund-data-contract'].every(s => impact.suites.includes(s)), `${file} selects both contract suites`);
  }
  check(['data-contract-gate', 'fund-data-contract'].every(s => analyzeDiff('', rules, { final: true }).suites.includes(s)), 'every final gate includes both contracts even without runtime changes');
} finally {
  assert.strictEqual(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert(path.basename(fixture).startsWith('tc-fund-contract-'));
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(`PASS: fund data contract (${checks} checks)`);
