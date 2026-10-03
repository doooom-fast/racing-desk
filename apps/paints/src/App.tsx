import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { inDesk, reveal } from "./bridge";
import { errorText } from "./api";
import { ApplyOptionsPanel, Refusal, type ApplyOptions } from "./components/ApplyOptions";
import { CarControlsPanel } from "./components/CarControls";
import { CarList, carLabel, carToOpenOn, type Kept } from "./components/CarList";
import { CarPedalsPanel } from "./components/CarPedals";
import { CarViewPanel } from "./components/CarView";
import { DefaultHelmetPanel } from "./components/DefaultHelmet";
import { GroupEditor } from "./components/GroupEditor";
import { GroupPage } from "./components/GroupPage";
import { TradingPaintsPanel } from "./components/Guards";
import { RepoPanel } from "./components/RepoPanel";
import { SetupBar } from "./components/SetupBar";
import { collectStatus, StatusChips } from "./components/StatusChips";
import { Toast, type ToastItem } from "./components/Toast";
import { VersionCard } from "./components/VersionCard";
import { useLastDriven } from "./driven";
import { disagrees, hasPedals, rigKey } from "./rig";
import { useRig } from "./useRig";
import type {
  BackupEntry,
  CatalogueCar,
  CustomerReport,
  DefaultHelmetBackup,
  GroupReport,
  InstalledState,
  LibrarySuggestion,
  LiveryGroup,
  PathReport,
  PullReport,
  RepoStatus,
  Settings,
  SimState,
  TradingPaints,
  Version,
} from "./types";

interface LogEntry {
  id: number;
  when: string;
  kind: "ok" | "bad" | "info";
  title: string;
  lines: string[];
}

/// An apply that was refused: what was asked for, why not, and whether going on regardless is on offer.
type Refused =
  | { what: "version"; carFolder: string; version: Version; reason: string; canForce: boolean }
  | { what: "group"; groupId: string; reason: string; canForce: boolean };

/// Where a new version of a car goes, for showing: `<library>\<car folder>\<version name>\`. Nothing is
/// made of it but text — the folders are the user's to create.
function versionHome(libraryRoot: string, folder: string): string {
  return `${libraryRoot.replace(/[\\/]+$/, "")}\\${folder}\\<version name>\\`;
}

/// How often the guards re-check. The downloader can be started while the app is open, and a
/// status chip that went stale would be worse than none.
const GUARD_POLL_MS = 8000;

/// How long a livery has to have been within reach before the library's remote is asked about.
const REMOTE_AFTER_MS = 1000;

/// How often the library looks at its remote while the app runs, and how long the window has to have been away
/// for its coming back to be another occasion to.
const KEEP_UP_MS = 30 * 60 * 1000;

/// How long a toast stays once somebody is looking at the page.
const TOAST_MS = 12000;

/// What the chip says when an update that was asked for could not be taken, and the page was told no more than that
/// it failed: the network, or a shell whose answer says nothing else. The desk's own answers say what was in the way
/// themselves (apps/overlay/modules/js/paints/repo.js).
const COULD_NOT_UPDATE =
  "The library could not be brought up to date just now, so it was not updated. Nothing was changed.";

/// The reasons an update was not taken that trying again could put right: a file held open for a moment, git or the
/// remote not answering, files that could not be put back. Not changes or work of the library's own, which stay.
const CAN_TRY_AGAIN: ReadonlySet<string> = new Set(["files", "other", "kept"]);

/// An error's words for the Activity list, without the hints that tell the reader what to type ("hint: …").
function plain(e: unknown): string {
  return errorText(e)
    .split(/\r?\n/)
    .filter((line) => !/^\s*hint:/i.test(line))
    .join(" ")
    .trim();
}

/// What an update brought, for a toast: how much arrived, and any files that were in the way and were moved out of
/// it, with where to. Nothing in it says how it was done.
function arrival(report: PullReport): string {
  const parts: string[] = [];
  if (report.updated) {
    const n = report.changed ?? 0;
    parts.push(
      n > 0
        ? `Library updated: ${n} ${n === 1 ? "livery" : "liveries"} added or changed.`
        : "Library updated.",
    );
  }
  const aside = report.setAside;
  if (aside && aside.count > 0) {
    parts.push(
      aside.count === 1
        ? `1 file that was in the way was set aside in ${aside.folder}. Nothing was deleted.`
        : `${aside.count} files that were in the way were set aside in ${aside.folder}. Nothing was deleted.`,
    );
  }
  return parts.join(" ");
}

/// A car the driver has driven that is nowhere on this rig now: not in the install, the paint folder or the
/// library. What the store kept of it is shown; nothing that needs the car on disk is offered.
const notOnDisk = (car: CatalogueCar): boolean =>
  !car.installed && car.simFolder === null && car.versions.length === 0;

/// Whether the page is the one showing. Inside The Racing Desk it stays mounted while another page is up, or
/// the window is minimised behind a race.
const showing = (): boolean =>
  !document.hidden && (document.querySelector(".paints-app")?.getClientRects().length ?? 0) > 0;

export default function App() {
  const [paintDir, setPaintDir] = useState("");
  const [libraryRoot, setLibraryRoot] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [options, setOptions] = useState<ApplyOptions>({
    includeSpec: true,
    setReadOnlyAfter: false,
    clearOtherCooked: false,
  });

  const [pathReport, setPathReport] = useState<PathReport | null>(null);
  const [customerReport, setCustomerReport] = useState<CustomerReport | null>(null);
  const [cars, setCars] = useState<CatalogueCar[] | null>(null);
  /// Where the list of cars stands. No cars is only "there are none" once the list is here.
  const [listing, setListing] = useState<"reading" | "read" | "failed">("reading");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  /// When he chose the car on the page, if he did. Until he has chosen one it is the car driven last — and
  /// again once he has driven since choosing: he comes back from a drive to the car he drove.
  const choseAt = useRef<number | null>(null);
  const chosen = (driven: ReadonlyMap<string, string>): boolean => {
    if (choseAt.current === null) return false;
    for (const iso of driven.values()) {
      if (Date.parse(iso) > choseAt.current) {
        choseAt.current = null;
        return false;
      }
    }
    return true;
  };
  /// Whether something other than a car is on the page, or something is being done: the page does not move
  /// under either.
  const held = useRef(false);
  /// The car on the page as of now, for what answers later than it was asked.
  const selectedNow = useRef<string | null>(null);
  const show = useCallback((folder: string | null) => {
    selectedNow.current = folder;
    setSelectedFolder(folder);
  }, []);
  const [installed, setInstalled] = useState<InstalledState | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [tp, setTp] = useState<TradingPaints | null>(null);
  const [sim, setSim] = useState<SimState | null>(null);
  const [suggestions, setSuggestions] = useState<LibrarySuggestion[]>([]);
  /// Whether a library has been looked for. Until it has, an empty field is not yet "there is no library".
  const [looked, setLooked] = useState(false);
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  /// Whether the library keeps itself up to date, as he set it. Null is that he never chose, which is yes: only
  /// turning it off turns it off. What an older version saved under another name was its default, not his choice.
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const autoOn = autoUpdate !== false;
  const [checking, setChecking] = useState(false);
  /// An update is being taken, by itself or because he asked.
  const [updating, setUpdating] = useState(false);
  /// What is in the way of the last update, as the sentence the chip says and whether trying again could help; null
  /// when nothing is.
  const [blocked, setBlocked] = useState<{ text: string; retry: boolean } | null>(null);
  const [toast, setToast] = useState<ToastItem | null>(null);
  const toastId = useRef(0);

  const [groups, setGroups] = useState<LiveryGroup[]>([]);
  /// The group on the page, in place of a car.
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  /// A group being made (`group` null) or changed, in place of either.
  const [editing, setEditing] = useState<{ group: LiveryGroup | null } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [groupReport, setGroupReport] = useState<GroupReport | null>(null);

  const [refused, setRefused] = useState<Refused | null>(null);
  /// What the last apply or revert on a car did about the helmet, in a sentence, under that car's versions.
  const [helmetSaid, setHelmetSaid] = useState<{ folder: string; text: string } | null>(null);
  /// The backups of the default helmet — what the library's default replaced, by an apply, a group or an update —
  /// newest first, and what putting one back did, in a sentence. The desk's alone.
  const [defaultBackups, setDefaultBackups] = useState<DefaultHelmetBackup[]>([]);
  const [defaultSaid, setDefaultSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const ready = useRef(false);

  // What the host keeps per car beside its paint — the view it was driven with, its pedals — and when the
  // desk says each was last driven. The desk's alone: elsewhere the two panels say there is no app.
  const rig = useRig();
  const lastDriven = useLastDriven();
  /// As it stands when the list of cars arrives, which does not wait for it.
  const drivenNow = useRef(lastDriven);
  drivenNow.current = lastDriven;
  /// Whether anybody is looking: the window is the one in front and this page is showing. The guards' to say.
  const [looking, setLooking] = useState(false);

  const say = useCallback((kind: LogEntry["kind"], title: string, lines: string[] = []) => {
    logId.current += 1;
    setLog((prev) =>
      [
        {
          id: logId.current,
          when: new Date().toLocaleTimeString(),
          kind,
          title,
          lines,
        },
        ...prev,
      ].slice(0, 40),
    );
  }, []);

  // --- start up: remembered settings first, detection to fill the gaps ------------------
  useEffect(() => {
    (async () => {
      const [saved, detected] = await Promise.all([
        api.loadSettings().catch((): Settings => ({})),
        api.detectPaths().catch(() => null),
      ]);
      setPathReport(detected);
      const paint = saved.paintDir || detected?.chosen || "";
      setPaintDir(paint);
      setLibraryRoot(saved.libraryRoot ?? "");
      if (saved.customerId) setCustomerId(saved.customerId);
      setOptions({
        includeSpec: saved.includeSpec ?? true,
        setReadOnlyAfter: saved.setReadOnlyAfter ?? false,
        clearOtherCooked: saved.clearOtherCooked ?? false,
      });
      setAutoUpdate(saved.autoUpdateLibrary ?? null);
      for (const note of detected?.notes ?? []) say("info", note);
      // With no paint folder there is nowhere to look for a library near.
      if (!paint) setLooked(true);
      ready.current = true;
    })();
  }, [say]);

  // --- find a library near the sim, so the common case needs no browsing ---------------
  useEffect(() => {
    if (!paintDir) return;
    let live = true;
    api
      .suggestLibraries(paintDir)
      .then((found) => {
        if (!live) return;
        setSuggestions(found);
        // Adopt the best one only when nothing is set; a chosen path is the user's.
        setLibraryRoot((current) => current || found[0]?.path || "");
        setLooked(true);
      })
      .catch(() => live && setLooked(true));
    return () => {
      live = false;
    };
  }, [paintDir]);

  // --- persist, once the initial load has settled --------------------------------------
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      api
        .saveSettings({
          paintDir: paintDir || null,
          libraryRoot: libraryRoot || null,
          customerId: customerId || null,
          includeSpec: options.includeSpec,
          setReadOnlyAfter: options.setReadOnlyAfter,
          clearOtherCooked: options.clearOtherCooked,
          autoUpdateLibrary: autoUpdate,
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [paintDir, libraryRoot, customerId, options, autoUpdate]);

  // --- customer id detection ------------------------------------------------------------
  useEffect(() => {
    if (!paintDir) return;
    let live = true;
    api
      .detectCustomer(paintDir)
      .then((r) => {
        if (!live) return;
        setCustomerReport(r);
        // Only fill an empty field: a value the user typed is theirs.
        setCustomerId((current) => current || r.id || "");
      })
      .catch((e) => live && say("bad", "Could not read the paint folder", [errorText(e)]));
    return () => {
      live = false;
    };
  }, [paintDir, say]);

  // --- the cars: the library's, and every other car the rig knows ------------------------
  // Each answer is numbered, because the folders can change while one is on its way — every keystroke in
  // a path asks again — and the list has to be the last one asked for, not the last one to arrive. The
  // groups are read with the cars: they are made of the same library.
  //
  // In the desk the list does not wait on a library: a car's view and pedals are there to be looked at
  // whether or not there is a livery anywhere, so once a library has been looked for and none found, the
  // cars are the install's and the paint folder's. The Tauri shell lists a library or nothing.
  const asked = useRef(0);
  const listable = !!libraryRoot || (inDesk() && looked);
  const refreshLibrary = useCallback(async () => {
    const mine = ++asked.current;
    if (!listable) {
      setCars(null);
      setGroups([]);
      return;
    }
    setListing("reading");
    try {
      const [found, grouped] = await Promise.all([
        api.carCatalogue(libraryRoot, paintDir || null),
        // Groups are a nicety: a list of cars is not held up by them, nor lost with them.
        api.liveryGroups(libraryRoot, paintDir || null).catch((): LiveryGroup[] => []),
      ]);
      if (mine !== asked.current) return;
      setCars(found);
      setGroups(grouped);
      setListing("read");
      // A car he chose stays, while it is still there. Otherwise the page is on the car driven last, or —
      // before the desk has said when any was — on the one it was on, or the first as the list shows them.
      const current = selectedNow.current;
      const still = current !== null && found.some((c) => c.folder === current);
      if (!still) choseAt.current = null;
      if (!chosen(drivenNow.current)) {
        const opens = carToOpenOn(found, drivenNow.current);
        const driven = opens !== null && drivenNow.current.has(rigKey(opens));
        // A car that has gone has to be replaced whatever is on the page; following a drive can wait.
        if (!still || (driven && !held.current)) show(opens?.folder ?? null);
      }
      setSelectedGroup((current) => (current && grouped.some((g) => g.id === current) ? current : null));
    } catch (e) {
      if (mine !== asked.current) return;
      setCars(null);
      setGroups([]);
      setListing("failed");
      say("bad", "Could not read the library", [errorText(e)]);
    }
  }, [libraryRoot, paintDir, listable, say, show]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // The desk says when there is something to read again — its own Refresh, the host found after none was, the
  // store with something new — and that is the list as much as what the host keeps per car (useRig): cars
  // listed while the host was starting have no names until the list is read again.
  useEffect(() => {
    const again = () => void refreshLibrary();
    document.addEventListener("racingdesk:refresh", again);
    return () => document.removeEventListener("racingdesk:refresh", again);
  }, [refreshLibrary]);

  // When each car was last driven can arrive after the cars: the desk reads its sessions in its own time, and
  // again after every drive. Until he has chosen a car the page follows it.
  // Not while a group or the editor is on the page, or something is being done: the pane would jump to its
  // top and what was refused would be gone, with nothing chosen. It catches up when he leaves them.
  held.current = selectedGroup !== null || editing !== null || busy;
  useEffect(() => {
    if (!cars || held.current || chosen(lastDriven)) return;
    const opens = carToOpenOn(cars, lastDriven);
    if (opens && lastDriven.has(rigKey(opens))) show(opens.folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cars, lastDriven, show, selectedGroup, editing, busy]);

  // --- the library as a git checkout ----------------------------------------------------
  const refreshRepo = useCallback(async () => {
    if (!libraryRoot) {
      setRepo(null);
      return;
    }
    try {
      setRepo(await api.repoStatus(libraryRoot));
    } catch {
      setRepo(null);
    }
  }, [libraryRoot]);

  useEffect(() => {
    void refreshRepo();
  }, [refreshRepo]);

  // What the timers below run late, and cannot be handed the render they were made in: the newest of each.
  const refreshNow = useRef(refreshLibrary);
  refreshNow.current = refreshLibrary;
  const busyNow = useRef(false);
  busyNow.current = busy;
  const repoNow = useRef<RepoStatus | null>(null);
  repoNow.current = repo;
  const blockedNow = useRef<string | null>(null);
  blockedNow.current = blocked?.text ?? null;

  /// After an update that changed which set the library's list names as the default helmet, the default follows it.
  /// Only the desk knows helmets, and asked with what the page knows at the time and the set it was before. What
  /// it says, if anything, goes with the update's own lines; nothing to say, or a host that cannot answer, is
  /// nothing.
  const defaultHelmetNow = useRef(async (_was: string | null): Promise<string[]> => []);
  defaultHelmetNow.current = async (was) => {
    if (!inDesk() || !paintDir || !libraryRoot || !customerId) return [];
    try {
      const report = await api.ensureDefaultHelmet({ paintDir, libraryRoot, customerId, was });
      return report.said ? [report.said] : [];
    } catch {
      return [];
    }
  };

  /// What is in the list of the default helmet's backups, read again: after anything that may have taken one.
  const refreshDefaultBackups = useCallback(async () => {
    if (!inDesk() || !/^\d+$/.test(customerId)) {
      setDefaultBackups([]);
      return;
    }
    try {
      setDefaultBackups(await api.listDefaultHelmetBackups(customerId));
    } catch {
      setDefaultBackups([]);
    }
  }, [customerId]);
  const refreshDefaultsNow = useRef(refreshDefaultBackups);
  refreshDefaultsNow.current = refreshDefaultBackups;
  useEffect(() => {
    void refreshDefaultBackups();
  }, [refreshDefaultBackups]);

  /// One look at the remote or one update at a time, whoever asked for it: a button, the page starting, the half
  /// hour, the window coming back.
  const working = useRef(false);
  const alone = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    try {
      await work();
    } finally {
      working.current = false;
    }
  }, []);

  const tell = useCallback((text: string, folder: string | null = null) => {
    toastId.current += 1;
    setToast({ id: toastId.current, text, folder });
  }, []);

  /// Ask the remote what it has. Read-only — it never touches the working tree. `quietly`: nobody asked, so a
  /// remote that cannot be reached is not said, on the page or under Library source, where the desk's answer would
  /// print its note; what is shown stays as it was, and it is asked again at the next occasion.
  const checkNow = useCallback(
    async (quietly: boolean) => {
      if (!libraryRoot) return null;
      setChecking(true);
      try {
        const status = await api.repoCheck(libraryRoot);
        if (!quietly || status.checkedRemote) setRepo(status);
        // Nothing waiting, on an answer from the remote itself, is nothing in the way.
        if (status.checkedRemote && !status.updatesAvailable) setBlocked(null);
        return status;
      } catch (e) {
        if (!quietly) say("bad", "Could not check the library for updates", [plain(e)]);
        return null;
      } finally {
        setChecking(false);
      }
    },
    [libraryRoot, say],
  );

  /// Take what is waiting. `byHim`: he asked, so what came of it is said whichever way it went. When the page did
  /// it of itself, what is in the way is the chip's to say, once, and a failure is not said at all: the next
  /// occasion tries again.
  const pullNow = useCallback(
    async (byHim: boolean) => {
      if (!libraryRoot) return;
      setBusy(true);
      setUpdating(true);
      try {
        const report = await api.repoPull(libraryRoot);
        setRepo(report.status);
        const arrived = arrival(report);
        if (report.blocked) {
          const { text } = report.blocked;
          if (byHim || blockedNow.current !== text) say("info", "The library was not updated", [text]);
          setBlocked({ text, retry: CAN_TRY_AGAIN.has(report.blocked.reason) });
          // Files that could not be put back are set aside all the same, and that is said.
          if (arrived) tell(arrived, report.setAside?.folder ?? null);
        } else {
          setBlocked(null);
          if (report.updated) {
            tell(arrived, report.setAside?.folder ?? null);
            // The default helmet is seen to only where this update changed which set the list names.
            const change = report.helmetDefault;
            const helmet = change?.changed ? await defaultHelmetNow.current(change.was) : [];
            say("ok", "The library was updated", [arrived, ...report.commits, ...helmet]);
            await refreshNow.current();
            void refreshDefaultsNow.current();
          } else if (byHim) {
            say("info", "The library is already up to date.");
          }
        }
      } catch (e) {
        if (byHim) {
          say("bad", "Could not update the library", [plain(e)]);
          setBlocked({ text: COULD_NOT_UPDATE, retry: true });
        }
      } finally {
        setUpdating(false);
        setBusy(false);
      }
    },
    [libraryRoot, say, tell],
  );

  const checkForUpdates = useCallback(
    () => alone(async () => void (await checkNow(false))),
    [alone, checkNow],
  );
  const updateLibrary = useCallback(() => alone(() => pullNow(true)), [alone, pullNow]);

  /// Whether the sim is running, asked afresh. What the chips know of it is as old as the last time somebody
  /// looked at the page, and the desk can be behind the sim for hours. If it cannot be told, it is taken to be.
  const simRunning = useCallback(async (): Promise<boolean> => {
    try {
      const s = await api.simStatus();
      setSim(s);
      return s.simRunning;
    } catch {
      return true;
    }
  }, []);

  /// The library keeping itself up to date: look at the remote, and take what is waiting. Never while the sim is
  /// running — a race is no time to download textures — and never while something else is being done to the
  /// library. A remote that cannot be reached is not said; it is tried again at the next occasion.
  const keepUp = useCallback(
    () =>
      alone(async () => {
        const known = repoNow.current;
        if (!libraryRoot || (known && (!known.gitAvailable || !known.isRepo || !known.upstream))) return;
        if (busyNow.current || (await simRunning())) return;
        const status = await checkNow(true);
        // What could not be reached found nothing: `updatesAvailable` of one is only what a fetch left behind.
        if (!status?.isRepo || !status.checkedRemote || !status.updatesAvailable) return;
        // A look at the remote takes a moment, and a race can begin in it.
        if (busyNow.current || (await simRunning())) return;
        await pullNow(false);
      }),
    [alone, libraryRoot, simRunning, checkNow, pullNow],
  );
  const keepUpNow = useRef(keepUp);
  keepUpNow.current = keepUp;

  // While it does, that is every half hour the app runs, and when the window comes back to the front after as
  // long away. (And once as the page starts, below.) Away is not being the window in front: another program has
  // the focus, or it is minimised.
  useEffect(() => {
    if (!libraryRoot || !autoOn) return;
    const every = setInterval(() => void keepUpNow.current(), KEEP_UP_MS);
    let awayAt: number | null = document.hasFocus() && !document.hidden ? null : Date.now();
    const away = () => {
      if (awayAt === null) awayAt = Date.now();
    };
    const back = () => {
      const since = awayAt;
      awayAt = null;
      if (since !== null && Date.now() - since >= KEEP_UP_MS) void keepUpNow.current();
    };
    const shown = () => {
      if (document.hidden) away();
      else if (document.hasFocus()) back();
    };
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(every);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [libraryRoot, autoOn]);

  // A toast stays until he dismisses it or, once somebody is looking, for a while: one that came with nobody there
  // is still there when somebody is.
  useEffect(() => {
    if (!toast || !looking) return;
    const gone = setTimeout(() => setToast((t) => (t && t.id === toast.id ? null : t)), TOAST_MS);
    return () => clearTimeout(gone);
  }, [toast, looking]);

  const car: CatalogueCar | null = useMemo(
    () => cars?.find((c) => c.folder === selectedFolder) ?? null,
    [cars, selectedFolder],
  );
  const group = useMemo(
    () => groups.find((g) => g.id === selectedGroup) ?? null,
    [groups, selectedGroup],
  );

  /// Whether an apply is a click away: a car with a livery is on the page, or a group.
  const inReach = !editing && (group !== null || (car?.versions.length ?? 0) > 0);

  // The library is looked at once as the page starts, and then as above. Keeping itself up to date, that is as the
  // page starts, whatever is on it and whether or not anybody is looking: it is what he asked for by not turning
  // it off, and it is not a second after he reaches a livery, with Apply going dead under his hand. With it turned
  // off the remote is asked once per library, and only said — the chip has a button — and not before a livery is
  // within reach of somebody looking at the page, and has been for a moment: the page is opened to look at a view
  // or a pair of pedals as often as to paint, and stays mounted through a race; the remote is no business of
  // either, nor of a car passed on the way to another. Check, under Library source, asks whenever he does.
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready.current || !libraryRoot || checkedFor.current === libraryRoot) return;
    if (!autoOn && (!inReach || !looking)) return;
    const settled = setTimeout(async () => {
      checkedFor.current = libraryRoot;
      if (autoOn) await keepUp();
      else await alone(async () => void (await checkNow(true)));   // nobody pressed Check: quietly, as the rest
    }, REMOTE_AFTER_MS);
    return () => clearTimeout(settled);
  }, [libraryRoot, autoOn, inReach, looking, keepUp, alone, checkNow]);

  const carName = car ? carLabel(car) : "";
  /// Where the car's paint goes: its folder in the paint directory, or, for a car never driven, the
  /// folder the sim would make for it — which an apply makes. Null for a car the sim does not have.
  const target = car ? (car.simFolder ?? car.installPath) : null;

  // --- installed state for the selected car ---------------------------------------------
  // Numbered like the list: what is shown is the answer for the last car asked about, however late
  // another's arrives. A car that is nowhere on disk has nothing installed to read.
  const carAsked = useRef(0);
  const refreshCar = useCallback(async () => {
    const mine = ++carAsked.current;
    if (!car || notOnDisk(car) || !paintDir || !libraryRoot || !/^\d+$/.test(customerId)) {
      setInstalled(null);
      setBackups([]);
      return;
    }
    try {
      const [state, list] = await Promise.all([
        api.carState({
          paintDir,
          libraryRoot,
          carFolder: car.folder,
          simFolder: car.simFolder ?? car.installPath,
          customerId,
        }),
        api.listBackups(car.folder),
      ]);
      if (mine !== carAsked.current) return;
      setInstalled(state);
      setBackups(list);
    } catch (e) {
      if (mine !== carAsked.current) return;
      setInstalled(null);
      setBackups([]);
      say("bad", "Could not read the car's folder", [errorText(e)]);
    }
  }, [car, paintDir, libraryRoot, customerId, say]);

  // An apply or a revert reads the car again when it is done, and by then another car may be the one on
  // the page: what they call is the refreshCar of now, not of the render they began in.
  const latestRefreshCar = useRef(refreshCar);
  useEffect(() => {
    latestRefreshCar.current = refreshCar;
    void refreshCar();
  }, [refreshCar]);

  // What was read, and what was refused, for the last car or group are not this one's. Before the page is
  // painted, so that they are never seen under this one's name.
  useLayoutEffect(() => {
    setInstalled(null);
    setBackups([]);
    setRefused(null);
    setHelmetSaid(null);
    setDefaultSaid(null);
  }, [selectedFolder, selectedGroup]);

  useLayoutEffect(() => {
    setGroupReport(null);
  }, [selectedGroup]);

  // Another car, or a group, is read from its top: the pane does not keep the last one's scroll.
  const pane = useRef<HTMLDivElement>(null);
  const editingWhat = editing ? (editing.group?.id ?? "new") : null;
  useLayoutEffect(() => {
    if (pane.current) pane.current.scrollTop = 0;
  }, [selectedFolder, selectedGroup, editingWhat]);

  const selectCar = (folder: string) => {
    choseAt.current = Date.now();
    setEditing(null);
    setSelectedGroup(null);
    show(folder);
  };
  const selectGroup = (id: string) => {
    setEditing(null);
    setSelectedGroup(id);
  };

  // --- guards ---------------------------------------------------------------------------
  // Whether the sim or the downloader is running, for the chips. Each check starts a process (tasklist), in
  // the process the HUD answers to, so they are made only while somebody is looking — the window in front,
  // this page showing — every eight seconds, and at once when somebody starts to. Apply does not depend on
  // this: it asks again, itself, before it writes.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let checking = false;
    let inFront = document.hasFocus();
    const lookedAt = () => inFront && showing();
    // One check at a time: the window coming to the front and the desk showing the page are one moment.
    const check = () => {
      if (checking) return;
      checking = true;
      void Promise.allSettled([
        api.tradingPaintsStatus().then((v) => live && setTp(v)),
        api.simStatus().then((v) => live && setSim(v)),
      ]).then(() => {
        checking = false;
      });
    };
    const rest = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      setLooking(false);
    };
    const look = () => {
      rest();
      if (!lookedAt()) return;
      setLooking(true);
      check();
      timer = setInterval(() => (lookedAt() ? check() : rest()), GUARD_POLL_MS);
    };
    const front = () => {
      inFront = true;
      look();
    };
    const behind = () => {
      inFront = false;
      rest();
    };
    look();
    window.addEventListener("focus", front);
    window.addEventListener("blur", behind);
    document.addEventListener("visibilitychange", look);
    document.addEventListener("racingdesk:page", look);   // the desk, on showing a page
    return () => {
      live = false;
      rest();
      window.removeEventListener("focus", front);
      window.removeEventListener("blur", behind);
      document.removeEventListener("visibilitychange", look);
      document.removeEventListener("racingdesk:page", look);
    };
  }, []);

  /// Whether something stands in every apply's way right now — the sim running, the downloader — asked
  /// afresh. Only then is going on regardless worth offering: a file that could not be written is not
  /// made writable by insisting.
  const standsInTheWay = async (): Promise<boolean> => {
    try {
      const [s, t] = await Promise.all([api.simStatus(), api.tradingPaintsStatus()]);
      setSim(s);
      setTp(t);
      return s.simRunning || t.running;
    } catch {
      return false;
    }
  };

  // --- actions --------------------------------------------------------------------------
  // One click applies: how is set once, under "When a livery is applied", and what stands in the way is
  // said where the click was, with going on regardless as a second one.
  const doApply = async (version: Version, force: boolean) => {
    if (!car || !target) return;
    const applyingTo = car.folder;
    const name = carName;
    setRefused(null);
    setBusy(true);
    try {
      const report = await api.applyVersion({
        paintDir,
        libraryRoot,
        carFolder: car.folder,
        simFolder: target,
        versionId: version.id,
        customerId,
        includeSpec: options.includeSpec,
        setReadOnlyAfter: options.setReadOnlyAfter,
        clearOtherCooked: options.clearOtherCooked,
        force,
      });
      // What became of the helmet is said where the cards are, and in the activity with the rest.
      const helmet = report.helmet?.said ? [report.helmet.said] : [];
      if (helmet.length) setHelmetSaid({ folder: applyingTo, text: helmet[0] });
      say("ok", `Applied ${version.name} to ${name}`, [
        ...report.actions.map((a) => a.detail),
        ...helmet,
        ...report.warnings,
      ]);
    } catch (e) {
      const reason = errorText(e);
      say("bad", `Did not apply ${version.name} to ${name}`, [reason]);
      const canForce = !force && (await standsInTheWay());
      setRefused({ what: "version", carFolder: applyingTo, version, reason, canForce });
    } finally {
      setBusy(false);
      await latestRefreshCar.current();
      void refreshDefaultsNow.current();
    }
  };

  const doRevert = async (backupId: string | null) => {
    if (!car?.simFolder) return;
    const reverting = car.folder;
    setBusy(true);
    try {
      const report = await api.revertCar({
        paintDir,
        carFolder: car.folder,
        simFolder: car.simFolder,
        customerId,
        backupId,
        force: false,
      });
      const helmet = report.helmet?.said ? [report.helmet.said] : [];
      setHelmetSaid(helmet.length ? { folder: reverting, text: helmet[0] } : null);
      say("ok", `Reverted ${carName}`, [
        ...report.actions.map((a) => a.detail),
        ...helmet,
        ...report.warnings,
      ]);
    } catch (e) {
      say("bad", `Did not revert ${carName}`, [errorText(e)]);
    } finally {
      setBusy(false);
      await latestRefreshCar.current();
      void refreshDefaultsNow.current();
    }
  };

  /// Put the default helmet back as one of its backups has it. A car's revert does this for the backup it names;
  /// this is for the ones no car names — a group that set no car, a library update — and any of the rest.
  const doPutBackDefault = async (backup: DefaultHelmetBackup) => {
    setDefaultSaid(null);
    setBusy(true);
    try {
      const report = await api.revertDefaultHelmet({ paintDir, libraryRoot, customerId, backupId: backup.id });
      setDefaultSaid(report.said);
      say("ok", "Put the default helmet back", [report.said, ...report.warnings]);
    } catch (e) {
      say("bad", "Did not put the default helmet back", [errorText(e)]);
    } finally {
      setBusy(false);
      await refreshDefaultsNow.current();
    }
  };

  const nameOf = (folder: string) => {
    const found = cars?.find((c) => c.folder === folder);
    return found ? carLabel(found) : folder;
  };

  const doSetGroup = async (which: LiveryGroup, force: boolean) => {
    setRefused(null);
    setGroupReport(null);
    setBusy(true);
    try {
      const report = await api.setGroup({
        paintDir,
        libraryRoot,
        customerId,
        groupId: which.id,
        includeSpec: options.includeSpec,
        setReadOnlyAfter: options.setReadOnlyAfter,
        clearOtherCooked: options.clearOtherCooked,
        force,
      });
      setGroupReport(report);
      const counts = [
        report.applied > 0 && `${report.applied} applied`,
        report.already > 0 && `${report.already} already on`,
        report.skipped > 0 && `${report.skipped} skipped`,
        report.failed > 0 && `${report.failed} failed`,
      ].filter(Boolean);
      say(
        report.failed > 0 ? "bad" : "ok",
        `Set ${report.name}: ${counts.join(", ") || "no cars"}`,
        [
          ...report.results
            .filter((r) => r.outcome === "skipped" || r.outcome === "failed")
            .map((r) => `${nameOf(r.folder)}: ${r.detail}`),
          ...report.results.flatMap((r) => r.warnings.map((w) => `${nameOf(r.folder)}: ${w}`)),
          ...(report.helmet?.said ? [report.helmet.said] : []),
          ...report.warnings,
        ],
      );
    } catch (e) {
      const reason = errorText(e);
      say("bad", `Did not set ${which.name}`, [reason]);
      const canForce = !force && (await standsInTheWay());
      setRefused({ what: "group", groupId: which.id, reason, canForce });
    } finally {
      setBusy(false);
      await latestRefreshCar.current();
      void refreshDefaultsNow.current();
    }
  };

  const doSaveGroup = async (name: string, chosen: Record<string, string | null>) => {
    setEditError(null);
    setBusy(true);
    try {
      const saved = await api.saveGroup({
        libraryRoot,
        paintDir: paintDir || null,
        id: editing?.group?.id ?? null,
        name,
        cars: chosen,
      });
      setGroups(await api.liveryGroups(libraryRoot, paintDir || null));
      setEditing(null);
      setSelectedGroup(saved.id);
      say("ok", `${editing?.group ? "Changed" : "Made"} the group ${saved.name}`, [
        `${saved.cars.length} car${saved.cars.length === 1 ? "" : "s"} in it`,
      ]);
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteGroup = async (which: LiveryGroup) => {
    setBusy(true);
    try {
      await api.deleteGroup(which.id);
      setGroups(await api.liveryGroups(libraryRoot, paintDir || null));
      setSelectedGroup(null);
      say("info", `Forgot the group ${which.name}`, ["The liveries are in the library as they were."]);
    } catch (e) {
      say("bad", `Could not forget ${which.name}`, [errorText(e)]);
    } finally {
      setBusy(false);
    }
  };

  const idValid = /^\d+$/.test(customerId);
  const status = useMemo(
    () =>
      collectStatus({
        sim,
        tp,
        repo,
        library: { updating, blocked, auto: autoOn, onUpdate: () => void updateLibrary() },
        car,
        idValid,
      }),
    [sim, tp, repo, updating, blocked, autoOn, updateLibrary, car, idValid],
  );
  const painted = (cars ?? []).some((c) => c.versions.length > 0);

  /// The cars the host keeps a view or pedals for, and those the car list and the car disagree about, to be
  /// marked in the list.
  const kept: Kept = useMemo(
    () => ({
      view: new Set(rig.rig?.views?.keys() ?? []),
      pedals: new Set(
        [...(rig.rig?.pedals?.cars ?? [])].filter(([, row]) => hasPedals(row)).map(([key]) => key),
      ),
      differs: new Set(
        [...(rig.rig?.list?.kept ?? [])].filter(([, said]) => disagrees(said)).map(([key]) => key),
      ),
    }),
    [rig.rig],
  );
  const carKey = car ? rigKey(car) : "";
  const carList = rig.rig?.list ?? null;

  /// What stands where the cars would be while there are none to show.
  const noCars = !listable
    ? { list: "Pick a library folder above.", page: "Pick a library folder to get started." }
    : listing === "reading"
      ? { list: "Reading the cars…", page: "Reading the cars…" }
      : listing === "failed"
        ? {
            list: "The cars could not be read.",
            page: "The cars could not be read. What went wrong is below.",
          }
        : {
            list: "No cars in this folder.",
            page: "Nothing to show. Point the library at a folder of car folders.",
          };

  return (
    <div className="paints-app">
      <SetupBar
        paintDir={paintDir}
        paintReport={pathReport}
        libraryRoot={libraryRoot}
        customerId={customerId}
        customerReport={customerReport}
        suggestions={suggestions}
        onPaintDir={setPaintDir}
        onLibraryRoot={setLibraryRoot}
        onCustomerId={setCustomerId}
      >
        <StatusChips items={status} />
        {/* The cars, and what the host keeps for them. A new list is a new car to read, which the effect
            on it does. */}
        <button
          onClick={() => {
            void refreshLibrary();
            void rig.refresh();
          }}
          disabled={busy}
        >
          Refresh
        </button>
      </SetupBar>

      <div className="body">
        <CarList
          cars={cars ?? []}
          selected={selectedGroup || editing ? null : selectedFolder}
          onSelect={selectCar}
          empty={noCars.list}
          kept={kept}
          lastDriven={lastDriven}
          groups={groups}
          selectedGroup={editing ? null : selectedGroup}
          onSelectGroup={selectGroup}
          onNewGroup={
            inDesk() && painted
              ? () => {
                  setEditError(null);
                  setEditing({ group: null });
                }
              : null
          }
        />

        <div className="main" ref={pane}>
          {editing ? (
            <GroupEditor
              key={editing.group?.id ?? "new"}
              group={editing.group}
              cars={cars ?? []}
              busy={busy}
              error={editError}
              onSave={(name, chosen) => void doSaveGroup(name, chosen)}
              onCancel={() => setEditing(null)}
            />
          ) : group ? (
            <>
              {refused?.what === "group" && refused.groupId === group.id && (
                <Refusal
                  reason={refused.reason}
                  canForce={refused.canForce}
                  busy={busy}
                  forceLabel="Set anyway"
                  onForce={() => void doSetGroup(group, true)}
                  onDismiss={() => setRefused(null)}
                />
              )}
              <GroupPage
                group={group}
                cars={cars ?? []}
                busy={busy}
                ready={idValid && !!paintDir && !!libraryRoot}
                report={groupReport?.groupId === group.id ? groupReport : null}
                onSet={() => void doSetGroup(group, false)}
                onEdit={() => {
                  setEditError(null);
                  setEditing({ group });
                }}
                onDelete={() => void doDeleteGroup(group)}
                onSelectCar={selectCar}
              />
              <ApplyOptionsPanel options={options} onOptions={setOptions} />
            </>
          ) : car ? (
            <>
              <div className="car-head">
                <h2>{carName}</h2>
                <div className="note">
                  <span className="mono">{car.folder}</span>
                  {car.simFolder !== null && car.simFolder !== car.folder && (
                    <>
                      {" "}
                      · installs to <span className="mono">{car.simFolder}</span>
                    </>
                  )}
                  {car.driven > 0 &&
                    ` · driven in ${car.driven} session${car.driven === 1 ? "" : "s"}`}
                  {notOnDisk(car) && " · not installed"}
                </div>
              </div>

              {/* The car as it is driven, under its name and above its liveries: side by side, and in sight
                  without scrolling whatever the car has to wear. */}
              <div className="car-rig">
                <CarViewPanel
                  here={rig.here}
                  rig={rig.rig}
                  view={rig.rig?.views?.get(carKey) ?? null}
                  lastDriven={lastDriven.get(carKey) ?? null}
                  restore={rig.rig?.restore?.cars.get(carKey) ?? null}
                />
                {/* Keyed by the car: where the keyboard was while one car's pedals were saved is not
                    another's. */}
                <CarPedalsPanel
                  key={car.folder}
                  here={rig.here}
                  rig={rig.rig}
                  carName={carName}
                  carPath={rig.rig?.paths.get(carKey) ?? null}
                  bound={rig.rig?.pedals?.cars.get(carKey) ?? null}
                  listed={carList?.cars.get(carKey) ?? null}
                  saving={rig.saving.get(carKey)}
                  note={rig.notes.get(carKey) ?? null}
                  onBind={(path, profileId) => void rig.bind(path, profileId)}
                  restore={rig.rig?.restore?.cars.get(carKey) ?? null}
                />
                {/* What the car list says of it, and where the car disagrees. Not there at all for a host that
                    has no list to say it from. */}
                <CarControlsPanel
                  rig={rig.rig}
                  listed={carList?.cars.get(carKey) ?? null}
                  remarks={carList === null || carList.kept === null ? null : (carList.kept.get(carKey) ?? [])}
                />
              </div>

              {refused?.what === "version" && refused.carFolder === car.folder && (
                <Refusal
                  reason={refused.reason}
                  canForce={refused.canForce}
                  busy={busy}
                  forceLabel={`Apply ${refused.version.name} anyway`}
                  onForce={() => void doApply(refused.version, true)}
                  onDismiss={() => setRefused(null)}
                />
              )}

              {car.versions.length > 0 ? (
                <>
                  <div className="versions">
                    {car.versions.map((v) => (
                      <VersionCard
                        key={v.id}
                        version={v}
                        installed={installed}
                        busy={busy || !idValid || !target}
                        onApply={() => void doApply(v, false)}
                      />
                    ))}
                  </div>
                  {helmetSaid && helmetSaid.folder === car.folder && (
                    <div className="note helmet-said">{helmetSaid.text}</div>
                  )}
                  {!target && (
                    <div className="note">
                      This car is not in the sim: it has no folder in the paint directory and is not
                      in the iRacing install, so there is nowhere to apply a livery to.
                    </div>
                  )}
                  <ApplyOptionsPanel options={options} onOptions={setOptions} />
                </>
              ) : notOnDisk(car) ? (
                // Nothing here needs the car on disk, so nothing is offered that does: no place for a
                // livery, nothing installed, no backup to put back.
                <div className="panel not-on-disk">
                  <h3>Not installed</h3>
                  <div>
                    This car is not on the rig now: it was not found in the iRacing install, the paint
                    folder or the library. Its view and its pedals are kept from when you drove it.
                  </div>
                </div>
              ) : libraryRoot ? (
                <div className="panel no-livery">
                  <h3>No livery yet</h3>
                  <div>
                    There is no livery for this car in the library. A version goes in{" "}
                    <code>{versionHome(libraryRoot, car.folder)}</code>
                  </div>
                  <div className="note">
                    It holds the paint as <code>car.tga</code> and, if there is one, the spec map as{" "}
                    <code>car_spec.tga</code>.
                  </div>
                </div>
              ) : (
                <div className="panel no-livery">
                  <h3>No livery yet</h3>
                  <div>There is no library to keep liveries in. Pick its folder above.</div>
                </div>
              )}

              {!notOnDisk(car) && (
                <>
                  <div className="panel">
                    <h3>Installed in the sim</h3>
                    {!installed?.folderExists ? (
                      <div className="note">
                        {car.simFolder || !idValid
                          ? "Nothing to read yet."
                          : car.installPath
                            ? "This car has no folder in the paint directory yet. Applying a livery makes it; so does the sim, the first time you drive the car."
                            : "This car has no folder in the paint directory yet. The sim creates it the first time you drive the car."}
                      </div>
                    ) : installed.files.length === 0 ? (
                      <div className="note">
                        No files for customer {customerId} in {installed.simFolder}.
                      </div>
                    ) : (
                      <div className="rows">
                        {installed.files.map((f) => (
                          <div className="row-line" key={f.path}>
                            <span className="grow mono">{f.fileName}</span>
                            <span className="note">{f.roleLabel}</span>
                            {f.readOnly && <span className="badge likely">read-only</span>}
                          </div>
                        ))}
                        <div className="row-line">
                          <span className="grow note">
                            {installed.cooked.length} cooked .mip file(s) for this customer
                            {installed.cookedOtherDrivers > 0 &&
                              `, ${installed.cookedOtherDrivers} belonging to other drivers`}
                          </span>
                          <button
                            onClick={() =>
                              installed.files[0] &&
                              reveal(installed.files[0].path).catch(() => {})
                            }
                          >
                            Show in Explorer
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="panel">
                    <h3>Backups</h3>
                    {backups.length === 0 ? (
                      <div className="note">
                        Nothing backed up for this car yet. One is taken before every apply.
                      </div>
                    ) : (
                      <div className="rows">
                        {backups.slice(0, 8).map((b, i) => (
                          <div className="row-line" key={b.id}>
                            <span className="grow">
                              <span className="mono">{b.id}</span>{" "}
                              <span className="note">
                                — {b.reason}, {b.fileCount} file(s)
                              </span>
                            </span>
                            <button
                              className={i === 0 ? "danger" : ""}
                              disabled={busy || !car.simFolder}
                              onClick={() => void doRevert(b.id)}
                            >
                              {i === 0 ? "Revert to this" : "Restore"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <TradingPaintsPanel tp={tp} />
            </>
          ) : (
            <div className="empty">{noCars.page}</div>
          )}

          {/* The default helmet's backups, where there are any to put back, and the library's own housekeeping, under
              whatever the page is about. */}
          <DefaultHelmetPanel
            backups={defaultBackups}
            busy={busy || !paintDir || !libraryRoot}
            said={defaultSaid}
            onPutBack={(b) => void doPutBackDefault(b)}
          />
          <RepoPanel
            repo={repo}
            busy={busy}
            checking={checking}
            autoUpdate={autoOn}
            onAutoUpdate={(on) => {
              setAutoUpdate(on);
              // Turned on, it does what it is for now, and not at the next half hour.
              if (on) void keepUp();
            }}
            onCheck={() => void checkForUpdates()}
            onUpdate={() => void updateLibrary()}
          />

          {/* Whether or not there is a car to show: what went wrong reading the cars is said here. */}
          {log.length > 0 && (
            <div className="panel">
              <h3>Activity</h3>
              <div className="log">
                {log.map((e) => (
                  <div className={`entry ${e.kind}`} key={e.id}>
                    <div>
                      <span className="when">{e.when}</span> {e.title}
                    </div>
                    {e.lines.map((l, i) => (
                      <div className="note" key={i}>
                        {l}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Toast
        toast={toast}
        onShow={(folder) => void reveal(folder).catch(() => {})}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
