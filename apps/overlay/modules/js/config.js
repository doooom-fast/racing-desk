// The Racing Desk Dashboard — Shared Configuration & State
// This module defines all global constants and state variables used across other modules.
// All variables are implicitly global (shared scope) since modules load via <script src> tags.

// ═══════════════════════════════════════════════════════════════
// SIMHUB HTTP API CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const SIMHUB_URL = 'http://localhost:8889/racing-desk/';

// One of the runtime's ?action= routes, asked for by the page: resolves to what the route answered (parsed JSON), rejects
// with a message when it was refused or not answered. The runtime answers them to a program on this machine alone, and a
// page's request is not one (it carries an Origin, "null" for this file), so in the app the request is made by main.js
// (modules/js/runtime-actions.js, through the preload's runtimeAction). Without the app — a browser, the iPad's page, whose
// server refuses a query — the page asks as it always did, and is refused. `params` is an object of the route's arguments.
function runtimeAction(name, params) {
  var bridge = window.racingDesk && window.racingDesk.runtimeAction;
  if (bridge) {
    return bridge(name, params || {}).then(function (answer) {
      if (answer && answer.ok) return answer.body;
      throw new Error((answer && answer.error) || 'The runtime did not answer.');
    });
  }
  var query = '?action=' + encodeURIComponent(name);
  Object.keys(params || {}).forEach(function (key) {
    query += '&' + key + '=' + encodeURIComponent(params[key]);
  });
  return fetch((window._simhubUrlOverride || SIMHUB_URL) + query).then(function (r) {
    if (!r.ok) throw new Error('The runtime answered ' + r.status + '.');
    return r.json();
  });
}

const POLL_MS = 33; // ~30fps when in a car
const IDLE_POLL_MS = 1000; // slow poll when not in a car — just enough to detect entry

// All properties we need, batched into a single request
const PROP_KEYS = [
  'DataCorePlugin.GameRunning',
  'RacingDesk.Plugin.GameId',
  'DataCorePlugin.GameData.Gear',
  'DataCorePlugin.GameData.Rpms',
  'DataCorePlugin.GameData.CarSettings_MaxRPM',
  'DataCorePlugin.GameData.SpeedMph',
  'DataCorePlugin.GameData.Throttle',
  'DataCorePlugin.GameData.Brake',
  'DataCorePlugin.GameData.Clutch',
  'DataCorePlugin.GameData.Fuel',
  'DataCorePlugin.GameData.MaxFuel',
  'DataCorePlugin.Computed.Fuel_LitersPerLap',
  'DataCorePlugin.GameData.RemainingLaps',
  'DataCorePlugin.GameData.TyreTempFrontLeft',
  'DataCorePlugin.GameData.TyreTempFrontRight',
  'DataCorePlugin.GameData.TyreTempRearLeft',
  'DataCorePlugin.GameData.TyreTempRearRight',
  'DataCorePlugin.GameData.TyreWearFrontLeft',
  'DataCorePlugin.GameData.TyreWearFrontRight',
  'DataCorePlugin.GameData.TyreWearRearLeft',
  'DataCorePlugin.GameData.TyreWearRearRight',
  'DataCorePlugin.GameRawData.Telemetry.dcBrakeBias',
  'DataCorePlugin.GameRawData.Telemetry.dcTractionControl',
  'DataCorePlugin.GameRawData.Telemetry.dcABS',
  'DataCorePlugin.GameRawData.Telemetry.dcAntiRollFront',
  'DataCorePlugin.GameRawData.Telemetry.dcAntiRollRear',
  'DataCorePlugin.GameData.Position',
  'DataCorePlugin.GameData.CurrentLap',
  'DataCorePlugin.GameData.BestLapTime',
  'DataCorePlugin.GameData.CarModel',
  'IRacingExtraProperties.iRacing_DriverInfo_IRating',
  'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Gap',
  'IRacingExtraProperties.iRacing_Opponent_Behind_Gap',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Name',
  'IRacingExtraProperties.iRacing_Opponent_Behind_Name',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_IRating',
  'IRacingExtraProperties.iRacing_Opponent_Behind_IRating',
  'DataCorePlugin.GameRawData.Telemetry.FrameRate',
  'DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle',
  'DataCorePlugin.GameData.SessionTimeSpan',
  'DataCorePlugin.GameData.CurrentLapTime',
  'DataCorePlugin.GameData.LastLapTime',
  'DataCorePlugin.GameData.RemainingTime',
  'DataCorePlugin.GameData.TotalLaps',
  'RacingDesk.Plugin.CommentaryVisible',
  'RacingDesk.Plugin.CommentaryText',
  'RacingDesk.Plugin.CommentaryTopicTitle',
  'RacingDesk.Plugin.CommentaryTopicId',
  'RacingDesk.Plugin.CommentaryCategory',
  'RacingDesk.Plugin.CommentarySentimentColor',
  'RacingDesk.Plugin.CommentarySeverity',
  // Incident Coach properties
  'RacingDesk.Plugin.DS.IncidentCoach.Active',
  'RacingDesk.Plugin.DS.IncidentCoach.LastIncidentLap',
  'RacingDesk.Plugin.DS.IncidentCoach.ThreatDrivers',
  'RacingDesk.Plugin.DS.IncidentCoach.ActiveAlert',
  'RacingDesk.Plugin.DS.IncidentCoach.RageScore',
  'RacingDesk.Plugin.DS.IncidentCoach.CooldownActive',
  'RacingDesk.Plugin.DS.IncidentCoach.SessionBehavior',
  // Strategy engine properties
  'RacingDesk.Plugin.Strategy.Visible',
  'RacingDesk.Plugin.Strategy.Text',
  'RacingDesk.Plugin.Strategy.Label',
  'RacingDesk.Plugin.Strategy.Severity',
  'RacingDesk.Plugin.Strategy.Color',
  'RacingDesk.Plugin.Strategy.TextColor',
  'RacingDesk.Plugin.Strategy.FuelLapsRemaining',
  'RacingDesk.Plugin.Strategy.FuelHealthState',
  'RacingDesk.Plugin.Strategy.CanMakeItToEnd',
  'RacingDesk.Plugin.Strategy.PitWindowOpen',
  'RacingDesk.Plugin.Strategy.PitWindowClose',
  'RacingDesk.Plugin.Strategy.TireHealthState',
  'RacingDesk.Plugin.Strategy.TireLapsRemaining',
  'RacingDesk.Plugin.Strategy.GripScore',
  'RacingDesk.Plugin.Strategy.StintNumber',
  'RacingDesk.Plugin.Strategy.StintLaps',
  'RacingDesk.Plugin.SessionTypeName',
  // Demo mode properties
  'RacingDesk.Plugin.DemoMode',
  'RacingDesk.Plugin.Demo.Gear',
  'RacingDesk.Plugin.Demo.Rpm',
  'RacingDesk.Plugin.Demo.MaxRpm',
  'RacingDesk.Plugin.Demo.SpeedMph',
  'RacingDesk.Plugin.Demo.Throttle',
  'RacingDesk.Plugin.Demo.Brake',
  'RacingDesk.Plugin.Demo.Clutch',
  'RacingDesk.Plugin.Demo.Fuel',
  'RacingDesk.Plugin.Demo.MaxFuel',
  'RacingDesk.Plugin.Demo.FuelPerLap',
  'RacingDesk.Plugin.Demo.RemainingLaps',
  'RacingDesk.Plugin.Demo.TyreTempFL',
  'RacingDesk.Plugin.Demo.TyreTempFR',
  'RacingDesk.Plugin.Demo.TyreTempRL',
  'RacingDesk.Plugin.Demo.TyreTempRR',
  'RacingDesk.Plugin.Demo.TyreWearFL',
  'RacingDesk.Plugin.Demo.TyreWearFR',
  'RacingDesk.Plugin.Demo.TyreWearRL',
  'RacingDesk.Plugin.Demo.TyreWearRR',
  'RacingDesk.Plugin.Demo.BrakeBias',
  'RacingDesk.Plugin.Demo.TC',
  'RacingDesk.Plugin.Demo.ABS',
  'RacingDesk.Plugin.Demo.SessionTypeName',
  'RacingDesk.Plugin.Demo.Position',
  'RacingDesk.Plugin.Demo.CurrentLap',
  'RacingDesk.Plugin.Demo.BestLapTime',
  'RacingDesk.Plugin.Demo.CarModel',
  'RacingDesk.Plugin.Demo.SessionTime',
  'RacingDesk.Plugin.Demo.CurrentLapTime',
  'RacingDesk.Plugin.Demo.LastLapTime',
  'RacingDesk.Plugin.Demo.RemainingTime',
  'RacingDesk.Plugin.Demo.TotalLaps',
  'RacingDesk.Plugin.Demo.IRating',
  'RacingDesk.Plugin.Demo.SafetyRating',
  'RacingDesk.Plugin.Demo.GapAhead',
  'RacingDesk.Plugin.Demo.GapBehind',
  'RacingDesk.Plugin.Demo.DriverAhead',
  'RacingDesk.Plugin.Demo.DriverBehind',
  'RacingDesk.Plugin.Demo.IRAhead',
  'RacingDesk.Plugin.Demo.IRBehind',
  // Datastream (advanced telemetry)
  'RacingDesk.Plugin.DS.LatG',
  'RacingDesk.Plugin.DS.LongG',
  'RacingDesk.Plugin.DS.YawRate',
  'RacingDesk.Plugin.DS.SteerTorque',
  'RacingDesk.Plugin.DS.TrackTemp',
  'RacingDesk.Plugin.DS.IncidentCount',
  'RacingDesk.Plugin.DS.EstimatedIRatingDelta',
  'RacingDesk.Plugin.DS.IRatingFieldSize',
  'RacingDesk.Plugin.DS.AbsActive',
  'RacingDesk.Plugin.DS.TcActive',
  'RacingDesk.Plugin.DS.TrackPct',
  'RacingDesk.Plugin.DS.LapDelta',
  'RacingDesk.Plugin.DS.CurrentSector',
  'RacingDesk.Plugin.DS.SectorCount',
  'RacingDesk.Plugin.DS.SectorSplits',
  'RacingDesk.Plugin.DS.SectorDeltas',
  'RacingDesk.Plugin.DS.SectorStates',
  'RacingDesk.Plugin.DS.SectorBoundaryPcts',
  'RacingDesk.Plugin.DS.SectorSplitS1',
  'RacingDesk.Plugin.DS.SectorSplitS2',
  'RacingDesk.Plugin.DS.SectorSplitS3',
  'RacingDesk.Plugin.DS.SectorDeltaS1',
  'RacingDesk.Plugin.DS.SectorDeltaS2',
  'RacingDesk.Plugin.DS.SectorDeltaS3',
  'RacingDesk.Plugin.DS.SectorStateS1',
  'RacingDesk.Plugin.DS.SectorStateS2',
  'RacingDesk.Plugin.DS.SectorStateS3',
  'RacingDesk.Plugin.DS.SectorS2StartPct',
  'RacingDesk.Plugin.DS.SectorS3StartPct',
  'RacingDesk.Plugin.DS.CompletedLaps',
  'RacingDesk.Plugin.DS.IsInPitLane',
  'RacingDesk.Plugin.DS.SessionMode',
  'RacingDesk.Plugin.DS.SessionModeName',
  'RacingDesk.Plugin.DS.IsLapRace',
  'RacingDesk.Plugin.DS.IsLapInvalid',
  'RacingDesk.Plugin.DS.SectorBests',
  'RacingDesk.Plugin.DS.SpeedKmh',
  'RacingDesk.Plugin.DS.PitLimiterOn',
  'RacingDesk.Plugin.DS.PitSpeedLimitKmh',
  // Computed DS.* (server-side calculations)
  'RacingDesk.Plugin.DS.ThrottleNorm',
  'RacingDesk.Plugin.DS.BrakeNorm',
  'RacingDesk.Plugin.DS.ClutchNorm',
  'RacingDesk.Plugin.DS.RpmRatio',
  'RacingDesk.Plugin.DS.FuelPct',
  'RacingDesk.Plugin.DS.FuelLapsRemaining',
  'RacingDesk.Plugin.DS.SpeedMph',
  'RacingDesk.Plugin.DS.PitSpeedLimitMph',
  'RacingDesk.Plugin.DS.IsPitSpeeding',
  'RacingDesk.Plugin.DS.IsNonRaceSession',
  'RacingDesk.Plugin.DS.IsTimedRace',
  'RacingDesk.Plugin.DS.IsEndOfRace',
  'RacingDesk.Plugin.DS.PositionDelta',
  'RacingDesk.Plugin.DS.StartPosition',
  'RacingDesk.Plugin.DS.RemainingTimeFormatted',
  'RacingDesk.Plugin.DS.SpeedDisplay',
  'RacingDesk.Plugin.DS.RpmDisplay',
  'RacingDesk.Plugin.DS.FuelFormatted',
  'RacingDesk.Plugin.DS.FuelPerLapFormatted',
  'RacingDesk.Plugin.DS.PitSuggestion',
  'RacingDesk.Plugin.DS.BBNorm',
  'RacingDesk.Plugin.DS.TCNorm',
  'RacingDesk.Plugin.DS.ABSNorm',
  'RacingDesk.Plugin.DS.PositionDeltaDisplay',
  'RacingDesk.Plugin.DS.LapDeltaDisplay',
  'RacingDesk.Plugin.DS.SafetyRatingDisplay',
  'RacingDesk.Plugin.DS.GapAheadFormatted',
  'RacingDesk.Plugin.DS.GapBehindFormatted',
  // Ambient light (screen color from C# plugin)
  'RacingDesk.Plugin.DS.AmbientR',
  'RacingDesk.Plugin.DS.AmbientG',
  'RacingDesk.Plugin.DS.AmbientB',
  'RacingDesk.Plugin.DS.AmbientHasData',
  // Demo Datastream
  'RacingDesk.Plugin.Demo.DS.LatG',
  'RacingDesk.Plugin.Demo.DS.LongG',
  'RacingDesk.Plugin.Demo.DS.YawRate',
  'RacingDesk.Plugin.Demo.DS.SteerTorque',
  'RacingDesk.Plugin.Demo.DS.TrackTemp',
  'RacingDesk.Plugin.Demo.DS.IncidentCount',
  'RacingDesk.Plugin.Demo.DS.AbsActive',
  'RacingDesk.Plugin.Demo.DS.TcActive',
  'RacingDesk.Plugin.Demo.DS.LapDelta',
  'RacingDesk.Plugin.Demo.DS.IsInPitLane',
  'RacingDesk.Plugin.Demo.DS.SessionMode',
  'RacingDesk.Plugin.Demo.DS.SessionModeName',
  'RacingDesk.Plugin.Demo.DS.IsLapRace',
  'RacingDesk.Plugin.Demo.DS.IsLapInvalid',
  'RacingDesk.Plugin.Demo.DS.SectorBests',
  'RacingDesk.Plugin.Demo.DS.SpeedKmh',
  'RacingDesk.Plugin.Demo.DS.PitLimiterOn',
  'RacingDesk.Plugin.Demo.DS.PitSpeedLimitKmh',
  // Demo Computed DS.*
  'RacingDesk.Plugin.Demo.DS.ThrottleNorm',
  'RacingDesk.Plugin.Demo.DS.BrakeNorm',
  'RacingDesk.Plugin.Demo.DS.ClutchNorm',
  'RacingDesk.Plugin.Demo.DS.RpmRatio',
  'RacingDesk.Plugin.Demo.DS.FuelPct',
  'RacingDesk.Plugin.Demo.DS.FuelLapsRemaining',
  'RacingDesk.Plugin.Demo.DS.SpeedMph',
  'RacingDesk.Plugin.Demo.DS.PitSpeedLimitMph',
  'RacingDesk.Plugin.Demo.DS.IsPitSpeeding',
  'RacingDesk.Plugin.Demo.DS.IsNonRaceSession',
  'RacingDesk.Plugin.Demo.DS.IsTimedRace',
  'RacingDesk.Plugin.Demo.DS.IsEndOfRace',
  'RacingDesk.Plugin.Demo.DS.PositionDelta',
  'RacingDesk.Plugin.Demo.DS.StartPosition',
  'RacingDesk.Plugin.Demo.DS.RemainingTimeFormatted',
  'RacingDesk.Plugin.Demo.DS.SpeedDisplay',
  'RacingDesk.Plugin.Demo.DS.RpmDisplay',
  'RacingDesk.Plugin.Demo.DS.FuelFormatted',
  'RacingDesk.Plugin.Demo.DS.FuelPerLapFormatted',
  'RacingDesk.Plugin.Demo.DS.PitSuggestion',
  'RacingDesk.Plugin.Demo.DS.BBNorm',
  'RacingDesk.Plugin.Demo.DS.TCNorm',
  'RacingDesk.Plugin.Demo.DS.ABSNorm',
  'RacingDesk.Plugin.Demo.DS.PositionDeltaDisplay',
  'RacingDesk.Plugin.Demo.DS.LapDeltaDisplay',
  'RacingDesk.Plugin.Demo.DS.SafetyRatingDisplay',
  'RacingDesk.Plugin.Demo.DS.GapAheadFormatted',
  'RacingDesk.Plugin.Demo.DS.GapBehindFormatted',
  // Track map
  'RacingDesk.Plugin.TrackMap.Ready',
  'RacingDesk.Plugin.TrackMap.TrackName',
  'RacingDesk.Plugin.TrackMap.SvgPath',
  'RacingDesk.Plugin.TrackMap.PlayerX',
  'RacingDesk.Plugin.TrackMap.PlayerY',
  'RacingDesk.Plugin.TrackMap.PlayerHeading',
  'RacingDesk.Plugin.TrackMap.Opponents',
  'DataCorePlugin.GameData.TrackName',
  // Leaderboard
  'RacingDesk.Plugin.Leaderboard',
  // Driver name
  'RacingDesk.Plugin.DriverFirstName',
  'RacingDesk.Plugin.DriverLastName',
  // Flag status
  'currentFlagState',
  // Grid / Formation state
  'RacingDesk.Plugin.Grid.SessionState',
  'RacingDesk.Plugin.Grid.GriddedCars',
  'RacingDesk.Plugin.Grid.TotalCars',
  'RacingDesk.Plugin.Grid.PaceMode',
  'RacingDesk.Plugin.Grid.StartType',
  'RacingDesk.Plugin.Grid.LightsPhase',
  'RacingDesk.Plugin.Demo.Grid.SessionState',
  'RacingDesk.Plugin.Demo.Grid.GriddedCars',
  'RacingDesk.Plugin.Demo.Grid.TotalCars',
  'RacingDesk.Plugin.Demo.Grid.PaceMode',
  'RacingDesk.Plugin.Demo.Grid.LightsPhase',
  'RacingDesk.Plugin.Demo.Grid.StartType',
  'RacingDesk.Plugin.Grid.TrackCountry',
  'RacingDesk.Plugin.Demo.Grid.TrackCountry',
  // Pit Box (iRacing pit stop selections + car adjustments)
  'RacingDesk.Plugin.PitBox.PitSvFlags',
  'RacingDesk.Plugin.PitBox.PitSvFuel',
  'RacingDesk.Plugin.PitBox.PitSvLFP',
  'RacingDesk.Plugin.PitBox.PitSvRFP',
  'RacingDesk.Plugin.PitBox.PitSvLRP',
  'RacingDesk.Plugin.PitBox.PitSvRRP',
  'RacingDesk.Plugin.PitBox.TireCompound',
  'RacingDesk.Plugin.PitBox.FastRepair',
  'RacingDesk.Plugin.PitBox.Windshield',
  'RacingDesk.Plugin.PitBox.TireLF',
  'RacingDesk.Plugin.PitBox.TireRF',
  'RacingDesk.Plugin.PitBox.TireLR',
  'RacingDesk.Plugin.PitBox.TireRR',
  'RacingDesk.Plugin.PitBox.TiresRequested',
  'RacingDesk.Plugin.PitBox.FuelRequested',
  'RacingDesk.Plugin.PitBox.FastRepairRequested',
  'RacingDesk.Plugin.PitBox.WindshieldRequested',
  'RacingDesk.Plugin.PitBox.FuelDisplay',
  'RacingDesk.Plugin.PitBox.PressureLF',
  'RacingDesk.Plugin.PitBox.PressureRF',
  'RacingDesk.Plugin.PitBox.PressureLR',
  'RacingDesk.Plugin.PitBox.PressureRR',
  // Car-specific adjustment availability
  'RacingDesk.Plugin.PitBox.HasTC',
  'RacingDesk.Plugin.PitBox.HasABS',
  'RacingDesk.Plugin.PitBox.HasARBFront',
  'RacingDesk.Plugin.PitBox.HasARBRear',
  'RacingDesk.Plugin.PitBox.HasEnginePower',
  'RacingDesk.Plugin.PitBox.HasFuelMixture',
  'RacingDesk.Plugin.PitBox.HasWeightJackerL',
  'RacingDesk.Plugin.PitBox.HasWeightJackerR',
  'RacingDesk.Plugin.PitBox.HasWingFront',
  'RacingDesk.Plugin.PitBox.HasWingRear',
  // Additional car adjustments
  'DataCorePlugin.GameRawData.Telemetry.dcEnginePower',
  'DataCorePlugin.GameRawData.Telemetry.dcFuelMixture',
  'DataCorePlugin.GameRawData.Telemetry.dcWeightJackerLeft',
  'DataCorePlugin.GameRawData.Telemetry.dcWeightJackerRight',
  'DataCorePlugin.GameRawData.Telemetry.dcWingFront',
  'DataCorePlugin.GameRawData.Telemetry.dcWingRear'
];

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE VARIABLES
// ═══════════════════════════════════════════════════════════════

// Polling & connection
let _pollFrame = 0;
let _pollActive = false;
let _pollIntervalId = null;    // current poll setInterval handle; rate varies with active state
let _latestSnapshot = null;
let _snapshotDirty = false;
let _connFails = 0;
let _backoffUntil = 0;
// How long a source that did not answer is left alone, at most. While the main process keeps the HUD on screen
// (he is in the car) that is one of its polls: a break shorter than the three seconds it takes the main process
// to say "out" would otherwise leave old numbers up for as long again after the telemetry is back.
let _backoffCapMs = 10000;
let _hasEverConnected = false;
let _settingsForcedByDisconnect = false;

// Game & session state
let _currentGameId = '';
let _isIRacing = true;
let _isRally = false;
let _rallyModeEnabled = false;
let _isIdle = true;            // true when not in a car — gates the heavy render path
// In the car or not (in-car.js). _isIdle is the immediate, per-frame gate for
// the renderer's own skip-render; _prevInRace is the steadied one — leaving has
// to last two seconds — that switches the page between active and dormant. In
// the app main.js decides it and tells the page; see poll-engine.js _setInCar.
let _prevInRace = false;
let _cycleFrameCount = 0;
let _cycleLastSwitch = 0;
let _prevLap = 0;

// Driver & car state
let _driverDisplayName = 'YOU';
let _lastCarModel = null;
let _lastDriverAhead = '';
let _lastDriverBehind = '';
let _lastPosition = 0;
let _gapsBestLap = 0;          // best lap time for gaps module (non-race)
let _gapsLastLap = 0;          // last completed lap for gaps module
let _gapsWorstLap = 0;         // worst valid lap time for gaps module
let _gapsLapNum = 0;           // current lap number for gaps module
let _gapsNonRaceMode = false;  // currently in non-race session
let _lapInvalid = false;       // true when incidents increased during current lap
let _prevSectorSplits = [];    // previous poll's sector splits — survives iRacing clearing on lap cross
let _prevSectorStates = [];    // previous poll's sector color states — retained across lap boundaries
let _prevTimerSector = 0;      // previous sector number for lap-race timer popup on sector transition
let _startPosition = 0;
let _prevBB = -1, _prevTC = -1, _prevABS = -1;
let _clutchSeenActive = false;
let _clutchHidden = false;
// Cached DOM refs for the clutch auto-hide path (see poll-engine.js).
// Looked up lazily on first flip; never re-queried.
let _clutchLabelEl = null;
let _clutchLayerEl = null;

// Session change detection (resets event history, timeline, etc.)
let _prevSessionTypeName = '';
let _prevGridState = 0;        // the last grid SessionState the page saw (0 is none): the green flag is 1-3 becoming 4
let _prevRaceMode = null;      // whether the session was a race, as body.session-race / body.session-nonrace says

// Manufacturer country flag trigger state
let _mfrFlagShownThisSession = false;  // prevent re-trigger within same session
let _mfrFlagPrevSessState = 0;         // previous grid SessionState
let _mfrFlagPrevInPit = true;          // previous pit lane state
let _mfrFlagPrevCompletedLaps = 0;     // previous completed laps

// Flag & race control
let _lastFlagState = 'none';
let _greenFlagTimeout = null;
let _rcTimeout = null;
let _rcVisible = false;
let _flagHoldUntil = 0;
let _flagHoldState = 'none';
let _prevCheckered = false;
let _forceFlagState = '';

// Race end screen
let _raceEndVisible = false;
let _raceEndTimer = null;

// Timer & UI
let _timerHideTimeout = null;
let _timerPinned = false;
let _commentaryWasVisible = false;
let _strategyWasVisible = false;
let _tcSeen = false;
let _absSeen = false;
let _carAdj = null;  // result from getCarAdjustability() for current car
let _tcFlashFrames = 0;   // TC active glow countdown (frames)
let _absFlashFrames = 0;  // ABS active glow countdown (frames)
// The car's controls by the canonical list (modules/js/car-controls.js): the panel, and what was last drawn
// of which car, so a change is flashed and announced and a new car starts clean.
let _carControlsPanel = null;
let _carControlsState = { car: null, last: null, values: null, cc: null };

// Grid / Formation
let _gridActive = false;
let _gridLightsPhase = 0;
let _gridPrevSessionState = 4;
let _gridFadeTimer = null;

// Cycles & animations
const _cycleIntervalFrames = Math.round(10000 / POLL_MS); // 10s

// ═══════════════════════════════════════════════════════════════
// DEMO MODE MODELS
// ═══════════════════════════════════════════════════════════════

const _demoModels = {
  bmw:'M4 GT3', mclaren:'720S GT3', mazda:'MX-5 Cup', nissan:'GTP ZX-T',
  dallara:'IR-04', ferrari:'296 GT3', porsche:'911 GT3 R', audi:'R8 LMS',
  mercedes:'AMG GT3', lamborghini:'Huracán GT3', chevrolet:'Corvette Z06',
  ford:'Mustang GT3', toyota:'GR86', hyundai:'Elantra N TC',
  cadillac:'V-Series.R', astonmartin:'Vantage GT3', lotus:'Emira GT4',
  honda:'Civic Type R', ligier:'JS P320'
};

// ═══════════════════════════════════════════════════════════════
// MANUFACTURER BRANDING
// ═══════════════════════════════════════════════════════════════

const _defaultLogoBg = 'hsla(0, 0%, 12%, 1.0)';

const _mfrBrandColors = {
  bmw:         'hsla(204, 100%, 45%, 0.55)',
  mclaren:     'hsla(24, 100%, 52%, 0.55)',
  mazda:       'hsla(0, 90%, 44%, 0.55)',
  nissan:      'hsla(0, 85%, 50%, 0.55)',
  dallara:     'hsla(210, 85%, 48%, 0.55)',
  ferrari:     'hsla(0, 90%, 48%, 0.55)',
  porsche:     'hsla(0, 0%, 50%, 0.50)',
  audi:        'hsla(0, 0%, 50%, 0.50)',
  mercedes:    'hsla(175, 65%, 42%, 0.52)',
  lamborghini: 'hsla(48, 90%, 48%, 0.52)',
  chevrolet:   'hsla(40, 62%, 38%, 0.55)',
  ford:        'hsla(237, 100%, 28%, 0.55)',
  toyota:      'hsla(0, 85%, 48%, 0.55)',
  hyundai:     'hsla(216, 85%, 45%, 0.55)',
  cadillac:    'hsla(0, 0%, 50%, 0.50)',
  astonmartin: 'hsla(155, 70%, 38%, 0.55)',
  lotus:       'hsla(57, 100%, 50%, 0.55)',
  ligier:      'hsla(204, 78%, 40%, 0.55)',
  fia:         'hsla(228, 73%, 21%, 0.55)',
  radical:     'hsla(43, 82%, 57%, 0.55)',
  honda:       'hsla(0, 90%, 42%, 0.55)'
};

// Manufacturer → ISO 3166-1 alpha-2 country code (used for flag display)
const _mfrCountry = {
  bmw: 'DE', mclaren: 'GB', mazda: 'JP', nissan: 'JP',
  dallara: 'IT', ferrari: 'IT', porsche: 'DE', audi: 'DE',
  mercedes: 'DE', lamborghini: 'IT', chevrolet: 'US', ford: 'US',
  toyota: 'JP', hyundai: 'KR', cadillac: 'US', astonmartin: 'GB',
  lotus: 'GB', honda: 'JP', ligier: 'FR', fia: 'FR', radical: 'GB'
};

const _mfrMap = {
  'bmw':'bmw', 'm4 gt':'bmw', 'm8 gte':'bmw', 'm hybrid':'bmw',
  'mclaren':'mclaren', 'mp4':'mclaren',
  'mazda':'mazda', 'mx-5':'mazda', 'miata':'mazda',
  'nissan':'nissan', 'gtp zx':'nissan', 'nismo':'nissan',
  'fia f4':'fia', 'fia':'fia',
  'dallara':'dallara', 'ir-01':'dallara', 'ir01':'dallara', 'ir-04':'dallara', 'ir04':'dallara',
  'ferrari':'ferrari', '488':'ferrari', '296':'ferrari', 'sf-23':'ferrari',
  'porsche':'porsche', '911':'porsche', 'cayman':'porsche', 'boxter':'porsche', '918':'porsche',
  'audi':'audi', 'r8':'audi', 'rs e-tron gt':'audi', 'e-tron gt':'audi',
  'mercedes':'mercedes', 'amg gt':'mercedes', 'hypercar':'mercedes',
  'lamborghini':'lamborghini', 'huracán':'lamborghini', 'huracan':'lamborghini', 'urus':'lamborghini',
  'chevrolet':'chevrolet', 'corvette':'chevrolet', 'chevy':'chevrolet', 'c8':'chevrolet',
  'ford':'ford', 'mustang':'ford', 'ford gt':'ford', 'mk iv':'ford',
  'toyota':'toyota', 'gr86':'toyota', 'gr corolla':'toyota',
  'hyundai':'hyundai', 'elantra':'hyundai', 'ioniq':'hyundai',
  'cadillac':'cadillac', 'v-series':'cadillac',
  'aston martin':'astonmartin', 'vantage':'astonmartin', 'dbs':'astonmartin',
  'lotus':'lotus', 'emira':'lotus', 'evija':'lotus',
  'honda':'honda', 'civic':'honda', 'nsx':'honda',
  'ligier':'ligier', 'js p3':'ligier', 'js p320':'ligier',
  'radical':'radical', 'sr10':'radical', 'sr8':'radical', 'sr3':'radical',
  'generic':'generic', 'none':'none'
};

// Precompile word-boundary regexes from _mfrMap keys so short keys like 'r8'
// don't match substrings of other models (e.g. 'gr86'). Left-anchor only —
// a trailing \b would break keys like 'm4 gt' matching 'm4 gt3'.
function _escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const _mfrPatterns = Object.keys(_mfrMap).map(k => ({
  re: new RegExp('\\b' + _escRegex(k), 'i'),
  mfr: _mfrMap[k]
}));

/** Match a car model string to a manufacturer key in _mfrMap */
function detectMfr(model) {
  if (!model) return 'none';
  const s = '' + model;
  for (const { re, mfr } of _mfrPatterns) {
    if (re.test(s)) return mfr;
  }
  return 'generic';
}

// ═══════════════════════════════════════════════════════════════
// CAR ADJUSTABILITY — cars that truly lack BB/ABS/TC systems
// These cars physically don't have the system, so we HIDE the module.
// Cars not listed here that report 0 are assumed FIXED (setup-locked).
// Each entry: substring match → { noBB, noABS, noTC, absNoAdjust }
// absNoAdjust: true = ABS exists but isn't adjustable by driver (show when active)
// noABS: true = no ABS system at all (hide completely)
// ═══════════════════════════════════════════════════════════════
const _carNoAdjust = [
  // Formula / Open-wheel (no ABS, no TC in almost all)
  { match: 'formula vee',      noBB: false, noABS: true, noTC: true },
  { match: 'skip barber',      noBB: false, noABS: true, noTC: true },
  { match: 'usf 2000',         noBB: false, noABS: true, noTC: true },
  { match: 'usf2000',          noBB: false, noABS: true, noTC: true },
  { match: 'indy pro 2000',    noBB: false, noABS: true, noTC: true },
  { match: 'formula 4',        noBB: false, noABS: true, noTC: true },
  { match: 'fia f4',           noBB: false, noABS: true, noTC: true },
  { match: 'ir-04',            noBB: false, noABS: true, noTC: true },
  { match: 'dallara f3',       noBB: false, noABS: true, noTC: true },
  { match: 'lotus 49',         noBB: true,  noABS: true, noTC: true },
  { match: 'lotus 79',         noBB: false, noABS: true, noTC: true },
  { match: 'mp4-30',           noBB: false, noABS: true, noTC: true },
  { match: 'w12',              noBB: false, noABS: true, noTC: true },
  { match: 'w13',              noBB: false, noABS: true, noTC: true },
  // LMP / Prototype (no ABS typically)
  { match: 'js p320',          noBB: false, noABS: true, noTC: false },
  { match: 'ligier js',        noBB: false, noABS: true, noTC: false },
  // Porsche Cup (no ABS, no TC on 992.1)
  { match: '992 cup',          noBB: false, noABS: true, noTC: true },
  { match: 'gt3 cup',          noBB: false, noABS: true, noTC: true },
  // V8 Supercars (no ABS, no TC)
  { match: 'supercars',        noBB: false, noABS: true, noTC: true },
  { match: 'supercar',         noBB: false, noABS: true, noTC: true },
  { match: 'ford falcon',      noBB: false, noABS: true, noTC: true },
  { match: 'holden commodore',  noBB: false, noABS: true, noTC: true },
  { match: 'gen3 camaro',      noBB: false, noABS: true, noTC: true },
  { match: 'gen3 mustang',     noBB: false, noABS: true, noTC: true },
  // Vintage / spec
  { match: 'spec racer',       noBB: false, noABS: true, noTC: true },
  { match: 'legends',          noBB: true,  noABS: true, noTC: true },
  { match: '34 ford',          noBB: true,  noABS: true, noTC: true },
  // Production-based (ABS exists but not adjustable, no TC in iRacing implementation)
  { match: 'mx-5 cup',         noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'mx-5 roadster',    noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'mx-5',             noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'gr86',             noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'solstice',         noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  // NASCAR / Oval (no ABS, no TC)
  { match: 'nascar',           noBB: false, noABS: true, noTC: true },
  { match: 'gen 6',            noBB: false, noABS: true, noTC: true },
  { match: 'next gen',         noBB: false, noABS: true, noTC: true },
  { match: 'trucks',           noBB: false, noABS: true, noTC: true },
  { match: 'street stock',     noBB: true,  noABS: true, noTC: true },
  { match: 'late model',       noBB: false, noABS: true, noTC: true },
  { match: 'modified',         noBB: false, noABS: true, noTC: true },
  { match: 'silver crown',     noBB: false, noABS: true, noTC: true },
  { match: 'sprint car',       noBB: false, noABS: true, noTC: true },
  { match: 'midget',           noBB: false, noABS: true, noTC: true },
  { match: 'dirt',             noBB: false, noABS: true, noTC: true },
];

/** Check car model string against no-adjust list. Returns {noBB, noABS, noTC} or null. */
function getCarAdjustability(model) {
  if (!model) return null;
  const l = ('' + model).toLowerCase();
  for (const entry of _carNoAdjust) {
    if (l.indexOf(entry.match) !== -1) return entry;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS SYSTEM
// ═══════════════════════════════════════════════════════════════

const _defaultSettings = {
  showFuel: true, showTyres: true, showControls: true, showPedals: true,
  showPosition: true, showTacho: true, showCommentary: true,
  showMaps: true, showTimer: true,
  showK10Logo: true, showCarLogo: true, showGameLogo: true, simhubUrl: 'http://localhost:8889/racing-desk/',
  layoutPosition: 'top-right',
  greenScreen: false, showWebGL: true, showBonkers: true, ambientMode: 'reflective',
  zoom: 165, forceFlag: '', showLeaderboard: true, showDatastream: true, showPitBox: true, showIncidents: true, showSpotter: true,
  incPenalty: 17, incDQ: 25,
  discordUser: null,
  rallyMode: false,
  driveMode: false,
  // Visual modes and effects
  visualPreset: 'standard',  // 'standard', 'minimal', 'minimal-plus'
  showBorders: true,
  showSentimentHalo: true,
  showCommentaryGlow: true,
  showRcAnimation: true,
  showRedlineFlash: true,
  // Leaderboard
  lbFocus: 'me',        // 'me' = center on player, 'lead' = show from P1
  lbMaxRows: 10,        // max visible opponent rows (increased from 5 to show more of full field)
  lbExpandToFill: false, // override lbMaxRows to fill available screen space
  // Datastream field toggles
  dsShowGforce: true,
  dsShowYaw: true,
  dsShowFfb: true,
  dsShowDelta: true,
  dsShowTrackTemp: true,
  dsShowFps: true,
  // Y-offset for bottom-positioned modules
  bottomYOffset: 0,
  // Logo subtitle text
  logoSubtitle: '',
  // AI Race Coach
  agentKey: '',
  coachTone: 'coach',    // 'broadcast', 'coach', 'mentor'
  coachDepth: 'standard', // 'quick', 'standard', 'deep'
  theme: 'dark',               // 'dark' or 'light'
  // Screen recording
  recordingQuality: 'high',     // 'low', 'medium', 'high'
  recordingMic: true,           // include microphone audio
  recordingMicDevice: '',       // WinRT DeviceInformation.Id from host picker (or Chromium id for legacy saves)
  recordingMicLabel: '',        // Friendly name; overlay uses this to resolve to a Chromium deviceId at record-start
  recordingSystemAudioDevice: '',// WinRT DeviceInformation.Id for the virtual audio cable
  recordingSystemAudioLabel: '',// Friendly name companion to recordingSystemAudioDevice
  recordingMicVolume: 0.8,      // 0.0–1.0 — mic gain in the mix
  recordingSystemVolume: 1.0,   // 0.0–1.0 — system/game audio gain
  recordingWebcamDevice: '',    // WinRT DeviceInformation.Id — empty = no facecam
  recordingWebcamLabel: '',     // Friendly name companion to recordingWebcamDevice
  recordingFacecam: null,       // { width, height, x, y, margin, ... }
  recordingFacecamSize: 'medium', // 'small', 'medium', 'large'
  recordingFacecamPos: 'bottom-right', // 'bottom-right', 'bottom-left', 'top-right', 'top-left'
  recordingDirectory: '',       // empty = system Videos folder
  recordingOutputFormat: 'mp4', // 'mp4' (transcode) or 'webm' (raw)
  recordingEncoder: 'auto',    // 'auto', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'
  recordingDeleteSource: true,  // delete .webm after successful MP4 transcode
  // Phase 4: Smart recording
  recordingAutoRecord: false,   // auto-start/stop based on pit lane + session
  recordingAutoStopOnPit: true, // stop recording on pit entry (stint split)
  // Phase 4: Replay buffer
  replayBufferEnabled: false,   // keep rolling buffer in memory
  replayBufferDuration: 60,     // buffer length in seconds (30–120)
  // Commentary — the authoritative copy lives here, and nothing relays it to the
  // plugin: the runtime has no setSetting route (settings.js).
  commentaryPromptDuration: 15,        // seconds a prompt stays on screen (5–120)
  commentaryShowTopicTitle: true,      // show topic title above commentary text
  commentaryEventOnlyMode: false,      // suppress periodic commentary; only fire on events
  commentaryCatHardware: true,         // category filter: hardware
  commentaryCatGameFeel: true,         // category filter: game_feel
  commentaryCatCarResponse: true,      // category filter: car_response
  commentaryCatRacingExperience: true, // category filter: racing_experience
  commentaryDriverFirstName: '',       // used for 3rd-person commentary
  commentaryDriverLastName: '',
  commentaryDemoMode: false,           // plugin's commentary demo loop
};

let _settings = Object.assign({}, _defaultSettings);

// Discord state
let _discordUser = null;

// K10 The Racing Desk state (set by connections.js on startup)
// Declared here so game-detect.js and other early scripts can reference it
// Must use var (not let) so these attach to window — session-sync.js (IIFE)
// accesses them as window._k10User / window._k10Features.
var _k10User = null;
var _k10Features = [];
var _k10Token = null;

// Logo cycling
let _currentCarLogoIdx = 0;
let _currentCarLogo = '';
let _logoCycleTimer = null;  // Will be initialized when car-logos.js runs

// ─── Utility: session type detection ───
function _isNonRaceSession(sessionType) {
  if (!sessionType) return false;
  const s = sessionType.toLowerCase();
  return s.includes('practice') || s.includes('qualify') || s.includes('test') || s.includes('warmup') || s.includes('warm up');
}

// ─── Utility: format lap time (seconds → m:ss.xxx) ───
function _fmtLapTime(secs) {
  if (secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
