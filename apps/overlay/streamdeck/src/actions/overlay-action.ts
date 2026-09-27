import streamDeck, { type KeyDownEvent, SingletonAction } from "@elgato/streamdeck";

/**
 * Generic action that fires an HTTP GET to the RacingDesk overlay's
 * action API when the button is pressed.
 */

const DEFAULT_PORT = 9090;

// Map each UUID to the HTTP action endpoint name.
const UUID_TO_ACTION: Record<string, string> = {
	"com.racing-desk.overlay.toggle-settings": "toggle-settings",
	"com.racing-desk.overlay.toggle-visibility": "toggle-overlay",
	"com.racing-desk.overlay.toggle-drive-mode": "toggle-drive-mode",
	"com.racing-desk.overlay.toggle-rating-editor": "toggle-rating-editor",
	"com.racing-desk.overlay.zoom-in": "zoom-in",
	"com.racing-desk.overlay.zoom-out": "zoom-out",
	"com.racing-desk.overlay.reset-trackmap": "reset-trackmap",
	"com.racing-desk.overlay.restart-demo": "restart-demo",
	"com.racing-desk.overlay.cycle-rating": "cycle-rating",
	"com.racing-desk.overlay.toggle-green-screen": "toggle-greenscreen",
	"com.racing-desk.overlay.cycle-car-logo": "cycle-car-logo",
	"com.racing-desk.overlay.toggle-leaderboard": "toggle-leaderboard",
	"com.racing-desk.overlay.toggle-recording": "toggle-recording",
	"com.racing-desk.overlay.save-replay-buffer": "save-replay-buffer",
	"com.racing-desk.overlay.pitbox-next-tab": "pitbox-next-tab",
	"com.racing-desk.overlay.pitbox-prev-tab": "pitbox-prev-tab",
	"com.racing-desk.overlay.dismiss-commentary": "dismiss-commentary",
	"com.racing-desk.overlay.preset-broadcast": "preset-broadcast",
	"com.racing-desk.overlay.preset-practice": "preset-practice",
	"com.racing-desk.overlay.preset-qualifying": "preset-qualifying",
	"com.racing-desk.overlay.quit": "quit",
};

type OverlaySettings = {
	port?: number;
};

async function fireAction(actionName: string, port: number): Promise<boolean> {
	const url = `http://127.0.0.1:${port}/api/action/${actionName}`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Single action class shared by all 22 manifest actions.
 * Registered once per UUID in plugin.ts.
 */
export class OverlayAction extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>): Promise<void> {
		const uuid = ev.action.manifestId;
		const actionName = UUID_TO_ACTION[uuid];
		if (!actionName) {
			await ev.action.showAlert();
			return;
		}

		const port = ev.payload.settings?.port || DEFAULT_PORT;
		const ok = await fireAction(actionName, port);

		if (ok) {
			await ev.action.showOk();
		} else {
			await ev.action.showAlert();
		}
	}
}

// All UUIDs that should use this action class
export const ALL_UUIDS = Object.keys(UUID_TO_ACTION);
