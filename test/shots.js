'use strict';
// Real-browser run: the actual index.html in Chromium (Playwright) against the mocked server, with layout checks and screenshots.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createServer, ROOT } = require('./lib/server');

const OUT = path.join(__dirname, 'shots');
const INDEX = 'file:///' + path.join(ROOT, 'src', 'index.html').replace(/\\/g, '/');
fs.mkdirSync(OUT, { recursive: true });

function seed(server) {
  const adm = server.auth('Ameen', true), mz = server.auth('Mazin', false), sf = server.auth('Shafeeq', false);
  server.call('hello', [mz, 'Mazin']); server.call('hello', [sf, 'Shafeeq']); server.call('hello', [adm, 'Ameen']);
  const mk = function (n, c, ct, v) { return server.call('saveSite', [adm, { name: n, client: c, location: 'Mangaluru', contract: ct, status: 'Active', note: '' }]); };
  mk('Shetty Residence, Kadri', 'Mr. Shetty', 2850000);
  mk('Coastal Bakes Showroom', 'Coastal Bakes LLP', 1200000);
  mk('D\'Souza Interiors', 'Mrs. D\'Souza', 640000);
  const day = function (n) { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const E = [
    [adm, 'Received', 'Shetty Residence, Kadri', 500000, '', 'Mr. Shetty', 'Ameen', 'Bank transfer', 'First instalment', 12],
    [adm, 'Received', 'Coastal Bakes Showroom', 300000, '', 'Coastal Bakes LLP', 'Ameen', 'Cheque', '', 9],
    [adm, 'Cash to staff', '', 20000, '', '', 'Mazin', 'Cash', 'Site petty cash', 6],
    [mz, 'Expense', 'Shetty Residence, Kadri', 3450, 'Material', 'Sri Ganesh Hardware', 'Mazin', 'Cash', 'Screws, fevicol, sandpaper', 5],
    [mz, 'Expense', 'Shetty Residence, Kadri', 1200, 'Labour', 'Day workers (4)', 'Mazin', 'Cash', '', 5],
    [sf, 'Expense', 'Coastal Bakes Showroom', 18500, 'Carpenter', 'Hameed Carpenter', 'Office / Bank', 'UPI', 'Counter frame advance', 3],
    [mz, 'Expense', 'Shetty Residence, Kadri', 450, 'Food / tea', 'Tea stall', 'Mazin', 'UPI', 'Tea and transport', 1],
    [sf, 'Expense', 'Coastal Bakes Showroom', 42000, 'Glass / aluminium', 'Mangala Glass House', 'Office / Bank', 'Bank transfer', 'Glass shutters', 1],
    [adm, 'Expense', 'D\'Souza Interiors', 7800, 'Electrical', 'Kudla Electricals', 'Ameen', 'UPI', '', 0],
    [mz, 'Returned', '', 2000, '', '', 'Mazin', 'Cash', 'Unspent', 0]
  ];
  E.forEach(function (e, i) {
    const r = server.call('saveEntry', [e[0], { clientRef: 'seed' + i, type: e[1], site: e[2], amount: e[3], category: e[4], party: e[5], person: e[6], mode: e[7], note: e[8], date: day(e[9]) }, null]);
    if (!r.ok) throw new Error('seed failed: ' + JSON.stringify(r));
    if (i < 4) server.call('setChecked', [adm, r.entry.id, true]);
  });
}

async function layoutChecks(page, label, problems) {
  const r = await page.evaluate(function () {
    const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, small: [] };
    const vis = function (el) { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    document.querySelectorAll('button, select, input:not([type=file]):not([hidden]), a.btn, textarea').forEach(function (el) {
      if (!vis(el) || el.closest('[hidden]')) return;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || (el.tagName === 'BUTTON' && r.width < 43.5)) {
        const sheetBack = el.closest('.sheet-back');
        out.small.push((el.getAttribute('data-t') || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    });
    document.querySelectorAll('.sheet-body, main').forEach(function (b) {
      if (b.scrollWidth > b.clientWidth + 1) {
        const lim = b.getBoundingClientRect().right;
        const off = [];
        b.querySelectorAll('*').forEach(function (el) { const rr = el.getBoundingClientRect(); if (rr.right > lim + 1 && off.length < 5) off.push(el.tagName + '.' + el.className + ' [' + (el.getAttribute('data-t') || '') + '] w=' + Math.round(rr.width)); });
        out.sheetOverflow = (out.sheetOverflow || '') + b.className + ' overflows by ' + (b.scrollWidth - b.clientWidth) + 'px: ' + off.join('; ');
      }
    });
    return out;
  });
  if (r.sheetOverflow) problems.push(label + ': ' + r.sheetOverflow);
  if (r.overflow > 1) problems.push(label + ': horizontal overflow of ' + r.overflow + 'px');
  if (r.small.length) problems.push(label + ': touch targets under 44px: ' + r.small.slice(0, 6).join(', '));
}

(async function main() {
  const browser = await chromium.launch();
  const problems = [];
  const written = [];
  const runs = [
    { vp: 'phone', width: 390, height: 844, scheme: 'light' }, { vp: 'phone', width: 390, height: 844, scheme: 'dark' },
    { vp: 'desktop', width: 1280, height: 800, scheme: 'light' }, { vp: 'desktop', width: 1280, height: 800, scheme: 'dark' }
  ];
  for (const run of runs) {
    const server = createServer();
    seed(server);
    const ctx = await browser.newContext({ viewport: { width: run.width, height: run.height }, colorScheme: run.scheme, deviceScaleFactor: 2, hasTouch: run.vp === 'phone', isMobile: run.vp === 'phone' });
    const page = await ctx.newPage();
    global.__page = page;
    const errs = [];
    page.on('pageerror', function (e) { errs.push('pageerror: ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    await page.exposeFunction('__serverCall', function (name, args) { return server.call(name, args); });
    await page.addInitScript(function () {
      localStorage.setItem('wsa_pin', '4321'); localStorage.setItem('wsa_name', 'Ameen'); localStorage.setItem('wsa_admin', '8888');
      function build(ok, bad) {
        return new Proxy({}, { get: function (_, p) {
          if (p === 'withSuccessHandler') return function (f) { return build(f, bad); };
          if (p === 'withFailureHandler') return function (f) { return build(ok, f); };
          return function () { const a = Array.prototype.slice.call(arguments); window.__serverCall(String(p), a).then(function (r) { ok && ok(r); }, function (e) { bad && bad(e); }); };
        } });
      }
      window.google = { script: { run: build(null, null) } };
    });
    await page.goto(INDEX);
    await page.waitForSelector('[data-t="btn-expense"]');
    await page.waitForFunction(function () { return window.__wsa && window.__wsa.S.loaded && document.querySelectorAll('[data-t="entry-row"]').length > 0; });
    await page.waitForTimeout(400);
    const tag = run.vp + '-' + run.scheme;
    const shot = async function (name, full) {
      const f = path.join(OUT, tag + '-' + name + '.png');
      await page.screenshot({ path: f, fullPage: !!full });
      written.push(f);
    };
    // home
    await layoutChecks(page, tag + ' home', problems);
    await shot('1-home', true);
    // entry form
    await page.click('[data-t="btn-expense"]');
    await page.waitForSelector('[data-t="entry-form"]');
    await page.fill('[data-t="amount"]', '450');
    await page.selectOption('[data-t="site"]', 'Shetty Residence, Kadri');
    await page.click('[data-t="cat"]:has-text("Food / tea")');
    await page.fill('[data-t="party"]', 'Tea stall');
    await layoutChecks(page, tag + ' form before person', problems);
    await page.click('[data-t="person"]:text-is("Mazin")');
    await page.click('[data-t="mode"]:text-is("UPI")');
    await page.waitForTimeout(150);
    await layoutChecks(page, tag + ' entry form', problems);
    await shot('2-entry-form', false);
    await page.evaluate(function () { document.querySelector('.sheet-body').scrollTop = 9999; });
    await page.waitForTimeout(100);
    await shot('2b-entry-form-bottom', false);
    await page.click('[data-t="sheet-close"]');
    // entries
    await page.click('[data-t="tab-entries"]');
    await page.waitForSelector('[data-t="kind-all"]');
    await layoutChecks(page, tag + ' entries', problems);
    await shot('3-entries', true);
    // entry detail
    await page.click('[data-t="entry-row"] >> nth=2');
    await page.waitForSelector('[data-t="entry-detail"]');
    await layoutChecks(page, tag + ' entry detail', problems);
    await shot('3b-entry-detail', false);
    await page.click('[data-t="sheet-close"]');
    // site detail
    await page.click('[data-t="tab-sites"]');
    await page.click('[data-t="site-card"] >> nth=0');
    await page.waitForSelector('[data-t="site-detail"]');
    await layoutChecks(page, tag + ' site detail', problems);
    await shot('4-site-detail', false);
    await page.click('[data-t="sheet-close"]');
    // cash + more (phone light only, for the record)
    await page.click('[data-t="tab-cash"]');
    await layoutChecks(page, tag + ' cash', problems);
    if (run.scheme === 'light') await shot('5-cash', true);
    await page.click('[data-t="tab-more"]');
    await layoutChecks(page, tag + ' more', problems);
    if (run.scheme === 'light') await shot('6-more', true);
    errs.forEach(function (e) { problems.push(tag + ': ' + e); });
    await ctx.close();
  }
  await browser.close();
  console.log('Screenshots written to test/shots (' + written.length + ' files)');
  if (problems.length) {
    console.log('Layout problems:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log('Layout checks passed: no horizontal overflow, all touch targets at least 44px, no browser errors');
})().catch(async function (e) { console.error(e.message.split('\n').slice(0, 6).join('\n')); try { await global.__page.screenshot({ path: path.join(OUT, 'FAIL.png') }); } catch (x) { } process.exit(1); });
