using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using RacingDesk.Core.Screens;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Wheel;
using RacingDesk.Plugin;

namespace RacingDesk.Host
{
    /// <summary>
    /// Read-only views of the local store for the desk window, served next to the telemetry contract:
    /// <c>GET /racing-desk/data/{status,sessions,session?id=,schedule,cars,views,pedals}</c>. Rows go out as stored;
    /// the desk's calc layer (packages/calc) does the merging and derivation. Beside them, and not from the
    /// store: <c>GET /racing-desk/data/controls</c>, the canonical list of cars this build carries, with what
    /// the check of it has said of each car (this run's, and what the store has kept of the runs before). And
    /// <c>GET /racing-desk/data/simwindow</c>, which is Windows's and not the store's: where the sim's window is on
    /// the screen, in physical pixels, for the HUD to be put on the same screen (see SimWindow.cs); JSON null when the
    /// sim is not running. And <c>GET /racing-desk/data/monitors</c>, also Windows's: the monitors' rectangles in
    /// physical pixels, so that a screen can be named by the size it really has (see Monitors.cs).
    ///
    /// Every route here is for programs on this machine. :8889 answers every address (the iPad reads the telemetry from
    /// it), but the sessions are his history, the status carries the store's path and the entry lists name every other
    /// driver (as a character: see <see cref="GridNames"/>), so a request that is not
    /// from a loopback connection, that names a Host other than this machine's at this port, or that a browser sent
    /// (an Origin of any kind, <c>null</c> included; a Referer or Sec-Fetch-* without one) is refused: 403, no CORS
    /// header, and one line in the log for each route and kind of asker. See
    /// <see cref="LocalRequest.RefusalOfRead(bool, System.Collections.Specialized.NameValueCollection, int)"/>, which is
    /// made once for every request under <c>/data/</c> before any route is looked at, a route that is not in
    /// <see cref="Routes"/> included. No page may read them, the app's own included, and nothing is sent a CORS header
    /// (a preflight is refused too): a file's page and a web site's page that is redirected, sandboxed or opened from disk
    /// all say <c>Origin: null</c>, and the host cannot tell them apart. The desk asks the app's main process (desk:read),
    /// which asks the host as the app's other programs do (the SimHub plugin, curl): by Node or .NET, with a Host and no
    /// Origin.
    ///
    /// One thing is written: <c>POST /racing-desk/data/pedals</c> says which of SmartControl's profiles a car is
    /// driven with. It is for programs on this machine — the app — and not for a page in a browser, which the check above
    /// already turns away; it makes the stricter test of <see cref="LocalRequest.IsFromThisMachine(HttpListenerRequest)"/> as
    /// well, the one the runtime's <c>?action=</c> routes make too.
    ///
    /// And one more thing, neither the store's nor open to pages: <c>/racing-desk/data/replay</c>, iRacing's replay and
    /// cameras for the app's TV shots (<see cref="ReplayApi"/>), GET and POST both for a program on this machine alone.
    /// </summary>
    internal sealed class LocalDataApi
    {
        private const string Prefix = "/racing-desk/data/";

        /// <summary>
        /// The routes of this API, by name. The check of who is asking is made before any of them is looked at, so a route
        /// that is not here is behind it all the same; the list is what the tests ask in turn (a route added to the dispatch
        /// below and not to this list fails <c>DataRoutesThisMachineTests</c>), and the names the log writes a refusal under.
        /// </summary>
        internal static readonly string[] Routes =
        {
            "status", "sessions", "session", "schedule", "cars", "views", "pedals", "controls", "simwindow", "monitors", "outline", "replay",
            "brakeforce", "wheelmax", "restore",
        };

        private const string NotThisMachine = "this is for the app on this machine";

        // A car and a profile's id; anything longer is not one of those.
        private const int MaxBody = 4096;

        private const string SessionColumns = @"id, source, ibt_path, session_num, subsession_id, session_id, series_id, season_id,
  race_week, event_type, session_type, official, category, track_id, track_name, track_display_name, track_config,
  track_length_km, car_path, car_id, car_screen_name, car_class_id, started_at, duration_s, irating, license,
  safety_rating, laps_completed, best_lap_s, incidents, start_position, finish_position, finish_position_in_class,
  field_size, sof";

        private readonly string _dbPath;
        private readonly string _smartControlDb;

        /// <param name="smartControlDb">SmartControl's database; null for where SmartControl keeps it.</param>
        public LocalDataApi(string dbPath, string smartControlDb = null)
        {
            _dbPath = dbPath;
            _smartControlDb = smartControlDb;
            // The replay route makes the stricter check of a program's route (no browser's marks) after this API's own; what it
            // refuses is written down here like the rest.
            Replay.Refused = () => NoteRefusal("replay", LocalRequest.Refusal.ABrowser);
        }

        /// <summary>
        /// What follows the car the driver is in, for <c>controls</c>: the list of cars and what its check has
        /// said. The telemetry's own, unless a test gives another.
        /// </summary>
        internal RacingDesk.Core.Cars.CarControlsFollower Cars { get; set; } = RacingDesk.Plugin.Engine.TelemetryCapture.Cars;

        /// <summary>Where the sim's window is looked up, for <c>simwindow</c>: Windows's, unless a test gives another.</summary>
        internal ISimWindowSource SimWindows { get; set; } = new Win32SimWindowSource();

        /// <summary>Where the monitors are listed, for <c>monitors</c>: Windows's, unless a test gives another.</summary>
        internal IMonitorSource Monitors { get; set; } = new Win32MonitorSource();

        /// <summary>iRacing's replay and cameras, for <c>replay</c>: given the live reader by the host once it has one.</summary>
        internal ReplayApi Replay { get; } = new ReplayApi();

        /// <summary>
        /// Putting back each car's seat height and brakes, for <c>restore</c>: given the director by the live host (RunLive); a host
        /// with none (a replay, a test) answers that it has none.
        /// </summary>
        internal RestoreApi Restore { get; } = new RestoreApi();

        /// <summary>
        /// The track outlines, for <c>outline?track=</c>: the store's, the one being made from the session he is
        /// driving, and, while he has none of his own for the layout, SimHub's shared map of it, marked
        /// <c>crowd</c>. The SimHub plugin asks this for its map; the iPad's proxy never reaches it.
        /// </summary>
        internal TrackOutlines Outlines { get; set; }

        /// <summary>
        /// The brake force the pedals are at now, for <c>brakeforce</c>: what the host's <see cref="CarPedalsRecorder"/>
        /// has followed from SmartControl Live's keys (RunLive hands it in). Null, or a reader that answers null, where
        /// the host has none (a replay, no store): the route then says the force is not known. The app's main process
        /// asks it for the HUD's datastream; nothing is read from the pedals for it.
        /// </summary>
        internal Func<BrakeForceNow> BrakeForce { get; set; }

        /// <summary>
        /// The wheel's maximum torque, for <c>wheelmax</c>: what the wheel base itself last said (the plugin's poll, which
        /// runs while Pit House has let go of the ports) or, failing that, Pit House's saved preset for it, read and never
        /// written (<see cref="WheelLimit.Resolve"/>). Null, or a reader that answers null, where neither is known: the
        /// route then says so, and the HUD shows a dash. The app's main process asks it for the HUD's datastream.
        /// </summary>
        internal Func<WheelLimit> WheelMax { get; set; }

        /// <summary>
        /// Claims /data/ requests, and answers them off the telemetry thread — after the check of who is asking, which every
        /// one of them has passed before any route is looked at (a refused one is answered here and goes no further).
        /// A preflight (<c>OPTIONS</c>) is claimed too, and refused: a browser's, and no page may ask, so the runtime's wildcard
        /// answer is not the one a page gets.
        /// </summary>
        public bool TryHandle(HttpListenerContext ctx)
        {
            string path = ctx.Request.Url.AbsolutePath;
            if (!path.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return false;
            string route = path.Substring(Prefix.Length).TrimEnd('/');
            try
            {
                var refusal = LocalRequest.RefusalOfRead(ctx.Request);
                // A preflight is a browser's: no page may ask any of these, so none is answered, as the request it would ask for is not.
                if (refusal == LocalRequest.Refusal.None && ctx.Request.HttpMethod == "OPTIONS") refusal = LocalRequest.Refusal.ABrowser;
                if (refusal != LocalRequest.Refusal.None)
                {
                    Refuse(ctx, route, refusal);
                    return true;
                }
            }
            catch (Exception ex)
            {
                // Whatever went wrong with the check, nothing was answered that it did not pass.
                Log.Warn($"[RacingDesk.Host] data/{route}: the request could not be checked: {ex.Message}");
                try { ctx.Response.StatusCode = 500; ctx.Response.OutputStream.Close(); } catch { }
                return true;
            }
            ThreadPool.QueueUserWorkItem(_ => Respond(ctx, route));
            return true;
        }

        // What has been written down in the log so far, once each. The routes are the list above (anything else is one name)
        // and the kinds of asker are four, so a device on the network that keeps asking cannot fill the log.
        private readonly HashSet<string> _refusals = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Writes down that a route was refused, once for each route and kind of asker; true when this call wrote it. Says
        /// nothing of what was asked beyond the route's name: not the Host, not the Origin, not the query.
        /// </summary>
        internal bool NoteRefusal(string route, LocalRequest.Refusal why)
        {
            string name = Array.IndexOf(Routes, route) >= 0 ? route : "(not a route of this API)";
            lock (_refusals)
                if (!_refusals.Add(name + "|" + why)) return false;

            string by;
            switch (why)
            {
                case LocalRequest.Refusal.AnotherMachine: by = "it came from another machine (a device on the network)"; break;
                case LocalRequest.Refusal.AnotherHost: by = "it names a host other than this machine's own at this port (the rig's address on the network, or a name pointed at it)"; break;
                case LocalRequest.Refusal.AWebSite: by = "it names an origin (a page in a browser, a web site's or a file's: no page reads it, the desk asks through the app)"; break;
                default: by = "a browser sent it, where only a program on this machine may ask"; break;
            }
            Log.Warn($"[RacingDesk.Host] data/{name} refused: {by}");
            return true;
        }

        /// <summary>403, with no CORS header: a page that is refused is not told in a way it may read, and a program is told in words.</summary>
        private void Refuse(HttpListenerContext ctx, string route, LocalRequest.Refusal why)
        {
            NoteRefusal(route, why);
            var res = ctx.Response;
            try
            {
                res.Headers.Add("Cache-Control", "no-store");
                res.ContentType = "application/json; charset=utf-8";
                Error(res, 403, NotThisMachine);
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.Host] data/{route} refusal failed: {ex.Message}");
                try { res.StatusCode = 403; } catch { }
            }
            finally
            {
                try { res.OutputStream.Close(); } catch { }
            }
        }

        private void Respond(HttpListenerContext ctx, string route)
        {
            // The replay is for a program on this machine and answers no page, with its own check as well as the one above.
            if (route == "replay") { Replay.Handle(ctx); return; }
            var res = ctx.Response;
            try
            {
                // No CORS header, to anybody: the check has let through programs only, and a program needs none.
                res.Headers.Add("Cache-Control", "no-store");
                res.ContentType = "application/json; charset=utf-8";

                if (route == "controls" && ctx.Request.HttpMethod == "GET")
                {
                    // The canonical list of cars, or one car of it (?car=), with what the check has said this run
                    // and what the store has kept of it. The list is carried in the assembly: it is served before
                    // there is a store, and when the store cannot be read.
                    var cars = Cars;
                    string car = ctx.Request.QueryString["car"];
                    var kept = KeptRemarks(cars?.List ?? RacingDesk.Core.Cars.CarList.Empty);
                    Write(res, 200, json => CarListApi.Write(json, cars?.List, car, cars?.Remarks, cars?.CarPath, kept));
                    return;
                }

                if (route == "simwindow" && ctx.Request.HttpMethod == "GET")
                {
                    // Not the store's, so it is answered before there is one. A look that cannot be made is a 500
                    // (Find throws), which the HUD takes for "not known" and not for "the sim is closed", which is null.
                    var found = SimWindows?.Find();
                    Write(res, 200, json => SimWindowApi.Write(json, found));
                    return;
                }

                if (route == "monitors" && ctx.Request.HttpMethod == "GET")
                {
                    // Windows's too, and answered before there is a store. A look that fails is a 500.
                    var listed = Monitors?.List();
                    Write(res, 200, json => MonitorsApi.Write(json, listed));
                    return;
                }

                if (route == "brakeforce" && ctx.Request.HttpMethod == "GET")
                {
                    // The brake force the pedals are at now, as the host follows it from SmartControl Live's keys
                    // (CarPedalsRecorder.Now): { car, force_kg }, each null while not known. Not the store's, so answered
                    // before there is one; a host with no recorder (a replay) answers not known.
                    var now = BrakeForce?.Invoke();
                    Write(res, 200, json =>
                    {
                        json.WriteStartObject();
                        json.WriteString("car", now?.CarPath);
                        Number(json, "force_kg", now?.ForceKg);
                        json.WriteEndObject();
                    });
                    return;
                }

                if (route == "wheelmax" && ctx.Request.HttpMethod == "GET")
                {
                    // The wheel's maximum torque in Nm, with where it comes from: { source, model, max_pct, rated_nm, max_nm,
                    // candidates }, each null while not known. Not the store's, so answered before there is one. The
                    // answer is a read of Pit House's files and of what the base said: nothing is sent to either.
                    WheelLimit limit = null;
                    try { limit = WheelMax?.Invoke(); } catch (Exception) { limit = null; }
                    Write(res, 200, json =>
                    {
                        json.WriteStartObject();
                        json.WriteString("source", limit?.Source);
                        json.WriteString("model", limit?.Model);
                        Number(json, "max_pct", limit?.MaxPercent);
                        Number(json, "rated_nm", limit?.RatedNm);
                        Number(json, "max_nm", limit?.MaxNm);
                        json.WriteNumber("candidates", limit?.Candidates ?? 0);
                        json.WriteEndObject();
                    });
                    return;
                }

                if (route == "restore" && ctx.Request.HttpMethod == "GET")
                {
                    // How putting back the seat heights and brakes stands: the switches, a sentence for each part, each car's
                    // sentences. Not the store's alone, so answered before there is one.
                    Restore.Get(ctx, (status, body) => Write(res, status, body));
                    return;
                }

                if (route == "restore" && ctx.Request.HttpMethod == "POST")
                {
                    // A switch, or undo: for a program on this machine alone, as the pedals' write is.
                    if (!LocalRequest.IsFromThisMachine(ctx.Request))
                    {
                        NoteRefusal("restore", LocalRequest.Refusal.ABrowser);
                        Error(res, 403, NotThisMachine);
                        return;
                    }
                    Restore.Post(ctx, (status, body) => Write(res, status, body));
                    return;
                }

                if (route == "outline" && ctx.Request.HttpMethod == "GET")
                {
                    // A layout's outline by the sim's TrackID, from the store or the session being driven (or, with
                    // neither, SimHub's shared map, marked crowd) — so it is answered before there is a store, and
                    // 404 while there is no outline yet.
                    if (!int.TryParse(ctx.Request.QueryString["track"], NumberStyles.Integer, CultureInfo.InvariantCulture, out int trackId) || trackId <= 0)
                    {
                        Error(res, 400, "track required: the sim's TrackID");
                        return;
                    }
                    var outline = Outlines?.ForTrack(trackId);
                    if (outline == null)
                    {
                        Error(res, 404, "no outline yet");
                        return;
                    }
                    Write(res, 200, json => WriteOutline(json, outline));
                    return;
                }

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
                            // cars: those with a profile of their own. without_profile: those of which
                            // something is known all the same — a force set by key, or whether they have ABS.
                            var known = new Dictionary<string, CarPedalFacts>(StringComparer.OrdinalIgnoreCase);
                            foreach (var facts in store.CarPedalFactsList()) known[facts.CarPath] = facts;
                            json.WritePropertyName("cars");
                            json.WriteStartArray();
                            foreach (var car in store.CarPedalsList())
                            {
                                known.TryGetValue(car.CarPath, out var facts);
                                known.Remove(car.CarPath);
                                WriteCarPedals(json, car, smartControl, facts);
                            }
                            json.WriteEndArray();
                            json.WritePropertyName("without_profile");
                            json.WriteStartArray();
                            foreach (var facts in known.Values.OrderBy(f => f.CarName ?? f.CarPath, StringComparer.OrdinalIgnoreCase))
                            {
                                json.WriteStartObject();
                                json.WriteString("car_path", facts.CarPath);
                                json.WriteString("name", facts.CarName);
                                Number(json, "brake_force_kg", facts.ForceKg);
                                WriteFacts(json, facts);
                                json.WriteEndObject();
                            }
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
                            WriteGrid(json, store.GridEntries(id), store.OwnCustomerId());
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

        // ── The car list ──

        /// <summary>
        /// What the check has said of the cars against this list, kept in the store: none while there is no store
        /// yet, which is true; null when the store is there and could not be read, which is not.
        /// </summary>
        private IReadOnlyList<CarListRemark> KeptRemarks(RacingDesk.Core.Cars.CarList list)
        {
            try
            {
                if (!File.Exists(_dbPath)) return Array.Empty<CarListRemark>();
                using var store = RacingDeskStore.OpenReadOnly(_dbPath);
                return store.CarListRemarksAgainst(list.Hash);
            }
            catch (Exception ex)
            {
                Log.Warn("[RacingDesk.Host] the car list's remarks were not read: " + ex.Message);
                return null;
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
            // The same check as the runtime's ?action= routes make (LocalRequest): the connection is this machine's, the
            // Host names it, and no browser sent it. (TryHandle's own check has passed: what can fail here is a browser's marks.)
            if (!LocalRequest.IsFromThisMachine(req))
            {
                NoteRefusal("pedals", LocalRequest.Refusal.ABrowser);
                Error(res, 403, NotThisMachine);
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
                // His choice, so the rule that gives a car a profile leaves this one alone.
                store.NotePedalsGiven(carPath, "none", null, DateTime.UtcNow);
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
            store.NotePedalsGiven(carPath, "driver", null, DateTime.UtcNow);
            var bound = store.CarPedalsOf(carPath);
            var facts = store.CarPedalFactsOf(carPath);
            Write(res, 200, json =>
            {
                json.WriteStartObject();
                json.WritePropertyName("car");
                WriteCarPedals(json, bound, smartControl, facts);
                json.WriteEndObject();
            });
        }

        /// <summary>
        /// A stored session's entry list. Every driver who is not him is shown as a character (root CLAUDE.md, Other
        /// drivers' names): the one the live session showed (<see cref="GridNames"/>), and the name on disk goes no
        /// further than the store. His own entry keeps his name, and is told by his customer id: the <c>is_player</c> flag of
        /// a session stored before this went to whoever was in his car, a teammate in a team race, so it alone is not
        /// believed. The customer ids themselves are not sent.
        /// </summary>
        private static void WriteGrid(Utf8JsonWriter json, IReadOnlyList<GridEntryRecord> grid, long ownCustId)
        {
            var names = GridNames(grid, RacingDesk.Core.Names.PseudonymBook.Default, ownCustId);
            json.WriteStartArray();
            for (int i = 0; i < grid.Count; i++)
            {
                var g = grid[i];
                json.WriteStartObject();
                json.WriteNumber("car_idx", g.CarIdx);
                string name = IsHim(g, ownCustId) ? g.Name : names[i];
                if (name == null) json.WriteNull("name"); else json.WriteString("name", name);
                json.WriteNumber("irating", g.IRating);
                if (g.License == null) json.WriteNull("license"); else json.WriteString("license", g.License);
                json.WriteNumber("car_class_id", g.CarClassId);
                if (g.CarScreenName == null) json.WriteNull("car_screen_name"); else json.WriteString("car_screen_name", g.CarScreenName);
                json.WriteNumber("finish_position", g.FinishPosition);
                json.WriteNumber("class_position", g.ClassPosition);
                json.WriteNumber("laps_complete", g.LapsComplete);
                json.WriteNumber("fastest_lap_s", g.FastestLapSeconds);
                json.WriteNumber("incidents", g.Incidents);
                if (g.ReasonOut == null) json.WriteNull("reason_out"); else json.WriteString("reason_out", g.ReasonOut);
                json.WriteNumber("is_player", IsHim(g, ownCustId) ? 1 : 0);
                json.WriteEndObject();
            }
            json.WriteEndArray();
        }

        /// <summary>
        /// Whether a stored entry is him: flagged as the player's and under his own customer id
        /// (<see cref="RacingDeskStore.OwnCustomerId"/>). A flagged entry with no id at all cannot be anyone else's in a team
        /// race (those are online, with ids) and is his; a flagged entry under another id is a teammate's, and when the store
        /// knows no id of his own one cannot be told, which is the teammate's, not his.
        /// </summary>
        internal static bool IsHim(GridEntryRecord g, long ownCustId) =>
            g.IsPlayer && (g.CustId <= 0 || (ownCustId > 0 && g.CustId == ownCustId));

        /// <summary>
        /// The names a stored entry list's drivers who are not him are shown under, one for each entry of the list, in its
        /// order (null for his own, and for an entry with neither an id nor a name). A session stored since the names were
        /// replaced holds the characters its live session showed, and they are kept as they are. One stored before holds
        /// real names: those drivers are named afresh from the customer id the store kept, as one field in the order of
        /// their ids' priority (<see cref="RacingDesk.Core.Names.Pseudonymizer.ForMany"/>) — the way the live session names
        /// its racers, so that a rival is the character the HUD showed, whatever order the store lists them in. An
        /// entry flagged as the player's that is not him (<see cref="IsHim"/>) is named like the rest.
        /// </summary>
        internal static string[] GridNames(IReadOnlyList<GridEntryRecord> grid, RacingDesk.Core.Names.PseudonymBook book, long ownCustId)
        {
            var names = book.NewSession();
            var result = new string[grid.Count];
            var wanting = new List<int>();
            for (int i = 0; i < grid.Count; i++)
            {
                var g = grid[i];
                if (IsHim(g, ownCustId)) continue;
                if (names.Keep(g.CustId, g.Name)) result[i] = g.Name.Trim();
                else if (g.CustId > 0 || !string.IsNullOrWhiteSpace(g.Name)) wanting.Add(i);
            }
            var named = names.ForMany(wanting.Select(i => new KeyValuePair<long, string>(grid[i].CustId, grid[i].Name)).ToList());
            for (int k = 0; k < wanting.Count; k++) result[wanting[k]] = named[k];
            return result;
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
                        LiveAction.SetProfile => "profile",
                        _ => "other",
                    });
                    json.WriteNumber("value", k.Value);
                    // A profile key names the profile it switches to (Racing Desk's own F24, once it is made, among them).
                    if (k.Action == LiveAction.SetProfile) json.WriteString("profile_id", k.ProfileId);
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

        private static void WriteCarPedals(Utf8JsonWriter json, CarPedals car, SmartControlSnapshot smartControl, CarPedalFacts facts)
        {
            json.WriteStartObject();
            json.WriteString("car_path", car.CarPath);
            json.WriteString("name", car.CarName);
            json.WriteString("profile_id", car.ProfileId);
            json.WriteString("profile_name", car.ProfileName);
            Number(json, "brake_force_kg", facts?.ForceKg ?? car.BrakeForceKg);
            json.WriteString("bound_at", Iso(car.BoundAtUtc));
            json.WriteString("profile_now", ProfileNow(car, smartControl));
            WriteFacts(json, facts);
            json.WriteEndObject();
        }

        // brake_force_kg: the force the car was last driven with, set with SmartControl Live's keys; null when
        // none is known, and the profile's own then stands. has_abs: true, false, or null while too little has
        // been driven to say. given_by: "rule", "driver", "none" (he chose that the car has no profile), or null.
        private static void WriteFacts(Utf8JsonWriter json, CarPedalFacts facts)
        {
            if (facts?.ForceAtUtc != null) json.WriteString("force_at", Iso(facts.ForceAtUtc.Value));
            else json.WriteNull("force_at");
            if (facts?.HasAbs != null) json.WriteBoolean("has_abs", facts.HasAbs.Value);
            else json.WriteNull("has_abs");
            json.WriteString("given_by", facts?.GivenBy);
            json.WriteString("given_why", facts?.GivenWhy);
        }

        private static string Iso(DateTime utc) => utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);

        // { trackId, cleanLaps, lengthM, officialLengthM, provisional, crowd, updatedAt, points: [[x, z, pct], …] } —
        // x east and z south in metres, to the centimetre, and the fraction of the lap each point is at. crowd is
        // SimHub's shared map standing in until the first clean lap (cleanLaps 0): the same coordinates, the same shape.
        internal static void WriteOutline(Utf8JsonWriter json, RacingDesk.Plugin.Engine.TrackOutline outline)
        {
            json.WriteStartObject();
            json.WriteNumber("trackId", outline.TrackId);
            json.WriteNumber("cleanLaps", outline.CleanLaps);
            json.WriteNumber("lengthM", Math.Round(outline.LengthMeters, 1));
            json.WriteNumber("officialLengthM", Math.Round(outline.OfficialLengthMeters, 1));
            json.WriteBoolean("provisional", outline.Provisional);
            json.WriteBoolean("crowd", outline.Crowd);
            json.WriteString("updatedAt", Iso(outline.UpdatedAtUtc));
            json.WritePropertyName("points");
            json.WriteStartArray();
            foreach (var (x, z, pct) in outline.Points)
            {
                json.WriteStartArray();
                json.WriteNumberValue(Math.Round(x, 2));
                json.WriteNumberValue(Math.Round(z, 2));
                json.WriteNumberValue(Math.Round(pct, 5));
                json.WriteEndArray();
            }
            json.WriteEndArray();
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
