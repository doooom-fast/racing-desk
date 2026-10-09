using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using RacingDesk.Data.Restore;

namespace RacingDesk.Host
{
    /// <summary>
    /// <c>/racing-desk/data/restore</c>: putting back each car's seat height and brakes (docs/view-and-pedals-plan.md), for the
    /// app on this machine and no page (the data API's own check, <see cref="LocalDataApi"/>, is made first).
    ///
    /// <c>GET</c> answers the two switches, how each part stands in a sentence (working, waiting for something, turned itself
    /// off), whether there is anything to undo, each car's sentences for the Cars page, and his brake-force keys (<c>keys</c>:
    /// which set the force now, whether SmartControl Live must start again to have Racing Desk's change, undo or move).
    /// <c>POST</c> takes one thing at a time, for a program on this machine alone (the stricter check the pedals' write makes):
    /// <c>{ "switches": { "brakes", "height" } }</c>, <c>{ "undo": "all" }</c>, or <c>{ "keys": "undo" | "move" }</c> for his
    /// brake-force keys. A host with no director (a replay) answers that it has none.
    /// </summary>
    internal sealed class RestoreApi
    {
        private const int MaxBody = 4096;

        /// <summary>The live host's director (RunLive hands it in); null in a replay, and in tests that do not give one.</summary>
        public RestoreDirector Director { get; set; }

        public void Get(HttpListenerContext ctx, Action<int, Action<Utf8JsonWriter>> write)
        {
            var director = Director;
            if (director == null)
            {
                write(200, json =>
                {
                    json.WriteStartObject();
                    json.WriteBoolean("available", false);
                    json.WriteString("why", "this host does not put cars' seat heights and brakes back (a replay, or a host from before it)");
                    json.WriteEndObject();
                });
                return;
            }

            var switches = director.Switches;
            var (brakes, height) = director.Status();
            bool undo = director.AnythingToUndo();
            RestorePlan plan = null;
            string planWhy = null;
            try { plan = director.Plan(); }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is System.IO.IOException || ex is InvalidOperationException) { planWhy = ex.Message; }
            BrakeKeysStatus keys = null;
            try { keys = director.KeysStatus(); }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is System.IO.IOException || ex is InvalidOperationException) { keys = new BrakeKeysStatus { State = "unknown", Text = "SmartControl Live's keys couldn't be read: " + ex.Message.Trim() }; }
            write(200, json =>
            {
                json.WriteStartObject();
                json.WriteBoolean("available", true);
                json.WriteStartObject("switches");
                json.WriteBoolean("brakes", switches.Brakes);
                json.WriteBoolean("height", switches.Height);
                json.WriteEndObject();
                json.WriteStartObject("status");
                Status(json, "brakes", brakes);
                Status(json, "height", height);
                json.WriteEndObject();
                json.WriteBoolean("undo", undo);
                // His brake-force keys: which set the force now, whether Live must start again to have the change, undo or move.
                json.WriteStartObject("keys");
                json.WriteString("state", keys.State);
                json.WriteString("text", keys.Text);
                json.WriteString("restart", keys.Restart);
                json.WriteString("said", keys.Said);
                json.WriteBoolean("undo", keys.Undo);
                json.WriteBoolean("move", keys.Move);
                json.WriteEndObject();
                WriteCars(json, plan, switches);
                if (planWhy != null) json.WriteString("carsError", planWhy);
                json.WriteEndObject();
            });
        }

        private static void Status(Utf8JsonWriter json, string name, RestoreStatus status)
        {
            json.WriteStartObject(name);
            json.WriteString("state", status.State);
            json.WriteString("text", status.Text);
            json.WriteEndObject();
        }

        /// <summary>Each car's sentences for its View and Pedals panels: only for a part that is on, and only where there is one.</summary>
        private static void WriteCars(Utf8JsonWriter json, RestorePlan plan, RestoreSwitches switches)
        {
            json.WriteStartArray("cars");
            if (plan != null)
            {
                var cars = plan.Views.Select(v => v.Car).Concat(plan.Brakes.Select(b => b.Car)).Distinct(StringComparer.OrdinalIgnoreCase);
                foreach (string car in cars)
                {
                    var v = switches.Height ? plan.Views.FirstOrDefault(x => string.Equals(x.Car, car, StringComparison.OrdinalIgnoreCase)) : null;
                    var b = switches.Brakes ? plan.Brakes.FirstOrDefault(x => string.Equals(x.Car, car, StringComparison.OrdinalIgnoreCase)) : null;
                    if (v?.Words == null && b?.Words == null) continue;
                    json.WriteStartObject();
                    json.WriteString("car", car);
                    json.WriteString("name", v?.Name ?? b?.Name);
                    if (v?.Words == null) json.WriteNull("view");
                    else
                    {
                        json.WriteStartObject("view");
                        json.WriteString("state", v.State);
                        json.WriteString("text", v.Words);
                        json.WriteEndObject();
                    }
                    if (b?.Words == null) json.WriteNull("pedals");
                    else
                    {
                        json.WriteStartObject("pedals");
                        json.WriteString("state", b.State);
                        json.WriteString("text", b.Words);
                        json.WriteEndObject();
                    }
                    json.WriteEndObject();
                }
            }
            json.WriteEndArray();
        }

        /// <summary>One command; answers what it did in words. The caller has made the stricter check of a program's write.</summary>
        public void Post(HttpListenerContext ctx, Action<int, Action<Utf8JsonWriter>> write)
        {
            var director = Director;
            if (director == null) { Error(write, 409, "this host does not put cars' seat heights and brakes back"); return; }
            JsonDocument body;
            try
            {
                var buffer = new byte[MaxBody + 1];
                int read = 0, n;
                while (read < buffer.Length && (n = ctx.Request.InputStream.Read(buffer, read, buffer.Length - read)) > 0) read += n;
                if (read > MaxBody) { Error(write, 400, "too long"); return; }
                body = JsonDocument.Parse(new ReadOnlyMemory<byte>(buffer, 0, read));
                if (body.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
            }
            catch (JsonException)
            {
                Error(write, 400, Expected);
                return;
            }
            using (body)
            {
                var root = body.RootElement;
                if (root.TryGetProperty("switches", out var sw) && sw.ValueKind == JsonValueKind.Object)
                {
                    bool? brakes = Bool(sw, "brakes"), height = Bool(sw, "height");
                    if (brakes == null && height == null) { Error(write, 400, "a switch is brakes or height, true or false"); return; }
                    var r = director.SetSwitches(brakes, height);
                    var now = director.Switches;
                    write(200, json =>
                    {
                        json.WriteStartObject();
                        json.WriteBoolean("ok", r.Ok);
                        json.WriteBoolean("busy", r.Busy);
                        json.WriteString("why", r.Why);
                        json.WriteStartObject("switches");
                        json.WriteBoolean("brakes", now.Brakes);
                        json.WriteBoolean("height", now.Height);
                        json.WriteEndObject();
                        json.WriteEndObject();
                    });
                    return;
                }
                if (root.TryGetProperty("undo", out var undo) && undo.ValueKind == JsonValueKind.String)
                {
                    if (undo.GetString() != "all") { Error(write, 400, "undo is all"); return; }
                    WriteResult(write, director.UndoEverything());
                    return;
                }
                if (root.TryGetProperty("keys", out var keys) && keys.ValueKind == JsonValueKind.String)
                {
                    string what = keys.GetString();
                    if (what == "undo") { WriteResult(write, director.UndoBrakeKeys()); return; }
                    if (what == "move") { WriteResult(write, director.MoveBrakeKeys()); return; }
                    Error(write, 400, "keys is undo or move");
                    return;
                }
                Error(write, 400, Expected);
            }
        }

        private const string Expected = "expected { switches: { brakes?, height? } }, { undo: \"all\" } or { keys: \"undo\" | \"move\" }";

        private static void WriteResult(Action<int, Action<Utf8JsonWriter>> write, RestoreResult r) => write(200, json =>
        {
            json.WriteStartObject();
            json.WriteBoolean("ok", r.Ok);
            json.WriteBoolean("refused", r.Refused);
            json.WriteBoolean("busy", r.Busy);
            json.WriteString("action", r.Action);
            json.WriteString("why", r.Why);
            json.WriteString("text", r.Text);
            json.WriteStartArray("did");
            foreach (string d in r.Did) json.WriteStringValue(d);
            json.WriteEndArray();
            json.WriteStartArray("saw");
            foreach (string s in r.Saw) json.WriteStringValue(s);
            json.WriteEndArray();
            json.WriteEndObject();
        });

        private static bool? Bool(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) ? v.GetBoolean() : (bool?)null;

        private static void Error(Action<int, Action<Utf8JsonWriter>> write, int status, string message) =>
            write(status, json => { json.WriteStartObject(); json.WriteString("error", message); json.WriteEndObject(); });
    }
}
