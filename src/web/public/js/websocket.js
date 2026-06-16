/**
 * WebSocket client for real-time updates from the backend.
 * Handles connection, reconnection, and event dispatching.
 */
class RealtimeClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
    this._connect();
  }

  _connect() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      this.socket = io(wsUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      this.socket.on('connect', () => {
        console.log('[WS] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this._emit('connect');
      });

      this.socket.on('disconnect', (reason) => {
        console.log(`[WS] Disconnected: ${reason}`);
        this.isConnected = false;
        this._emit('disconnect', reason);
        this._reconnect();
      });

      this.socket.on('connect_error', (err) => {
        console.error('[WS] Connection error:', err.message);
        this._reconnect();
      });

      // Register event handlers for custom events
      this.socket.on('status', (data) => {
        this._emit('status', data);
      });

      this.socket.on('qr', (data) => {
        this._emit('qr', data);
      });

      this.socket.on('memory', (data) => {
        this._emit('memory', data);
      });

      this.socket.on('message', (data) => {
        this._emit('message', data);
      });

    } catch (err) {
      console.error('[WS] Init error:', err);
      this._reconnect();
    }
  }

  _reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (!this.isConnected) {
        this._connect();
      }
    }, delay);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx !== -1) cbs.splice(idx, 1);
    }
  }

  _emit(event, data) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        try { cb(data); } catch (err) { console.error('[WS] Listener error:', err); }
      }
    }
  }

  /**
   * Request a data update from the server.
   */
  emit(event, data) {
    if (this.socket && this.isConnected) {
      this.socket.emit(event, data);
    }
  }

  /**
   * Disconnect manually.
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
  }
}

// Initialize global instance
const wsClient = new RealtimeClient();
