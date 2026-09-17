using System;

namespace RaceCorProDrive.Plugin
{
    /// <summary>
    /// Host-agnostic logging. The SimHub plugin routes this to SimHub.Logging; the standalone host
    /// routes it to its own log. Defaults to the debug output so core code can log before a host
    /// has wired a sink (and in tests).
    /// </summary>
    public static class Log
    {
        public enum Level { Info, Warn, Error }

        /// <summary>Replace to route log lines. Must be thread-safe; called from engine and server threads.</summary>
        public static Action<Level, string> Sink { get; set; } = DefaultSink;

        public static void Info(string message) => Write(Level.Info, message);
        public static void Warn(string message) => Write(Level.Warn, message);
        public static void Error(string message) => Write(Level.Error, message);

        private static void Write(Level level, string message)
        {
            try { Sink?.Invoke(level, message); }
            catch { /* logging must never take the engine down */ }
        }

        private static void DefaultSink(Level level, string message) =>
            System.Diagnostics.Debug.WriteLine($"[{level}] {message}");
    }
}
