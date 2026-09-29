import type { RepoStatus } from "../types";

/// The library's git checkout: where it is, whether new liveries are waiting, a button to take
/// them, and the one switch — whether the library keeps itself up to date, which it does unless
/// he turns it off.
///
/// The update is a fast-forward or nothing. If the checkout has work of its own or has diverged
/// from the remote, the app says so (the status chip has the sentence) and leaves it alone
/// rather than merging.
export function RepoPanel({
  repo,
  busy,
  checking,
  autoUpdate,
  onAutoUpdate,
  onCheck,
  onUpdate,
}: {
  repo: RepoStatus | null;
  busy: boolean;
  checking: boolean;
  /// The library keeps itself up to date.
  autoUpdate: boolean;
  onAutoUpdate: (v: boolean) => void;
  onCheck: () => void;
  onUpdate: () => void;
}) {
  if (!repo) return null;

  if (!repo.gitAvailable) {
    return (
      <div className="panel">
        <h3>Library source</h3>
        <div className="note">
          git is not on this machine, so the library cannot be kept in step with a repo.
        </div>
      </div>
    );
  }

  if (!repo.isRepo) {
    return (
      <div className="panel">
        <h3>Library source</h3>
        <div className="note">
          This library is a plain folder, so it cannot update itself. Choose the folder your
          liveries are kept in online, above, to have new versions arrive by themselves.
        </div>
      </div>
    );
  }

  // `behind` is only countable once the commits are local, so the badge falls back to
  // saying that something is waiting rather than claiming a number it does not have.
  const canUpdate = repo.updatesAvailable && !repo.dirty && !!repo.upstream;
  const waiting =
    repo.behind > 0
      ? `${repo.behind} update${repo.behind === 1 ? "" : "s"} waiting`
      : "updates waiting";

  return (
    <div className="panel">
      <h3>Library source</h3>
      <div className="rows">
        <div className="row-line">
          <span className="grow">
            {repo.remoteUrl ? (
              <span className="mono">{repo.remoteUrl.replace(/^https:\/\/github\.com\//, "")}</span>
            ) : (
              <span className="note">no remote</span>
            )}{" "}
            <span className="note">
              on {repo.branch ?? "?"}
              {repo.head && ` at ${repo.head}`}
            </span>
          </span>
          {repo.updatesAvailable ? (
            <span className="badge guess">{waiting}</span>
          ) : (
            <span className="badge certain">
              {repo.checkedRemote ? "up to date" : "up to date as of last check"}
            </span>
          )}
        </div>

        {repo.subject && (
          <div className="row-line">
            <span className="grow note">Latest here: {repo.subject}</span>
          </div>
        )}

        {repo.ahead > 0 && (
          <div className="row-line">
            <span className="grow note">
              {repo.ahead} change{repo.ahead === 1 ? "" : "s"} of its own not online yet.
            </span>
          </div>
        )}

        {repo.notes.map((n) => (
          <div className="row-line" key={n}>
            <span className="grow note" style={{ color: "var(--warn)" }}>
              {n}
            </span>
          </div>
        ))}

        <div className="row-line" style={{ marginTop: 4 }}>
          <label className="check grow">
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => onAutoUpdate(e.target.checked)}
            />
            Keep the library up to date by itself
          </label>
          <button onClick={onCheck} disabled={busy || checking}>
            {checking ? "Checking…" : "Check"}
          </button>
          <button className={canUpdate ? "primary" : ""} onClick={onUpdate} disabled={busy || !canUpdate}>
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
