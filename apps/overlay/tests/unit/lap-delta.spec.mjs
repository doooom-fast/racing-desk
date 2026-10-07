/**
 * The HUD's delta (modules/js/lap-delta.js). The plugin's DS.LapDelta is iRacing's LapDeltaToBestLap, which iRacing
 * measures against his best lap ever in that car at that track (its lap file), not this session's: it is there before
 * the session's first lap, and it stays positive until that lap is beaten — his Zandvoort qualifying of 2026-09-29 had it
 * positive on 87% of its frames — and the HUD drew it red with a plus, with nothing to say what it was against. The
 * gap to his best lap of the session, and to the best of each sector (the optimal lap), is worked out on the page from
 * his own laps; each delta is labelled with what it is against, green with a minus when he is gaining and red with a
 * plus when he is losing. First the module in Node, then the real dashboard.html, headless.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const LD = require('../../modules/js/lap-delta.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

// A lap as the page sees it, thirty times a second: the place round the lap and the time on it, at an even pace.
function drive(d, seconds, { session = 'Race|x', upto = 1, clean = true, boundaries = [1 / 3, 2 / 3], from = 0 } = {}) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) {
    const pct = from + (i / n) * (1 - from);
    if (pct > upto) break;
    d.feed({ session, pct, t: (i / n) * seconds * (1 - from), clean, boundaries });
  }
}

test.describe('the module', () => {
  test('nothing to measure against until a lap has been seen whole', () => {
    const d = LD.create();
    drive(d, 90, { upto: 0.5 });
    expect(d.view().best).toBeNull();
    expect(d.view().optimal).toBeNull();
  });

  test('the gap to his best lap of the session, where he is round the lap: a minus when he is quicker', () => {
    const d = LD.create();
    drive(d, 90);
    drive(d, 88);
    drive(d, 91, { upto: 0.5 });
    const v = d.view();
    expect(v.bestTime).toBeCloseTo(88, 1);
    // Half-way round a 91-second lap against an 88: 1.5 s down.
    expect(v.best).toBeCloseTo(1.5, 1);
    const d2 = LD.create();
    drive(d2, 90);
    drive(d2, 87, { upto: 0.5 });
    expect(d2.view().best).toBeCloseTo(-1.5, 1);
  });

  test('the optimal lap is his best of each sector, and the gap to it runs sector by sector', () => {
    const d = LD.create();
    // A lap quick in the first third and slow after it, then one the other way about.
    const lap = (thirds) => {
      const total = thirds.reduce((a, b) => a + b, 0);
      let t = 0;
      for (let s = 0; s < 3; s++) {
        const n = Math.round(thirds[s] * 30);
        for (let i = 0; i < n; i++) {
          d.feed({ session: 'Race|x', pct: s / 3 + (i / n) / 3, t: t + (i / n) * thirds[s], boundaries: [1 / 3, 2 / 3] });
        }
        t += thirds[s];
      }
      return total;
    };
    lap([29, 31, 31]);
    lap([31, 30, 30]);
    d.feed({ session: 'Race|x', pct: 0, t: 0, boundaries: [1 / 3, 2 / 3] });   // over the line: the second lap is done
    const v = d.view();
    expect(v.optimalTime).toBeCloseTo(89, 1);   // 29 + 30 + 30
    expect(v.bestTime).toBeCloseTo(91, 1);
  });

  test('a lap marked invalid, or begun away from the line, is not one to measure against', () => {
    const d = LD.create();
    drive(d, 85, { clean: false });          // quick, but off the track
    drive(d, 90);
    drive(d, 90, { upto: 0.5 });
    expect(d.view().bestTime).toBeCloseTo(90, 1);
    const out = LD.create();
    drive(out, 70, { from: 0.4 });             // an out-lap from the pits: begun at 40%
    drive(out, 90, { upto: 0.5 });
    expect(out.view().best).toBeNull();
  });

  test('a page that draws slowly, and first sees a lap a few percent after the line, still measures it', () => {
    const d = LD.create();
    // Twenty-five looks a lap, the first at 4%: the line itself (nought at nought) is put in for it.
    const lap = (seconds, upto = 1) => {
      for (let i = 1; i < 25; i++) {
        const pct = i / 25;
        if (pct > upto) break;
        d.feed({ session: 'Race|x', pct, t: pct * seconds, boundaries: [] });
      }
    };
    lap(90);
    lap(89);
    lap(88, 0.5);
    expect(d.view().bestTime).toBeCloseTo(89, 0);
    expect(d.view().best).toBeCloseTo(-0.5, 1);
  });

  test('a gap in the frames ends the lap under way: the laps either side are not joined into one, and the best is kept', () => {
    // The rig's HUD switched off at 30% of a lap and back on at 60% two laps later: the samples after the gap were added to
    // the lap from before it, and the one lap made of two became his best.
    const run = (d, lapTime, from, to) => {
      for (let pct = from; pct < to; pct += 1 / (lapTime * 30)) d.feed({ session: 'Race|x', pct, t: pct * lapTime, boundaries: [1 / 3, 2 / 3] });
    };
    const race = (d, gap) => {
      run(d, 90, 0, 1);       // his best, seen whole
      run(d, 95, 0, 0.3);     // switched off here
      gap(d);
      run(d, 85, 0.6, 1);     // and back on here, two laps later
      run(d, 90, 0, 0.2);     // a lap at his best's pace
    };
    const joined = LD.create();
    race(joined, () => {});
    expect(joined.view().bestTime).toBeCloseTo(85, 0);
    expect(joined.view().best).toBeLessThan(-0.5);
    const broken = LD.create();
    race(broken, (d) => {
      d.breakLap();
      expect(d.view().bestTime).toBeCloseTo(90, 1);
      expect(d.view().best).toBeNull();
    });
    expect(broken.view().bestTime).toBeCloseTo(90, 1);
    expect(broken.view().best).toBeCloseTo(0, 1);
  });

  test('a new session starts again', () => {
    const d = LD.create();
    drive(d, 90);
    drive(d, 90, { upto: 0.3 });
    expect(d.view().best).not.toBeNull();
    drive(d, 90, { session: 'Race|y', upto: 0.3 });
    expect(d.view().best).toBeNull();
  });

  test('written with a minus and green when gaining, a plus and red when losing, and neither at nought', () => {
    expect(LD.format(-0.2144)).toEqual({ text: '−0.214', cls: 'delta-faster' });
    expect(LD.format(0.4119)).toEqual({ text: '+0.412', cls: 'delta-slower' });
    expect(LD.format(0.0004)).toEqual({ text: '0.000', cls: 'delta-even' });
    expect(LD.format(null)).toEqual({ text: '', cls: '' });
  });

  test('the one the HUD shows is against his session best once he has one, else his best ever, and says which', () => {
    expect(LD.pick({ best: -0.1 }, 0.4)).toEqual({ value: -0.1, ref: 'session', label: 'vs session best' });
    expect(LD.pick({ best: null }, 0.4)).toEqual({ value: 0.4, ref: 'alltime', label: 'vs all-time best' });
    expect(LD.pick({ best: null }, 0)).toBeNull();
  });
});

test.describe('on the HUD', () => {
  test('the rig\'s delta says what it is against: his best ever until he has a lap of the session, then that lap', async ({ page }) => {
    test.setTimeout(60000);
    let payload = frame({ order: fieldWith(5), state: 4, mode: 4, start: 5, lap: 3, playerPct: 0.1, curLapTime: 9.3, lapDelta: 0.412 });
    await page.route(/^https?:\/\//, (route) => {
      if (/^http:\/\/localhost:8889\/racing-desk\/$/.test(route.request().url())) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      }
      return route.abort();
    });
    await page.goto(DASHBOARD, { waitUntil: 'load' });
    // The WebGL effects are not what this is about, and a headless browser draws them in software at a dozen frames a
    // second: the laps below would be seen in too few places to be laps.
    await page.evaluate(() => { _settings.showWebGL = false; });
    await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 3, null, { timeout: 10000 });
    const row = () => page.evaluate(() => {
      const r = document.querySelector('#positionPage .pos-meta-row.delta-row');
      return { ref: r.querySelector('.delta-ref').textContent, val: r.querySelector('.val').textContent, cls: r.querySelector('.val').className,
        ds: [document.getElementById('dsDeltaRef').textContent, document.getElementById('dsDelta').textContent] };
    });
    // Before a lap of the session: iRacing's, labelled as his best ever, red with a plus.
    await page.waitForTimeout(400);
    expect(await row()).toEqual({ ref: 'vs all-time best', val: '+0.412', cls: 'val delta-slower', ds: ['vs all-time best', '+0.412'] });

    // Two laps, 92.8 then 92.0 (timed by the payload's clock), then half of one a little quicker.
    const lap = async (seconds, upto = 1) => {
      for (let i = 0; i < 80; i++) {
        const pct = i / 80;
        if (pct > upto) break;
        payload = frame({ order: fieldWith(5), state: 4, mode: 4, start: 5, lap: 4, playerPct: pct, curLapTime: +(pct * seconds).toFixed(3), lapDelta: 0.412 });
        await page.waitForTimeout(60);
      }
    };
    await lap(92.8);
    await lap(92.0);
    await lap(91.6, 0.5);
    await page.waitForTimeout(300);
    const now = await row();
    expect(now.ref).toBe('vs session best');
    expect(now.val.startsWith('−')).toBe(true);
    expect(now.cls).toBe('val delta-faster');
    expect(now.ds[0]).toBe('vs session best');
    expect(+now.val.slice(1)).toBeGreaterThan(0.1);
    expect(+now.val.slice(1)).toBeLessThan(0.35);
  });
});
