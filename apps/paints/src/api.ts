import { invoke } from "./bridge";
import type {
  ApplyReport,
  ApplyRequest,
  BackupEntry,
  CustomerReport,
  InstalledState,
  Library,
  LibrarySuggestion,
  PathReport,
  PullReport,
  Preflight,
  Settings,
  RepoStatus,
  SimState,
  TradingPaints,
} from "./types";

// One function per command, named as the manager's Node port names them (apps/overlay/modules/js/paints/index.js);
// bridge.ts turns the name into the Rust command's when the Tauri shell is the host.

export const detectPaths = () => invoke<PathReport>("detectPaths");

export const detectCustomer = (paintDir: string) =>
  invoke<CustomerReport>("detectCustomer", { paintDir });

export const scanLibrary = (libraryRoot: string, paintDir: string | null) =>
  invoke<Library>("scanLibrary", { libraryRoot, paintDir });

export const carState = (args: {
  paintDir: string;
  libraryRoot: string;
  carFolder: string;
  simFolder: string | null;
  customerId: string;
}) => invoke<InstalledState>("carState", args);

export const tradingPaintsStatus = () => invoke<TradingPaints>("tradingPaintsStatus");

export const simStatus = () => invoke<SimState>("simStatus");

export const preflight = (paintDir: string, simFolder: string) =>
  invoke<Preflight>("preflight", { paintDir, simFolder });

export const applyVersion = (request: ApplyRequest) =>
  invoke<ApplyReport>("applyVersion", { request });

export const listBackups = (carFolder: string) =>
  invoke<BackupEntry[]>("listBackups", { carFolder });

export const revertCar = (args: {
  paintDir: string;
  carFolder: string;
  simFolder: string;
  customerId: string;
  backupId: string | null;
  force: boolean;
}) => invoke<ApplyReport>("revertCar", args);

export const repoStatus = (path: string) => invoke<RepoStatus>("repoStatus", { path });

export const repoCheck = (path: string) => invoke<RepoStatus>("repoCheck", { path });

export const repoPull = (path: string) => invoke<PullReport>("repoPull", { path });

export const suggestLibraries = (paintDir: string) =>
  invoke<LibrarySuggestion[]>("suggestLibraries", { paintDir });

export const loadSettings = () => invoke<Settings>("loadSettings");

export const saveSettings = (settings: Settings) =>
  invoke<void>("saveSettings", { settings });

export const previewImage = (path: string, maxEdge?: number) =>
  invoke<string>("previewImage", { path, maxEdge });

/// Errors arrive as plain strings from Rust and as Errors carrying the command's own message from the desk's
/// bridge; anything else is a bug worth showing verbatim.
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
