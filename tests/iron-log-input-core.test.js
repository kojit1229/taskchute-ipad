const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '../src/features/iron-log.js')));
  let actions, saves = 0, date = '2026-09-06';
  const state = { settings: {gymExerciseList:['A','B']}, blocks: [], condition:{logs:{}} };
  const nodes = {};
  for (const key of ['Exercise','Weight','Reps']) {
    nodes['#ironForm'+key] = {value:'', dataset:{}, setAttribute(k,v){this[k]=v;}};
    nodes['#ironError'+key] = {textContent:''};
  }
  nodes['#ironMenuName'] = {value:'C'};
  global.document = {querySelector: key => nodes[key]};
  const escapeHTML = x => String(x??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  m.configureIronLog({getState:()=>state, escapeHTML,todayISO:()=>date,renderHeader:()=>'',
    saveAndRender:()=>{saves++; m.renderIronLog();},registerActions:a=>actions=a});
  function set(exercise,weight,reps){
    for(const [key,val] of [['Exercise',exercise],['Weight',weight],['Reps',reps]])nodes['#ironForm'+key].value=val;
    m.captureIronSetDraft();
  }
  const invalid = [['','40','10'],['A','','10'],['A',' ','10'],['A','NaN','10'],['A','Infinity','10'],
    ['A','-1','10'],['A','0','10'],['A','40',''],['A','40','Infinity'],['A','40','-1'],
    ['A','40','0'],['A','40','1.5'],['A','1e308','100']];
  for(const input of invalid){set(...input);actions['iron-add-set']();assert.equal(saves,0);}
  assert.deepEqual(state.condition.logs,{});
  set('B','-1','1.5'); actions['iron-add-set']();
  assert.match(nodes['#ironErrorWeight'].textContent,/0より大きい/);
  assert.match(nodes['#ironErrorReps'].textContent,/整数/);
  assert.equal(nodes['#ironFormWeight']['aria-invalid'],'true');
  assert.match(m.renderIronLog(),/value="-1"/);
  set('B','42.5','10');
  actions['iron-menu-add']();
  const html=m.renderIronLog();
  assert.match(html,/<option value="B" selected>/); assert.match(html,/value="42.5"/);
  assert.deepEqual(state.settings.gymExerciseList,['A','B','C']);
  set('B','',''); assert.match(m.renderIronLog(),/id="ironFormWeight"[^>]*value=""/);
  set('B','40','10');
  for(let i=0;i<3;i++)actions['iron-add-set']();
  assert.equal(state.condition.logs[date].gym.length,3);
  assert.equal(m.ironDailyTotal(state,date),1200);
  assert.equal(new Set(state.condition.logs[date].gym.map(x=>x.id)).size,3);
  assert.equal(nodes['#ironFormWeight']['aria-invalid'],'false');
  assert.equal(nodes['#ironErrorWeight'].textContent,'');
  assert.equal(state.blocks.length,0);
  assert.ok(!JSON.stringify(state).includes('ironSetDraft'));
  const block={id:'real"<block',title:'ジム',actualStartAt:date+'T09:00'};
  state.blocks.push(block);
  assert.match(m.renderIronLog(),/data-action="edit-block" data-id="real&quot;&lt;block"/);
  actions['iron-add-set'](); assert.equal(state.condition.logs[date].gym[3].blockId,block.id);
  block.deleted=true;assert.ok(!m.renderIronLog().includes('data-action="edit-block"'));
  assert.equal(state.blocks.length,1);
  date='2026-09-07';
  assert.match(m.renderIronLog(),/<option value="B" selected>/);
  assert.match(m.renderIronLog(),/id="ironFormWeight"[^>]*value="40"/);
  assert.match(m.renderIronLog(),/2026-09-06からの入力.*今日（2026-09-07）/);
  assert.equal(state.condition.logs[date],undefined,'render does not create a new day log');
  actions['iron-add-set']();
  assert.equal(state.condition.logs[date].gym.length,1);
  assert.equal(state.condition.logs[date].gym[0].at.slice(0,10),date);
  assert.ok(!m.renderIronLog().includes('iron-draft-date'),'successful add acknowledges current date');
  date='2026-09-08';
  assert.match(m.renderIronLog(),/2026-09-07からの入力.*今日（2026-09-08）/);
  set('B','55','8');
  assert.ok(!m.renderIronLog().includes('iron-draft-date'),'editing captures a current-day draft');
  date='2026-09-09';
  nodes['#ironFormWeight'].value='';
  actions['iron-add-set']();
  assert.equal(state.condition.logs[date],undefined);
  assert.match(m.renderIronLog(),/2026-09-08からの入力.*今日（2026-09-09）/,'failed add preserves prior-day notice');
  const app = require('node:fs').readFileSync(path.join(__dirname,'../app.js'),'utf8');
  assert.match(app,/import \{\s*captureIronSetDraft, configureIronLog/);
  assert.match(app,/delete target\.dataset\.prefilled;\s*captureIronSetDraft\(\);/);
  console.log('iron-log-input-core: PASS invalid13 / inline errors / rerender draft / 3sets / linked ID / unlinked / day boundary');
})().catch(e=>{console.error(e);process.exitCode=1;});
