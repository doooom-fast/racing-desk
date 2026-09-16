import streamDeck from "@elgato/streamdeck";
import { OverlayAction, ALL_UUIDS } from "./actions/overlay-action";

// Register the same action handler for every UUID in the manifest
const handler = new OverlayAction();
for (const uuid of ALL_UUIDS) {
	streamDeck.actions.registerAction(handler, uuid);
}

// Connect to the Stream Deck
streamDeck.connect();
