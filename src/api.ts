import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyReport,
  ApplyRequest,
  BackupEntry,
  CustomerReport,
  InstalledState,
  Library,
  PathReport,
  Preflight,
  Settings,
  SimState,
  TradingPaints,
} from "./types";

export const detectPaths = () => invoke<PathReport>("detect_paths");

export const detectCustomer = (paintDir: string) =>
  invoke<CustomerReport>("detect_customer", { paintDir });

export const scanLibrary = (libraryRoot: string, paintDir: string | null) =>
  invoke<Library>("scan_library", { libraryRoot, paintDir });

export const carState = (args: {
  paintDir: string;
  libraryRoot: string;
  carFolder: string;
  simFolder: string | null;
  customerId: string;
}) => invoke<InstalledState>("car_state", args);

export const tradingPaintsStatus = () => invoke<TradingPaints>("trading_paints_status");

export const simStatus = () => invoke<SimState>("sim_status");

export const preflight = (paintDir: string, simFolder: string) =>
  invoke<Preflight>("preflight", { paintDir, simFolder });

export const applyVersion = (request: ApplyRequest) =>
  invoke<ApplyReport>("apply_version", { request });

export const listBackups = (libraryRoot: string, carFolder: string) =>
  invoke<BackupEntry[]>("list_backups", { libraryRoot, carFolder });

export const revertCar = (args: {
  paintDir: string;
  libraryRoot: string;
  carFolder: string;
  simFolder: string;
  customerId: string;
  backupId: string | null;
  force: boolean;
}) => invoke<ApplyReport>("revert_car", args);

export const loadSettings = () => invoke<Settings>("load_settings");

export const saveSettings = (settings: Settings) =>
  invoke<void>("save_settings", { settings });

export const loadPreview = (path: string) => invoke<string>("load_preview", { path });

/// Rust errors arrive as plain strings; anything else is a bug worth showing verbatim.
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
