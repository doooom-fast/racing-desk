/**
 * Whether the cars ahead and behind are closing or dropping away (modules/js/gap-trend.js): the gap to each at the
 * start of every lap, and what is said is how it changed from the lap before. Run in Node: the module is pure.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const GT = require('../../modules/js/gap-trend.js');

test.describe('the gap to the car ahead and the one behind, lap on lap', () => {
  test('nothing is said until a second lap has been seen with the same car', () => {
    const g = GT.create();
    expect(g.update(5, 'C. Charlie', -2.0, 'D. Delta', 1.0)).toEqual({ ahead: null, behind: null });
    expect(g.update(5, 'C. Charlie', -1.8, 'D. Delta', 1.1)).toEqual({ ahead: null, behind: null });
  });

  test('closing on the car ahead is a shrinking gap, and good; the car behind closing on him is bad', () => {
    const g = GT.create();
    g.update(5, 'C. Charlie', -2.0, 'D. Delta', 1.0);
    const said = g.update(6, 'C. Charlie', -1.5, 'D. Delta', 0.7);
    expect(said.ahead).toEqual({ change: -0.5, text: '▼0.5/lap', cls: 'good' });
    expect(said.behind.text).toBe('▼0.3/lap');
    expect(said.behind.cls).toBe('bad');
    // The rest of the lap it goes on saying the same, whatever the gap does in the middle of it.
    expect(g.update(6, 'C. Charlie', -1.2, 'D. Delta', 0.5).ahead.text).toBe('▼0.5/lap');
  });

  test('dropping back from the car ahead is a growing gap, and bad; pulling away from the car behind is good', () => {
    const g = GT.create();
    g.update(5, 'C. Charlie', -1.0, 'D. Delta', 1.0);
    const said = g.update(6, 'C. Charlie', -1.6, 'D. Delta', 1.5);
    expect(said.ahead).toEqual({ change: 0.6000000000000001, text: '▲0.6/lap', cls: 'bad' });
    expect(said.behind.text).toBe('▲0.5/lap');
    expect(said.behind.cls).toBe('good');
  });

  test('a gap that has moved less than 0.05s a lap says nothing', () => {
    const g = GT.create();
    g.update(5, 'C. Charlie', -1.0, 'D. Delta', 1.0);
    expect(g.update(6, 'C. Charlie', -1.03, 'D. Delta', 0.97)).toEqual({ ahead: null, behind: null });
  });

  test('another car in the place begins again, and so does a lap counter that goes back or a gap that is not there', () => {
    const g = GT.create();
    g.update(5, 'C. Charlie', -1.0, 'D. Delta', 1.0);
    g.update(6, 'C. Charlie', -0.6, 'D. Delta', 1.3);
    // He passes Charlie: the car ahead is somebody else, and its trend is its own to make.
    expect(g.update(7, 'B. Bravo', -2.0, 'D. Delta', 1.6).ahead).toBeNull();
    expect(g.update(8, 'B. Bravo', -1.4, 'D. Delta', 1.9).ahead.text).toBe('▼0.6/lap');
    // No car behind (a gap of nothing) says nothing, and a new session (the lap goes back) starts clean.
    expect(g.update(9, 'B. Bravo', -1.2, '', 0).behind).toBeNull();
    expect(g.update(1, 'B. Bravo', -1.2, 'D. Delta', 1.9)).toEqual({ ahead: null, behind: null });
  });
});
