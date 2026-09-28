/**
 * The code on the Settings page's iPad card (modules/js/qr-code.js) has to be one a camera can read. No reader is
 * on hand, so the code is read back here by the standard's own rules (ISO/IEC 18004, version 3-M) — written out
 * again below, sharing nothing with the generator: where the patterns are, what the format information says, the
 * order the codewords are laid in, that the error correction is the error correction of that data, and that the
 * text that comes out is the text that went in.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', '..', 'modules', 'js', 'qr-code.js'), 'utf8');

// The script as the desk loads it: a window to hang itself on, a document to find its canvas in.
function load(canvas = null) {
  const window = {};
  vm.runInNewContext(source, { window, document: { getElementById: (id) => (canvas && id === 'code' ? canvas : null) } });
  return window;
}

const qr = load().RacingDeskQR;
const SIZE = 29;

// ── The standard, for a reader ──

const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
const ALIGNMENT = ['11111', '10001', '10101', '10001', '11111'];
const finderAt = [[0, 0], [0, SIZE - 7], [SIZE - 7, 0]];

// Function modules: everything that is not a codeword's.
function isFunction(r, c) {
  if (r <= 8 && c <= 8) return true;                       // finder, separator, format
  if (r <= 8 && c >= SIZE - 8) return true;
  if (r >= SIZE - 8 && c <= 8) return true;                // and the dark module, at (21, 8)
  if (r === 6 || c === 6) return true;                     // timing
  return r >= 20 && r <= 24 && c >= 20 && c <= 24;         // alignment, centred on (22, 22)
}

// Bit 0 (the last of the fifteen) is at the top of column 8; bit 14 at the left of row 8.
const FORMAT_FIRST = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
const FORMAT_SECOND = [
  ...Array.from({ length: 8 }, (_, i) => [8, SIZE - 1 - i]),
  ...Array.from({ length: 7 }, (_, i) => [SIZE - 7 + i, 8]),
];
const FORMAT_MASK = 0b101010000010010;
const FORMAT_GENERATOR = 0b10100110111;

const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = EXP[i + 255] = x; LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); }
const times = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function read(matrix) {
  expect(matrix.length).toBe(SIZE);
  for (const row of matrix) expect(row.length).toBe(SIZE);
  const at = (r, c) => matrix[r][c];

  // The patterns a camera finds the code by.
  for (const [r0, c0] of finderAt) {
    for (let r = 0; r < 7; r++) {
      expect(Array.from({ length: 7 }, (_, c) => at(r0 + r, c0 + c)).join(''), `finder at ${r0},${c0} row ${r}`).toBe(FINDER[r]);
    }
  }
  for (let i = 0; i < 8; i++) {   // separators: light, all round each finder
    for (const [r, c] of [[7, i], [i, 7], [7, SIZE - 1 - i], [i, SIZE - 8], [SIZE - 8, i], [SIZE - 1 - i, 7]]) {
      expect(at(r, c), `separator at ${r},${c}`).toBe(0);
    }
  }
  for (let i = 8; i < SIZE - 8; i++) {
    expect(at(6, i), `timing row at ${i}`).toBe(i % 2 === 0 ? 1 : 0);
    expect(at(i, 6), `timing column at ${i}`).toBe(i % 2 === 0 ? 1 : 0);
  }
  for (let r = 0; r < 5; r++) {
    expect(Array.from({ length: 5 }, (_, c) => at(20 + r, 20 + c)).join(''), `alignment row ${r}`).toBe(ALIGNMENT[r]);
  }
  expect(at(SIZE - 8, 8), 'the dark module').toBe(1);

  // The format information, twice and the same, and a word of its own code.
  const word = (positions) => positions.reduce((v, [r, c], bit) => v | (at(r, c) << bit), 0);
  const format = word(FORMAT_FIRST);
  expect(word(FORMAT_SECOND), 'the second copy of the format').toBe(format);
  const plain = format ^ FORMAT_MASK;
  let rest = plain;
  for (let bit = 14; bit >= 10; bit--) if (rest & (1 << bit)) rest ^= FORMAT_GENERATOR << (bit - 10);
  expect(rest, 'the format\'s own error correction').toBe(0);
  const level = plain >> 13;        // 00 is M
  const mask = (plain >> 10) & 7;
  expect([level, mask]).toEqual([0, 0]);

  // The codewords, in the order they are laid: two columns at a time from the right, up then down.
  const bits = [];
  let upward = true;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < SIZE; i++) {
      const r = upward ? SIZE - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (!isFunction(r, c)) bits.push(at(r, c) ^ ((r + c) % 2 === 0 ? 1 : 0));   // mask 0 taken off
      }
    }
    upward = !upward;
  }
  expect(bits.length, 'modules for codewords').toBe(70 * 8 + 7);
  expect(bits.slice(560), 'the seven left over').toEqual([0, 0, 0, 0, 0, 0, 0]);
  const codewords = Array.from({ length: 70 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));

  // Error correction: a word of the code has no remainder at any of the generator's 26 roots.
  for (let root = 0; root < 26; root++) {
    let value = 0;
    for (const cw of codewords) value = times(value, EXP[root]) ^ cw;
    expect(value, `syndrome ${root}`).toBe(0);
  }

  // And what it says.
  const data = codewords.slice(0, 44).map((cw) => cw.toString(2).padStart(8, '0')).join('');
  expect(data.slice(0, 4), 'byte mode').toBe('0100');
  const count = parseInt(data.slice(4, 12), 2);
  const bytes = Array.from({ length: count }, (_, i) => parseInt(data.slice(12 + i * 8, 20 + i * 8), 2));
  const after = data.slice(12 + count * 8);
  expect(after.slice(0, 4), 'terminator').toBe('0000');
  const padding = after.slice(4).match(/.{8}/g) ?? [];
  padding.forEach((byte, i) => expect(byte, `pad ${i}`).toBe(i % 2 === 0 ? '11101100' : '00010001'));
  return Buffer.from(bytes).toString('utf8');
}

// ── Tests ──

test('the error correction is Reed-Solomon\'s, by a worked example from outside', () => {
  // "HELLO WORLD" as a version 1-M symbol: its 16 data codewords and the 10 that correct them.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  expect(Array.from(qr.rsEncode(Uint8Array.from(data), 10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('an address reads back as itself, by the standard\'s rules', () => {
  for (const address of [
    'http://192.168.1.20:9090/?k=abcd2345',
    'http://10.0.0.5:9090/?k=wxyz6789',
    'http://192.168.100.100:65535/?k=mnpq4567',   // the longest an address on a home network gets: 40
    'http://172.16.0.1:1024/?k=22222222',
    'a',
    '',
    'x'.repeat(42),                                // full
    'café ✓',                            // not only ASCII
  ]) {
    expect(read(qr.generate(address)), address).toBe(address);
  }
});

test('two addresses are two codes', () => {
  const a = qr.generate('http://192.168.1.20:9090/?k=abcd2345').map((row) => row.join('')).join('\n');
  const b = qr.generate('http://192.168.1.20:9090/?k=abcd2346').map((row) => row.join('')).join('\n');
  expect(a).not.toBe(b);
});

test('what does not fit is refused, not cut short', () => {
  expect(qr.MAX_BYTES).toBe(42);
  expect(() => qr.generate('x'.repeat(43))).toThrow('Too long for the code');
  expect(() => qr.generate('✓'.repeat(15))).toThrow('45 bytes');   // three bytes each
  expect(read(qr.generate('✓'.repeat(14)))).toBe('✓'.repeat(14));
});

// A canvas that remembers what was drawn on it.
function canvasOf(width, height = width) {
  const drawn = [];
  const ctx = { fillStyle: '', fillRect(x, y, w, h) { drawn.push({ ink: this.fillStyle, x, y, w, h }); } };
  return { width, height, getContext: () => ctx, drawn };
}

test('it is drawn black on white in whole pixels, with the white a camera needs round it', () => {
  const canvas = canvasOf(185);
  const window = load(canvas);
  expect(window.renderQRCode('code', 'http://192.168.1.20:9090/?k=abcd2345')).toBe(true);

  expect(canvas.drawn[0]).toEqual({ ink: '#ffffff', x: 0, y: 0, w: 185, h: 185 });
  const modules = canvas.drawn.slice(1);
  expect(modules.every((m) => m.ink === '#000000' && m.w === 5 && m.h === 5)).toBe(true);
  // Four modules of quiet on every side: 185 is 37 modules of 5.
  expect(Math.min(...modules.map((m) => m.x))).toBe(20);
  expect(Math.min(...modules.map((m) => m.y))).toBe(20);
  expect(Math.max(...modules.map((m) => m.x + m.w))).toBe(165);
  expect(Math.max(...modules.map((m) => m.y + m.h))).toBe(165);

  // What was drawn is the code: read it back off the canvas.
  const matrix = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  for (const m of modules) matrix[(m.y - 20) / 5][(m.x - 20) / 5] = 1;
  expect(read(matrix)).toBe('http://192.168.1.20:9090/?k=abcd2345');
});

test('a text too long, a canvas too small or no canvas at all draws no code and says so', () => {
  const long = canvasOf(185);
  expect(load(long).renderQRCode('code', 'x'.repeat(43))).toBe(false);
  expect(long.drawn.filter((d) => d.ink === '#000000')).toEqual([]);

  const small = canvasOf(30);
  expect(load(small).renderQRCode('code', 'a')).toBe(false);
  expect(small.drawn.filter((d) => d.ink === '#000000')).toEqual([]);

  expect(load(null).renderQRCode('code', 'a')).toBe(false);
});
