using System.Text.RegularExpressions;
using IRSDKSharper;
using YamlDotNet.Serialization;

namespace RaceCorProDrive.Plugin.IRacing
{
    /// <summary>Parses iRacing's session-info YAML into IRSDKSharper's typed model.</summary>
    public static class SessionInfoYaml
    {
        private static readonly IDeserializer Deserializer =
            new DeserializerBuilder().IgnoreUnmatchedProperties().Build();

        // iRacing writes free-text values unquoted, so names like "O'Brien: Racing" or "#1 Fan"
        // break a strict YAML parser. Quote the string fields that carry user- or track-authored text.
        private static readonly Regex FreeText = new Regex(
            @"^(\s*(?:- )?(?:UserName|AbbrevName|Initials|TeamName|CarDesignStr|HelmetDesignStr|SuitDesignStr|" +
            @"CarNumberDesignStr|CarSponsor_1|CarSponsor_2|ClubName|DivisionName|FlairName|DriverSetupName|" +
            @"SessionName|ReasonOutStr|TrackDisplayName|TrackDisplayShortName|TrackConfigName|TrackCity|" +
            @"TrackCountry|CarScreenName|CarScreenNameShort|CarClassShortName|LicString|CarNumber):[ \t])(.*?)\r?$",
            RegexOptions.Multiline | RegexOptions.Compiled);

        public static IRacingSdkSessionInfo Parse(string yaml)
        {
            if (string.IsNullOrEmpty(yaml)) return null;
            return Deserializer.Deserialize<IRacingSdkSessionInfo>(Sanitize(yaml));
        }

        internal static string Sanitize(string yaml) =>
            FreeText.Replace(yaml, m =>
            {
                string value = m.Groups[2].Value;
                if (value.Length == 0 || (value.Length >= 2 && value[0] == '"' && value[value.Length - 1] == '"'))
                    return m.Value;
                return m.Groups[1].Value + "'" + value.Replace("'", "''") + "'";
            });
    }
}
