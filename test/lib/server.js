'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMocks } = require('./mocks');

const ROOT = path.join(__dirname, '..', '..');
const CODE = path.join(ROOT, 'src', 'Code.gs');

function createServer(opts) {
  opts = opts || {};
  const mocks = makeMocks();
  const ctx = vm.createContext(Object.assign({}, mocks.globals));
  vm.runInContext(fs.readFileSync(CODE, 'utf8'), ctx, { filename: 'Code.gs' });
  mocks.props.setProperties({ TEAM_PIN: opts.teamPin || '4321', ADMIN_PIN: opts.adminPin || '8888' });
  const calls = [];
  function call(name, args) {
    if (typeof ctx[name] !== 'function') throw new Error('No such server function: ' + name);
    calls.push(name);
    const a = JSON.parse(JSON.stringify(args));
    const r = ctx[name].apply(null, a);
    return JSON.parse(JSON.stringify(r === undefined ? null : r));
  }
  function entriesSheet() { return mocks.sheetsById[mocks.propStore.SHEET_ID].getSheetByName('Entries'); }
  function table(sheetName) {
    const sh = mocks.sheetsById[mocks.propStore.SHEET_ID].getSheetByName(sheetName);
    const last = sh.getLastRow();
    if (last < 1) return [];
    const heads = sh.getRange(1, 1, 1, sh.grid[0].length).getValues()[0];
    const out = [];
    for (let r = 2; r <= last; r++) {
      const row = sh.getRange(r, 1, 1, heads.length).getValues()[0];
      const o = {};
      heads.forEach(function (h, i) { o[h] = row[i]; });
      out.push(o);
    }
    return out;
  }
  return { call, ctx, mocks, calls, entriesSheet, table, auth: function (name, admin) { return { pin: opts.teamPin || '4321', admin: admin ? (opts.adminPin || '8888') : '', name: name }; } };
}

module.exports = { createServer, ROOT };
