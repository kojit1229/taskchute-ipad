const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const acorn = require('acorn');
const { STATE_KEY, setViewportAndWaitForStableLayout } = require('./helpers');
const { setup } = require('./remaining-twelveweek-layout.test');

const entries = [
  ['wbs', '作業一覧', '計画'], ['wish', 'やりたいこと', '計画'], ['vision', 'ビジョン', '計画'],
  ['twelveweek', '12週計画', '計画'], ['zero', '0秒思考', '思考'], ['ai-reports', 'AIレポート', '振り返り'],
  ['fund', '資産', '振り返り'], ['instruments', '健康と継続', 'ツール'],
  ['iron-log', '筋トレ記録', 'ツール'], ['settings', '設定', 'ツール']
];

module.exports = async function navJapanese() {
  // Extract actual declarations: unread fixtures exercise rendering without changing runtime state.
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = ['moreItems', 'navItems', 'mobileNav', 'renderMore', 'moreGroupLabelFor'];
  const nodes = ast.body.filter(node => names.includes(node.id?.name || node.declarations?.[0]?.id?.name));
  assert.equal(nodes.length, names.length);
  let unread = 0;
  const context = vm.createContext({ aiReportUnreadCount: () => unread, renderHeader: () => '' });
  vm.runInContext(nodes.map(node => source.slice(node.start, node.end)).join('\n'), context);
  const plain = expression => JSON.parse(vm.runInContext('JSON.stringify(' + expression + ')', context));
  assert.deepEqual(plain('moreItems.map(({id,label,group}) => [id,label,group])'), entries);
  assert.deepEqual(plain('mobileNav.map(({id,label}) => [id,label])'),
    [['today', '今日'], ['exec', '実行'], ['wbs', '作業一覧'], ['more', 'その他']]);
  const sidebar = plain('navItems.map(({id,label}) => [id,label])');
  assert.equal(sidebar.length, 14);
  assert.deepEqual(sidebar.find(([id]) => id === 'journal'), ['journal', '日報']);
  for (const [id, label, group] of entries) {
    assert.deepEqual(sidebar.find(item => item[0] === id), [id, label]);
    assert.equal(vm.runInContext('moreGroupLabelFor(' + JSON.stringify(id) + ')', context), group);
  }
  for (const count of [0, 3, 100]) {
    unread = count;
    const html = vm.runInContext('renderMore()', context);
    assert.equal((html.match(/data-action="nav"/g) || []).length, 10);
    assert.doesNotMatch(html, /NAV \d+/);
    if (count) assert.ok(html.includes('<span class="nav-badge">' + (count > 99 ? '99+' : count) + '</span>'));
    else assert.doesNotMatch(html, /nav-badge/);
  }
  const { page, browser, server } = await setup();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const stored = () => page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      return Object.fromEntries(['projects', 'tasks', 'blocks', 'journals', 'reports', 'writeMeditations'].map(k => [k, s[k]]));
    }, STATE_KEY);
    const baseline = await stored();
    const output = process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'r4a-nav-'));
    fs.mkdirSync(output, { recursive: true });
    const dimensions = [];
    for (const width of [390, 1280]) {
      await setViewportAndWaitForStableLayout(page, { width, height: 900 }, '#app');
      const more = page.locator((width === 390 ? '#bottomNav' : '#sidebar') + ' [data-action="nav"][data-view="more"]');
      await more.click();
      await page.locator('.more-tower-grid').waitFor();
      assert.deepEqual(await page.locator('.more-tower-item').evaluateAll(nodes => nodes.map(n => [n.dataset.view,
        n.querySelector('strong').textContent.replace(n.querySelector('.more-tower-mark').textContent, '').replace(/\d+\+?$/, '').trim(),
        n.querySelector('small').textContent])), entries);
      const metric = await page.evaluate(() => ({ width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        items: [...document.querySelectorAll('.more-tower-item')].map(el => el.getBoundingClientRect().toJSON()) }));
      assert.ok(metric.scrollWidth <= metric.width);
      assert.ok(metric.items.every(rect => rect.height >= 44));
      dimensions.push({ viewport: width, ...metric });
      await page.screenshot({ path: path.join(output, 'more-' + width + '.png'), fullPage: true });
      for (const [id, , group] of entries) {
        await page.locator('.more-tower-item[data-view="' + id + '"]').click();
        await page.locator('#app[data-view="' + id + '"]').waitFor();
        // 作業一覧は主要4画面の1つ。既存の現在地は専用ナビ枠で示す。
        if (id === 'wbs') assert.equal(await page.locator('.view-breadcrumb').count(), 0);
        else assert.equal(await page.locator('.view-breadcrumb').first().innerText(), 'その他 › ' + group);
        const active = width === 390 ? (id === 'wbs' ? 'wbs' : 'more') : id;
        assert.equal(await page.locator((width === 390 ? '#bottomNav' : '#sidebar') + ' [data-view="' + active + '"].active').count(), 1);
        await more.click(); await page.locator('.more-tower-grid').waitFor();
        assert.equal(await page.locator('.more-tower-item').count(), 10);
      }
      assert.deepEqual(await stored(), baseline, 'all ten round trips preserve user records');
      assert.deepEqual(await page.locator('#bottomNav > button').evaluateAll(nodes => nodes.map(n => n.dataset.view)),
        ['today', 'exec', 'wbs', 'more']);
    }
    fs.writeFileSync(path.join(output, 'more-dimensions.json'), JSON.stringify(dimensions, null, 2), 'utf8');
    assert.deepEqual(errors, []);
    console.log('PASS navigation: ten Japanese entries, unread 0/3/99+, all round trips/current locations, four bottom buttons and unchanged records');
  } finally {
    await page.context().close(); await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
};
