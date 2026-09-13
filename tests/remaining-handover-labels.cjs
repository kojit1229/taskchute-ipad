const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setViewportAndWaitForStableLayout } = require('./helpers');
const { nav: openExistingView } = require('./remaining-twelveweek-layout.test');
const entries = [
  ['wbs', '作業一覧', '作業一覧'], ['wish', 'やりたいこと', 'やりたいこと'],
  ['vision', 'ビジョン', 'ビジョン'], ['twelveweek', '12週計画', '12週計画'],
  ['zero', '0秒思考', '0秒思考'], ['ai-reports', 'AIレポート', 'AIレポート'],
  ['fund', '資産', '資産'], ['instruments', '健康と継続', '健康'],
  ['iron-log', '筋トレ記録', '筋トレ記録'], ['settings', '設定', '設定']
];
// Product headings and controls only: user-entered text, report bodies, IDs and FABLE/CODEX proper names are not labels.
const oldNames = /\b(?:TOWER\s*\/\s*WBS|WBS|0 SECOND THINKING|WRITING\s*[—-]\s*1 MINUTE|12WY|TWELVE WEEK|FLIGHT LOG|FLIGHT PLAN|WISH RADAR|WISH DECK|WISH PROJECT|INSTRUMENTS|IRON LOG|EARLY BIRD|ANNUAL PAYLOAD|CONTROL DECK|MISSION CONTROL|AI REPORTS?|VISION BOARD)\b/i;
module.exports = async function inventory(page, navigate, output) {
  const results = [], failures = [];
  for (const width of [390, 1280]) {
    await setViewportAndWaitForStableLayout(page, { width, height: 900 }, '#app');
    await navigate(page, 'more');
    const actualEntries = await page.locator('.more-tower-item').evaluateAll(nodes => nodes.map(n => [n.dataset.view,
      n.querySelector('strong').textContent.replace(n.querySelector('.more-tower-mark').textContent, '').replace(/\d+\+?$/, '').trim()]));
    assert.deepEqual(actualEntries, entries.map(([id, label]) => [id, label]), 'all ten Japanese entry labels');
    for (const [id, label, title] of [...entries, ['journal', '日報', '日報']]) {
      // Journal is not one of the ten More entries. Reuse the existing view opener for its label-only audit.
      if (id === 'journal') await openExistingView(page, id);
      else await navigate(page, id);
      const screen = await page.locator('#app').evaluate(root => {
        const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const selectors = 'h1,h2,h3,.eyebrow,.zt-write-eyebrow,.settings-row-label,.settings-group-flat-label,button,summary';
        return { headings: [...root.querySelectorAll('h1')].filter(visible).map(el => el.textContent.trim()),
          labels: [...root.querySelectorAll(selectors)].filter(visible).map(el => ({ tag: el.tagName,
            action: el.dataset.action || '', text: el.textContent.trim().replace(/\s+/g, ' '), ariaLabel: el.getAttribute('aria-label') || '' })) };
      });
      const remnants = screen.labels.filter(item => oldNames.test(item.text) || oldNames.test(item.ariaLabel));
      results.push({ width, id, label, expectedHeading: title, ...screen, remnants });
      if (!screen.headings.includes(title)) failures.push({ width, id, reason: 'Japanese heading missing', expected: title, actual: screen.headings });
      for (const item of remnants) failures.push({ width, id, reason: 'old code name in product label', ...item });
      console.log('INVENTORY ' + width + ' ' + id + ': ' + screen.labels.length + ' labels, ' + remnants.length + ' remnants');
    }
  }
  fs.writeFileSync(path.join(output, 'handover-label-inventory.json'), JSON.stringify({ entries, results, failures }, null, 2), 'utf8');
  assert.equal(results.length, 22, 'ten entries plus journal at both widths');
  assert.deepEqual(failures, [], 'Japanese headings and no legacy code names in main labels');
  console.log('PASS R4 labels: ten entries and journal, both widths, expected Japanese headings and no old code names');
};
