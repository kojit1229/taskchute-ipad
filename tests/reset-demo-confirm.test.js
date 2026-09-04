// remediation unit1 (S4-1): resetDemoData() に window.confirm を追加した安全確認テスト。
// キャンセル時(confirm=false)は setState/saveAndRender が一切呼ばれず状態が不変であること、
// OK時(confirm=true)は従来どおり setState(normalizeState(seedState())) → saveAndRender が
// 呼ばれることを、実関数のソースをVMサンドボックスへ抽出して検証する(実DOM/ブラウザ不要)。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}
function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source markerが見つかりません: ${startMarker}`);
  return source.slice(start, end);
}

(async () => {
  console.log("[1] resetDemoData() の confirm ガード");
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const fnSource = sourceBetween(appSource, "function resetDemoData() {", "function isIOSDevice() {");

  check("app.js内にwindow.confirmを伴うresetDemoData()が存在する",
    /function resetDemoData\(\) \{\s*if \(!window\.confirm\(/.test(fnSource), fnSource.slice(0, 120));

  function makeSandbox(confirmResult) {
    const sandbox = {
      calls: [],
      confirmResult,
      window: { confirm: (message) => { sandbox.calls.push(["confirm", message]); return sandbox.confirmResult; } },
      normalizeState: (value) => { sandbox.calls.push(["normalizeState", value]); return { normalized: true, from: value }; },
      seedState: () => { sandbox.calls.push(["seedState"]); return { seeded: true }; },
      setState: (value) => { sandbox.calls.push(["setState", value]); },
      saveAndRender: (message) => { sandbox.calls.push(["saveAndRender", message]); }
    };
    vm.createContext(sandbox);
    vm.runInContext(fnSource, sandbox);
    return sandbox;
  }

  // 負例: キャンセル(confirm=false)では setState/saveAndRender が一切呼ばれない
  const cancelled = makeSandbox(false);
  cancelled.resetDemoData();
  check("confirm=falseはconfirm呼び出しのみで中断する(1件のみ)", cancelled.calls.length === 1
    && cancelled.calls[0][0] === "confirm", JSON.stringify(cancelled.calls));
  check("confirm=falseではsetState/seedState/normalizeState/saveAndRenderが呼ばれない",
    !cancelled.calls.some((call) => call[0] !== "confirm"), JSON.stringify(cancelled.calls));

  // 正例: OK(confirm=true)では従来どおり setState(normalizeState(seedState())) → saveAndRender
  const confirmed = makeSandbox(true);
  confirmed.resetDemoData();
  const order = confirmed.calls.map((call) => call[0]);
  check("confirm=trueは confirm → seedState → normalizeState → setState → saveAndRender の順で呼ばれる",
    JSON.stringify(order) === JSON.stringify(["confirm", "seedState", "normalizeState", "setState", "saveAndRender"]),
    JSON.stringify(order));
  const setStateCall = confirmed.calls.find((call) => call[0] === "setState");
  check("setStateにはnormalizeState(seedState())の戻り値がそのまま渡る",
    setStateCall && setStateCall[1] && setStateCall[1].normalized === true
    && setStateCall[1].from && setStateCall[1].from.seeded === true, JSON.stringify(setStateCall));
  check("saveAndRenderには従来どおりのトースト文言が渡る",
    confirmed.calls.find((call) => call[0] === "saveAndRender")?.[1] === "デモデータに戻しました");

  console.log(failures === 0 ? "\nreset-demo-confirm: 全件成功" : `\nreset-demo-confirm: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
