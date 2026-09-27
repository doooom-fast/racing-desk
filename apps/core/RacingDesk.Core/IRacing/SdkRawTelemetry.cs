using System;
using IRSDKSharper;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary><see cref="IRawTelemetry"/> over iRacing's live shared memory (IRSDKSharper).</summary>
    public sealed class SdkRawTelemetry : IRawTelemetry, IDisposable
    {
        private readonly IRacingSdk _sdk = new IRacingSdk(false, false);

        /// <summary>Raised on the SDK thread for every telemetry tick (60 Hz while connected).</summary>
        public event Action TelemetryData
        {
            add => _sdk.OnTelemetryData += value;
            remove => _sdk.OnTelemetryData -= value;
        }

        public event Action Connected { add => _sdk.OnConnected += value; remove => _sdk.OnConnected -= value; }
        public event Action Disconnected { add => _sdk.OnDisconnected += value; remove => _sdk.OnDisconnected -= value; }

        public void Start() => _sdk.Start();
        public void Stop() { if (_sdk.IsStarted) _sdk.Stop(); }
        public void Dispose() => Stop();

        public bool IsConnected => _sdk.IsConnected && _sdk.Data.TelemetryDataPropertiesReady;

        public IRacingSdkSessionInfo SessionInfo => IsConnected ? _sdk.Data.SessionInfo : null;

        public object GetValue(string name)
        {
            if (!IsConnected || !_sdk.Data.TelemetryDataProperties.TryGetValue(name, out var datum)) return null;
            var data = _sdk.Data;
            int count = datum.Count;
            if (count <= 1)
            {
                switch (datum.VarType)
                {
                    case IRacingSdkEnum.VarType.Char: return data.GetChar(datum, 0);
                    case IRacingSdkEnum.VarType.Bool: return data.GetBool(datum, 0);
                    case IRacingSdkEnum.VarType.Int: return data.GetInt(datum, 0);
                    case IRacingSdkEnum.VarType.BitField: return unchecked((int)data.GetBitField(datum, 0));
                    case IRacingSdkEnum.VarType.Float: return data.GetFloat(datum, 0);
                    case IRacingSdkEnum.VarType.Double: return data.GetDouble(datum, 0);
                    default: return null;
                }
            }
            switch (datum.VarType)
            {
                case IRacingSdkEnum.VarType.Bool: { var a = new bool[count]; data.GetBoolArray(datum, a, 0, count); return a; }
                case IRacingSdkEnum.VarType.Int: { var a = new int[count]; data.GetIntArray(datum, a, 0, count); return a; }
                case IRacingSdkEnum.VarType.BitField:
                {
                    var u = new uint[count];
                    data.GetBitFieldArray(datum, u, 0, count);
                    var a = new int[count];
                    for (int i = 0; i < count; i++) a[i] = unchecked((int)u[i]);
                    return a;
                }
                case IRacingSdkEnum.VarType.Float: { var a = new float[count]; data.GetFloatArray(datum, a, 0, count); return a; }
                case IRacingSdkEnum.VarType.Double: { var a = new double[count]; data.GetDoubleArray(datum, a, 0, count); return a; }
                default: return null;
            }
        }
    }
}
