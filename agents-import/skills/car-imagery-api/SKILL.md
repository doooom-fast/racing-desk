---
name: car-imagery-api
description: |
  How web and native apps fetch car photography from the prodrive car-imagery API at
  https://images.racecor.io — the manufacturer-press + Wikimedia (CC) race-car image library that
  REPLACES Unsplash for commentary backgrounds, car detail heroes, and any car-image usage across
  the apps. Covers the REST endpoints (/api/v1/cars, /cars/{key}, /cars/{key}/hero, /cars/{key}/random,
  /manifest), resolving an iRacing car name → car key, the 480/1280/2560 size tiers, required
  attribution, and ready-to-use TypeScript and Swift integration patterns. Use this skill when
  building or wiring car-image features in prodrive-server (web), prodrive-ios / prodrive-macos /
  prodrive-tvos (Swift), or prodrive-windows / prodrive-overlay, when replacing Unsplash, or when the
  user mentions "car image", "car photo", "commentary background", "hero image", "images.racecor.io",
  "getCarImage", or "car imagery API".
---

# Car Imagery API

`https://images.racecor.io` serves race-car photography for the iRacing car roster. It is the single
source of car imagery for the prodrive apps and **replaces Unsplash** for commentary backgrounds, car
detail heroes, and anywhere a photo of a car is shown.

- **Read-only REST API** on Vercel. Image **binaries live on Cloudflare R2** (zero-egress) and are
  served from a CDN — never proxy them through the API host.
- **125 cars / ~3,128 photos** today: GT3, GTP/prototype, GTE, GT4, Cup & touring, formula/open-wheel,
  NASCAR, dirt, and a **heritage** bucket of iconic non-iRacing cars (787B, McLaren F1/P1/Senna, etc.).
- Every photo carries **attribution** (credit, photographer, caption, license, source URL).
- Two categories per car: `race` (the actual iRacing car) and `heritage` (color, not in the sim).

## The fast path (90% of uses)

For a commentary background or a car hero, you do **not** need to parse JSON. Point an image element
straight at a redirect endpoint — it 302s to the CDN image:

- Hero (a curated lead shot):   `https://images.racecor.io/api/v1/cars/{key}/hero?w=1280`
- Random (varies per request):  `https://images.racecor.io/api/v1/cars/{key}/random?w=1280`

```html
<img src="https://images.racecor.io/api/v1/cars/bmw-m4-gt3-evo/random?w=1920" alt="BMW M4 GT3 EVO" />
```

Use `random` for rotating commentary backgrounds, `hero` for a stable card image. Pick `w=` to match
the rendered size (480 / 1280 / 2560 — see Sizes). When you also need to **show a credit** (you do for
CC images — see Attribution), fetch the car detail JSON below.

## Endpoints

| Method · Path | Returns |
|---|---|
| `GET /api/v1/cars` | list of all cars: `{ count, cars: [CarSummary] }` (`?brand=`, `?category=race\|heritage`) |
| `GET /api/v1/cars/{key}` | one car with every image + per-width URLs + attribution |
| `GET /api/v1/cars/{key}/hero?w=` | **302** → CDN URL of the hero image at the nearest width |
| `GET /api/v1/cars/{key}/random?w=` | **302** → CDN URL of a random image |
| `GET /api/v1/manifest` | the whole library in one document (for prefetch / building a local index) |

CORS is open (`*`); all responses are edge-cached. The API is dynamic — when the library grows, these
endpoints reflect it with no client change.

## Resolving a car → `key`

`key` = the iRacing car's display name slugified: lowercase, every run of non-alphanumerics → `-`.

| iRacing name | key |
|---|---|
| BMW M4 GT3 EVO | `bmw-m4-gt3-evo` |
| Global Mazda MX-5 Cup | `global-mazda-mx-5-cup` |
| Porsche 911 GT3 R (992) | `porsche-911-gt3-r-992` |
| McLaren 720S GT3 EVO | `mclaren-720s-gt3-evo` |

From a race/session you typically have the iRacing car name → slugify it. To be safe, fetch
`GET /api/v1/cars` once, cache it, and match your car name against the `iracing` field (or the slugified
`displayName`). This **replaces the old fuzzy `getCarImage()` substring match** — prefer an exact
key/`iracing` match, fall back to slugify. If there's no match, render no image (don't guess).

## Sizes

Each image exists at up to three widths — request what you'll render:

| width | use |
|---|---|
| `480` | thumbnail / grid |
| `1280` | card / commentary background (most common) |
| `2560` | full-bleed hero / 4K |

The `?w=` param resolves to the nearest **available** width (some thin-source images cap below 2560).
Image URLs are content-stable and **immutable** → cache them for a year.

## Attribution (required)

Every image includes `credit` (+ `photographer`, `caption`), a `license`, and a `sourceUrl`:

- `editorial` / `press-free` — manufacturer press. Show the credit near the image.
- `cc-by`, `cc-by-sa`, `cc0` — Wikimedia. Attribution is **legally required** for CC-BY/BY-SA:
  display `Photo: {credit}` and link `sourceUrl`.

Always surface the credit when an image is shown at any prominence (hero, card, detail). For thumbnails
in a dense grid, a hover/tap-through credit is acceptable. Do **not** strip attribution.

## Data shapes

```ts
interface CarSummary {
  key: string; brand: string; displayName: string;
  iracing: string | null;            // iRacing car name, or null for heritage cars
  category: 'race' | 'heritage';
  imageCount: number; heroUrl: string | null;
}
interface CarImage {
  id: string; role: 'hero' | 'gallery';
  credit: string; photographer: string | null; caption: string | null;
  license: string; sourceUrl: string | null;
  urls: Record<string, string>;      // { "480": "...", "1280": "...", "2560": "..." }
}
interface CarDetail {
  key: string; brand: string; displayName: string;
  iracing: string | null; category: 'race' | 'heritage';
  images: CarImage[];                // images[0] is the hero
}
```

## Web (TypeScript / Next.js)

```ts
const API = 'https://images.racecor.io/api/v1'

// Rotating commentary background — no fetch needed, the endpoint redirects to the CDN.
export const carBackground = (key: string, w = 1920) => `${API}/cars/${key}/random?w=${w}`

// Car detail with attribution.
export async function getCar(key: string): Promise<CarDetail | null> {
  const r = await fetch(`${API}/cars/${key}`, { next: { revalidate: 86400 } })
  return r.ok ? r.json() : null
}

// Hero + credit for a card.
const car = await getCar('porsche-911-gt3-r-992')
const hero = car?.images[0]
// <Image src={hero.urls['1280']} alt={car.displayName} width={1280} height={720} />
// <span>Photo: {hero.credit}</span>
```

With `next/image`, add `images.racecor.io` and the R2 host (`pub-*.r2.dev` or the custom CDN domain) to
`images.remotePatterns`. Slugify helper: `name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')`.

## Native — Swift (iOS / macOS / tvOS)

```swift
enum CarImagery {
    static let base = URL(string: "https://images.racecor.io/api/v1")!

    // Background/hero — hand the redirect URL straight to AsyncImage / SDWebImage.
    static func background(_ key: String, w: Int = 1280) -> URL {
        base.appending(path: "cars/\(key)/random").appending(queryItems: [.init(name: "w", value: "\(w)")])
    }
}

struct CarDetail: Decodable {
    let key, brand, displayName: String
    let iracing: String?
    let category: String
    let images: [CarImage]
}
struct CarImage: Decodable {
    let id, credit, license: String
    let photographer, caption, sourceUrl: String?
    let urls: [String: String]   // "480" / "1280" / "2560"
}

func car(_ key: String) async throws -> CarDetail {
    let (data, _) = try await URLSession.shared.data(from: CarImagery.base.appending(path: "cars/\(key)"))
    return try JSONDecoder().decode(CarDetail.self, from: data)
}
```
```swift
// SwiftUI: a commentary background that rotates per appearance.
AsyncImage(url: CarImagery.background("bmw-m4-gt3-evo", w: 1280)) { img in
    img.resizable().scaledToFill()
} placeholder: { Color.black }
```
Slugify in Swift: lowercase, replace non-alphanumerics with `-`, trim leading/trailing `-`.

## Native — Windows / .NET (prodrive-windows / overlay)

```csharp
var url = $"https://images.racecor.io/api/v1/cars/{key}/random?w=1280"; // use directly as an image source
// For attribution: GET /api/v1/cars/{key}, deserialize with System.Text.Json into the shapes above.
```
The redirect endpoints work with any `HttpClient`/`<img>`/WebView2/WPF Image source.

## Caching & performance

- **Image URLs are immutable** → cache for a year; the CDN sets long max-age.
- Fetch `GET /api/v1/cars` (or `/manifest`) **once** and cache it as your car→key index; it changes only
  when the library is regenerated.
- Always request the **width you render** — don't pull 2560 for a 200px card.
- The `hero`/`random` redirect endpoints are the cheapest path; reserve the JSON endpoints for when you
  need attribution or a gallery.

## Roadmap

Track imagery is coming via a parallel `/api/v1/tracks` (same shape, `getTrackImage` equivalent). The
car contract above is stable — build against it now.
