using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace RacingDesk.Data.Schedule
{
    /// <summary>
    /// The one thing The Racing Desk fetches: iRacing's published season schedule PDF. It is downloaded only when the
    /// copy on disk differs from what the server reports, kept in <c>%LOCALAPPDATA%\RacingDesk\schedule</c>, and
    /// never fetched while the sim is running. A PDF dropped into that folder by hand works just as well.
    /// </summary>
    public static class ScheduleFetcher
    {
        public sealed class Result
        {
            public bool Downloaded { get; set; }
            public string Path { get; set; }
            public string Reason { get; set; }
            public long Bytes { get; set; }
        }

        /// <summary>Downloads the PDF at <paramref name="url"/> into <paramref name="directory"/> if it changed.</summary>
        public static Result Fetch(string url, string directory, Action<string> log = null, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(url)) return new Result { Reason = "no schedule URL configured" };
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
                return new Result { Reason = $"not a fetchable URL: {url}" };

            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, SafeName(uri));
            var local = new FileInfo(path);

            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            http.DefaultRequestHeaders.Add("User-Agent", "RacingDesk/1.0 (local schedule fetch)");
            try
            {
                using var head = http.Send(new HttpRequestMessage(HttpMethod.Head, uri), ct);
                long? remoteLength = head.Content.Headers.ContentLength;
                var remoteModified = head.Content.Headers.LastModified;
                if (local.Exists && remoteLength.HasValue && remoteLength.Value == local.Length &&
                    (!remoteModified.HasValue || remoteModified.Value.UtcDateTime <= local.LastWriteTimeUtc.AddSeconds(2)))
                {
                    return new Result { Path = path, Bytes = local.Length, Reason = "unchanged since the last fetch" };
                }

                using var response = http.Send(new HttpRequestMessage(HttpMethod.Get, uri), ct);
                response.EnsureSuccessStatusCode();
                string type = response.Content.Headers.ContentType?.MediaType ?? "";
                if (type.Length > 0 && !type.Contains("pdf", StringComparison.OrdinalIgnoreCase))
                    return new Result { Path = path, Reason = $"not a PDF ({type})" };

                // Write beside the target and swap, so a failed download never replaces a good schedule.
                string temp = path + ".part";
                using (var file = File.Create(temp))
                {
                    response.Content.CopyTo(file, null, ct);
                }
                var header = new byte[5];
                using (var check = File.OpenRead(temp)) check.Read(header, 0, header.Length);
                if (System.Text.Encoding.ASCII.GetString(header) != "%PDF-")
                {
                    File.Delete(temp);
                    return new Result { Path = path, Reason = "downloaded file is not a PDF" };
                }
                File.Move(temp, path, overwrite: true);
                if (remoteModified.HasValue) File.SetLastWriteTimeUtc(path, remoteModified.Value.UtcDateTime);

                var downloaded = new FileInfo(path);
                log?.Invoke($"schedule: downloaded {downloaded.Name} ({downloaded.Length / 1024} KB) from {uri.Host}");
                return new Result { Downloaded = true, Path = path, Bytes = downloaded.Length, Reason = "downloaded" };
            }
            catch (Exception ex) when (!(ex is OperationCanceledException))
            {
                return new Result { Path = local.Exists ? path : null, Reason = $"fetch failed: {ex.Message}" };
            }
        }

        /// <summary>Fetches if needed, then parses and stores. Returns what happened, for logging.</summary>
        public static string Refresh(RacingDeskStore store, string url, string directory, Action<string> log = null, CancellationToken ct = default)
        {
            var fetched = Fetch(url, directory, log, ct);
            string pdf = fetched.Path ?? Newest(directory);
            if (pdf == null || !File.Exists(pdf)) return fetched.Reason ?? "no schedule PDF";

            var storedFor = store.Scalar<string>("SELECT season FROM schedule_source ORDER BY parsed_at DESC LIMIT 1");
            long storedLength = store.Scalar<long>("SELECT COALESCE(length, 0) FROM schedule_source ORDER BY parsed_at DESC LIMIT 1");
            if (!fetched.Downloaded && storedFor != null && storedLength == new FileInfo(pdf).Length)
                return $"{storedFor} already stored ({fetched.Reason})";

            var schedule = ScheduleParser.Parse(PdfLayout.Lines(pdf), pdf);
            if (schedule.Series.Count == 0) return $"nothing parsed from {Path.GetFileName(pdf)}";
            ScheduleStore.Save(store, schedule, url);
            return $"stored {schedule.Season}: {schedule.Series.Count} series, {schedule.Series.Sum(s => s.Weeks.Count)} series-weeks";
        }

        public static string Newest(string directory) =>
            Directory.Exists(directory)
                ? new DirectoryInfo(directory).EnumerateFiles("*.pdf").OrderByDescending(f => f.LastWriteTimeUtc).Select(f => f.FullName).FirstOrDefault()
                : null;

        private static string SafeName(Uri uri)
        {
            string name = Path.GetFileName(uri.LocalPath);
            if (string.IsNullOrEmpty(name) || !name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                name = "schedule-" + DateTime.UtcNow.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ".pdf";
            foreach (char bad in Path.GetInvalidFileNameChars()) name = name.Replace(bad, '-');
            return name;
        }
    }
}
