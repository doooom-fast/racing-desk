using System;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Core.Names
{
    /// <summary>
    /// The plugin's path: where SimHub's opponents, with their real names, enter the program and are named. The plugin's
    /// source (<c>SimHubTelemetrySource</c>) hands this class the three facts it reads off a SimHub opponent — the car's
    /// number, the name and SimHub's own "this is the player" flag — and the game's name, and shows what comes back; the
    /// real name goes no further. It lives here, in the engine's assembly, so the tests run the code the plugin runs.
    ///
    /// For iRacing the answer comes from the SDK bridge (<see cref="IRacingSdkBridge"/>), which has read the session YAML
    /// and names each car by its customer id: until it has, no one is named (null: the leaderboard leaves the row out and
    /// the commentary uses the name in Settings), and the player is his own only when SimHub's name is the one the session
    /// gives him (a teammate driving his car, or a camera on another car, is another driver). For another sim there is no
    /// session to read: his own is SimHub's word, and every other driver is a character keyed on the name, salted, from one
    /// <see cref="Pseudonymizer"/> kept for as long as the plugin runs, so no two share a name.
    /// </summary>
    public sealed class SimHubNaming
    {
        private readonly object _gate = new object();
        private readonly Func<PseudonymBook> _book;
        private Pseudonymizer _others;
        private int _sessions;

        /// <param name="book">The book to name from; the machine's (<see cref="PseudonymBook.Default"/>) when none is given.</param>
        public SimHubNaming(Func<PseudonymBook> book = null)
        {
            _book = book ?? (() => PseudonymBook.Default);
        }

        /// <summary>The plugin's own reading of the iRacing session; null where there is none.</summary>
        public IRacingSdkBridge Bridge { get; set; }

        /// <summary>Whether SimHub's game name is iRacing's (SimHub says "IRacing").</summary>
        public static bool IsIRacing(string gameName) =>
            gameName != null && gameName.IndexOf("iracing", StringComparison.OrdinalIgnoreCase) >= 0;

        /// <summary>
        /// What a SimHub opponent is called wherever it is shown or sent: his own name for his own car, a character's for
        /// every other. Null for a car that cannot be named yet (iRacing, before the session has been read).
        /// </summary>
        public string Opponent(string gameName, string carNumber, string name, bool isPlayer)
        {
            if (IsIRacing(gameName))
            {
                var bridge = Bridge;
                return bridge?.OpponentName(carNumber, name, isPlayer);
            }
            if (isPlayer) return name;
            return Other(name);
        }

        /// <summary>
        /// What the player is called: SimHub's <paramref name="given"/> name when it is his, and for iRacing otherwise a
        /// character's; an empty name until the session has been read (the commentary then uses the name in Settings).
        /// </summary>
        public string Player(string gameName, string given)
        {
            if (!IsIRacing(gameName)) return given;
            var bridge = Bridge;
            return bridge == null ? "" : bridge.PlayerName(given);
        }

        private string Other(string name)
        {
            lock (_gate)
            {
                if (_others == null)
                {
                    _others = _book().NewSession();
                    _others.BeginSession("simhub:" + _sessions);
                }
                // The table is the plugin's for as long as it runs; one that has used up the list starts again, so a long run
                // of other sims' drivers never gets numbered names.
                int listed = _others.Book.List.Count;
                if (listed > 0 && _others.Named >= listed) _others.BeginSession("simhub:" + (++_sessions));
                return _others.For(0, name);
            }
        }
    }
}
