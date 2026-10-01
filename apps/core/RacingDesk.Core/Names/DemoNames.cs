namespace RacingDesk.Core.Names
{
    /// <summary>
    /// The names the demo's made-up rivals go by: characters from the list, like everyone else's (the demo used to show the
    /// names of real racing drivers, which the HUD now shows for nobody). <c>PseudonymListTests</c> holds them to the list.
    /// </summary>
    public static class DemoNames
    {
        /// <summary>The car ahead in the demo's gaps.</summary>
        public const string Ahead = "J. van Dyne";
        /// <summary>The car behind in the demo's gaps.</summary>
        public const string Behind = "T. Iommi";

        /// <summary>The demo leaderboard's other rows, top to bottom, around the two above and "YOU".</summary>
        public static readonly string[] Field =
        {
            "H. Incandenza", "D. Gately", "M. Pemulis",
            "M. Renton", "Sick Boy", "O. Osbourne", "R. Smith",
        };
    }
}
