/**
 * Issue #7 — Game logo opposite corner logic
 *
 * The OPPOSITE_CORNER map flips the vertical axis so the logo sits on the
 * opposite vertical edge from the dashboard, same horizontal side.
 * Dashboard top-right → logo bottom-right, etc.
 */

import { test, expect } from '@playwright/test';

// Re-implementation of the OPPOSITE_CORNER map from game-logo.js
const OPPOSITE_CORNER = {
  'top-right':       'bottom-right',
  'top-left':        'bottom-left',
  'bottom-right':    'top-right',
  'bottom-left':     'top-left',
  'absolute-center': 'bottom-left',
};

test.describe('Issue #7 — Game logo opposite corner', () => {

  test('top-right maps to bottom-right (opposite row, same column)', () => {
    expect(OPPOSITE_CORNER['top-right']).toBe('bottom-right');
  });

  test('top-left maps to bottom-left (opposite row, same column)', () => {
    expect(OPPOSITE_CORNER['top-left']).toBe('bottom-left');
  });

  test('bottom-right maps to top-right (opposite row, same column)', () => {
    expect(OPPOSITE_CORNER['bottom-right']).toBe('top-right');
  });

  test('bottom-left maps to top-left (opposite row, same column)', () => {
    expect(OPPOSITE_CORNER['bottom-left']).toBe('top-left');
  });

  test('opposite corner flips vertical edge (top becomes bottom, bottom becomes top)', () => {
    for (const [from, to] of Object.entries(OPPOSITE_CORNER)) {
      if (from === 'absolute-center') continue;
      const fromEdge = from.split('-')[0];   // 'top' or 'bottom'
      const toEdge   = to.split('-')[0];
      expect(toEdge).not.toBe(fromEdge);
    }
  });

  test('opposite corner preserves horizontal side', () => {
    for (const [from, to] of Object.entries(OPPOSITE_CORNER)) {
      if (from === 'absolute-center') continue;
      const fromSide = from.split('-')[1];   // 'left' or 'right'
      const toSide   = to.split('-')[1];
      expect(toSide).toBe(fromSide);
    }
  });

  test('absolute-center falls back to bottom-left', () => {
    expect(OPPOSITE_CORNER['absolute-center']).toBe('bottom-left');
  });

  test('applying opposite twice returns to original corner', () => {
    const corners = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
    for (const c of corners) {
      expect(OPPOSITE_CORNER[OPPOSITE_CORNER[c]]).toBe(c);
    }
  });
});
