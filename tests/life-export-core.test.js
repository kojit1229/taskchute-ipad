// life-export-core.test.js — v316 sleep/condition等の生活記録export純粋変換・CSV契約。
// ブラウザ不要で6種別、tombstone、列順、日付順、RFC4180風エスケープを検証する。
const path = require("path");
const { pathToFileURL } = require("url");

const MODULE_PATH = path.join(__dirname, "..", "src", "core", "life-export.js");
let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

(async () => {
  const { LIFE_EXPORT_COLUMNS, exportRows, toCSV } = await import(pathToFileURL(MODULE_PATH).href);
  const state = {
    settings: {
      github: { token: "SECRET_TOKEN_V316" },
      morningEnergyLog: { "2026-09-03": 4, "2026-09-01": 2 }
    },
    condition: { logs: {
      "2026-09-02": {
        meds: true, capacity: "余裕あり", eveningMood: 3, eveningNote: "改行\nあり",
        gym: [
          { at: "2026-09-02T08:00", exercise: "スクワット", weight: 80, reps: 5, blockId: "b2" },
          { at: "2026-09-02T09:00", exercise: "削除", weight: 1, reps: 1, deleted: true }
        ]
      },
      "2026-09-01": { meds: false, gym: [{ at: "2026-09-01T07:00", exercise: "ベンチ,プレス", weight: 60, reps: 10 }] },
      "2026-08-31": { deleted: true, meds: true, gym: [] }
    } },
    sleep: { logs: {
      "2026-09-02": { bed: "23:15", wake: "06:45", sleepH: 7.5, eff: 91, deepH: 1.25, hrSleep: 52, hrvSleep: 48 },
      "2026-09-01": { bed: "", wake: "06:30", sleepH: null },
      "2026-08-31": { bed: "22:00", deleted: true }
    } },
    storeVisits: [
      { date: "2026-09-02", name: "店B", comment: "また行く" },
      { date: "2026-09-01", name: "店A", comment: "良い,店" },
      { date: "2026-08-31", name: "削除店", deleted: true }
    ],
    bodyScans: [
      { dateTime: "2026-09-02T10:00", fatigue: 3, recovery: 4, part: "肩", pomodoroBlockId: "p2" },
      { dateTime: "2026-09-01T10:00", fatigue: 1, recovery: null, part: "", pomodoroBlockId: "p1" },
      { dateTime: "2026-08-31T10:00", fatigue: 5, deleted: true }
    ],
    writeMeditations: [
      { id: "wm_2", date: "2026-09-02", discharge: [{ id: "d", text: "疲れ" }], charge: [], dischargeTalk: "深掘り", chargeTalk: "" },
      { id: "wm_1", date: "2026-09-01", discharge: [], charge: [{ id: "c", text: "散歩" }], extra: "保持" },
      { id: "wm_x", date: "2026-08-31", deleted: true }
    ]
  };
  const before = JSON.stringify(state);

  console.log("[1] 6種別の固定列・実フィールド写像・deleted除外");
  check("gym列", same(LIFE_EXPORT_COLUMNS.gym, ["date", "at", "exercise", "weight", "reps", "kg", "blockId"]));
  check("sleep列", same(LIFE_EXPORT_COLUMNS.sleep, ["date", "bedTime", "wakeTime", "sleepMin", "efficiency", "deep", "hr", "hrv"]));
  check("condition列", same(LIFE_EXPORT_COLUMNS.condition, ["date", "morningEnergy", "meds", "capacity", "eveningMood", "eveningNote"]));
  check("store列", same(LIFE_EXPORT_COLUMNS.store, ["date", "name", "note"]));
  check("bodyScan列", same(LIFE_EXPORT_COLUMNS.bodyScan, ["dateTime", "fatigue", "recovery", "part", "pomodoroBlockId"]));

  const gym = exportRows(state, "gym");
  check("gymは日付昇順・kg計算・deleted除外", gym.length === 2 && gym[0].date === "2026-09-01" && gym[0].kg === 600 && gym[1].kg === 400, JSON.stringify(gym));
  const sleep = exportRows(state, "sleep");
  check("sleepは現物フィールドを固定列へ写像しsleepMinへ変換", sleep.length === 2 && sleep[1].sleepMin === 450 && sleep[1].deep === 1.25 && sleep[1].hr === 52 && sleep[1].hrv === 48, JSON.stringify(sleep));
  check("sleepの無い値は空", sleep[0].sleepMin === "" && sleep[0].bedTime === "");
  const condition = exportRows(state, "condition");
  check("conditionは日付キー和集合・昇順・deleted日除外", same(condition.map((row) => row.date), ["2026-09-01", "2026-09-02", "2026-09-03"]), JSON.stringify(condition));
  check("conditionはmorningEnergyとfalseを保持", condition[0].morningEnergy === 2 && condition[0].meds === false);
  const store = exportRows(state, "store");
  check("storeはcommentをnoteへ写像・deleted除外", store.length === 2 && store[0].name === "店A" && store[0].note === "良い,店", JSON.stringify(store));
  const scans = exportRows(state, "bodyScan");
  check("bodyScanはdateTime昇順・nullを空へ写像", scans.length === 2 && scans[0].dateTime === "2026-09-01T10:00" && scans[0].recovery === "", JSON.stringify(scans));
  const meditations = exportRows(state, "writeMeditation");
  check("writeMeditationは日付昇順・deleted除外・元構造保持", meditations.length === 2 && meditations[0].id === "wm_1" && meditations[0].extra === "保持" && meditations[1].dischargeTalk === "深掘り", JSON.stringify(meditations));
  check("全種別にtoken混入経路なし", [gym, sleep, condition, store, scans, meditations].every((rows) => !JSON.stringify(rows).includes("SECRET_TOKEN_V316")));
  check("exportRowsはstate不変", JSON.stringify(state) === before);

  console.log("[2] CSVのBOM・CRLF・引用符/カンマ/改行エスケープ");
  const csv = toCSV([{ a: "a,b", b: 'say "hi"', c: "line1\nline2", d: null }], ["a", "b", "c", "d"]);
  check("先頭BOM", csv.charCodeAt(0) === 0xFEFF);
  check("ヘッダとの区切りはCRLF", csv.startsWith("\uFEFFa,b,c,d\r\n"));
  check("RFC4180風エスケープ", csv.slice(1) === 'a,b,c,d\r\n"a,b","say ""hi""","line1\nline2",', JSON.stringify(csv));

  console.log("[3] 0件は全kindで空配列");
  const empty = {};
  check("6種別すべて空配列", ["gym", "sleep", "condition", "store", "bodyScan", "writeMeditation"]
    .every((kind) => same(exportRows(empty, kind), [])));

  console.log(failures === 0 ? "\nlife-export-core: 全件成功" : `\nlife-export-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
