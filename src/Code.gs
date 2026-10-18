// Woodland Site Accounts - server (Google Apps Script, V8)
// Public functions (no trailing underscore) can be called by the web page.
// Every API function takes an auth object {pin, admin, name} and checks it on the server.

var APP_VERSION = '1.0.0';
var TZ = 'Asia/Kolkata';
var SHEET_TITLE = 'Woodland Site Accounts — data';
var FOLDER_TITLE = 'Woodland Site Accounts — bills';
var TYPES = ['Expense', 'Received', 'Cash to staff', 'Returned'];
var MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque'];
var SITE_STATUS = ['Active', 'Completed', 'On hold'];
var OFFICE = 'Office / Bank';
var DEFAULT_CATEGORIES = ['Material', 'Labour', 'Carpenter', 'Electrical', 'Plumbing', 'Painting', 'Tiles / granite', 'Glass / aluminium', 'Hardware', 'Transport', 'Contractor payment', 'Food / tea', 'Misc'];
var PHOTO_MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
var MAX_CELL = 49000;
var MAX_PHOTO_CHARS = 7000000;
var MAX_FAILS = 25;
var PROJECT_OS_URL = 'https://script.google.com/macros/s/AKfycbxR4m5jgaS7zMm0f_L6H2Tw3SBrNpQjl_mdrc8g_xr3TfnZsc4lW4CgdLOMOFtshiZS/exec';

// ---- table definitions: [key, header, number format, column width] ----
var E_DEF = tableDef_([
  ['voucher', 'Voucher', '@', 80],
  ['date', 'Date', '@', 90],
  ['type', 'Type', '@', 100],
  ['site', 'Site', '@', 150],
  ['amount', 'Amount (₹)', '#,##0.00', 100],
  ['category', 'Category', '@', 120],
  ['party', 'Paid to / received from', '@', 160],
  ['person', 'Paid by / received by / staff', '@', 160],
  ['mode', 'Mode', '@', 100],
  ['note', 'Note', '@', 220],
  ['enteredBy', 'Entered by', '@', 110],
  ['enteredAt', 'Entered at', '@', 135],
  ['editedBy', 'Edited by', '@', 110],
  ['editedAt', 'Edited at', '@', 135],
  ['checked', 'Checked', '@', 70],
  ['checkedBy', 'Checked by', '@', 100],
  ['checkedAt', 'Checked at', '@', 135],
  ['deleted', 'Deleted', '@', 70],
  ['deletedBy', 'Deleted by', '@', 100],
  ['deletedAt', 'Deleted at', '@', 135],
  ['billUrl', 'Bill photo', '@', 200],
  ['id', 'ID (system)', '@', 110],
  ['billId', 'Bill file ID (system)', '@', 110],
  ['clientRef', 'Client ref (system)', '@', 110],
  ['updatedAt', 'Updated ms (system)', '0', 120],
  ['history', 'Edit history (system)', '@', 260],
  ['seal', 'Seal (system)', '@', 120]
]);
var S_DEF = tableDef_([
  ['name', 'Site', '@', 170],
  ['client', 'Client', '@', 150],
  ['location', 'Location', '@', 150],
  ['contract', 'Contract value (₹)', '#,##0.00', 130],
  ['status', 'Status', '@', 90],
  ['note', 'Note', '@', 220],
  ['createdBy', 'Created by', '@', 110],
  ['createdAt', 'Created at', '@', 135],
  ['updatedBy', 'Updated by', '@', 110],
  ['updatedStamp', 'Updated at', '@', 135],
  ['id', 'ID (system)', '@', 110],
  ['updatedAt', 'Updated ms (system)', '0', 120],
  ['projectId', 'Project OS ID', '@', 90]
]);
var L_DEF = tableDef_([
  ['kind', 'List', '@', 90],
  ['name', 'Name', '@', 200],
  ['active', 'Active', '@', 70],
  ['addedBy', 'Added by', '@', 110],
  ['addedAt', 'Added at', '@', 135],
  ['updatedAt', 'Updated ms (system)', '0', 120]
]);
var CTX_ = null;

function tableDef_(fields) {
  var d = { keys: [], heads: [], fmts: [], widths: [], idx: {}, n: fields.length };
  for (var i = 0; i < fields.length; i++) {
    d.keys.push(fields[i][0]);
    d.heads.push(fields[i][1]);
    d.fmts.push(fields[i][2]);
    d.widths.push(fields[i][3]);
    d.idx[fields[i][0]] = i;
  }
  return d;
}

// ================= web app entry =================
function doGet() {
  var out = HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Woodland Site Accounts')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  var extra = { 'theme-color': '#1f5f3f', 'mobile-web-app-capable': 'yes', 'apple-mobile-web-app-capable': 'yes' };
  for (var k in extra) {
    try { out.addMetaTag(k, extra[k]); } catch (e) { }
  }
  return out;
}

// ================= JSON endpoint for the GitHub Pages copy of the app =================
// The same page can be opened from Google's link (it calls the functions directly) or from GitHub Pages (it posts here).
// Only these functions can be reached, and each one still checks the PIN itself, exactly as before.
function doPost(e) {
  var fns = { hello: hello, loadAll: loadAll, changesSince: changesSince, saveEntry: saveEntry, setChecked: setChecked, deleteEntry: deleteEntry, restoreEntry: restoreEntry, saveSite: saveSite, syncProjects: syncProjects, saveSettings: saveSettings, auditLedger: auditLedger };
  var r;
  try {
    var req = JSON.parse(e.postData.contents);
    if (!req || typeof req.fn !== 'string' || !fns.hasOwnProperty(req.fn) || !Array.isArray(req.args)) r = { ok: false, error: 'invalid', message: 'Unknown request.' };
    else r = fns[req.fn].apply(null, req.args);
  } catch (err) { r = { ok: false, error: 'server', message: 'Server error: ' + String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(r === undefined ? null : r)).setMimeType(ContentService.MimeType.JSON);
}

// ================= one-time setup (run from the script editor) =================
function setPins() {
  // 1. Type your two PINs between the quotes below.  2. Press Run.  3. Undo your typing (Ctrl+Z) afterwards.
  var TEAM = 'ENTER-TEAM-PIN';
  var ADMIN = 'ENTER-ADMIN-PIN';
  if (TEAM === 'ENTER-TEAM-PIN' || ADMIN === 'ENTER-ADMIN-PIN') throw new Error('Type your PINs inside the quotes in setPins() first, then press Run.');
  if (String(TEAM).length < 4 || String(ADMIN).length < 4) throw new Error('Use at least 4 characters for each PIN.');
  if (TEAM === ADMIN) throw new Error('Team PIN and admin PIN must be different.');
  var p = PropertiesService.getScriptProperties();
  p.setProperty('TEAM_PIN', String(TEAM));
  p.setProperty('ADMIN_PIN', String(ADMIN));
  if (!p.getProperty('SEAL_KEY')) p.setProperty('SEAL_KEY', Utilities.getUuid() + Utilities.getUuid());
  CTX_ = null;
  var c = ctx_();
  Logger.log('PINs saved. Data sheet: ' + c.ss.getUrl());
  Logger.log('Now undo the PINs you typed in setPins() (Ctrl+Z) so they are not left in the code.');
}

// ================= helpers =================
function props_() { return PropertiesService.getScriptProperties(); }

function fail_(code, msg) {
  var e = new Error(msg);
  e.code = code;
  throw e;
}

function api_(auth, fn) {
  CTX_ = null;
  try {
    var who = authorize_(auth);
    return fn(who);
  } catch (e) {
    if (e && e.code) return { ok: false, error: e.code, message: e.message };
    try { console.error(e && e.stack || e); } catch (x) { }
    return { ok: false, error: 'server', message: 'Server error: ' + String(e && e.message || e) };
  }
}

function clean_(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.substring(0, max) : s;
}

function cleanNote_(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\r/g, '').trim();
  return s.length > max ? s.substring(0, max) : s;
}

function capCell_(v) {
  if (typeof v === 'string' && v.length > MAX_CELL) return v.substring(0, MAX_CELL);
  return v;
}

function safeEq_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function fails_() {
  var v = CacheService.getScriptCache().get('pinfails');
  return v ? Number(v) || 0 : 0;
}

function authorize_(auth) {
  auth = auth || {};
  var p = props_();
  var team = p.getProperty('TEAM_PIN');
  var admin = p.getProperty('ADMIN_PIN');
  if (!team || !admin) fail_('setup', 'The app is not set up yet. The owner must run setPins() in the script editor.');
  if (fails_() >= MAX_FAILS) fail_('locked_out', 'Too many wrong PINs. Try again in 15 minutes.');
  var teamOk = safeEq_(auth.pin || '', team);
  if (!teamOk) {
    CacheService.getScriptCache().put('pinfails', String(fails_() + 1), 900);
    fail_('pin', 'Wrong PIN.');
  }
  var isAdmin = false;
  if (auth.admin) {
    isAdmin = safeEq_(auth.admin, admin);
    if (!isAdmin) {
      CacheService.getScriptCache().put('pinfails', String(fails_() + 1), 900);
      fail_('adminpin', 'Wrong admin PIN.');
    }
  }
  return { name: clean_(auth.name, 40), isAdmin: isAdmin };
}

function needName_(who) {
  if (!who.name) fail_('name', 'Please set your name first (More > Change my name).');
}

function lock_() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { fail_('busy', 'The server is busy. Try again in a moment.'); }
  return lock;
}

function stamp_(ms) { return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 10); }

function sameName_(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

function isDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = Number(s.substring(0, 4)), m = Number(s.substring(5, 7)), d = Number(s.substring(8, 10));
  if (y < 2000 || y > 2100) return false;
  var t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function cell_(v, key) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, key === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  return v;
}

function objOf_(def, row) {
  var o = {};
  for (var i = 0; i < def.n; i++) o[def.keys[i]] = cell_(row[i], def.keys[i]);
  return o;
}

function rowOf_(def, o) {
  var r = [];
  for (var i = 0; i < def.n; i++) {
    var v = o[def.keys[i]];
    r.push(capCell_(v === undefined || v === null ? '' : v));
  }
  return r;
}

// ---- sheet plumbing ----
function ensureSize_(sheet, rows, cols) {
  if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows() + 200);
}

function initSheet_(sheet, def) {
  ensureSize_(sheet, 1000, def.n);
  var head = sheet.getRange(1, 1, 1, def.n);
  head.setNumberFormat('@');
  head.setValues([def.heads]);
  head.setFontWeight('bold');
  head.setBackground('#e9e5dc');
  sheet.setFrozenRows(1);
  for (var c = 0; c < def.n; c++) {
    sheet.getRange(2, c + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(def.fmts[c]);
    sheet.setColumnWidth(c + 1, def.widths[c]);
  }
}

function createSheet_() {
  var ss = SpreadsheetApp.create(SHEET_TITLE);
  var first = ss.getSheets()[0];
  first.setName('Entries');
  var sites = ss.insertSheet('Sites');
  var settings = ss.insertSheet('Settings');
  initSheet_(first, E_DEF);
  initSheet_(sites, S_DEF);
  initSheet_(settings, L_DEF);
  var now = Date.now();
  var rows = [];
  for (var i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    rows.push(rowOf_(L_DEF, { kind: 'category', name: DEFAULT_CATEGORIES[i], active: 'Yes', addedBy: 'System', addedAt: stamp_(now), updatedAt: now }));
  }
  settings.getRange(2, 1, rows.length, L_DEF.n).setValues(rows);
  return ss.getId();
}

function ctx_() {
  if (CTX_) return CTX_;
  var p = props_();
  var ssId = p.getProperty('SHEET_ID');
  var folderId = p.getProperty('FOLDER_ID');
  if (!ssId || !folderId) {
    var lock = lock_();
    try {
      ssId = p.getProperty('SHEET_ID');
      folderId = p.getProperty('FOLDER_ID');
      if (!ssId) { ssId = createSheet_(); p.setProperty('SHEET_ID', ssId); }
      if (!folderId) { folderId = DriveApp.createFolder(FOLDER_TITLE).getId(); p.setProperty('FOLDER_ID', folderId); }
    } finally { lock.releaseLock(); }
  }
  var ss = SpreadsheetApp.openById(ssId);
  CTX_ = { ss: ss, entries: ss.getSheetByName('Entries'), sites: ss.getSheetByName('Sites'), settings: ss.getSheetByName('Settings'), folderId: folderId };
  if (!p.getProperty('SITES_LINK_COL')) { addLinkColumn_(CTX_.sites); p.setProperty('SITES_LINK_COL', '1'); }
  return CTX_;
}

// Sheets made before the Project OS link have no 'Project OS ID' column: add its header once.
function addLinkColumn_(sheet) {
  var col = S_DEF.idx.projectId + 1;
  ensureSize_(sheet, 1000, S_DEF.n);
  var head = sheet.getRange(1, col);
  if (String(head.getValue()) === S_DEF.heads[S_DEF.idx.projectId]) return;
  head.setNumberFormat('@');
  head.setValue(S_DEF.heads[S_DEF.idx.projectId]);
  head.setFontWeight('bold');
  head.setBackground('#e9e5dc');
  sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.setColumnWidth(col, S_DEF.widths[S_DEF.idx.projectId]);
}

function readRows_(sheet, def) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, def.n).getValues();
}

function findRow_(sheet, def, key, value, ci) {
  var last = sheet.getLastRow();
  if (last < 2 || !value) return 0;
  var vals = sheet.getRange(2, def.idx[key] + 1, last - 1, 1).getValues();
  var want = ci ? String(value).toLowerCase() : String(value);
  for (var i = 0; i < vals.length; i++) {
    var got = String(vals[i][0]);
    if (ci) got = got.toLowerCase();
    if (got === want) return i + 2;
  }
  return 0;
}

function readRow_(sheet, def, rowNum) {
  return objOf_(def, sheet.getRange(rowNum, 1, 1, def.n).getValues()[0]);
}

function putRow_(sheet, def, rowNum, o) {
  ensureSize_(sheet, rowNum, def.n);
  var rng = sheet.getRange(rowNum, 1, 1, def.n);
  rng.setNumberFormats([def.fmts]);
  rng.setValues([rowOf_(def, o)]);
}

function touch_(ms) { props_().setProperty('LAST_CHANGE', String(ms)); }

// ---- seal: tamper evidence for edits made directly in the sheet ----
function sealKey_() {
  var p = props_();
  var k = p.getProperty('SEAL_KEY');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SEAL_KEY', k); }
  return k;
}

function sealOf_(o) {
  var parts = [];
  for (var i = 0; i < E_DEF.n; i++) {
    var k = E_DEF.keys[i];
    if (k === 'seal') continue;
    parts.push(String(cell_(o[k], k)));
  }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sealKey_() + '|' + parts.join('\u001f'), Utilities.Charset.UTF_8);
  var hex = '';
  for (var j = 0; j < bytes.length; j++) {
    var b = bytes[j] < 0 ? bytes[j] + 256 : bytes[j];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

// ---- history ----
function parseHistory_(s) {
  if (!s) return [];
  try { var h = JSON.parse(s); return Object.prototype.toString.call(h) === '[object Array]' ? h : []; } catch (e) { return []; }
}

function packHistory_(list) {
  var s = JSON.stringify(list);
  while (s.length > MAX_CELL - 2000 && list.length > 2) {
    list.splice(1, 1);
    s = JSON.stringify(list);
  }
  return s;
}

function addHistory_(o, who, now, action, changes) {
  var h = parseHistory_(o.history);
  var item = { t: stamp_(now), by: who.name || 'Admin', a: action };
  if (changes && changes.length) item.c = changes;
  h.push(item);
  o.history = packHistory_(h);
}

// ---- output shapes ----
function entryOut_(o) {
  return {
    id: String(o.id), voucher: String(o.voucher), clientRef: String(o.clientRef), date: String(o.date), type: String(o.type),
    site: String(o.site), amount: Number(o.amount) || 0, category: String(o.category), party: String(o.party), person: String(o.person),
    mode: String(o.mode), note: String(o.note), billUrl: String(o.billUrl), billId: String(o.billId),
    enteredBy: String(o.enteredBy), enteredAt: String(o.enteredAt), editedBy: String(o.editedBy), editedAt: String(o.editedAt),
    checked: o.checked === 'Yes', checkedBy: String(o.checkedBy), checkedAt: String(o.checkedAt),
    deleted: o.deleted === 'Yes', deletedBy: String(o.deletedBy), deletedAt: String(o.deletedAt),
    updatedAt: Number(o.updatedAt) || 0, history: parseHistory_(o.history)
  };
}

function entryFor_(o, isAdmin) {
  if (o.deleted === 'Yes' && !isAdmin) return { id: String(o.id), deleted: true, tombstone: true, updatedAt: Number(o.updatedAt) || 0 };
  return entryOut_(o);
}

function siteOut_(o) {
  return { id: String(o.id), name: String(o.name), client: String(o.client), location: String(o.location), contract: Number(o.contract) || 0, status: String(o.status) || 'Active', note: String(o.note), createdBy: String(o.createdBy), updatedAt: Number(o.updatedAt) || 0, projectId: String(o.projectId || '') };
}

function allSites_(c) {
  var rows = readRows_(c.sites, S_DEF), out = [];
  for (var i = 0; i < rows.length; i++) { var o = objOf_(S_DEF, rows[i]); if (o.id) out.push(siteOut_(o)); }
  return out;
}

function lists_(c) {
  var rows = readRows_(c.settings, L_DEF), people = [], cats = [];
  for (var i = 0; i < rows.length; i++) {
    var o = objOf_(L_DEF, rows[i]);
    if (o.active !== 'Yes') continue;
    if (o.kind === 'person') people.push(String(o.name));
    else if (o.kind === 'category') cats.push(String(o.name));
  }
  return { people: people, categories: cats };
}

// ---- validation ----
function validateEntry_(e) {
  e = e || {};
  var v = {};
  v.type = String(e.type || '');
  if (TYPES.indexOf(v.type) < 0) fail_('invalid', 'Choose a type: Expense, Received, Cash to staff or Returned.');
  var amt = typeof e.amount === 'string' ? Number(e.amount.replace(/,/g, '')) : Number(e.amount);
  if (!isFinite(amt) || amt <= 0) fail_('invalid', 'Amount must be more than zero.');
  if (amt > 100000000) fail_('invalid', 'Amount is too large.');
  v.amount = Math.round(amt * 100) / 100;
  v.date = String(e.date || '');
  if (!isDate_(v.date)) fail_('invalid', 'Date must be a real date (YYYY-MM-DD).');
  v.site = clean_(e.site, 80);
  if ((v.type === 'Expense' || v.type === 'Received') && !v.site) fail_('invalid', 'Choose the site.');
  v.category = clean_(e.category, 60);
  if (v.type === 'Expense' && !v.category) fail_('invalid', 'Choose a category.');
  if (v.type !== 'Expense') v.category = '';
  v.party = clean_(e.party, 80);
  v.person = clean_(e.person, 60);
  if (!v.person) fail_('invalid', 'Choose the person.');
  v.mode = String(e.mode || 'Cash');
  if (MODES.indexOf(v.mode) < 0) fail_('invalid', 'Choose a payment mode.');
  v.note = cleanNote_(e.note, 500);
  return v;
}

var EDIT_FIELDS = ['date', 'type', 'site', 'amount', 'category', 'party', 'person', 'mode', 'note'];

function uploadPhoto_(c, photo, v, ref) {
  var mime = String(photo.mime || '').toLowerCase();
  if (!PHOTO_MIMES[mime]) fail_('invalid', 'Photo must be JPG, PNG, WebP or HEIC.');
  var data = String(photo.data || '');
  if (!data || data.length > MAX_PHOTO_CHARS) fail_('invalid', 'Photo is too large.');
  var bytes = Utilities.base64Decode(data);
  var name = v.date + ' ' + (v.site || 'office') + ' ' + v.amount + ' ' + ref + '.' + PHOTO_MIMES[mime];
  var file = DriveApp.getFolderById(c.folderId).createFile(Utilities.newBlob(bytes, mime, name));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { }
  return { id: file.getId(), url: file.getUrl(), file: file };
}

function ensureSite_(c, name, who, now) {
  if (!name) return;
  if (findRow_(c.sites, S_DEF, 'name', name, true)) return;
  var row = sheetLast_(c.sites) + 1;
  putRow_(c.sites, S_DEF, row, { name: name, status: 'Active', createdBy: who.name, createdAt: stamp_(now), updatedBy: who.name, updatedStamp: stamp_(now), id: newId_('s'), updatedAt: now, contract: 0 });
}

function sheetLast_(sheet) { return Math.max(1, sheet.getLastRow()); }

function ensurePerson_(c, name, who, now) {
  if (!name || name === OFFICE) return false;
  var rows = readRows_(c.settings, L_DEF);
  for (var i = 0; i < rows.length; i++) {
    var o = objOf_(L_DEF, rows[i]);
    if (o.kind === 'person' && sameName_(o.name, name)) {
      if (o.active === 'Yes') return false;
      return false;
    }
  }
  putRow_(c.settings, L_DEF, sheetLast_(c.settings) + 1, { kind: 'person', name: name, active: 'Yes', addedBy: who.name || name, addedAt: stamp_(now), updatedAt: now });
  return true;
}

function nextVoucher_() {
  var p = props_();
  var n = Number(p.getProperty('VOUCHER_SEQ'));
  if (!n) {
    var c = ctx_();
    n = Math.max(0, c.entries.getLastRow() - 1);
  }
  n += 1;
  p.setProperty('VOUCHER_SEQ', String(n));
  var s = String(n);
  while (s.length < 4) s = '0' + s;
  return 'V-' + s;
}

// ================= API =================
function hello(auth, name) {
  return api_(auth, function (who) {
    var c = ctx_();
    var nm = clean_(name, 40);
    var changed = false;
    if (nm) {
      var lock = lock_();
      try { changed = ensurePerson_(c, nm, { name: nm }, Date.now()); if (changed) touch_(Date.now()); } finally { lock.releaseLock(); }
    }
    var l = lists_(c);
    var r = { ok: true, isAdmin: who.isAdmin, people: l.people, categories: l.categories, version: APP_VERSION, serverTime: Date.now() };
    if (who.isAdmin) r.sheetUrl = c.ss.getUrl();
    return r;
  });
}

function loadAll(auth) {
  return api_(auth, function (who) {
    var c = ctx_();
    var serverTime = Date.now();
    var rows = readRows_(c.entries, E_DEF), entries = [];
    for (var i = 0; i < rows.length; i++) {
      var o = objOf_(E_DEF, rows[i]);
      if (!o.id) continue;
      if (o.deleted === 'Yes' && !who.isAdmin) continue;
      entries.push(entryOut_(o));
    }
    var l = lists_(c);
    return { ok: true, serverTime: serverTime, isAdmin: who.isAdmin, entries: entries, sites: allSites_(c), people: l.people, categories: l.categories };
  });
}

function changesSince(auth, since) {
  return api_(auth, function (who) {
    var serverTime = Date.now();
    since = Number(since) || 0;
    var last = Number(props_().getProperty('LAST_CHANGE')) || 0;
    if (since > 0 && last < since) return { ok: true, serverTime: serverTime, unchanged: true, isAdmin: who.isAdmin };
    var c = ctx_();
    var rows = readRows_(c.entries, E_DEF), entries = [];
    for (var i = 0; i < rows.length; i++) {
      var o = objOf_(E_DEF, rows[i]);
      if (!o.id || (Number(o.updatedAt) || 0) < since) continue;
      entries.push(entryFor_(o, who.isAdmin));
    }
    var l = lists_(c);
    return { ok: true, serverTime: serverTime, isAdmin: who.isAdmin, entries: entries, sites: allSites_(c), people: l.people, categories: l.categories };
  });
}

function saveEntry(auth, e, photo) {
  return api_(auth, function (who) {
    needName_(who);
    var c = ctx_();
    var v = validateEntry_(e);
    var id = clean_(e && e.id, 40);
    var ref = clean_(e && e.clientRef, 60);
    var up = null;
    if (photo && photo.data) {
      var skip = false;
      if (!id && ref && findRow_(c.entries, E_DEF, 'clientRef', ref, false)) skip = true;
      if (!skip) up = uploadPhoto_(c, photo, v, ref || 'bill');
    }
    var out, lock = lock_();
    var renameTo = '';
    try {
      var now = Date.now();
      var rowNum, o;
      var siteRow = v.site ? findRow_(c.sites, S_DEF, 'name', v.site, true) : 0;
      if (siteRow) v.site = String(c.sites.getRange(siteRow, S_DEF.idx.name + 1).getValue());
      if (id) {
        rowNum = findRow_(c.entries, E_DEF, 'id', id, false);
        if (!rowNum) fail_('notfound', 'This entry no longer exists.');
        o = readRow_(c.entries, E_DEF, rowNum);
        if (o.deleted === 'Yes') fail_('deleted', 'This entry was deleted. Ask the admin to restore it first.');
        if (!who.isAdmin) {
          if (!sameName_(o.enteredBy, who.name)) fail_('forbidden', 'You can only change entries you entered yourself.');
          if (o.checked === 'Yes') fail_('locked', 'The admin has checked this entry, so it is locked.');
        }
        var changes = [];
        for (var i = 0; i < EDIT_FIELDS.length; i++) {
          var f = EDIT_FIELDS[i];
          var oldV = f === 'amount' ? Number(o[f]) : String(o[f]);
          if (oldV !== v[f]) changes.push({ f: f, from: String(o[f]), to: String(v[f]) });
        }
        if (up) changes.push({ f: 'bill', from: String(o.billId), to: up.id });
        if (!changes.length) return { ok: true, entry: entryOut_(o), unchanged: true };
        for (var j = 0; j < EDIT_FIELDS.length; j++) o[EDIT_FIELDS[j]] = v[EDIT_FIELDS[j]];
        if (up) { o.billId = up.id; o.billUrl = up.url; }
        o.editedBy = who.name;
        o.editedAt = stamp_(now);
        addHistory_(o, who, now, o.checked === 'Yes' ? 'edited (was checked)' : 'edited', changes);
      } else {
        if (ref) {
          rowNum = findRow_(c.entries, E_DEF, 'clientRef', ref, false);
          if (rowNum) return { ok: true, entry: entryOut_(readRow_(c.entries, E_DEF, rowNum)), existed: true };
        }
        ensureSite_(c, v.site, who, now);
        ensurePerson_(c, v.person, who, now);
        ensurePerson_(c, who.name, who, now);
        o = {};
        for (var k = 0; k < EDIT_FIELDS.length; k++) o[EDIT_FIELDS[k]] = v[EDIT_FIELDS[k]];
        o.voucher = nextVoucher_();
        o.id = newId_('e');
        o.clientRef = ref;
        o.enteredBy = who.name;
        o.enteredAt = stamp_(now);
        o.checked = 'No';
        o.deleted = 'No';
        o.billId = up ? up.id : '';
        o.billUrl = up ? up.url : '';
        o.history = '';
        addHistory_(o, who, now, 'created');
        rowNum = sheetLast_(c.entries) + 1;
        if (up) renameTo = o.voucher + ' ' + v.date + ' ' + (v.site || 'office') + ' Rs' + v.amount;
      }
      ensureSite_(c, v.site, who, now);
      o.updatedAt = now;
      o.seal = sealOf_(o);
      putRow_(c.entries, E_DEF, rowNum, o);
      touch_(now);
      out = entryOut_(o);
    } finally { lock.releaseLock(); }
    if (up && renameTo) {
      try { up.file.setName(renameTo + '.' + PHOTO_MIMES[String(photo.mime).toLowerCase()]); } catch (err) { }
    }
    return { ok: true, entry: out };
  });
}

function mutate_(auth, id, fn) {
  return api_(auth, function (who) {
    needName_(who);
    var c = ctx_();
    id = clean_(id, 40);
    var lock = lock_();
    var out;
    try {
      var rowNum = findRow_(c.entries, E_DEF, 'id', id, false);
      if (!rowNum) fail_('notfound', 'This entry no longer exists.');
      var o = readRow_(c.entries, E_DEF, rowNum);
      var now = Date.now();
      var changed = fn(who, o, now);
      if (changed) {
        o.updatedAt = now;
        o.seal = sealOf_(o);
        putRow_(c.entries, E_DEF, rowNum, o);
        touch_(now);
      }
      out = entryOut_(o);
    } finally { lock.releaseLock(); }
    return { ok: true, entry: out };
  });
}

function setChecked(auth, id, checked) {
  return mutate_(auth, id, function (who, o, now) {
    if (!who.isAdmin) fail_('forbidden', 'Only the admin can check entries.');
    if (o.deleted === 'Yes') fail_('deleted', 'Restore the entry before checking it.');
    var want = checked ? 'Yes' : 'No';
    if (o.checked === want) return false;
    o.checked = want;
    o.checkedBy = checked ? who.name : '';
    o.checkedAt = checked ? stamp_(now) : '';
    addHistory_(o, who, now, checked ? 'checked' : 'unchecked');
    return true;
  });
}

function deleteEntry(auth, id) {
  return mutate_(auth, id, function (who, o, now) {
    if (o.deleted === 'Yes') return false;
    if (!who.isAdmin) {
      if (!sameName_(o.enteredBy, who.name)) fail_('forbidden', 'You can only delete entries you entered yourself.');
      if (o.checked === 'Yes') fail_('locked', 'The admin has checked this entry, so it is locked.');
    }
    o.deleted = 'Yes';
    o.deletedBy = who.name;
    o.deletedAt = stamp_(now);
    addHistory_(o, who, now, 'deleted');
    return true;
  });
}

function restoreEntry(auth, id) {
  return mutate_(auth, id, function (who, o, now) {
    if (!who.isAdmin) fail_('forbidden', 'Only the admin can restore entries.');
    if (o.deleted !== 'Yes') return false;
    o.deleted = 'No';
    o.deletedBy = '';
    o.deletedAt = '';
    addHistory_(o, who, now, 'restored');
    return true;
  });
}

function saveSite(auth, s) {
  return api_(auth, function (who) {
    needName_(who);
    var c = ctx_();
    s = s || {};
    var name = clean_(s.name, 80);
    if (!name) fail_('invalid', 'Site name is required.');
    var status = String(s.status || 'Active');
    if (SITE_STATUS.indexOf(status) < 0) fail_('invalid', 'Status must be Active, Completed or On hold.');
    var contract = Number(s.contract) || 0;
    if (contract < 0 || contract > 10000000000) fail_('invalid', 'Contract value is not valid.');
    var id = clean_(s.id, 40);
    var lock = lock_();
    var out;
    try {
      var now = Date.now();
      if (!id) {
        var ex = findRow_(c.sites, S_DEF, 'name', name, true);
        if (ex) return { ok: true, site: siteOut_(readRow_(c.sites, S_DEF, ex)), existed: true };
        var o = { name: name, client: clean_(s.client, 80), location: clean_(s.location, 120), contract: who.isAdmin ? Math.round(contract * 100) / 100 : 0, status: status, note: cleanNote_(s.note, 500), createdBy: who.name, createdAt: stamp_(now), updatedBy: who.name, updatedStamp: stamp_(now), id: newId_('s'), updatedAt: now };
        putRow_(c.sites, S_DEF, sheetLast_(c.sites) + 1, o);
        out = siteOut_(o);
      } else {
        if (!who.isAdmin) fail_('forbidden', 'Only the admin can edit site details.');
        var rowNum = findRow_(c.sites, S_DEF, 'id', id, false);
        if (!rowNum) fail_('notfound', 'This site no longer exists.');
        var cur = readRow_(c.sites, S_DEF, rowNum);
        var dup = findRow_(c.sites, S_DEF, 'name', name, true);
        if (dup && dup !== rowNum) fail_('duplicate', 'Another site already has this name.');
        var oldName = String(cur.name);
        cur.name = name;
        cur.client = clean_(s.client, 80);
        cur.location = clean_(s.location, 120);
        cur.contract = Math.round(contract * 100) / 100;
        cur.status = status;
        cur.note = cleanNote_(s.note, 500);
        cur.updatedBy = who.name;
        cur.updatedStamp = stamp_(now);
        cur.updatedAt = now;
        putRow_(c.sites, S_DEF, rowNum, cur);
        if (oldName !== name) renameSiteOnEntries_(c, oldName, name, who, now);
        out = siteOut_(cur);
      }
      touch_(now);
    } finally { lock.releaseLock(); }
    return { ok: true, site: out };
  });
}

function renameSiteOnEntries_(c, oldName, newName, who, now) {
  var last = c.entries.getLastRow();
  if (last < 2) return;
  var rows = c.entries.getRange(2, 1, last - 1, E_DEF.n).getValues();
  var si = E_DEF.idx.site, hit = false;
  for (var i = 0; i < rows.length; i++) {
    if (!sameName_(rows[i][si], oldName)) continue;
    var o = objOf_(E_DEF, rows[i]);
    o.site = newName;
    addHistory_(o, who, now, 'site renamed', [{ f: 'site', from: oldName, to: newName }]);
    o.updatedAt = now;
    o.seal = sealOf_(o);
    rows[i] = rowOf_(E_DEF, o);
    hit = true;
  }
  if (hit) c.entries.getRange(2, 1, rows.length, E_DEF.n).setValues(rows);
}

// ================= link to Woodland Project OS =================
// Project OS is the master list of projects. A project that is 'in process' there (design, tender/site, snagging)
// becomes a site here, tied to it by its WA- number. Only an admin can run this; nothing is ever deleted or renamed.
function fetchRegistry_() {
  var key = props_().getProperty('LINK_KEY');
  if (!key) fail_('setup', 'The link key is not set. In Script Properties add LINK_KEY (copy it from Project OS) and run again.');
  var url = props_().getProperty('PROJECT_OS_URL') || PROJECT_OS_URL;
  var resp, body;
  try {
    resp = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain', payload: JSON.stringify({ action: 'registry', key: key }), muteHttpExceptions: true, followRedirects: true });
    body = JSON.parse(resp.getContentText());
  } catch (e) { fail_('link', 'Could not reach Project OS. Check the internet and try again.'); }
  if (!body || !body.ok) fail_('link', 'Project OS said: ' + String((body && body.error) || 'no answer'));
  return body.projects || [];
}

function syncProjects(auth, dryRun) {
  return api_(auth, function (who) {
    if (!who.isAdmin) fail_('forbidden', 'Only the admin can bring in projects from Project OS.');
    var projects = fetchRegistry_().filter(function (p) { return p && p.id && p.active && String(p.name || '').trim(); });
    var c = ctx_();
    var lock = dryRun ? null : lock_();
    var added = [], adopted = [], linked = 0;
    try {
      var now = Date.now();
      for (var i = 0; i < projects.length; i++) {
        var p = projects[i], name = clean_(p.name, 80);
        if (findRow_(c.sites, S_DEF, 'projectId', String(p.id), false)) { linked++; continue; }
        var byName = findRow_(c.sites, S_DEF, 'name', name, true);
        if (byName) {
          var cur = readRow_(c.sites, S_DEF, byName);
          if (cur.projectId && String(cur.projectId) !== String(p.id)) continue; // that site already belongs to another project
          adopted.push(name);
          if (!dryRun) { cur.projectId = String(p.id); cur.updatedBy = who.name; cur.updatedStamp = stamp_(now); cur.updatedAt = now; putRow_(c.sites, S_DEF, byName, cur); }
          continue;
        }
        added.push(name);
        if (!dryRun) putRow_(c.sites, S_DEF, sheetLast_(c.sites) + 1, { name: name, client: clean_(p.client, 80), location: clean_(p.location, 120), contract: 0, status: 'Active', note: '', createdBy: who.name || 'Admin', createdAt: stamp_(now), updatedBy: who.name || 'Admin', updatedStamp: stamp_(now), id: newId_('s'), updatedAt: now, projectId: String(p.id) });
      }
      if (!dryRun && (added.length || adopted.length)) touch_(now);
    } finally { if (lock) lock.releaseLock(); }
    return { ok: true, dryRun: !!dryRun, added: added, adopted: adopted, linked: linked, total: projects.length };
  });
}

function saveSettings(auth, s) {
  return api_(auth, function (who) {
    needName_(who);
    var c = ctx_();
    s = s || {};
    var kind = String(s.kind || '');
    if (kind !== 'person' && kind !== 'category') fail_('invalid', 'Unknown list.');
    var action = String(s.action || '');
    if (action !== 'add' && action !== 'remove') fail_('invalid', 'Unknown action.');
    var name = clean_(s.name, 60);
    if (!name) fail_('invalid', 'Name is required.');
    if (name === OFFICE) fail_('invalid', 'That name is reserved.');
    if (action === 'remove' && !who.isAdmin) fail_('forbidden', 'Only the admin can remove list items.');
    var lock = lock_();
    try {
      var now = Date.now();
      var rows = readRows_(c.settings, L_DEF), found = 0, o = null;
      for (var i = 0; i < rows.length; i++) {
        var r = objOf_(L_DEF, rows[i]);
        if (r.kind === kind && sameName_(r.name, name)) { found = i + 2; o = r; break; }
      }
      var want = action === 'add' ? 'Yes' : 'No';
      if (!found) {
        if (action === 'add') {
          putRow_(c.settings, L_DEF, sheetLast_(c.settings) + 1, { kind: kind, name: name, active: 'Yes', addedBy: who.name, addedAt: stamp_(now), updatedAt: now });
          touch_(now);
        }
      } else if (o.active !== want) {
        o.active = want;
        o.updatedAt = now;
        putRow_(c.settings, L_DEF, found, o);
        touch_(now);
      }
    } finally { lock.releaseLock(); }
    var l = lists_(c);
    return { ok: true, people: l.people, categories: l.categories };
  });
}

// Admin only: finds rows that were changed or removed directly in the Google Sheet.
function auditLedger(auth) {
  return api_(auth, function (who) {
    if (!who.isAdmin) fail_('forbidden', 'Only the admin can run the audit.');
    var c = ctx_();
    var rows = readRows_(c.entries, E_DEF), problems = [], seen = {}, maxN = 0;
    for (var i = 0; i < rows.length; i++) {
      var o = objOf_(E_DEF, rows[i]);
      if (!o.id && !o.voucher && !o.seal) continue;
      var m = /^V-(\d+)$/.exec(String(o.voucher));
      if (m) { seen[Number(m[1])] = true; if (Number(m[1]) > maxN) maxN = Number(m[1]); }
      if (!o.seal) problems.push({ row: i + 2, voucher: String(o.voucher), reason: 'Row has no seal (added by hand in the sheet).' });
      else if (sealOf_(o) !== String(o.seal)) problems.push({ row: i + 2, voucher: String(o.voucher), reason: 'Row was changed directly in the sheet after the app saved it.' });
    }
    var seq = Number(props_().getProperty('VOUCHER_SEQ')) || 0;
    for (var n = 1; n <= Math.max(seq, maxN); n++) {
      if (!seen[n]) problems.push({ row: 0, voucher: 'V-' + ('000' + n).slice(-4), reason: 'Voucher is missing from the sheet (row deleted).' });
    }
    return { ok: true, total: rows.length, problems: problems, checkedAt: stamp_(Date.now()) };
  });
}
