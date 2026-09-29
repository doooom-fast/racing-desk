// Bridge to a running Adobe Illustrator: macOS via osascript `do javascript`, Windows via COM (PowerShell).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { core } from './settings.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', '..', 'dist', 'DoooomShatter.jsx');

/** Runs ExtendScript source in Illustrator and returns its string result. */
export async function runJsx(source, { timeoutMs = 120000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'doooom-'));
  const file = join(dir, 'run.jsx');
  try {
    if (process.platform === 'darwin') {
      // Hand Illustrator the SOURCE, not a path. Adobe apps routinely fail to resolve a POSIX
      // file under /tmp (sandboxing), and `do javascript f` then dies with -1728. osascript
      // itself reads the .applescript file happily, so only the JSX travels as an argument.
      const osa = join(dir, 'run.applescript');
      await writeFile(osa, [
        'on run argv',
        `  with timeout of ${Math.ceil(timeoutMs / 1000)} seconds`,
        '    tell application id "com.adobe.illustrator" to do javascript (item 1 of argv)',
        '  end timeout',
        'end run',
      ].join('\n'), 'utf8');
      const { stdout } = await run('osascript', [osa, source], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
      return stdout.trim();
    }
    await writeFile(file, source, 'utf8');
    if (process.platform === 'win32') {
      const ps = `$app = New-Object -ComObject Illustrator.Application; $r = $app.DoJavaScriptFile(${JSON.stringify(file)}); Write-Output $r`;
      const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
      return stdout.trim();
    }
    throw new Error(`Illustrator bridge is only available on macOS and Windows (this is ${process.platform}). Use shatter_svg for headless work.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Shatters the current Illustrator selection with resolved settings S. */
export async function illustratorShatter(S) {
  const dist = await readFile(DIST, 'utf8').catch(() => { throw new Error('dist/DoooomShatter.jsx not found — run `npm run build` in the repo root'); });
  // Strip the #target directive (meaningless inside do javascript) and inject settings as a global.
  const src = `var DOOOOM_SETTINGS = ${JSON.stringify(S)};\n` + dist.replace(/^#target.*$/m, '');
  const result = await runJsx(src);
  if (!result.startsWith('OK')) throw new Error(result || 'Illustrator returned nothing');
  return { status: result, settings: S, note: core.encodeSettings(S) };
}

/** Describes the current selection so an agent can decide what to do. */
export async function illustratorSelectionInfo() {
  const probe = `
(function(){
  if (app.documents.length === 0) return '{"error":"no document open"}';
  var d = app.activeDocument, s = d.selection, out = [], i, it, b, n;
  for (i = 0; i < s.length; i++) {
    it = s[i]; b = it.geometricBounds; n = null;
    if (it.typename === "GroupItem" && it.note && it.note.indexOf("DoooomShatter:") === 0) n = it.note;
    out.push('{"type":"' + it.typename + '","name":"' + String(it.name).replace(/["\\\\]/g, "") + '","width":' + (b[2]-b[0]).toFixed(2) + ',"height":' + (b[1]-b[3]).toFixed(2) + ',"doooomNote":' + (n ? '"' + n.replace(/"/g, '\\\\"') + '"' : 'null') + '}');
  }
  return '{"document":"' + String(d.name).replace(/["\\\\]/g, "") + '","colorSpace":"' + (d.documentColorSpace === DocumentColorSpace.RGB ? "RGB" : "CMYK") + '","selectionCount":' + s.length + ',"items":[' + out.join(',') + ']}';
})();`;
  const raw = await runJsx(probe, { timeoutMs: 20000 });
  try { return JSON.parse(raw); } catch { return { raw }; }
}
