# Racing Desk review — agent handoff

## Request and status

The driver asked for a review of overall hygiene, bugs and unfinished work, particularly reliable on-screen force-feedback and brake-force settings. iRacing is the primary use case; Assetto Corsa and EVO should work too. He wants suggestions that finish the experience, not more features for their own sake.

**This review is unfinished.** It was paused to consider doing the source review on his M1 Pro MacBook while another Claude session works on the Windows rig. Findings below distinguish reproductions, source observations and live-verification gaps; they are not an exhaustive audit.

Original review source: `main` at `cd1003c` (`fix(plugin): a number that is not finite is null on the wire; the HUD page's errors go into the log`). No application source was changed. No app or host was launched by hand, no SimHub plugin installed, no hardware command sent and no rig setting changed. Focused tests generated local build/test outputs.

The GitHub destination confirmed by the driver is `https://github.com/doooom-fast/racing-desk`. Older project guidance names a different repository.

## Resumed work from `3f54c72`

The first fix is implemented in `rig-limits.js`: leaving the car or changing the reported car, sim/demo, session, track or local host clears cached readings and invalidates outstanding requests. Re-entry asks immediately. Old successes and failures cannot overwrite the new context or alter its polling state; the host is checked again when a request completes, even without another telemetry frame. Normal control adjustments and green/chequered changes do not invalidate readings.

Added 16 lifecycle tests. Before the fix, all 14 initially added regressions failed (the 16 existing tests passed); two more tests cover stable identity and moving back to a previous host. After the fix, **83 selected tests passed**, including the browser-dependent HUD checks:

```text
npm test -w racing-desk-overlay -- rig-limits.spec.mjs datastream-limits.spec.mjs hud-page-assetto.spec.mjs in-car.spec.mjs host-reads-this-machine.spec.mjs --workers=2 --reporter=line
```

On the Mac checkout, dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund`, then the missing browser with `npx playwright install chromium`. Node v25.9.0 / npm 11.12.1. The project's software-rendering flags were retained. No live host/app, SimHub plugin or hardware was started. This run supersedes the missing-browser limitation for these selected tests, not the original .NET/live-verification gaps.

**Still open:** source/freshness presentation, validating the host's reported brake car against the displayed car, AC/EVO brake-force support, and the other findings below. Session invalidation follows the identity fields the wire actually carries; it cannot detect a new session that reports identical identity fields without an intervening exit/disconnect. Next is the trustworthy rig-status slice (step 3 below), followed by Windows verification.

## The rig-status slice (step 3), 2026-10-28, branch `feature/rig-status-sources`

- **Sources**: the HUD's wheel row is labelled "Preset wheel max" while its number is Pit House's saved preset (the host's `wheelSource: pithouse`), and "Wheel max" for the base's own reading (finding 2). The preset's age and the number of bases Pit House has met are still not shown.
- **Actionable unknown states**: the host's `/racing-desk/data/brakeforce` now says why the force is not known (`why`: `not-set`, `held`, `live-restarted`, `live-off`, `no-keys`, `no-smartcontrol`, `unread`, `no-car`; `CarPedalsRecorder.Now`), and the HUD's Brake max row says it in a few words in place of the dash ("Not set yet", "Key held", "Live restarted", "Live not running", …).
- **Brake car validated**: a force the host gives for another car than the one the telemetry's `CarControls` names is not shown (finding 1's remainder). A car the list does not have names no folder, so its answer is not checked.
- **Per-sim support explicit**: in a sim that is not iRacing the row says "iRacing only" instead of a dash, since the host follows the force from iRacing's frames alone (finding 3). Following the force in Assetto Corsa and EVO is still not built.
- Tests: 195 .NET (brake force, routes), 142 overlay (rig limits, datastream rows, host reads, Assetto page, in-car, words scan) and the 4 golden frames, all passing. **Not verified live**: the reasons have not been seen on the rig's HUD with the real host, SmartControl and Live; that is step 4's checklist. Beside SimHub the host's answer reaches the HUD through the app's main process, so this needs the app rebuilt (`npm run build`), not the plugin reinstalled.

## Findings (original review)

### 1. Fixed in the resumed work: a late request restores stale rig readings after leaving the car

`apps/overlay/modules/js/rig-limits.js:161–181`

`feed(null)` clears the readings, but an already-running `ask()` publishes its result without checking whether the driver is still in the same car/session. The reproduction below clears all fields on exit, then repopulates them with 80 kg, the old car and 11.55 Nm when the request resolves.

Run from the repository root with Node; it makes no network or hardware requests:

```js
const { createRigLimits } = require('./apps/overlay/modules/js/rig-limits');
const inCar = {
  'DataCorePlugin.GameRunning': 1,
  'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1,
};
let resolve;
const keeper = createRigLimits({
  host: 'http://localhost:18889',
  send: value => console.log('sent', value),
  fetch: () => new Promise(done => { resolve = done; }),
});
keeper.feed(inCar);
keeper.feed(null);
console.log('after exit', keeper.current());
resolve({ brakeKg: 80, car: 'old car', wheelNm: 11.55, wheelSource: 'pithouse' });
setImmediate(() => console.log('after late reply', keeper.current()));
```

Suggested fix: invalidate pending responses on context changes. Cover exit, a different car/session and a different host. The renderer also retains the reported car but does not use it to validate the displayed brake value (`datastream.js:49–58`).

### 2. Wheel max is not necessarily the current hardware setting

- `apps/core/RacingDesk.Data/Wheel/PitHouseWheelLimits.cs`
- `apps/overlay/modules/js/rig-limits.js`
- `apps/overlay/modules/js/datastream.js:47–68`

The fallback reads a saved Pit House preset. When several motor presets are listed, it selects the most recently saved candidate, not a positively identified attached base. Unsaved slider changes are invisible. These limitations are documented, but the HUD drops `wheelSource` and displays an unqualified number.

Keep the distinctions clear:

- Wheel max: the base's configured torque ceiling, or a saved-preset estimate.
- Sim feedback max: iRacing's `SteeringWheelMaxForceNm`, the simulator's force scale, not the wheel's torque ceiling.
- Live steering torque: another quantity, not either setting.

Suggested improvement: carry source, model and freshness through to the presentation. Distinguish live reading, saved preset and unknown; do not silently promote a saved preset to a current hardware fact.

### 3. Brake-force tracking is still iRacing-only

`apps/host/RacingDesk.Host/Program.cs:211–315`

The host calls `CarPedalsRecorder.See()` from iRacing SDK telemetry frames. AC/EVO HUD support uses SimHub, but that does not provide this host recorder with an equivalent frame source. A functioning Assetto HUD therefore does not establish that its brake-max reading works.

AC/EVO support is explicitly partial in the root guidance. Live SimHub property names and behavior still need verification per game. Do not extend iRacing-specific profile/seat restoration to another sim accidentally.

### 4. Brake-key bindings are cached for the car's run

`apps/core/RacingDesk.Data/Pedals/CarPedalsRecorder.cs:234–282`

Once `_keys` exists, the watcher does not reload bindings. Investigate restarting SmartControl Live during the same run after the Right-Ctrl key migration: the watcher can retain the bindings Live previously used. **Source observation; not reproduced against Live.**

**Fixed 2026-10-28** (branch `fix/brake-max-stale`): the recorder asks when Live started (every 10 s in a car, off the telemetry thread, and on a key); one started since its keys were read has them read again, and the force becomes not known until a key sets one. Tests in `Pedals/BrakeForceTests.cs`. Still to see at the rig: what Live does to the pedals as it starts.

The force is inferred from observed keys or seeded after the restoration action, not measured back from the pedal controller. Validate what happens after external profile edits, restarts and telemetry gaps before treating it as a hardware-confirmed setting. A dash should explain why the force is unknown on the desk, rather than silently looking broken.

### 5. The editor is not complete end to end

- `apps/edit/package.json` points its CLI and start script at `bin/racing-desk-edit.js`; both that file and the `bin` directory were absent in this checkout.
- `apps/edit/src/ingest/parse-telemetry.js` keeps the summary but does not apply `videoOffsetMs` or pauses. The editor guidance explicitly acknowledges the timing gap. Cuts can therefore miss the telemetry event even if event detection is correct.

Restore a usable CLI entry point and establish one tested telemetry-to-video time conversion before adding editorial intelligence.

### 6. Hygiene and maintenance observations

- The focused .NET build reported known MessagePack 2.5.187 vulnerability advisories, including high-severity advisories. Reachability/exploitability was not assessed. Review the actual deserialization surface and a compatible upgrade rather than treating an advisory alone as proof of an exploitable app bug.
- Root `CLAUDE.md` is very large and was truncated in the agent's injected context. Nested plugin guidance still describes cloud behavior and older architecture that conflict with the current root guidance. Consolidate current instructions and archive superseded ones.
- Some wiring checks assert source text. Those checks are useful constraints, but passing them does not establish installed-plugin compatibility, live hardware correctness or complete end-to-end behavior.
- The code shows substantial care around local-only privileged routes, bounded requests, backup/read-back rules, software-rendered browser tests and avoiding fabricated telemetry. Preserve those safeguards while simplifying the remaining integration seams.

## Verification performed

No live driving/hardware validation was performed. The installed app and SimHub DLL were not compared against this source revision.

| Check | Result |
|---|---|
| Focused .NET: brake force, wheel max, sim-force scale, AC controls, brake-key migration, local route restrictions | 287 passed |
| Calc workspace | 196 passed |
| Editor workspace | 58 passed |
| Selected HUD/rig-limit checks | 42 passed; browser-dependent tests could not launch because Playwright Chromium was absent |
| Late rig-limit response reproduction above | Bug reproduced |

Commands run:

```text
dotnet test apps/plugin/racing-desk-plugin/simhub-plugin/tests/RacingDesk.Tests/RacingDesk.Tests.csproj -c Release --filter "FullyQualifiedName~BrakeForce|FullyQualifiedName~WheelMax|FullyQualifiedName~SteerMaxForce|FullyQualifiedName~AcCarControls|FullyQualifiedName~BrakeKeys|FullyQualifiedName~DataRoutesThisMachine|FullyQualifiedName~ActionRoutes" --logger "console;verbosity=minimal"
npm test -w @racing-desk/calc
npm test -w racing-desk-edit
npm test -w racing-desk-overlay -- rig-limits.spec.mjs datastream-limits.spec.mjs hud-page-assetto.spec.mjs in-car.spec.mjs host-reads-this-machine.spec.mjs --workers=2 --reporter=line
```

The HUD command's filename patterns also selected `hud-page-in-car.spec.mjs`. Its overall run failed; do not describe it as a green browser suite. The output also included a Node/libuv shutdown assertion after the missing-browser failures; that was not independently investigated. Environment: Node v24.14.0, .NET SDK 8.0.301.

Local logs, not part of this handoff commit: `apps/overlay/test-results/assist-review-{hud,dotnet,edit,calc}.log`. A later Playwright run can clear that directory.

The calc run left five snapshot files flagged as modified without any content diff. Staging those exact files refreshed the index and left the working tree clean, with nothing staged. No snapshot changes were committed.

## Next steps and working boundaries

1. Recheck the current commit and working tree: another agent may have moved the code forward. Use a separate clone/worktree, not a shared checkout and build directory.
2. **Implemented and tested:** fix the reproduced stale-response bug with lifecycle tests (see Resumed work above).
3. Finish one trustworthy rig-status slice: explicit sources/freshness, correct invalidation, actionable unknown states and explicit per-sim support.
4. On Windows, verify the installed app/plugin versions and perform a short live checklist: cold start, set/step brake keys, Live restart, Pit House saved versus unsaved changes, car changes, garage/replay, reconnect, and one AC/EVO run each.
5. Complete recording-to-editor timing and CLI integration, then resume the wider review of recording, commentary, liveries and Electron boundaries. Those areas were only sampled, not fully audited.
6. Consolidate stale guidance and make the local verification path reproducible. The project explicitly does not want CI or cloud services added.

The M1 Pro is suitable for source review, most JavaScript/browser tests and planning. Windows/.NET integration and real iRacing/SimHub/SmartControl/Moza verification remain rig tasks.

Read current project instructions before testing. On the rig, headless Chromium must use the project's software-rendering flags, and no browser tests while iRacing is running. Ask before reinstalling the SimHub plugin. Never launch a live host just to inspect state: startup can perform approved automatic rig restoration. Any manual replay/parity probe must use loopback-only listeners.
