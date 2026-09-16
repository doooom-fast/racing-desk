# K10 Plugin MCP Server

Part of the [RaceCorProDrive](https://github.com/alternatekev/media-coach-simhub-plugin) sim racing platform. An MCP (Model Context Protocol) server that provides structured access to the RaceCorProDrive SimHub plugin's C# source code, strategy engine, commentary dataset, telemetry schema, and HTTP API surface.

## Overview

This server exposes 8 tools for reading and analyzing:
- **Commentary topics**: Full dataset of race commentary triggers, conditions, and prompts
- **Trigger conditions**: All unique trigger types and their examples
- **Telemetry schema**: Properties available from TelemetrySnapshot
- **Plugin source files**: Engine and model classes
- **HTTP API properties**: All JSON properties exposed by the HTTP state server
- **Dataset files**: Commentary fragments, sentiments, and other JSON datasets

## Configuration

The server uses environment variable `K10_PLUGIN_ROOT` to locate plugin files. If not set, it defaults to:
```
racecor-plugin
```

To use a custom location:
```bash
export K10_PLUGIN_ROOT=/path/to/racecor-plugin
npm start
```

## Tools

### `list_commentary_topics`
Lists all commentary topics with optional regex filtering.

**Parameters:**
- `filter` (optional): Regex pattern to match topic ID, category, or title

**Returns:**
- List of topics with ID, category, title, sentiment, severity, cooldown, and triggers
- Version and category metadata

### `get_commentary_topic`
Retrieves the complete definition of a single topic.

**Parameters:**
- `topicId` (required): The topic ID (e.g., "spin_catch")

**Returns:**
- Full topic object including all commentary prompts and trigger details

### `list_trigger_conditions`
Enumerates all unique trigger condition types used across the dataset.

**Returns:**
- Set of condition types with example topics that use each condition

### `get_telemetry_schema`
Extracts all properties from TelemetrySnapshot.cs.

**Returns:**
- List of telemetry properties with their C# types

### `get_plugin_source`
Reads a specific source file from the plugin directory.

**Parameters:**
- `filename` (required): Path relative to plugin root (e.g., "Plugin.cs" or "Engine/TriggerEvaluator.cs")

**Returns:**
- File contents, line count, and full path

### `list_plugin_files`
Lists all .cs files in the plugin source directory.

**Returns:**
- Count and sorted list of C# source files

### `get_dataset_file`
Reads and parses a JSON dataset file.

**Parameters:**
- `filename` (required): Name of the dataset file (e.g., "commentary_topics.json", "sentiments.json")

**Returns:**
- Parsed JSON data and file path

### `list_http_properties`
Extracts all HTTP JSON properties exposed by the plugin's HTTP state server.

**Returns:**
- Sorted list of all property keys published via the HTTP API (parsed from Plugin.cs)

## Building

```bash
npm install
npm run build
```

## Running

```bash
npm start
```

The server listens on stdin/stdout for MCP protocol messages.

## Usage Example

With Claude Code:
```
claude
> I want to understand the spin_catch commentary topic
> Use the K10 Plugin MCP to get the full topic definition
```

This will call the `get_commentary_topic` tool with topicId "spin_catch" and return the complete trigger conditions, commentary prompts, and metadata.

## Implementation Notes

- All file paths are validated to prevent directory traversal attacks
- C# properties are extracted via regex from source files
- JSON files are parsed with error handling
- The server supports the full MCP protocol with tool listing and calling
- Telemetry property parsing reads the public property declarations from TelemetrySnapshot.cs
- HTTP properties are extracted by finding all `Jp(sb, "..."` calls in Plugin.cs
