/*
 * Doooom Shatter — core fracture + explode engine.
 * Pure geometry. Must stay ES3 (ExtendScript): no let/const, arrows, JSON, Array extras.
 * This file is inlined verbatim into dist/DoooomShatter.jsx by scripts/build.js and
 * required by the MCP server. Local space: bbox [0,W]x[0,H], y grows DOWN.
 */

// Park–Miller minimal-standard PRNG (no Math.imul in ExtendScript).
function Rng(seed) {
    this.s = (seed % 2147483646);
    if (this.s <= 0) this.s += 2147483646;
}
Rng.prototype.next = function () {          // (0,1)
    this.s = (this.s * 16807) % 2147483647;
    return (this.s - 1) / 2147483646;
};
Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
Rng.prototype.sign = function () { return this.next() < 0.5 ? -1 : 1; };

function polyArea(p) {
    var a = 0, n = p.length, i, j;
    for (i = 0, j = n - 1; i < n; j = i++) a += (p[j][0] * p[i][1]) - (p[i][0] * p[j][1]);
    return a / 2;
}

function polyCentroid(p) {
    var n = p.length, i, j, cx = 0, cy = 0, f, a = 0;
    for (i = 0, j = n - 1; i < n; j = i++) {
        f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
        cx += (p[j][0] + p[i][0]) * f;
        cy += (p[j][1] + p[i][1]) * f;
        a += f;
    }
    if (Math.abs(a) < 1e-9) {               // degenerate: average the points
        cx = 0; cy = 0;
        for (i = 0; i < n; i++) { cx += p[i][0]; cy += p[i][1]; }
        return [cx / n, cy / n];
    }
    a *= 3;
    return [cx / a, cy / a];
}

// Sutherland–Hodgman clip of polygon p to axis-aligned rect [x0,y0,x1,y1]
function clipToRect(p, x0, y0, x1, y1) {
    var edges = [
        function (q) { return q[0] >= x0; }, function (q) { return q[0] <= x1; },
        function (q) { return q[1] >= y0; }, function (q) { return q[1] <= y1; }
    ];
    var consts = [x0, x1, y0, y1], axes = [0, 0, 1, 1];
    var out = p, e, i, inp, cur, prev, cin, pin, t, n;
    for (e = 0; e < 4; e++) {
        inp = out; out = [];
        n = inp.length;
        if (n === 0) break;
        prev = inp[n - 1]; pin = edges[e](prev);
        for (i = 0; i < n; i++) {
            cur = inp[i]; cin = edges[e](cur);
            if (cin !== pin) {
                if (axes[e] === 0) {
                    t = (consts[e] - prev[0]) / (cur[0] - prev[0]);
                    out.push([consts[e], prev[1] + t * (cur[1] - prev[1])]);
                } else {
                    t = (consts[e] - prev[1]) / (cur[1] - prev[1]);
                    out.push([prev[0] + t * (cur[0] - prev[0]), consts[e]]);
                }
            }
            if (cin) out.push(cur);
            prev = cur; pin = cin;
        }
    }
    return out;
}

// Split convex polygon by line through point o with direction d. Returns [polyA, polyB].
function splitConvex(p, o, d) {
    var nx = -d[1], ny = d[0], n = p.length, i, a = [], b = [], s, sPrev, prev, cur, t, ip;
    var side = [];
    for (i = 0; i < n; i++) side.push((p[i][0] - o[0]) * nx + (p[i][1] - o[1]) * ny);
    for (i = 0; i < n; i++) {
        prev = p[(i + n - 1) % n]; cur = p[i];
        sPrev = side[(i + n - 1) % n]; s = side[i];
        if ((sPrev < 0 && s > 0) || (sPrev > 0 && s < 0)) {
            t = sPrev / (sPrev - s);
            ip = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
            a.push(ip); b.push(ip);
        }
        if (s >= 0) a.push(cur);
        if (s <= 0) b.push(cur);
    }
    return [a, b];
}

function insetPoly(p, c, k) {   // scale toward centroid by factor (1-k)
    var out = [], i;
    for (i = 0; i < p.length; i++) out.push([c[0] + (p[i][0] - c[0]) * (1 - k), c[1] + (p[i][1] - c[1]) * (1 - k)]);
    return out;
}

function sortNumeric(arr) { arr.sort(function (a, b) { return a - b; }); return arr; }

// ---- Pattern A: radial impact fracture (glass pane) ----
// Local space: bbox is [0,W]x[0,H], y grows downward. impact = [ix,iy].
function radialFracture(W, H, impact, shards, jitter, frag, rng) {
    var rays = Math.max(3, Math.round(Math.sqrt(shards) * 1.5));
    var rings = Math.max(1, Math.round(shards / rays));
    var corners = [[0, 0], [W, 0], [W, H], [0, H]], Rmax = 0, i, k, d;
    for (i = 0; i < 4; i++) {
        d = Math.sqrt(Math.pow(corners[i][0] - impact[0], 2) + Math.pow(corners[i][1] - impact[1], 2));
        if (d > Rmax) Rmax = d;
    }
    Rmax *= 1.08;
    var angles = [], step = Math.PI * 2 / rays;
    for (i = 0; i < rays; i++) angles.push(i * step + rng.range(-0.5, 0.5) * step * jitter);
    sortNumeric(angles);

    var radii = [], r, base;
    for (i = 0; i < rays; i++) {
        radii.push([]);
        for (k = 0; k < rings; k++) {
            base = Rmax * Math.pow((k + 1) / rings, 1.45);
            r = (k === rings - 1) ? Rmax : base * (1 + rng.range(-0.5, 0.5) * jitter * 0.9);
            radii[i].push(Math.max(r, 1e-3));
        }
        sortNumeric(radii[i]);
    }
    function P(i, k) {
        var ii = i % rays;
        if (k < 0) return [impact[0], impact[1]];
        return [impact[0] + Math.cos(angles[ii]) * radii[ii][k], impact[1] + Math.sin(angles[ii]) * radii[ii][k]];
    }
    var polys = [], q, t1, t2;
    for (i = 0; i < rays; i++) {
        for (k = 0; k < rings; k++) {
            if (k === 0) q = [P(i, -1), P(i, 0), P(i + 1, 0)];
            else q = [P(i, k - 1), P(i, k), P(i + 1, k), P(i + 1, k - 1)];
            if (q.length === 4 && rng.next() < frag) {
                if (rng.next() < 0.5) { t1 = [q[0], q[1], q[2]]; t2 = [q[0], q[2], q[3]]; }
                else { t1 = [q[0], q[1], q[3]]; t2 = [q[1], q[2], q[3]]; }
                polys.push(t1); polys.push(t2);
            } else polys.push(q);
        }
    }
    return polys;
}

// ---- Pattern B: classic random slices (the 1995 look) ----
function sliceFracture(W, H, shards, jitter, rng) {
    var polys = [[[0, 0], [W, 0], [W, H], [0, H]]], guard = 0, i, best, bestA, a, p, c, o, ang, d, parts;
    while (polys.length < shards && guard++ < shards * 4) {
        // pick a polygon, biased to larger areas
        best = -1; bestA = -1;
        for (i = 0; i < polys.length; i++) {
            a = Math.abs(polyArea(polys[i])) * (0.55 + 0.9 * rng.next());
            if (a > bestA) { bestA = a; best = i; }
        }
        p = polys[best];
        c = polyCentroid(p);
        o = [c[0] + rng.range(-0.35, 0.35) * jitter * W / Math.sqrt(polys.length),
             c[1] + rng.range(-0.35, 0.35) * jitter * H / Math.sqrt(polys.length)];
        ang = rng.next() * Math.PI;
        d = [Math.cos(ang), Math.sin(ang)];
        parts = splitConvex(p, o, d);
        if (parts[0].length >= 3 && parts[1].length >= 3 &&
            Math.abs(polyArea(parts[0])) > 1e-6 && Math.abs(polyArea(parts[1])) > 1e-6) {
            polys.splice(best, 1);
            polys.push(parts[0]); polys.push(parts[1]);
        }
    }
    return polys;
}

// Build the full shard list with physics applied. Returns array of shard descriptors:
// { poly:[[x,y]...] (local, inset), c:[cx,cy], dx, dy, rot(deg), scale, opacity(0..1), light(-1..1) }
function buildShards(W, H, S) {
    var rng = new Rng(S.seed);
    var impact = [W * (0.5 + S.impactX / 200), H * (0.5 + S.impactY / 200)];
    if (S.impactRandom) impact = [rng.range(0.1, 0.9) * W, rng.range(0.1, 0.9) * H];
    var raw = (S.pattern === 1)
        ? sliceFracture(W, H, S.shards, S.jitter / 100, rng)
        : radialFracture(W, H, impact, S.shards, S.jitter / 100, S.frag / 100, rng);

    var Rmax = 0, corners = [[0, 0], [W, 0], [W, H], [0, H]], i, d;
    for (i = 0; i < 4; i++) {
        d = Math.sqrt(Math.pow(corners[i][0] - impact[0], 2) + Math.pow(corners[i][1] - impact[1], 2));
        if (d > Rmax) Rmax = d;
    }
    var minArea = W * H * 0.00002;
    var out = [], p, c, area, r, dir, near, speed, t = S.time / 100, F = S.force / 100, z, sc, op, spin, gx, gy, mag;
    var diag = Math.sqrt(W * W + H * H);
    for (i = 0; i < raw.length; i++) {
        p = clipToRect(raw[i], 0, 0, W, H);
        if (p.length < 3) continue;
        area = Math.abs(polyArea(p));
        if (area < minArea) continue;
        c = polyCentroid(p);
        if (S.gap > 0) p = insetPoly(p, c, S.gap / 100);

        // --- explode physics ---
        r = Math.sqrt(Math.pow(c[0] - impact[0], 2) + Math.pow(c[1] - impact[1], 2));
        dir = r > 1e-6 ? [(c[0] - impact[0]) / r, (c[1] - impact[1]) / r] : [rng.range(-1, 1), rng.range(-1, 1)];
        near = 1 - Math.min(1, r / Rmax);                     // 1 at impact, 0 at far edge
        speed = F * diag * (0.15 + 0.85 * Math.pow(near, 0.7)) * (1 + rng.range(-0.5, 0.5) * S.random / 100);
        z = rng.range(-1, 1);                                 // pseudo depth velocity
        gx = 0; gy = (S.gravity / 100) * diag * 0.9 * t * t;  // +y is DOWN in local space
        mag = speed * t;
        sc = Math.max(0.05, 1 + z * (S.depth / 100) * t * (0.3 + near));
        op = 1 - (S.fade / 100) * t * Math.min(1, (r + mag) / (Rmax + diag * F));
        spin = (S.spin / 100) * 180 * t * rng.range(-1, 1) * (0.4 + near);
        out.push({
            poly: p, c: c,
            dx: dir[0] * mag + gx, dy: dir[1] * mag + gy,
            rot: spin, scale: sc, opacity: Math.max(0, Math.min(1, op)),
            light: Math.sin(Math.atan2(dir[1], dir[0]) + 0.8) * 0.6 + z * 0.4,
            near: near
        });
    }
    return { shards: out, impact: impact, W: W, H: H };
}

function transformPoly(sh) {   // for preview: apply scale + rot about centroid, then translate
    var out = [], i, a = sh.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), x, y;
    for (i = 0; i < sh.poly.length; i++) {
        x = (sh.poly[i][0] - sh.c[0]) * sh.scale; y = (sh.poly[i][1] - sh.c[1]) * sh.scale;
        out.push([sh.c[0] + x * ca - y * sa + sh.dx, sh.c[1] + x * sa + y * ca + sh.dy]);
    }
    return out;
}

function encodeSettings(S) {
    var k, parts = [];
    for (k in S) if (S.hasOwnProperty(k)) parts.push(k + ":" + (typeof S[k] === "string" ? '"' + S[k] + '"' : S[k]));
    return "DoooomShatter:{" + parts.join(",") + "}";
}
function decodeSettings(str) {
    var i;
    if (!str) return null;
    i = str.indexOf("DoooomShatter:") === 0 ? 14 : (str.indexOf("ShatterBox:") === 0 ? 11 : -1);   // accepts legacy notes
    if (i < 0) return null;
    try { return eval("(" + str.substring(i) + ")"); } catch (e) { return null; }
}

var DEFAULTS = {
    pattern: 0,        // 0 radial impact, 1 classic slices
    shards: 60, jitter: 55, frag: 35, gap: 1.5,
    impactX: 0, impactY: 0, impactRandom: false,
    force: 25, time: 40, spin: 30, gravity: 10, random: 40, depth: 25, fade: 20,
    tint: 35, edge: 60, edgeWidth: 0.5,
    cut: 0,            // 0 clip masks (any art), 1 pathfinder true cut (paths only)
    keepOriginal: true,
    seed: 1
};

// Named looks. Values override DEFAULTS; seed is left to the caller.
var PRESETS = {
    "cracked-pane":  { pattern: 0, shards: 90,  jitter: 60, frag: 30, gap: 0.8, force: 0,  time: 0,  spin: 0,  gravity: 0,  depth: 0,  fade: 0,  tint: 30, edge: 70 },
    "glass-impact":  { pattern: 0, shards: 120, jitter: 55, frag: 45, gap: 1.5, force: 35, time: 45, spin: 35, gravity: 15, depth: 30, fade: 25, tint: 40, edge: 60 },
    "doooom":        { pattern: 0, shards: 220, jitter: 85, frag: 80, gap: 2.5, force: 80, time: 75, spin: 70, gravity: 35, random: 70, depth: 55, fade: 45, tint: 50, edge: 40 },
    "kpt-1995":      { pattern: 1, shards: 40,  jitter: 70, gap: 0,   force: 20, time: 50, spin: 15, gravity: 0,  depth: 0,  fade: 0,  tint: 0,  edge: 0 },
    "confetti":      { pattern: 1, shards: 160, jitter: 90, gap: 6,   force: 60, time: 60, spin: 90, gravity: 60, random: 80, depth: 40, fade: 10, tint: 20, edge: 0 },
    "frozen-cracks": { pattern: 0, shards: 60,  jitter: 40, frag: 20, gap: 0.4, force: 6,  time: 20, spin: 4,  gravity: 0,  depth: 0,  fade: 0,  tint: 25, edge: 90, edgeWidth: 0.75 }
};

function applyPreset(S, name) {
    var p = PRESETS[name], k;
    if (!p) return false;
    for (k in p) if (p.hasOwnProperty(k)) S[k] = p[k];
    return true;
}

// Node/CommonJS export (no-op inside ExtendScript, where `module` is undefined).
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        Rng: Rng, polyArea: polyArea, polyCentroid: polyCentroid, clipToRect: clipToRect,
        splitConvex: splitConvex, insetPoly: insetPoly, radialFracture: radialFracture,
        sliceFracture: sliceFracture, buildShards: buildShards, transformPoly: transformPoly,
        encodeSettings: encodeSettings, applyPreset: applyPreset, decodeSettings: decodeSettings, DEFAULTS: DEFAULTS, PRESETS: PRESETS
    };
}
