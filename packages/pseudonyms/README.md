# The pseudonyms

`names.json` is the list of names Racing Desk shows for **every other driver** in place of their own. The driver's own
name is his. The rule, asked for on 2026-10-01 ("I want randomized characters from all David Foster Wallace works and
Trainspotting, the band members of Sunn O))), Black Sabbath, Type O Negative, Tool and The Cure. iRacing likely won't let
us show others' names eventually"; iRacing's support article of 2026-09-30, "Third-Party Development: Please Review the
iRacing Terms", says no display name or customer id may be shown without explicit, revocable consent): **a real name of
another driver never leaves the source adapters.** The root `CLAUDE.md`, "Other drivers' names", says where it is applied.

## What is in it

248 names, real ones only, none invented, each with the work or band it comes from (`from`, one of `sources`):

| Source | Names | Notes |
|---|---|---|
| *Infinite Jest* (1996) | 96 | The Incandenzas, Ennet House, the Enfield Tennis Academy, the A.F.R., the Antitois… |
| *The Broom of the System* (1987) | 25 | The Beadsmans, Rick Vigorous, Frequent and Vigorous, Dr. Jay, Bombardini, Zusatz… |
| *The Pale King* (2011) | 23 | The Peoria REC: Sylvanshine, Stecyk, Fogle, Lane Dean, Toni Ware, Drinion, Rand… |
| *Girl with Curious Hair* (1989) | 12 | "Little Expressionless Animals", "Girl with Curious Hair", "Lyndon", "John Billy", "Westward the Course of Empire Takes Its Way" |
| *Brief Interviews with Hideous Men* (1999) | 2 | "Adult World", "Tri-Stan"; most of its people have no name ("the depressed person", B.I. #20) |
| *Oblivion* (2004) | 16 | "Mister Squishy", "The Soul Is Not a Smithy", "Good Old Neon", "Oblivion", "The Suffering Channel" |
| *Trainspotting* (Irvine Welsh, 1993) | 16 | Renton, Sick Boy, Spud, Begbie, Second Prize, Tommy, Johnny Swan, Seeker, Raymie… |
| Sunn O))) | 11 | O'Malley and Anderson, and the players of the records and the stage: Preston, Csihar, O'Sullivan, Dahlquist, Nieuwenhuizen, Moore, Ambarchi, Midyett, Ritter |
| Black Sabbath | 24 | Every line-up, studio and touring: Iommi, Osbourne, Butler, Ward, Dio, Appice, Gillan, Hughes, Martin, Powell… |
| Type O Negative | 5 | Steele, Hickey, Silver, Kelly, Abruscato |
| Tool | 5 | Keenan, Jones, Carey, Chancellor, D'Amour |
| The Cure | 13 | Smith, Gallup, O'Donnell, Cooper, Gabrels, Bamonte, Tolhurst, Thompson, Williams, Dempsey, Hartley, Anderson, Thornalley |

Left out on purpose: characters who share a name with a real public figure outside these works (Infinite Jest's John
Wayne; the Lyndon Johnson, Alex Trebek and Pat Sajak of the stories), the author's own appearance in *The Pale King* and
*Good Old Neon*, characters named by a first name or a surname alone in the text (Alison, Kelly, Lizzy, Nina, Fern;
Bondurant, Cardwell) where there is nothing to show, and anyone whose full name no public source gives with certainty.
Characters known by a nickname alone are shown as the nickname (`"nickname": true`: Sick Boy, Spud, Begbie, Second
Prize, Seeker, Sick Puppy).

## Where the names were checked

Public pages only, read on 2026-10-01; a name that no source confirmed as written was taken out rather than guessed
(sixteen were, from the first draft of this list).

- *Infinite Jest*: every name against the German readers' glossary of the novel's people,
  [sometimesiliketoread.de/infinitejest/glossar](https://www.sometimesiliketoread.de/infinitejest/glossar/), and the
  David Foster Wallace Wiki's page on the novel,
  [davidfosterwallace.miraheze.org/wiki/Infinite_Jest](https://davidfosterwallace.miraheze.org/wiki/Infinite_Jest); the
  spellings are the glossary's (Csikszentmihalyi, Gopnik, Longley, Schacht), which GradeSaver's list agrees with where
  both have the name.
- *The Broom of the System*: the David Foster Wallace Wiki's page on the novel
  ([…/wiki/The_Broom_of_the_System](https://davidfosterwallace.miraheze.org/wiki/The_Broom_of_the_System)) and
  Wikipedia's.
- *The Pale King*: the character list at
  [figurativeink.wordpress.com](https://figurativeink.wordpress.com/2011/10/19/david-foster-wallace-the-pale-king-character-list/),
  with the summaries of the novel for Lehrl, Elpidia Carter and Sabusawa.
- The stories: the summaries of each story (Wikipedia's pages on *Girl with Curious Hair* and *Oblivion*, the published
  readings of "Westward", "Mister Squishy", "The Soul Is Not a Smithy" and "Adult World").
- *Trainspotting*: Wikipedia's page on the novel, and the published character guides for the surnames the novel gives
  once (Seeker, Temperley, Connell, Airlie).
- The bands: Wikipedia's pages on each band and its members, with the records' and tours' players for Sunn O))) (who
  plays with O'Malley and Anderson changes from record to record) and Black Sabbath.

## The shown form

The HUD shows a name as `H. Incandenza`: the first initial, a dot, and the surname with any lowercase particle that
belongs to it (`J. van Dyne`, `R. van Cleve`; `A. deLint`, whose particle is part of the word). A single word (`Lyle`,
`Garrity`, `Neal`) and a nickname are shown whole; an entry may give its own `shown` (`J.D. Steelritter`).
`RacingDesk.Core.Names.PseudonymList.ShownForm` is the one implementation, and both forms are unique across the list
(`PseudonymListTests`). The same string is used everywhere a name goes — the leaderboard, the gaps, the spotter and the
incident coach, commentary, the store's grid, the recording sidecar — so that what the HUD matches by name (a threat to a
leaderboard row, a gap trend to its car) matches.

## How a driver gets a name

`apps/core/RacingDesk.Core/Names/`: `PseudonymBook` holds this list and a salt of 32 random bytes made once on this
machine and kept at `%LOCALAPPDATA%\Racing Desk\pseudonyms.salt` (never sent anywhere; the SimHub plugin and the app's
host read the same file, so a rival has one name on both paths). `Pseudonymizer` is one session's names: a driver's
first choice is `HMAC-SHA256(salt, "cust:" + customer id) mod 248`, and when another driver in the same session already
holds that name, the next probe (`… + "#1"`, `"#2"`, …) until a free one. A name once given in a session is kept for it,
so a rival is the same character all race and, by the hash, the next time; nobody can turn a name back into a customer
id without the salt and the list, and the id itself is stored nowhere. A driver with no customer id (another sim, an
entry the session does not list) is keyed on their name, salted the same way, and is still shown as a character.

The list is embedded in `RacingDesk.Core` at build time (`RacingDesk.Core.Names.names.json`), as the car list is.
