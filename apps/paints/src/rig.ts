// What The Racing Desk's host keeps for a car beside its paint: the view it was last driven with, and which of
// SmartControl's pedal profiles it is driven with. The rows are the host's — /racing-desk/data/{cars,views,pedals},
// asked for by the app's main process (apps/overlay/modules/js/rig-api.js) — and nothing here asks for anything:
// this shapes what came back, and puts its numbers into words.
//
// Nothing the host says is taken on trust. A row that is not a row is left out, a number that is not one is
// "none", and an answer that is not the one asked for is said in words where the car's view or pedals would be.
import type { CatalogueCar } from "./types";

/// The view a car was last driven with. Lengths are metres, as the host has them.
export interface CarView {
  carPath: string;
  height: number | null;
  horizon: number | null;
  headHorizon: number | null;
  fov: number | null;
  seatX: number | null;
  seatY: number | null;
  seatZ: number | null;
  /// Changed by the driver while in this car, or carried over from the car driven before it. Null when the
  /// host does not say.
  chosen: boolean | null;
  seenAt: string | null;
}

export interface Brake {
  maxForceKg: number | null;
  deadzoneBottom: number | null;
  curve: number[] | null;
}

/// One of SmartControl's profiles, as far as the page shows it: the brake.
export interface Profile {
  id: string;
  name: string;
  brake: Brake | null;
}

/// A key SmartControl Live is bound to, and what it does to the brake force.
export interface LiveKey {
  action: string | null;
  value: number | null;
  keys: string[];
}

/// What the host keeps of a car's pedals. `profileId` is null for a car with no profile of its own, of which
/// the host may still know the brake force it was last driven with.
export interface CarPedals {
  carPath: string;
  profileId: string | null;
  profileName: string | null;
  brakeForceKg: number | null;
  /// How the profile stands in SmartControl since the car was given it: same, changed, gone or unknown.
  profileNow: string | null;
}

export interface Pedals {
  /// Whether SmartControl is on this rig at all.
  found: boolean;
  profiles: Profile[];
  keys: LiveKey[];
  cars: Map<string, CarPedals>;
}

/// The host's answers as the page uses them. `views` and `pedals` are null when the host had none to give, and
/// the note beside each says why, in words.
export interface Rig {
  /// The store's own spelling of each car's path, which is what a write has to name.
  paths: Map<string, string>;
  carsNote: string | null;
  views: Map<string, CarView> | null;
  viewsNote: string | null;
  pedals: Pedals | null;
  pedalsNote: string | null;
}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
const isCarRow = (v: unknown): v is Row & { car_path: string } =>
  isRow(v) && typeof v.car_path === "string" && v.car_path.trim().length > 0;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(isRow) : []);

/// A car's path with `-`, `_`, case and spacing folded away, as the list of cars folds them to know the
/// library's `mx5-mx52016` and the sim's `mx5 mx52016` for one car (the app's paints/library.js, `normalise`).
export const carKey = (path: string): string =>
  path.replace(/[-_\s]+/g, " ").trim().toLowerCase();

/// The key the host's rows for a car go by: the sim's name for it, or the library's where the sim has none.
export const rigKey = (car: Pick<CatalogueCar, "folder" | "simFolder">): string =>
  carKey(car.simFolder ?? car.folder);

const OLDER = (what: string) => `This host is older than the page: it has no ${what} to show yet.`;

function answerOf(read: unknown, route: string): { value?: unknown; missing: boolean; error: string | null } {
  const answer = isRow(read) ? read[route] : undefined;
  if (!isRow(answer)) return { missing: false, error: "The app did not answer." };
  if ("value" in answer) return { value: answer.value, missing: false, error: null };
  if (answer.missing === true) return { missing: true, error: null };
  return { missing: false, error: text(answer.error) ?? "No reason was given." };
}

function viewOf(row: Row & { car_path: string }): CarView {
  return {
    carPath: row.car_path,
    height: num(row.driver_height),
    horizon: num(row.vanish_y),
    headHorizon: num(row.head_horizon),
    fov: num(row.fov),
    seatX: num(row.seat_x),
    seatY: num(row.seat_y),
    seatZ: num(row.seat_z),
    chosen: row.chosen == null ? null : Boolean(row.chosen),
    seenAt: text(row.seen_at),
  };
}

function brakeOf(v: unknown): Brake | null {
  if (!isRow(v)) return null;
  return {
    maxForceKg: num(v.max_force_kg),
    deadzoneBottom: num(v.deadzone_bottom),
    curve: Array.isArray(v.curve) && v.curve.every((p) => num(p) !== null) ? (v.curve as number[]) : null,
  };
}

function pedalsOf(row: Row & { car_path: string }): CarPedals {
  return {
    carPath: row.car_path,
    profileId: text(row.profile_id),
    profileName: text(row.profile_name),
    brakeForceKg: num(row.brake_force_kg),
    profileNow: text(row.profile_now),
  };
}

/// What `window.racingDesk.rig.read()` answered — { cars, views, pedals }, each { value }, { missing } or
/// { error } — as the page uses it.
export function readRig(read: unknown): Rig {
  const out: Rig = {
    paths: new Map(),
    carsNote: null,
    views: null,
    viewsNote: null,
    pedals: null,
    pedalsNote: null,
  };
  // The first spelling of a path stands: the store's own list is read first, and is the one a write is checked
  // against.
  const know = (path: string) => {
    if (!out.paths.has(carKey(path))) out.paths.set(carKey(path), path);
  };

  const cars = answerOf(read, "cars");
  if (Array.isArray(cars.value)) cars.value.filter(isCarRow).forEach((c) => know(c.car_path));
  else if (cars.missing) out.carsNote = "This host has no list of cars.";
  else out.carsNote = `The host's cars could not be read. ${cars.error ?? "Its answer was not a list."}`;

  const views = answerOf(read, "views");
  if (Array.isArray(views.value)) {
    out.views = new Map(views.value.filter(isCarRow).map((v) => [carKey(v.car_path), viewOf(v)]));
    for (const view of out.views.values()) know(view.carPath);
  } else if (views.missing) out.viewsNote = OLDER("views");
  else out.viewsNote = `The views could not be read. ${views.error ?? "The host's answer was not a list."}`;

  const pedals = answerOf(read, "pedals");
  const smartControl = isRow(pedals.value) ? pedals.value.smartcontrol : undefined;
  if (isRow(pedals.value) && isRow(smartControl)) {
    const found = smartControl.found === true;
    // The cars given a profile, then those the host knows something of all the same — a brake force set by key.
    const known = [...rows(pedals.value.cars), ...rows(pedals.value.without_profile)].filter(isCarRow);
    out.pedals = {
      found,
      profiles: rows(smartControl.profiles).flatMap((p) => {
        const id = text(p.id);
        return id === null ? [] : [{ id, name: text(p.name) ?? id, brake: brakeOf(p.brake) }];
      }),
      keys: rows(smartControl.keys).map((k) => ({
        action: text(k.action),
        value: num(k.value),
        keys: Array.isArray(k.keys) ? k.keys.map(String) : [],
      })),
      cars: new Map(),
    };
    for (const row of known) {
      const key = carKey(row.car_path);
      if (!out.pedals.cars.has(key)) out.pedals.cars.set(key, pedalsOf(row));
      know(row.car_path);
    }
    if (!found) {
      out.pedalsNote = "SmartControl wasn't found on this rig, so there are no profiles to choose from.";
    }
  } else if (pedals.missing) out.pedalsNote = OLDER("pedals");
  else {
    out.pedalsNote = `The pedals could not be read. ${
      pedals.error ?? "The host's answer was not SmartControl's profiles."
    }`;
  }
  return out;
}

/// The car's row as `bindPedals` answered it, or null when the answer was that the car has none now.
export function boundRow(car: unknown, carPath: string): CarPedals | null {
  return isRow(car) ? pedalsOf({ ...car, car_path: carPath }) : null;
}

/// Whether a car has anything of its pedals kept: a profile of its own, or a brake force it was driven with.
export const hasPedals = (car: CarPedals | undefined): boolean =>
  !!car && (car.profileId !== null || car.brakeForceKg !== null);

// ── Into words ──

/// A number as the host gave it, less what a float picks up on the way: 0.05999999865889549 is 0.06.
export const plain = (n: number): string => String(Number(n.toFixed(4)));

/// Metres as whole millimetres, with the sign: −0.06 is "−60". Which way a sign points is the host's to say.
export function millimetres(metres: number): string {
  const v = Math.round(metres * 1000);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;
}

export function signedPlain(n: number): string {
  const size = plain(Math.abs(n));
  return (size === "0" ? "" : n > 0 ? "+" : "−") + size;
}

/// "linear" when the output is the input at every point — 0, 20, 40 … 100 across six — "shaped" when it is
/// not, and null for a curve with too few points to say.
export function curveShape(curve: number[] | null): "linear" | "shaped" | null {
  if (!curve || curve.length < 2) return null;
  const step = 100 / (curve.length - 1);
  return curve.every((v, i) => Math.abs(v - i * step) < 0.5) ? "linear" : "shaped";
}

// SmartControl Live names keys as Windows does. These are the ones seen; any other is shown as it is.
const KEY_NAMES = new Map([
  ["PRIOR", "Page Up"],
  ["NEXT", "Page Down"],
  ["PAUSE", "Pause"],
  ["RCONTROL", "Right Ctrl"],
  ["UP", "Up"],
  ["DOWN", "Down"],
]);

/// A key of SmartControl Live's by the names on the keycaps, and what pressing it does.
export function keyWords(key: LiveKey): { keys: string; does: string } {
  const kg = key.value === null ? "" : `${plain(key.value)} kg`;
  const does =
    key.action === "set"
      ? `brake force ${kg}`
      : key.action === "raise"
        ? `${kg} more`
        : key.action === "lower"
          ? `${kg} less`
          : `${key.action ?? "other"}${key.value === null ? "" : ` (${plain(key.value)})`}`;
  return { keys: key.keys.map((k) => KEY_NAMES.get(k) ?? k).join(" + ") || "?", does: does.trim() };
}

/// How long ago, in the desk's words.
export function ago(iso: string, now: number = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/// A moment as the desk writes one, or null for what is not a moment.
export function when(iso: string | null): string | null {
  if (iso === null || Number.isNaN(Date.parse(iso))) return null;
  return dateTime.format(new Date(iso));
}
