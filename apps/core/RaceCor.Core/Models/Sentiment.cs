using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Models
{
    public class SentimentsFile
    {
        public List<SentimentEntry> Sentiments { get; set; } = new List<SentimentEntry>();
    }

    public class SentimentEntry
    {
        public string Id     { get; set; }
        public string Label  { get; set; }
        public string Color  { get; set; }
        public List<string> Phrases { get; set; } = new List<string>();
    }
}
