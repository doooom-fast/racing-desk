/**
 * iRacing's <role>_<id>.<ext> naming: the ordered role list, both library filename shapes, and the names an
 * install must produce. Port of the tests in apps/paints/src-tauri/src/roles.rs.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const roles = require('../../modules/js/paints/roles.js');

test.describe('parseInstalled', () => {
  test('the longest role prefix wins — the whole point of the ordered role list', () => {
    expect(roles.parseInstalled('car_spec_424242.tga').role).toBe('car_spec');
    expect(roles.parseInstalled('car_424242.tga').role).toBe('car');
    expect(roles.parseInstalled('car_decal_42.tga').role).toBe('car_decal');
    expect(roles.parseInstalled('car_num_7.mip').role).toBe('car_num');
  });

  test('parses the id and the extension, lower-cased', () => {
    expect(roles.parseInstalled('car_spec_424242.mip')).toEqual({ role: 'car_spec', id: '424242', ext: 'mip' });
    expect(roles.parseInstalled('CAR_424242.TGA')).toEqual({ role: 'car', id: '424242', ext: 'tga' });
  });

  test('helmets, suits and stray files are ignored', () => {
    // Helmets and suits live in the paint root and belong to whoever you raced.
    for (const name of ['helmet_424242.tga', 'suit_424242.tga', 'car_notanid.tga', 'preview.png', 'car_.tga',
      'car_spec_x.tga', 'car_424242.png', 'car_424242', 'car_424242.doooom-tmp']) {
      expect(roles.parseInstalled(name), name).toBeNull();
    }
  });
});

test.describe('parseLibraryFile', () => {
  test('accepts both shapes: role-only and role_<id>', () => {
    expect(roles.parseLibraryFile('car.tga')).toBe('car');
    expect(roles.parseLibraryFile('car_spec.tga')).toBe('car_spec');
    expect(roles.parseLibraryFile('car_424242.tga')).toBe('car');
    expect(roles.parseLibraryFile('car_spec_424242.tga')).toBe('car_spec');
    expect(roles.parseLibraryFile('Car_Spec.TGA')).toBe('car_spec');
  });

  test('previews, meta and cooked files are not roles', () => {
    expect(roles.parseLibraryFile('preview_side.png')).toBeNull();
    expect(roles.parseLibraryFile('meta.json')).toBeNull();
    expect(roles.parseLibraryFile('car_424242.mip')).toBeNull();
    expect(roles.parseLibraryFile('car_x.tga')).toBeNull();
  });
});

test('installedName renames a role for a customer', () => {
  expect(roles.installedName('car_spec', '424242', 'tga')).toBe('car_spec_424242.tga');
  expect(roles.installedName('car', '42', roles.TEXTURE_EXT)).toBe('car_42.tga');
});

test('role labels for the UI', () => {
  expect(roles.roleLabel('car')).toBe('Paint');
  expect(roles.roleLabel('car_spec')).toBe('Spec map');
  expect(roles.roleLabel('car_decal')).toBe('Decal');
  expect(roles.roleLabel('car_num')).toBe('Number');
  expect(roles.roleLabel('anything')).toBe('Texture');
});

test('the constants the other modules lean on', () => {
  expect(roles.CAR_ROLES).toEqual(['car_spec', 'car_decal', 'car_num', 'car']);
  expect(roles.TEXTURE_EXT).toBe('tga');
  expect(roles.COOKED_EXT).toBe('mip');
});
