// v106 検証: 同期の双方向マージ(iPhone分がPCで見えない事故対策の一般化)
// (a) 起動pull(legacy)でリモートが新しい → 採用するが、ローカル限定のジャーナル/Blockは
//     グラフトされて消えない(採用+和集合)
// (b) 起動pull(legacy)でローカルが新しい → スキップせずリモート限定のジャーナル/Block
//     (ルーティン実績)がローカルへ合流する
// (c) 同一日付のジャーナル競合は journalMeta[date].textUpdatedAt の新しい方が勝つ
// (d) autoSync ON + 両方に未反映の変更 + コア(tasks等)一致 → バナーで止めず和集合で
//     自動解消し、lastPushedAt がリモートに追いつく(push見送り解除)
// 方式: v72と同じく page.route で api.github.com を偽装し、localStorage を直接注入して観測する。
const { chromium, launchOptions, startServer, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const fixtures = { remoteJson: null, puts: [] };
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    if (u.pathname.endsWith("/contents/taskchute/app-state.json")) {
      if (method === "PUT") {
        fixtures.puts.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-after-put" } }) });
      }
      if (fixtures.remoteJson === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: Buffer.from(fixtures.remoteJson, "utf-8").toString("base64"), encoding: "base64", sha: "remote-sha-1" })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const TODAY = iso(new Date());
  const YESTERDAY = iso(new Date(Date.now() - 86400000));

  const block = (id, extra = {}) => ({
    id, taskId: "", date: TODAY, title: id, category: "ルーティン",
    plannedStartAt: `${TODAY}T06:00`, plannedEndAt: `${TODAY}T06:10`,
    actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
    expectedCharge: "", expectedDischarge: "", comment: "", recurrenceGroupId: "",
    pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false,
    source: "", createdAt: `${TODAY}T05:00`, updatedAt: `${TODAY}T05:00`, deleted: false, ...extra
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // ゲート通過(トークン設定のみ。route偽装済みなので実APIには出ない)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "test-token-v106";
      s.settings.github.dataOwner = "kojit1229";
      s.settings.github.dataRepo = "personal-data";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);

    console.log("[1] legacy起動pull: リモート新しい → 採用しつつローカル限定の記録を保持");
    await page.evaluate(({ KEY, TODAY, YESTERDAY, blockLocal }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journals = { [YESTERDAY]: "# PCにしか無い日記" };
      s.journalMeta = {};
      s.blocks = [blockLocal];
      s.dataModifiedAt = "2026-01-01T00:00";  // リモートより古い
      s.settings.autoSync = false;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, YESTERDAY, blockLocal: block("blk-local-1", { completed: true }) });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = "2026-01-02T00:00";  // ローカルより新しい
      remote.journals = { [TODAY]: "# iPhoneで書いた日記" };
      remote.journalMeta = {};
      remote.blocks = [block("blk-iphone-1", { completed: true, title: "iPhoneルーティン" })];
      fixtures.remoteJson = JSON.stringify(remote);
    }
    await page.reload();
    await page.waitForTimeout(1500);
    const s1 = await stateNow();
    check("リモートのジャーナルが取り込まれる", (s1.journals[TODAY] || "").includes("iPhone"));
    check("ローカル限定のジャーナルが消えない", (s1.journals[YESTERDAY] || "").includes("PCにしか無い"));
    check("iPhoneのルーティン実績Blockが見える", s1.blocks.some((b) => b.id === "blk-iphone-1" && b.completed));
    check("ローカル限定のBlockが消えない", s1.blocks.some((b) => b.id === "blk-local-1" && b.completed));
    check("グラフト分が未pushとして計上される", s1.dataModifiedAt > "2026-01-02T00:00");

    console.log("[2] legacy起動pull: ローカル新しい → リモート限定の記録が合流 + 日付競合はtextUpdatedAtで解決");
    await page.evaluate(({ KEY, TODAY, YESTERDAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journals[TODAY] = "# PCで編集した本文(古い)";
      s.journalMeta[TODAY] = { aiMitCandidates: [], aiImported: false, ideal: "", textUpdatedAt: `${YESTERDAY}T09:00` };
      s.dataModifiedAt = `${YESTERDAY}T12:00`;  // リモートより新しい(実時刻より過去にしないとsaveState後の比較が壊れる)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, YESTERDAY });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = `${YESTERDAY}T10:00`;  // ローカルより古い
      remote.journals = { ...base.journals, [TODAY]: "# iPhoneで後から書き直した本文", "2000-01-01": "# リモートにしか無い日記" };
      remote.journalMeta = { ...base.journalMeta, [TODAY]: { aiMitCandidates: [], aiImported: false, ideal: "", textUpdatedAt: `${YESTERDAY}T10:00` } };
      remote.blocks = [...base.blocks, block("blk-iphone-2", { completed: true })];
      fixtures.remoteJson = JSON.stringify(remote);
    }
    await page.reload();
    await page.waitForTimeout(1500);
    const s2 = await stateNow();
    check("リモート限定のジャーナルが合流する", (s2.journals["2000-01-01"] || "").includes("リモートにしか無い"));
    check("リモート限定のBlockが合流する", s2.blocks.some((b) => b.id === "blk-iphone-2"));
    check("同一日付はtextUpdatedAtが新しい方が勝つ", (s2.journals[TODAY] || "").includes("後から書き直した"));
    check("ローカルのdataModifiedAtは基準のまま古くならない", s2.dataModifiedAt >= `${YESTERDAY}T12:00`);

    console.log("[3] autoSync: 両方に未反映 + コア一致 → 和集合で自動解消(バナーなし)");
    await page.evaluate(({ KEY, YESTERDAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.autoSync = true;
      s.settings.lastPushedAt = `${YESTERDAY}T11:00`;
      s.dataModifiedAt = `${YESTERDAY}T12:00`;  // 未push変更あり(lastPushedAtより新しい)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, YESTERDAY });
    {
      const base = await stateNow();
      const remote = JSON.parse(JSON.stringify(base));
      remote.dataModifiedAt = `${YESTERDAY}T13:00`;  // ローカルよりさらに新しい(両方に未反映)
      remote.journals = { ...base.journals, "2000-01-02": "# iPhoneの朝ジャーナル" };
      remote.condition = { logs: { "2000-01-02": {
        sleepHours: 7, meds: true, capacity: "normal", morningRecordedAt: `${YESTERDAY}T12:30`,
        eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: []
      } } };
      fixtures.remoteJson = JSON.stringify(remote);
    }
    await page.reload();
    await page.waitForTimeout(1500);
    const s3 = await stateNow();
    check("リモートのジャーナルが自動で合流する", (s3.journals["2000-01-02"] || "").includes("朝ジャーナル"));
    check("リモートの体調記録が自動で合流する", s3.condition.logs["2000-01-02"]?.sleepHours === 7);
    check("lastPushedAtがリモートに追いつく(push見送り解除)", s3.settings.lastPushedAt === `${YESTERDAY}T13:00`);
    check("和集合が未pushとして残る", s3.dataModifiedAt > `${YESTERDAY}T13:00`);
    check("競合バナーが出ない", await page.locator(".sync-banner").count() === 0);
  } catch (e) {
    failures++;
    console.log("  ❌ 実行エラー:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.log(`v106: ${failures}件失敗`); process.exit(1); }
  console.log("v106: 全チェック通過");
})();
