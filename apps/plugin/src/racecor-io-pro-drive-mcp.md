# RaceCorProDrive SimHub Plugin

## Overview

These instructions will cover the creation of a duo of tools that will serve me while sim-racing. The tools will use real-time streaming data to prompt me to make race- and car-relevant verbal comments on-camera for youtube streaming and recording. There will be a plugin that runs on the server, and a client that acts as a visual dashboard, alerting me to state changes while driving in non-obtrusive but noticeable manner.

It will function as a SimHub plugin:

- digesting racing data (primarily iRacing, but also Automobilista 2 and Assetto Corsa)
- comparing that real-time data stream to a database of common sim-racing youtuber commentary (data set to be provided in the format of youtube channel links)
- deciding what i should comment on in that moment, at a maximum rate of 1 suggestion every two minutes
- displaying the comment suggestion on-screen as a sim-hub dashboard with large white text on a black background, in wide-screen format

## Intructions

### Dataset Generation

#### Commentary Digestion

1. Visit the provided youtube links in the next section
2. Use video titles and descriptions to determine which videos on the channel are commentary on cars, games, or in-race commentary. Ignore videos about real-life racing, hardware reviews, life updates, and other non-sim-racing content.
3. Using the transcripts for each video, create a list of commentary topics, including the timestamp of its inclusion in the video if available. You can suggest others, but please also keep in mind the following:

- Hardware & hardware settings (force feedback, braking force curves, throttle curves, steering wheels, pedal hardware, shifters, handbrakes)
- Game look and feel (force feedback from a software standpoint, FOV, menu screens, resolution, video fx, performance, engine sounds, tire sounds)
- Car response (grip, tire temps, traction control, ABS, shift speed, brake pressure, acceleration, braking time, cornering)
- Racing experience (other drivers, netcode, points systems, passing other drivers, being passed by other drivers, yellow flags, mistakes, black flags, warnings, track limits)

4. Using the transcripts for each video, create a list of sentiments and often-repeated phrases to express them
5. Save these these lists to this directory in a place and format that can be digested later by a SimHub plugin

##### YouTube commentary links

- https://www.youtube.com/@Jimmy_Broadbent
- https://www.youtube.com/@mgcharoudin
- https://www.youtube.com/@Jaaames
- https://www.youtube.com/@TraxionGG
- https://www.youtube.com/@JustHunGaming
- https://www.youtube.com/@ProjectSimRacing
- https://www.youtube.com/@JUSTSIMRACINGYT
- https://www.youtube.com/@Redd500Gaming

### SimHub Digestion

Due to the crucial nature of SimHub in this workflow, I'll need you to gain an in-depth understanding of SimHub, a client/server software that most racing simulators and hardware both talk to, with a wide range of plugins available to act on this data api, in ways visual, audio, motion, and more.

1. Digest and create a contex for the SimHub API using the following URL: https://github.com/SHWotever/SimHub/wiki
2. Follow all revelant links, including reading the source code in Github
3. Find all existing plugins that do pieces of this project, if any, suggest them back to me, and assume they're installed when you begin development on the plugin and dashboard.

### SimHub Plugin Creation

1. Using the lists of commentary topics and sentiments, determine the best moments in-game to mention which topics.
2. Find other plugins for SimHub that act on real-time data in interesting ways, and try to learn from them for this.
3. Each moment should consist of:

- A data point to watch
- Value ranges during which to react, combined with video timestamps for more relevant suggestions
- A short message (1-2 sentences) to prompt me to start talking, consisting of the event description as defined by the topics list and a sentiment as described by the sentiment list

4. Encode this system as a SimHub server plugin that can be run in real-time in conjunction with racing simulators
5. Provide an additional SimHub dashboard, that is visually very simple, using a nice modern font. Set the type proprtional to the window size, with a black background and white text. Center the type vertically and horizontally no matter the length of the text, such that any text you put there can be seen. Clear each message after 60 seconds. Add a setting to the dashboard to determine polling/update rate for quicker/slower commentary suggestions.

### Relevant Plugins

- PostItNoteRacing — iRacing text display plugin, closest to what we're building
- DahlDesignProperties — rich iRacing property exposure
- CalcLngWheelSlip — good physics calculation pattern reference

Plugin (plugin/)

| File                        | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Plugin.cs                   | Main class — wires lifecycle, registers 6 properties + 3 actions + 1 event                  |
| Engine/CommentaryEngine.cs  | Core logic — loads topics, evaluates triggers, enforces cooldowns, manages prompt lifecycle |
| Engine/TelemetrySnapshot.cs | Captures a frame of normalized + raw iRacing telemetry                                      |
| Engine/TriggerEvaluator.cs  | Evaluates all 19 trigger condition types against current/previous snapshot                  |
| Models/CommentaryTopic.cs   | Deserializes commentary_topics.json                                                         |
| Settings.cs                 | Persisted settings (interval, duration, categories, topics path)                            |
| Control.xaml/.cs            | WPF settings panel with sliders, checkboxes, and file browser                               |

Dashboard properties exported:

- RaceCorProDrive.Plugin.CommentaryText — full prompt text (with optional topic title)
- RaceCorProDrive.Plugin.CommentaryVisible — 1/0, controls panel visibility
- RaceCorProDrive.Plugin.CommentaryCategory — for color-coding
- RaceCorProDrive.Plugin.CommentaryTopicTitle — short topic name
- RaceCorProDrive.Plugin.CommentarySecondsRemaining — countdown for progress bar

Dashboard (dashboard/RaceCorProDrive.simhubdash)

- Black background, white centered text, proportional font size
- Thin color-coded countdown bar at the bottom (color varies by category)
- Auto-hides when prompt clears after 60s

Install Instructions

1. Open plugin/RaceCorProDrive.Plugin.sln in Visual Studio on Windows
2. Set the SIMHUB_PATH environment variable to your SimHub install folder (default: C:\Program Files (x86)\SimHub\)
3. Build in Release|x64 — DLL deploys directly to SimHub, dataset is copied alongside it
4. In SimHub → Additional Plugins → enable RaceCorProDrive, then restart SimHub
5. Copy the dashboard/RaceCorProDrive/ folder into SimHub's Dashboards folder, then open it via Dash Studio
6. Launch iRacing and drive

## Updating Haiku Support

It seems like live Haiku integration isn't going to be a feasible solution. Update the architecture proposal to instead use Haiku to generate a much-expanded deterministic list of expressions to use instead. consider breaking sentences up into parts, to be placed together later for more nuanced expressions. Possibly look into how Crew Chief accomplishes this.

Next, investigate the actual data points being used, some of them are inverted, ie, you're saying my tires are at 98% worn when they're at 98% used (ie, 2% worn). update data thresholds to more realistic ones, and consider investigating how other simhub plugins set their data this way, in particular, crew chief v4.

once you've planned this out and updated racecor-plugin/docs/PLUGIN_FEEDBACK.md, use a sub-agent running sonnet to fulfill the requirements.

## Updating To Include Light Control

once sonnet is running the changes above, investigate and document how to write a homebridge plugin that will tell my apple home-connected lights what color to be based on a simpler set of data provided by the plugin.

we will want options for:

- flags only: only update the lights to reflect flag state
- events only: only update the lights to reflect track and other driver state (red when a driver is close, green when no one is around, yellow when debris, etc)
- all color options
- enable blinking (determine which color options best benefit from a blinking effect and enable its turning on/off)

update claude.md with instructions on both how to create a new homebridge plugin, the source of which to add to this as a monorepo, and how to update this plugin to talk to homebridge.

Once the instructions for this are fleshed out, create a new sonnet sub-agent to perform the tasks.
