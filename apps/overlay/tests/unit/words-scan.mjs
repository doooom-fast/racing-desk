/**
 * The scan behind tests/unit/words-not-caps.spec.mjs: every place Racing Desk writes text for him to read — the HUD's,
 * the iPad's and the desk's stylesheets and pages, the scripts that put words on them, the Cars island, the car list and
 * the commentary — read for text set in capitals that is not an acronym (modules/js/words.js has the list). He asked on
 * 2026-10-02: "get rid of any all-caps text that isn't an acronym and also … use words instead of acronyms where we can".
 *
 * Pure Node; `node tests/unit/words-scan.mjs` prints what it finds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const OVERLAY = path.resolve(here, '..', '..');
export const ROOT = path.resolve(OVERLAY, '..', '..');
const W = require(path.join(OVERLAY, 'modules', 'js', 'words.js'));

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');
const list = (dir, re) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) return list(p, re);
  return re.test(d.name) ? [p] : [];
});

// ── What is in capitals ──

// A word of a text that is in capitals and is not an acronym: two letters or more, no digit (P4, TC1 and MP4 are
// names), and not every part of it between - / + & one of the acronyms.
export function capsWords(text, { labels = false } = {}) {
  const out = [];
  for (const raw of String(text).split(/[\s,.;:!?()[\]{}"'“”‘’…·—–]+/)) {
    const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+]+$/g, '');
    if (!word) continue;
    const core = word.replace(/[^A-Za-z0-9]/g, '');
    if (/\d/.test(core)) continue;
    const letters = core.replace(/[^A-Za-z]/g, '');
    if (letters.length < 2 || letters !== letters.toUpperCase()) continue;
    const parts = word.split(/[-/+&]/).map((p) => p.replace(/[^A-Za-z]/g, '')).filter((p) => p.length >= 2);
    if (parts.length && parts.every((p) => W.isAcronym(p, { labels }))) continue;
    out.push(word);
  }
  return out;
}

// ── Stylesheets ──

// `text-transform: uppercase` (or capitalize's cousin, small capitals) anywhere, and a `content:` string in capitals.
export function scanCss(file) {
  const found = [];
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  src.split('\n').forEach((line, i) => {
    if (/text-transform\s*:\s*uppercase/i.test(line)) found.push({ file: rel(file), line: i + 1, what: 'text-transform: uppercase' });
    if (/font-variant(-caps)?\s*:[^;]*\b(small-caps|all-small-caps|petite-caps|all-petite-caps|titling-caps|unicase)\b/i.test(line)) {
      found.push({ file: rel(file), line: i + 1, what: 'small capitals' });
    }
    // One finding for a string, with every word of it in capitals.
    for (const m of line.matchAll(/content\s*:\s*(['"])(.*?)\1/g)) {
      const words = capsWords(m[2]);
      if (words.length) found.push({ file: rel(file), line: i + 1, what: `content "${m[2]}": ${words.join(', ')}` });
    }
  });
  return found;
}

// ── Pages ──

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e]);

// The text of an HTML page or fragment: what is between its tags, and its titles, alts, placeholders and labels; not
// its scripts, styles, comments, code (a file's path is the file's) or SVG.
export function pageText(html) {
  const texts = [];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|code|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const m of body.matchAll(/\b(title|alt|placeholder|aria-label)\s*=\s*"([^"]*)"/gi)) texts.push(decode(m[2]));
  for (const m of body.replace(/<[^>]*>/g, '\n').split('\n')) if (m.trim()) texts.push(decode(m.trim()));
  return texts;
}

export function scanHtml(file) {
  const found = [];
  const src = read(file);
  const lines = src.split('\n');
  for (const text of pageText(src)) {
    for (const w of capsWords(text)) {
      const line = lines.findIndex((l) => l.includes(w)) + 1;
      found.push({ file: rel(file), line, what: `"${text.slice(0, 80)}": ${w}` });
    }
  }
  return found;
}

// ── Scripts ──

// The strings of a script, read by TypeScript's own parser (a .js, a .ts or a .tsx file): each string literal, the
// text of each template literal (its expressions left out), and each piece of JSX text, with the line it is on and
// whether it is only ever a log line's, a key of an object, or a shader's source — none of which is shown.
const ts = require('typescript');
export function stringsOf(src, file = 'x.js') {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const LOGGERS = /^(console\.\w+|(this\.|deps\.|opts\.|options\.)?(log|logToFile|logLine|warn|debug|trace)\w*|\w+\.(log|warn|debug|info|error)\w*)$/;
  const logged = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p)) return LOGGERS.test(p.expression.getText(sf));
      if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };
  const push = (text, node, what) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const key = node.parent && (ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node;
    out.push({ text, line: line + 1, what, key, logged: logged(node), shader: /^\s*#version|\bprecision\s+(high|medium|low)p\b|gl_FragColor|void\s+main\s*\(/.test(text) });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node.text, node, 'string');
    else if (ts.isTemplateExpression(node)) push([node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' '), node, 'template');
    else if (ts.isJsxText(node)) { if (node.text.trim()) push(node.text, node, 'jsx'); }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
// Strings that are code and not words: HTTP and header values, error codes, the arguments of a program, Windows' names
// for keys, the forms of Unicode and the like. They are never shown.
const CODE = new Set([
  'GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'DENY', 'SAMEORIGIN', 'ENOENT', 'EEXIST', 'EXDEV', 'ENOTDIR',
  'EADDRINUSE', 'ECONNREFUSED', 'EPERM', 'EACCES', 'EBUSY', 'SIGTERM', 'SIGKILL', 'NFD', 'NFC', 'NFKD', 'NFKC', 'CSV', 'FI', 'FO',
  'NH', 'IMAGENAME', 'PRIOR', 'NEXT', 'PAUSE', 'RCONTROL', 'LCONTROL', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'IHDR', 'IDAT', 'IEND',
  'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'PATH', 'HKCU', 'HKLM', 'GUID', 'CQVBR', 'STARTED',
  'STOPPED', 'STARTING', 'STOPPING',
]);

// Strings a script uses as code although they read as words in capitals, by file and by the whole string: the keys of
// the host's stored reasons (the host keeps "ABS" and "no ABS" as why a car was given its profile; CarPedals turns them
// into words), the dials' generic names compared with a car's labels, the acronym lists themselves, the demo's car
// names as their makers spell them, and the makers' countries' codes, which pick a flag.
const NOT_SHOWN = {
  'apps/paints/src/components/CarPedals.tsx': ['ABS', 'no ABS'],
  'apps/paints/src/rig.ts': ['ABS', 'TC', 'BB', 'DRS'],
  'apps/overlay/modules/js/car-controls.js': ['ABS', 'TC', 'BB'],
  'apps/overlay/modules/js/config.js': ['GTP ZX-T', 'JS P320', 'Elantra N TC', 'DE', 'GB', 'JP', 'IT', 'US', 'KR', 'FR'],
};
const isNotShown = (file, text) => {
  if (rel(file) === 'apps/overlay/modules/js/words.js') return W.CAR_LABELS.includes(text) || W.ACRONYMS.includes(text);
  return (NOT_SHOWN[rel(file)] || []).includes(text);
};

// The scripts a string of which may reach the screen, and what of each is looked at.
export function scriptFiles() {
  const js = list(path.join(OVERLAY, 'modules', 'js'), /\.js$/);
  const desk = list(path.join(OVERLAY, 'modules', 'desk'), /\.js$/).filter((f) => !/\.bundle\.js$/.test(f));
  const island = list(path.join(ROOT, 'apps', 'paints', 'src'), /\.(ts|tsx)$/);
  return [...js, ...desk, path.join(OVERLAY, 'remote-server.js'), path.join(OVERLAY, 'main.js'), ...island];
}

// A string that is code: an address, a key, a selector, a path, a variable's name, a regular expression's source.
const looksLikeCode = (s) => {
  const t = s.trim();
  if (!t) return true;
  if (CODE.has(t)) return true;
  if (!/\s/.test(t) && /[._/\\#@:=?&()[\]{}<>%|]/.test(t) && !/^[A-Za-z]+[.!?]$/.test(t)) return true;
  if (/^[a-z][\w-]*$/.test(t)) return true;
  return false;
};

export function scanScript(file) {
  const found = [];
  const src = read(file);
  for (const s of stringsOf(src, file)) {
    if (s.key || s.logged || s.shader || isNotShown(file, s.text)) continue;
    let text = s.text;
    if (s.what !== 'jsx' && looksLikeCode(text)) continue;
    // What only a log is told begins with its source in brackets.
    if (/^\s*\[[\w .-]+\]/.test(text)) continue;
    if (/<\w/.test(text)) text = pageText(text).join('\n');
    for (const w of capsWords(text)) {
      if (CODE.has(w)) continue;
      found.push({ file: rel(file), line: s.line, what: `${s.what} "${s.text.slice(0, 80).replace(/\s+/g, ' ').trim()}": ${w}` });
    }
  }
  return found;
}
// ── Data: the car list and the commentary ──

export const CAR_LIST = path.join(ROOT, 'packages', 'car-list', 'cars.json');

// The car list's labels are the cars' own short forms, in sentence case but for the abbreviations the cars show; its
// words and the names of its positions are words, in sentence case (MDM, a name, is the one in capitals).
export function scanCarList(file = CAR_LIST) {
  const found = [];
  const listJson = JSON.parse(read(file));
  for (const car of listJson.cars) {
    for (const c of car.controls || []) {
      const where = `${car.path} ${c.id}`;
      if (typeof c.label === 'string') {
        if (W.labelCase(c.label) !== c.label) found.push({ file: rel(file), line: 0, what: `${where}: the label "${c.label}" is not in sentence case` });
        for (const w of capsWords(c.label, { labels: true })) found.push({ file: rel(file), line: 0, what: `${where}: the label "${c.label}": ${w}` });
      }
      if (c.words !== undefined) {
        if (typeof c.words !== 'string' || !c.words.trim()) found.push({ file: rel(file), line: 0, what: `${where}: words that are not words` });
        else {
          if (W.sentenceCase(c.words) !== c.words) found.push({ file: rel(file), line: 0, what: `${where}: the words "${c.words}" are not in sentence case` });
          for (const w of capsWords(c.words)) found.push({ file: rel(file), line: 0, what: `${where}: the words "${c.words}": ${w}` });
        }
      }
      for (const name of Object.values(c.positions || {})) {
        if (W.sentenceCase(name) !== name) found.push({ file: rel(file), line: 0, what: `${where}: the position "${name}" is not in sentence case` });
      }
    }
  }
  return found;
}

export const COMMENTARY = path.join(ROOT, 'apps', 'plugin', 'racing-desk-plugin', 'simhub-plugin', 'racingdesk-data');

// What the commentary card shows: each topic's title, its line for the event-only mode and its remarks, and the
// fragments remarks are put together from. (The descriptions and the triggers' notes are the data's own, and not shown.)
export function scanCommentary(dir = COMMENTARY) {
  const found = [];
  if (!fs.existsSync(path.join(dir, 'commentary_topics.json'))) return found;
  const topics = JSON.parse(read(path.join(dir, 'commentary_topics.json')));
  for (const t of topics.topics) {
    for (const [k, v] of [['title', t.title], ['eventExposition', t.eventExposition], ...((t.commentaryPrompts || []).map((p, i) => [`prompt ${i}`, p]))]) {
      if (typeof v !== 'string') continue;
      for (const w of capsWords(v)) found.push({ file: 'commentary_topics.json', line: 0, what: `${t.id} ${k}: "${v.slice(0, 60)}": ${w}` });
    }
  }
  const fragments = JSON.parse(read(path.join(dir, 'commentary_fragments.json')));
  for (const f of fragments.fragments) {
    for (const [k, arr] of Object.entries(f.fragments || {})) {
      for (const v of arr) for (const w of capsWords(v)) found.push({ file: 'commentary_fragments.json', line: 0, what: `${f.topicId} ${k}: "${v.slice(0, 60)}": ${w}` });
    }
  }
  return found;
}

// Everything, in one list.
export function scanAll() {
  const css = [
    ...list(path.join(OVERLAY, 'modules', 'styles'), /\.css$/),
    path.join(OVERLAY, 'modules', 'desk', 'desk.css'),
    ...list(path.join(ROOT, 'apps', 'paints', 'src'), /\.css$/),
  ];
  const html = [path.join(OVERLAY, 'dashboard.html'), path.join(OVERLAY, 'desk.html')];
  return [
    ...css.flatMap(scanCss),
    ...html.flatMap(scanHtml),
    ...scriptFiles().flatMap(scanScript),
    ...scanCarList(),
    ...scanCommentary(),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = scanAll();
  for (const f of found) console.log(`${f.file}:${f.line}: ${f.what}`);
  console.log(`${found.length} found`);
}
