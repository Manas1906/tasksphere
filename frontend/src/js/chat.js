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
    
    // Thread replies tracking states - Phase 8
    this.activeThreadMsg = null;   // msg object actively open in thread drawer

    // Autocomplete mentions tracking states
    this.mentionsDropdown = null;
    this.mentionsActiveIdx = -1;
    this.mentionsFilteredUsers = [];
    this.mentionSearchQuery = '';
    this.mentionSearchStartIdx = -1;
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
    this.setupMentionsAutocomplete();
  }

  async loadUserDirectory() {
    try {
      console.log('[CHAT-DIRECTORY] Loading workspace member directory from database...');
      const users = await api.getUsers() || [];
      
      // Filter out pending users and current user
      const approvedTeammates = users.filter(u => u.status !== 'PENDING_APPROVAL' && u.username !== this.myUsername);
      
      // Map database users directly using their database status (zero cache dependency!)
      const mappedMembers = approvedTeammates.map(dbUser => {
        // Extract clean avatar URL
        let cleanAvatar = dbUser.avatarUrl || '';
        if (cleanAvatar.includes('||')) {
          cleanAvatar = cleanAvatar.split('||')[0];
        }
        if (!cleanAvatar || cleanAvatar.trim() === '') {
          cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${dbUser.username}`;
        }
        
        return {
          id: dbUser.id,
          username: dbUser.username,
          avatarUrl: cleanAvatar,
          role: dbUser.role || 'DEVELOPER',
          status: dbUser.status || 'OFFLINE',
          lastActive: dbUser.lastActiveTime ? new Date(dbUser.lastActiveTime).getTime() : 0
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

    // Bind Close Thread Drawer - Phase 8
    const closeThreadBtn = document.getElementById('closeThreadBtn');
    if (closeThreadBtn) {
      closeThreadBtn.onclick = () => {
        const drawer = document.getElementById('threadDrawer');
        if (drawer) {
          drawer.classList.remove('visible');
          drawer.classList.add('hidden');
        }
        this.activeThreadMsg = null;
      };
    }

    // Bind Send Thread Reply - Phase 8
    const sendReplyBtn = document.getElementById('threadReplySendBtn');
    const replyInput = document.getElementById('threadReplyInput');
    
    if (sendReplyBtn) {
      sendReplyBtn.onclick = () => this.handleSendThreadReply();
    }
    
    if (replyInput) {
      replyInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          this.handleSendThreadReply();
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
      
      // In-place edit replacement if message ID already exists
      const existingIdx = this.historyMessages.findIndex(m => m.id === message.id);
      if (existingIdx !== -1) {
        this.historyMessages[existingIdx] = message;
        
        // Dynamically update active thread replies view if the open thread message is modified
        if (this.activeThreadMsg && this.activeThreadMsg.id === message.id) {
          this.activeThreadMsg = message;
          this.drawThreadReplies();
        }
      } else {
        this.historyMessages.push(message);
      }
      
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

  parseMessageMeta(rawMessage) {
    if (!rawMessage) return { text: '', meta: { reactions: {}, replies: [] } };
    
    let dmPrefix = '';
    let cleanMessage = rawMessage;
    if (rawMessage.startsWith('[DM:')) {
      const match = rawMessage.match(/^(\[DM:[^\]]+\]\s*)(.*)$/);
      if (match) {
        dmPrefix = match[1];
        cleanMessage = match[2];
      }
    }
    
    const parts = cleanMessage.split('||meta:');
    const textPart = parts[0];
    let metaPart = { reactions: {}, replies: [] };
    
    if (parts.length > 1) {
      try {
        metaPart = JSON.parse(parts[1]);
      } catch (err) {
        console.warn('[CHAT-META-PARSE] Failed to parse message metadata JSON:', err);
      }
    }
    
    if (!metaPart.reactions) metaPart.reactions = {};
    if (!metaPart.replies) metaPart.replies = [];
    
    return {
      dmPrefix: dmPrefix,
      text: textPart,
      meta: metaPart
    };
  }

  serializeMessageMeta(dmPrefix, text, meta) {
    return `${dmPrefix}${text}||meta:${JSON.stringify(meta)}`;
  }

  renderSingleMessage(msg) {
    const isSelf = msg.username === this.myUsername;
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';

    const parsed = this.parseMessageMeta(msg.message);
    const textMsg = parsed.text;
    const meta = parsed.meta;

    const msgElement = document.createElement('div');
    msgElement.className = `chat-msg ${isSelf ? 'chat-msg--self' : ''}`;
    msgElement.setAttribute('data-msg-id', msg.id);
    
    let cleanAvatar = (msg.avatarUrl || '').split('||')[0];
    if (!cleanAvatar || cleanAvatar.trim() === '') {
      cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.username}`;
    }

    // Build Reactions capsules UI
    let reactionsHtml = '';
    const activeReactions = Object.entries(meta.reactions).filter(([emoji, users]) => users && users.length > 0);
    if (activeReactions.length > 0) {
      reactionsHtml = `<div class="chat-msg__reactions-capsules">`;
      activeReactions.forEach(([emoji, users]) => {
        const hasReacted = users.includes(this.myUsername);
        reactionsHtml += `
          <span class="chat-msg__reaction-capsule ${hasReacted ? 'chat-msg__reaction-capsule--active' : ''}" data-emoji="${emoji}">
            <span>${emoji}</span>
            <span>${users.length}</span>
          </span>
        `;
      });
      reactionsHtml += `</div>`;
    }

    // Build Thread trigger indicator
    let threadsHtml = '';
    if (meta.replies && meta.replies.length > 0) {
      const count = meta.replies.length;
      threadsHtml = `
        <div class="chat-msg__threads-trigger">
          <span>🧵</span>
          <span>${count} ${count > 1 ? 'replies' : 'reply'}</span>
        </div>
      `;
    }

    msgElement.innerHTML = `
      <img src="${cleanAvatar}" class="chat-msg__avatar" alt="${msg.username}">
      <div class="chat-msg__content-box" style="width: 100%;">
        <div class="chat-msg__meta">
          <span class="chat-msg__sender">${msg.username}</span>
          <span>${time}</span>
          ${msg.offline ? '<span class="text-amber" style="font-size: 8px">Offline cache</span>' : ''}
        </div>
        <div class="chat-msg__bubble-container">
          <div class="chat-msg__bubble">${this.formatMessageMentions(textMsg)}</div>
          
          <!-- Hover Action items row -->
          <div class="chat-msg__action-bar">
            ${isSelf && msg.id ? `<button class="chat-msg__edit-btn" title="Edit message" style="position: static; opacity: 1; margin-right: 4px;">✏️</button>` : ''}
            ${msg.id ? `<button class="chat-msg__reply-btn" title="Reply in thread">🧵</button>` : ''}
          </div>

          <!-- Hover springy emojis picker menu -->
          ${msg.id ? `
            <div class="chat-msg__quick-reactions">
              <span class="chat-msg__reaction-emoji" data-emoji="👍">👍</span>
              <span class="chat-msg__reaction-emoji" data-emoji="❤️">❤️</span>
              <span class="chat-msg__reaction-emoji" data-emoji="🔥">🔥</span>
              <span class="chat-msg__reaction-emoji" data-emoji="😂">😂</span>
              <span class="chat-msg__reaction-emoji" data-emoji="😮">😮</span>
            </div>
          ` : ''}
        </div>
        ${reactionsHtml}
        ${threadsHtml}
      </div>
    `;

    // 1. Bind Quick reactions picker clicks
    msgElement.querySelectorAll('.chat-msg__reaction-emoji').forEach(emojiEl => {
      emojiEl.onclick = (e) => {
        e.stopPropagation();
        const emoji = emojiEl.getAttribute('data-emoji');
        this.toggleMessageReaction(msg, emoji);
      };
    });

    // 2. Bind existing reactions capsules clicks
    msgElement.querySelectorAll('.chat-msg__reaction-capsule').forEach(capsule => {
      capsule.onclick = (e) => {
        e.stopPropagation();
        const emoji = capsule.getAttribute('data-emoji');
        this.toggleMessageReaction(msg, emoji);
      };
    });

    // 3. Bind Reply Thread clicks
    const replyBtn = msgElement.querySelector('.chat-msg__reply-btn');
    if (replyBtn) {
      replyBtn.onclick = (e) => {
        e.stopPropagation();
        this.openThreadDrawer(msg);
      };
    }

    const threadTrigger = msgElement.querySelector('.chat-msg__threads-trigger');
    if (threadTrigger) {
      threadTrigger.onclick = (e) => {
        e.stopPropagation();
        this.openThreadDrawer(msg);
      };
    }

    // Bind Edit Button click event
    const editBtn = msgElement.querySelector('.chat-msg__edit-btn');
    if (editBtn) {
      editBtn.onclick = (e) => {
        e.stopPropagation();
        const bubbleContainer = msgElement.querySelector('.chat-msg__bubble-container');
        const originalBubble = msgElement.querySelector('.chat-msg__bubble');
        const actionBar = msgElement.querySelector('.chat-msg__action-bar');
        
        // Hide original bubble and edit pencil
        originalBubble.style.display = 'none';
        editBtn.style.display = 'none';
        if (actionBar) actionBar.style.display = 'none';
        
        // Render inline edit form
        const editContainer = document.createElement('div');
        editContainer.className = 'chat-msg__edit-form';
        editContainer.innerHTML = `
          <input type="text" class="chat-msg__edit-input" value="${textMsg}" autocomplete="off">
          <div class="chat-msg__edit-actions">
            <button class="chat-msg__action-save">Save</button>
            <button class="chat-msg__action-cancel">Cancel</button>
          </div>
        `;
        
        bubbleContainer.appendChild(editContainer);
        
        const input = editContainer.querySelector('.chat-msg__edit-input');
        input.focus();
        input.select();
        
        const cancelEdit = () => {
          editContainer.remove();
          originalBubble.style.display = 'block';
          editBtn.style.display = '';
          if (actionBar) actionBar.style.display = '';
        };
        
        const saveEdit = async () => {
          const newText = input.value.trim();
          if (!newText) return;
          
          if (newText === textMsg) {
            cancelEdit();
            return;
          }
          
          try {
            // Re-apply original packed metadata & DM prefix
            const finalMessage = this.serializeMessageMeta(parsed.dmPrefix, newText, meta);
            
            // Dispatch PUT request
            await api.updateChatMessage(msg.id, { message: finalMessage });
            editContainer.remove();
          } catch (err) {
            console.error('[CHAT-EDIT-ERROR] Failed to save chat message edit:', err);
            alert(`Failed to save edit: ${err.message || err}`);
            cancelEdit();
          }
        };
        
        editContainer.querySelector('.chat-msg__action-cancel').onclick = cancelEdit;
        editContainer.querySelector('.chat-msg__action-save').onclick = saveEdit;
        
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            saveEdit();
          } else if (e.key === 'Escape') {
            cancelEdit();
          }
        };
      };
    }

    this.messagesContainer.appendChild(msgElement);

    // Bind click events on mentions to open direct messaging
    msgElement.querySelectorAll('.chat-mention').forEach(mentionEl => {
      mentionEl.onclick = (e) => {
        e.stopPropagation();
        const username = mentionEl.getAttribute('data-mention-username');
        if (username && username !== this.myUsername) {
          this.switchChatPartner(username);
        }
      };
    });
  }

  async toggleMessageReaction(msg, emoji) {
    const parsed = this.parseMessageMeta(msg.message);
    const meta = parsed.meta;
    
    if (!meta.reactions[emoji]) {
      meta.reactions[emoji] = [];
    }
    
    const userList = meta.reactions[emoji];
    const idx = userList.indexOf(this.myUsername);
    if (idx !== -1) {
      userList.splice(idx, 1);
    } else {
      userList.push(this.myUsername);
    }
    
    const finalMessage = this.serializeMessageMeta(parsed.dmPrefix, parsed.text, meta);
    
    try {
      await api.updateChatMessage(msg.id, { message: finalMessage });
    } catch (err) {
      console.error('[CHAT-REACTION-ERROR] Failed to toggle reaction:', err);
    }
  }

  openThreadDrawer(msg) {
    this.activeThreadMsg = msg;
    
    const drawer = document.getElementById('threadDrawer');
    const parentContainer = document.getElementById('threadParentMessage');
    const repliesList = document.getElementById('threadRepliesList');
    const replyInput = document.getElementById('threadReplyInput');
    
    if (!drawer || !parentContainer || !repliesList) return;
    
    if (replyInput) replyInput.value = '';
    
    drawer.classList.remove('hidden');
    drawer.classList.add('visible');
    
    parentContainer.innerHTML = '';
    const parentMsgEl = document.createElement('div');
    parentMsgEl.className = 'chat-msg';
    let cleanAvatar = (msg.avatarUrl || '').split('||')[0];
    if (!cleanAvatar || cleanAvatar.trim() === '') {
      cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.username}`;
    }
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';
    const parsed = this.parseMessageMeta(msg.message);
    
    parentMsgEl.innerHTML = `
      <img src="${cleanAvatar}" class="chat-msg__avatar" alt="${msg.username}">
      <div class="chat-msg__content-box" style="width: 100%;">
        <div class="chat-msg__meta">
          <span class="chat-msg__sender">${msg.username}</span>
          <span>${time}</span>
        </div>
        <div class="chat-msg__bubble">${parsed.text}</div>
      </div>
    `;
    parentContainer.appendChild(parentMsgEl);
    
    this.drawThreadReplies();
    if (replyInput) replyInput.focus();
  }

  drawThreadReplies() {
    const repliesList = document.getElementById('threadRepliesList');
    if (!repliesList || !this.activeThreadMsg) return;
    
    repliesList.innerHTML = '';
    const parsed = this.parseMessageMeta(this.activeThreadMsg.message);
    const replies = parsed.meta.replies || [];
    
    if (replies.length === 0) {
      repliesList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 11px; font-style: italic; margin-top: 20px; width: 100%;">
          No replies yet. Start the conversation!
        </div>
      `;
      return;
    }
    
    replies.forEach(reply => {
      const isSelf = reply.username === this.myUsername;
      const time = reply.timestamp ? new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';
      let cleanAvatar = (reply.avatarUrl || '').split('||')[0];
      if (!cleanAvatar || cleanAvatar.trim() === '') {
        cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${reply.username}`;
      }
      
      const replyEl = document.createElement('div');
      replyEl.className = `chat-msg ${isSelf ? 'chat-msg--self' : ''}`;
      replyEl.style.maxWidth = '100%';
      replyEl.innerHTML = `
        <img src="${cleanAvatar}" class="chat-msg__avatar" alt="${reply.username}">
        <div class="chat-msg__content-box">
          <div class="chat-msg__meta">
            <span class="chat-msg__sender">${reply.username}</span>
            <span>${time}</span>
          </div>
          <div class="chat-msg__bubble">${this.formatMessageMentions(reply.message)}</div>
        </div>
      `;
      repliesList.appendChild(replyEl);

      // Bind click events on mentions inside replies
      replyEl.querySelectorAll('.chat-mention').forEach(mentionEl => {
        mentionEl.onclick = (e) => {
          e.stopPropagation();
          const username = mentionEl.getAttribute('data-mention-username');
          if (username && username !== this.myUsername) {
            this.switchChatPartner(username);
          }
        };
      });
    });
    
    repliesList.scrollTop = repliesList.scrollHeight;
  }

  async handleSendThreadReply() {
    const replyInput = document.getElementById('threadReplyInput');
    if (!replyInput || !this.activeThreadMsg) return;
    
    const text = replyInput.value.trim();
    if (!text) return;
    
    replyInput.value = '';
    
    const parsed = this.parseMessageMeta(this.activeThreadMsg.message);
    const meta = parsed.meta;
    
    const newReply = {
      username: this.myUsername,
      avatarUrl: this.myAvatar,
      message: text,
      timestamp: new Date().toISOString()
    };
    
    meta.replies.push(newReply);
    
    const finalMessage = this.serializeMessageMeta(parsed.dmPrefix, parsed.text, meta);
    
    try {
      await api.updateChatMessage(this.activeThreadMsg.id, { message: finalMessage });
    } catch (err) {
      console.error('[CHAT-THREAD-REPLY-ERROR] Failed to send reply:', err);
      alert('Failed to send reply. Please try again.');
    }
  }

  updateActiveUsersList(presence) {
    // Collect active members and cache details locally
    let activeMembers = JSON.parse(localStorage.getItem('cache_users') || '[]');
    
    // Invalidate/Remove account from list immediately if they got pending state or were revoked
    if (presence.username) {
      if (presence.status === 'PENDING_APPROVAL' || presence.action === 'REJECTED') {
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
      
      if (presence.status === 'OFFLINE') {
        // Mark user as OFFLINE but retain them in the cache directory (so they are available in ticket assignee list, etc.)
        const existingIdx = activeMembers.findIndex(m => m.username === presence.username);
        if (existingIdx !== -1) {
          activeMembers[existingIdx].status = 'OFFLINE';
          activeMembers[existingIdx].lastActive = Date.now();
        }
        localStorage.setItem('cache_users', JSON.stringify(activeMembers));
        
        // If we were chatting with this partner and they went offline, return to group room
        if (this.activeChatPartner === presence.username) {
          this.switchChatPartner(null);
        } else {
          this.drawAvatars(activeMembers);
        }
        return;
      }
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
    
    // Horizontal active bar should only draw members that are actively online/away/dnd
    const onlineMembers = activeMembers.filter(user => user.status && user.status !== 'OFFLINE');
    
    onlineMembers.forEach(user => {
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
      let cleanAvatar = (user.avatarUrl || '').split('||')[0];
      if (!cleanAvatar || cleanAvatar.trim() === '') {
        cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
      }
      
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

    this.userCountSpan.textContent = `${onlineMembers.length} active session${onlineMembers.length > 1 ? 's' : ''}`;
  }

  /* =======================================================
     User Tagging & Autocomplete Engine Methods
     ======================================================= */

  formatMessageMentions(text) {
    if (!text) return '';
    return text.replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
      return `<span class="chat-mention" data-mention-username="${username}">@${username}</span>`;
    });
  }

  setupMentionsAutocomplete() {
    this.input.addEventListener('input', (e) => this.handleMentionsInput(e));
    this.input.addEventListener('keydown', (e) => this.handleMentionsKeydown(e));
    
    // Also bind thread reply input
    const replyInput = document.getElementById('threadReplyInput');
    if (replyInput) {
      replyInput.addEventListener('input', (e) => this.handleMentionsInput(e));
      replyInput.addEventListener('keydown', (e) => this.handleMentionsKeydown(e));
    }
    
    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (this.mentionsDropdown && !this.mentionsDropdown.contains(e.target) && e.target !== this.input && e.target !== replyInput) {
        this.destroyMentionsDropdown();
      }
    });
  }

  handleMentionsInput(e) {
    const input = e.target;
    const value = input.value;
    const cursorIdx = input.selectionStart;
    
    // Find the last index of '@' before the cursor
    const lastAtIdx = value.lastIndexOf('@', cursorIdx - 1);
    if (lastAtIdx === -1) {
      this.destroyMentionsDropdown();
      return;
    }
    
    // Check if there is a space or newline between '@' and the cursor
    const textBetween = value.substring(lastAtIdx + 1, cursorIdx);
    if (textBetween.includes(' ') || textBetween.includes('\n')) {
      this.destroyMentionsDropdown();
      return;
    }
    
    // Ensure the character before '@' is a space or start of line
    if (lastAtIdx > 0 && value.charAt(lastAtIdx - 1) !== ' ' && value.charAt(lastAtIdx - 1) !== '\n') {
      this.destroyMentionsDropdown();
      return;
    }
    
    // Mentions search mode active!
    this.mentionSearchStartIdx = lastAtIdx;
    this.mentionSearchQuery = textBetween.toLowerCase();
    
    this.showMentionsDropdown(input);
  }

  handleMentionsKeydown(e) {
    if (!this.mentionsDropdown) return;
    
    const input = e.target;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.mentionsActiveIdx = (this.mentionsActiveIdx + 1) % this.mentionsFilteredUsers.length;
      this.redrawMentionsItems();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.mentionsActiveIdx = (this.mentionsActiveIdx - 1 + this.mentionsFilteredUsers.length) % this.mentionsFilteredUsers.length;
      this.redrawMentionsItems();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (this.mentionsActiveIdx >= 0 && this.mentionsActiveIdx < this.mentionsFilteredUsers.length) {
        this.selectMention(input, this.mentionsFilteredUsers[this.mentionsActiveIdx].username);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.destroyMentionsDropdown();
    }
  }

  showMentionsDropdown(input) {
    const allUsers = JSON.parse(localStorage.getItem('cache_users') || '[]');
    this.mentionsFilteredUsers = allUsers.filter(u => 
      u.username.toLowerCase().startsWith(this.mentionSearchQuery)
    );
    
    if (this.mentionsFilteredUsers.length === 0) {
      this.destroyMentionsDropdown();
      return;
    }
    
    if (!this.mentionsDropdown) {
      this.mentionsDropdown = document.createElement('div');
      this.mentionsDropdown.className = 'mentions-dropdown';
      
      const inputArea = input.closest('.chat-input-area');
      if (inputArea) {
        inputArea.style.position = 'relative';
        inputArea.appendChild(this.mentionsDropdown);
      }
    }
    
    this.mentionsDropdown.innerHTML = '';
    this.mentionsFilteredUsers.forEach((user, idx) => {
      const item = document.createElement('div');
      item.className = `mentions-dropdown__item ${idx === this.mentionsActiveIdx ? 'mentions-dropdown__item--active' : ''}`;
      
      let cleanAvatar = (user.avatarUrl || '').split('||')[0];
      if (!cleanAvatar || cleanAvatar.trim() === '') {
        cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
      }
      const roleText = (user.role || 'DEVELOPER').replace(/_/g, ' ');
      
      item.innerHTML = `
        <img src="${cleanAvatar}" class="mentions-dropdown__avatar" alt="${user.username}">
        <span class="mentions-dropdown__username">@${user.username}</span>
        <span class="mentions-dropdown__role">${roleText}</span>
      `;
      
      item.onclick = (e) => {
        e.stopPropagation();
        this.selectMention(input, user.username);
      };
      
      this.mentionsDropdown.appendChild(item);
    });
    
    if (this.mentionsActiveIdx >= this.mentionsFilteredUsers.length) {
      this.mentionsActiveIdx = 0;
      this.redrawMentionsItems();
    }
  }

  redrawMentionsItems() {
    if (!this.mentionsDropdown) return;
    const items = this.mentionsDropdown.querySelectorAll('.mentions-dropdown__item');
    items.forEach((item, idx) => {
      if (idx === this.mentionsActiveIdx) {
        item.classList.add('mentions-dropdown__item--active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('mentions-dropdown__item--active');
      }
    });
  }

  selectMention(input, username) {
    const value = input.value;
    const prefix = value.substring(0, this.mentionSearchStartIdx);
    const suffix = value.substring(input.selectionStart);
    
    input.value = `${prefix}@${username} ${suffix}`;
    
    const newCursorPos = prefix.length + username.length + 2; // account for '@' and space
    input.setSelectionRange(newCursorPos, newCursorPos);
    
    this.destroyMentionsDropdown();
    input.focus();
  }

  destroyMentionsDropdown() {
    if (this.mentionsDropdown) {
      this.mentionsDropdown.remove();
      this.mentionsDropdown = null;
    }
    this.mentionsActiveIdx = -1;
    this.mentionsFilteredUsers = [];
    this.mentionSearchQuery = '';
    this.mentionSearchStartIdx = -1;
  }
}
