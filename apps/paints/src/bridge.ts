// Where the UI's calls go. Inside The Racing Desk the preload bridge (apps/overlay/preload.js) exposes
// window.racingDesk.paints, and every command runs in the app's Node port of the manager
// (apps/overlay/modules/js/paints); in the Tauri shell the same commands, named in snake_case, are the Rust ones.
// The components import from here and from api.ts, and never know which host they are in.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { openPath as tauriOpenPath, revealItemInDir } from "@tauri-apps/plugin-opener";

interface DeskPaints {
  invoke<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  pickFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>;
  reveal(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
}

declare global {
  interface Window {
    racingDesk?: { paints?: DeskPaints };
  }
}

const desk = (): DeskPaints | undefined => window.racingDesk?.paints;

/// `detectPaths` -> `detect_paths`: the Rust command's name for the same call.
const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/// Run a command by its camelCase name with the named arguments api.ts gives it.
export function invoke<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const d = desk();
  return d ? d.invoke<T>(name, args) : tauriInvoke<T>(snake(name), args);
}

/// The system folder picker; null when nothing was chosen.
export async function pickFolder(title: string, current: string): Promise<string | null> {
  const d = desk();
  if (d) return d.pickFolder({ title, defaultPath: current || undefined });
  const picked = await tauriOpen({
    directory: true,
    multiple: false,
    title,
    defaultPath: current || undefined,
  });
  return typeof picked === "string" ? picked : null;
}

/// Show a file in Explorer.
export function reveal(path: string): Promise<void> {
  const d = desk();
  return d ? d.reveal(path) : revealItemInDir(path);
}

/// Open a file or folder with whatever the system opens it with.
export function openPath(path: string): Promise<void> {
  const d = desk();
  return d ? d.openPath(path) : tauriOpenPath(path);
}
