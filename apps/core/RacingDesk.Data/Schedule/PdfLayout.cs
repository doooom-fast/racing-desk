using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.DocumentLayoutAnalysis.WordExtractor;

namespace RacingDesk.Data.Schedule
{
    /// <summary>
    /// Reads a PDF back as fixed-pitch text lines, the way <c>pdftotext -layout</c> does: every word keeps its
    /// horizontal position, so a schedule's columns still line up. The schedule parser reads these lines.
    /// </summary>
    public static class PdfLayout
    {
        /// <summary>Marks a page boundary in the returned lines.</summary>
        public const string PageBreak = "\f";

        public static List<string> Lines(string pdfPath)
        {
            using var doc = PdfDocument.Open(pdfPath);
            var lines = new List<string>();
            foreach (var page in doc.GetPages())
            {
                if (lines.Count > 0) lines.Add(PageBreak);
                lines.AddRange(PageLines(page));
            }
            return lines;
        }

        /// <summary>One page's words laid out on a character grid, top line first.</summary>
        public static List<string> PageLines(Page page)
        {
            var words = page.GetWords(NearestNeighbourWordExtractor.Instance)
                .Where(w => !string.IsNullOrWhiteSpace(w.Text))
                .ToList();
            var result = new List<string>();
            if (words.Count == 0) return result;

            double rowTolerance = Math.Max(0.5, Median(words.Select(w => w.BoundingBox.Height)) * 0.5);
            var rows = Rows(words, rowTolerance);

            // The grid's cell width, from how densely the page's own lines are set: a line's width divided by the
            // characters in it. The font is proportional, so this is an average — taken as the median over lines
            // long enough to be representative, it puts columns within a character or so of the original.
            double charWidth = Median(rows.Select(Density).Where(d => d > 0));
            if (charWidth <= 0) charWidth = Median(words.Select(w => w.BoundingBox.Width / Math.Max(1, w.Text.Length)));
            if (charWidth <= 0) charWidth = 1;

            double leftEdge = words.Min(w => w.BoundingBox.Left);
            double lineHeight = Median(words.Select(w => w.BoundingBox.Height)) * 1.6;
            double previousBaseline = double.NaN;
            var sb = new StringBuilder();
            foreach (var row in rows)
            {
                // Blank lines separate a series' header block from its week rows, so keep the vertical gaps.
                double baseline = row.Min(w => w.BoundingBox.Bottom);
                if (!double.IsNaN(previousBaseline) && lineHeight > 0)
                {
                    int blanks = (int)Math.Round((previousBaseline - baseline) / lineHeight) - 1;
                    for (int i = 0; i < Math.Min(blanks, 4); i++) result.Add("");
                }
                previousBaseline = baseline;
                sb.Clear();
                foreach (var word in row)
                {
                    int column = (int)Math.Round((word.BoundingBox.Left - leftEdge) / charWidth);
                    if (column > sb.Length) sb.Append(' ', column - sb.Length);
                    else if (sb.Length > 0) sb.Append(' ');
                    sb.Append(word.Text);
                }
                result.Add(sb.ToString().TrimEnd());
            }
            return result;
        }

        /// <summary>Characters per unit width on one line, or 0 for a line too short to be representative.</summary>
        private static double Density(List<Word> row)
        {
            int chars = row.Sum(w => w.Text.Length) + Math.Max(0, row.Count - 1);
            if (chars < 20) return 0;
            double width = row.Max(w => w.BoundingBox.Right) - row.Min(w => w.BoundingBox.Left);
            return width > 0 ? width / chars : 0;
        }

        /// <summary>Words grouped into lines by baseline, top of the page first (PdfPig's Y grows upwards).</summary>
        private static List<List<Word>> Rows(List<Word> words, double rowTolerance)
        {
            var rows = new List<List<Word>>();
            var baselines = new List<double>();
            foreach (var word in words.OrderByDescending(w => w.BoundingBox.Bottom).ThenBy(w => w.BoundingBox.Left))
            {
                int row = -1;
                for (int i = 0; i < baselines.Count; i++)
                {
                    if (Math.Abs(baselines[i] - word.BoundingBox.Bottom) > rowTolerance) continue;
                    row = i;
                    break;
                }
                if (row < 0)
                {
                    baselines.Add(word.BoundingBox.Bottom);
                    rows.Add(new List<Word>());
                    row = rows.Count - 1;
                }
                rows[row].Add(word);
            }
            foreach (var row in rows) row.Sort((a, b) => a.BoundingBox.Left.CompareTo(b.BoundingBox.Left));
            return rows;
        }

        private static double Median(IEnumerable<double> values)
        {
            var sorted = values.Where(v => v > 0).OrderBy(v => v).ToList();
            if (sorted.Count == 0) return 0;
            return sorted.Count % 2 == 1
                ? sorted[sorted.Count / 2]
                : (sorted[sorted.Count / 2 - 1] + sorted[sorted.Count / 2]) / 2;
        }

        /// <summary>Normalises a PDF string for matching: trims, collapses runs of spaces, unifies dashes.</summary>
        public static string Tidy(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var sb = new StringBuilder(text.Length);
            bool space = false;
            foreach (char c in text.Normalize(NormalizationForm.FormC))
            {
                char ch = c == '–' || c == '—' || c == '−' ? '-' : c;
                if (char.IsWhiteSpace(ch))
                {
                    space = true;
                    continue;
                }
                if (space && sb.Length > 0) sb.Append(' ');
                space = false;
                sb.Append(ch);
            }
            return sb.ToString();
        }

        internal static bool TryDate(string text, out DateTime date) =>
            DateTime.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out date);
    }
}
