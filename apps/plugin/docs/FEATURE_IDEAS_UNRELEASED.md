# RaceCor ProDrive — Feature Ideation: The Uncharted Stuff

> Nobody else is doing any of this. That's the point.

---

## 1. The Driver's Body as a Data Source

### Wearable Integration (WHOOP / Garmin / Oura / Apple Watch)

The research is unambiguous: HRV drops under cognitive load, heart rate spikes predict mistakes before they happen, and sleep quality the night before a race correlates directly with reaction time degradation over a stint. Nobody in sim racing is pulling this data in.

**The pitch:** Connect via Terra API or Open Wearables (unified API, handles OAuth for all major wearables). Before a session starts, pull the driver's readiness score, sleep quality, resting HRV, and recovery status. During a session, stream real-time heart rate.

**What it unlocks:**

- **Pre-race readiness check.** "Your recovery score is 42% and you slept 5.2 hours. Your reaction time is likely degraded by 15-20%. Consider a shorter stint or more conservative brake markers." This isn't speculation — the research shows 9-34% reaction time variance based on fatigue state alone.
- **Live stress spike detection.** Heart rate jumping 30+ BPM above baseline mid-stint? That correlates with the anger/frustration cycle your incident coach already tracks. Now you can detect it *physiologically* before the driving degrades — and fire a commentary fragment like "Heart rate's climbing. Deep breath. This is where the smart drivers make their moves."
- **Post-race physiological debrief.** Overlay heart rate on the lap time chart. Show the driver where their body was calm and fast vs. stressed and slow. This is what F1 teams do with biometric data — nobody offers it to sim racers.
- **Fatigue cliff prediction.** HRV trends downward over a long stint. Model the relationship between HRV decline and lap time degradation for each individual driver. Predict the lap where they'll start losing time and recommend pit timing around *driver* degradation, not just tire degradation.

**API:** [Terra](https://tryterra.co/) — one integration, covers WHOOP, Garmin, Oura, Fitbit, Apple Health, Samsung. Or go direct with WHOOP's developer API for the richest data.

**Commentary triggers:** `heart_rate_spike`, `low_readiness`, `fatigue_cliff_approaching`, `calm_zone` (positive reinforcement when HR is stable and laps are fast).

---

## 2. Solar Glare Prediction

Every iRacing track is a laser scan of a real-world location. Every real-world location has GPS coordinates. The sun has a calculable position for any point on Earth at any time. iRacing simulates time of day. The track heading at every point is known from the SVG track data you already have.

**Put it together:** Calculate when the sun will be directly in the driver's eyes based on their heading at each point on the track, the time of day in the sim session, and the track's real-world latitude/longitude.

**What it unlocks:**

- **Per-corner sun glare warnings.** "Sun will be in your eyes through turns 3-5 this stint. Brake markers may be harder to see." Nobody does this. Not CrewChief, not iOverlay, not VRS. It's a safety and performance feature in one.
- **Glare timeline on the track map.** Color-code track segments by glare severity as the race progresses. Since iRacing models time-of-day progression, the glare zones shift during a long race.
- **Visor tint suggestion.** At tracks with extreme glare angles (Bahrain at sunset, Spa through Eau Rouge in the morning), suggest the driver adjust their in-sim brightness or monitor settings.

**Data sources:** NOAA Solar Position Calculator formulas (pure math, no API needed — just latitude, longitude, date, time, and the standard solar position equations). Track coordinates from the iRacing wiki + your existing `tracks.json`. Track headings derived from your SVG track map data.

**Commentary trigger:** `sun_glare_approaching` — fires when the driver is 3-5 seconds from a glare zone. Severity based on sun elevation angle (low sun = worse).

---

## 3. Atmospheric Density Engine

Air density affects engine power output. This is fundamental physics that real-world racing teams obsess over — and iRacing models it. But nobody surfaces it to the driver.

**The math:** Air density is a function of barometric pressure, temperature, humidity, and altitude. The SAE J1349 correction factor gives you the horsepower delta. A hot, humid day at Daytona (sea level, 95°F, 80% humidity) produces measurably less power than a cool morning at Road America (elevation 860ft, 55°F, 30% humidity).

**What it unlocks:**

- **Power correction factor per session.** "You're running at 97.2% theoretical power today. Brake 3 meters later than your reference lap from last week's cooler session." This is what drag racers call "density altitude" and it's the single most important variable they track.
- **Explains lap time deltas between sessions.** Driver sets a 1:32.4 on Monday night, can't match it on Saturday afternoon. Was it them, or was it the air? Show the atmospheric correction and separate driver performance from environmental conditions.
- **Setup recommendations.** Higher air density → more downforce from wings at the same angle. Lower density → less drag but less downforce. Surface this as a coaching call.

**Data sources:** iRacing exposes ambient temperature, track temperature, and weather conditions through the SDK. For the full calculation, cross-reference with OpenWeatherMap's API using the track's real-world coordinates to get barometric pressure and humidity (iRacing's weather model may not expose these directly). The SAE J1349 formula is public domain math.

**Commentary trigger:** `density_altitude_warning` — fires at session start when conditions deviate significantly from the driver's reference laps.

---

## 4. Circadian Performance Profiling

Research from Oxford, Harvard, and multiple sleep labs shows that cognitive performance varies 9-34% based on time of day — and it's different for morning people vs. evening people. Lane deviation in driving simulators is *worst* at 9 AM and *best* at 5 PM for the average person, but chronotype flips this entirely.

**The pitch:** Track the driver's race times, lap times, incident rates, and iRating changes by time of day over weeks and months. Build a personal circadian performance curve.

**What it unlocks:**

- **"Your danger hours."** Show the driver when they're statistically most likely to have incidents or lose iRating. "You've lost 147 iRating in sessions starting between 11 PM and 1 AM. Your incident rate is 3.2x higher than your afternoon sessions."
- **Race scheduling recommendations.** "Based on your last 60 sessions, your peak performance window is 3-7 PM. There's a VRS Sprint session at 4:15 PM today."
- **Fatigue-adjusted expectations.** Manage the driver's emotional state by setting realistic targets. "It's 11:30 PM. Your average lap time at this hour is 0.4s off your peak. A top-5 finish here is worth more than a win at 4 PM."

**Data source:** Already available — just cross-reference session timestamps (from iRacing API or local telemetry logs) with performance metrics you're already tracking. No external API needed.

**Commentary trigger:** `off_peak_racing` — gentle reminder when the driver is racing outside their statistical performance window.

---

## 5. Track Surface Evolution Intelligence

iRacing models dynamic track surfaces with rubber buildup, marble accumulation, and temperature evolution. The rubber laid down by every car in the session is tracked server-side and distributed to all clients. This data affects grip in real-time, but nobody surfaces it as coaching intelligence.

**What it unlocks:**

- **Grip evolution timeline.** "Track is still green — expect 2-3 seconds of improvement as rubber goes down in the first 10 laps." After 30 laps: "Racing line is fully rubbered. Time to push."
- **Alt-line advantage detection.** Late in long races, the primary racing line gets *hot*. Hot rubber is slippery. A driver who moves offline to cooler pavement can gain grip. "Lap 45: surface temperature on the racing line is elevated. Consider the outside line through turns 7-9."
- **Marble avoidance mapping.** Marbles accumulate off-line. When a driver goes defensive or makes an off, they drive through marbles. Warn them: "Marbles heavy on the inside of turn 3. Your next lap may have reduced grip — give the tires two corners to clean."

**Data source:** iRacing SDK `PlayerTrackSurface` telemetry variable, plus the session weather data. The dynamic track model data is partially exposed through the shared memory interface. Cross-reference with stint length and number of cars to estimate rubber evolution.

**Commentary triggers:** `track_green`, `rubber_building`, `surface_hot`, `marble_zone`.

---

## 6. Input Forensics — The Technique Fingerprint

You're already capturing throttle, brake, and steering inputs. But you're displaying them as live traces. The real value is in *analyzing the shape* of those traces over time.

**What it unlocks:**

- **Smoothness score.** Compute the second derivative of steering input. High-frequency oscillation = the driver is sawing at the wheel. Smooth, progressive application = control. Score it per corner, per lap, per session. Track improvement over weeks.
- **Trail braking grade.** The ideal brake trace shows a firm initial application that tapers linearly as steering increases. Detect whether the driver is threshold braking (flat rectangle — fast but risky), trail braking (ideal triangle), or lift-and-coast (no brake at all — leaving time on the table). Grade each corner A-F.
- **Throttle discipline index.** The sawtooth pattern (60% → 40% → 100%) means the driver is overdriving corner exit — applying throttle, getting wheelspin, lifting, reapplying. Count the oscillations. Fewer = better. Track over time.
- **Corner-by-corner technique comparison.** Store the input traces for the driver's best lap. On subsequent laps, overlay the live input against the reference. Fire commentary when they deviate: "You're braking 12 meters later than your best lap into turn 6. Trail brake is shorter — you're going to understeer mid-corner."
- **Muscle memory regression detection.** If a driver's smoothness score degrades over a stint, their muscles are fatiguing (or their focus is dropping). Cross-reference with the HRV data from the wearable integration for a complete picture.

**Data source:** Already in the telemetry pipeline. This is pure signal processing on existing data — FFT for smoothness, gradient analysis for trail braking, zero-crossing detection for throttle oscillation.

**Commentary triggers:** `smooth_lap` (positive), `sawing_detected`, `trail_brake_improving`, `technique_degrading`.

---

## 7. Corner-Specific Historical Coaching

You have track maps. You have per-corner telemetry. You have lap times and incident data. Combine them.

**What it unlocks:**

- **Per-corner incident heatmap.** "You've had 7 incidents at Spa turn 1 (La Source) in your last 20 races. Your success rate through Eau Rouge is 99.6%, but La Source is 94.2%." Show this on the track map as a color gradient.
- **Corner mastery progression.** Track the driver's speed through each corner over time. "Your minimum speed through Maggots-Becketts has increased by 4 mph over the last month. Your Copse entry speed is unchanged — that's where your time is."
- **Corner-specific coaching calls.** When approaching a corner where the driver historically struggles: "You tend to brake too late into turn 3. Your best laps have a brake point 8 meters earlier with a longer trail phase."
- **Track learning curve.** First time at a new track? Show estimated laps to competence based on the driver's learning rate at other tracks they've visited for the first time.

**Data source:** Sector tracker already detects corner boundaries. Just persist the per-corner telemetry snapshots to the Pro Drive database and build the analytics layer.

---

## 8. The Race Replay Narrator

After a race finishes, the driver has a complete telemetry log and a list of every commentary event that fired. Today, this data just... disappears.

**What it unlocks:**

- **Auto-generated race narrative.** Feed the event log to Claude with the lap-by-lap position data, incidents, pit stops, and key battles. Get back a 2-3 paragraph race report: "Started P8 on cold tires, lost two positions in the opening stint. Pitted early on lap 12 — an undercut that gained three positions. Battled with car #47 for P4 from laps 18-24, eventually making the pass at turn 6. Finished P3 after the leader's late incident." This is what F1 broadcasters do — and it's content the driver can share.
- **Highlight reel timestamps.** Identify the moments of highest drama (closest proximity events, biggest position changes, fastest laps) and output timestamps. If the driver is recording, they know exactly where to clip.
- **iRacing Weekly Recap email/Discord message.** Aggregate all races for the week into a personal newsletter. "This week: 4 races, +87 iRating, best finish P2 at Watkins Glen. Your tire management improved — average stint length up 3 laps. Your incident rate at Monza T1 is still 2x your average."

**Data source:** All already captured. This is a post-processing feature using Claude Haiku on the existing event log.

---

## 9. Opponent Intelligence Network

You're tracking opponents in real-time for pit strategy. Go further.

**What it unlocks:**

- **Driver reputation database.** Use the iRacing Data API to pull historical incident rates, iRating trends, and recent results for every driver in the session. Surface it in the leaderboard: a small icon next to drivers who have a statistically high incident rate. "Car #22 has a 4.1x incident rate. Give extra space."
- **Rivalry detection.** If two drivers have been in the same races 3+ times recently and had incidents together, flag it. "You and car #15 have had contact in 2 of your last 3 shared races."
- **Pace prediction.** Using historical lap times at this track for each opponent, predict who's going to be fast and who's going to fade. "Car #7 historically drops 0.8s/lap in the final 10 laps at this track — they're vulnerable late."
- **Driving style classification.** From telemetry proximity data over multiple races, classify opponents as aggressive, defensive, or clean. Show it on the spotter overlay.

**Data source:** iRacing Data API (session results, driver stats, historical lap times). The Python wrapper `iracingdataapi` on PyPI makes this straightforward. Store opponent profiles in Pro Drive's Neon database.

---

## 10. Track Geometry Intelligence

The TUMFTM racetrack database on GitHub has center lines, track widths, and optimal racing lines for 20+ circuits in open data. The f1-circuits repo has GeoJSON with altitude data. Cross-reference these with iRacing's laser-scanned track data.

**What it unlocks:**

- **Elevation-aware fuel and brake calculations.** Downhill braking zones need less brake pressure (gravity assists). Uphill sections burn more fuel. If you know the elevation profile, your fuel computer and brake coaching get more accurate.
- **Camber-aware tire coaching.** Off-camber corners eat tires differently than banked corners. If you know the camber angle, you can explain *why* the driver's inside-front tire is overheating at a specific corner.
- **Track comparison mode.** "Spa and Suzuka both have high-speed esses, but Spa's are uphill while Suzuka's are flat. Here's how to adjust your technique." Cross-track coaching based on geometric similarity.

**Data source:** [TUMFTM/racetrack-database](https://github.com/TUMFTM/racetrack-database), [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits). Your existing SVG track maps. iRacing's own track data (elevation is in the telemetry — `Alt` and `Lat`/`Lon` variables in the SDK).

---

## 11. Noise-Induced Fatigue Monitor

This one's weird and nobody's thinking about it. Sim racers wear headphones for hours. Engine noise in-sim can exceed 114 dB equivalent if the volume is cranked. Real-world research shows noise exposure causes cognitive fatigue independent of sleep or physical exertion — and at the volumes sim racers use, it's happening.

**What it unlocks:**

- **Session volume exposure estimate.** Based on session duration and the RPM/engine load telemetry (which directly correlates with in-sim volume), estimate cumulative noise exposure. Show a warning when the estimated exposure approaches harmful levels.
- **Break recommendations.** "You've been in high-RPM sessions for 3.5 hours today. Your estimated noise exposure is equivalent to standing at pit wall for a race. Consider a 20-minute break for auditory recovery."
- **Correlation with performance.** Track whether the driver's lap times degrade faster in sessions following long prior sessions. If they do, noise-induced fatigue is a candidate explanation.

**Data source:** Engine RPM (already in telemetry) as a proxy for volume. Session duration (already tracked). The decibel-to-duration hazard curves from NIOSH are public domain.

---

## 12. Hydration and Session Break Intelligence

A 2% drop in body mass from dehydration reduces muscular endurance by up to 20% and measurably impairs cognitive function. F1 drivers lose 2-3 kg per race in fluid. Sim racers in hot rooms during summer sessions are losing fluid too — they're just not measuring it.

**What it unlocks:**

- **Session break timer.** Based on session duration, time of day, and (if wearable is connected) heart rate trends, recommend hydration breaks. "You've been racing for 90 minutes. Performance data shows your lap times degrade 0.3s after 75 minutes without a break. Hydrate."
- **Caffeine timing.** Caffeine peaks at 60 minutes post-ingestion and has a 3-6 hour half-life. If the driver logs when they had coffee, model the caffeine curve and suggest optimal race timing. "Your caffeine peak is in 20 minutes — ideal time for your qualifying session."
- **Heat warning.** If room temperature data is available (smart home integration — you already have Homebridge), warn when ambient conditions will accelerate dehydration. "Room temperature is 28°C. Your typical performance cliff arrives 15 minutes earlier in these conditions."

**Data source:** Session timestamps (already have). Homebridge room temperature (already have the smart home integration). Wearable heart rate (from the Terra integration above). Caffeine modeling is pure math — first-order exponential decay.

---

## 13. The Setup Whisperer

Car setups in iRacing are opaque to most drivers. They copy a setup from a fast driver, go slower, and don't know why. The telemetry tells the story if you read it right.

**What it unlocks:**

- **Setup-to-telemetry correlation.** When the driver changes their setup and runs laps, compare the telemetry fingerprints. "After softening the rear ARB by 2 clicks, your corner entry oversteer reduced by 14% but your mid-corner minimum speed dropped 2 mph. Net: +0.15s per lap."
- **Setup change suggestions from driving data.** Detect chronic understeer (steering angle increasing through mid-corner without speed gain) or oversteer (throttle lifts with steering corrections on exit) and suggest setup changes. "Your last 10 laps show consistent entry oversteer into right-handers. Consider increasing front downforce or stiffening the front ARB."
- **Community setup comparison.** If multiple Pro Drive users share setups (opt-in), cluster them by driving style. Recommend setups from drivers with similar input patterns rather than similar iRating.

**Data source:** iRacing setup files (.sto format) are XML. Telemetry is already captured. The correlation engine is signal processing on existing data. Community features use the Pro Drive database.

---

## 14. Micro-Sector Analysis

You have sector timing. Go smaller. Way smaller.

**What it unlocks:**

- **25-meter segment timing.** Divide the track into segments small enough that each one is essentially one action: a brake zone, a turn-in, an apex, an exit, a straight. Time each one independently.
- **"Where exactly am I losing time?"** Instead of "you lost 0.3s in sector 2," say "you lost 0.18s in the braking zone for turn 7 and 0.12s on the exit of turn 8. Turns 6 and 9 were faster than your best."
- **Technique-specific delta.** The brake zone segment tells you about braking. The mid-corner segment tells you about line. The exit segment tells you about throttle application. Break the lap into *skill-specific* measurements.
- **Improvement priority ranking.** "Your biggest time gain opportunity is the turn 4 braking zone, where you're 0.22s off your best. Turn 11 exit is second at 0.15s. Everything else is within 0.05s."

**Data source:** `LapDistPct` from iRacing SDK gives continuous track position. Sample at the existing 100ms interval and you get a point roughly every 5 meters at racing speed. Plenty of resolution.

---

## 15. Race Craft Score

iRating measures results. Safety Rating measures not hitting things. Neither measures *how you race*.

**What it unlocks:**

- **Overtake quality score.** Clean pass completed with no proximity warning and no incident? That's a +2. Divebomb with contact? That's a -3. Track it.
- **Defensive driving score.** Did you hold position against a faster car for 3+ laps without incident? That's craft. Did you weave on the straight? That's not.
- **Race awareness index.** How often does the driver check mirrors (based on camera changes in replay data or head tracking if available)? How early do they react to cars alongside?
- **Composite race craft rating.** A single number that captures "is this driver good to race around?" — distinct from speed (iRating) and cleanliness (Safety Rating). Display it on the leaderboard next to the driver's name. Build a community where drivers compete on craft, not just pace.

**Data source:** Proximity telemetry (already captured), position change data (already captured), incident data (already captured), replay camera data (available from iRacing API). This is analytics on existing signals.

---

## Implementation Priority

If I had to pick three to build first:

1. **Input Forensics (#6)** — zero new data sources, pure signal processing on telemetry you already capture, immediate value for every single driver, and nobody else offers it
2. **Circadian Performance Profiling (#4)** — also zero new data sources, just timestamp cross-referencing, and the insight is genuinely surprising to drivers
3. **Corner-Specific Historical Coaching (#7)** — your sector tracker already does the hard part, this just persists and analyzes the data over time

The wearable integration (#1) and solar glare prediction (#2) are the flashiest and most marketable, but they require new integrations. Build the pure-telemetry features first — they prove the value of longitudinal data analysis before adding external sensors.

---

*Last updated: 2026-04-17*
