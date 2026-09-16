---
name: race-bundle-format
description: |
  The `.rcpdv` portable bundle format — a single-file container combining race video and `.telemetry.jsonl` sidecar via an ISO-BMFF `uuid` box. Use this skill whenever you need to write, read, validate, or extend the bundle: when prodrive-overlay finalizes a recording, when prodrive-windows or prodrive-macos opens a session for editing, when prodrive-ios/tvos plays a bundle locally, or when designing a new field that needs to ride along with the video. Also trigger when the user mentions "bundle", "race file", "video+telemetry", ".rcpdv", "uuid box", or asks how telemetry travels with video. If anyone is reading or writing the byte layout of session files, use this skill.
---

# `.rcpdv` Portable Bundle Format

A `.rcpdv` (RaceCor Pro Drive Video) is a standard MP4 file with telemetry attached as a private `uuid` box. The bytes underneath are valid ISO-BMFF — QuickTime, VLC, ffmpeg, and AVPlayer can all open and play a `.rcpdv` if explicitly pointed at it (the user has to choose "Open With" since `.rcpdv` defaults to the Pro Drive editor). The telemetry rides along invisibly. YouTube and other public sinks ignore the box on upload — the public copy is a clean MP4, the local archive keeps the data.

This skill captures the spec. Anyone reading or writing bundles needs to follow it exactly so all platforms agree.

## How to Use This Skill

1. Read this file first for the byte layout and schema
2. For language-specific code samples, read `references/parsers.md`
3. When extending the schema (adding a field), bump `schemaVersion` and update both writers (overlay, windows-recorder) and all readers (macos, windows, ios, tvos editors) — see "Versioning rules" below

## Why a custom extension over a hidden MP4 box

| Option considered | Why rejected |
|---|---|
| Zip wrapper (`.race`) | Re-zipping H.264 video gains nothing. Two-step extract before any tool can read frames. |
| MKV with attachment | Matroska supports binary attachments natively, but MKV is poorly supported on iOS/tvOS/Quick Look. Editing tools, YouTube, and Apple ecosystem all prefer MP4. |
| Sidecar pair convention | Two files drift. Users move/rename one, lose the other. Email/AirDrop loses the pair. |
| Custom track in MP4 | Possible (TTML metadata track) but heavyweight, requires every player to grok the codec, harder to author. |
| Plain `.mp4` extension with embedded `uuid` box | Considered, but loses brand identity — `.mp4` files are indistinguishable in Finder/Explorer from any other video. Default-open behavior cannot be set without affecting all MP4 files on the system. |
| **`.rcpdv` extension over MP4 + `uuid` box** ✓ | Standard ISO-BMFF mechanism for private data. Unknown UUIDs are silently ignored by every conformant parser. Single-file. Custom extension means custom file icon + default app handler (Pro Drive editor) without disturbing user's MP4 associations. Bytes still play in any video tool when explicitly opened. |

## File extension and OS registration

The `.rcpdv` extension is what users see in Finder, Explorer, and AirDrop dialogs. The bytes are still ISO-BMFF / MP4 underneath — every video tool that can open `.mp4` can open `.rcpdv` if pointed at the file directly. The custom extension exists for branding, custom icons, and to make Pro Drive the default open-with handler without touching the user's `.mp4` file associations.

### macOS — UTI

Each app that handles `.rcpdv` declares the UTI in its `Info.plist` under `UTExportedTypeDeclarations`:

```xml
<key>UTExportedTypeDeclarations</key>
<array>
  <dict>
    <key>UTTypeIdentifier</key>
    <string>racing.k10motorsports.prodrive.rcpdv</string>
    <key>UTTypeDescription</key>
    <string>RaceCor Pro Drive Bundle</string>
    <key>UTTypeConformsTo</key>
    <array>
      <string>public.mpeg-4</string>
      <string>public.movie</string>
      <string>public.audiovisual-content</string>
    </array>
    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key>
      <array><string>rcpdv</string></array>
      <key>public.mime-type</key>
      <array><string>video/mp4</string></array>
    </dict>
    <key>UTTypeIconFile</key>
    <string>RcpdvDocument</string>
  </dict>
</array>
```

The `UTTypeConformsTo` chain is critical — declaring conformance to `public.mpeg-4` lets QuickTime, VLC, ffmpeg, and `AVAsset` accept a `.rcpdv` URL without complaint. AVPlayer, Quick Look, and `qlmanage -p` can preview a `.rcpdv` when explicitly pointed at it.

Add `CFBundleDocumentTypes` to register the editor as a handler:

```xml
<key>CFBundleDocumentTypes</key>
<array>
  <dict>
    <key>CFBundleTypeName</key>
    <string>RaceCor Pro Drive Bundle</string>
    <key>CFBundleTypeRole</key>
    <string>Editor</string>
    <key>LSHandlerRank</key>
    <string>Owner</string>
    <key>LSItemContentTypes</key>
    <array><string>racing.k10motorsports.prodrive.rcpdv</string></array>
  </dict>
</array>
```

`LSHandlerRank=Owner` means Pro Drive is the canonical default; users can still override per-file via "Get Info → Open With".

### Windows — File association

Inno Setup snippet (matches the existing installer pattern in `prodrive-windows`):

```ini
[Registry]
Root: HKCR; Subkey: ".rcpdv"; ValueType: string; ValueName: ""; ValueData: "ProDrive.Bundle"
Root: HKCR; Subkey: ".rcpdv"; ValueType: string; ValueName: "PerceivedType"; ValueData: "video"
Root: HKCR; Subkey: ".rcpdv"; ValueType: string; ValueName: "Content Type"; ValueData: "video/mp4"
Root: HKCR; Subkey: "ProDrive.Bundle"; ValueType: string; ValueName: ""; ValueData: "RaceCor Pro Drive Bundle"
Root: HKCR; Subkey: "ProDrive.Bundle\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\RaceCorProDrive.exe,1"
Root: HKCR; Subkey: "ProDrive.Bundle\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\RaceCorProDrive.exe"" ""%1"""
```

`PerceivedType=video` means Windows treats the file as video for indexing, the file picker's "Videos" filter, and Photos app integration. `Content Type=video/mp4` ensures HTTP servers (and any tool reading the registry to determine MIME) report the right type.

### MIME type

For HTTP transfer (`POST /v1/bundles`, Vercel Blob upload, YouTube upload), always use `Content-Type: video/mp4`. Do not invent a custom MIME — `video/mp4` is what the bytes actually are, and YouTube / Vercel Blob / curl all do the right thing with it.

### File icon

A custom 1024×1024 icon (with @1x, @2x, @3x variants on Apple, multi-size .ico on Windows) lives in:
- macOS: `Resources/Assets.xcassets/RcpdvDocument.iconset/`
- Windows: `Resources/RcpdvDocument.ico`

Design constraint: the icon should clearly indicate "video file" (frame motif, play triangle) plus the Pro Drive accent (k10 red). Falling back to the generic video icon is acceptable in dev but not in shipped builds.

## The byte layout

A `.rcpdv` is a normal MP4 with one extra top-level box:

```
[ftyp]   — File type box (standard MP4)
[moov]   — Movie box (standard MP4: video + audio tracks)
[mdat]   — Media data box (standard MP4: encoded frames)
[uuid]   — ★ Prodrive telemetry box (this is ours)
```

Order matters less than presence — most writers append the `uuid` box last, but it can appear anywhere top-level after `ftyp`. Readers should scan all top-level boxes for the matching UUID rather than assuming position.

### The Prodrive UUID

```
PRODRIVE_TELEMETRY_UUID = 50 52 4F 44 52 49 56 45 - 54 4C 4D 59 - 00 00 - 00 01
                          P  R  O  D  R  I  V  E    T  L  M  Y    version
```

Stored as a 16-byte `uuid_t` in the box header. The version bytes (last two) are reserved for future format-incompatible changes — a parser seeing an unknown version should refuse to load, not silently misread.

### The box payload

The `uuid` box payload is a single JSON header followed by gzipped JSONL bytes:

```
[4 bytes BE]  headerLen
[headerLen]   header JSON (UTF-8, no BOM)
[remaining]   gzip-compressed JSONL telemetry
```

Header schema (`headerLen` bytes of UTF-8 JSON):

```json
{
  "schemaVersion": 1,
  "bundleId": "01HFK6...",                    // ULID — globally unique per bundle
  "createdAt": "2026-04-27T18:30:42.123Z",    // ISO 8601 with millis
  "createdBy": {
    "app": "prodrive-overlay",                // or "prodrive-windows", "prodrive-macos"
    "version": "1.5.0",                       // app version
    "platform": "win32-x64"                   // node platform string
  },
  "race": {
    "title": "Spa 24h — Stint 3",            // user-visible label
    "track": "Spa-Francorchamps Grand Prix",
    "car": "BMW M Hybrid V8",
    "series": "iRacing 24 Heures du Mans",
    "sessionType": "race",                    // "practice"|"qualify"|"race"
    "sessionId": "iracing:2026:24h-spa:3",   // canonical ID for cross-system join
    "userId": "discord:123456789"             // Pro Drive user
  },
  "video": {
    "duration": 5400.123,                     // seconds (matches MP4 mvhd duration)
    "frameRate": 60,                          // nominal — actual fps in moov
    "width": 1920,
    "height": 1080,
    "codec": "h264"                           // for quick filter without parsing moov
  },
  "telemetry": {
    "frameCount": 324007,                     // count of JSONL lines
    "frameRate": 60,                          // sidecar capture rate
    "schema": "prodrive-telemetry-v3",       // matches plugin's sidecar schema
    "compressedBytes": 12345678,             // gzipped size
    "uncompressedBytes": 134567890           // for streaming reads
  }
}
```

After the header, the remaining bytes are gzip-compressed JSONL — one telemetry frame per line, gzip-deflated as a whole stream (not per-line). Use Node's `zlib.gunzip`, Swift's `Compression.zlib`, or .NET's `GZipStream`.

## Writing a bundle

Sketch (Node, using `mp4box.js`):

```js
import MP4Box from 'mp4box';
import { gzipSync } from 'zlib';
import { ulid } from 'ulid';

function writeRaceBundle(videoPath, telemetryJsonlPath, outputPath, raceMeta) {
  const telemetry = readJsonlAsBuffer(telemetryJsonlPath);
  const compressed = gzipSync(telemetry);

  const header = JSON.stringify({
    schemaVersion: 1,
    bundleId: ulid(),
    createdAt: new Date().toISOString(),
    createdBy: { app: 'prodrive-overlay', version: pkg.version, platform: process.platform },
    race: raceMeta,
    video: probeVideo(videoPath),  // ffprobe → duration, codec, dimensions
    telemetry: {
      frameCount: countLines(telemetry),
      frameRate: 60,
      schema: 'prodrive-telemetry-v3',
      compressedBytes: compressed.length,
      uncompressedBytes: telemetry.length,
    },
  });

  const headerBuf = Buffer.from(header, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);

  const payload = Buffer.concat([lenBuf, headerBuf, compressed]);

  // Append uuid box to the end of the existing MP4
  const videoBytes = readFileSync(videoPath);
  const uuidBox = makeUuidBox(PRODRIVE_TELEMETRY_UUID, payload);
  writeFileSync(outputPath, Buffer.concat([videoBytes, uuidBox]));
}
```

A `uuid` box header is `[size:4][type='uuid':4][uuid:16][payload]`. `size` is the total box length including the 8-byte size+type prefix and the 16-byte UUID.

## Reading a bundle

Don't assume the `uuid` box position. Walk top-level boxes:

```js
function readRaceBundle(path) {
  const fd = openSync(path, 'r');
  const offset = scanTopLevelBoxes(fd, (boxType, boxStart, boxSize) => {
    if (boxType === 'uuid') {
      const uuid = readBytes(fd, boxStart + 8, 16);
      if (uuidEquals(uuid, PRODRIVE_TELEMETRY_UUID)) {
        return boxStart + 24;  // skip [size][type][uuid]
      }
    }
  });

  if (!offset) throw new Error('Not a Prodrive bundle (no telemetry box)');

  const headerLen = readUInt32BE(fd, offset);
  const header = JSON.parse(readBytes(fd, offset + 4, headerLen).toString('utf8'));
  const compressedStart = offset + 4 + headerLen;
  const compressed = readBytes(fd, compressedStart, header.telemetry.compressedBytes);
  const jsonl = gunzipSync(compressed).toString('utf8');

  return { header, frames: jsonl.split('\n').filter(Boolean).map(JSON.parse) };
}
```

For streaming reads on iOS/tvOS (large bundles), prefer `AVAssetCustomDataSource` to seek to the box without loading the full file.

## Versioning rules

The bundle format is shared across six writers/readers. Forward-compatibility matters.

1. **`schemaVersion` is the source of truth.** Bump on any breaking change to header fields or payload layout.
2. **Adding a new optional field at the top level** — no version bump. Old readers ignore unknown keys (per the JSON spec).
3. **Adding a required field** — bump `schemaVersion`. Old readers refuse to load (forces user upgrade).
4. **Removing or renaming a field** — bump `schemaVersion`. Old writers will keep producing the old shape, so readers should support N and N-1 simultaneously for one release.
5. **Changing the gzip stream format or adding a new compression mode** — bump version, plus add a `telemetry.compression` field.
6. **The 16-byte UUID's last 2 bytes carry a format-version stamp** — only bump if the box layout itself is incompatible (e.g. switching from `[len][header][gzip]` to a TLV format). This is a much heavier change than `schemaVersion` and should be avoided.

When bumping, update **all** of:
- `prodrive-overlay/src/recording/bundle-writer.ts`
- `prodrive-windows/apps/native/Recording/BundleWriter.cs`
- `prodrive-macos/apps/native/Editor/BundleReader.swift`
- `prodrive-ios/apps/native/Player/BundleReader.swift`
- `prodrive-tvos/apps/native/Player/BundleReader.swift`
- This skill's "header schema" section

## When NOT to use this skill

- Live SimHub plugin telemetry over the WS port — that's the `prodrive-telemetry-v3` wire format, not the bundle. Different concern.
- Server-side analysis or storage formats — bundles are device-local. The server stores YouTube URL + race metadata, never bundle bytes.
- Pure video transcoding (re-encoding for a different codec) — bundle format is preserved through transcode if the tool knows about the `uuid` box; otherwise it's stripped. Document this in tool docs, don't put it here.

## Companion docs

- [`docs/video-editor-plan.md`](../../../docs/video-editor-plan.md) — Why this format exists, where it slots in
- [`bundle-transfer/SKILL.md`](../bundle-transfer/SKILL.md) — How bundles move between machines
- [`native-video-editor/SKILL.md`](../native-video-editor/SKILL.md) — How the editor consumes bundles
