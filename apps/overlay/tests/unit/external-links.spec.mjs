/**
 * What 'open-external' will hand to the OS: web links, and the iRacing UI's racing routes — nothing else.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isAllowedExternalUrl } = require('../../modules/js/external-links.js');

test.describe('open-external allowlist', () => {
  test('lets web links and the iRacing UI racing routes through', () => {
    for (const url of [
      'https://example.com/x',
      'http://localhost:8889/racing-desk/',
      'iracing://web/racing/official/',
      'iracing://web/racing/official/series-list/6273/',
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(true);
    }
  });

  test('refuses everything else', () => {
    for (const url of [
      'iracing://settings',
      'iracing://web/shop/',
      'iracing://web/racing/official/?x=1',
      'IRACING://web/racing/official/',
      'iracing-alpha://web/racing/official/',
      'iracing://web/racing/../help',
      'iracing://web/racing/official/%2e%2e/',
      'file:///C:/Windows/notepad.exe',
      'javascript:alert(1)',
      'data:text/html,hi',
      'racing-desk-native://settings',
      '',
      null,
      42,
    ]) {
      expect(isAllowedExternalUrl(url), String(url)).toBe(false);
    }
  });
});
