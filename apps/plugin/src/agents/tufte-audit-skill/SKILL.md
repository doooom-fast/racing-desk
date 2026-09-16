---
name: tufte-audit
description: >
  Audit any data visualization, chart, dashboard, or graphical display through the lens of Edward Tufte's
  principles. Use this skill whenever you're reviewing, critiquing, or improving charts, graphs, dashboards,
  sparklines, heatmaps, maps, calendars, or any visual display of quantitative information. Also trigger
  when someone asks you to "review my chart", "improve this visualization", "check my dashboard",
  "apply Tufte principles", "reduce chartjunk", "audit this graph", or anything involving data visualization
  quality — even if they don't mention Tufte by name. If someone shows you a chart or dashboard and asks
  "how can I make this better?", this is your skill.
---

# Tufte Audit Skill

You are conducting a visualization audit through the eyes of Edward Tufte — statistician, professor emeritus
at Yale, and the person who literally wrote the book(s) on data visualization. Tufte's core belief is that
excellence in data graphics comes from substance, statistics, and design working together, and that every
visual choice should serve the data, not the designer's ego.

Your job is to examine a visualization (or code that produces one) and deliver a structured, actionable
audit. You're not trying to be harsh — you're trying to help the visualization reach its potential. Tufte
himself says "the task of the designer is to give visual access to the subtle and the difficult — that is,
the revelation of the complex." Keep that spirit.

## How to Conduct an Audit

When given a visualization to audit (an image, code, description, or dashboard), work through the
following checklist systematically. Not every section will apply to every visualization — skip what's
irrelevant and focus your energy where the biggest improvements live.

After the checklist, deliver:

1. **A severity-ranked list of findings** — each tagged as 🔴 Critical, 🟡 Moderate, or 🟢 Minor
2. **Specific, concrete fixes** — not vague advice like "simplify it", but "remove the grey background fill
   and the outer border; let the data points float on white space"
3. **A Tufte Score** — a 0–100 rating across the dimensions below, with a composite score

If you're auditing *code* that generates a visualization, also produce corrected code with inline comments
explaining each Tufte-motivated change.

---

## The Audit Checklist

### 1. Data-Ink Ratio

The data-ink ratio is the proportion of a graphic's total ink (or pixels) that represents actual data. Tufte's
five laws:

- **Above all else, show the data.**
- **Maximize the data-ink ratio.** Every mark on the page should encode information. If you can erase
  something without losing data, it shouldn't be there.
- **Erase non-data-ink.** Backgrounds, decorative borders, heavy gridlines, 3D effects, gradient fills,
  drop shadows — these are ink spent on nothing.
- **Erase redundant data-ink.** If the same information is encoded twice (e.g., a bar's height AND a number
  label AND a color AND a legend entry all saying the same thing), strip the redundancy.
- **Revise and edit.** Good graphics are rewritten graphics.

**What to look for:**
- Background fills or shading that serve no data purpose
- Heavy or dark gridlines (light ones are sometimes acceptable if they genuinely aid reading)
- Borders and boxes around the chart area
- 3D effects on bars, pies, or any chart element
- Gradient fills, shadows, or glow effects
- Redundant legends (if values are directly labeled, the legend is redundant)
- Excessive tick marks or axis furniture
- "Ducks" — decorative images or icons placed on the chart

**Scoring (0–100):**
- 90–100: Nearly every pixel serves data. Axis furniture is minimal. No decorative elements.
- 70–89: Some unnecessary elements remain but data dominates.
- 50–69: Noticeable decoration, heavy gridlines, or redundant encoding.
- Below 50: The chart is mostly furniture. Data is a guest in its own house.

---

### 2. Chartjunk

Chartjunk is Tufte's term for visual elements that don't help the viewer decode data. There are three
species:

- **Moiré vibration**: Patterns (hatching, cross-hatching, dense stripes) that create optical buzzing and
  interfere with reading. Common in older bar charts that used pattern fills instead of solid colors.
- **The Grid**: Heavy, prominent gridlines that dominate the data. Grids should be muted or absent — if
  you need them, make them the lightest possible grey.
- **The Duck**: Decoration masquerading as information. A chart shaped like a dollar bill, clip art icons
  sprinkled around, or a pie chart rendered as a 3D exploded donut with a photograph texture. The name
  comes from the architecture concept of a "decorated shed" vs. a "duck" (a building shaped like what it
  sells).

**What to look for:**
- Pattern fills where solid (or no) fills would work
- Gridlines that are darker than the data
- Icons, illustrations, or clip art on or around the chart
- 3D perspective effects (they always distort proportions)
- Pie charts (Tufte is famously skeptical — they're rarely the best choice)
- Unnecessary color variation (using 12 colors when 3 would do)
- Animated transitions that don't encode data change
- "Infographic" styling that prioritizes aesthetics over accuracy

---

### 3. Graphical Integrity & Proper Axes

Tufte insists that visual representations must tell the truth. His Lie Factor formula:

```
Lie Factor = (size of effect shown in graphic) / (size of effect in data)
```

A Lie Factor of 1.0 is honest. Anything between 0.95 and 1.05 is acceptable. Outside that range, the
graphic is distorting reality.

**Six Principles of Graphical Integrity:**

1. **Proportional representation.** The physical size of graphic elements must be directly proportional to
   the quantities they represent. A bar twice as tall should represent a value twice as large.

2. **Clear, detailed labeling.** Use thorough labels to defeat distortion and ambiguity. Write explanations
   directly on the graphic. Label important events in the data. Axes must have:
   - Units clearly stated
   - Appropriate tick intervals (not too many, not too few)
   - A zero baseline for bar charts (truncated axes exaggerate differences)
   - Consistent scaling across panels being compared

3. **Show data variation, not design variation.** The viewer's eye should be drawn to differences in the
   data, not differences in the design.

4. **Deflated, standardized units for money over time.** If showing monetary values across years, adjust
   for inflation. Nominal dollars over time is almost always misleading.

5. **Dimensional consistency.** Don't represent 1D data (a single number) with 2D areas or 3D volumes.
   This is how a 53% increase gets visually exaggerated into a 783% increase (the infamous Lie Factor of
   14.8 from Tufte's fuel economy example).

6. **Context over decoration.** Content determines credibility. Cite your sources, state the time period,
   explain methodology.

**Axes-specific checklist:**
- Does the y-axis start at zero for bar charts? (Line charts may have a non-zero baseline if the data
  range warrants it, but it should be clearly marked.)
- Are axis labels present and legible?
- Are units specified?
- Is the aspect ratio appropriate? (An artificially wide or tall chart can exaggerate or flatten trends.)
- For dual-axis charts: are they actually necessary, or do they create false implied correlations?
- Are comparison panels using the same scale?
- Is there a Lie Factor issue? Check the visual proportions against the data.

---

### 4. Small Multiples

Tufte defines small multiples as "illustrations of postage-stamp size are indexed by category or a label,
sequenced over time like the frames of a movie, or ordered by a quantitative variable not used in the
single image itself."

The power of small multiples is that they enforce visual comparison by keeping the graphic form constant
and letting the data change. The viewer's eye doesn't need to relearn how to read the chart — the design
is the same, only the data varies.

**When to recommend small multiples:**
- The visualization crams too many series into one chart (spaghetti lines, overlapping bars)
- A dashboard shows variations across categories, time periods, or geographies
- An animation or interactive toggle is used where side-by-side comparison would be more effective
- A pie chart shows composition across groups (replace with small multiples of bar charts)

**What makes good small multiples:**
- Consistent axes across all panels (this is critical — different scales defeat the purpose)
- Clear, compact labeling (each panel is titled by its category/time/group)
- Enough panels to show the pattern, but not so many that individual panels become unreadable
- Removed redundancy: shared axes labeled once, not repeated on every panel
- Tight spacing — the panels should feel like one integrated graphic, not a scattered grid

**What to flag:**
- Inconsistent scales across panels
- Too much annotation repeated per panel
- Panels too large (wasting space) or too small (unreadable)
- Missing panel labels or unclear ordering

---

### 5. Sparklines

Tufte invented the sparkline — "data-intense, design-simple, word-sized graphics." A sparkline has a
data-pixel ratio of essentially 1.0. It consists entirely of data: no frames, no tick marks, no axes, no
legends.

**When to recommend sparklines:**
- A table or dashboard shows numbers that have a temporal or sequential dimension
- The viewer needs to see the trend/shape, not exact values
- Space is at a premium (dashboards, reports, KPI summaries)
- Inline context matters — the sparkline sits next to the text or number it illuminates

**What makes a good sparkline:**
- Word-sized: it fits naturally in a line of text or a table cell
- Shows shape and trend, not precise values
- Key values annotated minimally (perhaps the first value, last value, min, and max — as tiny dots or
  numbers, not heavy labels)
- Consistent scaling when multiple sparklines are compared side-by-side
- No axes, no gridlines, no frames — pure data

**What to flag:**
- Sparklines with axes or grids (defeats the purpose)
- Sparklines too large to be word-sized (they're becoming regular charts)
- Inconsistent scaling across a set of sparklines being compared
- Missing context numbers (the sparkline should be accompanied by at least the current/final value)

---

### 6. Heatmaps

Heatmaps encode values as color intensity across a matrix. When done well, they reveal patterns in
dense data that no other form can match. When done poorly, they become a confusing quilt.

**Tufte-aligned heatmap principles:**
- **Color choice matters profoundly.** Use a single-hue sequential scale (light-to-dark) for magnitude, or
  a carefully chosen diverging scale (with a meaningful neutral midpoint) for deviation data. Rainbow/
  jet colormaps are chartjunk — they impose artificial boundaries, are not perceptually uniform, and fail
  for colorblind viewers.
- **Label the data.** If the matrix isn't too large, show the actual values in cells. The color gives the
  pattern; the numbers give the precision.
- **Order matters.** Rows and columns should be ordered meaningfully — by value, by hierarchy, by time.
  Alphabetical order rarely reveals structure.
- **Provide a clear legend.** The color scale must be labeled with units and range.
- **Reduce non-data-ink.** Thick cell borders, heavy gridlines between cells, and ornamental frames all
  reduce the data-ink ratio.

**What to flag:**
- Rainbow/jet colormap usage
- Missing color scale legend
- Alphabetical instead of meaningful ordering
- Heavy cell borders that fragment the visual pattern
- No annotation of extreme or notable values
- Inconsistent cell sizing

---

### 7. Calendars

Calendar visualizations (like GitHub contribution graphs) are a special form of heatmap where time
structure provides the grid. Tufte's principles apply directly:

**Good calendar visualizations:**
- Use the natural grid of weeks/months/days — the calendar structure is itself meaningful, not decorative
- Apply color or size encoding consistently and with a clear scale
- Don't overload with too many encodings per cell
- Label months and days of the week clearly but minimally
- Allow the pattern to emerge — the grid should recede, the data should pop

**What to flag:**
- Excessive decoration around the calendar grid
- Color scales that don't start from a clear zero/baseline
- Missing legends or unclear what the intensity represents
- Cells too small to read or too large, wasting space
- Inconsistent time coverage (gaps that aren't explained)

---

### 8. Maps & Geographical Visualization

Tufte has specific, strong opinions on data maps. His core criticism of choropleth maps: they "mix up
acres with people" by equating visual importance with geographic area rather than the quantity being
measured. A vast, sparsely populated county dominates the eye while a dense, important city is a tiny
speck.

**Tufte-aligned map principles:**
- **Be wary of choropleth maps.** Geographic area ≠ data importance. Consider alternatives:
  cartograms, dot-density maps, hex-bin maps, or mesh maps (uniform grids).
- **The ecological correlation problem.** Aggregate geographic data (county averages, state totals) can
  reverse direction at the individual level. Maps showing aggregates should carry this caveat.
- **Use lighter colors** so underlying geography remains visible.
- **Label directly.** Annotate notable regions on the map rather than relying on a separate legend that
  forces the eye to shuttle back and forth.
- **Accompany with data tables.** Maps show patterns; tables provide precision. They complement each
  other.
- **Projections matter.** Mercator distorts area. Choose a projection appropriate to the data's geography
  and state which projection you're using.

**What to flag:**
- Choropleth maps without consideration of area-vs-population distortion
- Rainbow colormaps on maps
- Missing scale/legend
- No data table companion
- Unlabeled or unclear boundaries
- Misleading projection choice
- Interactive maps where a static small-multiples view would be more effective for comparison

---

### 9. Layering, Separation & Interactivity

From *Envisioning Information*: "Confusion and clutter are failures of design, not attributes of
information." Layering and separation are how you tame complexity without throwing away dimensions.

**Layering principles:**
- **Visual hierarchy.** The most important data layer should be the most visually prominent. Secondary
  reference layers (grids, baselines, annotations) should recede.
- **Color as layer.** Use bright, saturated colors sparingly — for the data that matters most. Background
  and reference elements should be muted greys or near-white.
- **The 1+1=3 problem.** Two dark lines close together create a perceived third element (the white space
  between them). This phantom contour is non-data-ink. Lighten, thin, or separate elements to prevent
  it.
- **Tables without grids.** Start without any gridlines. Add the minimum rules needed for clarity. Thin
  lines beat thick lines. Vertical rules are rarely needed.
- **White space is active.** Negative space separates layers and gives the eye room to parse.

**Interactivity principles (extending Tufte for digital media):**
Tufte's work is rooted in print, but his principles extend naturally to interactive visualizations:

- **Detail-on-demand, not detail-by-default.** Show the overview first, let the user drill down. This is
  Tufte's macro/micro principle applied to interaction: the macro view reveals pattern, the micro view
  reveals detail.
- **Tooltips over labels when density is high.** If labeling every point would create clutter, tooltips on
  hover are a reasonable compromise — they're a form of layering.
- **Filtering and highlighting over animation.** Let users select and compare subsets rather than watching
  things move. Animation is temporal chartjunk unless it encodes a temporal variable.
- **Linked views.** Multiple coordinated panels (brushing and linking) embody the small-multiples
  principle in an interactive context.
- **Don't make the user work for context.** If the user has to click three times to understand what a chart
  shows, the chart has failed. The overview should be self-explanatory.
- **Respect the data-ink ratio in UI chrome.** Toolbars, control panels, and filter widgets are non-data
  elements. Keep them visually subordinate to the data display.

---

## Scoring Rubric

After working through the checklist, produce a scorecard:

| Dimension                  | Score (0–100) | Key Findings |
|----------------------------|---------------|--------------|
| Data-Ink Ratio             |               |              |
| Chartjunk                  |               |              |
| Graphical Integrity & Axes |               |              |
| Small Multiples (if applicable) |          |              |
| Sparklines (if applicable) |               |              |
| Heatmaps (if applicable)   |               |              |
| Calendars (if applicable)  |               |              |
| Maps (if applicable)       |               |              |
| Layering & Separation      |               |              |
| Interactivity (if applicable) |            |              |
| **Composite Tufte Score**  |               |              |

The composite score is a weighted average. Data-Ink Ratio, Chartjunk, and Graphical Integrity are always
weighted most heavily because they apply universally. Other dimensions are weighted only if they're
relevant to the visualization being audited.

---

## Output Format

Structure your audit report as:

### Tufte Audit Report

**Visualization:** [what's being audited]
**Overall Tufte Score:** [X/100]
**Summary:** [2–3 sentence executive summary of the visualization's strengths and biggest opportunities]

#### Critical Findings (🔴)
[Numbered list of issues that actively mislead or seriously undermine the visualization]

#### Moderate Findings (🟡)
[Numbered list of issues that reduce clarity or waste the viewer's attention]

#### Minor Findings (🟢)
[Numbered list of polish items and nice-to-haves]

#### Scorecard
[The scoring table above]

#### Recommended Changes
[Prioritized, specific, actionable fixes — not vague advice. If code was provided, include corrected code
with comments explaining each change.]

#### What's Working Well
[Genuine praise for what the visualization does right. Even a bad chart usually has something worth
keeping.]

---

## Philosophy Notes

Keep these Tufte quotes in mind as you audit — they capture the spirit:

- "Above all else, show the data."
- "Graphical excellence is that which gives to the viewer the greatest number of ideas in the shortest
  time with the least ink in the smallest space."
- "Clutter and confusion are not attributes of data — they are shortcomings of design."
- "The task of the designer is to give visual access to the subtle and the difficult."
- "Graphical excellence is nearly always multivariate."
- "If the statistics are boring, then you've got the wrong numbers."

When in doubt, ask: "Does this visual element help the viewer understand the data?" If yes, keep it. If no,
it's a candidate for removal or muting. And always remember — Tufte's goal isn't minimalism for its own
sake. It's clarity. A dense, information-rich graphic is excellent if every element earns its place.
