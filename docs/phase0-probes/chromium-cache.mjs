// Minimal Chromium blockfile HTTP cache reader: key (URL) -> body (stream 1). Never reads stream 0 (headers).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const BLOCK_SIZES = { 1: 36, 2: 256, 3: 1024, 4: 4096 };

export function openCache(dir) {
  const files = new Map();
  const file = (name) => { if (!files.has(name)) files.set(name, existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : null); return files.get(name); };
  const readAddr = (addr, size) => {
    if (!(addr & 0x80000000)) return null;
    const type = (addr >>> 28) & 0x7;
    if (type === 0) { const b = file('f_' + (addr & 0x0fffffff).toString(16).padStart(6, '0')); return b ? b.subarray(0, size) : null; }
    const bs = BLOCK_SIZES[type]; if (!bs) return null;
    const fileNum = (addr >>> 16) & 0xff, start = addr & 0xffff;
    const b = file('data_' + fileNum); if (!b) return null;
    const off = 8192 + start * bs;
    return b.subarray(off, off + size);
  };
  const index = file('index');
  const tableLen = index.readInt32LE(28);
  const entries = [];
  const seen = new Set();
  for (let i = 0; i < tableLen; i++) {
    let addr = index.readUInt32LE(368 + i * 4);
    while (addr & 0x80000000 && !seen.has(addr)) {
      seen.add(addr);
      const e = readAddr(addr, 256); if (!e) break;
      const keyLen = e.readInt32LE(32), longKey = e.readUInt32LE(36);
      const key = longKey ? (readAddr(longKey, keyLen) || Buffer.alloc(0)).toString('latin1') : e.subarray(96, 96 + Math.min(keyLen, 160)).toString('latin1');
      const bodySize = e.readInt32LE(44), bodyAddr = e.readUInt32LE(60);
      entries.push({ key, bodySize, created: new Date(Number(e.readBigUInt64LE(24) / 1000n) - 11644473600000), body: () => readAddr(bodyAddr, bodySize) });
      addr = e.readUInt32LE(4);
    }
  }
  return entries;
}

export function decodeBody(b) {
  if (!b || !b.length) return null;
  for (const fn of [(x) => x, zlib.gunzipSync, zlib.brotliDecompressSync, zlib.zstdDecompressSync].filter(Boolean)) {
    try { const o = fn(b); const s = o.toString('utf8').trimStart(); if (s[0] === '{' || s[0] === '[') return JSON.parse(s); } catch {}
  }
  return null;
}

export const urlOf = (key) => { const m = key.match(/https?:\/\/\S+$/); return m ? m[0] : key; };
