// src/ui/actions.js — app.js分割・段階5-1(event dispatcherのレジストリ基盤導入、v172)。
//
// prep-stage5-dispatcher.md(2026-07-28)の案A(レジストリ方式)を実装した「器」のみ。
// click dispatcher(app.js "event:click"、data-action分岐)・submitModal/deleteFromModal
// (state.modal.typeによるif-else連鎖)を、既存のif連鎖は1行も変更せずに
// 「登録済みactionはレジストリ経由・未登録は既存if連鎖へフォールバック」という二重経路に
// するための基盤だけをここに置く。v172時点ではどのfeatureもまだ何も登録しないため、
// dispatchAction/dispatchModalSave/dispatchModalDeleteは常にfalseを返し、app.js側の
// 既存if連鎖が今までどおり全件実行される(挙動は完全に無変更)。
//
// 実際のaction分岐の移行(各featureからregisterActions({...})を呼ぶ側の実装)は
// 段階5-2以降で§2-Cのドメイン粒度に沿って1件ずつ行う(prep-stage5-dispatcher.md §7の段階案)。
// このファイル自体はstateもapp.js自身もimportしない(UI配線であり機能ロジックを持たない)。

const actionRegistry = new Map();
const modalHandlerRegistry = new Map();

// registerActions({ "action-name": (ctx) => { ... }, ... })
// ctx = { event, target, id } を渡す(design doc §5-1・リスク3: idだけでは足りない分岐が
// 多数あるため、event(stopPropagation/preventDefault)とtarget(dataset/closest)も渡す)。
// 重複登録は例外を投げる(design doc §6-1: 現状のif連鎖は同名actionが複数あっても両方が
// 黙って実行される暗黙の仕様だが、Mapへ一本化するレジストリはこの潜在バグクラスを
// 機械的に閉じる)。
function registerActions(handlers) {
  for (const name of Object.keys(handlers)) {
    if (actionRegistry.has(name)) {
      throw new Error(`registerActions: action "${name}" は既に登録済みです`);
    }
    actionRegistry.set(name, handlers[name]);
  }
}

// 登録済みならhandler(ctx)を呼んでtrueを返す。未登録ならfalse
// (呼び出し側=app.jsの既存if連鎖はfalseの場合だけフォールバック実行する)。
function dispatchAction(name, ctx) {
  const handler = actionRegistry.get(name);
  if (!handler) return false;
  handler(ctx);
  return true;
}

// submitModal/deleteFromModal用の対になる器(design doc §5、prep-stage4-routine.md §4/§9で
// 既にMust級指摘済みの循環依存対策)。state.modal.type文字列ごとに { save, delete } を登録する。
function registerModalHandler(type, handlers) {
  if (modalHandlerRegistry.has(type)) {
    throw new Error(`registerModalHandler: type "${type}" は既に登録済みです`);
  }
  modalHandlerRegistry.set(type, handlers);
}

function dispatchModalSave(type, id, fields) {
  const handler = modalHandlerRegistry.get(type);
  if (!handler?.save) return false;
  handler.save(id, fields);
  return true;
}

function dispatchModalDelete(type, id) {
  const handler = modalHandlerRegistry.get(type);
  if (!handler?.delete) return false;
  handler.delete(id);
  return true;
}

// characterization test(tests/action-registry-core.test.js)専用のデバッグ用エクスポート。
// 本番挙動には影響しない(design doc §6-1)。
function __debugActionNames() {
  return Array.from(actionRegistry.keys());
}

function __debugModalTypes() {
  return Array.from(modalHandlerRegistry.keys());
}

export {
  registerActions, dispatchAction,
  registerModalHandler, dispatchModalSave, dispatchModalDelete,
  __debugActionNames, __debugModalTypes
};
