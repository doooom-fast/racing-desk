using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using Fleck;

namespace RacingDesk.Plugin.Transport
{
    /// <summary>
    /// WebSocket server wrapper using Fleck.
    /// Listens on ws://0.0.0.0:8890/racing-desk (port 8890 for PR 1; PR 5 will migrate to 8889), or on the address given.
    /// Thread-safe; handles client connection/disconnection.
    /// </summary>
    public class WsServer : IWsConnectionSink
    {
        private readonly int _port;
        private readonly string _path;
        private readonly string _address;
        private WebSocketServer _server;
        private volatile bool _running = false;

        // Per-client state
        private readonly ConcurrentDictionary<Guid, WsClientConnection> _clients =
            new ConcurrentDictionary<Guid, WsClientConnection>();

        private Action<IWsConnection> _onConnectHandler;
        private Action<IWsConnection> _onDisconnectHandler;

        /// <param name="address">The IP address to bind: 0.0.0.0 for every address, 127.0.0.1 for this machine alone.</param>
        public WsServer(int port = 8890, string path = "/racing-desk", string address = "0.0.0.0")
        {
            _port = port;
            _path = path;
            _address = address;
        }

        /// <summary>Start the WebSocket server.</summary>
        public void Start()
        {
            if (_running) return;

            try
            {
                var url = $"ws://{_address}:{_port}{_path}";
                _server = new WebSocketServer(url);

                _server.Start(socket =>
                {
                    var connId = Guid.NewGuid();
                    var clientConn = new WsClientConnection(connId, socket);
                    _clients.TryAdd(connId, clientConn);

                    Log.Info($"[RacingDesk.WsServer] Client connected: {connId}");
                    _onConnectHandler?.Invoke(clientConn);

                    socket.OnClose += () =>
                    {
                        _clients.TryRemove(connId, out _);
                        Log.Info($"[RacingDesk.WsServer] Client disconnected: {connId}");
                        _onDisconnectHandler?.Invoke(clientConn);
                    };

                    socket.OnError += ex =>
                    {
                        Log.Warn($"[RacingDesk.WsServer] Client {connId} error: {ex.Message}");
                    };
                });

                _running = true;
                Log.Info($"[RacingDesk.WsServer] WebSocket server listening on {url}");
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.WsServer] Failed to start: {ex.Message}");
                _running = false;
            }
        }

        /// <summary>Stop the WebSocket server.</summary>
        public void Stop()
        {
            if (!_running) return;

            try
            {
                _running = false;

                // Close all client connections gracefully
                foreach (var client in _clients.Values)
                {
                    try
                    {
                        client.Socket?.Close();
                    }
                    catch (Exception ex)
                    {
                        Log.Warn($"[RacingDesk.WsServer] Error closing client: {ex.Message}");
                    }
                }
                _clients.Clear();

                // Dispose server
                _server?.Dispose();
                _server = null;

                Log.Info("[RacingDesk.WsServer] WebSocket server stopped");
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.WsServer] Error stopping server: {ex.Message}");
            }
        }

        /// <summary>Broadcast a message to all connected clients.</summary>
        public void Broadcast(byte[] payload)
        {
            if (!_running || payload == null) return;

            foreach (var client in _clients.Values)
            {
                SendTo(client.Id, payload);
            }
        }

        /// <summary>Send a message to a specific client.</summary>
        public void SendTo(Guid connectionId, byte[] payload)
        {
            if (!_clients.TryGetValue(connectionId, out var client)) return;

            try
            {
                client.Send(payload);
            }
            catch (Exception ex)
            {
                Log.Warn($"[RacingDesk.WsServer] Send failed for {connectionId}: {ex.Message}");
            }
        }

        /// <summary>Get all connected clients (IWsConnectionSink interface).</summary>
        public IWsConnection[] GetConnections()
        {
            var result = new IWsConnection[_clients.Count];
            var i = 0;
            foreach (var client in _clients.Values)
            {
                result[i++] = client;
            }
            return result;
        }

        /// <summary>Register connection handler (IWsConnectionSink interface).</summary>
        public void OnClientConnected(Action<IWsConnection> handler)
        {
            _onConnectHandler = handler;
        }

        /// <summary>Register disconnection handler (IWsConnectionSink interface).</summary>
        public void OnClientDisconnected(Action<IWsConnection> handler)
        {
            _onDisconnectHandler = handler;
        }

        /// <summary>Per-client state.</summary>
        private class WsClientConnection : IWsConnection
        {
            public Guid Id { get; }
            public IWebSocketConnection Socket { get; }

            public WsClientConnection(Guid id, IWebSocketConnection socket)
            {
                Id = id;
                Socket = socket;
            }

            public bool IsOpen => Socket?.IsAvailable ?? false;

            public void Send(byte[] data)
            {
                if (IsOpen)
                {
                    Socket.Send(data);
                }
            }
        }
    }
}
