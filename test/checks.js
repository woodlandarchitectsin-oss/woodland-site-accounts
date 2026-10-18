'use strict';
// Static checks: syntax, Google's HtmlService comment-stripping behaviour, and the project's hard rules.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const code = fs.readFileSync(path.join(ROOT, 'src', 'Code.gs'), 'utf8');
let failed = 0;
const ok = function (m) { console.log('  PASS  ' + m); };
const bad = function (m) { failed++; console.log('  FAIL  ' + m); };

function nodeCheck(label, source) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wsa-')), 'x.js');
  fs.writeFileSync(f, source);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); ok('node --check ' + label); }
  catch (e) { bad('node --check ' + label + '\n' + String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')); }
}
function scripts(h) {
  const out = [], re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(h))) out.push(m[1]);
  return out;
}

console.log('Static checks');
nodeCheck('Code.gs', code);
const s1 = scripts(html);
if (s1.length !== 2) bad('expected 2 inline scripts (error reporter + app), found ' + s1.length); else ok('2 inline scripts found');
nodeCheck('index.html error-reporter script', s1[0]);
nodeCheck('index.html app script', s1[1]);

// Google's HtmlService deletes everything from "/*" to the next "*/". Simulate that.
const stripped = html.replace(/\/\*[\s\S]*?\*\//g, '');
if (stripped !== html) {
  const i = html.indexOf('/*');
  bad('index.html contains "/*" at char ' + i + ' (context: ' + JSON.stringify(html.slice(Math.max(0, i - 40), i + 40)) + '). Google would delete it.');
} else ok('no "/*" anywhere in index.html: Google comment-stripping changes nothing');
const s2 = scripts(stripped);
nodeCheck('index.html app script after Google-style stripping', s2[1] || '');
if (s2.join('|') !== s1.join('|')) bad('script content differs after stripping'); else ok('scripts identical after stripping');
if (/\/\*/.test(code.replace(/\/\*[\s\S]*?\*\//g, ''))) bad('stray "/*" in Code.gs');

// Hard rules
function rule(name, cond, detail) { if (cond) ok(name); else bad(name + (detail ? ': ' + detail : '')); }
const appScript = s1[1];
rule('no alert()/confirm()/prompt() calls', !/(^|[^A-Za-z0-9_.$])(alert|confirm|prompt)\s*\(/.test(appScript + s1[0]));
rule('no external scripts', !/<script[^>]+src=/i.test(html));
rule('only Google Fonts as external resource', !/(src|href)=["']https?:\/\/(?!fonts\.(googleapis|gstatic)\.com)/i.test(html.replace(/<a [^>]*>/g, '')));
rule('no "image/*" accept pattern', !/image\/\*/.test(html));
rule('no PIN values in index.html', !/ENTER-|TEAM_PIN|ADMIN_PIN/.test(html));
rule('no PIN values in Code.gs besides placeholders', !/(TEAM|ADMIN)\s*=\s*'(?!ENTER-)/.test(code.replace(/var TEAM = 'ENTER-TEAM-PIN'/, '')));
rule('no emoji in the page', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html));
rule('no gradients', !/gradient\(/i.test(html));
rule('theme-color meta present', /<meta name="theme-color"/.test(html));
rule('viewport meta present', /<meta name="viewport"/.test(html));
rule('fonts: IBM Plex Sans, IBM Plex Mono, Familjen Grotesk', /IBM\+Plex\+Sans/.test(html) && /IBM\+Plex\+Mono/.test(html) && /Familjen\+Grotesk/.test(html));
rule('error reporter is the first script', html.indexOf('<script>') < html.indexOf('<style>') && html.indexOf('wsa-err') < html.indexOf('<style>'));
rule('manifest is V8 / Asia/Kolkata / anonymous webapp', (function () {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'appsscript.json'), 'utf8'));
  return m.runtimeVersion === 'V8' && m.timeZone === 'Asia/Kolkata' && m.webapp.access === 'ANYONE_ANONYMOUS' && m.webapp.executeAs === 'USER_DEPLOYING';
})());

if (failed) { console.log('\n' + failed + ' static check(s) FAILED'); process.exit(1); }
console.log('Static checks passed');
