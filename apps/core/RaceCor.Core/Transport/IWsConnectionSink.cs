using System;

namespace RaceCorProDrive.Plugin.Transport
{
    /// <summary>
    /// Interface for WebSocket connection state.
    /// Injected into WsTelemetryPublisher for testability (decouples from Fleck).
    /// </summary>
    public interface IWsConnection
    {
        /// <summary>Unique identifier for this connection.</summary>
        Guid Id { get; }

        /// <summary>Send a MessagePack-encoded byte buffer to this client.</summary>
        void Send(byte[] data);

        /// <summary>True if the connection is open.</summary>
        bool IsOpen { get; }
    }

    /// <summary>
    /// Sink for adding/removing connections and iterating over connected clients.
    /// Injected into WsTelemetryPublisher for testability.
    /// </summary>
    public interface IWsConnectionSink
    {
        /// <summary>Get all currently connected clients.</summary>
        IWsConnection[] GetConnections();

        /// <summary>Register a client connection callback for when clients connect.</summary>
        void OnClientConnected(Action<IWsConnection> handler);

        /// <summary>Register a client disconnection callback.</summary>
        void OnClientDisconnected(Action<IWsConnection> handler);
    }
}
