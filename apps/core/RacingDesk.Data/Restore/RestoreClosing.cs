using System;
using System.Collections.Generic;
using System.Linq;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// Where the first run's closing step stands: C1, "Your own profile and force again". Every F24 that went may have left the
    /// pedals on a Racing Desk profile — the firmware may keep the profile id it was sent, or what was in it — and nothing on the
    /// PC records which profile the pedals hold. So the first run ends with him looking, and putting his own back, with his own
    /// hands: Racing Desk says what is owed and checks what it can, and presses and writes nothing in it.
    /// </summary>
    public sealed class ClosingState
    {
        /// <summary>F24 has gone since he last confirmed C1 (or he never has): his own profile and force are owed.</summary>
        public bool Owed { get; set; }

        /// <summary>The newest F24 that went, and when he last confirmed C1.</summary>
        public DateTime? PressedAtUtc { get; set; }
        public DateTime? DoneAtUtc { get; set; }

        /// <summary>What SmartControl showed after the pedals were unplugged, by his newest answer: "own", "id" or "values"; null before one.</summary>
        public string Eeprom { get; set; }
        public DateTime? EepromAtUtc { get; set; }

        /// <summary>The answer was given after the newest F24: it is about what that press left, and can be built on.</summary>
        public bool EepromFresh { get; set; }

        /// <summary>Why the brakes part has failed, in words, from his answer; null while it has not.</summary>
        public string Failed { get; set; }
    }

    /// <summary>
    /// C1's records and words. Its three answers and its confirmation are first-run buttons like any other, kept in
    /// <c>restore_checks</c> with what each saw; what is owed is worked out from the last F24 that went (the switch row's
    /// <c>sent_at</c>) and the last time he confirmed C1.
    /// </summary>
    public static class RestoreClosing
    {
        public const string Confirm = "C1", Own = "C1-own", Id = "C1-id", Values = "C1-values";

        /// <summary>The buttons that answer the check of the pedals' memory; the answer is the newest.</summary>
        public static readonly IReadOnlyList<string> Answers = new[] { Own, Id, Values };

        public static bool IsClosingAction(string action) =>
            string.Equals(action, Confirm, StringComparison.OrdinalIgnoreCase) || Answers.Any(a => string.Equals(a, action, StringComparison.OrdinalIgnoreCase));

        public const string OwedWords = "C1 is owed: Racing Desk has pressed F24, so the pedals may still be on one of its profiles. Do C1, \"Your own profile and force again\", before you drive.";

        public const string UndoRefusal = "C1 is owed: the pedals may be on one of these profiles, and removing it would leave them on a profile SmartControl does not have. Do C1, \"Your own profile and force again\", first.";

        /// <summary>What the answer means for the brakes part when it is not "own"; null for "own" and for no answer.</summary>
        public static string FailedWords(string answer) =>
            answer == "id"
                ? "The brakes part has failed: after the pedals were unplugged SmartControl showed Racing Desk's profile with your old values, so the pedals keep the profile id they are sent. Racing Desk cannot switch the brakes this way."
            : answer == "values"
                ? "The brakes part has failed: after the pedals were unplugged SmartControl showed Racing Desk's values, so the pedals saved what F24 sent. Racing Desk cannot switch the brakes this way."
            : null;

        public static string AnswerOf(string action) =>
            string.Equals(action, Own, StringComparison.OrdinalIgnoreCase) ? "own"
            : string.Equals(action, Id, StringComparison.OrdinalIgnoreCase) ? "id"
            : string.Equals(action, Values, StringComparison.OrdinalIgnoreCase) ? "values"
            : null;

        /// <summary>His newest answer to the check of the pedals' memory, from the checks: "own", "id" or "values", and when; null before one.</summary>
        public static (string Answer, DateTime At)? NewestAnswer(IEnumerable<RestoreCheck> checks)
        {
            (string Answer, DateTime At)? newest = null;
            foreach (var c in checks ?? Enumerable.Empty<RestoreCheck>())
            {
                string answer = c?.Step == null ? null : AnswerOf(c.Step);
                if (answer == null || !c.RanAtUtc.HasValue) continue;
                if (newest == null || c.RanAtUtc.Value > newest.Value.At) newest = (answer, c.RanAtUtc.Value);
            }
            return newest;
        }

        public static ClosingState Of(RacingDeskStore store) => Of(store.SmartControlSwitchRow(), store.RestoreChecks());

        public static ClosingState Of(SmartControlSwitch sw, IEnumerable<RestoreCheck> checks)
        {
            var list = (checks ?? Enumerable.Empty<RestoreCheck>()).Where(c => c != null && c.Step != null).ToList();
            var confirm = list.FirstOrDefault(c => string.Equals(c.Step, Confirm, StringComparison.OrdinalIgnoreCase));
            DateTime? pressed = sw?.SentAtUtc;
            DateTime? done = confirm != null && confirm.RanOk == true ? confirm.RanAtUtc : null;
            var answer = NewestAnswer(list);
            var state = new ClosingState
            {
                PressedAtUtc = pressed,
                DoneAtUtc = done,
                Eeprom = answer?.Answer,
                EepromAtUtc = answer?.At,
                Failed = FailedWords(answer?.Answer),
            };
            // Owed from the first F24 that went until he says his own are back, after the last one.
            state.Owed = pressed.HasValue && !(done.HasValue && done.Value > pressed.Value);
            state.EepromFresh = answer.HasValue && (!pressed.HasValue || answer.Value.At > pressed.Value);
            return state;
        }
    }
}
