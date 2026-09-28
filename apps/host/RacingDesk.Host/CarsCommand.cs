using System;
using System.IO;
using System.Threading;
using RacingDesk.Data;

namespace RacingDesk.Host
{
    /// <summary>
    /// `RacingDesk.Host cars` — the cars the store can put a name to, by iRacing's folder name for them. The names
    /// come out of the session YAML of the driver's own sessions, so a car never seen in one has none.
    /// `--scan` reads them out of the .ibt files that were ingested before the store kept them.
    /// </summary>
    internal static class CarsCommand
    {
        public static int Run(HostOptions o) => Run(o, Console.Out);

        internal static int Run(HostOptions o, TextWriter output)
        {
            using var store = new RacingDeskStore(o.Db ?? RacingDeskStore.DefaultPath);
            if (o.Scan)
            {
                using var cts = new CancellationTokenSource();
                ConsoleCancelEventHandler cancel = (_, e) => { e.Cancel = true; cts.Cancel(); };
                Console.CancelKeyPress += cancel;
                try
                {
                    var scan = new IbtIngest(store, m => output.WriteLine("  " + m)).ScanCars(cts.Token, o.Now ? null : BackgroundIo.SimRunning);
                    output.WriteLine(Describe(scan));
                }
                finally
                {
                    Console.CancelKeyPress -= cancel;
                }
            }

            var cars = store.Cars();
            output.WriteLine($"{cars.Count} cars in {store.Path}");
            foreach (var car in cars)
                output.WriteLine($"{Trim(car.Name, 40),-40}  {Trim(car.CarPath, 32),-32}  {car.Driven,5} driven  {car.Seen,5} seen");
            return 0;
        }

        public static string Describe(CarScanSummary scan) =>
            scan.FilesScanned + scan.FilesMissing + scan.FilesFailed + scan.FilesLeft == 0
                ? "car names: every ingested file has been read"
                : $"car names: {scan.FilesScanned} headers read, {scan.Cars} cars, {scan.FilesMissing} files gone, " +
                  $"{scan.FilesFailed} unreadable{(scan.FilesLeft > 0 ? $", {scan.FilesLeft} still to read" : "")}; {scan.Elapsed.TotalSeconds:F1}s";

        private static string Trim(string s, int n) => string.IsNullOrEmpty(s) ? "" : s.Length <= n ? s : s.Substring(0, n - 1) + "…";
    }
}
