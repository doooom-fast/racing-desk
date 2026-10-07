using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace RacingDesk.Data.Audio
{
    /// <summary>A playback device Windows lists as active: its endpoint id and the name the Sound settings show for it.</summary>
    public sealed class AudioDevice
    {
        public AudioDevice(string id, string name)
        {
            Id = id;
            Name = name;
        }

        /// <summary>The endpoint id (<c>{0.0.0.00000000}.{guid}</c>), which stays the same while the device is paired.</summary>
        public string Id { get; }

        /// <summary>The friendly name, as in Windows' Sound settings: <c>Speakers (SineAudio DS6301M Plus V1.23)</c>.</summary>
        public string Name { get; }
    }

    /// <summary>
    /// What the sound bar's LFE switch asks of Windows' audio and nothing it does to it: which playback devices are active, which one
    /// is the default, and a call when either changes. Nothing is played, opened or set; the default device is never changed by
    /// Racing Desk.
    /// </summary>
    public interface IAudioDevices : IDisposable
    {
        /// <summary>The active playback devices, by name.</summary>
        IReadOnlyList<AudioDevice> Active();

        /// <summary>The default playback device (the one Windows plays to when nothing is chosen); null when there is none.</summary>
        AudioDevice Default();

        /// <summary>
        /// A default, or the list, changed. Called on a thread of Windows' own: do no more than note it and return (the callback must
        /// not call back into Windows' audio).
        /// </summary>
        event Action Changed;
    }

    /// <summary>
    /// Windows' Core Audio, by COM (<c>IMMDeviceEnumerator</c> and <c>IMMNotificationClient</c>): the default playback device is
    /// watched by Windows' own notification, not by looking at it on a timer. Read-only: the endpoints are listed and named, and
    /// no stream is opened.
    /// </summary>
    public sealed class WindowsAudioDevices : IAudioDevices
    {
        private const int Render = 0, RoleConsole = 0, ActiveState = 0x1;
        private static readonly PropertyKey FriendlyName = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        private const ushort VtLpwstr = 31;

        private readonly object _gate = new object();
        private IMMDeviceEnumerator _enumerator;
        private Notifications _client;
        private bool _registered;

        public event Action Changed;

        public WindowsAudioDevices()
        {
            _enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            _client = new Notifications(() => Changed?.Invoke());
            Check(_enumerator.RegisterEndpointNotificationCallback(_client), "registering for changes");
            _registered = true;
        }

        public IReadOnlyList<AudioDevice> Active()
        {
            var list = new List<AudioDevice>();
            lock (_gate)
            {
                if (_enumerator == null) return list;
                Check(_enumerator.EnumAudioEndpoints(Render, ActiveState, out IMMDeviceCollection collection), "listing the playback devices");
                try
                {
                    Check(collection.GetCount(out int count), "counting the playback devices");
                    for (int i = 0; i < count; i++)
                    {
                        if (collection.Item(i, out IMMDevice device) != 0 || device == null) continue;
                        try { var d = Describe(device); if (d != null) list.Add(d); }
                        finally { Marshal.ReleaseComObject(device); }
                    }
                }
                finally { Marshal.ReleaseComObject(collection); }
            }
            return list.OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }

        public AudioDevice Default()
        {
            lock (_gate)
            {
                if (_enumerator == null) return null;
                // 0x80070490 (element not found): no playback device at all.
                int hr = _enumerator.GetDefaultAudioEndpoint(Render, RoleConsole, out IMMDevice device);
                if (hr == unchecked((int)0x80070490) || device == null) return null;
                Check(hr, "asking for the default playback device");
                try { return Describe(device); }
                finally { Marshal.ReleaseComObject(device); }
            }
        }

        private static AudioDevice Describe(IMMDevice device)
        {
            if (device.GetId(out string id) != 0 || string.IsNullOrEmpty(id)) return null;
            string name = null;
            if (device.OpenPropertyStore(0, out IPropertyStore store) == 0 && store != null)
            {
                try
                {
                    var key = FriendlyName;
                    if (store.GetValue(ref key, out PropVariant value) == 0)
                    {
                        try { if (value.vt == VtLpwstr && value.p != IntPtr.Zero) name = Marshal.PtrToStringUni(value.p); }
                        finally { PropVariantClear(ref value); }
                    }
                }
                finally { Marshal.ReleaseComObject(store); }
            }
            return new AudioDevice(id, string.IsNullOrWhiteSpace(name) ? id : name.Trim());
        }

        private static void Check(int hr, string what)
        {
            if (hr < 0) throw new COMException("Windows' audio could not be asked (" + what + ")", hr);
        }

        public void Dispose()
        {
            lock (_gate)
            {
                if (_enumerator == null) return;
                if (_registered) { try { _enumerator.UnregisterEndpointNotificationCallback(_client); } catch (COMException) { } }
                _registered = false;
                Marshal.ReleaseComObject(_enumerator);
                _enumerator = null;
            }
            Changed = null;
        }

        /// <summary>Windows' call when a device is added, removed, changes state or becomes the default.</summary>
        private sealed class Notifications : IMMNotificationClient
        {
            private readonly Action _changed;

            public Notifications(Action changed) { _changed = changed; }

            private int Note()
            {
                try { _changed(); } catch (Exception) { /* nothing thrown here goes back into Windows */ }
                return 0;
            }

            public int OnDeviceStateChanged(string deviceId, int newState) => Note();
            public int OnDeviceAdded(string deviceId) => Note();
            public int OnDeviceRemoved(string deviceId) => Note();
            public int OnDefaultDeviceChanged(int flow, int role, string defaultDeviceId) => flow == Render ? Note() : 0;
            public int OnPropertyValueChanged(string deviceId, PropertyKey key) => 0;     // volume, names, icons: nothing to do with which is the default
        }

        // ── Core Audio (mmdeviceapi.h, propsys.h) ──

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        internal struct PropertyKey
        {
            public Guid fmtid;
            public int pid;
        }

        /// <summary>PROPVARIANT: 16 bytes on x86, 24 on x64; only a string (VT_LPWSTR) is read from it.</summary>
        [StructLayout(LayoutKind.Sequential)]
        internal struct PropVariant
        {
            public ushort vt;
            public ushort r1, r2, r3;
            public IntPtr p;
            public IntPtr p2;
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        private class MMDeviceEnumeratorComObject { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
            [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
            [PreserveSig] int RegisterEndpointNotificationCallback(IMMNotificationClient client);
            [PreserveSig] int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
        }

        [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceCollection
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int Item(int index, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
            [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore properties);
            [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetState(out int state);
        }

        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetAt(int index, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
            [PreserveSig] int Commit();
        }

        [ComImport, Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMNotificationClient
        {
            [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int newState);
            [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
            [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
            [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string defaultDeviceId);
            [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, PropertyKey key);
        }

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant value);
    }
}
