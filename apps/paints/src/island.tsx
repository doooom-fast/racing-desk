// The livery manager as an island. apps/paints/build-island.mjs bundles this into the desk window as
// window.RacingDeskPaints (apps/overlay/modules/desk/paints.bundle.js + .css), and modules/desk/desk.js mounts it
// into the Cars page the first time that page is shown: the one list of cars, and a car's liveries, view and pedals.
// The same App as main.tsx; only the shell around it differs.
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import "./styles.css";

// What the desk hands over: when each car was last driven, from the sessions it has already read.
export { setLastDriven } from "./driven";

let root: Root | null = null;
let host: HTMLElement | null = null;

/// Render the app into `el`. Mounting into the same element again is a no-op; a different element unmounts first.
export function mount(el: HTMLElement): void {
  if (root && host === el) return;
  unmount();
  root = createRoot(el);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  host = el;
}

export function unmount(): void {
  root?.unmount();
  root = null;
  host = null;
}
