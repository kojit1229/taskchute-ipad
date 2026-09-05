// v53: E2Eテスト共通ヘルパ。
// アプリ本体(app.js)は無改変のままブラウザで動かし、fetch をページ内でモックして検証する。
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".md": "text/markdown", ".pdf": "application/pdf"
};

// Chromium 実行パスの解決: 環境変数 → playwright-core 既定 → /opt/pw-browsers(この開発環境)
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* 未インストールなら次へ */ }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dir = fs.readdirSync(base).find((d) => d.startsWith("chromium-"));
    if (dir) {
      const p = path.join(base, dir, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 無ければ launch の既定に任せる */ }
  return null;
}

function launchOptions() {
  const exe = resolveChrome();
  return { ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox"] };
}

// リポジトリルートを配信する使い捨て静的サーバ
// v137追加調査(2026-07-22、review.md:34と同時期にK指示で判明): CI(ubuntu-latest)で
// 全量npm test実行中にEADDRINUSEでスイートが1件クラッシュする事象を観測した(run-all.jsは
// 逐次実行かつタイムアウト/killも発生していないことをログで確認済みのため、原因はrun-all.js
// 自体の並行実行バグではない)。根本原因(OS側のTIME_WAIT相当の一過性状態が有力な仮説だが
// 断定はできていない)を問わず効く保険として、EADDRINUSE発生時に同じportへ軽くリトライする。
// PORTの採番自体はrandomPort()側(下記)でスイートごとに専用の帯へ分離しており、「単一run内で
// 異なるスイートが同じportを引く」ケースは別途ゼロ化した。ここは残りうる別要因(外部プロセス・
// カーネル側の一過性状態等)への保険であり、リトライを使い果たしたら従来どおり例外を投げて
// クラッシュする(検証の弱体化ではない。フェイルラウドの原則は維持)。
function startServer(port, mountPath = "") {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (mountPath && p.startsWith(`${mountPath}/`)) p = p.slice(mountPath.length);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("nf");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  let retries = 0;
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && retries < 5) {
      retries++;
      setTimeout(() => server.listen(port), 300 * retries);
    } else {
      throw err;
    }
  });
  server.listen(port);
  return server;
}

// v72: 個人データはGitHub Contents API(private リポジトリ)経由になり、token+個人データ
// リポジトリ(dataOwner/dataRepo)未設定の端末は起動時セットアップ画面(トークンゲート)で
// 止まるようになった。既存スイートは「設定済み」state前提のため、この2つのヘルパーで
// 影響を1箇所に吸収する:
//   (1) blockGithubApiByDefault: api.github.com への予期しない実ネットワーク呼び出しを
//       既定404で塞ぐ(個別スイートが後からより具体的な page.route を追加登録すれば、
//       Playwrightは後発ハンドラを優先するのでそちらが勝つ)。goto前、他のpage.route
//       登録より先に呼ぶこと。
//   (2) passGithubGate: 初回goto(+waitForTimeout)で永続化済みのフルstateへ
//       token/dataOwner/dataRepoを追加してreloadする(他フィールドは一切壊さない)。
//       各スイートは初回goto直後に1回呼ぶだけでよい。
const STATE_KEY = "taskchute-journal-pwa-state-v1";
const GITHUB_API_HOST = "api.github.com";

async function blockGithubApiByDefault(page) {
  await page.route((url) => url.hostname === GITHUB_API_HOST, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

async function passGithubGate(page, keyName = STATE_KEY) {
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.github.token = s.settings.github.token || "test-token-v72";
    s.settings.github.dataOwner = s.settings.github.dataOwner || "kojit1229";
    s.settings.github.dataRepo = s.settings.github.dataRepo || "personal-data";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, keyName);
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

// v93: 各スイートのPORTは従来固定値だった(同じ値を使い回すスイートも複数あり)。
// 二重実行(例: 2ターミナルで同時にnpm testを回す、CIとローカルpush前ゲートが重なる等)で
// EADDRINUSEによる偽失敗が起きるため、実行のたびにランダムなポートを払い出す。
// 個々のtests/vNN.test.jsは `const PORT = randomPort();` を呼ぶだけで、
// PORTの使い方(startServer/page.goto/page.route等)は一切変えなくてよい。
//
// v137追加調査(2026-07-22): 上記のランダム採番だけでは、全量run(88スイート前後)を
// 1回のnpm testで連続実行する際、異なるスイートが独立に同じ乱数を引く確率が誕生日の
// パラドックスにより無視できない大きさになる(約17%/run)。run-all.jsは逐次実行(前の
// スイートが完全終了するまで次を起動しない)のため、理論上は「先発が完全終了していれば
// 同じport番号を後発が引いても衝突しない」はずだが、CIで実際にEADDRINUSEが観測された
// (詳細はstartServer参照)。run-all.js自体のタイムアウト/kill処理は発生していないことを
// CIログで確認済みで、根本原因は完全には特定できていない。原因を問わず「単一run内で
// 異なるスイートが同じport番号を引く」こと自体を数学的にゼロにするため、run-all.jsが
// 各スイートへ環境変数TEST_PORT_INDEXで一意な連番(実行リスト内のindex)を渡すようにし、
// それがあればスイートごとに専用の帯(1スイートあたり10番)から決定論的に採番する
// (帯を跨がないため他スイートと絶対に重複しない)。TEST_PORT_INDEXが無い場合
// (`node tests/vNN.test.js` の単独実行等)は従来どおり完全ランダムに採番する。
//
// v140(Codexレビュー Med-4): 上記の帯は常に基底20000固定だったため、run-all.js自体を
// 複数プロセスで並行実行する(v93が本来想定していた「2ターミナルでの同時実行」シナリオ)と、
// 双方とも同じport帯を使ってしまい退行していた。run-all.js側が起動ごとにランダムな基底
// 現在は全量が100スイートを超えたため、20000〜62000の2000刻み(22通り)を選び、
// 最大200スイートまで別基底の帯が重ならない幅でTEST_PORT_BASEとして渡す。
// ここではTEST_PORT_BASEがあればそれを基底に使う(無ければ従来どおりmin=20000を基底にする)。
// 並行run同士がたまたま同じ基底を引く確率は1/22以下で、それでも衝突すればstartServer()の
// EADDRINUSEリトライで自己回復する。
// v148(UI改善計画Phase3-2、レビュー対応): 設定4群は既定closedのdetailsに格納されている
// ため、中の要素(save-github等)をclick/fillするテストは先にこのヘルパーで群を開く必要がある。
// 「データと同期」群だけ他3群と違うマーカー属性(data-settings-sync、通常のhomeFoldSection=
// data-fold-idを意図的に使わない設計。app.js側のrenderSettingsSyncGroupコメント参照)を持つため
// groupIdで分岐する。<summary>への本物のクリックで開く(.open=trueの直接代入は、ブラウザが
// 'toggle'イベントを自動発火しlocalStorageへ永続化してしまう場合があり、「stateを汚さない
// 純粋なDOM操作」という説明が事実と異なっていたため、実クリックへ統一した)。
// v151フレーク対策: summaryクリックのdetails 'toggle'イベントは非同期タスクで発火するため、
// 直後の同期render()(innerHTML差し替え)で要素がdetachされるとtoggleが失われFOLD_KEYへ
// 永続化されない。render()はFOLD_KEYからopen/closedを再構築するので、未永続のまま次のrenderが
// 走ると群はclosedへ戻る。そこで「DOMでopen かつ FOLD_KEYへ永続化済み」まで確立してから戻る。
// 注意: 本ヘルパーは既定closed(defaultOpen=false)の群を前提にしている。defaultOpen=trueの
// 群(未永続でもopenが正常系)へ使うと、初回3秒待ち+一度閉じる副作用が出るため設計を見直すこと。
async function openSettingsGroup(page, groupId) {
  const sel = groupId === "settings-sync" ? "[data-settings-sync]" : `[data-legacy-fold="${groupId}"]`;
  const el = page.locator(sel);
  if ((await el.count()) === 0) return;
  const FOLD_KEY = "taskchute-journal-home-fold-v1";
  // v358修正(B-H1/M7): settings-sync/settings-daily/settings-displayはFOLD_KEYへ書き込まれない
  // 設計。settings-syncはdata-settings-sync(app.jsのグローバルtoggleリスナーが見る
  // data-fold-idを最初から持たない)。settings-daily/settings-displayは設定一覧の行展開
  // (_settingsExpandedRowIdのin-memory管理)で、後方互換のためだけに`data-legacy-fold`属性を
  // 持つが、これはグローバルtoggleリスナーが見る`data-fold-id`とは別名の属性なので拾われない
  // (以前は同じdata-fold-id属性を共用しており、「render()がtoggleイベントより先にdetachする」
  // というタイミング依存の偶然でのみ非永続を保っていた。属性名を分けて設計上の保証にした)。
  const needsPersist = !["settings-sync", "settings-daily", "settings-display"].includes(groupId);
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const isOpen = await el.evaluate((e) => e.open);
    if (!isOpen) await el.locator("summary").first().click();
    try {
      await page.waitForFunction(
        ({ selector, key, id, persist }) => {
          const details = document.querySelector(selector);
          if (!details || details.open !== true) return false;
          if (!persist) return true;
          // app.js readFoldMap()と同じ保護(不正JSONで評価関数ごと即死させない)
          let fold;
          try { fold = JSON.parse(localStorage.getItem(key) || "{}"); } catch { fold = null; }
          return !!fold && fold[id] === true;
        },
        { selector: sel, key: FOLD_KEY, id: groupId, persist: needsPersist },
        { timeout: 3000 }
      );
      return;
    } catch (err) {
      lastError = err;
      // toggle喪失(open済みだが未永続)のままではrenderで閉じ直されるため、実クリックで
      // 一度閉じてtoggleを再発火させ、次のループで開き直す(.open直接代入は上記コメントの理由で不可)。
      const stillOpen = await el.evaluate((e) => e.open).catch(() => false);
      if (stillOpen) await el.locator("summary").first().click();
    }
  }
  const finalState = await el.evaluate((e) => e.open).catch(() => "evaluate失敗");
  const foldRaw = await page.evaluate((key) => localStorage.getItem(key), FOLD_KEY).catch(() => "取得失敗");
  throw new Error(
    `openSettingsGroup: ${groupId} をopen+永続化済みへ確立できませんでした(5回試行)。` +
    `最終DOM open=${finalState} / FOLD_KEY=${foldRaw} / 最終エラー=${String(lastError).split("\n")[0]}`
  );
}

// 廃止済みUIの背後に残るdata-action本体を、孤児掃除リリースまで回帰検証するための入口。
// 本番DOMへ導線を戻さず、documentの既存イベントデリゲーションだけを通す。
async function dispatchRegisteredAction(page, action, dataset = {}) {
  await page.evaluate(({ actionName, actionData }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    Object.assign(button.dataset, actionData, { action: actionName });
    document.body.appendChild(button);
    button.click();
    button.remove();
  }, { actionName: action, actionData: dataset });
}

// v293追随: 手動Block完了操作(toggleBlock/toggleTaskCompleteFromBlock/saveBlockFromModal/
// saveActualEntryFromModal/now-conveyor-complete委譲)の直後に身体スキャンモーダル(v129)が
// 新規発火するようになった(K裁定済みUX、releases/v293.json)。完了操作を段取りとして使う
// 既存テストの後続クリックがこのモーダル(#modalRoot)に遮られてタイムアウトするため、
// 完了操作直後に本ヘルパーを挟んで「記録せず閉じる」(body-scan-discard、×と同じ経路)で
// 片付けてから後続操作へ進む。モーダルが開いていなければ何もしない(no-op)。
// 検証の弱体化ではなく、後続操作を成立させるための操作追加であることに注意。
async function dismissBodyScanIfOpen(page) {
  const discardBtn = page.locator('.modal-close[data-action="body-scan-discard"]');
  if ((await discardBtn.count()) === 0) return;
  if (!(await discardBtn.first().isVisible().catch(() => false))) return;
  await discardBtn.first().click();
  // 閉じた#modalRootはaria-hidden=trueで非表示になるため、waitForSelectorの既定state("visible")
  // では永遠に条件成立せずtimeoutまで浪費する(実害: 閉じるまでの間にtoastの自動消滅タイマー等
  // 他の時限UIが実時間で進行してしまう)。openクラスの有無を直接見るwaitForFunctionを使う。
  await page.waitForFunction(
    () => !document.querySelector("#modalRoot")?.classList.contains("open"),
    { timeout: 5000 }
  ).catch(() => {});
}

// v296(R1b追随): 書く瞑想dailyCloseゲート(K裁定2026-08-29=案A、当日writeMeditations未保存で
// 「日報を生成」到達時に割り込む)を、dismissBodyScanIfOpenと同じ思想で機械的に片付けるヘルパー。
// ゲートが出ていなければno-op(既存テストの「即時生成される」検証意図は変えない・弱体化ではない)。
async function dismissWriteMeditationGateIfOpen(page) {
  const skipBtn = page.locator('[data-action="km-gate-skip"]');
  if ((await skipBtn.count()) === 0) return;
  if (!(await skipBtn.first().isVisible().catch(() => false))) return;
  await skipBtn.first().click();
  await page.waitForFunction(
    () => !document.querySelector("#modalRoot")?.classList.contains("open"),
    { timeout: 5000 }
  ).catch(() => {});
}

// 「日報を生成」ボタンのクリック+書く瞑想ゲート片付けをまとめた置き換え口。既存テストの
// `await page.click('[data-action="generate-report"]');` をこの呼び出しへ機械置換する
// (検証意図は不変。ゲートが出ない状況では従来どおりクリックのみ)。
async function generateReportThroughGate(page) {
  await page.click('[data-action="generate-report"]');
  await dismissWriteMeditationGateIfOpen(page);
}

function randomPort(min = 20000, max = 40000) {
  const idx = process.env.TEST_PORT_INDEX;
  if (idx !== undefined && idx !== "") {
    const i = parseInt(idx, 10);
    if (Number.isFinite(i) && i >= 0) {
      const rawBase = process.env.TEST_PORT_BASE;
      const parsedBase = rawBase !== undefined && rawBase !== "" ? parseInt(rawBase, 10) : NaN;
      const base = Number.isFinite(parsedBase) ? parsedBase : min;
      return base + i * 10;
    }
  }
  return min + Math.floor(Math.random() * (max - min));
}

module.exports = {
  chromium, ROOT, launchOptions, startServer,
  blockGithubApiByDefault, passGithubGate, GITHUB_API_HOST, STATE_KEY, randomPort,
  openSettingsGroup, dispatchRegisteredAction, dismissBodyScanIfOpen,
  dismissWriteMeditationGateIfOpen, generateReportThroughGate
};
