import { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";

const DEFAULT_PORT = 9090;

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

async function handleKey(ev: KeyDownEvent<OverlaySettings>, actionName: string): Promise<void> {
	const port = ev.payload.settings?.port || DEFAULT_PORT;
	const ok = await fireAction(actionName, port);
	if (ok) {
		await ev.action.showOk();
	} else {
		await ev.action.showAlert();
	}
}

// ── App actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.toggle-settings" })
export class ToggleSettings extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-settings"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.toggle-overlay" })
export class ToggleOverlay extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-overlay"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.quit" })
export class QuitOverlay extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "quit"); }
}

// ── HUD actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.toggle-drive-mode" })
export class ToggleDriveMode extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-drive-mode"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.toggle-leaderboard" })
export class ToggleLeaderboard extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-leaderboard"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.cycle-rating" })
export class CycleRating extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "cycle-rating"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.cycle-car-logo" })
export class CycleCarLogo extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "cycle-car-logo"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.zoom-in" })
export class ZoomIn extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "zoom-in"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.zoom-out" })
export class ZoomOut extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "zoom-out"); }
}

// ── Pit Box actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.pitbox-next-tab" })
export class PitboxNextTab extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "pitbox-next-tab"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.pitbox-prev-tab" })
export class PitboxPrevTab extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "pitbox-prev-tab"); }
}

// ── Commentary actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.dismiss-commentary" })
export class DismissCommentary extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "dismiss-commentary"); }
}

// ── Recording actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.toggle-recording" })
export class ToggleRecording extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-recording"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.save-replay-buffer" })
export class SaveReplayBuffer extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "save-replay-buffer"); }
}

// ── Demo / Debug actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.restart-demo" })
export class RestartDemo extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "restart-demo"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.reset-trackmap" })
export class ResetTrackmap extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "reset-trackmap"); }
}

// ── Editor actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.toggle-rating-editor" })
export class ToggleRatingEditor extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-rating-editor"); }
}

// ── Preset actions ──

@action({ UUID: "com.k10motorsports.racecor.overlay.preset-broadcast" })
export class PresetBroadcast extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "preset-broadcast"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.preset-practice" })
export class PresetPractice extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "preset-practice"); }
}

@action({ UUID: "com.k10motorsports.racecor.overlay.preset-qualifying" })
export class PresetQualifying extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "preset-qualifying"); }
}
