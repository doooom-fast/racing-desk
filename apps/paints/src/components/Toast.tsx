/// A short word about something that happened by itself — the library took an update — over the page, where it is
/// seen without going down to the Activity list at its foot. It goes when it is dismissed, or a while after somebody
/// has been looking (App.tsx): one that arrived with nobody there is still there when somebody is.
export interface ToastItem {
  id: number;
  text: string;
  /// A folder the text speaks of, to be shown in Explorer.
  folder: string | null;
}

export function Toast({
  toast,
  onShow,
  onDismiss,
}: {
  toast: ToastItem | null;
  onShow: (folder: string) => void;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  const folder = toast.folder;
  return (
    <div className="toast" role="status">
      <span className="grow">{toast.text}</span>
      {folder && <button onClick={() => onShow(folder)}>Show</button>}
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
