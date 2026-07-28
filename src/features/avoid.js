// src/features/avoid.js — app.js分割・段階2(Avoid List読み取り専用renderの抽出)。
// 独立レビュー claude-review-result.md §7 の抽出順(0 SW → 1 純粋関数 → 2 Avoid List →
// 3 storage/sync gateway → 4 残りのrender → 5 dispatcher)のうち段階2にあたる。
//
// 監督者裁定(prep-stage2-avoid.mdの案からの変更点): 移すのはrender系関数のみ。
// addAvoid/deleteAvoid/updateAvoidTextはstate書き込み+保存系ヘルパー(saveAndRender/
// saveState/showToast)への依存が濃い操作系のため、dispatcher整理を行う段階(§7の段階5)まで
// app.js側に残す。今回はrenderAvoidの1関数のみを抽出する。
//
// 契約:
//   1. このファイルはstateもapp.js自身もimportしない(循環import回避)。呼び出し側(app.js)が
//      renderAvoid(state, escapeHTML, renderHeader) のように必要な値を全て引数で渡す。
//      renderHeaderはapp.js側の関数参照をそのまま渡すだけでよい(呼び出し時にapp.js側の
//      モジュールスコープ変数stateへ正しくアクセスできる。JSのクロージャは呼び出し元では
//      なく定義元のレキシカルスコープを保持するため)。
//   2. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js:6805-6844 (renderAvoid)。ロジックは一切変更していない(移動+引数化のみ)。
// characterization test: tests/avoid-core.test.js。
//
// v173: app.js分割・段階5-2(prep-stage5-dispatcher.md案A)。click dispatcherの
// "add-avoid"/"delete-avoid"分岐をレジストリへ移行する。addAvoid/deleteAvoid本体は上記の
// 監督者裁定どおりapp.js残留のままのため、configureAvoid(deps)で関数参照だけを受け取り、
// dispatcher登録(registerActions)だけをここで行う(ロジック無改変、呼び出し先の切替のみ)。

import { registerActions } from "../ui/actions.js";

let addAvoid, deleteAvoid;

function configureAvoid(deps) {
  ({ addAvoid, deleteAvoid } = deps);
  registerActions({
    "add-avoid": () => addAvoid(),
    "delete-avoid": (ctx) => deleteAvoid(ctx.id)
  });
}

function renderAvoid(state, escapeHTML, renderHeader) {
  const items = state.settings.avoidList || [];
  return `
    ${renderHeader("時間とエネルギーを守る", "やらないこと")}
    <section class="panel" style="margin-bottom:12px">
      <div class="muted" style="font-size:13px; line-height:1.6">
        やりたいことを増やす前に、<strong>やらないこと</strong>を決めるほうが効きます。<br>
        ここに書いたものは「自分との約束」。SNSのだらだら閲覧、夜の暴飲暴食、断れない誘いなど。
      </div>
    </section>

    <section class="form-strip">
      <input id="avoidTitle" class="input" placeholder="やらないことを 1 行で(例: 夜のスマホ、断れない誘い)">
      <button class="btn primary" data-action="add-avoid">追加</button>
    </section>

    <section class="section grid" style="margin-top:14px">
      ${items.length === 0
        ? `<div class="panel muted" style="padding:24px; text-align:center; font-size:13px">
            まだ何も書かれていません。<br>
            「これに時間を使うのを今日からやめる」を 1〜3 個書いてみましょう。
          </div>`
        : items.map((item, idx) => `
          <div class="panel" style="display:flex; align-items:center; gap:12px; padding:10px 14px">
            <span style="color:var(--coral, #FF3B30); font-size:18px; font-weight:700">✕</span>
            <input type="text" class="input" value="${escapeHTML(item.text)}" data-avoid-id="${item.id}" data-avoid-field="text" style="flex:1; border:none; background:transparent">
            <span class="muted" style="font-size:11px; white-space:nowrap">${item.createdAt ? item.createdAt.slice(0, 10) : ""}</span>
            <button class="btn danger ghost" data-action="delete-avoid" data-id="${item.id}" title="削除">✕</button>
          </div>
        `).join("")}
    </section>

    ${items.length > 0 ? `
      <section class="panel muted" style="margin-top:14px; font-size:11px; line-height:1.6; padding:12px">
        💡 ヒント:週に1回見直して、自分との約束を守れているか確認しましょう。<br>
        破ったら自分を責めるのではなく「なぜ破ったか」を観察するのが続けるコツ。
      </section>
    ` : ""}
  `;
}

export { configureAvoid, renderAvoid };
