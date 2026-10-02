using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Text.Json;
using RacingDesk.Data;
using RacingDesk.Data.Restore;

namespace RacingDesk.Host
{
    /// <summary>
    /// <c>/racing-desk/data/restore</c>: putting back each car's driver height and brakes (docs/view-and-pedals-plan.md), for
    /// the app on this machine and no page (the data API's own check, <see cref="LocalDataApi"/>, is made first).
    ///
    /// <c>GET</c> answers how it stands: in trial or not, the switches, what each part needs before it may leave trial, the lines
    /// of what was done or would be (<c>?since=&lt;seq&gt;</c> for those after one, as the HUD's main process asks), the car
    /// being driven, each car's view and pedals in a sentence for the Cars page, the dry run, and the first run's steps with
    /// what each saw and his mark. <c>POST</c> takes one thing at a time, for a program on this machine alone (the stricter
    /// check the pedals' write makes): <c>{ "switches": { "height", "brakes", "horizon" } }</c>, <c>{ "step": "A2" }</c> (one
    /// of the first run's buttons), <c>{ "mark": "A2", "state": "passed" | "failed" | null }</c>, <c>{ "undo": "brakes" }</c>,
    /// <c>{ "undo": "heights" }</c>, <c>{ "undo": "height", "car": "porsche963gtp" }</c>. A host with no director (a replay)
    /// answers that it has none.
    /// </summary>
    internal sealed class RestoreApi
    {
        private const int MaxBody = 4096;

        /// <summary>The live host's director (RunLive hands it in); null in a replay, and in tests that do not give one.</summary>
        public RestoreDirector Director { get; set; }

        public void Get(HttpListenerContext ctx, Action<int, Action<Utf8JsonWriter>> write)
        {
            var director = Director;
            long since = long.TryParse(ctx.Request.QueryString["since"], NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) ? Math.Max(0, s) : -1;
            if (director == null)
            {
                write(200, json =>
                {
                    json.WriteStartObject();
                    json.WriteBoolean("available", false);
                    json.WriteString("why", "this host does not put cars' heights and brakes back (a replay, or a host from before it)");
                    json.WriteEndObject();
                });
                return;
            }

            var ctxR = director.Context;
            List<RestoreEvent> lines;
            IReadOnlyList<RestoreCheck> checks;
            ViewBaseline baseline;
            SmartControlSwitch sw;
            List<CarSmartControl> made;
            List<CarViewKeep> kept;
            using (var store = ctxR.OpenStore())
            {
                lines = store.RestoreEvents(since < 0 ? 0 : since, since < 0 ? 60 : 50).ToList();
                checks = store.RestoreChecks();
                baseline = store.ViewBaselineRow();
                sw = store.SmartControlSwitchRow();
                made = store.CarSmartControls().ToList();
                kept = store.CarViewKeeps().ToList();
            }
            var switches = director.Switches;
            write(200, json =>
            {
                json.WriteStartObject();
                json.WriteBoolean("available", true);
                json.WriteString("mode", RestorePolicy.ActingBuilt ? "on" : "trial");
                json.WriteBoolean("acting", RestorePolicy.ActingBuilt);
                json.WriteNumber("seq", lines.Count > 0 ? lines[lines.Count - 1].Id : Math.Max(0, since));
                json.WriteNumber("startHeight", ctxR.StartHeight);
                json.WriteStartObject("switches");
                json.WriteBoolean("height", switches.Height);
                json.WriteBoolean("brakes", switches.Brakes);
                json.WriteBoolean("horizon", switches.Horizon);
                json.WriteEndObject();

                json.WriteStartObject("gate");
                Gate(json, "brakes", RestoreGate.BrakesNeed, RestoreGate.BrakesProven(checks), switches.Brakes);
                Gate(json, "height", RestoreGate.HeightNeeds, RestoreGate.HeightProven(checks), switches.Height);
                Gate(json, "horizon", RestoreGate.HorizonNeeds, RestoreGate.HorizonProven(checks), switches.Horizon);
                json.WriteBoolean("seedForce", RestoreGate.SeedForceAfterSwitch(checks));
                json.WriteEndObject();

                json.WriteStartArray("lines");
                foreach (var e in lines)
                {
                    json.WriteStartObject();
                    json.WriteNumber("seq", e.Id);
                    json.WriteString("at", Iso(e.AtUtc));
                    json.WriteString("car", e.CarPath);
                    json.WriteString("what", e.What);
                    json.WriteString("state", e.State);
                    json.WriteString("text", e.Text);
                    json.WriteBoolean("hud", e.Hud);
                    json.WriteEndObject();
                }
                json.WriteEndArray();

                var now = director.Now();
                if (now == null) json.WriteNull("now");
                else
                {
                    json.WriteStartObject("now");
                    json.WriteString("car", now.Value.Car);
                    json.WriteString("name", now.Value.Name);
                    json.WriteString("place", now.Value.Place);
                    json.WriteString("flags", now.Value.Flags);
                    json.WriteEndObject();
                }

                // The rest is for the desk, not the HUD's poll (since=…): the dry run reads files and two databases.
                if (since < 0)
                {
                    RestorePlan plan = null;
                    string planWhy = null;
                    try { plan = director.Plan(); }
                    catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is System.IO.IOException || ex is InvalidOperationException) { planWhy = ex.Message; }
                    WriteCars(json, plan);
                    json.WriteStartObject("plan");
                    if (plan == null) json.WriteString("error", planWhy ?? "not made");
                    else
                    {
                        json.WriteString("appIni", plan.AppIniWords);
                        Number(json, "appIniHeight", plan.AppIniHeight);
                        json.WriteBoolean("smartControl", plan.SmartControlFound);
                        json.WriteString("madeAt", Iso(plan.MadeAtUtc));
                        json.WriteStartArray("lines");
                        foreach (string l in plan.Lines) json.WriteStringValue(l);
                        json.WriteEndArray();
                    }
                    json.WriteEndObject();

                    WriteFirstRun(json, checks);

                    json.WriteStartObject("made");
                    if (sw == null) json.WriteNull("switch");
                    else
                    {
                        json.WriteStartObject("switch");
                        json.WriteString("profile", sw.ProfileName);
                        json.WriteString("key", sw.Key);
                        json.WriteBoolean("bound", sw.BindingId.HasValue);
                        json.WriteString("madeAt", Iso(sw.MadeAtUtc));
                        json.WriteEndObject();
                    }
                    json.WriteStartArray("profiles");
                    foreach (var m in made)
                    {
                        json.WriteStartObject();
                        json.WriteString("car", m.CarPath);
                        json.WriteString("profile", m.ProfileName);
                        json.WriteString("base", m.BaseName);
                        json.WriteNumber("kg", m.WrittenKg);
                        json.WriteString("state", m.State);
                        json.WriteEndObject();
                    }
                    json.WriteEndArray();
                    json.WriteStartArray("heights");
                    foreach (var k in kept)
                    {
                        json.WriteStartObject();
                        json.WriteString("car", k.CarPath);
                        json.WriteString("file", k.CamFile);
                        Number(json, "ownZ", k.OwnZ);
                        json.WriteNumber("addedZ", k.AddedZ);
                        Number(json, "writtenZ", k.WrittenZ);
                        json.WriteBoolean("pending", !string.IsNullOrEmpty(k.Intent));
                        json.WriteEndObject();
                    }
                    json.WriteEndArray();
                    Number(json, "appIniOriginal", baseline?.IniOriginal);
                    json.WriteEndObject();
                }
                json.WriteEndObject();
            });
        }

        private static void Gate(Utf8JsonWriter json, string name, IReadOnlyList<string> needs, bool proven, bool on)
        {
            json.WriteStartObject(name);
            json.WriteBoolean("on", on);
            json.WriteBoolean("proven", proven);
            json.WriteBoolean("acts", RestoreGate.Acts(on, proven));
            json.WriteStartArray("needs");
            foreach (string step in needs) json.WriteStringValue(step);
            json.WriteEndArray();
            json.WriteEndObject();
        }

        private static void WriteCars(Utf8JsonWriter json, RestorePlan plan)
        {
            json.WriteStartArray("cars");
            if (plan != null)
            {
                var cars = plan.Views.Select(v => v.Car).Concat(plan.Brakes.Select(b => b.Car)).Distinct(StringComparer.OrdinalIgnoreCase);
                foreach (string car in cars)
                {
                    var v = plan.Views.FirstOrDefault(x => string.Equals(x.Car, car, StringComparison.OrdinalIgnoreCase));
                    var b = plan.Brakes.FirstOrDefault(x => string.Equals(x.Car, car, StringComparison.OrdinalIgnoreCase));
                    json.WriteStartObject();
                    json.WriteString("car", car);
                    json.WriteString("name", v?.Name ?? b?.Name);
                    if (v == null) json.WriteNull("view");
                    else
                    {
                        json.WriteStartObject("view");
                        json.WriteString("state", v.State);
                        json.WriteString("text", v.Words);
                        json.WriteString("camFile", v.CamFile);
                        json.WriteBoolean("hasFile", v.HasFile);
                        Number(json, "fileZ", v.FileZ);
                        Number(json, "newZ", v.NewZ);
                        Number(json, "effective", v.Effective);
                        json.WriteEndObject();
                    }
                    if (b == null) json.WriteNull("pedals");
                    else
                    {
                        json.WriteStartObject("pedals");
                        json.WriteString("state", b.State);
                        json.WriteString("text", b.Words);
                        json.WriteString("profile", b.ProfileName);
                        json.WriteString("base", b.BaseName);
                        Number(json, "kg", b.Kg);
                        json.WriteString("kgFrom", b.KgFrom);
                        json.WriteEndObject();
                    }
                    json.WriteEndObject();
                }
            }
            json.WriteEndArray();
        }

        private static void WriteFirstRun(Utf8JsonWriter json, IReadOnlyList<RestoreCheck> checks)
        {
            var byId = checks.GroupBy(c => c.Step, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.Last(), StringComparer.OrdinalIgnoreCase);
            json.WriteStartObject("firstRun");
            json.WriteStartArray("steps");
            foreach (var step in RestoreGate.Steps)
            {
                json.WriteStartObject();
                json.WriteString("id", step.Id);
                json.WriteString("part", step.Part);
                json.WriteString("title", step.Title);
                json.WriteString("heDoes", step.HeDoes);
                json.WriteString("expected", step.Expected);
                json.WriteString("settles", step.Settles);
                json.WriteStartArray("actions");
                foreach (var action in step.Actions)
                {
                    json.WriteStartObject();
                    json.WriteString("id", action.Id);
                    json.WriteString("label", action.Label);
                    json.WriteBoolean("writes", action.Writes);
                    json.WriteBoolean("presses", action.Presses);
                    if (byId.TryGetValue(action.Id, out var ran) && ran.RanAtUtc.HasValue)
                    {
                        json.WriteStartObject("ran");
                        json.WriteString("at", Iso(ran.RanAtUtc.Value));
                        json.WriteBoolean("ok", ran.RanOk == true);
                        json.WriteString("result", ran.RanResult);
                        json.WriteEndObject();
                    }
                    else json.WriteNull("ran");
                    json.WriteEndObject();
                }
                json.WriteEndArray();
                if (byId.TryGetValue(step.Id, out var marked) && marked.Mark != null)
                {
                    json.WriteStartObject("mark");
                    json.WriteString("state", marked.Mark);
                    json.WriteString("at", marked.MarkedAtUtc.HasValue ? Iso(marked.MarkedAtUtc.Value) : null);
                    json.WriteEndObject();
                }
                else json.WriteNull("mark");
                json.WriteEndObject();
            }
            json.WriteEndArray();
            json.WriteEndObject();
        }

        /// <summary>One command; answers what it did in words. The caller has made the stricter check of a program's write.</summary>
        public void Post(HttpListenerContext ctx, Action<int, Action<Utf8JsonWriter>> write)
        {
            var director = Director;
            if (director == null) { Error(write, 409, "this host does not put cars' heights and brakes back"); return; }
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
                Error(write, 400, "expected one of { switches }, { step }, { mark, state }, { undo, car? }");
                return;
            }
            using (body)
            {
                var root = body.RootElement;
                if (root.TryGetProperty("switches", out var sw) && sw.ValueKind == JsonValueKind.Object)
                {
                    var now = director.SetSwitches(Bool(sw, "height"), Bool(sw, "brakes"), Bool(sw, "horizon"));
                    write(200, json =>
                    {
                        json.WriteStartObject();
                        json.WriteBoolean("ok", true);
                        json.WriteStartObject("switches");
                        json.WriteBoolean("height", now.Height);
                        json.WriteBoolean("brakes", now.Brakes);
                        json.WriteBoolean("horizon", now.Horizon);
                        json.WriteEndObject();
                        json.WriteEndObject();
                    });
                    return;
                }
                if (Text(root, "step") is string step)
                {
                    if (RestoreGate.StepOfAction(step) == null) { Error(write, 400, "no such step"); return; }
                    WriteResult(write, director.RunStep(step));
                    return;
                }
                if (Text(root, "mark") is string mark)
                {
                    string state = root.TryGetProperty("state", out var st) && st.ValueKind == JsonValueKind.String ? st.GetString() : null;
                    if (state != null && state != "passed" && state != "failed") { Error(write, 400, "state is passed, failed or null"); return; }
                    if (!director.Mark(mark, state)) { Error(write, 400, "no such step"); return; }
                    write(200, json => { json.WriteStartObject(); json.WriteBoolean("ok", true); json.WriteString("step", mark); json.WriteString("state", state); json.WriteEndObject(); });
                    return;
                }
                if (Text(root, "undo") is string undo)
                {
                    switch (undo)
                    {
                        case "brakes": WriteResult(write, director.UndoBrakes()); return;
                        case "heights": WriteResult(write, director.UndoHeights()); return;
                        case "height":
                            string car = Text(root, "car");
                            if (string.IsNullOrWhiteSpace(car) || car.Length > 200) { Error(write, 400, "car required"); return; }
                            WriteResult(write, director.UndoHeights(car.Trim()));
                            return;
                        default: Error(write, 400, "undo is brakes, heights or height"); return;
                    }
                }
                Error(write, 400, "expected one of { switches }, { step }, { mark, state }, { undo, car? }");
            }
        }

        private static void WriteResult(Action<int, Action<Utf8JsonWriter>> write, StepResult r) => write(200, json =>
        {
            json.WriteStartObject();
            json.WriteBoolean("ok", r.Ok);
            json.WriteBoolean("refused", r.Refused);
            json.WriteString("action", r.Action);
            json.WriteString("step", r.Step);
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

        private static string Text(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static void Error(Action<int, Action<Utf8JsonWriter>> write, int status, string message) =>
            write(status, json => { json.WriteStartObject(); json.WriteString("error", message); json.WriteEndObject(); });

        private static void Number(Utf8JsonWriter json, string name, double? value)
        {
            if (value.HasValue && double.IsFinite(value.Value)) json.WriteNumber(name, value.Value);
            else json.WriteNull(name);
        }

        private static string Iso(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
    }
}
