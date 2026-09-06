"use strict";
// Runner contracts using isolated process, filesystem and timer fixtures.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const override = process.argv.find((arg) => arg.startsWith("--runner-source="));
const source = fs.readFileSync(override ? override.slice(16) : path.join(__dirname, "run-all.js"), "utf8");
const hash = (text) => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; };
async function run(scenarios, options = {}) {
  const files = Object.keys(scenarios);
  const body = options.crlf ? "// fixture\r\n" : "// fixture\n";
  const suites = files.map((file) => ({ file, sourceHash: hash("// fixture\n"), kind: "node", tier: "full" }));
  if (options.missing) suites.pop();
  if (options.removed) suites.push({ file: "gone.test.js", sourceHash: hash(body) });
  const logs = [], timers = new Set(), children = new Map(), calls = {}, signals = {}, exits = [];
  let sync = true, kills = 0, ended; let clock = 0, timerId = 0;
  const result = new Promise((resolve) => { ended = resolve; });
  const stubProcess = {
    argv: ["node", "run-all.js", ...(options.args || ["--workers=2"])], env: {}, platform: options.windows ? "win32" : "linux",
    stdout: { write: (s) => logs.push(String(s)) }, stderr: { write: (s) => logs.push(String(s)) },
    on(name, fn) { signals[name] = fn; }, exit(code) { exits.push(code); ended({ code, logs, timers, calls, exits, get kills() { return kills; } }); if (sync) throw "fixture exit"; },
    kill(pid) { kills++; const child = children.get(Math.abs(pid)); if (child && !child.noClose) setImmediate(() => child.emit("close", null, "SIGKILL")); }
  };
  function spawn(command, args, opts) {
    if (command === 'taskkill') {
      assert.equal(opts.timeout, 15000); kills++;
      const killer = new EventEmitter(), child = children.get(Number(args[1]));
      queueMicrotask(() => {
        if (options.killFailure === 'no-close') return;
        if (options.killFailure === 'child-close') { child.emit('close', 0, null); return; }
        if (options.killFailure === 'error') { killer.emit('error', {code:'ETIMEDOUT'}); return; }
        if (!options.killFailure && !child.noClose) {
          child.stdout.emit('data', Buffer.from('late owned output'));
          child.emit('exit', null, 'SIGKILL'); child.emit('close', null, 'SIGKILL');
        }
        killer.emit('close', options.killFailure ? 1 : 0, null);
      });
      return killer;
    }
    const file = path.basename(args[0]), mode = scenarios[file];
    calls[file] = (calls[file] || 0) + 1;
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.noClose = mode === "timeout-no-close" || mode === "exit-only";
    child.pid = 100 + children.size; children.set(child.pid, child);
    queueMicrotask(() => {
      if (mode === "timeout" || mode === "timeout-no-close") return;
      if (mode === "exit-only") { child.emit("exit", 0, null); return; }
      if (mode === "delayed-close") { child.emit("exit", 0, null); setTimeout(() => child.emit("close", 0, null), 5); return; }
      if (mode === "spawn") {
        child.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
        child.emit("close", -2, null); return;
      }
      if (mode === "interrupt-then-ok") signals.SIGTERM();
      const bad = mode === "assert" || mode === "assert-long-infra" || mode === "assert-split-infra" || mode === "infra-always" || (mode === "infra-once" && calls[file] === 1);
      const signal = mode === "signal" ? "SIGTERM" : null;
      child.emit("exit", bad ? 1 : 0, signal);
      // Output deliberately arrives after exit, before close.
      if (mode.startsWith("infra") && bad) child.stderr.emit("data", Buffer.from("EADDRINUSE"));
      if (mode === "assert") child.stderr.emit("data", Buffer.from("AssertionError"));
      if (mode === "assert-long-infra") child.stderr.emit("data", Buffer.from("AssertionError: " + "x".repeat(9000) + " EADDRINUSE"));
      if (mode === "assert-split-infra") { child.stderr.emit("data", Buffer.from("Assert")); child.stderr.emit("data", Buffer.from("ionError: EADDRINUSE")); }
      child.emit("close", bad ? 1 : 0, signal);
    });
    return child;
  }
  const context = {
    __dirname: "/fixture/tests", console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
    process: stubProcess,
    require(name) {
      if (name === "fs") return { readdirSync: () => files,
        readFileSync: (p) => p.endsWith("suite-manifest.json") ? JSON.stringify({ suites }) : body + (options.changed ? "x" : "") };
      if (name === "child_process") return { spawn };
      return require(name);
    },
    setTimeout(fn, ms) {
      assert([180000, 1000, 15000].includes(ms), "only suite, drain and cleanup deadlines");
      // Distinct logical creation instants reproduce cleanup deadlines straddling a real timer tick.
      const timer = options.virtualTimers ? { fn, due: clock + ms + (++timerId) / 1000 }
        : setTimeout(() => { timers.delete(timer); fn(); }, ms === 180000 ? 500 : ms === 15000 ? 200 : 100);
      timers.add(timer); return timer;
    },
    clearTimeout(timer) { timers.delete(timer); if (!options.virtualTimers) clearTimeout(timer); }
  };
  try { vm.runInNewContext(source, context, { timeout: 1000 }); }
  catch (error) { if (error !== "fixture exit") throw error; }
  sync = false;
  if (options.virtualTimers) {
    for (let step = 0; step < 20 && !exits.length; step++) {
      await new Promise(resolve => setImmediate(resolve));
      if (exits.length) break;
      const next = [...timers].sort((a, b) => a.due - b.due)[0];
      assert(next, "virtual fixture has a pending event");
      clock = next.due; timers.delete(next); next.fn();
    }
    assert(exits.length, "virtual fixture terminates within event bound");
  }
  let watchdog;
  const answer = await Promise.race([result, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("fixture hung")), 2000); })]).finally(() => clearTimeout(watchdog));
  await new Promise((resolve) => setImmediate(resolve));
  check(answer.timers.size === 0, "suite timers cleared");
  answer.text = logs.join("\n");
  answer.summary = answer.text.slice(answer.text.lastIndexOf("❌"));
  // Calling the real runner signal handler is unnecessary: inspect its VM-owned set.
  if (Object.keys(calls).length) {
    const blocked = vm.runInNewContext("cleanupBlocked", context);
    const expectedOwned = Object.values(scenarios).includes("interrupt-then-ok") ? 0 : blocked ? 1 : 0;
    check(vm.runInNewContext("activeChildren.size", context) === expectedOwned, "ownership released only after confirmed cleanup; naturally closed interrupted child is released");
    if (blocked) check(answer.code === 1 && answer.text.includes("PROCESS CLEANUP FAILED"), "unrecovered ownership reported and runner fails");
  }
  return answer;
}
(async () => {
  for (const args of [["--list"], ["--workers=2"]]) {
    const r = await run({ "ok.test.js": "ok" }, { crlf: true, args });
    check(r.code === 0 && !r.text.includes("sourceHashが古い"), "CRLF matches generator hash in list and execution: " + r.text);
  }
  let r = await run({ "ok.test.js": "ok" }, { changed: true });
  check(r.code === 0 && r.text.includes("sourceHashが古い"), "real edit warns and continues");
  for (const option of ["missing", "removed"]) {
    r = await run({ "ok.test.js": "ok" }, { [option]: true });
    check(r.code === 1, `${option} metadata fails closed`);
  }
  for (const [mode, reason] of [["exit-only", "stdio drain timeout (exit: 0, signal: none)"], ["timeout-no-close", "timeout"], ["assert", "exit: 1"], ["spawn", "spawn error: ENOENT"], ["signal", "signal: SIGTERM"], ["timeout", "timeout"]]) {
    r = await run({ "ok.test.js": "ok", "bad.test.js": mode });
    check(r.code === 1 && r.summary.includes("1 suite(s) failed"), `${mode} counted once`);
    check(r.summary.includes(`FAIL: bad.test.js (${reason})`) && !r.summary.includes("ok.test.js"), `${mode} identified in final summary`);
    check(r.calls["bad.test.js"] === 1, `${mode} not retried`);
    if (mode === "timeout" || mode === "timeout-no-close" || mode === "exit-only") check(r.kills > 0, "timeout kills process tree");
  }
  r = await run({ "delayed.test.js": "delayed-close" });
  check(r.code === 0 && r.calls["delayed.test.js"] === 1, "delayed close succeeds within drain bound");
  r = await run({ "a.test.js": "ok", "b.test.js": "ok" });
  check(r.code === 0 && r.text.includes("All suites passed (2 suites)"), "parallel all-success count");
  r = await run({ "retry.test.js": "infra-once" });
  check(r.code === 0 && r.calls["retry.test.js"] === 2 && r.text.includes("FLAKY-INFRA"), "infra retries once after drained output");
  r = await run({ "retry.test.js": "infra-always" });
  check(r.code === 1 && r.calls["retry.test.js"] === 2 && r.summary.includes("FAIL: retry.test.js (exit: 1)"), "infra final failure retained");
  for (const options of [{}, { windows: true }, { windows: true, killFailure: true }, { windows: true, killFailure: "error" }, { windows: true, killFailure: "no-close" }]) {
    r = await run({ "a.test.js": "timeout-no-close", "z.test.js": "ok" }, { ...options, args: ["--workers=1"] });
    check(r.code === 1 && !r.calls["z.test.js"], "unconfirmed cleanup never starts next suite");
    check(r.text.includes("owned pids: 100"), "unconfirmed child remains identified");
  }
  r = await run({ "a.test.js": "timeout", "z.test.js": "ok" }, { windows: true, args: ["--workers=1"] });
  check(r.code === 1 && r.calls["z.test.js"] === 1, "confirmed Windows close permits next suite, retaining timeout failure");
  check(r.text.includes("[a.test.js pid=100 cleanup] late owned output"), "late output retains owner identity");
  for (const mode of ["assert-long-infra", "assert-split-infra"]) {
    r = await run({ "output.test.js": mode });
    check(r.code === 1 && r.calls["output.test.js"] === 1 && !r.text.includes("FLAKY-INFRA"), `${mode}: assertion classification survives chunk length and boundary`);
  }
  r = await run({ "a.test.js": "interrupt-then-ok", "z.test.js": "ok" }, { windows: true, args: ["--workers=1"] });
  check(r.exits.length > 0 && r.exits.every(code => code === 1), "SIGTERM plus natural close cannot produce exit zero through either exit path");
  check(!r.calls["z.test.js"] && !r.text.includes("All suites passed"), "interruption does not start pending suite or claim full success");
  r = await run({ "a.test.js": "timeout-no-close", "z.test.js": "ok" },
    { windows: true, killFailure: "no-close", virtualTimers: true, args: ["--workers=1"] });
  check(r.code === 1 && !r.calls["z.test.js"] && r.text.includes("owned pids: 100"),
    "staggered cleanup deadlines settle killer before exit and retain failed ownership");
  r = await run({ "a.test.js": "exit-only", "z.test.js": "ok" },
    { windows: true, killFailure: "child-close", virtualTimers: true, args: ["--workers=1"] });
  check(r.code === 1 && !r.calls["z.test.js"] && r.text.includes("stdio drain timeout"),
    "child close before killer completion does not finish exit-drain cleanup early");
  console.log(`PASS: runner result fixtures (${checks} checks)`);
})().catch((error) => { console.error(error); process.exit(1); });

