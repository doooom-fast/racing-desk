using System;
using System.Globalization;
using System.Net;
using System.Text.Json;
using RacingDesk.Data.Audio;

namespace RacingDesk.Host
{
    /// <summary>
    /// <c>/racing-desk/data/soundbar</c>: iRacing's LFE off while the sound bar is the default playback device, for the app on
    /// this machine and no page (the data API's own check, <see cref="LocalDataApi"/>, is made first).
    ///
    /// <c>GET</c> answers the switch, the active playback devices, the one taken for the sound bar, whether it is the default now,
    /// and how it stands: what it did last and when, what it waits for, what went wrong. <c>POST</c> takes one thing at a time, from
    /// a program on this machine alone: <c>{ "enabled": true|false }</c> or <c>{ "device": "&lt;id&gt;" }</c> (an empty id goes
    /// back to the device with SineAudio in its name). A host with no service (a replay) answers that it has none.
    /// </summary>
    internal sealed class SoundBarApi
    {
        private const int MaxBody = 2048;

        /// <summary>The live host's service (RunLive hands it in); null in a replay, and in tests that do not give one.</summary>
        public SoundBarLfe Service { get; set; }

        public void Get(HttpListenerContext ctx, Action<int, Action<Utf8JsonWriter>> write)
        {
            var service = Service;
            if (service == null)
            {
                write(200, json =>
                {
                    json.WriteStartObject();
                    json.WriteBoolean("available", false);
                    json.WriteString("why", "this host does not watch the playback device (a replay, or a host from before it)");
                    json.WriteEndObject();
                });
                return;
            }

            var view = service.View();
            write(200, json =>
            {
                json.WriteStartObject();
                json.WriteBoolean("available", true);
                json.WriteBoolean("enabled", view.Enabled);
                if (view.Device == null) json.WriteNull("device");
                else
                {
                    json.WriteStartObject("device");
                    json.WriteString("id", view.Device.Id);
                    json.WriteString("name", view.Device.Name);
                    json.WriteBoolean("connected", view.Connected);
                    json.WriteEndObject();
                }
                json.WriteStartArray("devices");
                foreach (var d in view.Devices)
                {
                    json.WriteStartObject();
                    json.WriteString("id", d.Id);
                    json.WriteString("name", d.Name);
                    json.WriteEndObject();
                }
                json.WriteEndArray();
                json.WriteBoolean("onSoundBar", view.OnSoundBar);
                json.WriteStartObject("status");
                json.WriteString("state", view.State);
                Nullable(json, "last", view.Last);
                Nullable(json, "lastAtUtc", view.LastAtUtc.HasValue ? view.LastAtUtc.Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture) : null);
                Nullable(json, "waiting", view.Waiting);
                Nullable(json, "problem", view.Problem);
                json.WriteEndObject();
                json.WriteEndObject();
            });
        }

        private static void Nullable(Utf8JsonWriter json, string name, string value)
        {
            if (value == null) json.WriteNull(name);
            else json.WriteString(name, value);
        }

        /// <summary>One command; answers whether it was taken. The caller has made the stricter check of a program's write.</summary>
        public void Post(HttpListenerContext ctx, Action<int, Action<Utf8JsonWriter>> write)
        {
            var service = Service;
            if (service == null) { Error(write, 409, "this host does not watch the playback device"); return; }
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
                if (root.TryGetProperty("enabled", out var on) && (on.ValueKind == JsonValueKind.True || on.ValueKind == JsonValueKind.False))
                {
                    service.SetEnabled(on.GetBoolean());
                    Done(write, true, null, service);
                    return;
                }
                if (root.TryGetProperty("device", out var device) && device.ValueKind == JsonValueKind.String)
                {
                    bool taken = service.SetDevice(device.GetString());
                    Done(write, taken, taken ? null : "Windows doesn't list that device now", service);
                    return;
                }
                Error(write, 400, Expected);
            }
        }

        private const string Expected = "expected { enabled: true|false } or { device: \"<id>\" }";

        private static void Done(Action<int, Action<Utf8JsonWriter>> write, bool ok, string why, SoundBarLfe service) => write(200, json =>
        {
            json.WriteStartObject();
            json.WriteBoolean("ok", ok);
            Nullable(json, "why", why);
            json.WriteBoolean("enabled", service.Settings.Enabled);
            json.WriteEndObject();
        });

        private static void Error(Action<int, Action<Utf8JsonWriter>> write, int status, string message) =>
            write(status, json => { json.WriteStartObject(); json.WriteString("error", message); json.WriteEndObject(); });
    }
}
