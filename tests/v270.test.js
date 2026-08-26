// v270: DEPARTURES削除と、共有ARRIVALS経路・負方向回帰テストの残存を静的に固定する。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const appSource = read("app.js");
const towerSource = read("src/features/today-tower.js");
const stylesSource = read("styles.css");
const swSource = read("sw.js");
const actionTestSource = read("tests/action-registry-core.test.js");
const actionTestCode = actionTestSource.replace(/\/\/.*$/gm, "");
const towerTestSource = read("tests/tower-core.test.js");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

console.log("[1] DEPARTURESの描画・action・専用CSS・専用helperを除去する");
check("today-towerからDEPARTURES描画と明日便組み立てを除去",
  !/DEPARTURES|tower-departures|departures-open-tomorrow|departureSummary|firstDeparture/.test(towerSource));
check("app.jsから明日便actionを除去", !appSource.includes("departures-open-tomorrow"));
check("専用CSSを除去", !stylesSource.includes("tower-departures"));
check("削除起点で未使用になったlocalISOを除去", !/function\s+localISO\s*\(/.test(towerSource));

console.log("[2] ARRIVALS共有経路と周辺構造を維持する");
const boardFlightsReferences = towerSource.match(/\bboardFlights\b/g) || [];
check("共有boardFlightsは定義とARRIVALS描画・ticker参照を維持", boardFlightsReferences.length >= 3,
  `references=${boardFlightsReferences.length}`);
check("renderTowerBoardはARRIVALSだけを受け取る", /function renderTowerBoard\(arrivalFlights\)/.test(towerSource)
  && towerSource.includes("renderTowerBoard(flights)"));
check("ARRIVALS・FLIGHT LOG・GATEの描画呼び出しを維持",
  towerSource.includes("${renderTowerBoard(flights)}")
  && towerSource.includes("${renderFlightLog(today, blocks)}")
  && towerSource.includes("renderTowerGates(blocks)"));

console.log("[3] 影響テストは旧正期待を除き、負方向と周辺順序を固定する");
check("actionゴールデンから旧actionを除去", !actionTestCode.includes("departures-open-tomorrow"));
// 注: 以下のcheck名文字列への結合はtower-core側の負方向テスト削除を抑止するtripwireであり、文言の仕様固定ではない。
// tower-core側のチェック名を意図的に変更する場合は本ファイルの期待文字列も同時に更新すること。
check("tower-coreに負方向の実DOM検証を残す",
  towerTestSource.includes("DEPARTURES要素・旧action・明日便タイトルを描画しない")
  && towerTestSource.includes("Block 0件でもDEPARTURESは復活しない"));
check("tower-coreに周辺セクションの表示・順序検証を残す",
  towerTestSource.includes("左列はNOW LANDING→ARRIVALS→FLIGHT LOG順を維持")
  && towerTestSource.includes("NOW→ARRIVALS→GATE→FLIGHT LOG→ATIS→JOURNAL→STANDING ORDERS→COUNTDOWN順"));
check("旧DEPARTURES正期待を残さない",
  !towerTestSource.includes("DEPARTURESは1行だけ")
  && !towerTestSource.includes("タップでview=tasksかつselectedDate=明日")
  && !towerTestSource.includes("明日0便は空メッセージの1行"));

console.log("[4] Service Worker版をv270へ更新する");
check("CACHE_NAMEはv270", /const CACHE_NAME = "taskchute-journal-pwa-v270";/.test(swSource));

console.log(failures === 0 ? "\n✅ v270 ALL PASS" : `\n❌ v270: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
