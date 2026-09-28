using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Plugin;

namespace RacingDesk.Host
{
    /// <summary>
    /// Read-only views of the local store for the desk window, served next to the telemetry contract:
    /// <c>GET /racing-desk/data/{status,sessions,session?id=,schedule,cars,views,pedals}</c>. Rows go out as stored;
    /// the desk's calc layer (packages/calc) does the merging and derivation.
    ///
    /// One thing is written: <c>POST /racing-desk/data/pedals</c> says which of SmartControl's profiles a car is
    /// driven with. It is for programs on this machine — the app — and not for a page in a browser, which every
    /// other route here answers whatever its origin: a request that names an origin, or comes from another
    /// machine, is refused.
    /// </summary>
    internal sealed class LocalDataApi
    {
        private const string Prefix = "/racing-desk/data/";

        // A car and a profile's id; anything longer is not one of those.
        private const int MaxBody = 4096;

        private const string SessionColumns = @"id, source, ibt_path, session_num, subsession_id, session_id, series_id, season_id,
  race_week, event_type, session_type, official, category, track_id, track_name, track_display_name, track_config,
  track_length_km, car_path, car_id, car_screen_name, car_class_id, started_at, duration_s, driver_cust_id, irating, license,
  safety_rating, laps_completed, best_lap_s, incidents, start_position, finish_position, finish_position_in_class,
  field_size, sof";

        private readonly string _dbPath;
        private readonly string _smartControlDb;

        /// <param name="smartControlDb">SmartControl's database; null for where SmartControl keeps it.</param>
        public LocalDataApi(string dbPath, string smartControlDb = null)
        {
            _dbPath = dbPath;
            _smartControlDb = smartControlDb;
        }

        /// <summary>Claims /data/ requests and answers them off the telemetry thread.</summary>
        public bool TryHandle(HttpListenerContext ctx)
        {
            string path = ctx.Request.Url.AbsolutePath;
            if (!path.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return false;
            ThreadPool.QueueUserWorkItem(_ => Respond(ctx, path.Substring(Prefix.Length).TrimEnd('/')));
            return true;
        }

        private void Respond(HttpListenerContext ctx, string route)
        {
            var res = ctx.Response;
            try
            {
                res.Headers.Add("Access-Control-Allow-Origin", "*");
                res.Headers.Add("Access-Control-Allow-Private-Network", "true");
                res.Headers.Add("Cache-Control", "no-store");
                res.ContentType = "application/json; charset=utf-8";

                if (!File.Exists(_dbPath))
                {
                    Write(res, 404, json => { json.WriteStartObject(); json.WriteString("error", "no local store yet"); json.WriteEndObject(); });
                    return;
                }

                if (route == "pedals" && ctx.Request.HttpMethod == "POST")
                {
                    BindPedals(ctx);
                    return;
                }

                using var store = RacingDeskStore.OpenReadOnly(_dbPath);
                var q = ctx.Request.QueryString;
                switch (route)
                {
                    case "views":
                        // The view each car was last driven with: [{ car_path, name, driver_height, vanish_y,
                        // head_horizon, fov, seat_x, seat_y, seat_z, chosen, chosen_at, seen_at }].
                        Write(res, 200, json => store.WriteCarViewsJson(json));
                        return;

                    case "pedals":
                    {
                        var smartControl = ReadSmartControl();
                        Write(res, 200, json =>
                        {
                            json.WriteStartObject();
                            json.WritePropertyName("smartcontrol");
                            WriteSmartControl(json, smartControl);
                            json.WritePropertyName("cars");
                            json.WriteStartArray();
                            foreach (var car in store.CarPedalsList()) WriteCarPedals(json, car, smartControl);
                            json.WriteEndArray();
                            json.WriteEndObject();
                        });
                        return;
                    }

                    case "status":
                        Write(res, 200, json =>
                        {
                            json.WriteStartObject();
                            json.WriteString("db", _dbPath);
                            json.WriteNumber("schemaVersion", store.Scalar<long>("SELECT MAX(version) FROM schema_version"));
                            json.WriteNumber("sessions", store.Scalar<long>("SELECT COUNT(*) FROM sessions"));
                            json.WriteNumber("laps", store.Scalar<long>("SELECT COUNT(*) FROM laps"));
                            json.WriteNumber("trackOutlines", store.Scalar<long>("SELECT COUNT(*) FROM track_geometry"));
                            json.WriteNumber("cars", store.CarCount());
                            json.WriteString("lastSessionAt", store.Scalar<string>("SELECT MAX(started_at) FROM sessions"));
                            json.WriteString("lastIngestAt", store.Scalar<string>("SELECT MAX(ingested_at) FROM ingested_files"));
                            json.WriteEndObject();
                        });
                        return;

                    case "schedule":
                        // The season schedule as parsed from iRacing's PDF; the desk's calc layer shapes it.
                        Write(res, 200, json => store.WriteScheduleJson(json));
                        return;

                    case "cars":
                        // Every car the store can name, by name: [{ car_path, name, short_name, car_id, driven, seen }].
                        Write(res, 200, json => store.WriteCarsJson(json));
                        return;

                    case "sessions":
                    {
                        string since = q["since"];
                        Write(res, 200, json => store.WriteJson(json,
                            "SELECT " + SessionColumns + " FROM sessions WHERE ($since IS NULL OR started_at >= $since) ORDER BY started_at",
                            ("$since", since)));
                        return;
                    }

                    case "session":
                    {
                        if (!long.TryParse(q["id"], NumberStyles.Integer, CultureInfo.InvariantCulture, out long id))
                        {
                            Write(res, 400, json => { json.WriteStartObject(); json.WriteString("error", "id required"); json.WriteEndObject(); });
                            return;
                        }
                        Write(res, 200, json =>
                        {
                            json.WriteStartObject();
                            json.WritePropertyName("session");
                            store.WriteJson(json, "SELECT " + SessionColumns + " FROM sessions WHERE id = $id", ("$id", id));
                            json.WritePropertyName("laps");
                            store.WriteJson(json, "SELECT lap, lap_time_s, clean, incidents, fuel_used_l, pitted, start_session_time, position FROM laps WHERE session_id = $id ORDER BY lap", ("$id", id));
                            json.WritePropertyName("incidents");
                            store.WriteJson(json, "SELECT session_time, lap, lap_dist_pct, points FROM incidents WHERE session_id = $id ORDER BY session_time", ("$id", id));
                            json.WritePropertyName("grid");
                            store.WriteJson(json, @"SELECT car_idx, irating, license, car_class_id, car_screen_name, finish_position, class_position,
  laps_complete, fastest_lap_s, incidents, reason_out, is_player FROM grid_entries WHERE session_id = $id ORDER BY finish_position", ("$id", id));
                            json.WriteEndObject();
                        });
                        return;
                    }

                    default:
                        Write(res, 404, json => { json.WriteStartObject(); json.WriteString("error", "unknown data route"); json.WriteEndObject(); });
                        return;
                }
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.Host] data/{route} failed: {ex.Message}");
                try { res.StatusCode = 500; } catch { }
            }
            finally
            {
                try { res.OutputStream.Close(); } catch { }
            }
        }

        // ── Pedals ──

        /// <summary>SmartControl as it is now; null when it isn't installed or its database can't be read.</summary>
        private SmartControlSnapshot ReadSmartControl()
        {
            try
            {
                return SmartControl.Read(_smartControlDb);
            }
            catch (Exception ex)
            {
                // SmartControl writing at this moment, or a database from a version that keeps things elsewhere.
                Log.Warn("[RacingDesk.Host] SmartControl's profiles not read: " + ex.Message);
                return null;
            }
        }

        private void BindPedals(HttpListenerContext ctx)
        {
            var res = ctx.Response;
            var req = ctx.Request;
            if (!req.IsLocal || req.Headers["Origin"] != null)
            {
                Error(res, 403, "this is for the app on this machine");
                return;
            }

            string carPath, profileId;
            try
            {
                var buffer = new byte[MaxBody + 1];
                int read = 0, n;
                while (read < buffer.Length && (n = req.InputStream.Read(buffer, read, buffer.Length - read)) > 0) read += n;
                if (read > MaxBody)
                {
                    Error(res, 400, "too long");
                    return;
                }
                using var body = JsonDocument.Parse(new ReadOnlyMemory<byte>(buffer, 0, read));
                if (body.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
                carPath = Text(body.RootElement, "car_path", out bool carGiven);
                profileId = Text(body.RootElement, "profile_id", out bool profileGiven);
                if (!carGiven || !profileGiven) throw new JsonException();
            }
            catch (Exception ex) when (ex is JsonException || ex is InvalidOperationException)
            {
                Error(res, 400, "expected { \"car_path\": \"…\", \"profile_id\": \"…\" or null }");
                return;
            }
            if (string.IsNullOrWhiteSpace(carPath))
            {
                Error(res, 400, "car_path required");
                return;
            }

            using var store = new RacingDeskStore(_dbPath);
            if (!store.HasCar(carPath))
            {
                Error(res, 400, "no such car in the store");
                return;
            }

            if (profileId == null)
            {
                store.UnbindCarPedals(carPath);
                Write(res, 200, json => { json.WriteStartObject(); json.WriteNull("car"); json.WriteEndObject(); });
                return;
            }

            var smartControl = ReadSmartControl();
            SmartControlProfile profile = null;
            if (smartControl != null)
                foreach (var p in smartControl.Profiles)
                    if (p.Id == profileId) profile = p;
            if (profile == null)
            {
                Error(res, 400, smartControl == null ? "SmartControl's profiles can't be read" : "no such profile in SmartControl");
                return;
            }

            store.BindCarPedals(new CarPedals
            {
                CarPath = carPath, ProfileId = profile.Id, ProfileName = profile.Name, Profile = profile.Data, BoundAtUtc = DateTime.UtcNow,
            });
            var bound = store.CarPedalsOf(carPath);
            Write(res, 200, json =>
            {
                json.WriteStartObject();
                json.WritePropertyName("car");
                WriteCarPedals(json, bound, smartControl);
                json.WriteEndObject();
            });
        }

        /// <summary>A string, or null for JSON's null. Anything else is not what was asked for.</summary>
        private static string Text(JsonElement body, string name, out bool given)
        {
            given = body.TryGetProperty(name, out var value);
            if (!given || value.ValueKind == JsonValueKind.Null) return null;
            if (value.ValueKind != JsonValueKind.String) throw new JsonException();
            return value.GetString();
        }

        private static void WriteSmartControl(Utf8JsonWriter json, SmartControlSnapshot smartControl)
        {
            json.WriteStartObject();
            json.WriteBoolean("found", smartControl != null);
            json.WritePropertyName("profiles");
            json.WriteStartArray();
            if (smartControl != null)
                foreach (var p in smartControl.Profiles)
                {
                    json.WriteStartObject();
                    json.WriteString("id", p.Id);
                    json.WriteString("name", p.Name);
                    WritePedal(json, "throttle", p.Throttle);
                    WritePedal(json, "brake", p.Brake);
                    WritePedal(json, "clutch", p.Clutch);
                    json.WriteEndObject();
                }
            json.WriteEndArray();
            json.WritePropertyName("keys");
            json.WriteStartArray();
            if (smartControl != null)
                foreach (var k in smartControl.Keys)
                {
                    json.WriteStartObject();
                    json.WriteString("action", k.Action switch
                    {
                        LiveAction.SetBrakeForce => "set",
                        LiveAction.RaiseBrakeForce => "raise",
                        LiveAction.LowerBrakeForce => "lower",
                        _ => "other",
                    });
                    json.WriteNumber("value", k.Value);
                    json.WritePropertyName("keys");
                    json.WriteStartArray();
                    if (!string.IsNullOrEmpty(k.FirstKey)) json.WriteStringValue(k.FirstKey);
                    if (!string.IsNullOrEmpty(k.SecondKey)) json.WriteStringValue(k.SecondKey);
                    json.WriteEndArray();
                    json.WriteEndObject();
                }
            json.WriteEndArray();
            json.WriteEndObject();
        }

        private static void WritePedal(Utf8JsonWriter json, string name, PedalResponse pedal)
        {
            if (pedal == null)
            {
                json.WriteNull(name);
                return;
            }
            json.WriteStartObject(name);
            Number(json, "deadzone_bottom", pedal.DeadzoneBottom);
            if (name == "brake") Number(json, "max_force_kg", pedal.MaxForceKg);
            else Number(json, "deadzone_top", pedal.DeadzoneTop);
            json.WritePropertyName("curve");
            json.WriteStartArray();
            foreach (double point in pedal.Curve) json.WriteNumberValue(point);
            json.WriteEndArray();
            json.WriteEndObject();
        }

        private static void WriteCarPedals(Utf8JsonWriter json, CarPedals car, SmartControlSnapshot smartControl)
        {
            json.WriteStartObject();
            json.WriteString("car_path", car.CarPath);
            json.WriteString("name", car.CarName);
            json.WriteString("profile_id", car.ProfileId);
            json.WriteString("profile_name", car.ProfileName);
            Number(json, "brake_force_kg", car.BrakeForceKg);
            json.WriteString("bound_at", car.BoundAtUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
            json.WriteString("profile_now", ProfileNow(car, smartControl));
            json.WriteEndObject();
        }

        /// <summary>How the profile a car was given stands in SmartControl today.</summary>
        internal static string ProfileNow(CarPedals car, SmartControlSnapshot smartControl)
        {
            if (smartControl == null) return "unknown";
            foreach (var p in smartControl.Profiles)
            {
                if (p.Id != car.ProfileId) continue;
                return car.Profile != null && p.Data != null && car.Profile.AsSpan().SequenceEqual(p.Data) ? "same" : "changed";
            }
            return "gone";
        }

        private static void Number(Utf8JsonWriter json, string name, double? value)
        {
            if (value.HasValue && double.IsFinite(value.Value)) json.WriteNumber(name, value.Value);
            else json.WriteNull(name);
        }

        private static void Error(HttpListenerResponse res, int status, string message) =>
            Write(res, status, json => { json.WriteStartObject(); json.WriteString("error", message); json.WriteEndObject(); });

        private static void Write(HttpListenerResponse res, int status, Action<Utf8JsonWriter> body)
        {
            res.StatusCode = status;
            using var buffer = new MemoryStream();
            using (var json = new Utf8JsonWriter(buffer)) body(json);
            res.ContentLength64 = buffer.Length;
            buffer.Position = 0;
            buffer.CopyTo(res.OutputStream);
        }
    }
}
