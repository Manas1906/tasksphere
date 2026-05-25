import { socket } from './websocket';
import { api } from './api';

/**
 * ChatController - Real-time Slack/Operations Chat & Direct Messaging coordinator
 */
export class ChatController {
  constructor() {
    this.messagesContainer = document.getElementById('chatMessages');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSendBtn');
    this.activeUsersContainer = document.getElementById('activeUsersList');
    this.userCountSpan = document.getElementById('activeUserCount');
    
    // Direct message tracking states
    this.activeChatPartner = null; // null = Operations Group Chat, otherwise 'username'
    this.historyMessages = [];     // In-memory cache of loaded DB messages
    this.unreadDms = {};           // Track unread direct message counts
  }

  get myUsername() {
    return localStorage.getItem('chat_username') || 'CTO Guest';
  }

  get myAvatar() {
    return localStorage.getItem('chat_avatar') || 'https://api.dicebear.com/7.x/bottts/svg?seed=Admin';
  }

  init() {
    console.log('[CHAT-INIT] Initializing ChatController...');
    this.bindEvents();
    this.loadChatHistory();
    this.loadUserDirectory();
  }

  async loadUserDirectory() {
    try {
      console.log('[CHAT-DIRECTORY] Loading workspace member directory from database...');
      const users = await api.getUsers() || [];
      
      // Filter out pending users and current user
      const approvedTeammates = users.filter(u => u.status !== 'PENDING_APPROVAL' && u.username !== this.myUsername);
      
      // Map database users to activeMember structure
      let cachedMembers = JSON.parse(localStorage.getItem('cache_users') || '[]');
      
      const mappedMembers = approvedTeammates.map(dbUser => {
        const existing = cachedMembers.find(m => m.username === dbUser.username);
        
        // Extract clean avatar URL
        let cleanAvatar = dbUser.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${dbUser.username}`;
        if (cleanAvatar.includes('||')) {
          cleanAvatar = cleanAvatar.split('||')[0];
        }
        
        return {
          id: dbUser.id,
          username: dbUser.username,
          avatarUrl: cleanAvatar,
          role: dbUser.role || 'DEVELOPER',
          status: existing ? existing.status : 'OFFLINE',
          lastActive: existing ? existing.lastActive : 0
        };
      });
      
      localStorage.setItem('cache_users', JSON.stringify(mappedMembers));
      this.drawAvatars(mappedMembers);
    } catch (err) {
      console.warn('[CHAT-DIRECTORY-ERROR] Failed to load database user directory:', err);
      // Fallback to drawing whatever is in localStorage
      let cachedMembers = JSON.parse(localStorage.getItem('cache_users') || '[]');
      this.drawAvatars(cachedMembers);
    }
  }

  bindEvents() {
    // Send message action
    const handleSend = () => {
      let msgText = this.input.value.trim();
      if (!msgText) return;

      // Prefix message body if we are in private DM mode
      if (this.activeChatPartner) {
        msgText = `[DM:${this.activeChatPartner}] ${msgText}`;
      }

      const payload = {
        username: this.myUsername,
        avatarUrl: this.myAvatar,
        message: msgText
      };

      console.log('[CHAT-SEND-CLICK] User initiated message dispatch:', payload);

      // Broadcast via socket
      const sent = socket.send('/app/chat.send', payload);
      if (!sent) {
        console.warn('[CHAT-OFFLINE] WebSocket send failed! Appending to local offline cache.');
        // Add offline fallback
        const offlineMsg = {
          ...payload,
          timestamp: new Date().toISOString(),
          offline: true
        };
        this.historyMessages.push(offlineMsg);
        this.redrawMessages();
      } else {
        console.log('[CHAT-SUCCESS] Message successfully dispatched over live socket broker!');
      }
      
      this.input.value = '';
      this.input.focus();
    };

    this.sendBtn.onclick = handleSend;
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter') handleSend();
    };

    // Role-based visibility and click handler for clearing chat history (Admin/Product Owner Only)
    const clearHistoryBtn = document.getElementById('clearChatHistoryBtn');
    if (clearHistoryBtn) {
      const role = localStorage.getItem('chat_role') || 'DEVELOPER';
      if (role === 'PRODUCT_OWNER' || role === 'MANAGER') {
        clearHistoryBtn.style.display = 'block';
        clearHistoryBtn.onclick = async () => {
          const confirmClear = confirm("⚠️ Are you sure you want to permanently delete the entire chat history from the database?\n\nThis action cannot be undone.");
          if (!confirmClear) return;
          
          try {
            console.log('[CHAT-CLEAR] Sending DELETE request to clear chat history...');
            await api.request('/chat-messages', { method: 'DELETE' });
            
            // Wipe local memory and update the UI
            this.historyMessages = [];
            this.redrawMessages();
            alert('Chat history cleared successfully!');
          } catch (err) {
            console.error('[CHAT-CLEAR-ERROR] Failed to clear chat history:', err);
            alert(`Failed to clear chat history: ${err.message || err}`);
          }
        };
      } else {
        clearHistoryBtn.style.display = 'none';
      }
    }

    // Bind DM Back Button switches
    const backLink = document.getElementById('chatModeBackLink');
    if (backLink) {
      backLink.onclick = () => {
        this.switchChatPartner(null);
      };
    }

    // Bind chat panel header click to switch back to Teams Chat
    const chatHeader = document.querySelector('.chat-panel-header');
    if (chatHeader) {
      chatHeader.style.cursor = 'pointer';
      chatHeader.title = 'Switch back to Operations Group Chat';
      chatHeader.onclick = (e) => {
        // Prevent triggering return if clicking on clear history button or mobile close cross
        if (e.target.id !== 'clearChatHistoryBtn' && !e.target.classList.contains('mobile-nav-close')) {
          this.switchChatPartner(null);
        }
      };
    }
  }

  async loadChatHistory() {
    console.log('[CHAT-HISTORY] Requesting recent chat thread history...');
    this.messagesContainer.innerHTML = '';
    
    try {
      // Fetch persisted history from new backend API endpoint
      const messages = await api.request('/chat-messages') || [];
      console.log(`[CHAT-HISTORY] Loaded ${messages.length} messages successfully from database.`);
      this.historyMessages = messages;
      this.redrawMessages();
    } catch (e) {
      console.warn('[CHAT-HISTORY] REST call failed. Retrieving chat history from localstorage cache.', e);
      // Offline fallback history loading
      const cache = JSON.parse(localStorage.getItem('cache_chat') || '[]');
      this.historyMessages = cache;
      this.redrawMessages();
    }
  }

  subscribeChannels() {
    console.log('[CHAT-SUBSCRIBE] Subscribing to chat and user presence topics...');
    
    // Subscribe to chat stream
    socket.subscribe('/topic/chat', (message) => {
      console.log('[CHAT-BROADCAST-IN] Received incoming chat message from broker:', message);
      this.historyMessages.push(message);
      
      // Parse direct message notifications
      const isDm = message.message && message.message.startsWith('[DM:');
      if (isDm) {
        const match = message.message.match(/^\[DM:([^\]]+)\]\s*(.*)$/);
        if (match) {
          const recipient = match[1];
          const sender = message.username;
          
          if (recipient === this.myUsername && this.activeChatPartner !== sender) {
            // Increment unread count for this sender and update UI avatars
            this.unreadDms[sender] = (this.unreadDms[sender] || 0) + 1;
            this.updateActiveUsersList({ username: '', status: 'ONLINE' });
          }
        }
      }
      
      this.redrawMessages();
    });

    // Subscribe to users presence mapping
    socket.subscribe('/topic/users', (presenceUpdate) => {
      console.log('[CHAT-PRESENCE-IN] Received user presence update from broker:', presenceUpdate);
      this.updateActiveUsersList(presenceUpdate);
    });
  }

  syncMyPresence() {
    console.log('[CHAT-PRESENCE-SYNC] Preparing periodic presence registration...');
    const registerPresence = () => {
      const presencePayload = {
        username: this.myUsername,
        avatarUrl: this.myAvatar,
        role: localStorage.getItem('chat_role') || 'DEVELOPER',
        status: 'ONLINE'
      };
      
      console.log('[CHAT-PRESENCE-SEND] Registering presence heartbeat:', presencePayload);
      socket.send('/app/user.presence', presencePayload);
    };

    // Initial register when connection completes
    setTimeout(registerPresence, 2000);
    
    // Periodic presence ping every 20 seconds
    setInterval(() => {
      if (socket.connected) {
        registerPresence();
      } else {
        console.log('[CHAT-PRESENCE-SKIP] Socket is offline. Skipping presence heartbeat.');
      }
    }, 20000);
  }

  switchChatPartner(partner) {
    this.activeChatPartner = partner;
    
    // Clear unread count when opening a DM session
    if (partner) {
      this.unreadDms[partner] = 0;
    }
    
    const backLink = document.getElementById('chatModeBackLink');
    const chatTitle = document.querySelector('.chat-panel-header__title');
    
    if (partner) {
      // Direct message (DM) tab active
      if (backLink) backLink.style.display = 'flex';
      if (chatTitle) {
        chatTitle.innerHTML = `
          <span style="font-size: 13px; display: inline-flex; align-items: center; gap: 4px; color: #ff0080; font-weight: 700; text-transform: uppercase;">
            💬 Chat with ${partner}
          </span>
        `;
      }
      this.input.placeholder = `Send direct message to ${partner}...`;
    } else {
      // Group room active
      if (backLink) backLink.style.display = 'none';
      if (chatTitle) {
        chatTitle.innerHTML = `
          <svg style="width: 16px; height: 16px; fill: var(--accent-cyan)" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
          Operations Chat
        `;
      }
      this.input.placeholder = `Send team message...`;
    }

    // Refresh active members display to update partner selected outline state
    this.updateActiveUsersList({ username: '', status: 'ONLINE' });

    // Rerender chat bubbles matching current active channel
    this.redrawMessages();
  }

  redrawMessages() {
    this.messagesContainer.innerHTML = '';
    
    const filtered = this.historyMessages.filter(msg => {
      const isDm = msg.message && msg.message.startsWith('[DM:');
      
      if (this.activeChatPartner === null) {
        // General group room: show only public non-prefixed messages
        return !isDm;
      } else {
        // Direct private message tab: show only DM conversation matches
        if (!isDm) return false;
        
        const match = msg.message.match(/^\[DM:([^\]]+)\]\s*(.*)$/);
        if (!match) return false;
        
        const recipient = match[1];
        const sender = msg.username;
        
        // Match if (I sent to partner) OR (partner sent to me)
        return (sender === this.myUsername && recipient === this.activeChatPartner) ||
               (sender === this.activeChatPartner && recipient === this.myUsername);
      }
    });

    filtered.forEach(msg => this.renderSingleMessage(msg));
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  renderSingleMessage(msg) {
    const isSelf = msg.username === this.myUsername;
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';

    // Strip out routing DM tags if printing
    let cleanMessage = msg.message;
    if (cleanMessage && cleanMessage.startsWith('[DM:')) {
      const match = cleanMessage.match(/^\[DM:[^\]]+\]\s*(.*)$/);
      if (match) {
        cleanMessage = match[1];
      }
    }

    const msgElement = document.createElement('div');
    msgElement.className = `chat-msg ${isSelf ? 'chat-msg--self' : ''}`;
    
    const cleanAvatar = (msg.avatarUrl || '').split('||')[0];
    msgElement.innerHTML = `
      <img src="${cleanAvatar}" class="chat-msg__avatar" alt="${msg.username}">
      <div class="chat-msg__content-box">
        <div class="chat-msg__meta">
          <span class="chat-msg__sender">${msg.username}</span>
          <span>${time}</span>
          ${msg.offline ? '<span class="text-amber" style="font-size: 8px">Offline cache</span>' : ''}
        </div>
        <div class="chat-msg__bubble">${cleanMessage}</div>
      </div>
    `;

    this.messagesContainer.appendChild(msgElement);
  }

  updateActiveUsersList(presence) {
    // Collect active members and cache details locally
    let activeMembers = JSON.parse(localStorage.getItem('cache_users') || '[]');
    
    // Invalidate/Remove account from list immediately if they went offline, got pending state, or were revoked
    if (presence.username && (presence.status === 'OFFLINE' || presence.status === 'PENDING_APPROVAL' || presence.action === 'REJECTED')) {
      activeMembers = activeMembers.filter(m => m.username !== presence.username);
      localStorage.setItem('cache_users', JSON.stringify(activeMembers));
      
      // If we were chatting with this partner and they disappeared, return to group room
      if (this.activeChatPartner === presence.username) {
        this.switchChatPartner(null);
      } else {
        this.drawAvatars(activeMembers);
      }
      return;
    }

    // Register active user in cache
    if (presence.username && presence.username !== this.myUsername) {
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
      localStorage.setItem('cache_users', JSON.stringify(activeMembers));
    }

    this.drawAvatars(activeMembers);
  }

  drawAvatars(activeMembers) {
    this.activeUsersContainer.innerHTML = '';
    
    activeMembers.forEach(user => {
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'active-user-avatar-wrap';
      avatarWrap.title = `${user.username} (${(user.role || 'DEVELOPER').replace(/_/g, ' ')}) - ${user.status}`;
      avatarWrap.style.cursor = 'pointer';
      avatarWrap.style.transition = 'outline 0.2s ease, transform 0.2s ease';

      // Outline the selected partner
      if (this.activeChatPartner === user.username) {
        avatarWrap.style.outline = '2px solid #ff0080';
        avatarWrap.style.outlineOffset = '2px';
        avatarWrap.style.transform = 'scale(1.05)';
      }

      avatarWrap.onclick = () => {
        if (user.username !== this.myUsername) {
          if (this.activeChatPartner === user.username) {
            this.switchChatPartner(null);
          } else {
            this.switchChatPartner(user.username);
          }
        }
      };

      const statusClass = user.status.toLowerCase();
      const cleanAvatar = (user.avatarUrl || '').split('||')[0];
      
      const unreadCount = this.unreadDms[user.username] || 0;
      const badgeHtml = unreadCount > 0 
        ? `<span class="active-user-unread-badge">${unreadCount}</span>` 
        : '';
        
      avatarWrap.innerHTML = `
        <img src="${cleanAvatar}" class="active-user-avatar" alt="${user.username}">
        <span class="active-user-status-dot active-user-status-dot--${statusClass}"></span>
        ${badgeHtml}
      `;
      this.activeUsersContainer.appendChild(avatarWrap);
    });

    this.userCountSpan.textContent = `${activeMembers.length} active session${activeMembers.length > 1 ? 's' : ''}`;
  }
}
