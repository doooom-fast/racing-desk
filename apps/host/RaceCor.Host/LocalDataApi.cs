using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading;
using RaceCor.Data;
using RaceCorProDrive.Plugin;

namespace RaceCor.Host
{
    /// <summary>
    /// Read-only views of the local store for the desk window, served next to the telemetry contract:
    /// <c>GET /racecor-io-pro-drive/data/{status,sessions,session?id=,schedule}</c>. Rows go out as stored; the desk's
    /// calc layer (packages/calc) does the merging and derivation.
    /// </summary>
    internal sealed class LocalDataApi
    {
        private const string Prefix = "/racecor-io-pro-drive/data/";

        private const string SessionColumns = @"id, source, ibt_path, session_num, subsession_id, session_id, series_id, season_id,
  race_week, event_type, session_type, official, category, track_id, track_name, track_display_name, track_config,
  track_length_km, car_path, car_id, car_screen_name, car_class_id, started_at, duration_s, driver_cust_id, irating, license,
  safety_rating, laps_completed, best_lap_s, incidents, start_position, finish_position, finish_position_in_class,
  field_size, sof";

        private readonly string _dbPath;

        public LocalDataApi(string dbPath) => _dbPath = dbPath;

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

                using var store = ProDriveStore.OpenReadOnly(_dbPath);
                var q = ctx.Request.QueryString;
                switch (route)
                {
                    case "status":
                        Write(res, 200, json =>
                        {
                            json.WriteStartObject();
                            json.WriteString("db", _dbPath);
                            json.WriteNumber("schemaVersion", store.Scalar<long>("SELECT MAX(version) FROM schema_version"));
                            json.WriteNumber("sessions", store.Scalar<long>("SELECT COUNT(*) FROM sessions"));
                            json.WriteNumber("laps", store.Scalar<long>("SELECT COUNT(*) FROM laps"));
                            json.WriteNumber("trackOutlines", store.Scalar<long>("SELECT COUNT(*) FROM track_geometry"));
                            json.WriteString("lastSessionAt", store.Scalar<string>("SELECT MAX(started_at) FROM sessions"));
                            json.WriteString("lastIngestAt", store.Scalar<string>("SELECT MAX(ingested_at) FROM ingested_files"));
                            json.WriteEndObject();
                        });
                        return;

                    case "schedule":
                        // The season schedule as parsed from iRacing's PDF; the desk's calc layer shapes it.
                        Write(res, 200, json => store.WriteScheduleJson(json));
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
                Log.Warn($"[RaceCor.Host] data/{route} failed: {ex.Message}");
                try { res.StatusCode = 500; } catch { }
            }
            finally
            {
                try { res.OutputStream.Close(); } catch { }
            }
        }

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
