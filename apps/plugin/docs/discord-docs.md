# Documentation Index

All project documentation on GitHub. Links go to the `main` branch.

---

## Project Overview

- [README](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/README.md) — project overview, architecture, and getting started
- [AI Strategist Design](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/AI_STRATEGIST_DESIGN.md) — design doc for the AI race strategist feature
- [Missing Data Audit](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/docs/missing-data-audit.md) — audit of telemetry fields and iRacing SDK property mapping
- [MCP Broadcaster Spec](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/k10-media-broadcaster-plugin-mcp.md) — high-level architecture for real-time commentary

---

## Dashboard Overlay (Electron HUD)

- [README](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-overlay/README.md) — overlay overview and Electron architecture
- [Dashboard MCP Reference](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-overlay/docs/DASHBOARD_MCP.md) — CSS/JS module structure and module loading
- [Modularization Summary](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-overlay/docs/MODULARIZATION_SUMMARY.md) — how the monolithic dashboard was refactored into modules
- [CrewChief TTS Research](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-overlay/docs/crewchief-tts-research.md) — research on voice systems and text-to-speech commentary

---

## SimHub Plugin (.NET)

- [Plugin Architecture](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/SIMHUB_PLUGIN.md) — .NET Framework 4.8 WPF plugin structure
- [Commentary Engine](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/COMMENTARY_ENGINE.md) — trigger evaluation, prompt assembly, color resolution pipeline
- [Datasets](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/DATASETS.md) — data files powering commentary (topics, fragments, sentiments)
- [Development Guide](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/DEVELOPMENT.md) — building from source and contributor workflow
- [Testing](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/TESTING.md) — test suite: C# unit tests, Python validation, Homebridge tests
- [Screenshot Testing Spec](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/SCREENSHOT_TESTING_SPEC.md) — automated visual regression testing
- [Plugin Feedback](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/docs/PLUGIN_FEEDBACK.md) — behavior observations and improvement notes
- [SimHub SDK References](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/lib/simhub-refs/README.md) — committed SDK DLLs for compilation
- [Test Project](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/racecor-plugin/simhub-plugin/tests/RaceCorProDrive.Tests/README.md) — NUnit test project for triggers, fragments, and datasets

---

## Homebridge Plugin (HomeKit Lighting)

The Homebridge plugin lives in its own repo: **[k10-motorsports/prodrive-homebridge](https://github.com/k10-motorsports/prodrive-homebridge)**.

- [README](https://github.com/k10-motorsports/prodrive-homebridge/blob/main/README.md) — telemetry-to-HomeKit smart light mapping
- [Implementation Summary](https://github.com/k10-motorsports/prodrive-homebridge/blob/main/docs/HOMEBRIDGE_IMPLEMENTATION.md) — platform plugin architecture and TypeScript structure
- [Plugin Architecture](https://github.com/k10-motorsports/prodrive-homebridge/blob/main/docs/HOMEBRIDGE_PLUGIN.md) — detailed architecture with source file layout
- [HomeKit Setup Guide](https://github.com/k10-motorsports/prodrive-homebridge/blob/main/docs/HOMEKIT.md) — connecting HomeKit lights with prerequisites and setup

---

## MCP Agents

- [Broadcaster Agent README](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/agents/k10-broadcaster/README.md) — MCP server for dashboard overlay source access
- [Broadcaster Checklist](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/agents/k10-broadcaster/CHECKLIST.md) — implementation and build verification checklist
- [Broadcaster Deployment](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/agents/k10-broadcaster/DEPLOYMENT.md) — deployment guide and integration instructions
- [Broadcaster Index](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/agents/k10-broadcaster/INDEX.md) — quick reference to related docs
- [Broadcaster Quickstart](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/agents/k10-broadcaster/QUICKSTART.md) — getting started with the MCP server
- [Plugin Agent README](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/src/agents/k10-plugin/README.md) — MCP server for SimHub plugin source and strategy engine

---

## Web Application (Next.js)

- [README](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/web/README.md) — Next.js 16 marketing site and members area
- [Agents Guide](https://github.com/alternatekev/media-coach-simhub-plugin/blob/main/web/AGENTS.md) — Next.js 16 API changes and breaking changes reference
