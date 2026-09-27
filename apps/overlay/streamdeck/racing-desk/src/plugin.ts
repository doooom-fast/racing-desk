import streamDeck from "@elgato/streamdeck";

// Import all action classes — @action decorators auto-register them
import "./actions/overlay-action";

streamDeck.logger.setLevel("trace");
streamDeck.connect();
