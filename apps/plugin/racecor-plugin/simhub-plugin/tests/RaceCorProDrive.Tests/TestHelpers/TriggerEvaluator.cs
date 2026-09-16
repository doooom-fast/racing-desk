using System;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Evaluates a single TriggerCondition against the current and previous
    /// TelemetrySnapshot, returning true if the condition is satisfied.
    /// </summary>
    public static class TriggerEvaluator
    {
        public static bool Evaluate(TriggerCondition trigger, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (cur == null || !cur.GameRunning)
                return false;

            switch (trigger.Condition?.ToLower())
            {
                case ">":              return CompareGreater(trigger, cur);
                case "<":              return CompareLess(trigger, cur);
                case "==":             return CompareEquals(trigger, cur);
                case "change":         return HasChanged(trigger, cur, prev);
                case "increase":       return HasIncreased(trigger, cur, prev);
                case "spike":          return IsSpike(trigger, cur, prev);
                case "sudden_drop":    return IsSuddenDrop(trigger, cur, prev);
                case "extreme":        return IsExtreme(trigger, cur);
                case "rapid_change":   return IsRapidChange(trigger, cur, prev);
                case "personal_best":  return IsPersonalBest(cur, prev);
                case "player_gain_position":  return PlayerGainedPosition(cur, prev);
                case "player_lost_position":  return PlayerLostPosition(cur, prev);
                case "player_entering":       return PlayerEnteringPit(cur, prev);
                case "off_track":             return IsOffTrack(cur, prev);
                case "yellow_flag":           return IsYellowFlag(cur, prev);
                case "black_flag":            return IsBlackFlag(cur, prev);
                case "race_start":            return IsRaceStart(cur, prev);
                case "close_proximity":       return IsCloseProximity(trigger, cur);
                default:
                    return false;
            }
        }

        /// <summary>
        /// Public accessor for reading a telemetry value by datapoint name.
        /// Used for event exposition value substitution.
        /// </summary>
        public static double GetValuePublic(TelemetrySnapshot s, string dataPoint)
            => GetValue(s, dataPoint);

        private static double GetValue(TelemetrySnapshot s, string dataPoint)
        {
            switch (dataPoint?.ToLower())
            {
                case "speedkmh":              return s.SpeedKmh;
                case "rpms":                  return s.Rpms;
                case "throttle":              return s.Throttle;
                case "brake":                 return s.Brake;
                case "fuellevel":             return s.FuelLevel;
                case "fuellevelpct":
                case "fuelpercent":           return s.FuelPercent;
                case "currentlap":
                case "lap":                   return s.CurrentLap;
                case "completedlaps":         return s.CompletedLaps;
                case "trackpositionpercent":
                case "lapdistpct":            return s.TrackPositionPct;
                case "position":              return s.Position;
                case "lateralataccel":
                case "lataccel":              return s.LatAccel;
                case "longitudinalaccel":
                case "longaccel":             return s.LongAccel;
                case "vertaccel":             return s.VertAccel;
                case "yawrate":               return s.YawRate;
                case "steeringwheeltorque":   return s.SteeringWheelTorque;
                case "lapdeltatobest":
                case "lapdeltatobestlap":     return s.LapDeltaToBest;
                case "lapcurrentlaptime":     return s.LapCurrentTime;
                case "laplastlaptime":        return s.LapLastTime;
                case "lapbestlaptime":        return s.LapBestTime;
                case "sessiontimeremain":     return s.SessionTimeRemain;
                case "sessionflags":          return s.SessionFlags;
                case "playercarincidentcount":
                case "playercarincident":
                case "playercarmyincidentcount": return s.IncidentCount;
                case "drsstatus":             return s.DrsStatus;
                case "tracktemp":             return s.TrackTemp;
                case "energyersbattery":      return s.ErsBattery;
                case "powermguk":             return s.MgukPower;
                case "tyrewearfl":            return s.TyreWearFL;
                case "tyrewearfr":            return s.TyreWearFR;
                case "tyrewearrl":            return s.TyreWearRL;
                case "tyrewearrr":            return s.TyreWearRR;
                case "tyretempfl":            return s.TyreTempFL;
                case "tyretempfr":            return s.TyreTempFR;
                case "tyretemprl":            return s.TyreTempRL;
                case "tyretemprr":            return s.TyreTempRR;
                default:                      return 0;
            }
        }

        // ── Condition implementations ─────────────────────────────────────────

        private static bool CompareGreater(TriggerCondition t, TelemetrySnapshot cur)
            => t.Value.HasValue && GetValue(cur, t.DataPoint) > t.Value.Value;

        private static bool CompareLess(TriggerCondition t, TelemetrySnapshot cur)
            => t.Value.HasValue && GetValue(cur, t.DataPoint) < t.Value.Value;

        private static bool CompareEquals(TriggerCondition t, TelemetrySnapshot cur)
        {
            if (!t.Value.HasValue) return false;
            // Handle bool-like values (true=1, false=0)
            switch (t.DataPoint?.ToLower())
            {
                case "brakeabsactive":
                case "absactive":         return t.Value.Value >= 1 ? cur.AbsActive : !cur.AbsActive;
                case "tcactive":          return t.Value.Value >= 1 ? cur.TcActive  : !cur.TcActive;
                case "weatherdeclaredwet":
                case "wet":               return t.Value.Value >= 1 ? cur.WeatherWet : !cur.WeatherWet;
                case "isinpit":           return t.Value.Value >= 1 ? cur.IsInPit : !cur.IsInPit;
                case "isinpitlane":       return t.Value.Value >= 1 ? cur.IsInPitLane : !cur.IsInPitLane;
                case "isdebrisflag":
                case "debris":            return t.Value.Value >= 1 ? cur.IsDebrisFlag : !cur.IsDebrisFlag;
            }
            return Math.Abs(GetValue(cur, t.DataPoint) - t.Value.Value) < 0.001;
        }

        private static bool HasChanged(TriggerCondition t, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            double delta = Math.Abs(GetValue(cur, t.DataPoint) - GetValue(prev, t.DataPoint));
            double threshold = t.ThresholdDelta ?? 0.5;
            return delta >= threshold;
        }

        private static bool HasIncreased(TriggerCondition t, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            return GetValue(cur, t.DataPoint) > GetValue(prev, t.DataPoint);
        }

        private static bool IsSpike(TriggerCondition t, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null || !t.ThresholdDelta.HasValue) return false;
            double curVal  = GetValue(cur, t.DataPoint);
            double prevVal = GetValue(prev, t.DataPoint);
            double delta   = curVal - prevVal;
            // Standard spike: value jumped by more than threshold
            if (delta > t.ThresholdDelta.Value) return true;
            // Declining edge: previous sample caught the spike peak
            if (prevVal > t.ThresholdDelta.Value && curVal < prevVal) return true;
            return false;
        }

        private static bool IsSuddenDrop(TriggerCondition t, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null || !t.ThresholdDelta.HasValue) return false;
            double delta = GetValue(cur, t.DataPoint) - GetValue(prev, t.DataPoint);
            return delta <= t.ThresholdDelta.Value; // ThresholdDelta should be negative
        }

        private static bool IsExtreme(TriggerCondition t, TelemetrySnapshot cur)
        {
            if (!t.AbsValue.HasValue) return false;
            return Math.Abs(GetValue(cur, t.DataPoint)) >= t.AbsValue.Value;
        }

        private static bool IsRapidChange(TriggerCondition t, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            // For gear: detect more than 2 gear changes worth of delta
            if (t.DataPoint?.ToLower() == "gear")
            {
                int curGear  = ParseGear(cur.Gear);
                int prevGear = ParseGear(prev.Gear);
                return Math.Abs(curGear - prevGear) >= 2;
            }
            return HasChanged(t, cur, prev);
        }

        private static bool IsPersonalBest(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            // Detect a new best lap: last lap time dropped vs stored best
            return cur.LapLastTime > 0
                && cur.LapLastTime < cur.LapBestTime
                && cur.LapLastTime != prev.LapLastTime;
        }

        private static bool PlayerGainedPosition(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null || prev.Position <= 0 || cur.Position <= 0) return false;
            return cur.Position < prev.Position;
        }

        private static bool PlayerLostPosition(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null || prev.Position <= 0 || cur.Position <= 0) return false;
            return cur.Position > prev.Position;
        }

        private static bool PlayerEnteringPit(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            return cur.IsInPitLane && !prev.IsInPitLane;
        }

        private static bool IsOffTrack(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            return Math.Abs(cur.VertAccel) > 8.0 && Math.Abs(prev.VertAccel) < 4.0;
        }

        private static bool IsYellowFlag(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            bool curYellow  = (cur.SessionFlags  & TelemetrySnapshot.FLAG_YELLOW) != 0;
            bool prevYellow = (prev.SessionFlags & TelemetrySnapshot.FLAG_YELLOW) != 0;
            return curYellow && !prevYellow;
        }

        private static bool IsBlackFlag(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            bool curBlack  = (cur.SessionFlags  & TelemetrySnapshot.FLAG_BLACK) != 0;
            bool prevBlack = (prev.SessionFlags & TelemetrySnapshot.FLAG_BLACK) != 0;
            return curBlack && !prevBlack;
        }

        private static bool IsRaceStart(TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            if (prev == null) return false;
            return cur.SessionTypeName == "Race"
                && cur.CurrentLap == 1
                && cur.CompletedLaps == 0
                && prev.CurrentLap == 0;
        }

        private static bool IsCloseProximity(TriggerCondition t, TelemetrySnapshot cur)
        {
            if (cur.CarIdxLapDistPct == null || cur.CarIdxLapDistPct.Length == 0)
                return false;

            double threshold = t.ProximityThreshold ?? 0.02;
            double playerPos = cur.TrackPositionPct;
            int playerIdx    = cur.PlayerCarIdx;

            for (int i = 0; i < cur.CarIdxLapDistPct.Length; i++)
            {
                if (i == playerIdx) continue;
                double otherPos = cur.CarIdxLapDistPct[i];
                if (otherPos <= 0) continue;
                double delta = Math.Abs(playerPos - otherPos);
                // Account for wrap-around near start/finish
                delta = Math.Min(delta, 1.0 - delta);
                if (delta < threshold) return true;
            }
            return false;
        }

        private static int ParseGear(string gear)
        {
            if (string.IsNullOrEmpty(gear)) return 0;
            if (gear == "R") return -1;
            if (gear == "N") return 0;
            int.TryParse(gear, out int g);
            return g;
        }
    }
}
