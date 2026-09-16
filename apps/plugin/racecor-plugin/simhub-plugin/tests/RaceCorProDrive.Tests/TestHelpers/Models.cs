using System.Collections.Generic;

namespace RaceCorProDrive.Tests.TestHelpers
{
    public class TriggerCondition
    {
        public string DataPoint { get; set; }
        public string Condition { get; set; }
        public double? Value { get; set; }
        public double? AbsValue { get; set; }
        public double? ThresholdDelta { get; set; }
        public double? ProximityThreshold { get; set; }
        public string Context { get; set; }
    }

    public class FragmentSet
    {
        public List<string> Openers { get; set; } = new List<string>();
        public List<string> Bodies { get; set; } = new List<string>();
        public List<string> Closers { get; set; } = new List<string>();
    }

    public class TopicFragments
    {
        public string TopicId { get; set; }
        public FragmentSet Fragments { get; set; }
    }

    public class CommentaryFragmentsFile
    {
        public List<TopicFragments> Fragments { get; set; } = new List<TopicFragments>();
    }

    public class CommentaryTopic
    {
        public string Id { get; set; }
        public string Category { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public string Sentiment { get; set; }
        public int Severity { get; set; } = 2;
        public string EventExposition { get; set; }
        public List<string> SessionTypes { get; set; } = new List<string>();
        public List<TriggerCondition> Triggers { get; set; } = new List<TriggerCondition>();
        public List<string> CommentaryPrompts { get; set; } = new List<string>();
        public double CooldownMinutes { get; set; } = 2.0;
    }

    public class SentimentEntry
    {
        public string Id { get; set; }
        public string Label { get; set; }
        public string Color { get; set; }
        public List<string> Phrases { get; set; } = new List<string>();
    }

    public class SentimentsFile
    {
        public List<SentimentEntry> Sentiments { get; set; } = new List<SentimentEntry>();
    }
}
