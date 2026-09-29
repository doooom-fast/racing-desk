using System;
using System.Collections.Generic;
using System.Text.Json;
using RacingDesk.Core.Cars;

namespace RacingDesk.Host
{
    /// <summary>
    /// The canonical list of cars as the host carries it, for <c>GET /racing-desk/data/controls</c>: every car, or
    /// one (<c>?car=porsche963gtp</c>), with what the check has said of each this run. Read-only, and from the
    /// assembly: the store is not opened for it.
    /// </summary>
    internal static class CarListApi
    {
        /// <param name="carPath">The sim's folder for one car; null or empty for the whole list.</param>
        /// <param name="remarks">What the check has said this run, by the car's folder; null for none.</param>
        public static void Write(Utf8JsonWriter json, CarList list, string carPath,
            IReadOnlyDictionary<string, IReadOnlyList<string>> remarks, string following)
        {
            list ??= CarList.Empty;
            json.WriteStartObject();
            json.WriteNumber("version", list.Version);
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
            json.WritePropertyName("cars");
            json.WriteStartArray();
            foreach (var car in list.Cars) WriteCar(json, car);
            json.WriteEndArray();
            json.WriteEndObject();
        }

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
