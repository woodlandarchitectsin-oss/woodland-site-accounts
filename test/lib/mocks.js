'use strict';
// Minimal in-memory versions of the Google Apps Script services that Code.gs uses.
// They are deliberately strict (range bounds, nested locks) so real-world mistakes show up here.
const crypto = require('crypto');

function makeMocks() {
  const faults = { drive: 0, voucher: 0, driveAlways: false };
  const sheetsById = {};
  const filesById = {};
  const foldersById = {};
  let seq = 0;

  class Range {
    constructor(sheet, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Range: bad coordinates');
      if (r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      Object.assign(this, { sheet, r, c, nr, nc });
    }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) { const v = (this.sheet.grid[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); }
        out.push(row);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(v) {
      if (v.length !== this.nr || v.some(function (row) { return row.length !== v[0].length; }) || v[0].length !== this.nc) throw new Error('The number of rows/columns in the data does not match the range.');
      for (let i = 0; i < this.nr; i++) {
        const gr = this.sheet.grid[this.r - 1 + i] || (this.sheet.grid[this.r - 1 + i] = []);
        for (let j = 0; j < this.nc; j++) gr[this.c - 1 + j] = v[i][j];
      }
      return this;
    }
    setValue(x) { return this.setValues([[x]]); }
    setNumberFormat() { return this; }
    setNumberFormats() { return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
  }
  class Sheet {
    constructor(ss, name) { this.ss = ss; this.name = name; this.grid = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertRowsAfter(pos, n) { this.maxRows += n; }
    insertColumnsAfter(pos, n) { this.maxCols += n; }
    setFrozenRows(n) { this.frozen = n; }
    setColumnWidth() { }
    getLastRow() {
      for (let i = this.grid.length - 1; i >= 0; i--) if ((this.grid[i] || []).some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
      return 0;
    }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  }
  class Spreadsheet {
    constructor(name) { this.name = name; this.id = 'ss' + (++seq); this.sheets = [new Sheet(this, 'Sheet1')]; sheetsById[this.id] = this; }
    getSheets() { return this.sheets; }
    getSheetByName(n) { return this.sheets.find(function (s) { return s.name === n; }) || null; }
    insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  }
  const SpreadsheetApp = {
    create(name) { return new Spreadsheet(name); },
    openById(id) { if (!sheetsById[id]) throw new Error('No spreadsheet ' + id); return sheetsById[id]; }
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    getUuid() { return crypto.randomUUID(); },
    base64Decode(s) { return Array.from(Buffer.from(s, 'base64')).map(function (b) { return b > 127 ? b - 256 : b; }); },
    newBlob(bytes, mime, name) { return { bytes: bytes, mime: mime, name: name }; },
    computeDigest(alg, str) { return Array.from(crypto.createHash(alg).update(str, 'utf8').digest()).map(function (b) { return b > 127 ? b - 256 : b; }); },
    formatDate(d, tz, fmt) {
      if (tz !== 'Asia/Kolkata') throw new Error('mock supports Asia/Kolkata only');
      const t = new Date(d.getTime() + 330 * 60000);
      const p = function (n) { return String(n).padStart(2, '0'); };
      const date = t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
      if (fmt === 'yyyy-MM-dd') return date;
      if (fmt === 'yyyy-MM-dd HH:mm:ss') return date + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
      throw new Error('mock formatDate: ' + fmt);
    }
  };

  class File {
    constructor(blob, folder) { this.id = 'f' + (++seq); this.blob = blob; this.name = blob.name; this.folder = folder; this.sharing = null; filesById[this.id] = this; }
    getId() { return this.id; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
    setSharing(a, p) { this.sharing = [a, p]; return this; }
    setName(n) { this.name = n; return this; }
  }
  class Folder {
    constructor(name) { this.name = name; this.id = 'fo' + (++seq); this.files = []; foldersById[this.id] = this; }
    getId() { return this.id; }
    createFile(blob) {
      if (faults.driveAlways || faults.drive > 0) { faults.drive = Math.max(0, faults.drive - 1); throw new Error('Exception: Service error: Drive'); }
      const f = new File(blob, this); this.files.push(f); return f;
    }
  }
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    createFolder(n) { return new Folder(n); },
    getFolderById(id) { if (!foldersById[id]) throw new Error('No folder ' + id); return foldersById[id]; }
  };

  const propStore = {};
  const props = {
    getProperty(k) { return Object.prototype.hasOwnProperty.call(propStore, k) ? propStore[k] : null; },
    setProperty(k, v) { if (k === 'VOUCHER_SEQ' && faults.voucher > 0) { faults.voucher--; throw new Error('Exception: property service failed'); } propStore[k] = String(v); return props; },
    setProperties(o) { Object.keys(o).forEach(function (k) { propStore[k] = String(o[k]); }); return props; }
  };
  const PropertiesService = { getScriptProperties() { return props; } };

  let held = false;
  const LockService = {
    getScriptLock() {
      return {
        waitLock() { if (held) throw new Error('Lock already held (nested lock would deadlock in real Apps Script)'); held = true; },
        releaseLock() { held = false; }
      };
    }
  };
  const cacheStore = {};
  const net = { handler: null, calls: [] };
  const UrlFetchApp = { fetch(url, opts) { net.calls.push({ url: url, opts: opts }); if (!net.handler) throw new Error('no network in tests'); const body = net.handler(url, JSON.parse(opts.payload)); return { getContentText() { return typeof body === 'string' ? body : JSON.stringify(body); } }; } };
  const CacheService = { getScriptCache() { return { get(k) { return cacheStore[k] === undefined ? null : cacheStore[k]; }, put(k, v) { cacheStore[k] = String(v); }, remove(k) { delete cacheStore[k]; } }; } };
  const Session = { getActiveUser() { return { getEmail() { return 'owner@example.com'; } }; }, getEffectiveUser() { return { getEmail() { return 'owner@example.com'; } }; } };
  const metaTags = [];
  const HtmlService = {
    createHtmlOutputFromFile(name) {
      const o = { name: name, title: '', setTitle(t) { o.title = t; return o; }, addMetaTag(k, v) { metaTags.push([k, v]); return o; } };
      return o;
    }
  };
  const Logger = { log() { } };

  return {
    globals: { ContentService: { MimeType: { JSON: "json" }, createTextOutput(t) { return { getContent() { return t; }, setMimeType() { return this; } }; } }, UrlFetchApp, SpreadsheetApp, Utilities, DriveApp, PropertiesService, LockService, CacheService, Session, HtmlService, Logger, console: { log() { }, error() { }, warn() { } } },
    faults, net, sheetsById, filesById, foldersById, props, propStore, cacheStore, metaTags,
    isLocked() { return held; }
  };
}

module.exports = { makeMocks };


