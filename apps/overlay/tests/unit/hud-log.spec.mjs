/**
 * The main process's log (modules/js/app-log.js): where it is kept, and how it is kept from growing without end.
 *
 * In the built app main.js used to write beside itself, which is inside app.asar: nothing was kept, so "HUD on
 * screen" and "HUD hidden" were never there to be read — and the built app is the one that is run. Real files, in
 * a folder of the test's own under the system's temp folder.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { MAX_BYTES, logPath, scrub, createLog } = require('../../modules/js/app-log.js');
const { hostLogPath } = require('../../modules/js/host-launcher.js');

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-log-')); });
test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const read = (file) => fs.readFileSync(file, 'utf8');
const lines = (file) => read(file).split('\n').filter(Boolean);

test.describe('logPath: where the log is kept', () => {
  const built = { isPackaged: true, appDir: 'C:\\Racing Desk\\resources\\app.asar' };

  test('from source: beside main.js, as it always was', () => {
    const appDir = path.join(dir, 'apps', 'overlay');
    expect(logPath({ isPackaged: false, appDir })).toBe(path.join(appDir, 'racing-desk-debug.log'));
  });

  test('in the built app: overlay.log in %LOCALAPPDATA%\\Racing Desk, and nowhere inside app.asar', () => {
    const local = path.join(dir, 'AppData', 'Local');
    const file = logPath({ ...built, env: { LOCALAPPDATA: local } });
    expect(file).toBe(path.join(local, 'Racing Desk', 'overlay.log'));
    expect(file).not.toContain('app.asar');
  });

  test('with no LOCALAPPDATA to go by, the same folder under the home folder', () => {
    expect(logPath({ ...built, env: {}, home: dir })).toBe(path.join(dir, 'AppData', 'Local', 'Racing Desk', 'overlay.log'));
  });

  test("it is beside the host's log", () => {
    expect(path.dirname(logPath(built))).toBe(path.dirname(hostLogPath()));
    expect(path.basename(logPath(built))).not.toBe(path.basename(hostLogPath()));
  });
});

test.describe('createLog: a line at a time', () => {
  test('each line is dated, and they are kept in the order they were written', () => {
    const file = path.join(dir, 'overlay.log');
    const log = createLog({ file, now: () => new Date('2026-09-29T08:00:00.000Z') });
    log.write('[RacingDesk] In the car → HUD on screen');
    log.write('[RacingDesk] Out of the car → HUD hidden');
    expect(lines(file)).toEqual([
      '[2026-09-29T08:00:00.000Z] [RacingDesk] In the car → HUD on screen',
      '[2026-09-29T08:00:00.000Z] [RacingDesk] Out of the car → HUD hidden',
    ]);
    expect(log.file).toBe(file);
  });

  test('the folder is made if it is not there', () => {
    const file = path.join(dir, 'Racing Desk', 'overlay.log');
    createLog({ file }).write('first');
    expect(lines(file)).toHaveLength(1);
  });

  test('what was in the file before the app started is kept, and counted', () => {
    const file = path.join(dir, 'overlay.log');
    fs.writeFileSync(file, 'from the last run\n');
    createLog({ file }).write('from this one');
    expect(lines(file)).toHaveLength(2);
    expect(lines(file)[0]).toBe('from the last run');
  });
});

test.describe('createLog: turning over', () => {
  const line = 'x'.repeat(70);           // 97 bytes with its date and its newline
  const bytesOf = (file) => fs.statSync(file).size;

  test('four megabytes is where it turns over', () => {
    expect(MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  test('past the limit a new file is begun and the old one kept, as overlay.log.1', () => {
    const file = path.join(dir, 'overlay.log');
    const log = createLog({ file, maxBytes: 1000 });
    for (let i = 0; i < 10; i++) log.write(`${i} ${line}`);
    expect(bytesOf(file)).toBeLessThanOrEqual(1000);
    expect(fs.existsSync(`${file}.1`)).toBe(false);

    log.write(`10 ${line}`);
    expect(lines(`${file}.1`)).toHaveLength(10);
    expect(lines(file)).toHaveLength(1);
    expect(lines(file)[0]).toContain('] 10 x');
  });

  test('two files at most, however much is written, and neither past the limit', () => {
    const file = path.join(dir, 'overlay.log');
    const log = createLog({ file, maxBytes: 1000 });
    for (let i = 0; i < 500; i++) log.write(`${i} ${line}`);
    expect(fs.readdirSync(dir).sort()).toEqual(['overlay.log', 'overlay.log.1']);
    expect(bytesOf(file)).toBeLessThanOrEqual(1000);
    expect(bytesOf(`${file}.1`)).toBeLessThanOrEqual(1000);
    // Nothing between the two is lost: the last line of the old file is followed by the first of the new.
    const all = [...lines(`${file}.1`), ...lines(file)].map((l) => Number(l.split('] ')[1].split(' ')[0]));
    expect(all[all.length - 1]).toBe(499);
    expect(all).toEqual(all.map((_, i) => all[0] + i));
  });

  test('a file left over the limit by the last run is turned over at the first line of this one', () => {
    const file = path.join(dir, 'overlay.log');
    fs.writeFileSync(file, 'y'.repeat(5000));
    fs.writeFileSync(`${file}.1`, 'older still\n');
    createLog({ file, maxBytes: 1000 }).write('first of this run');
    expect(read(`${file}.1`)).toBe('y'.repeat(5000));
    expect(lines(file)).toHaveLength(1);
  });

  test('one line longer than the limit is written all the same, in a file of its own', () => {
    const file = path.join(dir, 'overlay.log');
    const log = createLog({ file, maxBytes: 100 });
    log.write('short');
    log.write('z'.repeat(500));
    log.write('short again');
    expect(lines(`${file}.1`)[0]).toContain('z'.repeat(500));
    expect(lines(file)).toHaveLength(1);
  });
});

test.describe('a failure to log is never a failure of the app', () => {
  test('a file that cannot be written: the line is dropped, nothing is thrown', () => {
    // A folder where the file should be.
    const file = path.join(dir, 'overlay.log');
    fs.mkdirSync(file);
    const log = createLog({ file, maxBytes: 100 });
    expect(() => { for (let i = 0; i < 20; i++) log.write('into nothing'); }).not.toThrow();
  });

  test('a folder that cannot be made: the same', () => {
    const inTheWay = path.join(dir, 'a-file');
    fs.writeFileSync(inTheWay, '');
    const log = createLog({ file: path.join(inTheWay, 'Racing Desk', 'overlay.log') });
    expect(() => log.write('into nothing')).not.toThrow();
  });

  test('the old file cannot be put aside: written on where it is, and the line is kept', () => {
    // A folder of that name, with something in it, is in the way of overlay.log.1.
    const file = path.join(dir, 'overlay.log');
    fs.mkdirSync(`${file}.1`);
    fs.writeFileSync(path.join(`${file}.1`, 'held'), '');
    const log = createLog({ file, maxBytes: 200 });
    for (let i = 0; i < 10; i++) log.write(`line ${i}`);
    expect(lines(file)).toHaveLength(10);
    expect(fs.existsSync(path.join(`${file}.1`, 'held'))).toBe(true);
  });

  test('something that is not a string is written as one', () => {
    const file = path.join(dir, 'overlay.log');
    const log = createLog({ file });
    expect(() => { log.write(undefined); log.write(new Error('gone')); log.write({ a: 1 }); }).not.toThrow();
    expect(lines(file)).toHaveLength(3);
    expect(lines(file)[1]).toContain('Error: gone');
  });
});

test.describe('scrub: no customer id in the log', () => {
  // 424242 is made up.
  test('the id in the name of a paint file is taken out: an error over a paint carries its path', () => {
    expect(scrub("EBUSY: resource busy or locked, copyfile 'C:\\paint\\bmwm4gt3\\car_424242.tga'"))
      .toBe("EBUSY: resource busy or locked, copyfile 'C:\\paint\\bmwm4gt3\\car_<id>.tga'");
    expect(scrub('car_spec_424242.tga car_num_424242.TGA helmet_424242.tga suit_424242.mip'))
      .toBe('car_spec_<id>.tga car_num_<id>.TGA helmet_<id>.tga suit_<id>.mip');
  });

  test('and one that is called a customer id', () => {
    expect(scrub('customer id 424242')).toBe('customer id <id>');
    expect(scrub('{"customerId":"424242"}')).toBe('{"customerId":"<id>"}');
    expect(scrub('custid=424242')).toBe('custid=<id>');
  });

  test('in the forms the app itself writes it in', () => {
    // The name a paint is written under on its way in, which has neither of a paint's endings.
    expect(scrub("EPERM: operation not permitted, rename 'C:\\paint\\lotus79\\car_424242.doooom-tmp' -> 'C:\\paint\\lotus79\\car_424242.tga'"))
      .toBe("EPERM: operation not permitted, rename 'C:\\paint\\lotus79\\car_<id>.doooom-tmp' -> 'C:\\paint\\lotus79\\car_<id>.tga'");
    expect(scrub('car_spec_424242.doooom-tmp')).toBe('car_spec_<id>.doooom-tmp');
    // The settings and a backup's manifest, as they are laid out on disk, and as a string within a string.
    expect(scrub('  "customerId": "424242",')).toBe('  "customerId": "<id>",');
    expect(scrub('{\\"customerId\\": \\"424242\\"}')).toBe('{\\"customerId\\": \\"<id>\\"}');
  });

  test('other numbers are left as they are', () => {
    for (const text of [
      '[RacingDesk] Primary display: 3840x2160 at (0, 0)',
      '[RacingDesk] Host: host on :18889 without hardware (pid 12345, log host.log)',
      'Recording stopped: RaceCor_2026-09-29_08-00-00_spa.webm (12.0 MB, 61.0s)',
    ]) {
      expect(scrub(text)).toBe(text);
    }
  });

  test('it is what is written', () => {
    const file = path.join(dir, 'overlay.log');
    createLog({ file }).write("UNCAUGHT EXCEPTION: Error: ENOENT, open 'car_424242.tga'");
    expect(read(file)).not.toContain('424242');
    expect(read(file)).toContain('car_<id>.tga');
  });
});
