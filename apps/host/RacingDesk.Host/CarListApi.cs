using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using RacingDesk.Core.Cars;
using RacingDesk.Data;

namespace RacingDesk.Host
{
    /// <summary>
    /// The canonical list of cars as the host carries it, for <c>GET /racing-desk/data/controls</c>: every car, or
    /// one (<c>?car=porsche963gtp</c>), with what the check has said of each this run (<c>remarks</c>, as the log
    /// has them) and what the store has kept of it against this list (<c>kept</c>: each thing said, with when it
    /// was first and last said, from this run and those before it). The list is from the assembly; the store is
    /// only read, and is not needed for the list. Read-only.
    ///
    /// <c>listHash</c> names the list served (<see cref="CarList.Hash"/>). <c>kept</c> holds what was said against
    /// it and nothing said against a list since changed; it is null when the store could not be read, which is not
    /// the same as nothing kept.
    /// </summary>
    internal static class CarListApi
    {
        /// <param name="carPath">The sim's folder for one car; null or empty for the whole list.</param>
        /// <param name="remarks">What the check has said this run, by the car's folder; null for none.</param>
        /// <param name="kept">What the store has kept against this list; null when it could not be read.</param>
        public static void Write(Utf8JsonWriter json, CarList list, string carPath,
            IReadOnlyDictionary<string, IReadOnlyList<string>> remarks, string following, IReadOnlyList<CarListRemark> kept)
        {
            list ??= CarList.Empty;
            json.WriteStartObject();
            json.WriteNumber("version", list.Version);
            json.WriteString("listHash", list.Hash);
            json.WriteNumber("count", list.Cars.Count);
            // The car the driver is in, as the sim names its folder; null while he is in none.
            json.WriteString("following", following);

            if (!string.IsNullOrWhiteSpace(carPath))
            {
                var car = list.Find(carPath);
                json.WritePropertyName("car");
                if (car == null) json.WriteNullValue();
                else WriteCar(json, car);
                json.WritePropertyName("remarks");
                WriteRemarks(json, remarks != null && remarks.TryGetValue(carPath.Trim(), out var said) ? said : null);
                json.WritePropertyName("kept");
                if (kept == null) json.WriteNullValue();
                else
                {
                    string wanted = CarList.Fold(carPath);
                    json.WriteStartArray();
                    foreach (var remark in kept)
                        if (CarList.Fold(remark.CarPath) == wanted) WriteKept(json, remark);
                    json.WriteEndArray();
                }
                json.WriteEndObject();
                return;
            }

            json.WritePropertyName("problems");
            WriteRemarks(json, list.Problems);
            json.WritePropertyName("remarks");
            json.WriteStartObject();
            if (remarks != null)
                foreach (var car in remarks)
                {
                    if (car.Value == null || car.Value.Count == 0) continue;
                    json.WritePropertyName(car.Key);
                    WriteRemarks(json, car.Value);
                }
            json.WriteEndObject();
            json.WritePropertyName("kept");
            WriteKeptByCar(json, kept);
            json.WritePropertyName("cars");
            json.WriteStartArray();
            foreach (var car in list.Cars) WriteCar(json, car);
            json.WriteEndArray();
            json.WriteEndObject();
        }

        // { "<car>": [ … ] }, each car under the way it was first spelled; null for a store that could not be read.
        private static void WriteKeptByCar(Utf8JsonWriter json, IReadOnlyList<CarListRemark> kept)
        {
            if (kept == null)
            {
                json.WriteNullValue();
                return;
            }
            var byCar = new Dictionary<string, List<CarListRemark>>();
            var order = new List<string>();
            foreach (var remark in kept)
            {
                string key = CarList.Fold(remark.CarPath);
                if (!byCar.TryGetValue(key, out var these))
                {
                    byCar[key] = these = new List<CarListRemark>();
                    order.Add(key);
                }
                these.Add(remark);
            }
            json.WriteStartObject();
            foreach (string key in order)
            {
                var these = byCar[key];
                json.WritePropertyName(these[0].CarPath);
                json.WriteStartArray();
                foreach (var remark in these) WriteKept(json, remark);
                json.WriteEndArray();
            }
            json.WriteEndObject();
        }

        private static void WriteKept(Utf8JsonWriter json, CarListRemark remark)
        {
            json.WriteStartObject();
            json.WriteString("about", remark.About);
            json.WriteString("text", remark.Text);
            json.WriteString("firstSeen", Iso(remark.FirstSeenUtc));
            json.WriteString("lastSeen", Iso(remark.LastSeenUtc));
            json.WriteEndObject();
        }

        private static string Iso(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);

        private static void WriteRemarks(Utf8JsonWriter json, IReadOnlyList<string> remarks)
        {
            json.WriteStartArray();
            if (remarks != null)
                foreach (string remark in remarks) json.WriteStringValue(remark);
            json.WriteEndArray();
        }

        private static void WriteCar(Utf8JsonWriter json, CarEntry car)
        {
            json.WriteStartObject();
            json.WriteString("path", car.Path);
            json.WriteString("name", car.Name);
            json.WriteString("kind", car.Kind);
            json.WriteString("abs", car.Abs);
            json.WriteString("tc", car.Tc);
            json.WriteString("brakeBias", car.BrakeBias);
            json.WritePropertyName("controls");
            json.WriteStartArray();
            foreach (var control in car.Controls)
            {
                json.WriteStartObject();
                json.WriteString("id", control.Id);
                json.WriteString("var", control.Var);
                json.WriteString("label", control.Label);
                if (!string.IsNullOrEmpty(control.Words)) json.WriteString("words", control.Words);
                if (control.NeverOff) json.WriteBoolean("off", false);
                else if (control.Off.HasValue) json.WriteNumber("off", control.Off.Value);
                if (control.Min.HasValue && control.Max.HasValue)
                {
                    json.WritePropertyName("range");
                    json.WriteStartArray();
                    json.WriteNumberValue(control.Min.Value);
                    json.WriteNumberValue(control.Max.Value);
                    json.WriteEndArray();
                }
                if (control.Positions.Count > 0)
                {
                    json.WritePropertyName("positions");
                    json.WriteStartObject();
                    foreach (var position in control.Positions)
                        json.WriteString(position.Key.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture), position.Value);
                    json.WriteEndObject();
                }
                // Whether a fixed setup holds it: the list's word where it gives one, the rule's otherwise.
                json.WriteBoolean("lockedWhenFixed", CarControls.LockedByAFixedSetup(control));
                if (control.Covers != null)
                {
                    json.WritePropertyName("covers");
                    json.WriteStartArray();
                    foreach (string covered in control.Covers) json.WriteStringValue(covered);
                    json.WriteEndArray();
                }
                if (control.Decimals.HasValue) json.WriteNumber("decimals", control.Decimals.Value);
                if (!string.IsNullOrEmpty(control.Note)) json.WriteString("note", control.Note);
                json.WriteEndObject();
            }
            json.WriteEndArray();
            json.WriteString("checked", car.Checked);
            json.WriteEndObject();
        }
    }
}
