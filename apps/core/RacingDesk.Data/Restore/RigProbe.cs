using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// What putting the height and brakes back asks of the machine, and nothing it does to it: whether the sim, the
    /// SmartControl editor and SmartControl Live are running, whether the window in front is elevated (Windows drops a key
    /// sent to a program above the sender), whether the pedals are listed by Windows, and whether the sim runs elevated.
    /// Every answer is a question asked of Windows; no device is opened, no window touched. Null where it cannot be said.
    /// </summary>
    public interface IRigProbe
    {
        /// <summary>iRacing's simulator, by either of its names (iRacingSim64DX11, iRacingSim64): asked again before each write.</summary>
        bool SimRunning();

        /// <summary>The SmartControl editor, whose cached copy of a profile would be saved over a row written while it is open.</summary>
        bool EditorRunning();

        bool LiveRunning();

        /// <summary>
        /// When SmartControl Live started (the earliest, if two run): it reads its keys then, so a binding written after this is
        /// not one it has. Null when it is not running or that cannot be asked.
        /// </summary>
        DateTime? LiveStartedAtUtc();

        /// <summary>The window in front belongs to a process above this one: a key sent now would be dropped. Null when not known.</summary>
        bool? ForegroundElevated();

        /// <summary>The process the window in front belongs to, by name; null when there is none or it cannot be said.</summary>
        string ForegroundProcess();

        /// <summary>The pedals (USB 30B7:1003) are listed by Windows: present, never opened. Null when the list cannot be read.</summary>
        bool? PedalsConnected();

        /// <summary>The sim runs elevated; null when it is not running or cannot be asked.</summary>
        bool? SimElevated();
    }

    /// <summary>
    /// The one key Racing Desk may send: F24, bound in SmartControl Live to its switch profile, sent by the director when he
    /// is parked in a car whose brakes are not on the pedals yet. The class that sends it is the host's <c>KeySender</c>, the
    /// only place in the repo that sends a key; everything here is handed this, and the tests hand a fake.
    /// </summary>
    public interface IKeySender
    {
        /// <summary>Sends F24 once: down, 40 ms, up. False when Windows took none of it.</summary>
        bool SendF24();
    }

    /// <summary>Windows' answers, by its own calls. The process names are the ones the rig has.</summary>
    public sealed class WindowsRigProbe : IRigProbe
    {
        public static readonly string[] SimProcesses = { "iRacingSim64DX11", "iRacingSim64" };
        public const string EditorProcess = "SmartControl";
        public const string LiveProcess = "SmartControl Live";

        /// <summary>The pedals' USB ids: "Heusinkveld Sim Pedals Ultimate".</summary>
        public const string PedalsInstancePrefix = @"USB\VID_30B7&PID_1003";

        public bool SimRunning()
        {
            foreach (string name in SimProcesses)
                if (Running(name)) return true;
            return false;
        }

        public bool EditorRunning() => Running(EditorProcess);

        public bool LiveRunning() => Running(LiveProcess);

        public DateTime? LiveStartedAtUtc()
        {
            Process[] found;
            try { found = Process.GetProcessesByName(LiveProcess); }
            catch (Exception) { return null; }
            try
            {
                DateTime? earliest = null;
                foreach (var p in found)
                {
                    DateTime started;
                    try { started = p.StartTime.ToUniversalTime(); }
                    catch (Exception) { return null; }      // one that cannot be asked: when Live started is not known
                    if (earliest == null || started < earliest) earliest = started;
                }
                return earliest;
            }
            finally
            {
                foreach (var p in found) p.Dispose();
            }
        }

        private static bool Running(string name)
        {
            try
            {
                var found = Process.GetProcessesByName(name);
                foreach (var p in found) p.Dispose();
                return found.Length > 0;
            }
            catch (Exception)
            {
                // Not being able to ask is not the program being away: say it is there, which stops a write.
                return true;
            }
        }

        public bool? ForegroundElevated()
        {
            int pid = ForegroundPid();
            return pid <= 0 ? (bool?)null : Elevated(pid, notOpened: true);
        }

        public string ForegroundProcess()
        {
            int pid = ForegroundPid();
            if (pid <= 0) return null;
            try
            {
                using var p = Process.GetProcessById(pid);
                return p.ProcessName;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public bool? SimElevated()
        {
            foreach (string name in SimProcesses)
            {
                Process[] found;
                try { found = Process.GetProcessesByName(name); }
                catch (Exception) { return null; }
                try
                {
                    if (found.Length > 0) return Elevated(found[0].Id, notOpened: true);
                }
                finally
                {
                    foreach (var p in found) p.Dispose();
                }
            }
            return null;
        }

        public bool? PedalsConnected()
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return null;
            IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, "USB", IntPtr.Zero, DIGCF_PRESENT | DIGCF_ALLCLASSES);
            if (set == INVALID_HANDLE_VALUE) return null;
            try
            {
                var info = new SP_DEVINFO_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVINFO_DATA>() };
                var id = new StringBuilder(512);
                for (uint i = 0; SetupDiEnumDeviceInfo(set, i, ref info); i++)
                {
                    id.Clear();
                    if (!SetupDiGetDeviceInstanceIdW(set, ref info, id, id.Capacity, out _)) continue;
                    if (id.ToString().StartsWith(PedalsInstancePrefix, StringComparison.OrdinalIgnoreCase)) return true;
                }
                return false;
            }
            finally
            {
                SetupDiDestroyDeviceInfoList(set);
            }
        }

        private static int ForegroundPid()
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return 0;
            IntPtr window = GetForegroundWindow();
            if (window == IntPtr.Zero) return 0;
            GetWindowThreadProcessId(window, out uint pid);
            return (int)pid;
        }

        /// <summary>
        /// The process's token says it is elevated. A process this one may not even ask (access denied) is above it, as
        /// far as a key is concerned: <paramref name="notOpened"/> is the answer then.
        /// </summary>
        private static bool? Elevated(int pid, bool notOpened)
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return null;
            IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return notOpened;
            try
            {
                if (!OpenProcessToken(process, TOKEN_QUERY, out IntPtr token)) return notOpened;
                try
                {
                    if (!GetTokenInformation(token, TokenElevation, out int elevated, 4, out _)) return null;
                    return elevated != 0;
                }
                finally
                {
                    CloseHandle(token);
                }
            }
            finally
            {
                CloseHandle(process);
            }
        }

        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x0008;
        private const int TokenElevation = 20;
        private const uint DIGCF_PRESENT = 0x2, DIGCF_ALLCLASSES = 0x4;
        private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        private struct SP_DEVINFO_DATA
        {
            public uint cbSize;
            public Guid ClassGuid;
            public uint DevInst;
            public IntPtr Reserved;
        }

        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int length, out int returned);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string enumerator, IntPtr parent, uint flags);
        [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref SP_DEVINFO_DATA info);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref SP_DEVINFO_DATA info, StringBuilder id, int size, out int required);
        [DllImport("setupapi.dll")] private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    }
}
