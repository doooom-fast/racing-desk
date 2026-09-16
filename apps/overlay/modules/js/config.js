// K10 Motorsports Dashboard — Shared Configuration & State
// This module defines all global constants and state variables used across other modules.
// All variables are implicitly global (shared scope) since modules load via <script src> tags.

// ═══════════════════════════════════════════════════════════════
// SIMHUB HTTP API CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const SIMHUB_URL = 'http://localhost:8889/racecor-io-pro-drive/';
const POLL_MS = 33; // ~30fps when in a car
const IDLE_POLL_MS = 1000; // slow poll when not in a car — just enough to detect entry

// All properties we need, batched into a single request
const PROP_KEYS = [
  'DataCorePlugin.GameRunning',
  'RaceCorProDrive.Plugin.GameId',
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
  'RaceCorProDrive.Plugin.CommentaryVisible',
  'RaceCorProDrive.Plugin.CommentaryText',
  'RaceCorProDrive.Plugin.CommentaryTopicTitle',
  'RaceCorProDrive.Plugin.CommentaryTopicId',
  'RaceCorProDrive.Plugin.CommentaryCategory',
  'RaceCorProDrive.Plugin.CommentarySentimentColor',
  'RaceCorProDrive.Plugin.CommentarySeverity',
  // Incident Coach properties
  'RaceCorProDrive.Plugin.DS.IncidentCoach.Active',
  'RaceCorProDrive.Plugin.DS.IncidentCoach.LastIncidentLap',
  'RaceCorProDrive.Plugin.DS.IncidentCoach.ThreatDrivers',
  'RaceCorProDrive.Plugin.DS.IncidentCoach.ActiveAlert',
  'RaceCorProDrive.Plugin.DS.IncidentCoach.RageScore',
  'RaceCorProDrive.Plugin.DS.IncidentCoach.CooldownActive',
  'RaceCorProDrive.Plugin.DS.IncidentCoach.SessionBehavior',
  // Strategy engine properties
  'RaceCorProDrive.Plugin.Strategy.Visible',
  'RaceCorProDrive.Plugin.Strategy.Text',
  'RaceCorProDrive.Plugin.Strategy.Label',
  'RaceCorProDrive.Plugin.Strategy.Severity',
  'RaceCorProDrive.Plugin.Strategy.Color',
  'RaceCorProDrive.Plugin.Strategy.TextColor',
  'RaceCorProDrive.Plugin.Strategy.FuelLapsRemaining',
  'RaceCorProDrive.Plugin.Strategy.FuelHealthState',
  'RaceCorProDrive.Plugin.Strategy.CanMakeItToEnd',
  'RaceCorProDrive.Plugin.Strategy.PitWindowOpen',
  'RaceCorProDrive.Plugin.Strategy.PitWindowClose',
  'RaceCorProDrive.Plugin.Strategy.TireHealthState',
  'RaceCorProDrive.Plugin.Strategy.TireLapsRemaining',
  'RaceCorProDrive.Plugin.Strategy.GripScore',
  'RaceCorProDrive.Plugin.Strategy.StintNumber',
  'RaceCorProDrive.Plugin.Strategy.StintLaps',
  'RaceCorProDrive.Plugin.SessionTypeName',
  // Demo mode properties
  'RaceCorProDrive.Plugin.DemoMode',
  'RaceCorProDrive.Plugin.Demo.Gear',
  'RaceCorProDrive.Plugin.Demo.Rpm',
  'RaceCorProDrive.Plugin.Demo.MaxRpm',
  'RaceCorProDrive.Plugin.Demo.SpeedMph',
  'RaceCorProDrive.Plugin.Demo.Throttle',
  'RaceCorProDrive.Plugin.Demo.Brake',
  'RaceCorProDrive.Plugin.Demo.Clutch',
  'RaceCorProDrive.Plugin.Demo.Fuel',
  'RaceCorProDrive.Plugin.Demo.MaxFuel',
  'RaceCorProDrive.Plugin.Demo.FuelPerLap',
  'RaceCorProDrive.Plugin.Demo.RemainingLaps',
  'RaceCorProDrive.Plugin.Demo.TyreTempFL',
  'RaceCorProDrive.Plugin.Demo.TyreTempFR',
  'RaceCorProDrive.Plugin.Demo.TyreTempRL',
  'RaceCorProDrive.Plugin.Demo.TyreTempRR',
  'RaceCorProDrive.Plugin.Demo.TyreWearFL',
  'RaceCorProDrive.Plugin.Demo.TyreWearFR',
  'RaceCorProDrive.Plugin.Demo.TyreWearRL',
  'RaceCorProDrive.Plugin.Demo.TyreWearRR',
  'RaceCorProDrive.Plugin.Demo.BrakeBias',
  'RaceCorProDrive.Plugin.Demo.TC',
  'RaceCorProDrive.Plugin.Demo.ABS',
  'RaceCorProDrive.Plugin.Demo.SessionTypeName',
  'RaceCorProDrive.Plugin.Demo.Position',
  'RaceCorProDrive.Plugin.Demo.CurrentLap',
  'RaceCorProDrive.Plugin.Demo.BestLapTime',
  'RaceCorProDrive.Plugin.Demo.CarModel',
  'RaceCorProDrive.Plugin.Demo.SessionTime',
  'RaceCorProDrive.Plugin.Demo.CurrentLapTime',
  'RaceCorProDrive.Plugin.Demo.LastLapTime',
  'RaceCorProDrive.Plugin.Demo.RemainingTime',
  'RaceCorProDrive.Plugin.Demo.TotalLaps',
  'RaceCorProDrive.Plugin.Demo.IRating',
  'RaceCorProDrive.Plugin.Demo.SafetyRating',
  'RaceCorProDrive.Plugin.Demo.GapAhead',
  'RaceCorProDrive.Plugin.Demo.GapBehind',
  'RaceCorProDrive.Plugin.Demo.DriverAhead',
  'RaceCorProDrive.Plugin.Demo.DriverBehind',
  'RaceCorProDrive.Plugin.Demo.IRAhead',
  'RaceCorProDrive.Plugin.Demo.IRBehind',
  // Datastream (advanced telemetry)
  'RaceCorProDrive.Plugin.DS.LatG',
  'RaceCorProDrive.Plugin.DS.LongG',
  'RaceCorProDrive.Plugin.DS.YawRate',
  'RaceCorProDrive.Plugin.DS.SteerTorque',
  'RaceCorProDrive.Plugin.DS.TrackTemp',
  'RaceCorProDrive.Plugin.DS.IncidentCount',
  'RaceCorProDrive.Plugin.DS.EstimatedIRatingDelta',
  'RaceCorProDrive.Plugin.DS.IRatingFieldSize',
  'RaceCorProDrive.Plugin.DS.AbsActive',
  'RaceCorProDrive.Plugin.DS.TcActive',
  'RaceCorProDrive.Plugin.DS.TrackPct',
  'RaceCorProDrive.Plugin.DS.LapDelta',
  'RaceCorProDrive.Plugin.DS.CurrentSector',
  'RaceCorProDrive.Plugin.DS.SectorCount',
  'RaceCorProDrive.Plugin.DS.SectorSplits',
  'RaceCorProDrive.Plugin.DS.SectorDeltas',
  'RaceCorProDrive.Plugin.DS.SectorStates',
  'RaceCorProDrive.Plugin.DS.SectorBoundaryPcts',
  'RaceCorProDrive.Plugin.DS.SectorSplitS1',
  'RaceCorProDrive.Plugin.DS.SectorSplitS2',
  'RaceCorProDrive.Plugin.DS.SectorSplitS3',
  'RaceCorProDrive.Plugin.DS.SectorDeltaS1',
  'RaceCorProDrive.Plugin.DS.SectorDeltaS2',
  'RaceCorProDrive.Plugin.DS.SectorDeltaS3',
  'RaceCorProDrive.Plugin.DS.SectorStateS1',
  'RaceCorProDrive.Plugin.DS.SectorStateS2',
  'RaceCorProDrive.Plugin.DS.SectorStateS3',
  'RaceCorProDrive.Plugin.DS.SectorS2StartPct',
  'RaceCorProDrive.Plugin.DS.SectorS3StartPct',
  'RaceCorProDrive.Plugin.DS.CompletedLaps',
  'RaceCorProDrive.Plugin.DS.IsInPitLane',
  'RaceCorProDrive.Plugin.DS.SessionMode',
  'RaceCorProDrive.Plugin.DS.SessionModeName',
  'RaceCorProDrive.Plugin.DS.IsLapRace',
  'RaceCorProDrive.Plugin.DS.IsLapInvalid',
  'RaceCorProDrive.Plugin.DS.SectorBests',
  'RaceCorProDrive.Plugin.DS.SpeedKmh',
  'RaceCorProDrive.Plugin.DS.PitLimiterOn',
  'RaceCorProDrive.Plugin.DS.PitSpeedLimitKmh',
  // Computed DS.* (server-side calculations)
  'RaceCorProDrive.Plugin.DS.ThrottleNorm',
  'RaceCorProDrive.Plugin.DS.BrakeNorm',
  'RaceCorProDrive.Plugin.DS.ClutchNorm',
  'RaceCorProDrive.Plugin.DS.RpmRatio',
  'RaceCorProDrive.Plugin.DS.FuelPct',
  'RaceCorProDrive.Plugin.DS.FuelLapsRemaining',
  'RaceCorProDrive.Plugin.DS.SpeedMph',
  'RaceCorProDrive.Plugin.DS.PitSpeedLimitMph',
  'RaceCorProDrive.Plugin.DS.IsPitSpeeding',
  'RaceCorProDrive.Plugin.DS.IsNonRaceSession',
  'RaceCorProDrive.Plugin.DS.IsTimedRace',
  'RaceCorProDrive.Plugin.DS.IsEndOfRace',
  'RaceCorProDrive.Plugin.DS.PositionDelta',
  'RaceCorProDrive.Plugin.DS.StartPosition',
  'RaceCorProDrive.Plugin.DS.RemainingTimeFormatted',
  'RaceCorProDrive.Plugin.DS.SpeedDisplay',
  'RaceCorProDrive.Plugin.DS.RpmDisplay',
  'RaceCorProDrive.Plugin.DS.FuelFormatted',
  'RaceCorProDrive.Plugin.DS.FuelPerLapFormatted',
  'RaceCorProDrive.Plugin.DS.PitSuggestion',
  'RaceCorProDrive.Plugin.DS.BBNorm',
  'RaceCorProDrive.Plugin.DS.TCNorm',
  'RaceCorProDrive.Plugin.DS.ABSNorm',
  'RaceCorProDrive.Plugin.DS.PositionDeltaDisplay',
  'RaceCorProDrive.Plugin.DS.LapDeltaDisplay',
  'RaceCorProDrive.Plugin.DS.SafetyRatingDisplay',
  'RaceCorProDrive.Plugin.DS.GapAheadFormatted',
  'RaceCorProDrive.Plugin.DS.GapBehindFormatted',
  // Ambient light (screen color from C# plugin)
  'RaceCorProDrive.Plugin.DS.AmbientR',
  'RaceCorProDrive.Plugin.DS.AmbientG',
  'RaceCorProDrive.Plugin.DS.AmbientB',
  'RaceCorProDrive.Plugin.DS.AmbientHasData',
  // Demo Datastream
  'RaceCorProDrive.Plugin.Demo.DS.LatG',
  'RaceCorProDrive.Plugin.Demo.DS.LongG',
  'RaceCorProDrive.Plugin.Demo.DS.YawRate',
  'RaceCorProDrive.Plugin.Demo.DS.SteerTorque',
  'RaceCorProDrive.Plugin.Demo.DS.TrackTemp',
  'RaceCorProDrive.Plugin.Demo.DS.IncidentCount',
  'RaceCorProDrive.Plugin.Demo.DS.AbsActive',
  'RaceCorProDrive.Plugin.Demo.DS.TcActive',
  'RaceCorProDrive.Plugin.Demo.DS.LapDelta',
  'RaceCorProDrive.Plugin.Demo.DS.IsInPitLane',
  'RaceCorProDrive.Plugin.Demo.DS.SessionMode',
  'RaceCorProDrive.Plugin.Demo.DS.SessionModeName',
  'RaceCorProDrive.Plugin.Demo.DS.IsLapRace',
  'RaceCorProDrive.Plugin.Demo.DS.IsLapInvalid',
  'RaceCorProDrive.Plugin.Demo.DS.SectorBests',
  'RaceCorProDrive.Plugin.Demo.DS.SpeedKmh',
  'RaceCorProDrive.Plugin.Demo.DS.PitLimiterOn',
  'RaceCorProDrive.Plugin.Demo.DS.PitSpeedLimitKmh',
  // Demo Computed DS.*
  'RaceCorProDrive.Plugin.Demo.DS.ThrottleNorm',
  'RaceCorProDrive.Plugin.Demo.DS.BrakeNorm',
  'RaceCorProDrive.Plugin.Demo.DS.ClutchNorm',
  'RaceCorProDrive.Plugin.Demo.DS.RpmRatio',
  'RaceCorProDrive.Plugin.Demo.DS.FuelPct',
  'RaceCorProDrive.Plugin.Demo.DS.FuelLapsRemaining',
  'RaceCorProDrive.Plugin.Demo.DS.SpeedMph',
  'RaceCorProDrive.Plugin.Demo.DS.PitSpeedLimitMph',
  'RaceCorProDrive.Plugin.Demo.DS.IsPitSpeeding',
  'RaceCorProDrive.Plugin.Demo.DS.IsNonRaceSession',
  'RaceCorProDrive.Plugin.Demo.DS.IsTimedRace',
  'RaceCorProDrive.Plugin.Demo.DS.IsEndOfRace',
  'RaceCorProDrive.Plugin.Demo.DS.PositionDelta',
  'RaceCorProDrive.Plugin.Demo.DS.StartPosition',
  'RaceCorProDrive.Plugin.Demo.DS.RemainingTimeFormatted',
  'RaceCorProDrive.Plugin.Demo.DS.SpeedDisplay',
  'RaceCorProDrive.Plugin.Demo.DS.RpmDisplay',
  'RaceCorProDrive.Plugin.Demo.DS.FuelFormatted',
  'RaceCorProDrive.Plugin.Demo.DS.FuelPerLapFormatted',
  'RaceCorProDrive.Plugin.Demo.DS.PitSuggestion',
  'RaceCorProDrive.Plugin.Demo.DS.BBNorm',
  'RaceCorProDrive.Plugin.Demo.DS.TCNorm',
  'RaceCorProDrive.Plugin.Demo.DS.ABSNorm',
  'RaceCorProDrive.Plugin.Demo.DS.PositionDeltaDisplay',
  'RaceCorProDrive.Plugin.Demo.DS.LapDeltaDisplay',
  'RaceCorProDrive.Plugin.Demo.DS.SafetyRatingDisplay',
  'RaceCorProDrive.Plugin.Demo.DS.GapAheadFormatted',
  'RaceCorProDrive.Plugin.Demo.DS.GapBehindFormatted',
  // Track map
  'RaceCorProDrive.Plugin.TrackMap.Ready',
  'RaceCorProDrive.Plugin.TrackMap.TrackName',
  'RaceCorProDrive.Plugin.TrackMap.SvgPath',
  'RaceCorProDrive.Plugin.TrackMap.PlayerX',
  'RaceCorProDrive.Plugin.TrackMap.PlayerY',
  'RaceCorProDrive.Plugin.TrackMap.PlayerHeading',
  'RaceCorProDrive.Plugin.TrackMap.Opponents',
  'DataCorePlugin.GameData.TrackName',
  // Leaderboard
  'RaceCorProDrive.Plugin.Leaderboard',
  // Driver name
  'RaceCorProDrive.Plugin.DriverFirstName',
  'RaceCorProDrive.Plugin.DriverLastName',
  // Flag status
  'currentFlagState',
  // Grid / Formation state
  'RaceCorProDrive.Plugin.Grid.SessionState',
  'RaceCorProDrive.Plugin.Grid.GriddedCars',
  'RaceCorProDrive.Plugin.Grid.TotalCars',
  'RaceCorProDrive.Plugin.Grid.PaceMode',
  'RaceCorProDrive.Plugin.Grid.StartType',
  'RaceCorProDrive.Plugin.Grid.LightsPhase',
  'RaceCorProDrive.Plugin.Demo.Grid.SessionState',
  'RaceCorProDrive.Plugin.Demo.Grid.GriddedCars',
  'RaceCorProDrive.Plugin.Demo.Grid.TotalCars',
  'RaceCorProDrive.Plugin.Demo.Grid.PaceMode',
  'RaceCorProDrive.Plugin.Demo.Grid.LightsPhase',
  'RaceCorProDrive.Plugin.Demo.Grid.StartType',
  'RaceCorProDrive.Plugin.Grid.TrackCountry',
  'RaceCorProDrive.Plugin.Demo.Grid.TrackCountry',
  // Pit Box (iRacing pit stop selections + car adjustments)
  'RaceCorProDrive.Plugin.PitBox.PitSvFlags',
  'RaceCorProDrive.Plugin.PitBox.PitSvFuel',
  'RaceCorProDrive.Plugin.PitBox.PitSvLFP',
  'RaceCorProDrive.Plugin.PitBox.PitSvRFP',
  'RaceCorProDrive.Plugin.PitBox.PitSvLRP',
  'RaceCorProDrive.Plugin.PitBox.PitSvRRP',
  'RaceCorProDrive.Plugin.PitBox.TireCompound',
  'RaceCorProDrive.Plugin.PitBox.FastRepair',
  'RaceCorProDrive.Plugin.PitBox.Windshield',
  'RaceCorProDrive.Plugin.PitBox.TireLF',
  'RaceCorProDrive.Plugin.PitBox.TireRF',
  'RaceCorProDrive.Plugin.PitBox.TireLR',
  'RaceCorProDrive.Plugin.PitBox.TireRR',
  'RaceCorProDrive.Plugin.PitBox.TiresRequested',
  'RaceCorProDrive.Plugin.PitBox.FuelRequested',
  'RaceCorProDrive.Plugin.PitBox.FastRepairRequested',
  'RaceCorProDrive.Plugin.PitBox.WindshieldRequested',
  'RaceCorProDrive.Plugin.PitBox.FuelDisplay',
  'RaceCorProDrive.Plugin.PitBox.PressureLF',
  'RaceCorProDrive.Plugin.PitBox.PressureRF',
  'RaceCorProDrive.Plugin.PitBox.PressureLR',
  'RaceCorProDrive.Plugin.PitBox.PressureRR',
  // Car-specific adjustment availability
  'RaceCorProDrive.Plugin.PitBox.HasTC',
  'RaceCorProDrive.Plugin.PitBox.HasABS',
  'RaceCorProDrive.Plugin.PitBox.HasARBFront',
  'RaceCorProDrive.Plugin.PitBox.HasARBRear',
  'RaceCorProDrive.Plugin.PitBox.HasEnginePower',
  'RaceCorProDrive.Plugin.PitBox.HasFuelMixture',
  'RaceCorProDrive.Plugin.PitBox.HasWeightJackerL',
  'RaceCorProDrive.Plugin.PitBox.HasWeightJackerR',
  'RaceCorProDrive.Plugin.PitBox.HasWingFront',
  'RaceCorProDrive.Plugin.PitBox.HasWingRear',
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
let _hasEverConnected = false;
let _settingsForcedByDisconnect = false;

// Game & session state
let _currentGameId = '';
let _isIRacing = true;
let _isRally = false;
let _rallyModeEnabled = false;
let _isIdle = true;            // true when not in a car — gates the heavy render path
// isInRace signal — owned by poll-engine, consumed by main via IPC to show/
// hide the overlay window. _isIdle is the immediate (undebounced) in-car gate
// for the renderer's own skip-render; _prevInRace is the debounced edge-trigger
// that drives window visibility AND the active/dormant workload switch.
let _prevInRace = false;
let _inRaceLeaveTimer = null;
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
  showK10Logo: true, showCarLogo: true, showGameLogo: true, simhubUrl: 'http://localhost:8889/racecor-io-pro-drive/',
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
  // Remote design tokens
  useRemoteTokens: true,       // fetch CSS token builds from K10 Pro Drive API
  theme: 'dark',               // 'dark' or 'light' — synced with web dashboard preference
  apiBase: 'https://prodrive.racecor.io', // K10 Pro Drive API base URL
  iracingDataSync: true, // Sync race sessions to Pro Drive by default
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
  // Commentary — authoritative copy now lives here. settings.js relays each
  // change to the SimHub plugin via action=setSetting so the plugin's existing
  // commentary-filtering pipeline keeps working unchanged. If we later decide
  // the plugin doesn't need these at all, drop _relayCommentaryToPlugin.
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

// K10 Pro Drive state (set by connections.js on startup)
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
