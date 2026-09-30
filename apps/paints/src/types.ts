// Mirrors the serde shapes in src-tauri. Kept by hand and kept small: every one of these
// is produced by a Rust command, never built in the browser.

export interface PaintCandidate {
  path: string;
  source: string;
  exists: boolean;
  isOneDrive: boolean;
  carFolders: number;
  textureFiles: number;
}

export interface PathReport {
  candidates: PaintCandidate[];
  chosen: string | null;
  ambiguous: boolean;
  notes: string[];
}

export type Confidence = "certain" | "likely" | "guess";

export interface IdCandidate {
  id: string;
  paints: number;
  localSpecMaps: number;
  carFolders: number;
}

export interface CustomerReport {
  id: string | null;
  confidence: Confidence | null;
  source: string | null;
  candidates: IdCandidate[];
  notes: string[];
}

export interface Meta {
  name?: string | null;
  created?: string | null;
  notes?: string | null;
  source?: string | null;
  seed?: string | null;
  simFolder?: string | null;
}

export interface VersionFile {
  role: string;
  roleLabel: string;
  fileName: string;
  path: string;
  size: number;
  sha256: string;
}

/// The helmet a version comes with, from the library's helmet list (apps/overlay/modules/js/paints/helmets.js):
/// the set's name, and its body and art colours for a swatch, or null for either colour the list does not give.
export interface HelmetPick {
  set: string;
  body: [number, number, number] | null;
  art: [number, number, number] | null;
}

export interface Version {
  id: string;
  name: string;
  path: string;
  files: VersionFile[];
  previews: string[];
  meta: Meta;
  hasPaint: boolean;
  hasSpec: boolean;
  problems: string[];
  /// Which helmet comes with the version: null where the library keeps helmets and names none for it, and not
  /// there at all where the library keeps none (or the host is the Rust, which knows nothing of them).
  helmet?: HelmetPick | null;
}

export interface Car {
  folder: string;
  simFolder: string | null;
  simFolderInferred: boolean;
  versions: Version[];
}

export interface Library {
  root: string;
  cars: Car[];
  notes: string[];
}

/// A car as the list shows it: any car the rig knows, in the library or not. Built by the desk's
/// `carCatalogue` (apps/overlay/modules/js/paints/catalogue.js); the Rust has no such command, and
/// api.ts makes these from the library's cars there.
export interface CatalogueCar extends Car {
  /// What the sim calls the car — "Mazda MX-5 Cup". Null for a car that has never been in a session.
  name: string | null;
  shortName: string | null;
  /// In the iRacing install.
  installed: boolean;
  /// The install's name for the car — what the sim calls its paint folder. Null outside the install.
  installPath: string | null;
  /// The driver's own sessions in it.
  driven: number;
}

export type MatchKind = "exact" | "paint-only" | "none";

export interface InstalledFile {
  role: string;
  roleLabel: string;
  fileName: string;
  path: string;
  size: number;
  sha256: string;
  readOnly: boolean;
}

export interface InstalledState {
  simFolder: string | null;
  folderExists: boolean;
  files: InstalledFile[];
  cooked: string[];
  cookedOtherDrivers: number;
  appliedVersionId: string | null;
  matchKind: MatchKind;
  anyReadOnly: boolean;
}

export interface TradingPaints {
  configFound: boolean;
  configPath: string | null;
  running: boolean;
  userId: string | null;
  downloadMySchemes: boolean | null;
  deleteBeforeDownloading: boolean | null;
  deleteAfterSession: boolean | null;
  keepSynced: boolean | null;
  warnings: string[];
}

export interface SimState {
  simRunning: boolean;
  uiRunning: boolean;
  matched: string[];
}

export interface Preflight {
  blockers: string[];
  warnings: string[];
}

export interface Action {
  kind: string;
  detail: string;
}

/// What became of the helmet in an apply or a revert: the set that went on the car (null for none), whether it
/// is on the car and whether it is now the default, and one plain sentence saying so — or why the helmet was left
/// as it was.
export interface HelmetOutcome {
  set: string | null;
  onCar: boolean;
  isDefault: boolean;
  said: string;
}

export interface ApplyReport {
  applied: boolean;
  backupDir: string | null;
  actions: Action[];
  warnings: string[];
  /// The desk's alone: the Rust knows nothing of helmets.
  helmet?: HelmetOutcome | null;
}

export interface BackupEntry {
  id: string;
  path: string;
  created: string;
  reason: string;
  fileCount: number;
}

export interface ApplyRequest {
  paintDir: string;
  libraryRoot: string;
  carFolder: string;
  simFolder: string;
  versionId: string;
  customerId: string;
  includeSpec: boolean;
  setReadOnlyAfter: boolean;
  clearOtherCooked: boolean;
  force: boolean;
}

/// A car in a livery group, and the version it wears there.
export interface GroupCar {
  folder: string;
  versionId: string;
  versionName: string;
  /// The version has left the library since the group was made.
  missing: boolean;
}

/// One name for a livery across cars. The library makes its own — a version more than one car has —
/// and the driver makes others (apps/overlay/modules/js/paints/groups.js).
export interface LiveryGroup {
  id: string;
  name: string;
  kind: "library" | "mine";
  cars: GroupCar[];
}

export interface GroupRequest {
  paintDir: string;
  libraryRoot: string;
  customerId: string;
  groupId: string;
  includeSpec: boolean;
  setReadOnlyAfter: boolean;
  clearOtherCooked: boolean;
  force: boolean;
}

export interface GroupResult {
  folder: string;
  simFolder: string | null;
  versionId: string;
  outcome: "applied" | "already" | "skipped" | "failed";
  detail: string;
  backupDir: string | null;
  warnings: string[];
  /// For a car that was applied: the helmet that went on it, or why none did.
  helmet?: HelmetOutcome | null;
}

export interface GroupReport {
  groupId: string;
  name: string;
  results: GroupResult[];
  applied: number;
  already: number;
  skipped: number;
  failed: number;
  warnings: string[];
  /// The default helmet the group set — the set its cars agree on, else the library's default — and a plain
  /// sentence saying which, or why the default was left as it was.
  helmet?: { set: string | null; said: string; backupDir: string | null } | null;
}

export interface Settings {
  paintDir?: string | null;
  libraryRoot?: string | null;
  customerId?: string | null;
  includeSpec?: boolean | null;
  setReadOnlyAfter?: boolean | null;
  clearOtherCooked?: boolean | null;
  /// Whether the library keeps itself up to date. Null, until he chooses, is yes: only false turns it off.
  autoUpdateLibrary?: boolean | null;
}

export interface RepoStatus {
  gitAvailable: boolean;
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  remoteUrl: string | null;
  head: string | null;
  subject: string | null;
  dirty: boolean;
  behind: number;
  ahead: number;
  checkedRemote: boolean;
  updatesAvailable: boolean;
  notes: string[];
}

/// What stands in the way of an update, in words for the driver: `text` is one plain sentence that says so and, but
/// for `kept`, that nothing was changed, and is shown as it is. `kept` is files that were moved aside for the update
/// and could not be put back when it was not taken: they are in the folder `setAside` names.
export interface Blocked {
  reason: "changes" | "work" | "files" | "other" | "kept";
  text: string;
}

/// The desk's answer (apps/overlay/modules/js/paints/repo.js). The Tauri shell's Rust has none of the last three:
/// it refuses in an error, and puts nothing aside.
export interface PullReport {
  updated: boolean;
  commits: string[];
  /// How many versions of a car arrived or changed.
  changed?: number;
  /// Files that were in the way and were moved, not deleted, out of the library, and where to.
  setAside?: { count: number; folder: string } | null;
  blocked?: Blocked | null;
  status: RepoStatus;
}

export interface LibrarySuggestion {
  path: string;
  cars: number;
  repo: RepoStatus;
}
