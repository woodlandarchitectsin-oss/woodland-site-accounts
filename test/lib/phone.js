'use strict';
// A "phone" = the real index.html running in jsdom, talking to the mocked server through a fake google.script.run.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { ROOT } = require('./server');

const INDEX = path.join(ROOT, 'src', 'index.html');
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function makeRun(server, net) {
  function build(success, failure) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return build(fn, failure); };
        if (prop === 'withFailureHandler') return function (fn) { return build(success, fn); };
        return function () {
          const args = Array.prototype.slice.call(arguments);
          net.calls.push(String(prop));
          setTimeout(function () {
            if (net.offline) { failure && failure(new Error('NetworkError: failed to fetch')); return; }
            if (net.hang) return;
            let res;
            try { res = server.call(String(prop), args); } catch (e) { failure && failure(new Error('Exception: ' + e.message)); return; }
            if (net.dropReplies > 0) { net.dropReplies--; failure && failure(new Error('NetworkError: connection lost')); return; }
            setTimeout(function () { if (success) success(res); }, net.latency);
          }, net.latency);
        };
      }
    });
  }
  return build(null, null);
}

async function openPhone(server, o) {
  o = o || {};
  const net = Object.assign({ offline: false, hang: false, latency: 3, calls: [], dropReplies: 0 }, o.net || {});
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', function (e) { if (!/Not implemented/.test(String(e && e.message))) errors.push('jsdomError: ' + (e && e.stack || e)); });
  vc.on('error', function (m) { errors.push('console.error: ' + m); });
  const html = fs.readFileSync(INDEX, 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://n-test-script.googleusercontent.com/userCodeAppPanel',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.google = { script: { run: makeRun(server, net) } };
      w.__WSA_CFG = Object.assign({ pollMs: 250, timeoutMs: 1500, retryMs: 10, netRetryMs: 40 }, o.cfg || {});
      Object.defineProperty(w.navigator, 'onLine', { get: function () { return !net.offline; }, configurable: true });
      w.scrollTo = function () { };
      w.addEventListener('error', function (ev) { errors.push('window error: ' + ev.message); });
      if (o.storage) Object.keys(o.storage).forEach(function (k) { w.localStorage.setItem(k, o.storage[k]); });
    }
  });
  const w = dom.window, d = w.document;
  const phone = {
    window: w, document: d, net, errors, name: o.label || '?',
    q(sel) { return d.querySelector(sel); },
    qa(sel) { return Array.from(d.querySelectorAll(sel)); },
    t(id) { return d.querySelector('[data-t="' + id + '"]'); },
    ta(id) { return Array.from(d.querySelectorAll('[data-t="' + id + '"]')); },
    text() { return d.body.textContent.replace(/\s+/g, ' '); },
    mainText() { return d.getElementById('main').textContent.replace(/\s+/g, ' '); },
    status() { return d.getElementById('statustext').textContent; },
    click(x) { const el = typeof x === 'string' ? (this.t(x) || d.querySelector(x)) : x; if (!el) throw new Error(this.name + ': nothing to click for ' + x + '\n' + this.text().slice(0, 400)); el.click(); },
    type(x, v) {
      const el = typeof x === 'string' ? (this.t(x) || d.querySelector(x)) : x;
      if (!el) throw new Error(this.name + ': no field ' + x);
      el.value = v;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    select(x, v) { const el = this.t(x); el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    async waitFor(fn, what, ms) {
      const end = Date.now() + (ms || 4000);
      for (;;) {
        let v; try { v = fn(); } catch (e) { v = false; }
        if (v) return v;
        if (Date.now() > end) throw new Error(this.name + ': timed out waiting for ' + what + '\nSCREEN: ' + this.text().slice(0, 600));
        await sleep(15);
      }
    },
    async settle(ms) { await sleep(ms || 60); },
    async login(pin, nameText) {
      await this.waitFor(function () { return phone.t('pin-input'); }, 'PIN screen');
      this.type('pin-input', pin);
      this.click('pin-go');
      await this.waitFor(function () { return phone.t('name-input'); }, 'name screen');
      this.type('name-input', nameText);
      this.click('name-go');
      await this.waitFor(function () { return !d.getElementById('app').hidden && phone.t('tab-home') && !phone.t('loading'); }, 'home screen');
    },
    async tab(name) { this.click('tab-' + name); await this.settle(20); },
    async unlockAdmin(adminPin) {
      await this.tab('more');
      this.type('admin-pin', adminPin);
      this.click('admin-unlock');
      await this.waitFor(function () { return phone.t('admin-lock'); }, 'admin unlocked');
      await this.tab('home');
    },
    // fills the entry form through the real UI
    async addEntry(e) {
      const homeBtn = { 'Expense': 'btn-expense', 'Received': 'btn-received', 'Cash to staff': 'btn-cashout', 'Returned': 'btn-returned' }[e.type];
      await this.tab('home');
      this.click(homeBtn);
      await this.waitFor(function () { return phone.t('entry-form'); }, 'entry form');
      this.type('amount', String(e.amount));
      if (e.site) { this.select('site', e.site); }
      if (e.category) this.chipClick('cat', e.category);
      if (e.person) this.chipClick('person', e.person);
      if (e.mode) this.chipClick('mode', e.mode);
      if (e.party) this.type('party', e.party);
      if (e.note) this.type('note', e.note);
      if (e.photo) await this.attachPhoto(e.photo);
      this.click(e.another ? 'save-another' : 'save');
      await this.settle(20);
      if (this.t('form-err') && this.t('form-err').textContent) throw new Error(this.name + ' form error: ' + this.t('form-err').textContent);
    },
    chipClick(kind, label) {
      const el = this.ta(kind).find(function (x) { return x.textContent === label; });
      if (!el) throw new Error(this.name + ': no ' + kind + ' chip "' + label + '"');
      el.click();
    },
    async attachPhoto(buf) {
      const file = new w.File([buf], 'bill.jpg', { type: 'image/jpeg' });
      const input = this.t('photo-gallery');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
      await this.waitFor(function () { return phone.q('[data-t="entry-form"] img.billimg'); }, 'photo preview');
    },
    goOffline() { net.offline = true; w.dispatchEvent(new w.Event('offline')); },
    goOnline() { net.offline = false; w.dispatchEvent(new w.Event('online')); },
    S() { return w.__wsa.S; },
    close() { dom.window.close(); },
    storageSnapshot() { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; }
  };
  return phone;
}

module.exports = { openPhone, sleep };
