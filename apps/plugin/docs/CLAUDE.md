# apps/plugin/docs

Design documents from `prodrive-plugin`, written before the local-first refactor (root CLAUDE.md, and
`docs/local-first-refactor-plan.md`). None is the current word on the code: the root CLAUDE.md and the CLAUDE.md of each
app are. Read them for intent and history.

| Document | Still useful for | Out of date |
|----------|------------------|-------------|
| `AI_STRATEGIST_DESIGN.md` | The strategist's modules (tyres, fuel, pit, opponents) | Paths: the engine is `RacingDesk.Core` now; tyre wear's meaning (root, Tyre wear) |
| `FEATURE_SPEC_INCIDENT_COACH.md` | The incident coach's intent | Paths and anything of a server |
| `WEBSOCKET_PROTOCOL.md` | The `:8890` MessagePack feed's history | Check against `Transport/` in Core |
| `missing-data-audit.md` | What telemetry was missing, then | Much has since been added |
| `FEATURE_PLAN_PEDAL_FFB_MANAGER.md`, `FEATURE_PLAN_SETTINGS_MIGRATION.md`, `BRANCH_SCOPE_OVERLAY_SETTINGS_MIGRATION.md` | The Moza and settings work's plans | Settings are edited on the desk now (root, Desk) |
| `livery-builder-plan.md`, `FEATURE_IDEAS_UNRELEASED.md`, `iracing-progression-features.md` | Ideas | Not built as written; liveries are `apps/livery` and the Cars page |
| `STYLEGUIDE.md` | The HUD's original visual language | Words and capitals: the root's Words, not capitals wins |
| `api-data-browser.html` | A viewer of the old property list | The contract has changed since |
| `STYLE_DICTIONARY_PLAN.md`, `WEB_COMPONENTS_PLAN.md`, `discord-docs.md`, `discord-welcome.md` | Nothing here | The web app, its token pipeline and its Discord: retired |
