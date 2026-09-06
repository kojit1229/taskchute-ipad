import { createKaradaImport } from "../core/karada-import.js";
import { utcTime } from "../core/karada-contract.js";
let controller, escapeHTML, pollTimer, lastCheck = 0;
const waiting = ["sending", "checking", "waiting", "processing", "refreshing"];
const messages = {
  idle: "", disconnected: "設定で個人データの接続を確認してください。", checking: "依頼状態を確認中",
  sending: "送信中", waiting: "受付：PCからの応答待ち", processing: "処理中", refreshing: "取り込み完了：画面を更新中",
  success: "取り込み・画面更新が完了しました", no_data: "新しいデータなし。iPhoneの出力とiCloud同期を確認してください。",
  failed: "取り込みに失敗しました。接続やPCの設定を確認して再度依頼してください。",
  read_failed: "依頼状態を確認できません。接続を確認して再確認してください。",
  update_failed: "取り込みは成功しましたが、画面の更新に失敗しました。再確認してください。"
};
function contents() {
  const s = controller.snapshot();
  const retry = ["read_failed", "update_failed"].includes(s.phase);
  const disabled = s.busy || waiting.includes(s.phase) || s.phase === "disconnected";
  const wait = s.waited >= 600000 && ["waiting", "processing"].includes(s.phase)
    ? "PCの電源・通信・初回設定を確認してください。応答を待っています。" : "";
  return `<button class="btn" type="button" data-action="${retry ? "karada-recheck" : "karada-import"}" ${disabled ? "disabled" : ""}>${retry ? "再確認" : "今すぐ取り込む"}</button>
    <span role="status">${escapeHTML(messages[s.phase] || "")} ${escapeHTML(wait)}</span>
    <small>開始は目安約5分。混雑やPCの状態で遅れます。iPhoneのロック解除・ウィジェット出力は手動で行ってください。</small>
    <small>最終成功：${escapeHTML(s.lastSuccessfulAt ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(utcTime(s.lastSuccessfulAt))) : "記録なし")} ／ データ日：${escapeHTML(s.dataThrough || "未確認")}</small>`;
}
function patch() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-karada-import]").forEach(node => { node.innerHTML = contents(); });
}
export function configureKaradaImport(deps) {
  escapeHTML = deps.escapeHTML;
  controller = createKaradaImport({ ...deps, notify: patch, refresh: deps.renderDeferringForFocus });
  deps.registerActions({ "karada-import": () => controller.submit(), "karada-recheck": () => controller.restore() });
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    const phase = controller.snapshot().phase;
    if (document.visibilityState === "visible" && ["waiting", "processing", "read_failed"].includes(phase)) controller.restore();
  }, 15000);
}
export function invalidateKaradaImport() {
  if (!controller) return;
  lastCheck = 0;
  controller.snapshot();
  patch();
}
export function karadaImportHTML() {
  if (!controller) return "";
  if (controller.snapshot().phase === "idle" && Date.now() - lastCheck > 15000) {
    lastCheck = Date.now(); queueMicrotask(() => controller.restore());
  }
  return `<div class="karada-import" data-karada-import>${contents()}</div>`;
}
