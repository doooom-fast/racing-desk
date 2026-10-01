using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text.Json;
using RacingDesk.Plugin;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Host
{
    /// <summary>
    /// iRacing's replay and cameras, for the app's TV shots: <c>GET /racing-desk/data/replay</c> says where the replay
    /// and the cameras stand (and which camera groups the session has), <c>POST /racing-desk/data/replay</c> takes one
    /// command — <c>seek</c> (a session number and seconds into it: the SDK's ReplaySearchSessionTime), <c>speed</c>,
    /// <c>position</c>, <c>camera</c> (a focus or a car number, and a camera group), <c>cameraState</c> (the camera
    /// flags, whole) — and sends it to the sim through <see cref="IReplayControl"/>. A command is refused (409) while
    /// the sim says the driver is on track: his replay and cameras are his then. Both are for a program on this machine
    /// and no other, by the check the runtime's
    /// <c>?action=</c> routes make (<see cref="LocalRequest"/>): the connection is this machine's, the Host names it, no
    /// browser sent it. They write to the sim's window, so a read is gated like the write. With no sim connected a GET
    /// says so and a POST is refused (409); a host replaying a file has no control at all and says that.
    /// </summary>
    internal sealed class ReplayApi
    {
        private const int MaxBody = 4096;
        private const string NotThisMachine = "this is for the app on this machine";
        private const string NotLive = "iRacing is not running, so its replay cannot be driven.";
        private const string FileReplay = "This host is replaying a file, not driving iRacing, so there is no replay to drive.";
        private const string Driving = "You are in the car, so the replay and the cameras are left alone.";

        /// <summary>The live reader, once the host has one; null for a file replay.</summary>
        public IReplayControl Replay { get; set; }

        /// <summary>Answers the route whole. The caller has matched the path.</summary>
        public void Handle(HttpListenerContext ctx)
        {
            var res = ctx.Response;
            try
            {
                res.Headers.Add("Cache-Control", "no-store");
                res.ContentType = "application/json; charset=utf-8";
                if (!LocalRequest.IsFromThisMachine(ctx.Request))
                {
                    Error(res, 403, NotThisMachine);
                    return;
                }
                if (ctx.Request.HttpMethod == "GET") { Status(res); return; }
                if (ctx.Request.HttpMethod == "POST") { Command(ctx); return; }
                Error(res, 405, "GET or POST");
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.Host] data/replay failed: {ex.Message}");
                try { res.StatusCode = 500; } catch { }
            }
            finally
            {
                try { res.OutputStream.Close(); } catch { }
            }
        }

        private void Status(HttpListenerResponse res)
        {
            var control = Replay;
            var status = control != null && control.IsConnected ? control.Status() : null;
            Write(res, 200, json =>
            {
                json.WriteStartObject();
                json.WriteBoolean("available", status != null);
                json.WriteBoolean("connected", control != null && control.IsConnected);
                if (control == null) json.WriteString("reason", FileReplay);
                else if (status == null) json.WriteString("reason", NotLive);
                if (status != null)
                {
                    json.WriteBoolean("replayPlaying", status.IsReplayPlaying);
                    json.WriteBoolean("onTrack", status.IsOnTrack);
                    json.WriteNumber("sessionNum", status.SessionNum);
                    json.WriteNumber("sessionTime", status.SessionTime);
                    json.WriteStartObject("replay");
                    json.WriteNumber("sessionNum", status.ReplaySessionNum);
                    json.WriteNumber("sessionTime", status.ReplaySessionTime);
                    json.WriteNumber("frame", status.ReplayFrameNum);
                    json.WriteNumber("frameEnd", status.ReplayFrameNumEnd);
                    json.WriteNumber("speed", status.ReplayPlaySpeed);
                    json.WriteBoolean("slowMotion", status.ReplayPlaySlowMotion);
                    json.WriteEndObject();
                    json.WriteStartObject("camera");
                    json.WriteNumber("group", status.CamGroupNumber);
                    json.WriteNumber("camera", status.CamCameraNumber);
                    json.WriteNumber("carIdx", status.CamCarIdx);
                    json.WriteNumber("state", status.CamCameraState);
                    json.WriteEndObject();
                    json.WriteStartObject("weekend");
                    json.WriteString("trackName", status.TrackName ?? "");
                    json.WriteString("trackDisplayName", status.TrackDisplayName ?? "");
                    json.WriteNumber("subSessionId", status.SubSessionId);
                    json.WriteEndObject();
                    json.WriteStartObject("player");
                    json.WriteNumber("carIdx", status.PlayerCarIdx);
                    json.WriteString("carNumber", status.PlayerCarNumber ?? "");
                    json.WriteNumber("carNumberRaw", status.PlayerCarNumberRaw);
                    json.WriteEndObject();
                    json.WriteStartArray("groups");
                    foreach (var g in status.Groups)
                    {
                        json.WriteStartObject();
                        json.WriteNumber("num", g.Num);
                        json.WriteString("name", g.Name ?? "");
                        json.WriteNumber("cameras", g.Cameras);
                        json.WriteEndObject();
                    }
                    json.WriteEndArray();
                }
                json.WriteEndObject();
            });
        }

        private void Command(HttpListenerContext ctx)
        {
            var res = ctx.Response;
            var control = Replay;
            if (control == null) { Error(res, 409, FileReplay); return; }
            if (!control.IsConnected) { Error(res, 409, NotLive); return; }
            // Every command goes to the sim's window, whose replay and cameras are the driver's own while he is in the car:
            // a program on this machine — the app's TV shots among them — is refused while the sim says he is on track,
            // whatever it was in the middle of.
            var now = control.Status();
            if (now != null && now.IsOnTrack) { Error(res, 409, Driving); return; }

            JsonDocument body;
            try
            {
                var buffer = new byte[MaxBody + 1];
                int read = 0, n;
                while (read < buffer.Length && (n = ctx.Request.InputStream.Read(buffer, read, buffer.Length - read)) > 0) read += n;
                if (read > MaxBody) { Error(res, 400, "too long"); return; }
                body = JsonDocument.Parse(new ReadOnlyMemory<byte>(buffer, 0, read));
            }
            catch (Exception)
            {
                Error(res, 400, "expected a JSON object with a command");
                return;
            }
            using (body)
            {
                var root = body.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("command", out var cmd) || cmd.ValueKind != JsonValueKind.String)
                {
                    Error(res, 400, "expected { \"command\": \"seek\" | \"speed\" | \"position\" | \"camera\" | \"cameraState\", ... }");
                    return;
                }
                string what;
                switch (cmd.GetString())
                {
                    case "seek":
                    {
                        // The sidecar's sn and st: the session of the event and seconds into it, sent as milliseconds.
                        if (!Int(root, "sessionNum", 0, 999, out int sessionNum) || !Number(root, "sessionTime", 0, 7 * 24 * 3600, out double sessionTime))
                        {
                            Error(res, 400, "seek needs sessionNum (a whole number) and sessionTime (seconds, 0 or more)");
                            return;
                        }
                        control.SearchSessionTime(sessionNum, (int)Math.Round(sessionTime * 1000.0));
                        what = $"seek to session {sessionNum} at {sessionTime.ToString("F3", CultureInfo.InvariantCulture)} s";
                        break;
                    }
                    case "speed":
                    {
                        if (!Int(root, "speed", -16, 16, out int speed)) { Error(res, 400, "speed needs speed (-16 to 16)"); return; }
                        bool slow = root.TryGetProperty("slowMotion", out var sm) && sm.ValueKind == JsonValueKind.True;
                        control.SetPlaySpeed(speed, slow);
                        what = $"speed {speed}{(slow ? " slow" : "")}";
                        break;
                    }
                    case "position":
                    {
                        string from = root.TryGetProperty("from", out var f) && f.ValueKind == JsonValueKind.String ? f.GetString() : "begin";
                        ReplayPositionFrom where;
                        if (from == "begin") where = ReplayPositionFrom.Begin;
                        else if (from == "current") where = ReplayPositionFrom.Current;
                        else if (from == "end") where = ReplayPositionFrom.End;
                        else { Error(res, 400, "position needs from: begin, current or end"); return; }
                        if (!Int(root, "frame", int.MinValue, int.MaxValue, out int frame)) frame = 0;
                        control.SetPlayPosition(where, frame);
                        what = $"position {from} {frame}";
                        break;
                    }
                    case "camera":
                    {
                        if (!Int(root, "group", 0, 999, out int group)) { Error(res, 400, "camera needs group (a camera group's number)"); return; }
                        if (!Int(root, "camera", 0, 999, out int camera)) camera = 0;
                        if (Int(root, "carNumber", 0, 9999, out int carNumber) && root.TryGetProperty("carNumber", out _))
                        {
                            control.SwitchCameraToCar(carNumber, group, camera);
                            what = $"camera group {group} on car {carNumber}";
                            break;
                        }
                        string focus = root.TryGetProperty("focus", out var fo) && fo.ValueKind == JsonValueKind.String ? fo.GetString() : "driver";
                        ReplayCameraFocus at;
                        if (focus == "driver") at = ReplayCameraFocus.Driver;
                        else if (focus == "leader") at = ReplayCameraFocus.Leader;
                        else if (focus == "incident") at = ReplayCameraFocus.Incident;
                        else if (focus == "exiting") at = ReplayCameraFocus.Exiting;
                        else { Error(res, 400, "camera needs focus: driver, leader, incident or exiting, or a carNumber"); return; }
                        control.SwitchCamera(at, group, camera);
                        what = $"camera group {group} on the {focus}";
                        break;
                    }
                    case "cameraState":
                    {
                        // The camera system's flags, whole (CameraState: 8 hides iRacing's own replay controls). The nine
                        // flags the SDK has are 0 to 511; a caller changing one reads the status's camera.state first.
                        if (!Int(root, "state", 0, 511, out int state)) { Error(res, 400, "cameraState needs state (the camera flags, 0 to 511)"); return; }
                        control.SetCameraState(state);
                        what = $"camera state {state}";
                        break;
                    }
                    default:
                        Error(res, 400, "unknown command: seek, speed, position, camera or cameraState");
                        return;
                }
                Log.Info($"[RacingDesk.Host] replay: {what}");
                Write(res, 200, json => { json.WriteStartObject(); json.WriteBoolean("ok", true); json.WriteString("did", what); json.WriteEndObject(); });
            }
        }

        private static bool Int(JsonElement root, string name, int low, int high, out int value)
        {
            value = 0;
            if (!root.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out double d)) return false;
            if (double.IsNaN(d) || d < low || d > high || Math.Abs(d - Math.Round(d)) > 1e-9) return false;
            value = (int)Math.Round(d);
            return true;
        }

        private static bool Number(JsonElement root, string name, double low, double high, out double value)
        {
            value = 0;
            if (!root.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out double d)) return false;
            if (double.IsNaN(d) || double.IsInfinity(d) || d < low || d > high) return false;
            value = d;
            return true;
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
