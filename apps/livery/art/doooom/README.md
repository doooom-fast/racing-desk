# DOOOOM source art

The driver's own marks, from the livery library's `art/` folder.

| File | What it is |
|---|---|
| `DOOOOM.ai` | The artwork, as drawn. |
| `art_doooom.png` | The DOOOOM wordmark. Along both flanks and across the back of every car. |
| `ai_ps600.png` | The DOOOOM SPEEDSPORTS lockup. On the top deck or bonnet. |
| `art_speedsports.png` | SPEEDSPORTS alone. Where a surface already wears DOOOOM. |
| `shatter-field.png` | The shard field, 2048 x 2048, 16-bit: how strongly the art colour shows at each point of a sheet. |

## The shard field

Every fleet paint is `body x (1 - field) + art x field`, with logos and colour patches on top. The
raster the field was first made from stayed on the machine that made it, so the field here was
recovered from the 34 fleet paints in the library: each sheet says what the field is wherever it
carries no logo, and the median of what they say is the field.

All 34 agree with it to within one colour level on more than 99.3% of their sheet, and a BMW M2
rebuilt from it matches the library's paint to within one level everywhere off the logos.

A new field is made from any shattered artwork by `livery.fleet.shatter.field_from_raster`;
`packages/shatter` is the engine that shatters.
