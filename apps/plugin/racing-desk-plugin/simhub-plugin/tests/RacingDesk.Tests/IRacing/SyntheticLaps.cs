using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using IRSDKSharper;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// An .ibt of laps round a made-up circuit, with the variables the outline is derived from: Lat, Lon, Alt,
    /// LapDistPct, Lap, Speed, OnPitRoad, PlayerTrackSurface, SessionTime. The circuit is nobody's: a rounded
    /// triangle a kilometre across, somewhere in the sea. Each lap can be bent on purpose — a stop, a tow, a sample
    /// with no position, a lap on another line — to see what the checks make of it.
    /// </summary>
    internal sealed class SyntheticLaps
    {
        public const int HeaderSize = 144, VarHeaderSize = 144, FrameSize = 64, TickRate = 60;
        public const double Lat0 = 10.0, Lon0 = 20.0;      // the line, in the sea
        public const double EarthRadius = 6371008.8;

        private static readonly (string Name, IRacingSdkEnum.VarType Type, int Offset)[] Vars =
        {
            ("SessionNum", IRacingSdkEnum.VarType.Int, 0),
            ("SessionTime", IRacingSdkEnum.VarType.Double, 8),
            ("Lap", IRacingSdkEnum.VarType.Int, 16),
            ("LapCompleted", IRacingSdkEnum.VarType.Int, 20),
            ("LapDistPct", IRacingSdkEnum.VarType.Float, 24),
            ("Lat", IRacingSdkEnum.VarType.Double, 32),
            ("Lon", IRacingSdkEnum.VarType.Double, 40),
            ("Alt", IRacingSdkEnum.VarType.Float, 48),
            ("Speed", IRacingSdkEnum.VarType.Float, 52),
            ("OnPitRoad", IRacingSdkEnum.VarType.Bool, 56),
            ("PlayerTrackSurface", IRacingSdkEnum.VarType.Int, 60),
        };

        /// <summary>One frame of a lap as it is written; a test's bend changes it before it is written.</summary>
        public sealed class Frame
        {
            public double Time;
            public int Lap;
            public float Pct;
            public double Lat, Lon;
            public float Alt, Speed;
            public bool OnPitRoad;
            public int Surface = 3;
        }

        /// <summary>The circuit at a fraction of the lap: metres east and north of the line, on a rounded triangle ~1 km across.</summary>
        public static (double X, double Y) Circuit(double pct, double scale = 1.0)
        {
            double t = pct * Math.PI * 2;
            double r = 450 * scale * (1 + 0.18 * Math.Cos(3 * t));
            return (r * Math.Sin(t), r * (Math.Cos(t) - 1));   // the line at (0, 0), the lap clockwise from north
        }

        /// <summary>The lap length of <see cref="Circuit"/> at that scale, in metres, by summing small steps.</summary>
        public static double CircuitLength(double scale = 1.0)
        {
            double length = 0;
            var prev = Circuit(0, scale);
            for (int i = 1; i <= 4000; i++)
            {
                var p = Circuit(i / 4000.0, scale);
                length += Math.Sqrt((p.X - prev.X) * (p.X - prev.X) + (p.Y - prev.Y) * (p.Y - prev.Y));
                prev = p;
            }
            return length;
        }

        public static (double Lat, double Lon) ToLatLon(double x, double y, double shiftX = 0, double shiftY = 0)
        {
            double ky = EarthRadius * Math.PI / 180;
            double kx = Math.Cos(Lat0 * Math.PI / 180) * ky;
            return (Lat0 + (y + shiftY) / ky, Lon0 + (x + shiftX) / kx);
        }

        /// <summary>
        /// The frames of <paramref name="laps"/> laps at 60 Hz, each taking <paramref name="lapSeconds"/>, lap 1
        /// first. <paramref name="bend"/> is given every frame to change as it likes.
        /// </summary>
        public static List<Frame> Laps(int laps, double lapSeconds = 40, Action<Frame> bend = null, double scale = 1.0, double shiftX = 0, double shiftY = 0)
        {
            var frames = new List<Frame>();
            double length = CircuitLength(scale);
            int perLap = (int)(lapSeconds * TickRate);
            for (int lap = 1; lap <= laps; lap++)
            {
                for (int i = 0; i < perLap; i++)
                {
                    double pct = (double)i / perLap;
                    var (x, y) = Circuit(pct, scale);
                    var (lat, lon) = ToLatLon(x, y, shiftX, shiftY);
                    var f = new Frame
                    {
                        Time = ((lap - 1) * perLap + i) / (double)TickRate,
                        Lap = lap,
                        Pct = (float)pct,
                        Lat = lat,
                        Lon = lon,
                        Alt = 12,
                        Speed = (float)(length / lapSeconds),
                    };
                    bend?.Invoke(f);
                    frames.Add(f);
                }
            }
            // The frame after the last lap closes it: the lap counter moves on at the line.
            var last = new Frame { Time = laps * perLap / (double)TickRate, Lap = laps + 1, Pct = 0, Speed = (float)(length / lapSeconds), Alt = 12 };
            (last.Lat, last.Lon) = ToLatLon(0, 0, shiftX, shiftY);
            bend?.Invoke(last);
            frames.Add(last);
            return frames;
        }

        /// <summary>The length the YAML gives the circuit, to ten metres, as iRacing's "4.02 km" does.</summary>
        public static double OfficialMeters => Math.Round(CircuitLength() / 10) * 10;

        public static string Yaml(int trackId = 777, string lengthKm = null, string name = "Synthetic Circuit", string trackName = "synthetic full")
        {
            lengthKm = lengthKm ?? (OfficialMeters / 1000).ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
            var y = new StringBuilder();
            y.Append("---\n")
             .Append("WeekendInfo:\n")
             .Append(" TrackName: ").Append(trackName).Append('\n')
             .Append(" TrackID: ").Append(trackId).Append('\n')
             .Append(" TrackLength: ").Append(lengthKm).Append(" km\n")
             .Append(" TrackDisplayName: ").Append(name).Append('\n')
             .Append(" TrackConfigName: Full\n")
             .Append(" SeriesID: 139\n")
             .Append(" SubSessionID: 70010002\n")
             .Append(" EventType: Practice\n")
             .Append(" Category: Road\n")
             .Append(" Official: 0\n")
             .Append(" NumCarClasses: 1\n")
             .Append("SessionInfo:\n")
             .Append(" Sessions:\n")
             .Append(" - SessionNum: 0\n")
             .Append("   SessionType: Practice\n")
             .Append("DriverInfo:\n")
             .Append(" DriverCarIdx: 0\n")
             .Append(" DriverUserID: 900001\n")
             .Append(" Drivers:\n")
             .Append(" - CarIdx: 0\n")
             .Append("   UserName: Test Driver\n")
             .Append("   UserID: 900001\n")
             .Append("   CarPath: mx5 mx52016\n")
             .Append("   CarClassID: 74\n")
             .Append("   CarID: 67\n")
             .Append("   CarIsPaceCar: 0\n")
             .Append("   CarScreenName: Mazda MX-5 Cup\n")
             .Append("   CarScreenNameShort: MX-5 Cup\n")
             .Append("   IRating: 1500\n")
             .Append("   LicString: C 3.10\n")
             .Append("   IsSpectator: 0\n")
             .Append("SplitTimeInfo:\n")
             .Append(" Sectors:\n")
             .Append(" - SectorNum: 0\n")
             .Append("   SectorStartPct: 0.000000\n")
             .Append(" - SectorNum: 1\n")
             .Append("   SectorStartPct: 0.350000\n")
             .Append(" - SectorNum: 2\n")
             .Append("   SectorStartPct: 0.700000\n")
             .Append("...\n");
            return y.ToString();
        }

        /// <summary>The file's bytes: header, the variable table, the YAML, then the frames.</summary>
        /// <param name="claimedFrames">What the sub-header says: a file the sim is still writing says 0.</param>
        public static byte[] Bytes(string yaml, IReadOnlyList<Frame> frames, DateTime recordedUtc, int? claimedFrames = null)
        {
            byte[] text = Encoding.GetEncoding("ISO-8859-1").GetBytes(yaml);
            int yamlOffset = HeaderSize + Vars.Length * VarHeaderSize;
            int yamlLength = text.Length + 1;
            int framesOffset = yamlOffset + yamlLength;
            var bytes = new byte[framesOffset + frames.Count * FrameSize];
            void Put(int offset, int value) => BitConverter.GetBytes(value).CopyTo(bytes, offset);

            Put(0, 2); Put(4, 1); Put(8, TickRate);
            Put(16, yamlLength); Put(20, yamlOffset); Put(24, Vars.Length); Put(28, HeaderSize);
            Put(32, 1); Put(36, FrameSize); Put(52, framesOffset);
            BitConverter.GetBytes(new DateTimeOffset(recordedUtc).ToUnixTimeSeconds()).CopyTo(bytes, 112);
            BitConverter.GetBytes(0.0).CopyTo(bytes, 120);
            BitConverter.GetBytes(frames.Count / (double)TickRate).CopyTo(bytes, 128);
            Put(136, frames.Count > 0 ? frames[frames.Count - 1].Lap - 1 : 0);
            Put(140, claimedFrames ?? frames.Count);

            for (int i = 0; i < Vars.Length; i++)
            {
                int o = HeaderSize + i * VarHeaderSize;
                Put(o, (int)Vars[i].Type);
                Put(o + 4, Vars[i].Offset);
                Put(o + 8, 1);
                Encoding.ASCII.GetBytes(Vars[i].Name).CopyTo(bytes, o + 16);
            }
            text.CopyTo(bytes, yamlOffset);

            for (int i = 0; i < frames.Count; i++)
            {
                int o = framesOffset + i * FrameSize;
                var f = frames[i];
                Put(o, 0);
                BitConverter.GetBytes(f.Time).CopyTo(bytes, o + 8);
                Put(o + 16, f.Lap);
                Put(o + 20, f.Lap - 1);
                BitConverter.GetBytes(f.Pct).CopyTo(bytes, o + 24);
                BitConverter.GetBytes(f.Lat).CopyTo(bytes, o + 32);
                BitConverter.GetBytes(f.Lon).CopyTo(bytes, o + 40);
                BitConverter.GetBytes(f.Alt).CopyTo(bytes, o + 48);
                BitConverter.GetBytes(f.Speed).CopyTo(bytes, o + 52);
                bytes[o + 56] = (byte)(f.OnPitRoad ? 1 : 0);
                Put(o + 60, f.Surface);
            }
            return bytes;
        }

        /// <summary>Writes a whole file, dated an hour ago so the ingest takes it as finished.</summary>
        public static string Write(string path, string yaml, IReadOnlyList<Frame> frames, DateTime recordedUtc)
        {
            File.WriteAllBytes(path, Bytes(yaml, frames, recordedUtc));
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddHours(-1));
            return path;
        }
    }
}
