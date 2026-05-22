import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

/**
 * WebSocketManager - Real-time client session synchronizer
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

class WebSocketManager {
  constructor(socketUrl = `${API_URL}/ws-tasksphere`) {
    this.socketUrl = socketUrl;
    this.stompClient = null;
    this.connected = false;
    this.subscriptions = {};
    this.reconnectTimer = null;
  }

  connect(onConnectCallback, onErrorCallback) {
    if (this.connected) return;

    console.log('Connecting to real-time sync server...');
    const socket = new SockJS(this.socketUrl);
    const StompClient = Stomp.Stomp || Stomp;
    this.stompClient = StompClient.over(socket);
    
    // Disable debug logging to keep the browser log clean
    this.stompClient.debug = null;

    this.stompClient.connect({}, 
      (frame) => {
        this.connected = true;
        this.setWsStatusIndicator(true);
        console.log('Successfully connected to real-time Spring server.');
        if (onConnectCallback) onConnectCallback(frame);
      },
      (error) => {
        this.connected = false;
        this.setWsStatusIndicator(false);
        console.warn('Real-time connection error. Retrying in 5 seconds...', error);
        if (onErrorCallback) onErrorCallback(error);
        
        // Auto-reconnect loop
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(onConnectCallback, onErrorCallback), 5000);
      }
    );
  }

  setWsStatusIndicator(isConnected) {
    const wsStatusText = document.getElementById('wsStatus');
    if (wsStatusText) {
      if (isConnected) {
        wsStatusText.textContent = '● Connected Live';
        wsStatusText.className = 'text-cyan bg-cyan-glow';
      } else {
        wsStatusText.textContent = '● Disconnected';
        wsStatusText.className = 'text-rose';
      }
    }
  }

  subscribe(topic, onMessageCallback) {
    if (!this.connected || !this.stompClient) return null;

    // Unsubscribe if already subscribed to this exact topic to prevent duplicate handlers
    this.unsubscribe(topic);

    const subscription = this.stompClient.subscribe(topic, (message) => {
      if (onMessageCallback) {
        const payload = JSON.parse(message.body);
        onMessageCallback(payload);
      }
    });

    this.subscriptions[topic] = subscription;
    return subscription;
  }

  unsubscribe(topic) {
    if (this.subscriptions[topic]) {
      this.subscriptions[topic].unsubscribe();
      delete this.subscriptions[topic];
    }
  }

  send(destination, payload) {
    if (!this.connected || !this.stompClient) {
      console.warn('Socket offline. Action skipped:', destination);
      return false;
    }
    this.stompClient.send(destination, {}, JSON.stringify(payload));
    return true;
  }

  disconnect() {
    if (this.stompClient) {
      this.stompClient.disconnect();
    }
    this.connected = false;
    this.setWsStatusIndicator(false);
  }
}

export const socket = new WebSocketManager();
