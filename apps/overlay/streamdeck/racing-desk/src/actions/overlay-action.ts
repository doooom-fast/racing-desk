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

@action({ UUID: "com.doooom.racingdesk.toggle-settings" })
export class ToggleSettings extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-settings"); }
}

@action({ UUID: "com.doooom.racingdesk.toggle-overlay" })
export class ToggleOverlay extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-overlay"); }
}

@action({ UUID: "com.doooom.racingdesk.quit" })
export class QuitOverlay extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "quit"); }
}

// ── HUD actions ──

@action({ UUID: "com.doooom.racingdesk.toggle-drive-mode" })
export class ToggleDriveMode extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-drive-mode"); }
}

@action({ UUID: "com.doooom.racingdesk.toggle-leaderboard" })
export class ToggleLeaderboard extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-leaderboard"); }
}

@action({ UUID: "com.doooom.racingdesk.cycle-rating" })
export class CycleRating extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "cycle-rating"); }
}

@action({ UUID: "com.doooom.racingdesk.cycle-car-logo" })
export class CycleCarLogo extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "cycle-car-logo"); }
}

@action({ UUID: "com.doooom.racingdesk.zoom-in" })
export class ZoomIn extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "zoom-in"); }
}

@action({ UUID: "com.doooom.racingdesk.zoom-out" })
export class ZoomOut extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "zoom-out"); }
}

// ── Pit Box actions ──

@action({ UUID: "com.doooom.racingdesk.pitbox-next-tab" })
export class PitboxNextTab extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "pitbox-next-tab"); }
}

@action({ UUID: "com.doooom.racingdesk.pitbox-prev-tab" })
export class PitboxPrevTab extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "pitbox-prev-tab"); }
}

// ── Commentary actions ──

@action({ UUID: "com.doooom.racingdesk.dismiss-commentary" })
export class DismissCommentary extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "dismiss-commentary"); }
}

// ── Recording actions ──

@action({ UUID: "com.doooom.racingdesk.toggle-recording" })
export class ToggleRecording extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-recording"); }
}

@action({ UUID: "com.doooom.racingdesk.save-replay-buffer" })
export class SaveReplayBuffer extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "save-replay-buffer"); }
}

// ── Demo / Debug actions ──

@action({ UUID: "com.doooom.racingdesk.restart-demo" })
export class RestartDemo extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "restart-demo"); }
}

@action({ UUID: "com.doooom.racingdesk.reset-trackmap" })
export class ResetTrackmap extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "reset-trackmap"); }
}

// ── Editor actions ──

@action({ UUID: "com.doooom.racingdesk.toggle-rating-editor" })
export class ToggleRatingEditor extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "toggle-rating-editor"); }
}

// ── Preset actions ──

@action({ UUID: "com.doooom.racingdesk.preset-broadcast" })
export class PresetBroadcast extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "preset-broadcast"); }
}

@action({ UUID: "com.doooom.racingdesk.preset-practice" })
export class PresetPractice extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "preset-practice"); }
}

@action({ UUID: "com.doooom.racingdesk.preset-qualifying" })
export class PresetQualifying extends SingletonAction<OverlaySettings> {
	override async onKeyDown(ev: KeyDownEvent<OverlaySettings>) { await handleKey(ev, "preset-qualifying"); }
}
