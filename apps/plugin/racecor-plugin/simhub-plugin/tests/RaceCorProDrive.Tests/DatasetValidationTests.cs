using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class DatasetValidationTests
    {
        // Path to dataset relative to test project
        private static readonly string DatasetPath =
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "dataset");

        private List<CommentaryTopic> _topics;
        private CommentaryFragmentsFile _fragments;
        private SentimentsFile _sentiments;

        [SetUp]
        public void Setup()
        {
            _topics = LoadTopicsFromFile();
            _fragments = LoadFragmentsFromFile();
            _sentiments = LoadSentimentsFromFile();
        }

        #region File Loading Helpers

        private List<CommentaryTopic> LoadTopicsFromFile()
        {
            string path = Path.Combine(DatasetPath, "commentary_topics.json");
            if (!File.Exists(path))
            {
                Assert.Inconclusive($"Topics file not found at {path}");
                return new List<CommentaryTopic>();
            }

            try
            {
                string json = File.ReadAllText(path);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                dynamic? obj = JsonConvert.DeserializeObject(json, settings);
                List<CommentaryTopic>? topics = obj != null
                    ? JsonConvert.DeserializeObject<List<CommentaryTopic>>(
                        JsonConvert.SerializeObject(obj["topics"], settings),
                        settings
                      )
                    : null;
                return topics ?? new List<CommentaryTopic>();
            }
            catch (Exception ex)
            {
                Assert.Inconclusive($"Failed to load topics: {ex.Message}");
                return new List<CommentaryTopic>();
            }
        }

        private CommentaryFragmentsFile LoadFragmentsFromFile()
        {
            string path = Path.Combine(DatasetPath, "commentary_fragments.json");
            if (!File.Exists(path))
            {
                Assert.Inconclusive($"Fragments file not found at {path}");
                return new CommentaryFragmentsFile();
            }

            try
            {
                string json = File.ReadAllText(path);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                return JsonConvert.DeserializeObject<CommentaryFragmentsFile>(json, settings)
                    ?? new CommentaryFragmentsFile();
            }
            catch (Exception ex)
            {
                Assert.Inconclusive($"Failed to load fragments: {ex.Message}");
                return new CommentaryFragmentsFile();
            }
        }

        private SentimentsFile LoadSentimentsFromFile()
        {
            string path = Path.Combine(DatasetPath, "sentiments.json");
            if (!File.Exists(path))
            {
                Assert.Inconclusive($"Sentiments file not found at {path}");
                return new SentimentsFile();
            }

            try
            {
                string json = File.ReadAllText(path);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                return JsonConvert.DeserializeObject<SentimentsFile>(json, settings)
                    ?? new SentimentsFile();
            }
            catch (Exception ex)
            {
                Assert.Inconclusive($"Failed to load sentiments: {ex.Message}");
                return new SentimentsFile();
            }
        }

        #endregion

        #region Commentary Topics Validation

        [Test]
        public void CommentaryTopics_AllTopicsHaveRequiredFields()
        {
            Assert.IsNotEmpty(_topics, "Topics list should not be empty");

            foreach (var topic in _topics)
            {
                Assert.IsNotNull(topic.Id, "Topic should have an Id");
                Assert.IsNotEmpty(topic.Id, "Topic Id should not be empty");
                Assert.IsNotNull(topic.Category, "Topic should have a Category");
                Assert.IsNotEmpty(topic.Category, "Topic Category should not be empty");
                Assert.IsNotNull(topic.Title, "Topic should have a Title");
                Assert.IsNotEmpty(topic.Title, "Topic Title should not be empty");
            }
        }

        [Test]
        public void CommentaryTopics_AllCategoriesAreValid()
        {
            var validCategories = new[] { "hardware", "game_feel", "car_response", "racing_experience" };

            foreach (var topic in _topics)
            {
                Assert.Contains(topic.Category, validCategories,
                    $"Topic '{topic.Id}' has invalid category '{topic.Category}'");
            }
        }

        [Test]
        public void CommentaryTopics_AllSeveritiesAreInRange()
        {
            foreach (var topic in _topics)
            {
                Assert.GreaterOrEqual(topic.Severity, 1, $"Topic '{topic.Id}' severity too low");
                Assert.LessOrEqual(topic.Severity, 5, $"Topic '{topic.Id}' severity too high");
            }
        }

        [Test]
        public void CommentaryTopics_AllTopicsHaveAtLeastOneTrigger()
        {
            foreach (var topic in _topics)
            {
                Assert.IsNotNull(topic.Triggers, $"Topic '{topic.Id}' triggers should not be null");
                Assert.IsNotEmpty(topic.Triggers, $"Topic '{topic.Id}' should have at least one trigger");
            }
        }

        [Test]
        public void CommentaryTopics_AllTriggersHaveValidConditions()
        {
            var validConditions = new[]
            {
                ">", "<", "==", "change", "spike", "sudden_drop", "extreme",
                "rapid_change", "personal_best", "player_gain_position", "player_lost_position",
                "player_entering", "off_track", "yellow_flag", "black_flag", "race_start",
                "increase", "close_proximity"
            };

            foreach (var topic in _topics)
            {
                foreach (var trigger in topic.Triggers)
                {
                    Assert.IsNotNull(trigger.Condition, $"Trigger in topic '{topic.Id}' should have a condition");
                    Assert.Contains(trigger.Condition.ToLower(), validConditions.ToList(),
                        $"Topic '{topic.Id}' has invalid condition '{trigger.Condition}'");
                }
            }
        }

        [Test]
        public void CommentaryTopics_TyreWearUsesLessThanOperator()
        {
            var tyreWearTopics = _topics.Where(t =>
                t.Triggers?.Any(tr =>
                    tr.DataPoint?.ToLower().Contains("tyrewear") == true) == true).ToList();

            foreach (var topic in tyreWearTopics)
            {
                var tyreTriggers = topic.Triggers.Where(tr =>
                    tr.DataPoint?.ToLower().Contains("tyrewear") == true);

                foreach (var trigger in tyreTriggers)
                {
                    Assert.AreEqual("<", trigger.Condition,
                        $"Topic '{topic.Id}' tyre wear trigger should use '<' not '>'");
                }
            }
        }

        [Test]
        public void CommentaryTopics_HotTyreThresholdIsReasonable()
        {
            var heatTopics = _topics.Where(t =>
                t.Triggers?.Any(tr =>
                    tr.DataPoint?.ToLower().Contains("tyretemp") == true) == true).ToList();

            foreach (var topic in heatTopics)
            {
                var tempTriggers = topic.Triggers.Where(tr =>
                    tr.DataPoint?.ToLower().Contains("tyretemp") == true);

                foreach (var trigger in tempTriggers)
                {
                    if (trigger.Value.HasValue)
                    {
                        // Temp is in Fahrenheit, threshold should be >= 200°F
                        Assert.GreaterOrEqual(trigger.Value.Value, 200.0,
                            $"Topic '{topic.Id}' tyre temp threshold seems too low (should be in Fahrenheit)");
                    }
                }
            }
        }

        #endregion

        #region Commentary Fragments Validation

        [Test]
        public void CommentaryFragments_AllTopicsHaveFragments()
        {
            Assert.IsNotEmpty(_fragments.Fragments, "Fragments list should not be empty");

            var fragmentTopicIds = _fragments.Fragments.Select(f => f.TopicId).ToHashSet();
            var topicIds = _topics.Select(t => t.Id).ToHashSet();

            foreach (var topicId in topicIds)
            {
                Assert.Contains(topicId, fragmentTopicIds.ToList(),
                    $"Topic '{topicId}' from topics.json not found in fragments.json");
            }
        }

        [Test]
        public void CommentaryFragments_NoFragmentArraysAreEmpty()
        {
            foreach (var topicFragments in _fragments.Fragments)
            {
                var fragmentSet = topicFragments.Fragments;

                Assert.IsNotNull(fragmentSet.Openers, $"Topic '{topicFragments.TopicId}' openers should not be null");
                Assert.IsNotEmpty(fragmentSet.Openers, $"Topic '{topicFragments.TopicId}' should have at least one opener");

                if (fragmentSet.Bodies != null && fragmentSet.Bodies.Count > 0)
                {
                    Assert.IsFalse(fragmentSet.Bodies.All(string.IsNullOrEmpty),
                        $"Topic '{topicFragments.TopicId}' should not have all empty bodies");
                }

                if (fragmentSet.Closers != null && fragmentSet.Closers.Count > 0)
                {
                    Assert.IsFalse(fragmentSet.Closers.All(string.IsNullOrEmpty),
                        $"Topic '{topicFragments.TopicId}' should not have all empty closers");
                }
            }
        }

        #endregion

        #region Sentiments Validation

        [Test]
        public void Sentiments_AllEntriesHaveRequiredFields()
        {
            Assert.IsNotEmpty(_sentiments.Sentiments, "Sentiments list should not be empty");

            foreach (var sentiment in _sentiments.Sentiments)
            {
                Assert.IsNotNull(sentiment.Id, "Sentiment should have an Id");
                Assert.IsNotEmpty(sentiment.Id, "Sentiment Id should not be empty");
            }
        }

        [Test]
        public void Sentiments_AllColorsAreValidHex()
        {
            foreach (var sentiment in _sentiments.Sentiments)
            {
                if (!string.IsNullOrEmpty(sentiment.Color))
                {
                    string color = sentiment.Color.TrimStart('#');
                    Assert.IsTrue(color.Length == 6,
                        $"Sentiment '{sentiment.Id}' color '{sentiment.Color}' should be 6-digit hex");
                    Assert.IsTrue(System.Text.RegularExpressions.Regex.IsMatch(color, "^[0-9A-Fa-f]{6}$"),
                        $"Sentiment '{sentiment.Id}' color '{sentiment.Color}' is not valid hex");
                }
            }
        }

        #endregion

        #region Cross-Validation

        [Test]
        public void CrossValidation_NoTopicIdDuplicates()
        {
            var ids = _topics.Select(t => t.Id).ToList();
            var duplicates = ids.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

            Assert.IsEmpty(duplicates, $"Found duplicate topic IDs: {string.Join(", ", duplicates)}");
        }

        [Test]
        public void CrossValidation_NoFragmentTopicIdDuplicates()
        {
            var ids = _fragments.Fragments.Select(f => f.TopicId).ToList();
            var duplicates = ids.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

            Assert.IsEmpty(duplicates, $"Found duplicate fragment topic IDs: {string.Join(", ", duplicates)}");
        }

        [Test]
        public void CrossValidation_NoSentimentIdDuplicates()
        {
            var ids = _sentiments.Sentiments.Select(s => s.Id).ToList();
            var duplicates = ids.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

            Assert.IsEmpty(duplicates, $"Found duplicate sentiment IDs: {string.Join(", ", duplicates)}");
        }

        #endregion
    }
}
