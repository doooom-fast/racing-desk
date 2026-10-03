using System;
using System.Runtime.InteropServices;
using System.Threading;
using RacingDesk.Data.Restore;

namespace RacingDesk.Host
{
    /// <summary>
    /// The one place in the repo that sends a key, and the one key it can send: F24, which nothing on the rig is bound to
    /// (none of his 35 iRacing control profiles, OBS, Stream Deck or SimHub: Phase 0, R6) and which Racing Desk binds in
    /// SmartControl Live to its switch profile. Down, 40 ms, up, with the key's own scan code. There is no method that
    /// takes a key: a second key would be a change to this class, which a test holds to (<c>SendInputOnlyHereTests</c>
    /// fails on SendInput anywhere else in the repo).
    ///
    /// It is pressed by the host's RestoreDirector alone, once per car load, when he is parked in a car whose brakes are not
    /// on the pedals yet, with iRacing in front. Windows drops a key sent to a program running above this one, which is why
    /// the window in front is asked first (<see cref="IRigProbe.ForegroundElevated"/>).
    /// </summary>
    internal sealed class KeySender : IKeySender
    {
        private const ushort VkF24 = 0x87;
        private const uint InputKeyboard = 1, KeyEventKeyUp = 0x0002, MapVkToVsc = 0;
        private static readonly TimeSpan Held = TimeSpan.FromMilliseconds(40);

        public bool SendF24()
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return false;
            ushort scan = (ushort)MapVirtualKey(VkF24, MapVkToVsc);
            int size = Marshal.SizeOf<INPUT>();
            uint down = SendInput(1, new[] { Key(scan, 0) }, size);
            Thread.Sleep(Held);
            uint up = SendInput(1, new[] { Key(scan, KeyEventKeyUp) }, size);
            return down == 1 && up == 1;
        }

        private static INPUT Key(ushort scan, uint flags) => new INPUT
        {
            type = InputKeyboard,
            u = new InputUnion { ki = new KEYBDINPUT { wVk = VkF24, wScan = scan, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero } },
        };

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        // The union is as large as its largest member, the mouse's, as Windows lays it out.
        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx, dy;
            public uint mouseData, dwFlags, time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk, wScan;
            public uint dwFlags, time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL, wParamH;
        }

        [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint mapType);
    }
}
