---
name: bundle-transfer
description: |
  How `.rcpdv` bundles move from the recording rig (Windows/overlay) to the editing machine (Mac). Two tiers — Bonjour/mDNS LAN discovery for same-network direct transfer, and Vercel Blob signed-URL relay through prodrive-server for cross-network. Use this skill when implementing or debugging the "Send to MacBook" feature in prodrive-windows or prodrive-overlay, the receiver service in prodrive-macos, the relay endpoints in prodrive-server, or when the user mentions "transfer", "send bundle", "Bonjour", "Blob", "race not showing up on Mac", or asks how the recording gets to the editor.
---

# Bundle Transfer: Windows → Mac

The recording rig is Windows. The editor lives on a MacBook. Bundles need to move between them with as little friction as possible. This skill captures the two-tier protocol: LAN-direct via Bonjour, internet-relay via Vercel Blob.

## The two tiers

| Tier | Path | When | Speed | Cost |
|---|---|---|---|---|
| 1 — LAN | Windows → Mac directly via HTTP | Both machines on same network | Local network speed (gigabit typical) | Free |
| 2 — Relay | Windows → Vercel Blob → Mac | LAN discovery fails (different network, VPN, hotel wifi) | Internet speed (bottleneck on upload) | $-per-GB on Blob |

The receiving Mac app prefers Tier 1 when available. The sender always tries Tier 1 first, falls back to Tier 2 on a timeout (configurable, default 5s).

The user-visible UX is a single "Send" button. The protocol is invisible.

## Tier 1 — LAN via Bonjour/mDNS

### The Mac advertises

The Mac editor app, when running, advertises a Bonjour service:

```
Service type:  _prodrive._tcp.
Service name:  "Prodrive Editor on <hostname>"
Port:          50403  (registered Prodrive port — see Note below)
TXT records:
  version=1
  userId=discord:123456789
  capabilities=receive
  fingerprint=<sha256 of mac's persistent device key, base64>
```

Implementation: Foundation `NetService` (deprecated but works) or Network framework `NWListener` + `Bonjour` (modern). Both are first-party Apple APIs. The advertisement starts when the user signs in and stops when they sign out.

### Windows discovers

The Windows app, when the user clicks "Send to Mac", browses for `_prodrive._tcp.`:

```
Browse domain: local.
Service type:  _prodrive._tcp.
Filter:        TXT.userId == self.userId  (don't show other users' Macs)
Timeout:       5000ms
```

Implementation: `Zeroconf.NET` (NuGet package) or `System.Net.NetworkInformation` for raw mDNS. Both work on Windows 10+. If the user has multiple Macs signed into the same account, show a picker.

### The transfer protocol

Once Windows resolves a peer, it POSTs the bundle:

```
POST http://<peer-ip>:50403/v1/bundles
Headers:
  Content-Type: application/octet-stream
  X-Prodrive-Bundle-Id: 01HFK6...                       (ULID from header)
  X-Prodrive-User-Id: discord:123456789
  X-Prodrive-Auth: <HMAC-SHA256(bundleId, sharedKey)>   (see Auth below)
  X-Prodrive-Sender: prodrive-windows/1.5.0
Body: <raw bundle bytes>
```

The Mac responds:

```
202 Accepted
{ "received": true, "bundleId": "01HFK6...", "savedAt": "/Users/.../Documents/RaceCor/sessions/01HFK6.rcpdv" }
```

For large bundles (>500MB), Windows uses chunked upload with `Transfer-Encoding: chunked`. Mac streams to disk via temp file + atomic rename on completion (`fs.rename` after `fsync`). Don't show partial bundles in the editor library.

### LAN auth — preventing untrusted devices

Both machines must be signed into the same Pro Drive account. Auth uses a **shared device key** derived from the user's Pro Drive bearer token:

```
sharedKey = HKDF-SHA256(userBearerToken, salt="prodrive-lan-v1", info="bundle-transfer")
```

Each device computes the same `sharedKey` from its own bearer token (since both are signed in as the same user, the input is identical). HMAC verification proves the sender holds a valid bearer token without sending it. Replay-protection: include `X-Prodrive-Timestamp` (unix ms) in the HMAC input; Mac rejects if older than 30s.

This is **not** a defense against a sophisticated attacker on the same LAN — it's defense against a roommate's laptop accidentally talking to your editor. Production-grade Pro Drive accounts on shared networks should use Tier 2.

### Discovery edge cases

- **Same Mac signed in twice (two apps running):** show both, label by app version.
- **mDNS suppressed by VPN:** Tailscale, NordVPN, etc. often block mDNS broadcasts. UI should detect after 5s and offer "use cloud transfer instead".
- **Mac asleep:** advertisement disappears. UI: "no Mac found — make sure your Mac is awake and signed into Pro Drive". Don't auto-fall-through to Tier 2 here — the user might just need to wake their Mac.
- **Multiple users on same network:** Bonjour is broadcast-public; the `userId` filter is what prevents cross-account leaks. Don't omit it.

> **Note on port 50403:** picked from IANA's user-port range (49152-65535), not registered. If you need to change it, update both apps and document the change here. Don't use a well-known port (e.g. 8080) — collisions with dev servers are likely.

## Tier 2 — Vercel Blob relay

When LAN fails, the path is Windows → server → Blob → Mac.

### Issuing the upload URL

Windows POSTs to prodrive-server:

```
POST /api/v1/bundles/upload-url
Auth: Bearer <user token>
Body: { bundleId, size, contentType: 'video/mp4' }
```

Server response:

```
200 OK
{
  "uploadUrl": "https://<blob>.public.blob.vercel-storage.com/bundles/...?token=...",
  "expiresAt": "2026-04-28T18:30:42Z",
  "transferId": "tx_01HFK7..."
}
```

The server uses Vercel Blob's [client uploads](https://vercel.com/docs/storage/vercel-blob/client-upload) — it generates a signed token, never proxies the bytes. Set blob path: `bundles/<userId>/<bundleId>.rcpdv` and TTL: 24h (server stores TTL metadata so cron can purge).

### Windows uploads directly to Blob

Multipart upload via the Blob client SDK or raw `PUT` with `x-vercel-blob-token` header. Windows polls progress and reports back to the user. Server is not in the byte path.

On completion, Windows POSTs:

```
POST /api/v1/bundles/transfers/:transferId/complete
Auth: Bearer <user token>
Body: { blobUrl, sha256 }
```

### Server notifies the Mac

Server inserts a row in `bundle_transfers` table and sends an SSE event on the Mac's `/api/v1/bundles/events` stream (the Mac maintains a persistent SSE connection while the app is open):

```
event: bundle.ready
data: {"transferId":"tx_01HFK7...","bundleId":"01HFK6...","downloadUrl":"https://...","expiresAt":"..."}
```

If the Mac is offline, the row stays. On next connect, server replays unfetched transfers. Once the Mac confirms fetch, server marks the row complete and a cron job purges the Blob entry within an hour.

### Mac downloads + verifies

Mac fetches `downloadUrl` directly (CDN-served, fast), streams to disk, verifies SHA-256 against the server-reported value, then POSTs:

```
POST /api/v1/bundles/transfers/:transferId/fetched
Auth: Bearer <user token>
```

Server marks complete, schedules Blob deletion. Done.

### Cleanup contract

- **Blob entries auto-expire after 24h** even if no fetch happens (set TTL on creation; verify with `vercel-blob list` periodically).
- **Failed transfers (no `complete` POST)** don't get an SSE notification, but the upload-token still ages out — eventually Vercel Blob deletes via TTL.
- **Server's `bundle_transfers` table** is append-only. Status field flips through `pending → uploaded → notified → fetched → expired`. Monthly cron prunes rows older than 90 days.

## Common bugs and pitfalls

### Bug — bundles arrive at Mac but don't appear in editor

Mac downloads to `~/Documents/RaceCor/sessions/.tmp/<id>.rcpdv` then atomic-renames to `<id>.rcpdv`. If the editor's library scanner uses `FSEvents` and ignores hidden files, partial uploads in `.tmp/` don't trigger a refresh — but the rename should. If they don't appear: check that the rename happened (FSEvents has known issues with `rename(2)` on case-insensitive HFS+; use `replaceItemAt` on Swift instead).

### Bug — LAN discovery works once, then fails

The Mac's Bonjour advertisement can collide if two instances run. `NetService` allows duplicates — they'll both register, sender sees two peers. Resolve by including PID in service name: `"Prodrive Editor on <hostname>-<pid>"`. Or use `NWListener` which auto-detects port-in-use.

### Bug — Tier 2 transfer hangs at "Uploading 99%"

Vercel Blob client uploads complete the byte transfer before the SDK promise resolves (it's waiting for a PUT response that finalizes the blob). On flaky networks this can take 30-60s after bytes are sent. Show "Finalizing..." instead of stuck-99%.

### Bug — same bundle transferred twice produces two library entries

Use `bundleId` (ULID from the bundle's own header) as the dedup key on the Mac. If a bundle with the same ULID is received twice, overwrite the existing file (the second copy is presumably a re-upload after a corruption fix).

## When NOT to use this skill

- Server-stored historical libraries (the deferred "where do bundles live long-term" question — see `video-editor-plan.md` open questions). That's a separate design.
- iCloud Drive / Dropbox sync — could work as a third tier but adds account-setup UX. Out of scope unless the user explicitly asks.
- WebRTC peer-to-peer — considered, rejected for complexity. Bonjour + Blob covers same-network and cross-network cleanly.

## Companion docs

- [`race-bundle-format/SKILL.md`](../race-bundle-format/SKILL.md) — What's inside the bundle being transferred
- [`prodrive-context/video-editor-plan.md`](../../prodrive-context/video-editor-plan.md) — Why this exists, where it slots in
