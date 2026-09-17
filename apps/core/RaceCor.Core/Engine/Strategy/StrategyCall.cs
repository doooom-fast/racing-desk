namespace RaceCorProDrive.Plugin.Engine.Strategy
{
    /// <summary>
    /// A single strategic recommendation produced by a strategy module.
    /// The StrategyCoordinator picks the highest-priority call to surface.
    /// </summary>
    public class StrategyCall
    {
        /// <summary>Which module produced this call (tire, fuel, pit, etc.).</summary>
        public string Module { get; set; } = "";

        /// <summary>Severity 1-5 matching commentary engine scale.</summary>
        public int Severity { get; set; } = 1;

        /// <summary>Short label for dashboard display (e.g. "FUEL", "TYRES").</summary>
        public string Label { get; set; } = "";

        /// <summary>Human-readable strategy message for the driver.</summary>
        public string Message { get; set; } = "";

        /// <summary>Minimum seconds before this module can produce another call.</summary>
        public double CooldownSeconds { get; set; } = 30;
    }
}
