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

export interface ApplyReport {
  applied: boolean;
  backupDir: string | null;
  actions: Action[];
  warnings: string[];
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

export interface Settings {
  paintDir?: string | null;
  libraryRoot?: string | null;
  customerId?: string | null;
  includeSpec?: boolean | null;
  setReadOnlyAfter?: boolean | null;
  clearOtherCooked?: boolean | null;
  autoUpdateOnLaunch?: boolean | null;
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

export interface PullReport {
  updated: boolean;
  commits: string[];
  status: RepoStatus;
}

export interface LibrarySuggestion {
  path: string;
  cars: number;
  repo: RepoStatus;
}
