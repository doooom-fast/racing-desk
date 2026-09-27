// iRacing names a car's textures `<role>_<customerId>.<ext>`. Ported from apps/paints/src-tauri/src/roles.rs.
//
// The role list is not a guess: it is what actually turns up in a populated Documents\iRacing\paint. Trading
// Paints delivers other drivers' spec maps as pre-cooked `.mip`, so a `car_spec_<id>.tga` on disk is nearly
// always a paint someone installed by hand — customer.js leans on that.

// Car roles, longest prefix first — `car_spec_123.tga` also matches the bare `car_` prefix, so the order is
// load-bearing and every lookup walks this list in sequence.
const CAR_ROLES = Object.freeze(['car_spec', 'car_decal', 'car_num', 'car']);

// Extensions the sim reads. `.tga` is the source; `.mip` is the sim's cooked cache.
const TEXTURE_EXT = 'tga';
const COOKED_EXT = 'mip';

const DIGITS = /^[0-9]+$/;

function splitExt(fileName) {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return [fileName.slice(0, dot), fileName.slice(dot + 1)];
}

// Split an installed filename into { role, id, ext }: `car_spec_1159839.tga` → car_spec / 1159839 / tga.
// Null for anything that is not `<known role>_<digits>.<tga|mip>`, which is how helmets, suits and stray
// files stay out of the way.
function parseInstalled(fileName) {
  const parts = splitExt(fileName);
  if (!parts) return null;
  const ext = parts[1].toLowerCase();
  if (ext !== TEXTURE_EXT && ext !== COOKED_EXT) return null;
  const lower = parts[0].toLowerCase();
  for (const role of CAR_ROLES) {
    const prefix = `${role}_`;
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      if (rest.length && DIGITS.test(rest)) return { role, id: rest, ext };
    }
  }
  return null;
}

// Which role a file inside a library version folder plays. Two shapes are accepted because both exist in the
// wild: the plan's `car.tga` / `car_spec.tga` with no customer id, and `car_1159839.tga`, which is what the
// design pipeline already emits. Previews (`preview*.png`) and `meta.json` are deliberately not roles.
function parseLibraryFile(fileName) {
  const parts = splitExt(fileName);
  if (!parts) return null;
  if (parts[1].toLowerCase() !== TEXTURE_EXT) return null;
  const lower = parts[0].toLowerCase();
  for (const role of CAR_ROLES) {
    if (lower === role) return role;
    const prefix = `${role}_`;
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      if (rest.length && DIGITS.test(rest)) return role;
    }
  }
  return null;
}

// The name a role must take once installed for a given customer.
function installedName(role, customerId, ext) {
  return `${role}_${customerId}.${ext}`;
}

// Human label for a role, for the UI.
function roleLabel(role) {
  switch (role) {
    case 'car': return 'Paint';
    case 'car_spec': return 'Spec map';
    case 'car_decal': return 'Decal';
    case 'car_num': return 'Number';
    default: return 'Texture';
  }
}

module.exports = { CAR_ROLES, TEXTURE_EXT, COOKED_EXT, parseInstalled, parseLibraryFile, installedName, roleLabel };
