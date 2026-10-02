// What The Racing Desk's host keeps for a car beside its paint: the view it was last driven with, and which of
// SmartControl's pedal profiles it is driven with; and what the canonical list of cars says of it, and where the
// car disagrees. The rows are the host's — /racing-desk/data/{cars,views,pedals,controls}, asked for by the app's
// main process (apps/overlay/modules/js/rig-api.js) — and nothing here asks for anything: this shapes what came
// back, and puts its numbers into words.
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

/// Who gave a car its profile: the driver's rule, the driver on this page, or — "none" — the driver's choice that
/// the car has no profile of its own, which the rule then leaves alone.
export type GivenBy = "rule" | "driver" | "none";

/// What the host keeps of a car's pedals. `profileId` is null for a car with no profile of its own, of which
/// the host may still know the brake force it was last driven with, and whether it has ABS.
export interface CarPedals {
  carPath: string;
  profileId: string | null;
  profileName: string | null;
  /// The force the car was last driven with, set with SmartControl Live's keys. Null when none is known, and
  /// the profile's own then stands.
  brakeForceKg: number | null;
  /// When that force was set.
  forceAt: string | null;
  /// How the profile stands in SmartControl since the car was given it: same, changed, gone or unknown.
  profileNow: string | null;
  /// Null while too little has been driven to say, and from a host that does not say.
  hasAbs: boolean | null;
  givenBy: GivenBy | null;
  /// What the rule went by: "ABS", "no ABS", "a formula car", "a prototype".
  givenWhy: string | null;
}

export interface Pedals {
  /// Whether SmartControl is on this rig at all.
  found: boolean;
  /// Whether this host says who gave a car its profile and what a car without one is waiting for. One from
  /// before it did says none of it, and neither does the page then.
  told: boolean;
  profiles: Profile[];
  keys: LiveKey[];
  cars: Map<string, CarPedals>;
}

/// Whether a car has anti-lock, traction control or a brake bias, as the list says: none, fixed (it has it and the
/// driver cannot turn it) or adjustable.
export type Having = "none" | "fixed" | "adjustable";

/// One in-car control as the list gives it: what the car calls it and the values it can have.
export interface ListedControl {
  /// Ours: abs, tc, tc2, brakeBias, brakeMigration, arbFront, mode, drs… A car may list some more than once.
  id: string;
  /// The telemetry variable that carries it.
  variable: string | null;
  /// What the car's own dash or black box calls it.
  label: string | null;
  /// The control in words where the list gives them ("Traction slip" for a TCLO): what the HUD shows where it fits,
  /// and the title of the car's own label here.
  words: string | null;
  /// The value that is off; false where the list says no value of it is.
  off: number | false | null;
  range: [number, number] | null;
  /// Names for the values of a dial that is a mode and not a number, in the order of the values.
  positions: [number, string][];
  /// For a mode: which of abs, tc and brakeBias it stands for. Null where the list does not say.
  covers: string[] | null;
}

/// One car of the canonical list.
export interface ListedCar {
  path: string;
  name: string | null;
  kind: string | null;
  abs: Having | null;
  tc: Having | null;
  brakeBias: Having | null;
  controls: ListedControl[];
  /// "telemetry": compared with what the car publishes on this rig. "written": from what is written about it.
  checked: string | null;
}

/// One thing the check of the list has said of a car: where what the car publishes disagrees with what the list
/// says of it, or that the list does not have the car. The host says each once per run and keeps it, with when it
/// was first and last said.
export interface Remark {
  /// Which thing was said — the host's own key for it; "unknown" is a car the list does not have.
  about: string;
  text: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

/// The canonical list of cars, and what its check has found. Both by key (`carKey`).
export interface CarListRead {
  cars: Map<string, ListedCar>;
  /// What the check has said of each car against the list in use. Null where the host could not read the store
  /// it keeps them in — which is not the same as none.
  kept: Map<string, Remark[]> | null;
}

/// The host's answers as the page uses them. `views` and `pedals` are null when the host had none to give, and
/// the note beside each says why, in words. `list` is null when there is no list to show: a host from before it,
/// or one whose build carries none — the page is then as it was — or one that could not be read, which
/// `listNote` says.
export interface Rig {
  /// The store's own spelling of each car's path, which is what a write has to name.
  paths: Map<string, string>;
  carsNote: string | null;
  views: Map<string, CarView> | null;
  viewsNote: string | null;
  pedals: Pedals | null;
  pedalsNote: string | null;
  list: CarListRead | null;
  listNote: string | null;
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

/// The keys a host sends once it keeps more of a car's pedals than its profile. They are sent with every row,
/// as nulls where nothing is known, so that one of them is there says the host is one that tells.
const FACTS = ["force_at", "has_abs", "given_by", "given_why"];
const tells = (row: Row): boolean => FACTS.some((key) => key in row);

const givenBy = (v: unknown): GivenBy | null => (v === "rule" || v === "driver" || v === "none" ? v : null);

function pedalsOf(row: Row & { car_path: string }): CarPedals {
  return {
    carPath: row.car_path,
    profileId: text(row.profile_id),
    profileName: text(row.profile_name),
    brakeForceKg: num(row.brake_force_kg),
    forceAt: text(row.force_at),
    profileNow: text(row.profile_now),
    hasAbs: typeof row.has_abs === "boolean" ? row.has_abs : null,
    givenBy: givenBy(row.given_by),
    givenWhy: text(row.given_why),
  };
}

/// A car with no profile by the driver's own choice, keeping what else is known of it (`had`).
export function withoutProfile(carPath: string, had: CarPedals | undefined): CarPedals {
  return {
    carPath,
    profileId: null,
    profileName: null,
    brakeForceKg: had?.brakeForceKg ?? null,
    forceAt: had?.forceAt ?? null,
    profileNow: null,
    hasAbs: had?.hasAbs ?? null,
    givenBy: "none",
    givenWhy: null,
  };
}

const HAVING: readonly string[] = ["none", "fixed", "adjustable"];
const having = (v: unknown): Having | null =>
  typeof v === "string" && HAVING.includes(v) ? (v as Having) : null;

function controlOf(row: Row): ListedControl | null {
  const id = text(row.id);
  if (id === null) return null;
  const range = row.range;
  const off = row.off === false ? false : num(row.off);
  return {
    id,
    variable: text(row.var),
    label: text(row.label),
    words: text(row.words),
    off,
    range:
      Array.isArray(range) && range.length === 2 && num(range[0]) !== null && num(range[1]) !== null
        ? [range[0] as number, range[1] as number]
        : null,
    positions: (Array.isArray(row.positions) ? row.positions : []).flatMap((p): [number, string][] => {
      const value = Array.isArray(p) ? num(p[0]) : null;
      const name = Array.isArray(p) ? text(p[1]) : null;
      return value === null || name === null ? [] : [[value, name]];
    }),
    covers: Array.isArray(row.covers) ? row.covers.filter((c): c is string => typeof c === "string") : null,
  };
}

function listedCarOf(row: Row & { path: string }): ListedCar {
  return {
    path: row.path,
    name: text(row.name),
    kind: text(row.kind),
    abs: having(row.abs),
    tc: having(row.tc),
    brakeBias: having(row.brakeBias),
    controls: rows(row.controls).flatMap((c) => controlOf(c) ?? []),
    checked: text(row.checked),
  };
}

function remarkOf(row: Row): Remark | null {
  const about = text(row.about);
  const said = text(row.text);
  if (about === null || said === null) return null;
  return { about, text: said, firstSeen: text(row.firstSeen), lastSeen: text(row.lastSeen) };
}

/// What has been kept, by car: `[{ car, remarks: [...] }]` as the app gives it, or null where the host could not
/// read what it keeps.
function keptOf(v: unknown): Map<string, Remark[]> | null {
  if (!Array.isArray(v)) return null;
  const kept = new Map<string, Remark[]>();
  for (const row of rows(v)) {
    const car = text(row.car);
    if (car === null) continue;
    const said = rows(row.remarks).flatMap((r) => remarkOf(r) ?? []);
    if (said.length === 0) continue;
    kept.set(carKey(car), [...(kept.get(carKey(car)) ?? []), ...said]);
  }
  return kept;
}

/// The list of cars from what the app answered for it. `answer` is what `answerOf` made of it; an app from before
/// the list has no such key, and a host from before it has no such route: both are as if it were not there.
function readList(answer: { value?: unknown; missing: boolean; error: string | null }, out: Rig): void {
  if (answer.missing) return;
  if (answer.error !== null) {
    out.listNote = `The car list could not be read. ${answer.error}`;
    return;
  }
  const value = answer.value;
  if (!isRow(value) || !Array.isArray(value.cars)) {
    out.listNote = "The car list could not be read. The host's answer was not the list.";
    return;
  }
  const cars = new Map<string, ListedCar>();
  for (const row of value.cars) {
    if (!isRow(row) || typeof row.path !== "string" || row.path.trim().length === 0) continue;
    // The first spelling of a car stands, as the host's own list does.
    if (!cars.has(carKey(row.path))) cars.set(carKey(row.path), listedCarOf({ ...row, path: row.path }));
  }
  // A build with no list has nothing to say of any car, and saying "not in the list" of every one would be a
  // lie about the car: the page is as it was.
  if (cars.size === 0) return;
  out.list = { cars, kept: keptOf(value.kept) };
}

/// The check's word for a car the list does not have.
export const UNKNOWN_CAR = "unknown";

/// Whether the check has found the car and the list disagreeing. Not that the list lacks the car: the page says
/// that of every car it does not have, from the list itself.
export const disagrees = (remarks: readonly Remark[] | undefined): boolean =>
  !!remarks && remarks.some((r) => r.about !== UNKNOWN_CAR);

/// What `window.racingDesk.rig.read()` answered — { cars, views, pedals, controls }, each { value }, { missing } or
/// { error } — as the page uses it. An app from before the list of cars sends no `controls`, and is read as one
/// whose host has none.
export function readRig(read: unknown): Rig {
  const out: Rig = {
    paths: new Map(),
    carsNote: null,
    views: null,
    viewsNote: null,
    pedals: null,
    pedalsNote: null,
    list: null,
    listNote: null,
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
    // The cars given a profile, then those the host knows something of all the same — a brake force set by key,
    // whether they have ABS.
    const known = [...rows(pedals.value.cars), ...rows(pedals.value.without_profile)].filter(isCarRow);
    out.pedals = {
      found,
      told: Array.isArray(pedals.value.without_profile) || known.some(tells),
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

  readList(
    isRow(read) && !("controls" in read) ? { missing: true, error: null } : answerOf(read, "controls"),
    out,
  );
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

// ── The car list in words ──

const KINDS = new Map([
  ["formula", "Formula car"],
  ["prototype", "Prototype"],
  ["gt", "GT car"],
  ["touring", "Touring car"],
  ["stock", "Stock car"],
  ["dirt", "Dirt car"],
  ["rally", "Rally car"],
  ["truck", "Truck"],
  ["other", "Other"],
]);

/// What kind of car the list says it is: "GT car", "Prototype". A kind the page has no words for is shown as the
/// list wrote it.
export const kindWords = (kind: string | null): string | null =>
  kind === null ? null : (KINDS.get(kind) ?? kind);

const FUNCTIONS = new Map([
  ["abs", "Anti-lock"],
  ["tc", "Traction control"],
  ["tc2", "Traction control 2"],
  ["tc3", "Traction control 3"],
  ["tc4", "Traction control 4"],
  ["brakeBias", "Brake bias"],
  ["brakeMigration", "Brake migration"],
  ["arbFront", "Front rollbar"],
  ["arbRear", "Rear rollbar"],
  ["throttleMap", "Throttle map"],
  ["mode", "Mode"],
  ["drs", "DRS"],
  ["p2p", "Push to pass"],
]);

/// Words that are acronyms, written in capitals (no longer ABS, TC or ARB: those are words, his own — anti-lock,
/// traction, rollbar).
const ACRONYMS = new Set(["mgu", "esc", "ibs", "drs", "rf", "lf", "rr", "lr"]);
/// And the words for the ones that were.
const WORDS_FOR = new Map([["abs", "anti-lock"], ["tc", "traction"], ["arb", "rollbar"]]);

/// What a control is for, in words: "Traction control" for `tc`; one the page has not met is its id with the
/// humps taken out ("tcToggle" is "TC toggle", "brakeBiasFine" "Brake bias fine").
export function functionWords(id: string): string {
  const known = FUNCTIONS.get(id);
  if (known) return known;
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(" ")
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : (WORDS_FOR.get(w) ?? w)));
  const first = words[0] ?? "";
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

/// The values a control can have, in words: "1 to 12, 1 is off", "0 TRACK · 1 SPORT · 2 NORMAL". Nothing where the
/// list gives neither a range nor names: a control is listed all the same, and a blank is not a claim. DRS and
/// push to pass are states the car reports and not dials with a range, and are said to be.
export function valueWords(control: ListedControl): string {
  const parts: string[] = [];
  if (control.positions.length > 0) {
    parts.push(control.positions.map(([value, name]) => `${plain(value)} ${name}`).join(" · "));
  } else if (control.range) {
    const [low, high] = control.range;
    parts.push(low === high ? `only ${plain(low)}` : `${plain(low)} to ${plain(high)}`);
  }
  if (control.off === false) parts.push("never off");
  else if (control.off !== null && !control.positions.some(([value]) => value === control.off)) {
    parts.push(`${plain(control.off)} is off`);
  }
  if (parts.length > 0) return parts.join(", ");
  return control.id === "drs" || control.id === "p2p" ? "status" : "";
}

/// The list's words for a thing a car has (`abs`, `tc`, `brakeBias`), from the control it gives for it or the mode
/// dial that stands for it. Null where it gives none.
export function wordsFor(car: ListedCar, id: "abs" | "tc" | "brakeBias"): string | null {
  const own = car.controls.find((c) => c.id === id && c.label !== null);
  if (own) return own.words;
  const mode = car.controls.find(
    (c) => c.id === "mode" && c.label !== null && (c.covers === null || c.covers.includes(id)),
  );
  return mode ? mode.words : null;
}

/// The generic label of a dial, which says nothing its line does not: ABS for the anti-lock, TC for the traction
/// control, BB for the brake bias, DRS for DRS. Not shown beside them.
const GENERIC = new Map([["abs", "ABS"], ["tc", "TC"], ["brakeBias", "BB"], ["drs", "DRS"]]);
export const isGenericLabel = (id: string, label: string): boolean => GENERIC.get(id) === label;

/// What the car calls a thing it has (`abs`, `tc`, `brakeBias`): the label of the control the list gives for it, or
/// of the mode dial that stands for it. Null where the list gives neither.
export function labelFor(car: ListedCar, id: "abs" | "tc" | "brakeBias"): string | null {
  const own = car.controls.find((c) => c.id === id && c.label !== null);
  if (own) return own.label;
  const mode = car.controls.find(
    (c) => c.id === "mode" && c.label !== null && (c.covers === null || c.covers.includes(id)),
  );
  return mode ? mode.label : null;
}

/// A thing the check said of a car, as a sentence: the first letter up, and a full stop. Not the first letter of a
/// telemetry variable, which is written as the sim writes it: "dcABS reads 13" stays so.
export function sentence(said: string): string {
  const t = said.trim();
  const variable = /[a-z][A-Z0-9]/.test(t.split(/\s/)[0] ?? "");
  const up = variable ? t : t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

/// When a remark was first and last said, in a sentence, or null where the host gave neither.
export function seenWords(remark: Remark): string | null {
  const first = when(remark.firstSeen);
  const last = when(remark.lastSeen);
  if (first && last) return first === last ? `Seen ${first}.` : `First seen ${first}, last seen ${last}.`;
  if (last) return `Last seen ${last}.`;
  if (first) return `First seen ${first}.`;
  return null;
}
