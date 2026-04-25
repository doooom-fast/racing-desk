# Race Data Schema

The JSON object sent to the Anthropic API as the user message content.

## Fields

| Field | Type | Description |
|---|---|---|
| `position` | integer | Final finish position. 0 = DNF. |
| `trackName` | string | Circuit name (e.g., "Watkins Glen International") |
| `carModel` | string | Vehicle name (e.g., "Dallara P217 LMP2") |
| `totalLaps` | integer | Total laps in the race event |
| `currentLap` | integer | Laps completed by the driver |
| `bestLapTime` | float | Best lap time in seconds |
| `lapTimes` | float[] | Lap time for each completed lap, in seconds |
| `positions` | integer[] | Position at the end of each completed lap |
| `incidents` | integer | Total incident count (iRacing-style, 0-17+ scale) |
| `iRatingDelta` | float | Estimated iRating change. Positive = gained, negative = lost. |
| `fuelLevels` | float[] | Fuel remaining (liters) at end of each lap |
| `tyreTempAvg` | float[] | Average of all 4 tyre temperatures (°C) at end of each lap |
| `commentaryLog` | object[] | Key moments captured during the race |

## Commentary Log Entry

| Field | Type | Description |
|---|---|---|
| `lap` | integer | Lap number when the event occurred |
| `title` | string | Event title (e.g., "Position Gained!") |
| `text` | string | Commentary text describing the event |
| `topicId` | string | Event category identifier |

### Topic IDs

| topicId | Meaning |
|---|---|
| `position_gained` | Driver moved up in the standings |
| `position_lost` | Driver lost a position |
| `incident_spike` | Incident count jumped significantly |
| `personal_best` | New personal best lap time |
| `close_battle` | Within 0.5s of another car |
| `pit_entry` | Entered pit lane |
| `spin_catch` | Caught a spin/slide |
| `off_track` | Went off track |
| `wall_contact` | Contact with barrier |
| `qualifying_push` | Fast qualifying lap attempt |

## Example

```json
{
  "position": 5,
  "trackName": "Watkins Glen International",
  "carModel": "Dallara P217 LMP2",
  "totalLaps": 30,
  "currentLap": 30,
  "bestLapTime": 102.347,
  "lapTimes": [105.2, 103.8, 103.1, 102.9, 102.5, 102.347, 103.0, 103.4, ...],
  "positions": [8, 8, 7, 7, 6, 5, 5, 5, ...],
  "incidents": 3,
  "iRatingDelta": 47,
  "fuelLevels": [45.2, 42.8, 40.3, 37.9, ...],
  "tyreTempAvg": [88.5, 91.2, 93.8, 95.1, ...],
  "commentaryLog": [
    {"lap": 3, "title": "Position Gained!", "text": "Moved up to P7 with a clean pass into Turn 1", "topicId": "position_gained"},
    {"lap": 6, "title": "Personal Best!", "text": "New fastest lap: 1:42.347", "topicId": "personal_best"}
  ]
}
```
