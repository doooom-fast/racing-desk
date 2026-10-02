# The pseudonyms

`names.json` is the list of names Racing Desk shows for **every other driver** in place of their own. The driver's own
name is his. The rule, asked for on 2026-10-01 ("I want randomized characters from all David Foster Wallace works and
Trainspotting, the band members of Sunn O))), Black Sabbath, Type O Negative, Tool and The Cure. iRacing likely won't let
us show others' names eventually"; iRacing's support article of 2026-09-30, "Third-Party Development: Please Review the
iRacing Terms", says no display name or customer id may be shown without explicit, revocable consent): **a real name of
another driver never leaves the source adapters.** The root `CLAUDE.md`, "Other drivers' names", says where it is applied.

## What is in it

336 names, real ones only, none invented, each with the work or band it comes from (`from`, one of `sources`):

| Source | Names | Notes |
|---|---|---|
| *Infinite Jest* (1996) | 186 | The Incandenzas, Ennet House, the Enfield Tennis Academy (students, staff, supporters), the A.F.R., the Antitois, the people of the Incandenza films… |
| *The Broom of the System* (1987) | 28 | The Beadsmans, Rick Vigorous, Frequent and Vigorous, Dr. Jay, Bombardini, Zusatz, the Spasovas… |
| *The Pale King* (2011) | 26 | The Peoria REC: Sylvanshine, Stecyk, Fogle, Lane Dean, Toni Ware, Drinion, Rand, MerriEloise Prout… |
| *Girl with Curious Hair* (1989) | 11 | "Little Expressionless Animals", "Girl with Curious Hair", "John Billy", "Westward the Course of Empire Takes Its Way" |
| *Brief Interviews with Hideous Men* (1999) | 2 | "Adult World", "Tri-Stan"; most of its people have no name ("the depressed person", B.I. #20) |
| *Oblivion* (2004) | 16 | "Mister Squishy", "The Soul Is Not a Smithy", "Good Old Neon", "Oblivion", "The Suffering Channel" |
| *Trainspotting* (Irvine Welsh, 1993) | 17 | Renton, Sick Boy, Spud, Begbie, Second Prize, Tommy, Johnny Swan, Seeker, Raymie, Alan Winters… |
| Sunn O))) | 6 | The members, past and present, as Wikipedia's article lists them: O'Malley, Anderson, Preston, Csihar, O'Sullivan, Dahlquist |
| Black Sabbath | 21 | The members of every line-up: Iommi, Osbourne, Butler, Ward, Dio, Appice, Gillan, Hughes, Martin, Powell, Keel, Donato… |
| Type O Negative | 5 | Steele, Hickey, Silver, Kelly, Abruscato |
| Tool | 5 | Keenan, Jones, Carey, Chancellor, D'Amour |
| The Cure | 13 | Smith, Gallup, O'Donnell, Cooper, Gabrels, Bamonte, Tolhurst, Thompson, Williams, Dempsey, Hartley, Anderson, Thornalley |

Left out on purpose:

- **Characters who share a name with a real public figure outside these works** (Infinite Jest's John Wayne and its
  Johnny Gentle, a crooner who is also a Liverpool singer's stage name; Hester Thrale and Andrew Lang, who are an
  eighteenth-century diarist and a Scottish folklorist; the Lyndon Johnson, Alex Trebek and Pat Sajak of the stories; the
  Vivienne Dick, Neil Hartigan, Amy Johnson, Robert Monroe, Bob Francis and Robert Atkins of the novels' lists; the Julie
  Smith of "Little Expressionless Animals"), as far as the compiler knew of one. Any name is some private person's, and
  a public figure the compiler did not know of may share one; the rule is kept to the ones known.
- **People who played with a band without being members of it**: Sunn O)))'s collaborators and guests (Tos
  Nieuwenhuizen, Steve Moore, Tim Midyett, Oren Ambarchi, Rex Ritter, Hildur Guðnadóttir, Anthony Pateras) and Black
  Sabbath's session and touring players (Bob Daisley, Laurence Cottle, Jo Burt, Terry Chimes, Adam Wakeman, Tommy
  Clufetos, and the keyboardists and guests of the records and tours). He asked for the band members. They are real
  people with a real link to the bands, and adding them back is a decision of his, not a gap: the file's `from` and the
  table above say what is in it.
- The author's own appearance in *The Pale King* and *Good Old Neon*, characters named by a first name or a surname alone
  in the text (Alison, Kelly, Lizzy, Nina, Fern; Bondurant, Cardwell) where there is nothing to show, a character who is
  the same person as one already on the list under another name (Simon Williamson is Sick Boy, Rab McLaughlin is Second
  Prize), and anyone whose full name no public source gives with certainty.

Characters known by a nickname alone are shown as the nickname (`"nickname": true`: Sick Boy, Spud, Begbie, Second
Prize, Seeker, Sick Puppy, Bob Death).

## Where the names were checked

Public pages only, read on 2026-10-01; a name that no source confirmed as written was taken out rather than guessed
(sixteen were, from the first draft of this list).

- *Infinite Jest*: every name against the German readers' glossary of the novel's people,
  [sometimesiliketoread.de/infinitejest/glossar](https://www.sometimesiliketoread.de/infinitejest/glossar/), and the
  David Foster Wallace Wiki's page on the novel,
  [davidfosterwallace.miraheze.org/wiki/Infinite_Jest](https://davidfosterwallace.miraheze.org/wiki/Infinite_Jest); the
  spellings are the glossary's (Csikszentmihalyi, Gopnik, Longley, Schacht, Gerhard Schtitt), which GradeSaver's list
  agrees with where both have the name. The second pass of the list (the Enfield Tennis Academy's students and staff,
  the supporters, the people of the films) takes every person the glossary gives a first and a last name.
  The glossary calls Robert F. "Bob Death" (*genannt*, "called"), so he is a nickname and is shown whole.
- *The Broom of the System*: the David Foster Wallace Wiki's page on the novel
  ([…/wiki/The_Broom_of_the_System](https://davidfosterwallace.miraheze.org/wiki/The_Broom_of_the_System)) and
  Wikipedia's.
- *The Pale King*: the character list at
  [figurativeink.wordpress.com](https://figurativeink.wordpress.com/2011/10/19/david-foster-wallace-the-pale-king-character-list/),
  with the summaries of the novel for Lehrl, Elpidia Carter and Sabusawa. The list spells the Peoria REC's
  "MerriEloise Prout aka Dr. Yes" as one word.
- The stories: the summaries of each story (Wikipedia's pages on *Girl with Curious Hair* and *Oblivion*, the published
  readings of "Westward", "Mister Squishy", "The Soul Is Not a Smithy" and "Adult World").
- *Trainspotting*: Wikipedia's page on the novel, and the published character guides for the surnames the novel gives
  once (Seeker, Temperley, Connell, Airlie).
- The bands: Wikipedia's pages on each band and its members
  ([Sunn O)))](https://en.wikipedia.org/wiki/Sunn_O))), [Black Sabbath's members](https://en.wikipedia.org/wiki/List_of_Black_Sabbath_band_members),
  [The Cure's](https://en.wikipedia.org/wiki/List_of_the_Cure_band_members), [Type O Negative](https://en.wikipedia.org/wiki/Type_O_Negative),
  [Tool](https://en.wikipedia.org/wiki/Tool_(band))), taking the members and leaving the guests, session and touring players.

## The shown form

The HUD shows a name as `H. Incandenza`: the first initial, a dot, and the surname with any lowercase particle that
belongs to it (`J. van Dyne`, `R. van Cleve`, `C. van der Hingle`; `A. deLint`, whose particle is part of the word). A single
word (`Lyle`, `Garrity`, `Neal`) and a nickname are shown whole; an entry may give its own `shown` (`J.D. Steelritter`,
whose first name is initials already). `RacingDesk.Core.Names.PseudonymList.ShownForm` is the one implementation, and both
forms are unique across the list (`PseudonymListTests`). The same string is used everywhere a name goes — the
leaderboard, the gaps, the spotter and the incident coach, commentary, the store's grid, the recording sidecar — so that
what the HUD matches by name (a threat to a leaderboard row, a gap trend to its car) matches.

## How a driver gets a name

`apps/core/RacingDesk.Core/Names/`: `PseudonymBook` holds this list and a salt of 32 random bytes made once on this
machine and kept at `%LOCALAPPDATA%\Racing Desk\pseudonyms.salt` (never sent anywhere; the SimHub plugin and the app's
host read the same file, so a rival has one name on both paths). `Pseudonymizer` is one session's names.

- **A driver's preference** is rendezvous (highest-random-weight) hashing: every name of the list is scored
  `HMAC-SHA256(salt, "rank|cust:" + customer id + "|" + the name as the work gives it)`, and the driver takes the
  highest-scored name that nobody in the session holds. A name's score depends on that name and the id alone, so the
  order of this file and its length decide nothing: **the file may be re-sorted without renaming anyone, and a name added
  to it moves only the drivers who prefer it to the one they had** (about one driver in the list's length).
- **A field named at once** (the session's drivers when it is read, a stored grid) is served in an order of the ids' own
  (`HMAC-SHA256(salt, "priority|" + key)`), not the order they are listed in, and the racers before the spectators, so a
  spectator never takes a racer's first choice. Where two drivers want one name the same one keeps it on the plugin's
  path, the host's and the desk's stored sessions.
- **What cannot be made the same**: a name once given is kept for the session, so a rival is the same character all race.
  A driver who joins later than the field was named gets what is free when he comes, and the other path, if it began later
  or restarted, may name the field with him in it from the start and give him his first choice — so a rival whose first
  choice another driver held when he joined can be a different character on the two paths. In a field of 40 about two
  pairs of first choices clash, so roughly one rival in twenty is not the character he would be alone; nothing keeps that
  from happening while the name is kept for the session.
- **A session that runs out of names** (more drivers than names, a 24-hour race with every driver swap a new id) gives
  the next driver a numbered form of the name he prefers (`H. Incandenza II`), never one in use. A build without the list
  says `Driver 0000` to `Driver 9999`, no two the same.
- Nobody can turn a name back into a customer id without the salt and the list, and the id itself is stored nowhere. A
  driver with no customer id (another sim, an entry the session does not list) is keyed on their name, salted the same
  way, and is still shown as a character.

The list is embedded in `RacingDesk.Core` at build time (`RacingDesk.Core.Names.names.json`), as the car list is.
