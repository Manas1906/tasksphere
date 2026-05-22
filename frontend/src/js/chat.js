import { socket } from './websocket';
import { api } from './api';

/**
 * ChatController - Real-time Slack/Operations Chat coordinator
 */
export class ChatController {
  constructor() {
    this.messagesContainer = document.getElementById('chatMessages');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSendBtn');
    this.activeUsersContainer = document.getElementById('activeUsersList');
    this.userCountSpan = document.getElementById('activeUserCount');
    this.myUsername = localStorage.getItem('chat_username') || 'CTO Guest';
    this.myAvatar = localStorage.getItem('chat_avatar') || 'https://api.dicebear.com/7.x/bottts/svg?seed=Admin';
  }

  init() {
    this.bindEvents();
    this.loadChatHistory();
  }

  bindEvents() {
    // Send message action
    const handleSend = () => {
      const msgText = this.input.value.trim();
      if (!msgText) return;

      const payload = {
        username: this.myUsername,
        avatarUrl: this.myAvatar,
        message: msgText
      };

      // Broadcast via socket
      const sent = socket.send('/app/chat.send', payload);
      if (!sent) {
        // Mock offline display if socket disconnected
        this.appendMessage({
          ...payload,
          timestamp: new Date().toISOString(),
          offline: true
        });
      }
      
      this.input.value = '';
      this.input.focus();
    };

    this.sendBtn.onclick = handleSend;
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter') handleSend();
    };
  }

  async loadChatHistory() {
    this.messagesContainer.innerHTML = '';
    
    // Read from DB fallback cache if offline, else fetch
    try {
      const messages = await api.request('/chat-messages') || [];
      messages.forEach(msg => this.appendMessage(msg));
    } catch (e) {
      // Offline fallback history loading
      const cache = JSON.parse(localStorage.getItem('cache_chat') || '[]');
      cache.forEach(msg => this.appendMessage(msg));
    }
  }

  subscribeChannels() {
    // Subscribe to chat stream
    socket.subscribe('/topic/chat', (message) => {
      this.appendMessage(message);
    });

    // Subscribe to users presence mapping
    socket.subscribe('/topic/users', (presenceUpdate) => {
      this.updateActiveUsersList(presenceUpdate);
    });
  }

  syncMyPresence() {
    // Register periodic presence broadcasts
    const registerPresence = () => {
      socket.send('/app/user.presence', {
        username: this.myUsername,
        avatarUrl: this.myAvatar,
        role: localStorage.getItem('chat_role') || 'DEVELOPER',
        status: 'ONLINE'
      });
    };

    // Initial register when connection completes
    setTimeout(registerPresence, 2000);
    
    // Periodic presence ping every 20 seconds
    setInterval(() => {
      if (socket.connected) registerPresence();
    }, 20000);
  }

  appendMessage(msg) {
    const isSelf = msg.username === this.myUsername;
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';

    const msgElement = document.createElement('div');
    msgElement.className = `chat-msg ${isSelf ? 'chat-msg--self' : ''}`;
    
    msgElement.innerHTML = `
      <img src="${msg.avatarUrl}" class="chat-msg__avatar" alt="${msg.username}">
      <div class="chat-msg__content-box">
        <div class="chat-msg__meta">
          <span class="chat-msg__sender">${msg.username}</span>
          <span>${time}</span>
          ${msg.offline ? '<span class="text-amber" style="font-size: 8px">Offline cache</span>' : ''}
        </div>
        <div class="chat-msg__bubble">${msg.message}</div>
      </div>
    `;

    this.messagesContainer.appendChild(msgElement);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  updateActiveUsersList(presence) {
    // Collect active members and cache details locally
    let activeMembers = JSON.parse(localStorage.getItem('cache_users') || '[]');
    
    const existingIdx = activeMembers.findIndex(m => m.username === presence.username);
    const memberObj = {
      id: presence.id || (existingIdx !== -1 ? activeMembers[existingIdx].id : 'user_' + Date.now()),
      username: presence.username,
      avatarUrl: presence.avatarUrl,
      role: presence.role || 'DEVELOPER',
      status: presence.status || 'ONLINE',
      lastActive: Date.now()
    };

    if (existingIdx !== -1) {
      activeMembers[existingIdx] = memberObj;
    } else {
      activeMembers.push(memberObj);
    }

    // Keep active users filtered for showing in scrolling bar (active in last 45 seconds)
    // In mock setup we preserve them all for visual flair
    localStorage.setItem('cache_users', JSON.stringify(activeMembers));

    // Redraw avatars bar
    this.activeUsersContainer.innerHTML = '';
    
    activeMembers.forEach(user => {
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'active-user-avatar-wrap';
      avatarWrap.title = `${user.username} (${user.role}) - ${user.status}`;
      
      const statusClass = user.status.toLowerCase();

      avatarWrap.innerHTML = `
        <img src="${user.avatarUrl}" class="active-user-avatar" alt="${user.username}">
        <span class="active-user-status-dot active-user-status-dot--${statusClass}"></span>
      `;
      this.activeUsersContainer.appendChild(avatarWrap);
    });

    this.userCountSpan.textContent = `${activeMembers.length} active session${activeMembers.length > 1 ? 's' : ''}`;
  }
}
