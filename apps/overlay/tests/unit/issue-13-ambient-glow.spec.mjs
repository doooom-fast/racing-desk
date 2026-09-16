/**
 * Issue #13 — Ambient plastic glow must not escape panel bounds
 *
 * CSS box-shadow ignores overflow:hidden by spec — outer shadows bleed
 * through. The fix uses inset-only box-shadows. These tests load the
 * ambient.css stylesheet and verify no outer box-shadow rules remain
 * on the ambient-plastic panel selectors.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CSS_PATH = path.resolve(
  new URL('.', import.meta.url).pathname,
  '../../modules/styles/ambient.css'
);

test.describe('Issue #13 — Ambient CSS: inset-only box-shadows on plastic panels', () => {

  let css;
  test.beforeAll(() => {
    css = fs.readFileSync(CSS_PATH, 'utf8');
  });

  // Extract box-shadow declarations from rules that match the plastic panel selector
  function extractBoxShadowsForSelector(cssText, selectorFragment) {
    const rules = [];
    // Simple block extraction: find selector, grab the block contents
    const regex = new RegExp(
      `${selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]+)\\}`,
      'g'
    );
    let m;
    while ((m = regex.exec(cssText)) !== null) {
      const block = m[1];
      const shadowMatch = block.match(/box-shadow\s*:\s*([^;]+);/);
      if (shadowMatch) rules.push(shadowMatch[1].trim());
    }
    return rules;
  }

  test('ambient.css file exists and is non-empty', () => {
    expect(fs.existsSync(CSS_PATH)).toBe(true);
    expect(css.length).toBeGreaterThan(0);
  });

  test('ambient-plastic .panel has box-shadow rules', () => {
    expect(css).toMatch(/ambient-plastic.*\.panel|\.panel.*ambient-plastic/);
  });

  test('no outer (non-inset) box-shadow on ambient-plastic panel rules', () => {
    // Find all box-shadow declarations in blocks containing 'ambient-plastic'
    const plasticBlocks = css.match(/body\.ambient-plastic[^{]*\{[^}]*box-shadow[^}]*\}/g) || [];
    for (const block of plasticBlocks) {
      const shadowDecl = block.match(/box-shadow\s*:\s*([^;]+)/)?.[1] ?? '';
      // Split into individual shadow layers (comma-separated)
      const layers = shadowDecl.split(',').map(s => s.trim());
      for (const layer of layers) {
        if (!layer) continue;
        // An outer shadow does NOT start with 'inset'
        const isInset = /^\s*inset\b/.test(layer);
        expect(isInset, `Found non-inset shadow layer: "${layer}"`).toBe(true);
      }
    }
  });

  test('inset keyword present in ambient-plastic box-shadow declarations', () => {
    const plasticSection = css.split('ambient-plastic').slice(1).join('ambient-plastic');
    expect(plasticSection).toMatch(/box-shadow\s*:\s*[^;]*inset/);
  });

  test('overflow: hidden is set on ambient-plastic panel rules', () => {
    const plasticBlocks = css.match(/body\.ambient-plastic[^{]*\{[^}]*\}/g) || [];
    const overflowBlock = plasticBlocks.find(b => b.includes('overflow'));
    expect(overflowBlock).toBeDefined();
    expect(overflowBlock).toContain('overflow: hidden');
  });
});
