using System;
using IRSDKSharper;

namespace RacingDesk.Core.Names
{
    /// <summary>
    /// The host's live path: where the session model the SDK parsed enters the program and every other driver in it is
    /// renamed (<see cref="Pseudonymizer.Apply"/>), once for each session-info update, before anything reads it. The SDK
    /// parses the YAML on its own thread and may hand over a new object or the same one filled again, so both the object
    /// and the SDK's update count are watched, and several readers asking at once all get the model renamed: the first
    /// renames it while the others wait. <c>SdkRawTelemetry.SessionInfo</c> is this and the SDK's two properties.
    /// </summary>
    public sealed class SessionNaming
    {
        private readonly object _gate = new object();
        private readonly Func<PseudonymBook> _book;
        private Pseudonymizer _names;
        private IRacingSdkSessionInfo _named;
        private int _update = -1;

        /// <param name="book">The book to name from; the machine's (<see cref="PseudonymBook.Default"/>) when none is given.</param>
        public SessionNaming(Func<PseudonymBook> book = null)
        {
            _book = book ?? (() => PseudonymBook.Default);
        }

        /// <summary>
        /// The session model with every other driver renamed: <paramref name="info"/> itself, renamed in place the first
        /// time it is seen at this <paramref name="updateCount"/> and left alone after. Null stays null.
        /// </summary>
        public IRacingSdkSessionInfo Named(IRacingSdkSessionInfo info, int updateCount)
        {
            if (info == null) return null;
            lock (_gate)
            {
                if (ReferenceEquals(info, _named) && updateCount == _update) return info;
                (_names ?? (_names = _book().NewSession())).Apply(info);
                _named = info;
                _update = updateCount;
                return info;
            }
        }
    }
}
