using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class FragmentAssemblerTests
    {
        private FragmentAssembler _assembler;
        private TelemetrySnapshot _context;

        [SetUp]
        public void Setup()
        {
            _assembler = new FragmentAssembler();
            _context = new TelemetrySnapshot
            {
                NearestAheadName = "Sarah K.",
                NearestAheadRating = 2847,
                NearestBehindName = "James W.",
                NearestBehindRating = 2100
            };
        }

        #region Basic Assembly

        [Test]
        public void Assemble_WithValidFragments_ReturnsNonNull()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test_topic"",
      ""fragments"": {
        ""openers"": [""The car""],
        ""bodies"": [""is working well""],
        ""closers"": [""today.""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test_topic", _context);
            Assert.IsNotNull(result);
            StringAssert.Contains("The car", result);
            StringAssert.Contains("is working well", result);
            StringAssert.Contains("today", result);
        }

        [Test]
        public void Assemble_WithUnknownTopic_ReturnsNull()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""known_topic"",
      ""fragments"": {
        ""openers"": [""Opener""],
        ""bodies"": [""Body""],
        ""closers"": [""Closer""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("unknown_topic", _context);
            Assert.IsNull(result);
        }

        [Test]
        public void Assemble_WithEmptyOpeners_ReturnsNull()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test_topic"",
      ""fragments"": {
        ""openers"": [],
        ""bodies"": [""Body""],
        ""closers"": [""Closer""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test_topic", _context);
            Assert.IsNull(result);
        }

        #endregion

        #region Fragment Selection and Spacing

        [Test]
        public void Assemble_WithAllFragmentTypes_JoinsProperly()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""Opener""],
        ""bodies"": [""middle part""],
        ""closers"": [""end.""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            Assert.AreEqual("Opener middle part end.", result);
        }

        [Test]
        public void Assemble_WithEmptyBodies_StillAssembles()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""Opener""],
        ""bodies"": [],
        ""closers"": [""end.""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            Assert.IsNotNull(result);
            StringAssert.Contains("Opener", result);
            StringAssert.Contains("end", result);
        }

        [Test]
        public void Assemble_WithEmptyClosers_StillAssembles()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""Opener""],
        ""bodies"": [""middle""],
        ""closers"": []
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            Assert.IsNotNull(result);
            StringAssert.Contains("Opener", result);
            StringAssert.Contains("middle", result);
        }

        #endregion

        #region Placeholder Substitution

        [Test]
        public void Assemble_WithAheadPlaceholder_SubstitutesDriverName()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""{ahead} got through""],
        ""bodies"": [""""],
        ""closers"": [""""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            StringAssert.Contains("Sarah K.", result);
            StringAssert.Contains("2,847 iR", result);
        }

        [Test]
        public void Assemble_WithBehindPlaceholder_SubstitutesDriverName()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""{behind} is closer""],
        ""bodies"": [""""],
        ""closers"": [""""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            StringAssert.Contains("James W.", result);
            StringAssert.Contains("2,100 iR", result);
        }

        [Test]
        public void Assemble_WithAheadPlaceholder_NoNameUsesDefault()
        {
            _context.NearestAheadName = "";
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""{ahead} is gone""],
        ""bodies"": [""""],
        ""closers"": [""""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            StringAssert.Contains("the car", result);
        }

        [Test]
        public void Assemble_WithNameButNoRating_DoesNotIncludeRating()
        {
            _context.NearestAheadRating = 0;
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""{ahead} is fast""],
        ""bodies"": [""""],
        ""closers"": [""""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", _context);
            StringAssert.Contains("Sarah K.", result);
            Assert.IsFalse(result.Contains("iR"), "Should not include iR rating when rating is 0");
        }

        #endregion

        #region Repetition Avoidance

        [Test]
        public void Assemble_RepeatedCalls_AvoidsDuplicateFragments()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""A"", ""B"", ""C"", ""D""],
        ""bodies"": [""1""],
        ""closers"": [""X""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);

            // First 4 calls should use different openers
            string result1 = _assembler.Assemble("test", _context);
            string result2 = _assembler.Assemble("test", _context);
            string result3 = _assembler.Assemble("test", _context);
            string result4 = _assembler.Assemble("test", _context);

            // All should be non-null
            Assert.IsNotNull(result1);
            Assert.IsNotNull(result2);
            Assert.IsNotNull(result3);
            Assert.IsNotNull(result4);

            // Collect the openers used
            var openers = new[] { result1.Split()[0], result2.Split()[0], result3.Split()[0], result4.Split()[0] };

            // With ring buffer size 3, first 3 should be different, 4th may repeat
            Assert.AreNotEqual(openers[0], openers[1], "First two calls should use different openers");
            Assert.AreNotEqual(openers[1], openers[2], "2nd and 3rd should use different openers");
        }

        [Test]
        public void Assemble_WithOnlyOneOpener_StillWorks()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""Only""],
        ""bodies"": [""B""],
        ""closers"": [""C""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);

            // Multiple calls should still work
            string result1 = _assembler.Assemble("test", _context);
            string result2 = _assembler.Assemble("test", _context);

            Assert.IsNotNull(result1);
            Assert.IsNotNull(result2);
            StringAssert.Contains("Only", result1);
            StringAssert.Contains("Only", result2);
        }

        #endregion

        #region Edge Cases

        [Test]
        public void Assemble_WithNullContext_StillAssembles()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""test"",
      ""fragments"": {
        ""openers"": [""Opener""],
        ""bodies"": [""Body""],
        ""closers"": [""Closer""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);
            string result = _assembler.Assemble("test", null!);
            Assert.IsNotNull(result);
        }

        [Test]
        public void LoadFragmentsFromJson_WithEmptyJson_DoesNotThrow()
        {
            Assert.DoesNotThrow(() => _assembler.LoadFragmentsFromJson(""));
        }

        [Test]
        public void LoadFragmentsFromJson_WithInvalidJson_DoesNotThrow()
        {
            Assert.DoesNotThrow(() => _assembler.LoadFragmentsFromJson("{invalid json"));
        }

        [Test]
        public void Assemble_WithNullTopicId_ReturnsNull()
        {
            string result = _assembler.Assemble(null, _context);
            Assert.IsNull(result);
        }

        [Test]
        public void Assemble_WithEmptyTopicId_ReturnsNull()
        {
            string result = _assembler.Assemble("", _context);
            Assert.IsNull(result);
        }

        #endregion

        #region Multiple Topics

        [Test]
        public void LoadFragmentsFromJson_WithMultipleTopics_LoadsAll()
        {
            string json = @"{
  ""fragments"": [
    {
      ""topicId"": ""topic_a"",
      ""fragments"": {
        ""openers"": [""A""],
        ""bodies"": [""body""],
        ""closers"": [""close""]
      }
    },
    {
      ""topicId"": ""topic_b"",
      ""fragments"": {
        ""openers"": [""B""],
        ""bodies"": [""body""],
        ""closers"": [""close""]
      }
    }
  ]
}";
            _assembler.LoadFragmentsFromJson(json);

            string resultA = _assembler.Assemble("topic_a", _context);
            string resultB = _assembler.Assemble("topic_b", _context);

            Assert.IsNotNull(resultA);
            Assert.IsNotNull(resultB);
            StringAssert.Contains("A", resultA);
            StringAssert.Contains("B", resultB);
        }

        #endregion
    }
}
