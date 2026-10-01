using NUnit.Framework;
using RacingDesk.Core.Names;

namespace RacingDesk.Tests
{
    /// <summary>
    /// The book of names every test runs with: the embedded list and a salt of the tests' own, the same every run (chosen so
    /// that the synthetic field's six rivals do not collide: Names/SyntheticField), so that no test reads or writes the salt
    /// at %LOCALAPPDATA%\Racing Desk, and a test that renames a session gets the same names each time.
    /// </summary>
    [SetUpFixture]
    public class TestNames
    {
        public static PseudonymBook Book { get; private set; } = null!;

        [OneTimeSetUp]
        public void GiveTheTestsTheirOwnBook()
        {
            Book = new PseudonymBook(PseudonymList.Default, Names.SyntheticField.CollisionFreeSalt(PseudonymList.Default));
            PseudonymBook.Default = Book;
        }
    }
}
