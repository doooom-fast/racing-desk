import { useEffect, useMemo, useState } from "react";
import { errorText, previewImage } from "../api";
import type { HelmetPick, InstalledState, Version, VersionFile } from "../types";

interface Source {
  key: string;
  label: string;
  path: string;
}

/// Tidy a preview filename into something that fits under a card.
/// `preview_topview_nose_up.png` -> `topview nose up`
function previewLabel(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const stem = name.replace(/\.[^.]+$/, "").replace(/^preview[-_]?/i, "");
  return stem.replace(/[-_]+/g, " ").trim() || "preview";
}

/// Everything worth looking at for one version: the pipeline's renders first, then the
/// textures themselves. The renders show the car; the textures are what actually gets
/// installed, which is the thing worth checking before an apply.
function sourcesFor(version: Version): Source[] {
  const out: Source[] = version.previews.map((p) => ({
    key: p,
    label: previewLabel(p),
    path: p,
  }));
  const byRole = (role: string): VersionFile | undefined =>
    version.files.find((f) => f.role === role);
  for (const role of ["car", "car_spec", "car_decal", "car_num"]) {
    const file = byRole(role);
    if (file) {
      out.push({
        key: role,
        label: role === "car" ? "paint" : role.replace("car_", ""),
        path: file.path,
      });
    }
  }
  return out;
}

function Preview({ source }: { source: Source | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setError(null);
    if (!source) return;
    previewImage(source.path, 640)
      .then((d) => live && setSrc(d))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [source?.path]);

  return (
    <div className="preview">
      {src ? (
        <img src={src} alt={source?.label ?? ""} />
      ) : (
        <span className="none" title={error ?? undefined}>
          {!source ? "nothing to show" : error ? "unreadable" : "…"}
        </span>
      )}
    </div>
  );
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/// The helmet's two colours as one small disc, the body on the left and the art on the right. A set the list
/// gives no colours for has no disc; one it gives one colour for is that colour whole.
function Swatch({ pick }: { pick: HelmetPick }) {
  const body = pick.body ?? pick.art;
  const art = pick.art ?? pick.body;
  if (!body || !art) return null;
  return (
    <span
      className="swatch"
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${rgb(body)} 0 50%, ${rgb(art)} 50% 100%)` }}
    />
  );
}

/// Which helmet comes with the version, where the library keeps helmets at all: the set, with its colours, or
/// that none does — or, for a set that cannot be used, why, in the sentence an apply would say of it, so that the
/// card and the apply never disagree. Nothing where the library keeps none.
function Helmet({ pick }: { pick: HelmetPick | null | undefined }) {
  if (pick === undefined) return null;
  return (
    <div className="helmet">
      {pick && pick.problem ? (
        <span className="problem">{pick.problem}</span>
      ) : pick ? (
        <>
          <Swatch pick={pick} />
          <span>Comes with the {pick.set} helmet.</span>
        </>
      ) : (
        <span>No helmet comes with this version.</span>
      )}
    </div>
  );
}

export function VersionCard({
  version,
  installed,
  busy,
  onApply,
}: {
  version: Version;
  installed: InstalledState | null;
  busy: boolean;
  onApply: () => void;
}) {
  const sources = useMemo(() => sourcesFor(version), [version]);
  const [index, setIndex] = useState(0);
  const current = sources[Math.min(index, sources.length - 1)];

  const isApplied = installed?.appliedVersionId === version.id;
  const exact = isApplied && installed?.matchKind === "exact";
  const partial = isApplied && installed?.matchKind === "paint-only";

  const roles = version.files.map((f) => f.roleLabel).join(" + ") || "nothing installable";

  return (
    <div className={`card ${exact ? "applied" : ""}`}>
      <Preview source={current} />
      {sources.length > 1 && (
        <div className="views">
          {sources.map((s, i) => (
            <button
              key={s.key}
              className={`view ${i === index ? "on" : ""}`}
              onClick={() => setIndex(i)}
              title={s.path}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="head">
        <span className="name">{version.name}</span>
        {exact && <span className="badge applied">applied</span>}
        {partial && <span className="badge partial">paint only</span>}
      </div>
      <div className="roles">{roles}</div>
      <Helmet pick={version.helmet} />
      {version.meta.notes && <div className="notes">{version.meta.notes}</div>}
      {version.problems.length > 0 && (
        <div className="problems">
          {version.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !version.hasPaint}
          onClick={onApply}
          title={version.hasPaint ? "" : "This version has no car paint to install"}
        >
          {exact ? "Re-apply" : "Apply"}
        </button>
        {partial && (
          <span className="note" style={{ color: "var(--warn)" }}>
            the paint matches but the spec map does not
          </span>
        )}
      </div>
    </div>
  );
}
