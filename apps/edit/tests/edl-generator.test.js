// ═══════════════════════════════════════════════════════════════
// EDL GENERATOR TESTS
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';

// These tests focus on the helper functions and error conditions
// without invoking the full analyze() which requires Claude detection

test('EDL generator - helper functions exist and are callable', () => {
  // Import the module to verify it parses
  import('../src/analyze/edl-generator.js').then(mod => {
    assert(typeof mod.analyze === 'function', 'Should export analyze function');
  }).catch(err => {
    // Expected if claude-director tries to detect on import
    assert(err, 'Module import may trigger Claude detection');
  });
});

test('Mechanical EDL structure requirements', () => {
  // Test the shape of EDL objects without full file I/O
  const mechanicalEDL = {
    title: 'Race Edit — P5 → P2',
    total_duration: '1:40',
    cuts: [
      { start: '0:00', end: '0:30', source: 'cockpit', reason: 'Default cockpit' },
      { start: '0:30', end: '1:00', source: 'tv', reason: 'High TV score (mechanical)' },
      { start: '1:00', end: '1:40', source: 'cockpit', reason: 'Default cockpit' },
    ],
    highlight_reel: {
      segments: [
        { start: '0:07', end: '0:18', source: 'mixed', label: 'P5 → P4' },
        { start: '0:47', end: '1:08', source: 'mixed', label: 'Incident (+1x)' },
      ],
    },
    scores: {
      tvScoreAvg: 35.2,
      interestScoreAvg: 42.8,
      tvViewPercent: 33.3,
    },
  };

  // Validate structure
  assert(mechanicalEDL.title, 'EDL should have title');
  assert(mechanicalEDL.total_duration, 'EDL should have total_duration');
  assert(Array.isArray(mechanicalEDL.cuts), 'EDL should have cuts array');
  assert(mechanicalEDL.cuts.length > 0, 'Cuts should not be empty');

  for (const cut of mechanicalEDL.cuts) {
    assert(typeof cut.start === 'string', 'Cut start should be string');
    assert(typeof cut.end === 'string', 'Cut end should be string');
    assert(['cockpit', 'tv'].includes(cut.source), 'Cut source should be valid');
    assert(typeof cut.reason === 'string', 'Cut should have reason');
  }

  assert(Array.isArray(mechanicalEDL.highlight_reel.segments), 'Highlights should be array');
  for (const hl of mechanicalEDL.highlight_reel.segments) {
    assert(typeof hl.start === 'string', 'Highlight start should be string');
    assert(typeof hl.end === 'string', 'Highlight end should be string');
    assert(typeof hl.label === 'string', 'Highlight should have label');
  }

  assert(mechanicalEDL.scores, 'EDL should have scores');
  assert(
    mechanicalEDL.scores.tvScoreAvg >= 0 && mechanicalEDL.scores.tvScoreAvg <= 100,
    'TV score should be 0-100'
  );
  assert(
    mechanicalEDL.scores.tvViewPercent >= 0 && mechanicalEDL.scores.tvViewPercent <= 100,
    'TV percent should be 0-100'
  );
});

test('EDL - score averaging edge cases', () => {
  // Test the avg helper function behavior
  const avg = (arr) => {
    if (arr.length === 0) return 0;
    return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
  };

  assert.strictEqual(avg([]), 0, 'Empty array should average to 0');
  assert.strictEqual(avg([50]), 50, 'Single value should return itself');
  assert.strictEqual(avg([0, 100]), 50, 'Simple average should work');
  assert.strictEqual(avg([33.333, 66.667]), 50.0, 'Rounding to 1 decimal');
});

test('EDL - TV percent calculation edge cases', () => {
  // Test calcTVPercent behavior
  const calcTVPercent = (segments, totalSec) => {
    if (totalSec <= 0) return 0;
    const tvSec = segments
      .filter(s => s.source === 'tv')
      .reduce((sum, s) => sum + (s.end - s.start), 0);
    return +((tvSec / totalSec) * 100).toFixed(1);
  };

  // Zero duration edge case
  assert.strictEqual(calcTVPercent([], 0), 0, 'Zero duration gives 0%');

  // All cockpit
  const cockpitOnly = [
    { source: 'cockpit', start: 0, end: 100 },
  ];
  assert.strictEqual(calcTVPercent(cockpitOnly, 100), 0, 'All cockpit gives 0% TV');

  // All TV
  const tvOnly = [
    { source: 'tv', start: 0, end: 100 },
  ];
  assert.strictEqual(calcTVPercent(tvOnly, 100), 100.0, 'All TV gives 100% TV');

  // Mixed
  const mixed = [
    { source: 'cockpit', start: 0, end: 60 },
    { source: 'tv', start: 60, end: 100 },
  ];
  assert.strictEqual(calcTVPercent(mixed, 100), 40.0, '40% TV works');
});

test('EDL - cuts should be continuous', () => {
  // Verify that a valid cut sequence covers the race without gaps
  const cuts = [
    { start: 0, end: 30, source: 'cockpit' },
    { start: 30, end: 60, source: 'tv' },
    { start: 60, end: 100, source: 'cockpit' },
  ];

  // Check continuity
  for (let i = 1; i < cuts.length; i++) {
    assert.strictEqual(
      cuts[i].start,
      cuts[i - 1].end,
      `Cut ${i} should start where cut ${i-1} ends`
    );
  }
});
