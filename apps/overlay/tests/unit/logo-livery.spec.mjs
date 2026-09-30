/**
 * The livery behind the car badge, as the main process keeps it (modules/js/logo-livery.js), with the real worker
 * (logo-livery-worker.js) reading paints made up here in a temp folder, through paints/tga.js: what is chosen,
 * when, what is handed over, what is refused, and that no line of the log carries the customer id or a path.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const livery = require('../../modules/js/logo-livery.js');
const worker = require('../../modules/js/logo-livery-worker.js');

const ID = '424242';
const GREY = [88, 88, 94];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// An uncompressed TGA of `pixelAt(x, y) → [r, g, b, a?]`, bottom-up as the pipeline writes them.
function tgaOf(width, height, pixelAt, { bits = 24 } = {}) {
  const head = Buffer.alloc(18);
  head[2] = 2;
  head.writeUInt16LE(width, 12);
  head.writeUInt16LE(height, 14);
  head[16] = bits;
  const bpp = bits / 8;
  const body = Buffer.alloc(width * height * bpp);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = (row * width + x) * bpp;
      body[o] = b;
      body[o + 1] = g;
      body[o + 2] = r;
      if (bpp === 4) body[o + 3] = a === undefined ? 255 : a;
    }
  }
  return Buffer.concat([head, body]);
}

function busy(x, y) {
  const cell = ((x >> 2) * 73856093) ^ ((y >> 2) * 19349663);
  return [(cell >>> 0) % 256, (cell >>> 8) % 256, (cell >>> 16) % 256];
}
const withPatch = (x, y) => (x >= 120 && x < 190 && y >= 10 && y < 80 ? busy(x, y) : GREY);

const pngSize = (png) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

let paintDir;
let elsewhere;
test.beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-livery-'));
  paintDir = path.join(root, 'paint');
  elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(paintDir);
  fs.mkdirSync(elsewhere);
  const put = (car, name, bytes) => {
    fs.mkdirSync(path.join(paintDir, car), { recursive: true });
    fs.writeFileSync(path.join(paintDir, car, name), bytes);
  };
  put('mycar', `car_${ID}.tga`, tgaOf(200, 200, withPatch));
  put('flat', `car_${ID}.tga`, tgaOf(200, 200, () => GREY));
  put('theirs', 'car_777777.tga', tgaOf(200, 200, withPatch));
  put('rle', `car_${ID}.tga`, tgaOf(200, 200, (x, y) => [...withPatch(x, y), 255], { bits: 32 }));
  put('broken', `car_${ID}.tga`, Buffer.from('not a paint at all'));
  fs.writeFileSync(path.join(elsewhere, `car_${ID}.tga`), tgaOf(200, 200, withPatch));
});
test.afterAll(() => { fs.rmSync(path.dirname(paintDir), { recursive: true, force: true }); });

const IN_CAR = { 'DataCorePlugin.GameRunning': 1, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };
const OUT_OF_CAR = { 'DataCorePlugin.GameRunning': 1, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0 };
const inCar = (car, more = {}) => ({ ...IN_CAR, 'RacingDesk.Plugin.CarControls': { car }, ...more });

// A keeper over the temp folder, with what it said and what it handed over kept.
function keeper(overrides = {}) {
  const said = [];
  const crops = [];
  const k = livery.createLogoLivery({
    paintDir: () => paintDir,
    customerId: () => ID,
    onCrop: (crop) => crops.push(crop),
    log: (line) => said.push(line),
    size: 64,
    leaveMs: 0,
    ...overrides,
  });
  return { k, said, crops, settled: () => settled(k) };
}

async function settled(k, ms = 15000) {
  const until = Date.now() + ms;
  while (k.state().picking && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 30));
  return k.state();
}

test.describe('what the payload names', () => {
  test('the car: the host\'s car-controls key, as an object or as text, else the model name for the store', () => {
    expect(livery.carOfPayload({ 'RacingDesk.Plugin.CarControls': { car: 'mx5 mx52016' } })).toEqual({ carPath: 'mx5 mx52016' });
    expect(livery.carOfPayload({ 'RacingDesk.Plugin.CarControls': '{"car":"dallara dallarair18","abs":{}}' })).toEqual({ carPath: 'dallara dallarair18' });
    expect(livery.carOfPayload({ 'RacingDesk.Plugin.CarControls': 'not json', 'DataCorePlugin.GameData.CarModel': 'Mazda MX-5 Cup' })).toEqual({ model: 'Mazda MX-5 Cup' });
    expect(livery.carOfPayload({ 'DataCorePlugin.GameData.CarModel': '  BMW M4 GT3 ' })).toEqual({ model: 'BMW M4 GT3' });
    expect(livery.carOfPayload({ 'DataCorePlugin.GameData.CarModel': '' })).toBeNull();
    expect(livery.carOfPayload({})).toBeNull();
    expect(livery.carOfPayload(null)).toBeNull();
    // The demo's car is nobody's paint.
    expect(livery.carOfPayload({ 'RacingDesk.Plugin.DemoMode': 1, 'DataCorePlugin.GameData.CarModel': 'BMW M4 GT3' })).toBeNull();
    expect(livery.carOfPayload({ 'RacingDesk.Plugin.DemoMode': 'True', 'RacingDesk.Plugin.CarControls': { car: 'x' } })).toBeNull();
    // A car-controls key naming something that is not a car's folder is not one.
    expect(livery.carOfPayload({ 'RacingDesk.Plugin.CarControls': { car: '../x' }, 'DataCorePlugin.GameData.CarModel': 'X' })).toEqual({ model: 'X' });
  });

  test('a car\'s folder name is letters, digits, spaces, hyphens and underscores, and never a path', () => {
    for (const ok of ['mx5 mx52016', 'dallara dallarair18', 'bmwm4gt3', 'dirtsprint winged 410', 'caterham caterham420r', 'Ferrari_296', 'a-b']) {
      expect(livery.isCarPath(ok), ok).toBe(true);
    }
    for (const not of ['', ' x', '../mycar', '..', 'mycar/..', 'a/b', 'a\\b', 'C:x', 'x:', 'a.', '.', '\0', 'x'.repeat(81), null, 42, ['mycar']]) {
      expect(livery.isCarPath(not), String(not)).toBe(false);
    }
  });

  test('the store names a car by the sim\'s name for it, whatever the case', () => {
    const rows = [{ car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup' }, { car_path: 'bmwm4gt3', name: 'BMW M4 GT3' }, { car_path: '../x', name: 'Bad' }, null, { name: 'no path' }];
    expect(livery.carPathByName(rows, 'bmw m4 gt3')).toBe('bmwm4gt3');
    expect(livery.carPathByName(rows, ' Mazda MX-5 Cup ')).toBe('mx5 mx52016');
    expect(livery.carPathByName(rows, 'Bad')).toBeNull();
    expect(livery.carPathByName(rows, 'Porsche 911 GT3 R')).toBeNull();
    expect(livery.carPathByName(null, 'BMW M4 GT3')).toBeNull();
    expect(livery.carPathByName(rows, null)).toBeNull();
  });
});

test.describe('the worker', () => {
  test('crops a paint through tga.js: a PNG of the size asked, and the window it came from', () => {
    const out = worker.cropPaint({ paintDir, carFolder: 'mycar', fileName: `car_${ID}.tga`, size: 48, seed: 3 });
    expect(out).not.toBeNull();
    expect(Buffer.compare(out.png.subarray(0, 8), PNG_SIGNATURE)).toBe(0);
    expect(pngSize(out.png)).toEqual({ width: 48, height: 48 });
    const { x, y, w, h } = out.window;
    expect(x + w / 2).toBeGreaterThanOrEqual(120);
    expect(x + w / 2).toBeLessThanOrEqual(190);
    expect(y + h / 2).toBeGreaterThanOrEqual(10);
    expect(y + h / 2).toBeLessThanOrEqual(80);
    // A 32-bit file the same.
    expect(pngSize(worker.cropPaint({ paintDir, carFolder: 'rle', fileName: `car_${ID}.tga`, size: 40, seed: 3 }).png)).toEqual({ width: 40, height: 40 });
  });

  test('a flat paint, a paint that is not there, and a car that is not there are nothing to show', () => {
    expect(worker.cropPaint({ paintDir, carFolder: 'flat', fileName: `car_${ID}.tga`, size: 48 })).toBeNull();
    expect(worker.cropPaint({ paintDir, carFolder: 'theirs', fileName: `car_${ID}.tga`, size: 48 })).toBeNull();
    expect(worker.cropPaint({ paintDir, carFolder: 'nocar', fileName: `car_${ID}.tga`, size: 48 })).toBeNull();
  });

  test('never a file outside the paint folder: not by the path, and not by what the path really is', () => {
    expect(worker.paintFileIn(paintDir, 'mycar', `car_${ID}.tga`)).toBe(fs.realpathSync.native(path.join(paintDir, 'mycar', `car_${ID}.tga`)));
    for (const [car, name] of [
      ['../elsewhere', `car_${ID}.tga`], ['..', `elsewhere/car_${ID}.tga`], ['mycar', `../../elsewhere/car_${ID}.tga`],
      [elsewhere, `car_${ID}.tga`], ['mycar/..', `../elsewhere/car_${ID}.tga`], ['', ''], ['mycar', ''],
    ]) {
      expect(worker.paintFileIn(paintDir, car, name), `${car} / ${name}`).toBeNull();
      expect(worker.cropPaint({ paintDir, carFolder: car, fileName: name, size: 48 }), `${car} / ${name}`).toBeNull();
    }
    // A car folder that is a junction to somewhere else is refused too.
    const linked = path.join(paintDir, 'linked');
    let made = false;
    try {
      fs.symlinkSync(elsewhere, linked, 'junction');
      made = true;
    } catch (e) {
      test.info().annotations.push({ type: 'note', description: `no junction could be made here (${e.code})` });
    }
    if (made) {
      expect(fs.existsSync(path.join(linked, `car_${ID}.tga`))).toBe(true);
      expect(worker.paintFileIn(paintDir, 'linked', `car_${ID}.tga`)).toBeNull();
      expect(worker.cropPaint({ paintDir, carFolder: 'linked', fileName: `car_${ID}.tga`, size: 48 })).toBeNull();
    }
  });

  test('a paint over the cap is not read, and a file that is not a paint is said so without its path', () => {
    expect(() => worker.cropPaint({ paintDir, carFolder: 'mycar', fileName: `car_${ID}.tga`, size: 48, maxBytes: 1000 })).toThrow('too large');
    expect(() => worker.cropPaint({ paintDir, carFolder: 'broken', fileName: `car_${ID}.tga`, size: 48 })).toThrow(/TGA/);
    expect(worker.reasonOf(Object.assign(new Error(`ENOENT: no such file or directory, open '${path.join(paintDir, 'x')}'`), { code: 'ENOENT' }))).toBe('file ENOENT');
    expect(worker.reasonOf(new Error(`could not open ${path.join(paintDir, 'mycar', `car_${ID}.tga`)}`))).not.toContain(ID);
    expect(worker.reasonOf(new Error(`could not open ${paintDir}`))).not.toContain(paintDir);
    expect(worker.reasonOf(new Error('This TGA holds no image data.'))).toBe('This TGA holds no image data.');
  });

  test('in its own thread: the PNG comes back, nothing to show comes back as null, and a bad paint as a reason with no path', async () => {
    const out = await livery.pickInWorker({ paintDir, carFolder: 'mycar', fileName: `car_${ID}.tga`, size: 32, seed: 5 });
    expect(Buffer.isBuffer(out.png)).toBe(true);
    expect(pngSize(out.png)).toEqual({ width: 32, height: 32 });
    expect(out.window.w).toBeGreaterThan(0);
    expect(await livery.pickInWorker({ paintDir, carFolder: 'flat', fileName: `car_${ID}.tga`, size: 32 })).toBeNull();
    await expect(livery.pickInWorker({ paintDir, carFolder: 'broken', fileName: `car_${ID}.tga`, size: 32 })).rejects.toThrow(/TGA/);
    const tooBig = livery.pickInWorker({ paintDir, carFolder: 'mycar', fileName: `car_${ID}.tga`, size: 32, maxBytes: 10 });
    await expect(tooBig).rejects.toThrow('too large');
    await expect(livery.pickInWorker({ paintDir, carFolder: 'mycar', fileName: `car_${ID}.tga`, size: 32 }, { file: path.join(paintDir, 'no-such-worker.js') })).rejects.toThrow();
  });

  test('the worker\'s file is the unpacked copy in the built app, and this folder\'s otherwise', () => {
    const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'modules', 'js');
    expect(livery.workerFile()).toBe(path.join(here, 'logo-livery-worker.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-asar-'));
    try {
      const packed = path.join(root, 'app.asar', 'modules', 'js');
      const unpacked = path.join(root, 'app.asar.unpacked', 'modules', 'js');
      fs.mkdirSync(packed, { recursive: true });
      expect(livery.workerFile(packed)).toBe(path.join(packed, 'logo-livery-worker.js'));   // nothing unpacked yet
      fs.mkdirSync(unpacked, { recursive: true });
      fs.writeFileSync(path.join(unpacked, 'logo-livery-worker.js'), '// the copy');
      expect(livery.workerFile(packed)).toBe(path.join(unpacked, 'logo-livery-worker.js'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test.describe('the keeper', () => {
  test('in the car, the car the host names: its paint is cropped once and handed over as PNG and data URL', async () => {
    const { k, crops, said, settled: wait } = keeper();
    expect(k.current()).toBeNull();
    k.feed(inCar('mycar'));
    expect(k.state()).toMatchObject({ inCar: true, wanted: 'path:mycar', picks: 1 });
    await wait();
    expect(crops).toHaveLength(1);
    const crop = crops[0];
    expect(Buffer.compare(crop.png.subarray(0, 8), PNG_SIGNATURE)).toBe(0);
    expect(pngSize(crop.png)).toEqual({ width: 64, height: 64 });
    expect(crop.dataUrl).toBe(`data:image/png;base64,${crop.png.toString('base64')}`);
    expect(crop.id).toMatch(/^1-\d+$/);
    expect(crop.carPath).toBe('mycar');
    expect(k.current()).toBe(crop);
    // The same car, frame after frame: the crop stays, nothing is chosen again.
    for (let i = 0; i < 5; i++) k.feed(inCar('mycar'));
    k.feed(inCar('MYCAR'));
    await wait();
    expect(k.state().picks).toBe(1);
    expect(crops).toHaveLength(1);
    expect(said.some((l) => /a crop of the paint for mycar is behind the badge/.test(l))).toBe(true);
  });

  test('the car-controls key as text, from the WebSocket feed, names the car too', async () => {
    const { k, crops, settled: wait } = keeper();
    k.feed({ ...IN_CAR, 'RacingDesk.Plugin.CarControls': JSON.stringify({ car: 'rle', abs: { state: 'none' } }) });
    await wait();
    expect(crops).toHaveLength(1);
    expect(crops[0].carPath).toBe('rle');
  });

  test('out of the car nothing is chosen; getting out keeps the crop; getting in again is a new choice', async () => {
    const { k, crops, settled: wait } = keeper();
    k.feed({ ...OUT_OF_CAR, 'RacingDesk.Plugin.CarControls': { car: 'mycar' } });
    k.feed(null);
    k.feed({ 'DataCorePlugin.GameRunning': 0 });
    await wait();
    expect(k.state()).toMatchObject({ inCar: false, picks: 0, has: false });
    expect(crops).toEqual([]);

    k.feed(inCar('mycar'));
    await wait();
    expect(crops).toHaveLength(1);
    k.feed({ ...OUT_OF_CAR, 'RacingDesk.Plugin.CarControls': { car: 'mycar' } });
    await wait();
    expect(k.state()).toMatchObject({ inCar: false, has: true, picks: 1 });
    expect(k.current()).toBe(crops[0]);
    expect(crops).toHaveLength(1);
    // Back in the same car: chosen again, for another section.
    k.feed(inCar('mycar'));
    await wait();
    expect(k.state().picks).toBe(2);
    expect(crops).toHaveLength(2);
    expect(crops[1]).not.toBe(crops[0]);
    expect(crops[1].id).not.toBe(crops[0].id);
  });

  test('another car is another crop; one with no paint, or a flat one, is the maker\'s colour', async () => {
    const { k, crops, said, settled: wait } = keeper();
    k.feed(inCar('mycar'));
    await wait();
    k.feed(inCar('rle'));
    await wait();
    expect(crops.map((c) => c && c.carPath)).toEqual(['mycar', 'rle']);
    k.feed(inCar('flat'));
    await wait();
    expect(crops[2]).toBeNull();
    expect(k.current()).toBeNull();
    expect(said.some((l) => /no paint with artwork to show for flat/.test(l))).toBe(true);
    // Nothing was up, and nothing is: the page is not told again.
    k.feed(inCar('nocar'));
    await wait();
    expect(crops).toHaveLength(3);
    expect(k.state().picks).toBe(4);
    // A paint of somebody else's is not his.
    k.feed(inCar('theirs'));
    await wait();
    expect(k.current()).toBeNull();
    // A paint that cannot be read is said, without its path.
    k.feed(inCar('broken'));
    await wait();
    expect(k.current()).toBeNull();
    expect(said.some((l) => /the paint for broken could not be read/.test(l))).toBe(true);
    for (const line of said) {
      expect(line, line).not.toContain(ID);
      expect(line, line).not.toContain(paintDir);
      expect(line, line).not.toMatch(/\.tga/);
    }
  });

  test('a car the host does not name is found by the store\'s name for it, or is nothing', async () => {
    const rows = [{ car_path: 'mycar', name: 'My Car' }];
    const { k, crops, settled: wait } = keeper({ carNames: async () => rows });
    k.feed({ ...IN_CAR, 'DataCorePlugin.GameData.CarModel': 'My Car' });
    expect(k.state().wanted).toBe('model:my car');
    await wait();
    expect(crops).toHaveLength(1);
    expect(crops[0].carPath).toBe('mycar');

    const noRows = keeper({ carNames: async () => [] });
    noRows.k.feed({ ...IN_CAR, 'DataCorePlugin.GameData.CarModel': 'My Car' });
    await noRows.settled();
    expect(noRows.crops).toEqual([]);
    expect(noRows.said.some((l) => /no folder name for this car yet/.test(l))).toBe(true);

    const noStore = keeper();
    noStore.k.feed({ ...IN_CAR, 'DataCorePlugin.GameData.CarModel': 'My Car' });
    await noStore.settled();
    expect(noStore.crops).toEqual([]);

    const failing = keeper({ carNames: async () => { throw new Error('no host'); } });
    failing.k.feed({ ...IN_CAR, 'DataCorePlugin.GameData.CarModel': 'My Car' });
    await failing.settled();
    expect(failing.crops).toEqual([]);
  });

  test('the demo has nobody\'s paint: nothing is chosen, and a crop that was up is cleared', async () => {
    const { k, crops, settled: wait } = keeper();
    k.feed({ 'RacingDesk.Plugin.DemoMode': 1, 'DataCorePlugin.GameData.CarModel': 'BMW M4 GT3' });
    await wait();
    expect(k.state()).toMatchObject({ inCar: true, picks: 0 });
    expect(crops).toEqual([]);
    k.feed(inCar('mycar'));
    await wait();
    expect(crops).toHaveLength(1);
    k.feed({ 'RacingDesk.Plugin.DemoMode': 1, 'DataCorePlugin.GameData.CarModel': 'BMW M4 GT3' });
    await wait();
    expect(crops).toHaveLength(2);
    expect(crops[1]).toBeNull();
  });

  test('nothing is read without a paint folder and a customer id, or for a name that is not a car\'s folder', async () => {
    const picked = [];
    const spy = async (job) => { picked.push(job); return null; };
    const noId = keeper({ customerId: () => null, pick: spy });
    noId.k.feed(inCar('mycar'));
    await noId.settled();
    const badId = keeper({ customerId: () => '12ab', pick: spy });
    badId.k.feed(inCar('mycar'));
    await badId.settled();
    const noDir = keeper({ paintDir: () => '', pick: spy });
    noDir.k.feed(inCar('mycar'));
    await noDir.settled();
    expect(picked).toEqual([]);
    expect(noId.said.some((l) => /no customer id is set/.test(l))).toBe(true);
    expect(noDir.said.some((l) => /no paint folder is set/.test(l))).toBe(true);

    const escaping = keeper({ pick: spy });
    for (const car of ['../elsewhere', '..', 'mycar/..', 'C:\\paint', 'a\\b', '']) {
      escaping.k.feed({ ...IN_CAR, 'RacingDesk.Plugin.CarControls': { car } });
      await escaping.settled();
    }
    expect(picked).toEqual([]);
    expect(escaping.k.state().picks).toBe(0);
  });

  test('a paint over the cap is not read', async () => {
    const { k, crops, said, settled: wait } = keeper({ maxBytes: 100 });
    k.feed(inCar('mycar'));
    await wait();
    expect(crops).toEqual([]);
    expect(k.current()).toBeNull();
    expect(said.some((l) => /could not be read \(the paint file is too large to be a paint\)/.test(l))).toBe(true);
  });

  test('a newer car supersedes a pick still under way, whose answer is dropped', async () => {
    const pngOf = (name) => Buffer.concat([PNG_SIGNATURE, Buffer.from(name)]);
    const pick = (job) => new Promise((resolve) => setTimeout(() => resolve({ png: pngOf(job.carFolder), window: {} }), job.carFolder === 'slow' ? 300 : 30));
    const { k, crops, settled: wait } = keeper({ pick });
    k.feed(inCar('slow'));
    k.feed(inCar('quick'));
    await wait();
    await new Promise((r) => setTimeout(r, 400));
    expect(crops.map((c) => c.carPath)).toEqual(['quick']);
    expect(k.current().carPath).toBe('quick');
    expect(k.state().picks).toBe(2);
  });

  test('the job the worker is given names the paint in pieces, with a seed from the random it was given', async () => {
    const jobs = [];
    const { k, settled: wait } = keeper({ pick: async (job) => { jobs.push(job); return null; }, random: () => 0.5, size: 96 });
    k.feed(inCar('mycar'));
    await wait();
    expect(jobs).toEqual([{
      paintDir, carFolder: 'mycar', fileName: `car_${ID}.tga`, size: 96, aspect: 1, maxBytes: livery.MAX_PAINT_BYTES,
      seed: Math.floor(0.5 * 0x7fffffff),
    }]);
  });

  test('nothing here throws into the poll that feeds it', async () => {
    const { k, said, settled: wait } = keeper({ onCrop: () => { throw new Error('the page is gone'); } });
    for (const junk of [undefined, null, 'x', 42, [], {}, { 'DataCorePlugin.GameRunning': 'yes' }]) k.feed(junk);
    k.feed(inCar('mycar'));
    await wait();
    expect(k.current()).not.toBeNull();
    expect(said.some((l) => /could not be handed on \(the page is gone\)/.test(l))).toBe(true);
    const throwing = keeper({ paintDir: () => { throw new Error('no settings'); } });
    throwing.k.feed(inCar('mycar'));
    await throwing.settled();
    expect(throwing.current === undefined || throwing.k.current() === null).toBe(true);
  });
});
