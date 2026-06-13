import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

/**
 * WebSocketManager - Real-time client session synchronizer
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const CLEAN_API_URL = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;

class WebSocketManager {
  constructor(socketUrl = `${CLEAN_API_URL}/ws-tasksphere`) {
    this.socketUrl = socketUrl;
    this.stompClient = null;
    this.connected = false;
    this.subscriptions = {};
    this.reconnectTimer = null;
    console.log(`[WS-INFO] WebSocketManager initialized with target URL: ${this.socketUrl}`);
  }

  connect(onConnectCallback, onErrorCallback) {
    if (this.connected) {
      console.log('[WS-INFO] Connect requested but socket is already connected.');
      return;
    }

    console.log(`[WS-CONNECTING] Attempting to handshake with real-time sync server at: ${this.socketUrl}`);
    const socket = new SockJS(this.socketUrl);
    const StompClient = Stomp.Stomp || Stomp;
    this.stompClient = StompClient.over(socket);
    
    // Enable STOMP debug logging to console to trace exactly what is failing/succeeding
    this.stompClient.debug = (msg) => {
      console.log(`[STOMP-FRAME] ${msg}`);
    };

    const token = localStorage.getItem('tasksphere_jwt');
    const username = localStorage.getItem('chat_username');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (username) headers['username'] = username;

    this.stompClient.connect(headers, 
      (frame) => {
        this.connected = true;
        this.setWsStatusIndicator(true);
        console.log('[WS-SUCCESS] Successfully handshaked & connected to real-time server!', frame);
        if (onConnectCallback) onConnectCallback(frame);
      },
      (error) => {
        this.connected = false;
        this.setWsStatusIndicator(false);
        console.error('[WS-ERROR] Real-time connection handshake failed or dropped!', error);
        if (onErrorCallback) onErrorCallback(error);
        
        // Auto-reconnect loop
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          console.log('[WS-RECONNECT] Reconnection timer fired. Retrying connection...');
          this.connect(onConnectCallback, onErrorCallback);
        }, 5000);
      }
    );
  }

  setWsStatusIndicator(isConnected) {
    const wsStatusText = document.getElementById('wsStatus');
    console.log(`[WS-STATUS-UI] Updating status indicator to isConnected=${isConnected}`);
    if (wsStatusText) {
      if (isConnected) {
        wsStatusText.textContent = '● Online';
        wsStatusText.className = 'text-cyan bg-cyan-glow';
      } else {
        wsStatusText.textContent = '● Offline';
        wsStatusText.className = 'text-rose';
      }
    }
  }

  subscribe(topic, onMessageCallback) {
    if (!this.connected || !this.stompClient) {
      console.warn(`[WS-WARN] Subscribe failed. Client not connected. Topic: ${topic}`);
      return null;
    }

    // Unsubscribe if already subscribed to this exact topic to prevent duplicate handlers
    this.unsubscribe(topic);

    console.log(`[WS-SUBSCRIBE] Subscribing to topic: ${topic}`);
    const subscription = this.stompClient.subscribe(topic, (message) => {
      console.log(`[WS-MESSAGE-IN] Received message payload on topic: ${topic}`);
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
      console.log(`[WS-UNSUBSCRIBE] Unsubscribing from topic: ${topic}`);
      this.subscriptions[topic].unsubscribe();
      delete this.subscriptions[topic];
    }
  }

  send(destination, payload) {
    if (!this.connected || !this.stompClient) {
      console.warn(`[WS-WARN] Cannot send message. Socket is offline. Destination: ${destination}`, payload);
      return false;
    }
    console.log(`[WS-SEND] Dispatching message payload to destination: ${destination}`, payload);
    this.stompClient.send(destination, {}, JSON.stringify(payload));
    return true;
  }

  /**
   * Subscribe to a private user-scoped queue (e.g. /user/queue/call).
   * Messages sent via convertAndSendToUser() on the backend are routed here.
   */
  subscribeUser(destination, onMessageCallback) {
    const userTopic = `/user${destination}`;
    return this.subscribe(userTopic, onMessageCallback);
  }

  disconnect() {
    console.log('[WS-DISCONNECT] Manually terminating socket connection.');
    if (this.stompClient) {
      this.stompClient.disconnect();
    }
    this.connected = false;
    this.setWsStatusIndicator(false);
  }
}

export const socket = new WebSocketManager();
