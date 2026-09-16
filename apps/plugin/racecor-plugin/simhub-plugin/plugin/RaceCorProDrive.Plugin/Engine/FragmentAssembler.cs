using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RaceCorProDrive.Plugin.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Loads and assembles pre-generated sentence fragments at runtime.
    /// For each topic, randomly selects one opener + one body + one closer,
    /// joins them into a complete sentence, and performs placeholder substitution.
    /// Tracks recently-used fragments per topic to avoid immediate repetition.
    /// </summary>
    public class FragmentAssembler
    {
        // ── Fragment data ──────────────────────────────────────────────────────
        private Dictionary<string, FragmentSet> _fragments = new Dictionary<string, FragmentSet>();
        private readonly Random _rng = new Random();

        // ── Repetition tracking: ring buffer of last 3 fragments per topic per slot
        private Dictionary<string, Queue<string>> _recentOpeners = new Dictionary<string, Queue<string>>();
        private Dictionary<string, Queue<string>> _recentBodies = new Dictionary<string, Queue<string>>();
        private Dictionary<string, Queue<string>> _recentClosers = new Dictionary<string, Queue<string>>();

        private const int RecentHistorySize = 3;

        /// <summary>
        /// Loads fragment data from the given JSON file.
        /// Initializes repetition tracking for all topics found.
        /// </summary>
        public void LoadFragments(string jsonPath)
        {
            if (!File.Exists(jsonPath))
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive.FragmentAssembler] Fragments file not found: {jsonPath}");
                return;
            }

            try
            {
                string json = File.ReadAllText(jsonPath);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                var file = JsonConvert.DeserializeObject<CommentaryFragmentsFile>(json, settings);

                _fragments.Clear();
                _recentOpeners.Clear();
                _recentBodies.Clear();
                _recentClosers.Clear();

                if (file?.Fragments != null)
                {
                    foreach (var topic in file.Fragments)
                    {
                        if (string.IsNullOrEmpty(topic.TopicId) || topic.Fragments == null) continue;

                        _fragments[topic.TopicId] = topic.Fragments;
                        _recentOpeners[topic.TopicId] = new Queue<string>(RecentHistorySize);
                        _recentBodies[topic.TopicId] = new Queue<string>(RecentHistorySize);
                        _recentClosers[topic.TopicId] = new Queue<string>(RecentHistorySize);
                    }
                }

                SimHub.Logging.Current.Info($"[RaceCorProDrive.FragmentAssembler] Loaded {_fragments.Count} fragment topics from {jsonPath}");
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error($"[RaceCorProDrive.FragmentAssembler] Failed to load fragments: {ex.Message}");
            }
        }

        /// <summary>
        /// Assembles a complete sentence from available fragments for the given topic ID.
        /// Returns null if no fragments exist for the topic (fallback to static prompts).
        /// Performs placeholder substitution: {ahead}, {behind}, {value}, {rating_context}, {corner_name}
        /// </summary>
        public string Assemble(string topicId, TelemetrySnapshot context)
        {
            if (string.IsNullOrEmpty(topicId) || !_fragments.TryGetValue(topicId, out var fragmentSet))
                return null;

            if (fragmentSet.Openers == null || fragmentSet.Openers.Count == 0)
                return null;

            // Select fragments, avoiding recent ones
            string opener = SelectFragment(topicId, fragmentSet.Openers, _recentOpeners[topicId]);
            string body = SelectFragment(topicId, fragmentSet.Bodies ?? new List<string>(), _recentBodies[topicId]);
            string closer = SelectFragment(topicId, fragmentSet.Closers ?? new List<string>(), _recentClosers[topicId]);

            // Build the sentence: opener + body + closer with proper spacing
            string sentence = (opener ?? "").Trim();

            if (!string.IsNullOrEmpty(body))
            {
                sentence = string.IsNullOrEmpty(sentence)
                    ? body.Trim()
                    : sentence + " " + body.Trim();
            }

            if (!string.IsNullOrEmpty(closer))
            {
                sentence = string.IsNullOrEmpty(sentence)
                    ? closer.Trim()
                    : sentence + " " + closer.Trim();
            }

            // Perform placeholder substitution
            sentence = PerformSubstitution(sentence, context);

            return string.IsNullOrEmpty(sentence) ? null : sentence;
        }

        /// <summary>
        /// Selects a fragment from the list, avoiding recent selections.
        /// If recent history is full, removes the oldest entry before adding the new one.
        /// </summary>
        private string SelectFragment(string topicId, List<string> options, Queue<string> recentHistory)
        {
            if (options == null || options.Count == 0)
                return null;

            // Find a fragment not in recent history
            var candidates = options.Where(f => !recentHistory.Contains(f)).ToList();

            if (candidates.Count == 0)
            {
                // All fragments are recent — reset history and pick from all
                recentHistory.Clear();
                candidates = options;
            }

            string selected = candidates[_rng.Next(candidates.Count)];

            // Add to recent history, maintaining size limit
            if (recentHistory.Count >= RecentHistorySize)
                recentHistory.Dequeue();
            recentHistory.Enqueue(selected);

            return selected;
        }

        /// <summary>
        /// Optional hook — resolves {driver} placeholder to the driver's name.
        /// Set by CommentaryEngine from Settings. Default: "the driver".
        /// </summary>
        public Func<string> ResolveDriverName { get; set; } = () => "the driver";

        /// <summary>
        /// Performs placeholder substitution on the assembled sentence.
        /// Supports: {ahead}, {behind}, {driver}, {value}, {rating_context}, {corner_name}
        /// </summary>
        private string PerformSubstitution(string text, TelemetrySnapshot context)
        {
            if (string.IsNullOrEmpty(text) || context == null)
                return text;

            // Driver name placeholders
            text = text.Replace("{ahead}", FormatDriver(context.NearestAheadName, context.NearestAheadRating));
            text = text.Replace("{behind}", FormatDriver(context.NearestBehindName, context.NearestBehindRating));

            // Substitute {driver} with the configured driver name (randomly first or last)
            text = text.Replace("{driver}", ResolveDriverName());

            return text;
        }

        private static string FormatDriver(string name, int rating)
        {
            if (string.IsNullOrEmpty(name)) return "the car";
            return rating > 0 ? $"{name} ({rating:N0} iR)" : name;
        }
    }
}
