using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace RacingDesk.Data.Pedals
{
    /// <summary>Whether a key is down, asked of Windows. No hook is set and no key is taken from anyone.</summary>
    public static class Keyboard
    {
        [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);

        /// <summary>The top bit set means the key is down. Zero anywhere but on Windows.</summary>
        public static short State(int key)
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return 0;
            try { return GetAsyncKeyState(key); }
            catch (EntryPointNotFoundException) { return 0; }
            catch (DllNotFoundException) { return 0; }
        }
    }

    /// <summary>
    /// The brake force SmartControl Live's keys have left the pedals at. Nothing on the PC records it: a key
    /// goes to Live, Live tells the controller, and the controller keeps it. So the force is followed from the
    /// keys themselves. It is known from the first key that sets one; until then only the change is.
    /// </summary>
    public sealed class BrakeForceTracker
    {
        /// <summary>Kilograms, or null while no key that sets a force has been pressed.</summary>
        public double? ForceKg { get; private set; }

        /// <summary>What the keys that raise and lower have added up to while the force itself was not known.</summary>
        public double ChangeKg { get; private set; }

        /// <summary>Keys that did something, since the tracker was made.</summary>
        public int Presses { get; private set; }

        /// <param name="knownKg">The force the pedals are known to be at already, if it is known.</param>
        public BrakeForceTracker(double? knownKg = null)
        {
            ForceKg = knownKg;
        }

        public void Press(LiveKey key)
        {
            if (key == null) return;
            switch (key.Action)
            {
                case LiveAction.SetBrakeForce:
                    ForceKg = key.Value;
                    ChangeKg = 0;
                    break;
                case LiveAction.RaiseBrakeForce:
                    if (ForceKg.HasValue) ForceKg += key.Value; else ChangeKg += key.Value;
                    break;
                case LiveAction.LowerBrakeForce:
                    // No force is less than none. Where Live itself stops is not known, so nothing else is assumed.
                    if (ForceKg.HasValue) ForceKg = Math.Max(0, ForceKg.Value - key.Value); else ChangeKg -= key.Value;
                    break;
                default:
                    return;
            }
            Presses++;
        }
    }

    /// <summary>
    /// Notices SmartControl Live's brake-force keys as they are pressed, by asking Windows whether each is down.
    /// It asks about those keys and no others: the list is <see cref="Watched"/>, and it is made from Live's own
    /// bindings. Nothing typed is seen, and nothing is kept but which of Live's keys was pressed.
    /// </summary>
    public sealed class LiveKeyWatcher
    {
        private sealed class Binding
        {
            public LiveKey Key;
            public int Trigger;          // the key whose going down is the press
            public int? Held;            // the key that has to be down with it
        }

        private readonly List<Binding> _bindings = new List<Binding>();
        private readonly Func<int, short> _state;
        private readonly Dictionary<int, bool> _down = new Dictionary<int, bool>();
        private bool _primed;

        /// <summary>Windows' numbers for the keys asked about.</summary>
        public IReadOnlyList<int> Watched { get; }

        /// <summary>Bindings left out because a key in them has a name this does not know.</summary>
        public IReadOnlyList<LiveKey> NotWatched { get; }

        /// <param name="keys">Live's bindings. Only those that set, raise or lower the brake force are watched.</param>
        /// <param name="state">Windows' GetAsyncKeyState: the top bit set means the key is down.</param>
        public LiveKeyWatcher(IEnumerable<LiveKey> keys, Func<int, short> state)
        {
            _state = state ?? throw new ArgumentNullException(nameof(state));
            var unknown = new List<LiveKey>();
            foreach (var key in keys ?? Enumerable.Empty<LiveKey>())
            {
                if (key == null || key.Action == LiveAction.Other) continue;
                int? first = VirtualKey(key.FirstKey), second = VirtualKey(key.SecondKey);
                bool pair = !string.IsNullOrWhiteSpace(key.SecondKey);
                if (first == null || (pair && second == null))
                {
                    unknown.Add(key);
                    continue;
                }
                _bindings.Add(pair
                    ? new Binding { Key = key, Trigger = second.Value, Held = first.Value }
                    : new Binding { Key = key, Trigger = first.Value });
            }
            Watched = _bindings.SelectMany(b => b.Held.HasValue ? new[] { b.Held.Value, b.Trigger } : new[] { b.Trigger })
                .Distinct().OrderBy(k => k).ToList();
            NotWatched = unknown;
        }

        /// <summary>
        /// The keys of Live's pressed since the last call, in the order of Live's bindings. A key held down is
        /// one press. The first call only looks: a key already down when watching began was not pressed in it.
        /// </summary>
        public IReadOnlyList<LiveKey> Poll()
        {
            var went = new HashSet<int>();
            var now = new Dictionary<int, bool>();
            foreach (int key in Watched)
            {
                bool down = (_state(key) & 0x8000) != 0;
                now[key] = down;
                if (_primed && down && !(_down.TryGetValue(key, out bool was) && was)) went.Add(key);
            }
            foreach (var pair in now) _down[pair.Key] = pair.Value;
            if (!_primed)
            {
                _primed = true;
                return Array.Empty<LiveKey>();
            }

            var pressed = new List<LiveKey>();
            foreach (int trigger in went)
            {
                var with = _bindings.Where(b => b.Trigger == trigger && b.Held.HasValue && now[b.Held.Value]).ToList();
                // Up with Right Ctrl held is that pair's, and not also the press of a key bound to Up alone.
                var mine = with.Count > 0 ? with : _bindings.Where(b => b.Trigger == trigger && !b.Held.HasValue).ToList();
                pressed.AddRange(mine.Select(b => b.Key));
            }
            return pressed.OrderBy(k => _bindings.FindIndex(b => ReferenceEquals(b.Key, k))).ToList();
        }

        /// <summary>
        /// Windows' number for a key by the name SmartControl writes, which is Windows' own name for it without
        /// the <c>VK_</c>: <c>PRIOR</c> is Page Up, <c>RCONTROL</c> the right Ctrl. Null for a name not known.
        /// </summary>
        public static int? VirtualKey(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            string n = name.Trim().ToUpperInvariant();
            if (n.StartsWith("VK_", StringComparison.Ordinal)) n = n.Substring(3);
            if (n.Length == 1 && ((n[0] >= '0' && n[0] <= '9') || (n[0] >= 'A' && n[0] <= 'Z'))) return n[0];
            if (n.Length >= 2 && n[0] == 'F' && int.TryParse(n.Substring(1), out int f) && f >= 1 && f <= 24) return 0x70 + f - 1;
            if (n.StartsWith("NUMPAD", StringComparison.Ordinal) && n.Length == 7 && n[6] >= '0' && n[6] <= '9') return 0x60 + (n[6] - '0');
            return Names.TryGetValue(n, out int key) ? key : (int?)null;
        }

        private static readonly Dictionary<string, int> Names = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["BACK"] = 0x08, ["TAB"] = 0x09, ["CLEAR"] = 0x0C, ["RETURN"] = 0x0D, ["SHIFT"] = 0x10, ["CONTROL"] = 0x11,
            ["MENU"] = 0x12, ["PAUSE"] = 0x13, ["CAPITAL"] = 0x14, ["ESCAPE"] = 0x1B, ["SPACE"] = 0x20,
            ["PRIOR"] = 0x21, ["NEXT"] = 0x22, ["END"] = 0x23, ["HOME"] = 0x24,
            ["LEFT"] = 0x25, ["UP"] = 0x26, ["RIGHT"] = 0x27, ["DOWN"] = 0x28,
            ["SNAPSHOT"] = 0x2C, ["INSERT"] = 0x2D, ["DELETE"] = 0x2E,
            ["LWIN"] = 0x5B, ["RWIN"] = 0x5C, ["APPS"] = 0x5D,
            ["MULTIPLY"] = 0x6A, ["ADD"] = 0x6B, ["SEPARATOR"] = 0x6C, ["SUBTRACT"] = 0x6D, ["DECIMAL"] = 0x6E, ["DIVIDE"] = 0x6F,
            ["NUMLOCK"] = 0x90, ["SCROLL"] = 0x91,
            ["LSHIFT"] = 0xA0, ["RSHIFT"] = 0xA1, ["LCONTROL"] = 0xA2, ["RCONTROL"] = 0xA3, ["LMENU"] = 0xA4, ["RMENU"] = 0xA5,
            ["OEM_1"] = 0xBA, ["OEM_PLUS"] = 0xBB, ["OEM_COMMA"] = 0xBC, ["OEM_MINUS"] = 0xBD, ["OEM_PERIOD"] = 0xBE,
            ["OEM_2"] = 0xBF, ["OEM_3"] = 0xC0, ["OEM_4"] = 0xDB, ["OEM_5"] = 0xDC, ["OEM_6"] = 0xDD, ["OEM_7"] = 0xDE,
        };
    }
}
