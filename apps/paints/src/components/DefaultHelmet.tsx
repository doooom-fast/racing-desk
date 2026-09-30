import type { DefaultHelmetBackup } from "../types";

/// How many of the backups are listed: the newest, which is where anything worth putting back is.
const SHOWN = 5;

/// The default helmet — the one every car without a helmet of its own wears — and the backups of it: each time the
/// library's default goes in, by an apply, a group or an update, what was there is kept first. A car's revert puts
/// back the one its apply took; this is how any of them is put back, including those no car's backup names. Not
/// there at all while there is none to put back.
export function DefaultHelmetPanel({
  backups,
  busy,
  said,
  onPutBack,
}: {
  /// Newest first, as the desk lists them.
  backups: DefaultHelmetBackup[];
  busy: boolean;
  /// What the last putting back did, in a sentence.
  said: string | null;
  onPutBack: (backup: DefaultHelmetBackup) => void;
}) {
  if (backups.length === 0) return null;
  return (
    <div className="panel default-helmet">
      <h3>Default helmet</h3>
      <div className="note">
        The default is the helmet every car without one of its own wears. When the library's default goes in, the
        one it replaces is kept here.
      </div>
      <div className="rows">
        {backups.slice(0, SHOWN).map((b) => (
          <div className="row-line" key={b.id}>
            <span className="grow">
              <span className="mono">{b.id}</span>{" "}
              <span className="note">
                — {b.reason}; {b.had ? "a helmet was there" : "no helmet was there"}
              </span>
            </span>
            <button disabled={busy} onClick={() => onPutBack(b)}>
              Put back
            </button>
          </div>
        ))}
      </div>
      {said && <div className="note helmet-said">{said}</div>}
    </div>
  );
}
