'use strict';
// Server-side checks for the Project OS link (syncProjects). No phone needed.
const assert = require('assert');
const { createServer } = require('./lib/server');

const KEY = 'k'.repeat(64);
const REG = [
  { id: 'WA-001', name: 'Site Alpha', client: 'Asha', location: 'Kadri', lifecycle: 'EXECUTION / SITE', group: 'exec', active: true },
  { id: 'WA-002', name: 'Design Beta', client: 'Ben', location: 'Bejai', lifecycle: 'CONCEPT DESIGN', group: 'design', active: true },
  { id: 'WA-003', name: 'Enquiry Gamma', client: '', location: '', lifecycle: 'ENQUIRY', group: 'enq', active: false },
  { id: 'WA-004', name: 'Existing Delta', client: 'Dev', location: 'Surathkal', lifecycle: 'SNAGGING', group: 'snag', active: true }
];
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('  PASS  ' + name); } catch (e) { console.log('  FAIL  ' + name + ' - ' + (e.stack || e)); process.exitCode = 1; } }

console.log('Project OS link');
function fresh() {
  const s = createServer();
  s.mocks.net.handler = function (url, body) { assert.strictEqual(body.action, 'registry'); assert.strictEqual(body.key, KEY); return { ok: true, projects: REG }; };
  s.mocks.props.setProperty('LINK_KEY', KEY);
  return s;
}
const adm = function (s) { return s.auth('Ameen', true); };

t('staff cannot sync; admin can', () => {
  const s = fresh();
  assert.strictEqual(s.call('syncProjects', [s.auth('Ravi', false), true]).error, 'forbidden');
  assert.strictEqual(s.call('syncProjects', [adm(s), true]).ok, true);
});
t('dry run reports but writes nothing', () => {
  const s = fresh();
  const r = s.call('syncProjects', [adm(s), true]);
  assert.deepStrictEqual(r.added, ['Site Alpha', 'Design Beta', 'Existing Delta']);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(s.call('loadAll', [adm(s)]).sites.length, 0);
});
t('real run adds only in-process projects, linked by WA number, status Active', () => {
  const s = fresh();
  const r = s.call('syncProjects', [adm(s), false]);
  assert.strictEqual(r.added.length, 3);
  const sites = s.call('loadAll', [adm(s)]).sites;
  assert.deepStrictEqual(sites.map(x => x.projectId).sort(), ['WA-001', 'WA-002', 'WA-004']);
  assert.ok(sites.every(x => x.status === 'Active'));
  const alpha = sites.find(x => x.name === 'Site Alpha');
  assert.strictEqual(alpha.client, 'Asha'); assert.strictEqual(alpha.location, 'Kadri');
  assert.ok(!sites.some(x => x.name === 'Enquiry Gamma'));
});
t('running twice never duplicates', () => {
  const s = fresh();
  s.call('syncProjects', [adm(s), false]);
  const r = s.call('syncProjects', [adm(s), false]);
  assert.strictEqual(r.added.length + r.adopted.length, 0);
  assert.strictEqual(r.linked, 3);
  assert.strictEqual(s.call('loadAll', [adm(s)]).sites.length, 3);
});
t('a site that already exists by name is linked, keeping its contract and entries', () => {
  const s = fresh();
  s.call('saveSite', [adm(s), { name: 'existing delta', client: 'Dev', contract: 250000 }]);
  const r = s.call('syncProjects', [adm(s), false]);
  assert.deepStrictEqual(r.adopted, ['Existing Delta']);
  const d = s.call('loadAll', [adm(s)]).sites.find(x => x.name === 'existing delta');
  assert.strictEqual(d.projectId, 'WA-004'); assert.strictEqual(d.contract, 250000);
});
t('editing a linked site keeps the link', () => {
  const s = fresh();
  s.call('syncProjects', [adm(s), false]);
  const a = s.call('loadAll', [adm(s)]).sites.find(x => x.name === 'Site Alpha');
  s.call('saveSite', [adm(s), { id: a.id, name: 'Site Alpha', client: 'Asha K', contract: 1000, status: 'Active' }]);
  assert.strictEqual(s.call('loadAll', [adm(s)]).sites.find(x => x.id === a.id).projectId, 'WA-001');
});
t('missing key and Project OS errors give a clear message', () => {
  const s = fresh();
  s.mocks.propStore.LINK_KEY = '';
  assert.strictEqual(s.call('syncProjects', [adm(s), true]).error, 'setup');
  const s2 = fresh();
  s2.mocks.net.handler = function () { return { ok: false, code: 'BAD_KEY', error: 'Wrong link key.' }; };
  const r = s2.call('syncProjects', [adm(s2), true]);
  assert.strictEqual(r.error, 'link'); assert.ok(/Wrong link key/.test(r.message));
  const s3 = fresh(); s3.mocks.net.handler = function () { throw new Error('offline'); };
  assert.strictEqual(s3.call('syncProjects', [adm(s3), true]).error, 'link');
});
t('an old sheet without the Project OS ID column gets the header added once', () => {
  const s = fresh();
  s.call('hello', [adm(s), 'Ameen']);
  const sh = s.mocks.sheetsById[s.mocks.propStore.SHEET_ID].getSheetByName('Sites');
  assert.strictEqual(sh.getRange(1, 13).getValue(), 'Project OS ID');
});
t('JSON endpoint for the Pages copy: reaches only the listed functions, PIN still enforced', () => {
  const s = fresh();
  const post = (o) => JSON.parse(s.ctx.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).getContent());
  const h = post({ fn: 'hello', args: [s.auth('Ravi', false), 'Ravi'] });
  assert.strictEqual(h.ok, true);
  assert.strictEqual(post({ fn: 'hello', args: [{ pin: 'wrong', name: 'x' }, 'x'] }).error, 'pin');
  assert.strictEqual(post({ fn: 'setPins', args: [] }).error, 'invalid');
  assert.strictEqual(post({ fn: 'ctx_', args: [] }).error, 'invalid');
  assert.strictEqual(post({ fn: 'constructor', args: [] }).error, 'invalid');
  assert.strictEqual(post('not json').error, 'server');
  const sync = post({ fn: 'syncProjects', args: [s.auth('Ravi', false), true] });
  assert.strictEqual(sync.error, 'forbidden');
  assert.strictEqual(post({ fn: 'syncProjects', args: [s.auth('Ameen', true), true] }).ok, true);
});
console.log(n + ' passed');
