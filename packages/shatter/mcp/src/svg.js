// Headless SVG shattering: wraps the source artwork in <defs> and emits one clipped <use> per shard.
// The engine only - deliberately not settings.js, so this module (and the CLI that uses it)
// stays free of the MCP server's dependencies and runs anywhere Node does.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../../core/fracture.js');

const num = (s) => parseFloat(String(s).replace(/[^0-9.eE+-]/g, ''));

export function parseSvg(svg) {
  const m = svg.match(/<svg\b([^>]*)>/i);
  if (!m) throw new Error('input does not contain an <svg> root element');
  const attrs = m[1];
  const attr = (n) => { const r = attrs.match(new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, 'i')) || attrs.match(new RegExp(`\\b${n}\\s*=\\s*'([^']*)'`, 'i')); return r ? r[1] : null; };
  let vb = attr('viewBox');
  let x = 0, y = 0, w, h;
  if (vb) { [x, y, w, h] = vb.trim().split(/[\s,]+/).map(Number); }
  else { w = num(attr('width')); h = num(attr('height')); }
  if (!(w > 0 && h > 0)) throw new Error('could not determine artwork size (needs viewBox or width/height)');
  const start = m.index + m[0].length, end = svg.lastIndexOf('</svg>');
  const inner = svg.slice(start, end < 0 ? undefined : end);
  return { x, y, w, h, inner };
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();
const pts = (poly) => poly.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(' ');

export function shatterSvg(svg, S, { margin = 0.05, background = null } = {}) {
  const src = parseSvg(svg);
  const build = core.buildShards(src.w, src.h, S);
  const off = (p) => p.map(([px, py]) => [px + src.x, py + src.y]);

  // output extent = union of moved shards, padded
  let minX = src.x, minY = src.y, maxX = src.x + src.w, maxY = src.y + src.h;
  for (const sh of build.shards) for (const [px, py] of off(core.transformPoly(sh))) {
    if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py;
  }
  const padX = (maxX - minX) * margin, padY = (maxY - minY) * margin;
  minX -= padX; minY -= padY; maxX += padX; maxY += padY;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(maxX - minX)} ${fmt(maxY - minY)}" data-doooom="${core.encodeSettings(S).replace(/"/g, '&quot;')}">`);
  parts.push(`<defs><g id="doooom-src">${src.inner}</g>`);
  build.shards.forEach((sh, i) => parts.push(`<clipPath id="doooom-clip-${i}"><polygon points="${pts(off(sh.poly))}"/></clipPath>`));
  parts.push('</defs>');
  if (background) parts.push(`<rect x="${fmt(minX)}" y="${fmt(minY)}" width="${fmt(maxX - minX)}" height="${fmt(maxY - minY)}" fill="${background}"/>`);
  parts.push('<g id="doooom-shards">');
  build.shards.forEach((sh, i) => {
    const cx = sh.c[0] + src.x, cy = sh.c[1] + src.y;
    const tf = `translate(${fmt(sh.dx)} ${fmt(sh.dy)}) translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(sh.rot)}) scale(${fmt(sh.scale)}) translate(${fmt(-cx)} ${fmt(-cy)})`;
    const op = sh.opacity < 0.999 ? ` opacity="${fmt(sh.opacity)}"` : '';
    parts.push(`<g class="shard" transform="${tf}"${op}>`);
    parts.push(`<g clip-path="url(#doooom-clip-${i})"><use href="#doooom-src" xlink:href="#doooom-src"/></g>`);
    if (S.tint > 0) {
      const white = sh.light >= 0;
      const o = Math.min(100, Math.abs(sh.light) * S.tint * 0.9 + S.tint * 0.08) / 100;
      parts.push(`<polygon points="${pts(off(sh.poly))}" fill="${white ? '#fff' : '#000'}" fill-opacity="${fmt(o)}" style="mix-blend-mode:${white ? 'screen' : 'multiply'}"/>`);
    }
    if (S.edge > 0 && S.edgeWidth > 0) {
      parts.push(`<polygon points="${pts(off(sh.poly))}" fill="none" stroke="#fff" stroke-width="${fmt(S.edgeWidth)}" stroke-opacity="${fmt(S.edge / 100)}" stroke-linejoin="miter" style="mix-blend-mode:screen"/>`);
    }
    parts.push('</g>');
  });
  parts.push('</g></svg>');
  return { svg: parts.join('\n'), shards: build.shards.length, impact: [build.impact[0] + src.x, build.impact[1] + src.y], settings: S };
}

/** Plan only — shard polygons + physics, for agents that render themselves. */
export function shatterPlan(width, height, S) {
  const b = core.buildShards(width, height, S);
  return {
    width, height, impact: b.impact, settings: S, count: b.shards.length,
    shards: b.shards.map((sh, i) => ({
      index: i, polygon: sh.poly.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]), centroid: sh.c.map((v) => +v.toFixed(3)),
      moved: core.transformPoly(sh).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]),
      dx: +sh.dx.toFixed(3), dy: +sh.dy.toFixed(3), rotation: +sh.rot.toFixed(3), scale: +sh.scale.toFixed(4), opacity: +sh.opacity.toFixed(3), light: +sh.light.toFixed(3),
    })),
  };
}
