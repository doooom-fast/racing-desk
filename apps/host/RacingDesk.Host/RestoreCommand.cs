using System;
using System.IO;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;

namespace RacingDesk.Host
{
    /// <summary>
    /// <c>RacingDesk.Host restore --dry-run</c>: what is kept for each car's seat height and brakes, worked out the way the live
    /// host does (<see cref="RestorePlanner"/>) and printed — what app.ini holds, each car's camera file and what Racing Desk
    /// keeps in it, each car's base and force. Everything is read and nothing written: the store is opened read-only (not migrated), the view files and SmartControl's database are read
    /// with their writers' leave. <c>--db</c>, <c>--documents</c> and <c>--smartcontrol</c> name copies to read instead of the
    /// rig's own, which is how it is run while anything else may have them open.
    /// </summary>
    internal static class RestoreCommand
    {
        public static int Run(HostOptions o)
        {
            if (!o.DryRun)
            {
                Console.Error.WriteLine("restore: only --dry-run is a command; the rest is the app's (Settings → Cars).");
                return 2;
            }
            string db = o.Db ?? RacingDeskStore.DefaultPath;
            if (!File.Exists(db))
            {
                Console.Error.WriteLine($"restore: no store at {db}");
                return 1;
            }
            string documents = o.Documents ?? CarViewRecorder.DefaultDocuments;
            // Backups are never made by a plan; the folder is named only because the files' reader is also their writer.
            var files = new ViewFiles(documents, Path.Combine(Path.GetTempPath(), "racing-desk-dry-run-unused"), new WindowsRigProbe(), storePath: null);
            SmartControlSnapshot smartControl = null;
            try { smartControl = SmartControl.Read(o.SmartControlDb); }
            catch (Exception ex) { Console.Error.WriteLine("restore: SmartControl's database could not be read: " + ex.Message); }

            using var store = RacingDeskStore.OpenReadOnly(db);
            var plan = RestorePlanner.Plan(store, files, smartControl);
            Console.WriteLine($"What is kept for each car (S = {Words.Cm(plan.StartHeight)}); nothing is written by this.");
            foreach (string line in plan.Lines) Console.WriteLine("  " + line);
            return 0;
        }
    }
}
