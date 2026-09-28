export interface ApplyOptions {
  includeSpec: boolean;
  setReadOnlyAfter: boolean;
  clearOtherCooked: boolean;
}

/// How a livery is applied, said once and remembered. Every apply goes by these — one car's or a whole
/// group's — which is what lets applying be one click: they used to be asked again for each car, in a
/// dialog in the way of the thing being done.
export function ApplyOptionsPanel({
  options,
  onOptions,
}: {
  options: ApplyOptions;
  onOptions: (o: ApplyOptions) => void;
}) {
  return (
    <div className="panel apply-options">
      <h3>When a livery is applied</h3>
      <div className="options">
        <label className="check">
          <input
            type="checkbox"
            checked={options.includeSpec}
            onChange={(e) => onOptions({ ...options, includeSpec: e.target.checked })}
          />
          Install the spec map
        </label>
        <label className="check" title="Trading Paints cannot write over a read-only file">
          <input
            type="checkbox"
            checked={options.setReadOnlyAfter}
            onChange={(e) => onOptions({ ...options, setReadOnlyAfter: e.target.checked })}
          />
          Set read-only afterwards
        </label>
        <label className="check" title="Every driver's paint on this car is cooked again by the sim">
          <input
            type="checkbox"
            checked={options.clearOtherCooked}
            onChange={(e) => onOptions({ ...options, clearOtherCooked: e.target.checked })}
          />
          Also clear other drivers&apos; cooked files
        </label>
      </div>
      <div className="note">
        What is on the car is backed up first, every time, and your own cooked <code>.mip</code> files are
        deleted so the sim cooks the new paint.
      </div>
    </div>
  );
}

/// An apply that was refused, where it was asked for. Going on over what stands in the way is a second
/// click, and only offered when something does — the sim running, the downloader about to write.
export function Refusal({
  reason,
  canForce,
  busy,
  forceLabel,
  onForce,
  onDismiss,
}: {
  reason: string;
  canForce: boolean;
  busy: boolean;
  forceLabel: string;
  onForce: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="banner bad refusal" role="alert">
      <span className="mark">!</span>
      <div className="grow">{reason}</div>
      <div className="actions">
        {canForce && (
          <button className="danger" disabled={busy} onClick={onForce}>
            {forceLabel}
          </button>
        )}
        <button onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
