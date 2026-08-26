// v271: 静的センチネルは補助。主防御は実DOMを通すtower-core.test.jsであり、本スイート単独では代替しない。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const appSource = read("app.js");
const towerSource = read("src/features/today-tower.js");
const stylesSource = read("styles.css");
const swSource = read("sw.js");
const towerTestSource = read("tests/tower-core.test.js");
const maxRelease = Math.max(...fs.readdirSync(path.join(ROOT, "releases"))
  .map((file) => /^v(\d+)\.json$/.exec(file)?.[1]).filter(Boolean).map(Number));
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

console.log("[1] NOW LANDING選択は非永続UI状態で既存actionへ追従する");
check("選択値はtoday-towerのモジュール変数", towerSource.includes("let _towerArrivalSelectedId = null"));
check("候補はARRIVALS表示窓のBlock便かつ未実行3状態", towerSource.includes("arrivalWindow(flights).rows.filter")
  && towerSource.includes('["holding", "final", "resloted"].includes(flight.status)')
  && towerSource.includes('flight.kind !== "task-plan"') && towerSource.includes("!isStaleBlock("));
check("既定queue先頭と消滅時フォールバックを維持", towerSource.includes("const fallback = queueBlocksOf(blocks)[0] || null")
  && towerSource.includes("|| fallback"));
check("ラベルは時刻+タイトル", /flightTime\(flight\.plannedMin\)\}\s+\$\{escapeHTML\(flight\.title\)\}/.test(towerSource));
check("タイトル編集とnow-startは同じ選択idを使う", towerSource.includes('data-action="edit-block" data-id="${id}"')
  && towerSource.includes('data-action="now-start" data-id="${id}"'));
check("change配線はsetter+renderだけで保存しない", /if \(target\.matches\("\[data-tower-arrival-select\]"\)\) \{\s*setTowerArrivalSelection\(target\.value\);\s*render\(\);\s*\}/.test(appSource));
check("selectフォーカス中の全体renderをfocusoutまで保留", appSource.includes('document.activeElement?.matches?.("[data-tower-arrival-select]")')
  && appSource.includes("_deferredRenderPending = true"));

console.log("[2] FLIGHT LOGは既存edit-blockを使う44px button");
check("行はbutton+edit-block", /<button type="button" class="tower-log-row[\s\S]*?data-action="edit-block"/.test(towerSource));
check("buttonを閉じる", towerSource.includes("</button>`;"));
check("44px以上・buttonリセット・focus-visible", /\.tower-log-row \{[^}]*min-height: 44px;[^}]*border: 0;[^}]*font: inherit;[^}]*background: transparent;/.test(stylesSource)
  && stylesSource.includes(".tower-log-row:focus-visible"));
check("selectは16px・44px", /\.tower-arrival-select \{[^}]*min-height: 44px;[^}]*font-size: 16px;/.test(stylesSource));

console.log("[3] 回帰テストとService Worker版を更新する");
check("tower-coreは選択・保存0回・フォールバック・行タップを実DOM検証",
  towerTestSource.includes("選択操作はstate保存0回")
  && towerTestSource.includes("declare-confirm後のactualStartAtは選択Blockだけに付く")
  && towerTestSource.includes("tick窓移動でselectもw2..w12へ追従")
  && towerTestSource.includes("選択候補が削除されたら既定の次便へフォールバック")
  && towerTestSource.includes("完了済みFLIGHT LOG行タップでも対象Block編集モーダルを開く"));
check(`CACHE_NAMEはreleases最大版v${maxRelease}`, new RegExp(
  `^const CACHE_NAME = "taskchute-journal-pwa-v${maxRelease}";`, "m").test(swSource));

(async () => {
  console.log("[4] 候補選定本体を実行し、stale除外とフォールバックを検証する");
  const tower = await import(pathToFileURL(path.join(ROOT, "src", "features", "today-tower.js")).href);
  tower.configureTodayTower({
    queueBlocksOf: (blocks) => blocks.filter((item) => item.id === "fallback"),
    isStaleBlock: (block) => block?.taskId === "stale"
  });
  tower.setTowerArrivalSelection("stale-flight");
  const blocks = [{ id: "fallback", taskId: "active" }, { id: "stale-flight", taskId: "stale" }];
  const selection = tower.runwayArrivalSelection(blocks, [
    { id: "fallback", kind: "block", status: "holding" },
    { id: "stale-flight", kind: "block", status: "holding" }
  ]);
  check("実行結果はstale便を除外しfallbackを選ぶ",
    JSON.stringify(selection.candidates.map((item) => item.id)) === '["fallback"]'
      && selection.selected?.id === "fallback");
  console.log(failures === 0 ? "\n✅ v271 ALL PASS" : `\n❌ v271: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
