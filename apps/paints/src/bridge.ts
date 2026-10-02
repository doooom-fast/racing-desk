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

/// What the desk's host keeps per car — its view, its pedals — and the one thing written there. The app's main
/// process does the asking; rig.ts says what the answers hold.
export interface DeskRig {
  read(): Promise<unknown>;
  bindPedals(carPath: string, profileId: string | null): Promise<unknown>;
}

/// Putting back each car's height and brakes, as the app's host says it (apps/overlay/modules/js/restore-api.js): read
/// answers { value } | { missing } | { error }; command takes one of the host's commands and answers { ok, … }. Never a
/// rejection from the app.
export interface DeskRestore {
  read(opts?: { linesOnly?: boolean }): Promise<unknown>;
  command(body: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Window {
    racingDesk?: { paints?: DeskPaints; rig?: Partial<DeskRig>; restore?: Partial<DeskRestore> };
  }
}

const desk = (): DeskPaints | undefined => window.racingDesk?.paints;

/// Whether the host is The Racing Desk. A few commands are the desk's alone — the Rust never had them — and
/// api.ts has to know which answer to expect.
export const inDesk = (): boolean => desk() !== undefined;

/// The way to a car's view and pedals, or null where there is none: the Tauri shell, the dev preview, a desk
/// from before it kept them. Nothing falls back to the Rust here — it never had any of this.
export function deskRig(): DeskRig | null {
  const rig = window.racingDesk?.rig;
  return rig && typeof rig.read === "function" && typeof rig.bindPedals === "function"
    ? (rig as DeskRig)
    : null;
}

/// The way to what putting the cars back says of them, or null where there is none: the Tauri shell, a desk from before it.
export function deskRestore(): DeskRestore | null {
  const restore = window.racingDesk?.restore;
  return restore && typeof restore.read === "function" && typeof restore.command === "function"
    ? (restore as DeskRestore)
    : null;
}

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
