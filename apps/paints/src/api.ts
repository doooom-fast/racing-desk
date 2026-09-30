import { inDesk, invoke } from "./bridge";
import type {
  ApplyReport,
  ApplyRequest,
  BackupEntry,
  CatalogueCar,
  CustomerReport,
  DefaultHelmetBackup,
  DefaultHelmetReport,
  DefaultHelmetRestored,
  GroupReport,
  GroupRequest,
  InstalledState,
  Library,
  LibrarySuggestion,
  LiveryGroup,
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

/// Every car the rig knows, named: the library's, the iRacing install's and the paint folder's. The desk's
/// alone — it needs the install and the local store. The Tauri shell has no such command, so there the list
/// is the library's cars under their folder names, which is what it always showed.
export async function carCatalogue(
  libraryRoot: string,
  paintDir: string | null,
): Promise<CatalogueCar[]> {
  try {
    return await invoke<CatalogueCar[]>("carCatalogue", { libraryRoot, paintDir });
  } catch (e) {
    if (inDesk()) throw e;
    const library = await scanLibrary(libraryRoot, paintDir);
    return library.cars.map((car) => ({
      ...car,
      name: null,
      shortName: null,
      installed: false,
      installPath: null,
      driven: 0,
    }));
  }
}

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

/// Livery groups are the desk's alone. In the Tauri shell there are none, which is what it always had.
export async function liveryGroups(
  libraryRoot: string,
  paintDir: string | null,
): Promise<LiveryGroup[]> {
  if (!inDesk()) return [];
  const found = await invoke<LiveryGroup[]>("liveryGroups", { libraryRoot, paintDir });
  return Array.isArray(found) ? found : [];
}

export const saveGroup = (args: {
  libraryRoot: string;
  paintDir: string | null;
  id: string | null;
  name: string;
  cars: Record<string, string | null>;
}) => invoke<LiveryGroup>("saveGroup", args);

export const deleteGroup = (id: string) => invoke<boolean>("deleteGroup", { id });

export const setGroup = (request: GroupRequest) => invoke<GroupReport>("setGroup", { request });

/// The default helmet seen to on its own, after a library update that changed which set it is (`was` is the one it
/// was before): the desk's alone, as helmets are.
export const ensureDefaultHelmet = (args: {
  paintDir: string;
  libraryRoot: string;
  customerId: string;
  was: string | null;
}) => invoke<DefaultHelmetReport>("ensureDefaultHelmet", args);

/// The backups of the default helmet, newest first. The desk's alone.
export const listDefaultHelmetBackups = (customerId: string) =>
  invoke<DefaultHelmetBackup[]>("listDefaultHelmetBackups", { customerId });

/// Put the default helmet back as one of those backups has it. The desk's alone.
export const revertDefaultHelmet = (args: {
  paintDir: string;
  libraryRoot: string;
  customerId: string;
  backupId: string;
}) => invoke<DefaultHelmetRestored>("revertDefaultHelmet", args);

/// Errors arrive as plain strings from Rust and as Errors carrying the command's own message from the desk's
/// bridge; anything else is a bug worth showing verbatim.
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
