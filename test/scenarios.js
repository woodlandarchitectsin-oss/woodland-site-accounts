'use strict';
const assert = require('assert');
const { createServer } = require('./lib/server');
const { openPhone, sleep } = require('./lib/phone');

const PIN = '4321', ADMIN = '8888';
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function world(opts) {
  const server = createServer(opts);
  const phones = [];
  return {
    server, phones,
    async phone(label, name, admin, extra) {
      const p = await openPhone(server, Object.assign({ label }, extra || {}));
      phones.push(p);
      await p.login(PIN, name);
      if (admin) await p.unlockAdmin(ADMIN);
      return p;
    },
    end() {
      const errs = [];
      phones.forEach(function (p) { p.errors.forEach(function (e) { errs.push(p.name + ': ' + e); }); p.close(); });
      if (errs.length) throw new Error('JavaScript errors on screen: ' + errs.slice(0, 3).join(' | '));
    }
  };
}
async function createSite(p, f) {
  await p.tab('sites');
  p.click('new-site');
  await p.waitFor(function () { return p.t('site-form'); }, 'site form');
  p.type('sf-name', f.name);
  if (f.client) p.type('sf-client', f.client);
  if (f.contract && p.t('sf-contract')) p.type('sf-contract', f.contract);
  p.click('sf-save');
  await p.settle(30);
}
function rowWith(p, text) { return p.ta('entry-row').find(function (r) { return r.textContent.indexOf(text) >= 0; }); }
async function openRow(p, text) {
  await p.waitFor(function () { return rowWith(p, text); }, 'entry row "' + text + '"');
  rowWith(p, text).click();
  await p.waitFor(function () { return p.t('entry-detail'); }, 'entry detail');
}
async function closeSheets(p) { while (p.t('sheet-close')) { p.click('sheet-close'); await p.settle(10); } }
async function until(fn, what, ms) { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (fn()) return; await sleep(15); } throw new Error('timed out: ' + what); }
const entriesOf = function (w) { return w.server.table('Entries'); };

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('Admin and Mazin see each other\'s entries after a poll', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await createSite(ameen, { name: 'Shetty Residence', client: 'Mr Shetty', contract: '1500000' });
  await until(function () { return w.server.table('Sites').length === 1; }, 'site on server');
  await mazin.waitFor(function () { return mazin.S().sites && Object.keys(mazin.S().sites).length === 1; }, 'Mazin sees the new site');
  await mazin.addEntry({ type: 'Expense', amount: 450, site: 'Shetty Residence', category: 'Food / tea', person: 'Mazin', mode: 'UPI', party: 'Tea stall' });
  await until(function () { return entriesOf(w).length === 1; }, 'entry on server');
  const row = entriesOf(w)[0];
  assert.strictEqual(row['Voucher'], 'V-0001');
  assert.strictEqual(row['Entered by'], 'Mazin');
  assert.strictEqual(row['Amount (\u20B9)'], 450);
  assert.strictEqual(row['Date'].length, 10, 'date stays plain text');
  assert.ok(row['Entered at'].length === 19, 'entered-at stamp present');
  await ameen.tab('entries');
  await ameen.waitFor(function () { return rowWith(ameen, 'Tea stall'); }, 'Ameen sees Mazin\'s entry');
  assert.ok(rowWith(ameen, 'Tea stall').textContent.indexOf('\u2212\u20B9450') >= 0);
  await ameen.tab('home');
  assert.ok(/1 entry not checked/.test(ameen.mainText()), 'admin banner: ' + ameen.mainText().slice(0, 200));
  await openRow(mazin, 'Tea stall').catch(async function () { await mazin.tab('entries'); await openRow(mazin, 'Tea stall'); });
  assert.ok(mazin.t('act-edit') && mazin.t('act-delete'), 'Mazin can edit/delete his own unchecked entry');
  assert.ok(!mazin.t('act-check'), 'Mazin cannot check');
  await closeSheets(mazin);
  // admin checks; Mazin then loses edit rights
  await openRow(ameen, 'Tea stall');
  ameen.click('act-check');
  await until(function () { return entriesOf(w)[0]['Checked'] === 'Yes'; }, 'checked on server');
  assert.strictEqual(entriesOf(w)[0]['Checked by'], 'Ameen');
  await closeSheets(ameen);
  await mazin.tab('entries');
  await mazin.waitFor(function () { const r = rowWith(mazin, 'Tea stall'); return r && /Checked/.test(r.textContent); }, 'Mazin sees the check mark');
  await openRow(mazin, 'Tea stall');
  assert.ok(!mazin.t('act-edit') && !mazin.t('act-delete'), 'checked entry is locked for Mazin');
  w.end();
});

test('Offline expense with a photo uploads later, keeps its photo, queue empties', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Hill View', contract: '800000' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  mazin.goOffline();
  await mazin.settle(30);
  assert.ok(/Offline/.test(mazin.status()), 'status says offline: ' + mazin.status());
  await mazin.addEntry({ type: 'Expense', amount: 450, site: 'Hill View', category: 'Transport', person: 'Mazin', photo: JPEG });
  await mazin.settle(80);
  assert.strictEqual(mazin.status(), 'Offline \u00B7 1 waiting');
  assert.strictEqual(entriesOf(w).length, 0, 'nothing reached the server yet');
  await mazin.tab('entries');
  assert.ok(/Not uploaded/.test(mazin.mainText()), 'entry flagged Not uploaded');
  assert.strictEqual(mazin.S().queue.length, 1);
  mazin.goOnline();
  await until(function () { return entriesOf(w).length === 1; }, 'entry uploaded');
  await until(function () { return mazin.S().queue.length === 0; }, 'queue empty');
  await mazin.waitFor(function () { return /Live/.test(mazin.status()); }, 'status Live: ' + mazin.status());
  const row = entriesOf(w)[0];
  assert.ok(row['Bill file ID (system)'], 'bill file id stored');
  const f = w.server.mocks.filesById[row['Bill file ID (system)']];
  assert.ok(f && Buffer.from(f.blob.bytes.map(function (b) { return b & 255; })).equals(JPEG), 'photo bytes in Drive equal the original');
  assert.deepStrictEqual(f.sharing, ['ANYONE_WITH_LINK', 'VIEW']);
  assert.ok(/V-0001/.test(f.name), 'file renamed with voucher: ' + f.name);
  await mazin.waitFor(function () { return !/Not uploaded/.test(mazin.mainText()); }, 'Not uploaded flag cleared');
  await ameen.tab('entries');
  await ameen.waitFor(function () { return rowWith(ameen, 'Transport'); }, 'Ameen sees it');
  await openRow(ameen, 'Transport');
  assert.ok(ameen.t('bill-link'), 'bill photo shown to Ameen');
  w.end();
});

test('Petty cash maths: 20,000 - 3,450 - 1,200 = 15,350, then 16,550 after delete', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Showroom' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  await ameen.waitFor(function () { return ameen.S().people.indexOf('Mazin') >= 0; }, 'Ameen knows Mazin');
  await ameen.addEntry({ type: 'Cash to staff', amount: 20000, person: 'Mazin' });
  await mazin.addEntry({ type: 'Expense', amount: 3450, site: 'Showroom', category: 'Material', person: 'Mazin' });
  await mazin.addEntry({ type: 'Expense', amount: 1200, site: 'Showroom', category: 'Labour', person: 'Mazin' });
  await until(function () { return entriesOf(w).length === 3 && mazin.S().queue.length === 0; }, 'all three saved');
  async function inHand(p) {
    await p.tab('cash');
    await p.waitFor(function () { return p.ta('cash-person').some(function (r) { return /^Mazin/.test(r.textContent); }); }, 'Mazin cash row');
    return p.ta('cash-person').find(function (r) { return /^Mazin/.test(r.textContent); }).querySelector('.a').textContent;
  }
  await ameen.waitFor(function () { return ameen.window.__wsa.agg().list.length === 3; }, 'Ameen has all entries');
  assert.ok((await inHand(mazin)).indexOf('\u20B915,350') === 0, 'Mazin sees ' + (await inHand(mazin)));
  assert.ok((await inHand(ameen)).indexOf('\u20B915,350') === 0, 'Ameen sees ' + (await inHand(ameen)));
  await mazin.tab('entries');
  await openRow(mazin, '1,200');
  mazin.click('act-delete');
  await mazin.waitFor(function () { return mazin.t('confirm-yes'); }, 'confirm dialog');
  mazin.click('confirm-yes');
  await mazin.settle(30);
  assert.ok((await inHand(mazin)).indexOf('\u20B916,550') === 0, 'after delete Mazin sees ' + (await inHand(mazin)));
  await until(function () { return entriesOf(w).filter(function (r) { return r['Deleted'] === 'Yes'; }).length === 1; }, 'soft delete on server');
  const del = entriesOf(w).find(function (r) { return r['Deleted'] === 'Yes'; });
  assert.strictEqual(del['Deleted by'], 'Mazin');
  assert.strictEqual(entriesOf(w).length, 3, 'row is kept for audit');
  await ameen.waitFor(function () { return ameen.window.__wsa.agg().list.length === 2; }, 'Ameen sees the delete');
  assert.ok((await inHand(ameen)).indexOf('\u20B916,550') === 0, 'Ameen sees ' + (await inHand(ameen)));
  // admin can still see the deleted entry and restore it
  await ameen.tab('entries');
  ameen.click('kind-deleted');
  await ameen.settle(30);
  await openRow(ameen, '1,200');
  ameen.click('act-restore');
  await until(function () { return entriesOf(w).every(function (r) { return r['Deleted'] === 'No'; }); }, 'restored on server');
  assert.ok(/restored/.test(JSON.stringify(entriesOf(w).map(function (r) { return r['Edit history (system)']; }))), 'restore is in history');
  w.end();
});

test('Staff cannot edit/delete locked or foreign entries; app shows a message and recovers', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Site A' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  await ameen.addEntry({ type: 'Expense', amount: 700, site: 'Site A', category: 'Hardware', person: 'Ameen', party: 'Admin shop' });
  await mazin.addEntry({ type: 'Expense', amount: 300, site: 'Site A', category: 'Misc', person: 'Mazin', party: 'Mazin shop' });
  await until(function () { return entriesOf(w).length === 2; }, 'both saved');
  const ids = {};
  entriesOf(w).forEach(function (r) { ids[r['Paid to / received from']] = r['ID (system)']; });
  await mazin.waitFor(function () { return mazin.S().entries[ids['Admin shop']]; }, 'Mazin sees admin entry');

  // (a) offline delete on Mazin's phone while the admin checks the entry
  await mazin.tab('entries');
  mazin.goOffline();
  await openRow(mazin, 'Mazin shop');
  mazin.click('act-delete');
  await mazin.waitFor(function () { return mazin.t('confirm-yes'); }, 'confirm');
  mazin.click('confirm-yes');
  await mazin.settle(40);
  assert.strictEqual(mazin.S().queue.length, 1, 'delete is queued');
  const mine = ids['Mazin shop'];
  const r = w.server.call('setChecked', [w.server.auth('Ameen', true), mine, true]);
  assert.ok(r.ok);
  mazin.goOnline();
  await until(function () { return mazin.S().queue.length === 0; }, 'queue drained after refusal');
  await mazin.waitFor(function () { return /couldn't save|Couldn't save/i.test(mazin.text()); }, 'message shown');
  await mazin.waitFor(function () { const e = mazin.S().entries[mine]; return e && !e.deleted && e.checked; }, 'entry recovered to server state');
  assert.strictEqual(entriesOf(w).find(function (x) { return x['ID (system)'] === mine; })['Deleted'], 'No');

  // (b) a tampered/stale queue tries to delete the admin's entry
  const theirs = ids['Admin shop'];
  mazin.S().queue.push({ qid: 'qx1', op: 'deleteEntry', ref: theirs, args: [theirs], photo: false, tries: 0 });
  mazin.S().queue.push({ qid: 'qx2', op: 'saveEntry', ref: theirs, args: [{ id: theirs, type: 'Expense', date: '2026-01-01', site: 'Site A', amount: 1, category: 'Misc', person: 'Mazin', mode: 'Cash', party: '', note: 'hacked' }], photo: false, tries: 0 });
  mazin.window.__wsa.pump();
  await until(function () { return mazin.S().queue.length === 0; }, 'bad items dropped');
  const adminRow = entriesOf(w).find(function (x) { return x['ID (system)'] === theirs; });
  assert.strictEqual(adminRow['Deleted'], 'No');
  assert.strictEqual(adminRow['Amount (\u20B9)'], 700);
  assert.strictEqual(mazin.S().failed.length >= 2, true, 'both refusals reported');

  // (c) straight server calls
  const staff = w.server.auth('Mazin', false);
  const checks = [
    ['saveEntry', [staff, { id: mine, type: 'Expense', date: '2026-01-01', site: 'Site A', amount: 5, category: 'Misc', person: 'Mazin', mode: 'Cash' }], 'locked'],
    ['deleteEntry', [staff, mine], 'locked'],
    ['deleteEntry', [staff, theirs], 'forbidden'],
    ['setChecked', [staff, theirs, true], 'forbidden'],
    ['restoreEntry', [staff, theirs], 'forbidden'],
    ['saveSettings', [staff, { kind: 'category', action: 'remove', name: 'Misc' }], 'forbidden'],
    ['auditLedger', [staff], 'forbidden']
  ];
  checks.forEach(function (c) { const res = w.server.call(c[0], c[1]); assert.strictEqual(res.ok, false, c[0]); assert.strictEqual(res.error, c[2], c[0] + ' -> ' + JSON.stringify(res)); });
  const sid = w.server.table('Sites')[0]['ID (system)'];
  assert.strictEqual(w.server.call('saveSite', [staff, { id: sid, name: 'Renamed', status: 'Active' }]).error, 'forbidden');
  // admin can still edit a checked entry (and it shows in history)
  const ed = w.server.call('saveEntry', [w.server.auth('Ameen', true), { id: mine, type: 'Expense', date: '2026-01-02', site: 'Site A', amount: 320, category: 'Misc', person: 'Mazin', mode: 'Cash', party: 'Mazin shop' }]);
  assert.ok(ed.ok);
  const hist = ed.entry.history;
  assert.ok(/edited \(was checked\)/.test(hist[hist.length - 1].a), 'history notes edit of a checked entry');
  w.end();
});

test('Two people create the same site at once: one site results', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  const mazin = await w.phone('Mazin', 'Mazin', false);
  ameen.goOffline(); mazin.goOffline();
  await createSite(ameen, { name: 'Corner Cafe' });
  await createSite(mazin, { name: 'corner cafe' });
  assert.strictEqual(w.server.table('Sites').length, 0);
  ameen.goOnline(); mazin.goOnline();
  await until(function () { return ameen.S().queue.length === 0 && mazin.S().queue.length === 0; }, 'both queues drained');
  assert.strictEqual(w.server.table('Sites').length, 1, 'exactly one site row');
  await ameen.waitFor(function () { return Object.keys(ameen.S().sites).length === 1; }, 'Ameen has one site');
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'Mazin has one site');
  assert.strictEqual(Object.values(ameen.S().sites)[0].id, Object.values(mazin.S().sites)[0].id);
  // direct simultaneous server calls
  const a = w.server.call('saveSite', [w.server.auth('A'), { name: 'Race Site' }]);
  const b = w.server.call('saveSite', [w.server.auth('B'), { name: 'RACE site' }]);
  assert.strictEqual(a.site.id, b.site.id);
  assert.strictEqual(w.server.table('Sites').length, 2);
  w.end();
});

test('Wrong PIN is refused; repeated wrong PINs lock out', async function () {
  const w = await world();
  const p = await openPhone(w.server, { label: 'Stranger' });
  w.phones.push(p);
  await p.waitFor(function () { return p.t('pin-input'); }, 'PIN screen');
  p.type('pin-input', '0000');
  p.click('pin-go');
  await p.waitFor(function () { return /Wrong PIN/.test(p.t('pin-err').textContent); }, 'wrong PIN message');
  assert.ok(p.t('pin-input'), 'still on PIN screen');
  for (const fn of ['loadAll', 'changesSince', 'auditLedger']) assert.strictEqual(w.server.call(fn, [{ pin: '0000', name: 'x' }, 0]).error, 'pin', fn);
  assert.strictEqual(w.server.call('saveEntry', [{ pin: '', name: 'x' }, { type: 'Expense', amount: 5 }, null]).error, 'pin');
  assert.strictEqual(w.server.call('hello', [{ pin: PIN, admin: '1111', name: 'x' }, '']).error, 'adminpin');
  assert.ok(!w.server.mocks.propStore.SHEET_ID, 'a stranger creates nothing');
  for (let i = 0; i < 30; i++) w.server.call('hello', [{ pin: 'bad' + i }, '']);
  assert.strictEqual(w.server.call('hello', [{ pin: PIN }, '']).error, 'locked_out');
  w.end();
});

test('Server validation rejects bad entries', async function () {
  const w = await world();
  const a = w.server.auth('Ameen', true);
  const base = { type: 'Expense', date: '2026-10-12', site: 'S', amount: 100, category: 'Misc', person: 'Ameen', mode: 'Cash' };
  const bad = [
    [{ amount: 0 }, 'amount zero'], [{ amount: -5 }, 'negative'], [{ amount: 'abc' }, 'NaN'], [{ date: '2026-02-30' }, 'impossible date'], [{ date: '12/10/2026' }, 'format'],
    [{ type: 'Gift' }, 'type'], [{ site: '' }, 'site required for expense'], [{ category: '' }, 'category required'], [{ mode: 'Barter' }, 'mode'], [{ person: '' }, 'person']
  ];
  bad.forEach(function (b) { const r = w.server.call('saveEntry', [a, Object.assign({}, base, b[0]), null]); assert.strictEqual(r.error, 'invalid', b[1] + ' -> ' + JSON.stringify(r)); });
  assert.strictEqual(w.server.call('saveEntry', [a, Object.assign({}, base, { type: 'Received', site: '' }), null]).error, 'invalid');
  assert.strictEqual(w.server.call('saveEntry', [a, Object.assign({}, base, { type: 'Cash to staff', site: '', category: '' }), null]).ok, true, 'cash to staff needs no site');
  const long = w.server.call('saveEntry', [a, Object.assign({}, base, { note: 'x'.repeat(100000), party: 'p'.repeat(1000) }), null]);
  assert.ok(long.ok);
  assert.strictEqual(long.entry.note.length, 500);
  assert.strictEqual(long.entry.party.length, 80);
  assert.strictEqual(w.server.call('saveEntry', [a, base, { mime: 'text/html', data: 'AAAA' }]).error, 'invalid');
  assert.strictEqual(w.server.call('saveEntry', [w.server.auth('', false), base, null]).error, 'name');
  w.server.table('Entries').forEach(function (r) { Object.values(r).forEach(function (v) { assert.ok(String(v).length < 49000); }); });
  assert.strictEqual(w.server.table('Entries').length, 2, 'only the two valid entries were stored');
  w.end();
});

test('Lost reply: retry does not create a duplicate', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Dup Site' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  mazin.net.dropReplies = 1;
  await mazin.addEntry({ type: 'Expense', amount: 99, site: 'Dup Site', category: 'Misc', person: 'Mazin', photo: JPEG });
  await until(function () { return mazin.S().queue.length === 0; }, 'retry finished', 6000);
  assert.strictEqual(entriesOf(w).length, 1, 'exactly one row');
  const files = Object.values(w.server.mocks.filesById).length;
  assert.strictEqual(files, 1, 'photo uploaded once');
  await mazin.waitFor(function () { return Object.keys(mazin.S().entries).length === 1 && !Object.values(mazin.S().entries)[0]._temp; }, 'local copy settled');
  w.end();
});

test('Photo trouble: one failure keeps the photo; repeated failure saves the entry without it', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Photo Site' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  w.server.mocks.faults.drive = 1;
  await mazin.addEntry({ type: 'Expense', amount: 10, site: 'Photo Site', category: 'Misc', person: 'Mazin', photo: JPEG });
  await until(function () { return entriesOf(w).length === 1; }, 'first saved');
  assert.ok(entriesOf(w)[0]['Bill file ID (system)'], 'photo kept after one failure');
  w.server.mocks.faults.driveAlways = true;
  await mazin.addEntry({ type: 'Expense', amount: 20, site: 'Photo Site', category: 'Misc', person: 'Mazin', photo: JPEG });
  await until(function () { return entriesOf(w).length === 2; }, 'second saved without photo');
  assert.strictEqual(entriesOf(w)[1]['Bill file ID (system)'], '');
  await until(function () { return mazin.S().queue.length === 0; }, 'queue empty');
  w.end();
});

test('One bad item never blocks the queue', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Q Site' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  mazin.goOffline();
  w.server.mocks.faults.voucher = 3;
  await mazin.addEntry({ type: 'Expense', amount: 111, site: 'Q Site', category: 'Misc', person: 'Mazin' });
  await mazin.addEntry({ type: 'Expense', amount: 222, site: 'Q Site', category: 'Misc', person: 'Mazin' });
  mazin.goOnline();
  await until(function () { return mazin.S().queue.length === 0; }, 'queue drained', 6000);
  const rows = entriesOf(w);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]['Amount (\u20B9)'], 222, 'second item got through');
  assert.strictEqual(mazin.S().failed.length, 1, 'first item reported as failed');
  assert.ok(/111/.test(mazin.S().failed[0].what), 'message names the lost entry: ' + mazin.S().failed[0].what);
  await mazin.tab('home');
  assert.ok(/Couldn't save 1 change/.test(mazin.mainText()), 'visible on screen');
  w.end();
});

test('Full phone storage: entry kept, photo dropped', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Quota Site' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  const proto = mazin.window.Storage.prototype, orig = proto.setItem;
  proto.setItem = function (k, v) { if (String(k).indexOf('wsa_ph_') === 0) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); };
  mazin.goOffline();
  await mazin.addEntry({ type: 'Expense', amount: 55, site: 'Quota Site', category: 'Misc', person: 'Mazin', photo: JPEG });
  await mazin.settle(40);
  assert.ok(/photo was skipped/.test(mazin.text()), 'told the user');
  assert.strictEqual(mazin.S().queue.length, 1);
  assert.strictEqual(mazin.S().queue[0].photo, false);
  mazin.goOnline();
  await until(function () { return entriesOf(w).length === 1; }, 'entry saved');
  assert.strictEqual(entriesOf(w)[0]['Bill file ID (system)'], '');
  w.end();
});

test('No reply for 25s (here 1.5s): clear message, and it recovers', async function () {
  const w = await world();
  const p = await w.phone('Ameen', 'Ameen', true);
  p.net.hang = true;
  p.window.__wsa.poll();
  await p.waitFor(function () { return /Couldn't reach Google\. Check the internet and reload\./.test(p.text()); }, 'timeout message', 4000);
  p.net.hang = false;
  await p.window.__wsa.poll();
  await p.waitFor(function () { return p.t('tab-home') && p.q('#netbanner').hidden; }, 'banner cleared');
  w.end();
});

test('Reopening the app offline shows saved data and the waiting entry; it uploads when online', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Cache Site' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  await mazin.addEntry({ type: 'Expense', amount: 640, site: 'Cache Site', category: 'Hardware', person: 'Mazin', party: 'Old one' });
  await until(function () { return entriesOf(w).length === 1; }, 'first saved');
  await mazin.settle(900);
  mazin.goOffline();
  await mazin.addEntry({ type: 'Expense', amount: 777, site: 'Cache Site', category: 'Transport', person: 'Mazin', party: 'Offline one', photo: JPEG });
  await mazin.settle(900);
  const snap = mazin.storageSnapshot();
  mazin.close();
  const again = await openPhone(w.server, { label: 'Mazin reopened', storage: snap, net: { offline: true } });
  w.phones.push(again);
  await again.waitFor(function () { return again.t('tab-home') && !again.t('loading'); }, 'app opens offline from cache');
  await again.tab('entries');
  await again.waitFor(function () { return rowWith(again, 'Old one') && rowWith(again, 'Offline one'); }, 'both entries visible');
  assert.ok(/Not uploaded/.test(rowWith(again, 'Offline one').textContent));
  assert.ok(/Offline \u00B7 1 waiting/.test(again.status()), again.status());
  again.goOnline();
  await until(function () { return entriesOf(w).length === 2; }, 'uploaded after reopening');
  assert.ok(entriesOf(w)[1]['Bill file ID (system)'], 'photo survived the reload');
  w.end();
});

test('Edit history and permissions flow through the UI; renaming a site renames its entries', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Old Name', contract: '100000' });
  const mazin = await w.phone('Mazin', 'Mazin', false);
  await mazin.waitFor(function () { return Object.keys(mazin.S().sites).length === 1; }, 'site visible');
  await mazin.addEntry({ type: 'Expense', amount: 450, site: 'Old Name', category: 'Transport', person: 'Mazin', party: 'Auto' });
  await until(function () { return entriesOf(w).length === 1; }, 'saved');
  await mazin.tab('entries');
  await openRow(mazin, 'Auto');
  mazin.click('act-edit');
  await mazin.waitFor(function () { return mazin.t('entry-form'); }, 'edit form');
  assert.strictEqual(mazin.t('amount').value, '450');
  mazin.type('amount', '500');
  mazin.click('save');
  await until(function () { return entriesOf(w)[0]['Amount (\u20B9)'] === 500; }, 'edit reached the server');
  const row = entriesOf(w)[0];
  assert.strictEqual(row['Edited by'], 'Mazin');
  const hist = JSON.parse(row['Edit history (system)']);
  assert.strictEqual(hist.length, 2);
  assert.deepStrictEqual(hist[1].c, [{ f: 'amount', from: '450', to: '500' }]);
  await ameen.tab('entries');
  await openRow(ameen, 'Auto');
  assert.ok(/amount: \u20B9450 \u2192 \u20B9500/.test(ameen.text()), 'history visible to admin');
  await closeSheets(ameen);
  // rename the site as admin
  w.server.call('saveSite', [w.server.auth('Ameen', true), { id: w.server.table('Sites')[0]['ID (system)'], name: 'New Name', status: 'Active', contract: 100000 }]);
  assert.strictEqual(entriesOf(w)[0]['Site'], 'New Name');
  await mazin.waitFor(function () { return Object.values(mazin.S().entries)[0].site === 'New Name'; }, 'Mazin sees the renamed site on the entry');
  assert.ok(/site renamed/.test(entriesOf(w)[0]['Edit history (system)']));
  w.end();
});

test('Ledger audit spots hand-edited and deleted sheet rows', async function () {
  const w = await world();
  const ameen = await w.phone('Ameen', 'Ameen', true);
  await createSite(ameen, { name: 'Audit Site' });
  for (const amt of [100, 200, 300]) await ameen.addEntry({ type: 'Expense', amount: amt, site: 'Audit Site', category: 'Misc', person: 'Ameen' });
  await until(function () { return entriesOf(w).length === 3; }, 'three saved');
  await ameen.tab('more');
  ameen.click('audit');
  await ameen.waitFor(function () { return ameen.t('audit-ok'); }, 'clean audit');
  const sh = w.server.entriesSheet();
  sh.getRange(3, 5).setValue(999999); // amount of V-0002 changed by hand
  ameen.click('audit');
  await ameen.waitFor(function () { return ameen.t('audit-bad') && /V-0002/.test(ameen.mainText()); }, 'tampered row reported');
  sh.getRange(4, 1, 1, 27).setValues([new Array(27).fill('')]); // V-0003 wiped
  ameen.click('audit');
  await ameen.waitFor(function () { return /V-0003/.test(ameen.mainText()) && /missing/.test(ameen.mainText()); }, 'deleted row reported');
  w.end();
});

test('Formatting and CSV helpers', async function () {
  const w = await world();
  const p = await w.phone('Ameen', 'Ameen', true);
  const win = p.window;
  assert.strictEqual(win.inr(123456), '\u20B91,23,456');
  assert.strictEqual(win.inr(15350), '\u20B915,350');
  assert.strictEqual(win.inr(999), '\u20B9999');
  assert.strictEqual(win.inr(12345678), '\u20B91,23,45,678');
  assert.strictEqual(win.inr(1250.5), '\u20B91,250.50');
  assert.strictEqual(win.inr(-4500), '\u22124,500'.replace('\u2212', '\u2212\u20B9').replace('\u2212\u20B94,500', '\u2212\u20B94,500'));
  assert.strictEqual(win.fmtDate(new Date().getFullYear() + '-10-12'), '12 Oct');
  const csv = win.entriesCsv([{ voucher: 'V-0001', date: '2026-10-12', type: 'Expense', site: 'A, B', amount: 450, category: 'Misc', party: '=cmd()', person: 'X', mode: 'Cash', note: 'say "hi"\nnext', enteredBy: 'M', enteredAt: '', checked: false, deleted: false, billUrl: '' }]);
  assert.ok(/"A, B"/.test(csv));
  assert.ok(/'=cmd\(\)/.test(csv), 'formula guarded');
  assert.ok(/"say ""hi""\nnext"/.test(csv));
  assert.ok(/,450,/.test(csv));
  w.end();
});

(async function main() {
  const only = process.argv[2];
  let failed = 0;
  console.log('Scenarios');
  for (const t of tests) {
    if (only && t[0].toLowerCase().indexOf(only.toLowerCase()) < 0) continue;
    const t0 = Date.now();
    try {
      await t[1]();
      console.log('  PASS  ' + t[0] + '  (' + (Date.now() - t0) + ' ms)');
    } catch (e) {
      failed++;
      console.log('  FAIL  ' + t[0] + '\n        ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n        '));
    }
  }
  console.log(failed ? '\n' + failed + ' scenario(s) FAILED' : '\nAll scenarios passed');
  process.exit(failed ? 1 : 0);
})();

