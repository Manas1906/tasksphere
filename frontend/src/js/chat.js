import { socket } from './websocket';
import { api } from './api';
import { VoiceCallController } from './voicecall';

/**
 * ChatController manages operations chat, threads, direct messages,
 * typing indicators, mentions, and WebRTC calling.
 */
export class ChatController {
  constructor() {
    this.messagesContainer = document.getElementById('chatMessages');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSendBtn');
    this.activeUsersContainer = document.getElementById('activeUsersList');
    this.userCountSpan = document.getElementById('activeUserCount');

    // Unified sidebar list (Hub mode)
    this.unifiedListContainer = document.getElementById('chatUnifiedList');
    this.chatSearchQuery = '';
    this.allKnownMembers = []; // cache of all workspace users
    
    this.activeChatPartner = null; // null for Operations Group Chat, otherwise username
    this.historyMessages = [];
    this.unreadDms = {};
    this.activeThreadMsg = null;

    // Group chats state
    this.groups = [];
    this.activeGroupId = null;
    this.unreadGroups = {};
    this.groupsListContainer = document.getElementById('groupsList');
    
    // Group Modals & Controls
    this.createGroupModal = document.getElementById('createGroupModal');
    this.groupSettingsModal = document.getElementById('groupSettingsModal');
    this.createGroupForm = document.getElementById('createGroupForm');
    this.groupSettingsForm = document.getElementById('groupSettingsForm');
    this.closeCreateGroupModal = document.getElementById('closeCreateGroupModal');
    this.closeGroupSettingsModal = document.getElementById('closeGroupSettingsModal');
    this.cancelCreateGroupBtn = document.getElementById('cancelCreateGroupBtn');
    this.cancelGroupSettingsBtn = document.getElementById('cancelGroupSettingsBtn');
    this.groupMembersList = document.getElementById('groupMembersList');
    this.settingsGroupAddMembersList = document.getElementById('settingsGroupAddMembersList');

    this.mentionsDropdown = null;
    this.mentionsActiveIdx = -1;
    this.mentionsFilteredUsers = [];
    this.mentionSearchQuery = '';
    this.mentionSearchStartIdx = -1;

    this.typingIndicatorEl = document.getElementById('typingIndicator');
    this.activeTypers = new Set();
    this.typingTimeout = null;
    this.isCurrentlyTyping = false;
    this.typerTimers = {};

    this.attachBtn = document.getElementById('chatAttachBtn');
    this.fileInput = document.getElementById('chatFileInput');
    this.uploadPreview = document.getElementById('chatUploadPreview');
    this.uploadPreviewName = document.getElementById('chatUploadPreviewName');
    this.uploadCancelBtn = document.getElementById('chatUploadCancelBtn');
    this.selectedFile = null;

    this.voiceCall = new VoiceCallController();
  }


  get myUsername() {
    return localStorage.getItem('chat_username') || 'CTO Guest';
  }

  get myAvatar() {
    return localStorage.getItem('chat_avatar') || 'https://api.dicebear.com/7.x/bottts/svg?seed=Admin';
  }

  init() {
    this.bindEvents();
    this.loadGroups();
    this.loadChatHistory();
    this.loadUserDirectory();
    this.setupMentionsAutocomplete();
  }


  async loadUserDirectory() {
    try {
      const users = await api.getUsers() || [];
      const approvedTeammates = users.filter(u => u.status !== 'PENDING_APPROVAL' && u.username && this.myUsername && u.username.toLowerCase().trim() !== this.myUsername.toLowerCase().trim());
      
      const mappedMembers = approvedTeammates.map(dbUser => {
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
      this.allKnownMembers = mappedMembers;
      this.drawAvatars(mappedMembers);
      this.drawUnifiedList();
    } catch (err) {
      console.warn('Failed to load user directory:', err);
      let cachedMembers = JSON.parse(localStorage.getItem('cache_users') || '[]');
      this.allKnownMembers = cachedMembers;
      this.drawAvatars(cachedMembers);
      this.drawUnifiedList();
    }
  }

  bindEvents() {
    // Attachments actions
    if (this.attachBtn && this.fileInput) {
      this.attachBtn.onclick = () => this.fileInput.click();
      this.fileInput.onchange = () => {
        const file = this.fileInput.files[0];
        if (file) {
          this.selectedFile = file;
          if (this.uploadPreviewName) {
            this.uploadPreviewName.textContent = `📎 Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
          }
          if (this.uploadPreview) {
            this.uploadPreview.classList.remove('hidden');
          }
        }
      };
    }

    if (this.uploadCancelBtn) {
      this.uploadCancelBtn.onclick = () => {
        this.selectedFile = null;
        if (this.fileInput) this.fileInput.value = '';
        if (this.uploadPreview) this.uploadPreview.classList.add('hidden');
      };
    }

    const handleSend = async () => {
      let msgText = this.input.value.trim();
      
      // Exit if empty and no file
      if (!msgText && !this.selectedFile) return;

      this.input.disabled = true;
      this.sendBtn.disabled = true;

      try {
        let attachmentMarkdown = '';
        if (this.selectedFile) {
          if (this.uploadPreviewName) {
            this.uploadPreviewName.textContent = `⚡ Uploading: ${this.selectedFile.name}...`;
          }

          const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(this.selectedFile.name);
          const fileSizeMB = Math.round(this.selectedFile.size / 1048576 * 10) / 10;

          // Hard ceiling: refuse anything > 10MB at the browser level
          if (this.selectedFile.size > 10 * 1024 * 1024) {
            throw new Error(`File too large (${fileSizeMB}MB). Maximum is 10MB.`);
          }

          // --- Tier 1: Try the backend /api/upload endpoint ---
          let uploadSucceeded = false;
          try {
            const formData = new FormData();
            formData.append('file', this.selectedFile);

            const token = localStorage.getItem('tasksphere_jwt');
            const hasValidToken = token && token !== 'null' && token !== 'undefined';

            const controller = new AbortController();
            const uploadTimeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

            const response = await fetch(`${api.baseUrl}/upload`, {
              method: 'POST',
              headers: hasValidToken ? { 'Authorization': `Bearer ${token}` } : {},
              body: formData,
              signal: controller.signal
            });
            clearTimeout(uploadTimeout);

            if (response.ok) {
              const uploadRes = await response.json();
              if (uploadRes.success && uploadRes.fileUrl) {
                // Build absolute URL so images render from any host
                const fileUrl = uploadRes.fileUrl.startsWith('http')
                  ? uploadRes.fileUrl
                  : `${api.baseUrl.replace('/api', '')}${uploadRes.fileUrl}`;
                attachmentMarkdown = isImage
                  ? `![${this.selectedFile.name}](${fileUrl})`
                  : `[📎 ${this.selectedFile.name}](${fileUrl})`;
                uploadSucceeded = true;
              }
            } else {
              console.warn('[CHAT-UPLOAD] Backend returned non-OK status:', response.status, response.statusText);
            }
          } catch (uploadErr) {
            // Network failure or timeout — will fall through to Tier 2
            console.warn('[CHAT-UPLOAD] Backend upload failed, attempting base64 embed:', uploadErr.message);
          }

          // --- Tier 2: Inline base64 data URL fallback ---
          // Cap at 5MB as a fallback for REST upload issues. STOMP is configured for 10MB frames.
          if (!uploadSucceeded) {
            const BASE64_LIMIT = 5 * 1024 * 1024; // 5 MB
            if (this.selectedFile.size > BASE64_LIMIT) {
              throw new Error(
                `File upload failed and file is too large to embed inline (${fileSizeMB}MB > 5MB limit).\n\n` +
                `Please ensure the backend is reachable or use a smaller file.`
              );
            }
            if (this.uploadPreviewName) {
              this.uploadPreviewName.textContent = `⚡ Embedding: ${this.selectedFile.name}...`;
            }
            await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                const dataUrl = e.target.result;
                attachmentMarkdown = isImage
                  ? `![${this.selectedFile.name}](${dataUrl})`
                  : `[📎 ${this.selectedFile.name}](${dataUrl})`;
                resolve();
              };
              reader.onerror = () => reject(new Error('Could not read file from disk.'));
              reader.readAsDataURL(this.selectedFile);
            });
          }

          // Clear attachment fields
          this.selectedFile = null;
          if (this.fileInput) this.fileInput.value = '';
          if (this.uploadPreview) this.uploadPreview.classList.add('hidden');
        }




        let finalMessage = msgText;
        if (attachmentMarkdown) {
          finalMessage = msgText ? `${msgText}\n\n${attachmentMarkdown}` : attachmentMarkdown;
        }

        // Intercept /review command in Operations Group Chat (only if not in a group)
        if (!this.activeChatPartner && !this.activeGroupId && finalMessage.startsWith('/review')) {
          this.handleAICodeReview(finalMessage);
        } else {
          if (this.activeChatPartner) {
            finalMessage = `[DM:${this.activeChatPartner}] ${finalMessage}`;
          }

          const payload = {
            username: this.myUsername,
            avatarUrl: this.myAvatar,
            message: finalMessage,
            groupId: this.activeGroupId
          };

          const sent = socket.send('/app/chat.send', payload);
          if (!sent) {
            console.warn('Socket connection offline, adding to offline cache.');
            this.historyMessages.push({
              ...payload,
              timestamp: new Date().toISOString(),
              offline: true
            });
            this.redrawMessages();
          }
        }

        this.input.value = '';
        this.input.focus();

        if (this.typingTimeout) {
          clearTimeout(this.typingTimeout);
          this.typingTimeout = null;
        }
        if (this.isCurrentlyTyping) {
          this.isCurrentlyTyping = false;
          this.publishTypingStatus(false);
        }

      } catch (err) {
        console.error('[CHAT-SEND-ERROR] Failed to send/upload:', err);
        alert(`Failed to send message: ${err.message || err}`);
        if (this.uploadPreviewName && this.selectedFile) {
          this.uploadPreviewName.textContent = `❌ Upload failed: ${this.selectedFile.name}`;
        }
      } finally {
        this.input.disabled = false;
        this.sendBtn.disabled = false;
      }
    };

    this.sendBtn.onclick = handleSend;
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter') handleSend();
    };

    this.input.addEventListener('input', () => {
      this.handleTypingInput();
    });

    const backLink = document.getElementById('chatModeBackLink');
    if (backLink) {
      backLink.onclick = () => {
        this.switchChatPartner(null);
      };
    }

    // Unified search bar wiring
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.chatSearchQuery = searchInput.value.trim().toLowerCase();
        this.drawUnifiedList();
      });
    }

    const mobileBackBtn = document.getElementById('mobileChatBackBtn');
    if (mobileBackBtn) {
      mobileBackBtn.onclick = () => {
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
          chatPanel.classList.remove('chat-panel--active-chat');
        }
      };
    }

    const chatHeader = document.querySelector('.chat-panel-header');
    if (chatHeader) {
      chatHeader.style.cursor = 'pointer';
      chatHeader.title = 'Switch back to Operations Group Chat';
      chatHeader.onclick = (e) => {
        if (e.target.id !== 'clearChatHistoryBtn' && !e.target.closest('#chatHeaderControls')) {
          this.switchChatPartner(null);
        }
      };
    }

    const closeThreadBtn = document.getElementById('closeThreadBtn');
    if (closeThreadBtn) {
      closeThreadBtn.onclick = () => {
        const drawer = document.getElementById('threadDrawer');
        if (drawer) {
          drawer.classList.replace('visible', 'hidden');
        }
        this.activeThreadMsg = null;
      };
    }

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

    // Group Modals Event Bindings
    if (this.closeCreateGroupModal) {
      this.closeCreateGroupModal.onclick = () => this.createGroupModal.classList.remove('modal-overlay--active');
    }
    if (this.cancelCreateGroupBtn) {
      this.cancelCreateGroupBtn.onclick = () => this.createGroupModal.classList.remove('modal-overlay--active');
    }
    if (this.closeGroupSettingsModal) {
      this.closeGroupSettingsModal.onclick = () => this.groupSettingsModal.classList.remove('modal-overlay--active');
    }
    if (this.cancelGroupSettingsBtn) {
      this.cancelGroupSettingsBtn.onclick = () => this.groupSettingsModal.classList.remove('modal-overlay--active');
    }

    if (this.createGroupForm) {
      this.createGroupForm.onsubmit = async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('groupName');
        const iconInput = document.getElementById('groupIconUrl');
        
        if (!nameInput || !nameInput.value.trim()) return;
        
        const checkedBoxes = this.groupMembersList.querySelectorAll('input[type="checkbox"]:checked');
        const memberUsernames = Array.from(checkedBoxes).map(cb => cb.value);
        
        try {
          const payload = {
            name: nameInput.value.trim(),
            iconUrl: iconInput ? iconInput.value.trim() : '',
            members: memberUsernames
          };
          
          console.log('[GROUP-CREATE] Posting group payload:', payload);
          const newGroup = await api.request('/groups', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          
          if (newGroup && newGroup.id) {
            this.groups.push(newGroup);
            this.subscribeToGroup(newGroup.id);
            this.createGroupModal.classList.remove('modal-overlay--active');
            nameInput.value = '';
            if (iconInput) iconInput.value = '';
            
            // Switch to the newly created group chat immediately!
            this.switchGroup(newGroup.id);
          }
        } catch (err) {
          console.error('[GROUP-CREATE-ERROR] Failed to create group:', err);
          alert(`Failed to create group: ${err.message || err}`);
        }
      };
    }

    if (this.groupSettingsForm) {
      this.groupSettingsForm.onsubmit = async (e) => {
        e.preventDefault();
        const groupId = document.getElementById('settingsGroupId').value;
        const nameInput = document.getElementById('settingsGroupName');
        const iconInput = document.getElementById('settingsGroupIconUrl');
        
        if (!nameInput || !nameInput.value.trim()) return;
        
        const checkedBoxes = this.settingsGroupAddMembersList.querySelectorAll('input[type="checkbox"]:checked:not([disabled])');
        const newMemberUsernames = Array.from(checkedBoxes).map(cb => cb.value);
        
        try {
          const payload = {
            name: nameInput.value.trim(),
            iconUrl: iconInput ? iconInput.value.trim() : '',
            newMembers: newMemberUsernames
          };
          
          console.log('[GROUP-UPDATE] Putting group update payload:', payload);
          const updatedGroup = await api.request(`/groups/${groupId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          
          if (updatedGroup) {
            // Update local group list item
            const idx = this.groups.findIndex(g => g.id === updatedGroup.id);
            if (idx !== -1) {
              this.groups[idx] = updatedGroup;
            }
            this.groupSettingsModal.classList.remove('modal-overlay--active');
            this.switchGroup(updatedGroup.id);
          }
        } catch (err) {
          console.error('[GROUP-UPDATE-ERROR] Failed to update group settings:', err);
          alert(`Failed to update group settings: ${err.message || err}`);
        }
      };
    }
  }


  async loadChatHistory() {
    this.messagesContainer.innerHTML = '';
    try {
      this.historyMessages = await api.request('/chat-messages') || [];
    } catch (e) {
      console.warn('Failed to load chat history, fallback to local storage:', e);
      this.historyMessages = JSON.parse(localStorage.getItem('cache_chat') || '[]');
    }
    this.redrawMessages();
    this.drawUnifiedList(); // refresh DM history contacts
  }

  subscribeChannels() {
    socket.subscribe('/topic/chat', (message) => {
      if (message && message.type === 'CLEAR_DM') {
        if (this.activeChatPartner === message.requester || this.activeChatPartner === message.partner) {
          this.loadChatHistory();
        }
        return;
      }
      
      const existingIdx = this.historyMessages.findIndex(m => m.id === message.id);
      if (existingIdx !== -1) {
        const oldMsg = this.historyMessages[existingIdx];
        const oldParsed = this.parseMessageMeta(oldMsg.message);
        const newParsed = this.parseMessageMeta(message.message);
        
        if (newParsed.meta.replies && oldParsed.meta.replies && newParsed.meta.replies.length > oldParsed.meta.replies.length) {
          const lastReply = newParsed.meta.replies[newParsed.meta.replies.length - 1];
          if (lastReply && lastReply.username !== this.myUsername && window.app) {
            window.app.playNotificationSound();
          }
        }

        this.historyMessages[existingIdx] = message;
        
        if (this.activeThreadMsg && this.activeThreadMsg.id === message.id) {
          this.activeThreadMsg = message;
          this.drawThreadReplies();
        }
      } else {
        this.historyMessages.push(message);
        if (window.app) {
          window.app.playNotificationSound();
        }
      }
      
      const isDm = message.message && message.message.startsWith('[DM:');
      if (isDm) {
        const match = message.message.match(/^\[DM:([^\]]+)\]\s*(.*)$/);
        if (match) {
          const recipient = match[1];
          const sender = message.username;
          
          const recipientLower = recipient ? recipient.toLowerCase().trim() : '';
          const selfLower = this.myUsername ? this.myUsername.toLowerCase().trim() : '';
          const partnerLower = this.activeChatPartner ? this.activeChatPartner.toLowerCase().trim() : '';
          const senderLower = sender ? sender.toLowerCase().trim() : '';
          
          if (recipientLower === selfLower && partnerLower !== senderLower) {
            this.unreadDms[sender] = (this.unreadDms[sender] || 0) + 1;
            this.updateActiveUsersList({ username: '', status: 'ONLINE' });
          }
        }
      }
      
      this.redrawMessages();
    });

    socket.subscribe('/topic/users', (presenceUpdate) => {
      this.updateActiveUsersList(presenceUpdate);
    });

    socket.subscribe('/topic/chat.typing', (payload) => {
      this.handleIncomingTypingStatus(payload);
    });

    // Call signaling: subscribe exclusively to the deterministic topic channel.
    // Using a single channel prevents the ICE-candidate dedup bug where all
    // candidates shared the same key (caller:ice:) and all but the first were dropped.
    const myUser = this.myUsername;
    if (myUser && myUser !== 'CTO Guest') {
      socket.subscribe(`/topic/call/${myUser}`, (payload) => {
        this.voiceCall.handleSignal(payload);
      });
    }

    // Subscribe to all user-joined groups
    this.groups.forEach(group => {
      this.subscribeToGroup(group.id);
    });
  }

  subscribeToGroup(groupId) {
    const topic = `/topic/group.${groupId}`;
    console.log(`[GROUP-WS-SUBSCRIBE] Registering WebSocket listener for group: ${groupId}`);
    socket.subscribe(topic, (message) => {
      this.handleIncomingGroupMessage(message);
    });
  }

  handleIncomingGroupMessage(message) {
    console.log(`[GROUP-WS-MESSAGE-IN] Received message for group ID: ${message.groupId}`, message);
    
    const existingIdx = this.historyMessages.findIndex(m => m.id === message.id);
    if (existingIdx !== -1) {
      this.historyMessages[existingIdx] = message;
      if (this.activeThreadMsg && this.activeThreadMsg.id === message.id) {
        this.activeThreadMsg = message;
        this.drawThreadReplies();
      }
    } else {
      this.historyMessages.push(message);
      if (window.app) {
        window.app.playNotificationSound();
      }
    }

    if (this.activeGroupId === message.groupId) {
      this.redrawMessages();
    } else {
      this.unreadGroups[message.groupId] = (this.unreadGroups[message.groupId] || 0) + 1;
      this.drawGroups();
      this.drawUnifiedList();
    }
  }



  syncMyPresence() {
    const registerPresence = () => {
      socket.send('/app/user.presence', {
        username: this.myUsername,
        avatarUrl: this.myAvatar,
        role: localStorage.getItem('chat_role') || 'DEVELOPER',
        status: 'ONLINE'
      });
    };

    setTimeout(registerPresence, 2000);
    
    setInterval(() => {
      if (socket.connected) {
        registerPresence();
      }
    }, 20000);
  }

  async clearChat(endpoint, confirmMsg) {
    if (!confirm(confirmMsg)) return;
    try {
      console.log(`[CHAT-CLEAR] Sending DELETE request to ${endpoint}...`);
      await api.request(endpoint, { method: 'DELETE' });
      this.historyMessages = [];
      this.redrawMessages();
      alert('Chat history cleared successfully!');
    } catch (err) {
      console.error('[CHAT-CLEAR-ERROR] Failed to clear history:', err);
      alert(`Failed to clear history: ${err.message || err}`);
    }
  }

  switchChatPartner(partner) {
    this.activeChatPartner = partner;
    this.activeGroupId = null;
    
    // Clear unread count when opening a DM session
    if (partner) {
      this.unreadDms[partner] = 0;
    }

    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel) {
      if (partner) {
        chatPanel.classList.add('chat-panel--active-chat');
      } else {
        chatPanel.classList.remove('chat-panel--active-chat');
      }
    }
    
    const backLink = document.getElementById('chatModeBackLink');
    const chatTitle = document.getElementById('chatPanelTitle');
    const controls = document.getElementById('chatHeaderControls');
    
    // Always clear existing call & group buttons to avoid duplicates
    const oldCallBtn = document.getElementById('dmCallBtn');
    if (oldCallBtn) oldCallBtn.remove();
    const oldVideoCallBtn = document.getElementById('dmVideoCallBtn');
    if (oldVideoCallBtn) oldVideoCallBtn.remove();
    const oldGroupSettingsBtn = document.getElementById('groupSettingsBtn');
    if (oldGroupSettingsBtn) oldGroupSettingsBtn.remove();
    const oldLeaveGroupBtn = document.getElementById('leaveGroupBtn');
    if (oldLeaveGroupBtn) oldLeaveGroupBtn.remove();
    
    // Dynamic binding and visibility for clearing history
    const clearHistoryBtn = document.getElementById('clearChatHistoryBtn');
    if (clearHistoryBtn) {
      if (partner) {
        // DM mode: both participants have authority to clear their own DM history
        clearHistoryBtn.style.display = 'block';
        clearHistoryBtn.onclick = (e) => {
          e.stopPropagation();
          this.clearChat(
            `/chat-messages/dm?partner=${encodeURIComponent(partner)}&requester=${encodeURIComponent(this.myUsername)}`,
            `Are you sure you want to permanently delete your DM history with ${partner}?\n\nThis will delete it for both of you in the database.`
          );
        };
      } else {
        // Group mode: only Admins / Product Owners can clear the board history (only if not in a custom group chat)
        const role = localStorage.getItem('chat_role') || 'DEVELOPER';
        if ((role === 'PRODUCT_OWNER' || role === 'MANAGER') && !this.activeGroupId) {
          clearHistoryBtn.style.display = 'block';
          clearHistoryBtn.onclick = (e) => {
            e.stopPropagation();
            this.clearChat(
              '/chat-messages',
              'Are you sure you want to permanently delete the entire chat history from the database?\n\nThis action cannot be undone.'
            );
          };
        } else {
          clearHistoryBtn.style.display = 'none';
          clearHistoryBtn.onclick = null;
        }
      }
    }
    
    if (partner) {
      // Direct message (DM) tab active
      if (backLink) backLink.style.display = 'flex';
      if (chatTitle) {
        chatTitle.innerHTML = `
          <span class="chat-header-title-text">
            <svg class="chat-header-title-icon" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
            </svg>
            <span class="chat-header-title-prefix">Chat with </span>
            <span class="chat-header-title-partner">${partner}</span>
          </span>
        `;
      }
      
      const voiceCallEnabled = window.__featureToggles && window.__featureToggles.voice_calling === true;
      if (voiceCallEnabled && controls) {
        // Find the partner avatar from cache
        const cachedUsers = JSON.parse(localStorage.getItem('cache_users') || '[]');
        const partnerUser = cachedUsers.find(u => u.username === partner);
        let partnerAvatar = partnerUser ? (partnerUser.avatarUrl || '').split('||')[0] : '';
        if (!partnerAvatar) partnerAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${partner}`;
 
        // Create Video Call Button (Purple Accent)
        const videoCallBtn = document.createElement('button');
        videoCallBtn.className = 'dm-call-btn dm-call-btn--video';
        videoCallBtn.id = 'dmVideoCallBtn';
        videoCallBtn.title = `Video call ${partner}`;
        videoCallBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
        videoCallBtn.onclick = (e) => {
          e.stopPropagation();
          this.voiceCall.initiateCall(partner, partnerAvatar, 'VIDEO');
        };
 
        // Create Voice Call Button (Green Accent)
        const callBtn = document.createElement('button');
        callBtn.className = 'dm-call-btn dm-call-btn--voice';
        callBtn.id = 'dmCallBtn';
        callBtn.title = `Voice call ${partner}`;
        callBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>`;
        callBtn.onclick = (e) => {
          e.stopPropagation();
          this.voiceCall.initiateCall(partner, partnerAvatar, 'VOICE');
        };
 
        // Prepend to header controls (video call first, then voice call on the left)
        controls.insertBefore(videoCallBtn, controls.firstChild);
        controls.insertBefore(callBtn, controls.firstChild);
      }
      
      this.input.placeholder = `Send direct message to ${partner}...`;
    } else {
      // Group room active (General)
      if (backLink) backLink.style.display = 'none';
      if (chatTitle) {
        chatTitle.innerHTML = `
          <svg style="width: 16px; height: 16px; fill: var(--accent-cyan)" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
          General
        `;
      }
      this.input.placeholder = `Send team message...`;
    }
 
    // Refresh active members display to update partner selected outline state
    this.updateActiveUsersList({ username: '', status: 'ONLINE' });
 
    // Rerender chat bubbles matching current active channel
    this.redrawMessages();
    this.drawGroups();
    this.drawUnifiedList();
  }


  redrawMessages() {
    this.messagesContainer.innerHTML = '';
    
    const filtered = this.historyMessages.filter(msg => {
      // 1. Filter by group chat if activeGroupId is selected or message belongs to a group
      if (msg.groupId !== undefined && msg.groupId !== null) {
        return this.activeGroupId === msg.groupId;
      }
      if (this.activeGroupId !== null) {
        return false;
      }

      // 2. Otherwise apply DM or general Operations Chat filters
      const isDm = msg.message && msg.message.startsWith('[DM:');
      
      if (this.activeChatPartner === null) {
        // General public Operations Chat: show only non-DM messages
        return !isDm;
      } else {
        // Direct private message tab: show only DM conversation matches
        if (!isDm) return false;
        
        const match = msg.message.match(/^\[DM:([^\]]+)\]\s*(.*)$/);
        if (!match) return false;
        
        const recipient = match[1];
        const sender = msg.username;
        
        const selfLower = this.myUsername ? this.myUsername.toLowerCase().trim() : '';
        const partnerLower = this.activeChatPartner ? this.activeChatPartner.toLowerCase().trim() : '';
        const senderLower = sender ? sender.toLowerCase().trim() : '';
        const recipientLower = recipient ? recipient.toLowerCase().trim() : '';
        
        // Match if (I sent to partner) OR (partner sent to me)
        return (senderLower === selfLower && recipientLower === partnerLower) ||
               (senderLower === partnerLower && recipientLower === selfLower);
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

  formatMessageDate(timestamp) {
    if (!timestamp) return 'now';
    const date = new Date(timestamp);
    const now = new Date();
    
    // Check if same day
    const isSameDay = date.getDate() === now.getDate() &&
                      date.getMonth() === now.getMonth() &&
                      date.getFullYear() === now.getFullYear();
    
    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.getDate() === yesterday.getDate() &&
                        date.getMonth() === yesterday.getMonth() &&
                        date.getFullYear() === yesterday.getFullYear();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isSameDay) {
      return timeStr;
    } else if (isYesterday) {
      return `Yesterday, ${timeStr}`;
    } else {
      // Check if within the last 7 days
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 7) {
        const dayName = date.toLocaleDateString([], { weekday: 'long' });
        return `${dayName}, ${timeStr}`;
      } else {
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        return `${dateStr}, ${timeStr}`;
      }
    }
  }

  renderSingleMessage(msg) {
    if (msg.username === 'System') {
      const sysMsgElement = document.createElement('div');
      sysMsgElement.className = 'chat-msg-system';
      sysMsgElement.setAttribute('data-msg-id', msg.id);
      
      const parsed = this.parseMessageMeta(msg.message);
      sysMsgElement.innerHTML = `
        <div class="chat-msg-system__bubble">${parsed.text}</div>
      `;
      this.messagesContainer.appendChild(sysMsgElement);
      return;
    }

    const isSelf = msg.username && this.myUsername && msg.username.toLowerCase().trim() === this.myUsername.toLowerCase().trim();
    const time = this.formatMessageDate(msg.timestamp);


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
        const hasReacted = users.some(u => u.toLowerCase().trim() === this.myUsername.toLowerCase().trim());
        reactionsHtml += `
          <span class="chat-msg__reaction-capsule ${hasReacted ? 'chat-msg__reaction-capsule--active' : ''}" data-emoji="${emoji}" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px;">
            <span>${this.getEmojiSvg(emoji)}</span>
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
        <div class="chat-msg__threads-trigger" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px;">
          <svg style="width: 12px; height: 12px; fill: var(--accent-purple)" viewBox="0 0 24 24">
            <path d="M4 9h16v2H4zm4 4h8v2H8z"/>
          </svg>
          <span>${count} ${count > 1 ? 'replies' : 'reply'}</span>
        </div>
      `;
    }

    // Check if the message is a call log
    const isCallLog = textMsg.includes('📞') || textMsg.includes('Voice call ended') || textMsg.includes('Video call ended') || textMsg.includes('Missed call') || textMsg.includes('Declined call');
    let callLogClass = '';
    if (isCallLog) {
      if (textMsg.includes('Missed') || textMsg.includes('declined') || textMsg.includes('Declined') || textMsg.includes('busy') || textMsg.includes('Busy')) {
        callLogClass = 'missed';
      } else {
        callLogClass = 'connected';
      }
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
          <div class="chat-msg__bubble ${isCallLog ? 'chat-msg__bubble--call-log ' + callLogClass : ''}">${this.formatMessageMarkdown(textMsg)}</div>
          
          <!-- Hover Action items row -->
          <div class="chat-msg__action-bar">
            ${isSelf && msg.id ? `<button class="chat-msg__edit-btn" title="Edit message" style="position: static; opacity: 1; margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;"><svg style="width: 12px; height: 12px; fill: currentColor" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>` : ''}
            ${msg.id ? `<button class="chat-msg__reply-btn" title="Reply in thread" style="display: inline-flex; align-items: center; justify-content: center;"><svg style="width: 12px; height: 12px; fill: currentColor" viewBox="0 0 24 24"><path d="M4 9h16v2H4zm4 4h8v2H8z"/></svg></button>` : ''}
          </div>

          <!-- Hover springy emojis picker menu -->
          ${msg.id ? `
            <div class="chat-msg__quick-reactions" style="display: flex; align-items: center; gap: 6px; padding: 4px 8px;">
              <span class="chat-msg__reaction-emoji" data-emoji="👍" style="display: inline-flex; align-items: center;">${this.getEmojiSvg('👍')}</span>
              <span class="chat-msg__reaction-emoji" data-emoji="❤️" style="display: inline-flex; align-items: center;">${this.getEmojiSvg('❤️')}</span>
              <span class="chat-msg__reaction-emoji" data-emoji="🔥" style="display: inline-flex; align-items: center;">${this.getEmojiSvg('🔥')}</span>
              <span class="chat-msg__reaction-emoji" data-emoji="😂" style="display: inline-flex; align-items: center;">${this.getEmojiSvg('😂')}</span>
              <span class="chat-msg__reaction-emoji" data-emoji="😮" style="display: inline-flex; align-items: center;">${this.getEmojiSvg('😮')}</span>
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
    const selfLower = this.myUsername ? this.myUsername.toLowerCase().trim() : '';
    const idx = userList.findIndex(u => u.toLowerCase().trim() === selfLower);
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
      const isSelf = reply.username && this.myUsername && reply.username.toLowerCase().trim() === this.myUsername.toLowerCase().trim();
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
          <div class="chat-msg__bubble">${this.formatMessageMarkdown(reply.message)}</div>
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
      const presUsernameLower = presence.username.toLowerCase().trim();
      const partnerLower = this.activeChatPartner ? this.activeChatPartner.toLowerCase().trim() : '';

      if (presence.status === 'PENDING_APPROVAL' || presence.action === 'REJECTED') {
        activeMembers = activeMembers.filter(m => m.username.toLowerCase().trim() !== presUsernameLower);
        localStorage.setItem('cache_users', JSON.stringify(activeMembers));
        
        // If we were chatting with this partner and they disappeared, return to group room
        if (partnerLower === presUsernameLower) {
          this.switchChatPartner(null);
        } else {
          this.drawAvatars(activeMembers);
        }
        return;
      }
      
      if (presence.status === 'OFFLINE') {
        // Mark user as OFFLINE but retain them in the cache directory (so they are available in ticket assignee list, etc.)
        const existingIdx = activeMembers.findIndex(m => m.username.toLowerCase().trim() === presUsernameLower);
        if (existingIdx !== -1) {
          activeMembers[existingIdx].status = 'OFFLINE';
          activeMembers[existingIdx].lastActive = Date.now();
        }
        localStorage.setItem('cache_users', JSON.stringify(activeMembers));
        
        // If we were chatting with this partner and they went offline, return to group room
        if (partnerLower === presUsernameLower) {
          this.switchChatPartner(null);
        } else {
          this.drawAvatars(activeMembers);
        }
        return;
      }
    }

    // Register active user in cache
    if (presence.username && this.myUsername && presence.username.toLowerCase().trim() !== this.myUsername.toLowerCase().trim()) {
      const presUsernameLower = presence.username.toLowerCase().trim();
      const existingIdx = activeMembers.findIndex(m => m.username.toLowerCase().trim() === presUsernameLower);
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
    
    const chatPanel = document.querySelector('.chat-panel');
    const isHubView = chatPanel && chatPanel.classList.contains('chat-panel--hub');
    
    // Sort active members: online members first, then alphabetical
    const sortedMembers = [...activeMembers].sort((a, b) => {
      const aOnline = a.status && a.status !== 'OFFLINE';
      const bOnline = b.status && b.status !== 'OFFLINE';
      if (aOnline && !bOnline) return -1;
      if (!aOnline && bOnline) return 1;
      return a.username.localeCompare(b.username);
    });

    // In horizontal mode, only show online members to fit sidebar. In hub view, show all members!
    const displayMembers = isHubView ? sortedMembers : sortedMembers.filter(user => user.status && user.status !== 'OFFLINE');
    
    displayMembers.forEach(user => {
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'active-user-avatar-wrap';
      if (this.activeChatPartner && user.username && this.activeChatPartner.toLowerCase().trim() === user.username.toLowerCase().trim()) {
        avatarWrap.classList.add('selected');
      }
      avatarWrap.title = `${user.username} (${(user.role || 'DEVELOPER').replace(/_/g, ' ')}) - ${user.status || 'OFFLINE'}`;
      avatarWrap.style.cursor = 'pointer';
      avatarWrap.style.transition = 'all 0.2s ease';

      avatarWrap.onclick = () => {
        const userUsernameLower = user.username.toLowerCase().trim();
        const selfLower = this.myUsername ? this.myUsername.toLowerCase().trim() : '';
        const partnerLower = this.activeChatPartner ? this.activeChatPartner.toLowerCase().trim() : '';
        if (userUsernameLower !== selfLower) {
          if (partnerLower === userUsernameLower) {
            this.switchChatPartner(null);
          } else {
            this.switchChatPartner(user.username);
          }
        }
      };

      const statusClass = (user.status || 'OFFLINE').toLowerCase();
      let cleanAvatar = (user.avatarUrl || '').split('||')[0];
      if (!cleanAvatar || cleanAvatar.trim() === '') {
        cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
      }
      
      const unreadCount = this.unreadDms[user.username] || 0;
      const badgeHtml = unreadCount > 0 
        ? `<span class="active-user-unread-badge">${unreadCount}</span>` 
        : '';
        
      if (isHubView) {
        avatarWrap.innerHTML = `
          <div class="active-user-avatar-container">
            <img src="${cleanAvatar}" class="active-user-avatar" alt="${user.username}">
            <span class="active-user-status-dot active-user-status-dot--${statusClass}"></span>
            ${badgeHtml}
          </div>
          <div class="active-user-details">
            <div class="active-user-username">${user.username}</div>
            <div class="active-user-role">${(user.role || 'DEVELOPER').replace(/_/g, ' ')}</div>
          </div>
        `;
      } else {
        avatarWrap.innerHTML = `
          <img src="${cleanAvatar}" class="active-user-avatar" alt="${user.username}">
          <span class="active-user-status-dot active-user-status-dot--${statusClass}"></span>
          ${badgeHtml}
        `;
      }
      this.activeUsersContainer.appendChild(avatarWrap);
    });

    const onlineCount = activeMembers.filter(user => user.status && user.status !== 'OFFLINE').length;
    this.userCountSpan.textContent = `${onlineCount} online`;

    // Keep the unified list in sync with presence changes
    this.allKnownMembers = activeMembers;
    this.drawUnifiedList();
  }

  /* =======================================================
     User Tagging & Autocomplete Engine Methods
     ======================================================= */

  formatMessageMarkdown(text) {
    if (!text) return '';
    let html = text;
    
    // Escape HTML first to prevent XSS
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Handle images: ![caption](url)
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
      return `<div class="chat-image-wrap"><img class="chat-embedded-image" src="${url}" alt="${alt}" style="max-width: 250px; max-height: 200px; border-radius: 8px; margin-top: 6px; cursor: pointer; display: block; border: 1px solid rgba(255, 255, 255, 0.1);" onclick="window.open('${url}', '_blank')"></div>`;
    });

    // Handle files/links: [label](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      const cleanLabel = label.replace(/^📎\s*/, '');
      const extMatch = cleanLabel.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toUpperCase() : 'FILE';
      
      let fileIcon = '📁';
      let iconColor = '#a855f7';
      if (['PDF'].includes(ext)) { fileIcon = '📄'; iconColor = '#ef4444'; }
      else if (['ZIP', 'RAR', 'TAR', 'GZ'].includes(ext)) { fileIcon = '📦'; iconColor = '#eab308'; }
      else if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(ext)) { fileIcon = '🖼️'; iconColor = '#3b82f6'; }
      else if (['DOC', 'DOCX', 'TXT', 'MD'].includes(ext)) { fileIcon = '📝'; iconColor = '#3b82f6'; }
      else if (['JS', 'TS', 'JAVA', 'PY', 'HTML', 'CSS', 'SQL', 'SH', 'YML', 'YAML', 'JSON', 'XML'].includes(ext)) { fileIcon = '💻'; iconColor = '#10b981'; }

      return `
        <div class="chat-attachment-card">
          <div class="chat-attachment-icon-badge" style="background: ${iconColor}15; color: ${iconColor}">
            <span class="chat-attachment-type-icon">${fileIcon}</span>
            <span class="chat-attachment-ext-label">${ext}</span>
          </div>
          <div class="chat-attachment-info">
            <span class="chat-attachment-name" title="${cleanLabel}">${cleanLabel}</span>
            <span class="chat-attachment-meta">Click to download</span>
          </div>
          <a class="chat-attachment-download-btn" href="${url}" target="_blank" download title="Download ${cleanLabel}">
            <svg viewBox="0 0 24 24">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
          </a>
        </div>
      `;
    });

    // Handle code blocks: ```lang ... ``` or ``` ... ```
    html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```/g, (match, code) => {
      return `<pre class="chat-code-block"><code>${code}</code></pre>`;
    });

    // Handle inline code: `code`
    html = html.replace(/`([^`\n]+)`/g, (match, code) => {
      return `<code class="chat-inline-code">${code}</code>`;
    });

    // Handle bold: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
      return `<strong>${content}</strong>`;
    });

    // Handle headers: ### text or ## text
    html = html.replace(/^(?:###|##|#)\s+(.+)$/gm, (match, content) => {
      return `<h4 class="chat-review-header">${content}</h4>`;
    });

    // Handle bullet points: * text or - text
    html = html.replace(/^[*\-]\s+(.+)$/gm, (match, content) => {
      return `<li class="chat-review-bullet">${content}</li>`;
    });

    // Handle line breaks: \n -> <br> (but not inside <pre> tags)
    const parts = html.split(/(<pre[\s\S]*?<\/pre>)/g);
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i].startsWith('<pre')) {
        parts[i] = parts[i].replace(/\n/g, '<br>');
      }
    }
    html = parts.join('');

    // Format mentions
    html = html.replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
      return `<span class="chat-mention" data-mention-username="${username}">@${username}</span>`;
    });

    return html;
  }

  async handleAICodeReview(msgText) {
    const codeSnippet = msgText.substring(7).trim();
    if (!codeSnippet) {
      alert('Please provide some code to review. Format: /review <code>');
      return;
    }

    const tempId = 'ai-review-' + Date.now();
    const tempMsg = {
      id: tempId,
      username: 'AI Reviewer 🤖',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=AIReviewer',
      message: 'Analyzing your code snippet... Please stand by. ⚡',
      timestamp: new Date().toISOString()
    };

    // Push local notification toast
    if (window.app) {
      window.app.showNotificationToast('🤖 Code Analysis Triggered', 'AI Reviewer is analyzing your code snippet...', 'UPDATE');
    }

    this.historyMessages.push(tempMsg);
    this.redrawMessages();

    const activeKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!activeKey) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.updateLocalAiReview(tempId, `### AI Code Review Report\n\nNo Gemini API Key found in \`VITE_GEMINI_API_KEY\`. Here is a local simulated review:\n\n1. **Complexity**: O(N) linear performance checked.\n2. **Security**: Ensure credentials are not hardcoded.\n3. **Refactoring**: Looks clean, human-written feel is present!`);
      return;
    }

    try {
      console.log('[AI-REVIEWER] Contacting Gemini stable v1 API (gemini-2.5-flash)...');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert Senior Software Engineer and Architect. Perform a strict, highly technical, and concise code review of the following code snippet. Focus on code quality, security vulnerabilities, latency or performance issues, and readability. Do not output conversational preamble; start directly with the critique. Provide clean markdown output with clear headings, bullet points, and code block corrections if applicable:\n\n\`\`\`\n${codeSnippet}\n\`\`\``
            }]
          }]
        })
      });

      if (response.ok) {
        const resData = await response.json();
        const reviewText = resData.candidates[0].content.parts[0].text.trim();
        this.updateLocalAiReview(tempId, reviewText);
      } else {
        throw new Error(`HTTP Error ${response.status}`);
      }
    } catch (err) {
      console.error('[AI-REVIEWER-FAILURE]', err);
      this.updateLocalAiReview(tempId, `❌ **AI Code Review failed**: ${err.message || err}`);
    }
  }

  updateLocalAiReview(tempId, finalReviewText) {
    const msg = this.historyMessages.find(m => m.id === tempId);
    if (msg) {
      msg.message = `🤖 **AI CODE REVIEW REPORT**\n\n${finalReviewText}`;
      this.redrawMessages();
    }
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

  // Typing Indicator Logic - Phase 15
  handleTypingInput() {
    if (!this.isCurrentlyTyping) {
      this.isCurrentlyTyping = true;
      this.publishTypingStatus(true);
    }
    
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    
    this.typingTimeout = setTimeout(() => {
      this.isCurrentlyTyping = false;
      this.publishTypingStatus(false);
      this.typingTimeout = null;
    }, 3000); // 3 seconds idle timeout
  }

  publishTypingStatus(isTyping) {
    if (!socket.connected) return;
    
    const payload = {
      username: this.myUsername,
      typing: isTyping
    };
    
    socket.send('/app/chat.typing', payload);
  }

  handleIncomingTypingStatus(payload) {
    const { username, typing } = payload;
    if (!username || username === this.myUsername) return;

    if (typing) {
      this.activeTypers.add(username);
      
      // Self-healing ghost pruning timer
      if (this.typerTimers[username]) {
        clearTimeout(this.typerTimers[username]);
      }
      
      this.typerTimers[username] = setTimeout(() => {
        this.activeTypers.delete(username);
        delete this.typerTimers[username];
        this.updateTypingIndicatorUI();
      }, 4000); // 4 seconds auto-cleanup
    } else {
      this.activeTypers.delete(username);
      if (this.typerTimers[username]) {
        clearTimeout(this.typerTimers[username]);
        delete this.typerTimers[username];
      }
    }
    
    this.updateTypingIndicatorUI();
  }

  updateTypingIndicatorUI() {
    if (!this.typingIndicatorEl) return;
    
    const typersArray = Array.from(this.activeTypers);
    
    if (typersArray.length === 0) {
      this.typingIndicatorEl.classList.add('hidden');
    } else {
      let text = '';
      if (typersArray.length === 1) {
        text = `${typersArray[0]} is typing...`;
      } else if (typersArray.length === 2) {
        text = `${typersArray[0]} and ${typersArray[1]} are typing...`;
      } else {
        text = 'Multiple people are typing...';
      }
      
      const textSpan = this.typingIndicatorEl.querySelector('span:last-of-type');
      if (textSpan) {
        textSpan.textContent = text;
      }
      this.typingIndicatorEl.classList.remove('hidden');
    }
  }

  // Helper mapping to return literal emojis instead of SVGs
  getEmojiSvg(emoji) {
    return emoji;
  }

  // ============================================================
  // Group Chat System Operations (Slack/Teams Premium Redesign)
  // ============================================================
  async loadGroups() {
    try {
      const groups = await api.request('/groups') || [];
      this.groups = groups;
      console.log('[GROUP-CHAT] Loaded user groups:', groups);
      this.drawGroups();
      this.drawUnifiedList();
      
      // Auto subscribe to all groups on load
      groups.forEach(group => {
        this.subscribeToGroup(group.id);
      });
    } catch (err) {
      console.error('[GROUP-CHAT] Failed to load user groups:', err);
    }
  }

  // =============================================================
  // Unified Sidebar List: channels + DMs in one scrollable pane
  // =============================================================
  drawUnifiedList() {
    const container = this.unifiedListContainer;
    if (!container) return;
    container.innerHTML = '';

    const q = (this.chatSearchQuery || '').toLowerCase().trim();
    const isHubView = (() => {
      const p = document.querySelector('.chat-panel');
      return p && p.classList.contains('chat-panel--hub');
    })();
    if (!isHubView) return;

    // ─── CHANNELS SECTION ───────────────────────────────────────
    const channelLabel = document.createElement('div');
    channelLabel.className = 'chat-list-section-label';
    channelLabel.textContent = 'Channels';
    container.appendChild(channelLabel);

    // Create Group button
    const createBtn = document.createElement('button');
    createBtn.className = 'create-group-btn';
    createBtn.title = 'Create Group Chat';
    createBtn.innerHTML = `<span style="font-size:16px;font-weight:bold;line-height:1;">+</span> <span style="font-size:13px;font-weight:600;">Create Group Chat</span>`;
    createBtn.onclick = (e) => {
      e.stopPropagation();
      this.populateMembersList('groupMembersList');
      if (this.createGroupModal) this.createGroupModal.classList.add('modal-overlay--active');
    };
    container.appendChild(createBtn);

    // General room
    const generalMatch = !q || 'general'.includes(q) || 'all workspace users'.includes(q);
    if (generalMatch) {
      const generalWrap = document.createElement('div');
      generalWrap.className = `group-item-wrap ${
        this.activeGroupId === null && this.activeChatPartner === null ? 'selected' : ''
      }`;
      generalWrap.style.cssText = 'width:100%;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;box-sizing:border-box;';
      generalWrap.title = 'General';
      generalWrap.innerHTML = `
        <div class="group-icon-container">
          <svg style="width:20px;height:20px;fill:var(--accent-cyan)" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
        </div>
        <div class="group-details">
          <div class="group-name">General</div>
          <div class="group-members-count">All workspace users</div>
        </div>`;
      generalWrap.onclick = () => {
        this.switchChatPartner(null);
        const cp = document.querySelector('.chat-panel');
        if (cp) cp.classList.add('chat-panel--active-chat');
      };
      container.appendChild(generalWrap);
    }

    // Custom groups
    const filteredGroups = this.groups.filter(g =>
      !q || g.name.toLowerCase().includes(q)
    );
    filteredGroups.forEach(group => {
      let cleanIcon = group.iconUrl ? group.iconUrl.trim() : '';
      if (!cleanIcon) cleanIcon = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(group.name)}`;
      const unread = this.unreadGroups[group.id] || 0;
      const badge = unread > 0 ? `<span class="active-user-unread-badge" style="top:-6px;right:-6px;">${unread}</span>` : '';

      const wrap = document.createElement('div');
      wrap.className = `group-item-wrap ${this.activeGroupId === group.id ? 'selected' : ''}`;
      wrap.style.cssText = 'width:100%;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;box-sizing:border-box;';
      wrap.title = group.name;
      wrap.innerHTML = `
        <div class="group-icon-container" style="position:relative;">
          <img src="${cleanIcon}" class="group-icon" alt="${group.name}">
          ${badge}
        </div>
        <div class="group-details">
          <div class="group-name">${group.name}</div>
          <div class="group-members-count">Private channel</div>
        </div>`;
      wrap.onclick = () => this.switchGroup(group.id);
      container.appendChild(wrap);
    });

    // ─── DIRECT MESSAGES SECTION ─────────────────────────────────
    const dmLabel = document.createElement('div');
    dmLabel.className = 'chat-list-section-label';
    dmLabel.style.marginTop = '6px';
    dmLabel.textContent = 'Direct Messages';
    container.appendChild(dmLabel);

    const myUserLower = (this.myUsername || '').toLowerCase().trim();

    // Derive users the logged-in user has interacted with via DM history
    const interactedUsernames = new Set();
    (this.historyMessages || []).forEach(msg => {
      if (!msg.message) return;
      const match = msg.message.match(/^\[DM:([^\]]+)\]/);
      if (!match) return;
      const recipient = match[1].toLowerCase().trim();
      const sender = (msg.username || '').toLowerCase().trim();
      if (sender === myUserLower) interactedUsernames.add(recipient);
      else if (recipient === myUserLower) interactedUsernames.add(sender);
    });

    // Decide which members to display
    let displayMembers;
    if (q) {
      // Search mode: show all matching members (except self)
      displayMembers = (this.allKnownMembers || []).filter(u =>
        u.username &&
        u.username.toLowerCase().trim() !== myUserLower &&
        u.username.toLowerCase().includes(q)
      );
    } else {
      // Default: only history contacts
      displayMembers = (this.allKnownMembers || []).filter(u =>
        u.username &&
        interactedUsernames.has(u.username.toLowerCase().trim())
      );
    }

    // Sort online first then alphabetical
    displayMembers.sort((a, b) => {
      const aOn = a.status && a.status !== 'OFFLINE';
      const bOn = b.status && b.status !== 'OFFLINE';
      if (aOn && !bOn) return -1;
      if (!aOn && bOn) return 1;
      return a.username.localeCompare(b.username);
    });

    if (displayMembers.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'chat-list-empty-hint';
      hint.textContent = q ? 'No users found.' : 'Search to start a new conversation.';
      container.appendChild(hint);
    }

    displayMembers.forEach(user => {
      const statusClass = (user.status || 'OFFLINE').toLowerCase();
      let cleanAvatar = (user.avatarUrl || '').split('||')[0];
      if (!cleanAvatar) cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
      const unread = this.unreadDms[user.username] || 0;
      const badge = unread > 0 ? `<span class="active-user-unread-badge">${unread}</span>` : '';

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'active-user-avatar-wrap';
      if (this.activeChatPartner &&
          this.activeChatPartner.toLowerCase().trim() === user.username.toLowerCase().trim()) {
        avatarWrap.classList.add('selected');
      }
      avatarWrap.style.cssText = 'width:100%;display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;box-sizing:border-box;';
      avatarWrap.title = `${user.username} (${(user.role || 'DEVELOPER').replace(/_/g,' ')}) - ${user.status || 'OFFLINE'}`;
      avatarWrap.innerHTML = `
        <div class="active-user-avatar-container">
          <img src="${cleanAvatar}" class="active-user-avatar" alt="${user.username}">
          <span class="active-user-status-dot active-user-status-dot--${statusClass}"></span>
          ${badge}
        </div>
        <div class="active-user-details">
          <div class="active-user-username">${user.username}</div>
          <div class="active-user-role">${(user.role || 'DEVELOPER').replace(/_/g,' ')}</div>
        </div>`;
      avatarWrap.onclick = () => {
        const uLower = user.username.toLowerCase().trim();
        const pLower = this.activeChatPartner ? this.activeChatPartner.toLowerCase().trim() : '';
        if (pLower === uLower) {
          this.switchChatPartner(null);
        } else {
          this.switchChatPartner(user.username);
        }
      };
      container.appendChild(avatarWrap);
    });
  }

  drawGroups() {
    if (!this.groupsListContainer) return;
    this.groupsListContainer.innerHTML = '';

    const chatPanel = document.querySelector('.chat-panel');
    const isHubView = chatPanel && chatPanel.classList.contains('chat-panel--hub');

    // Create Group "+" Button
    const createBtn = document.createElement('button');
    createBtn.className = 'create-group-btn';
    createBtn.title = 'Create Group Chat';
    if (isHubView) {
      createBtn.innerHTML = `<span style="font-size: 16px; font-weight: bold; line-height: 1;">+</span> <span style="font-size: 13px; font-weight: 600;">Create Group Chat</span>`;
      createBtn.style.width = '100%';
      createBtn.style.display = 'flex';
      createBtn.style.alignItems = 'center';
      createBtn.style.gap = '8px';
      createBtn.style.padding = '8px 12px';
      createBtn.style.borderRadius = 'var(--radius-md)';
      createBtn.style.background = 'rgba(255,255,255,0.03)';
      createBtn.style.border = '1px dashed var(--border-color)';
      createBtn.style.color = 'var(--text-muted)';
      createBtn.style.cursor = 'pointer';
    } else {
      createBtn.innerHTML = '+';
      createBtn.removeAttribute('style');
    }
    createBtn.onclick = (e) => {
      e.stopPropagation();
      this.populateMembersList('groupMembersList');
      if (this.createGroupModal) {
        this.createGroupModal.classList.add('modal-overlay--active');
      }
    };
    this.groupsListContainer.appendChild(createBtn);

    // Operations Chat (General Room - fallback)
    const generalWrap = document.createElement('div');
    generalWrap.className = `group-item-wrap ${this.activeGroupId === null && this.activeChatPartner === null ? 'selected' : ''}`;
    generalWrap.title = 'General';
    generalWrap.style.marginRight = isHubView ? '0' : '8px';
    generalWrap.onclick = () => {
      this.switchChatPartner(null);
      const chatPanel = document.querySelector('.chat-panel');
      if (chatPanel) {
        chatPanel.classList.add('chat-panel--active-chat');
      }
    };

    if (isHubView) {
      generalWrap.innerHTML = `
        <div class="group-icon-container">
          <svg style="width: 20px; height: 20px; fill: var(--accent-cyan)" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
        </div>
        <div class="group-details">
          <div class="group-name">General</div>
          <div class="group-members-count">All workspace users</div>
        </div>
      `;
      generalWrap.style.width = '100%';
      generalWrap.style.display = 'flex';
      generalWrap.style.alignItems = 'center';
      generalWrap.style.gap = '10px';
      generalWrap.style.padding = '8px 12px';
      generalWrap.style.borderRadius = 'var(--radius-md)';
      generalWrap.style.cursor = 'pointer';
    } else {
      generalWrap.innerHTML = `
        <svg style="width: 20px; height: 20px; fill: var(--accent-cyan)" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
      `;
      generalWrap.removeAttribute('style');
      generalWrap.style.marginRight = '8px';
    }
    this.groupsListContainer.appendChild(generalWrap);

    // Dynamic User Groups
    this.groups.forEach(group => {
      const wrap = document.createElement('div');
      wrap.className = `group-item-wrap ${this.activeGroupId === group.id ? 'selected' : ''}`;
      wrap.title = group.name;
      
      let cleanIcon = group.iconUrl ? group.iconUrl.trim() : '';
      if (!cleanIcon) {
        cleanIcon = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(group.name)}`;
      }

      wrap.onclick = () => {
        this.switchGroup(group.id);
      };

      const unreadCount = this.unreadGroups[group.id] || 0;
      const badgeHtml = unreadCount > 0 
        ? `<span class="active-user-unread-badge" style="top: -6px; right: -6px;">${unreadCount}</span>` 
        : '';

      if (isHubView) {
        wrap.innerHTML = `
          <div class="group-icon-container" style="position: relative;">
            <img src="${cleanIcon}" class="group-icon" alt="${group.name}">
            ${badgeHtml}
          </div>
          <div class="group-details">
            <div class="group-name">${group.name}</div>
            <div class="group-members-count">Private channel</div>
          </div>
        `;
        wrap.style.width = '100%';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '10px';
        wrap.style.padding = '8px 12px';
        wrap.style.borderRadius = 'var(--radius-md)';
        wrap.style.cursor = 'pointer';
      } else {
        wrap.innerHTML = `
          <img src="${cleanIcon}" class="group-icon" alt="${group.name}">
          ${badgeHtml}
        `;
        wrap.removeAttribute('style');
      }
      
      this.groupsListContainer.appendChild(wrap);
    });
  }

  async switchGroup(groupId) {
    this.activeGroupId = groupId;
    this.activeChatPartner = null;
    this.unreadGroups[groupId] = 0;

    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel) {
      if (groupId) {
        chatPanel.classList.add('chat-panel--active-chat');
      } else {
        chatPanel.classList.remove('chat-panel--active-chat');
      }
    }

    const backLink = document.getElementById('chatModeBackLink');
    const chatTitle = document.getElementById('chatPanelTitle');
    const controls = document.getElementById('chatHeaderControls');
    
    // Always clear existing call & group buttons to avoid duplicates
    const oldCallBtn = document.getElementById('dmCallBtn');
    if (oldCallBtn) oldCallBtn.remove();
    const oldVideoCallBtn = document.getElementById('dmVideoCallBtn');
    if (oldVideoCallBtn) oldVideoCallBtn.remove();
    const oldGroupSettingsBtn = document.getElementById('groupSettingsBtn');
    if (oldGroupSettingsBtn) oldGroupSettingsBtn.remove();
    const oldLeaveGroupBtn = document.getElementById('leaveGroupBtn');
    if (oldLeaveGroupBtn) oldLeaveGroupBtn.remove();
    
    // Hide default clear chat history button inside private groups
    const clearHistoryBtn = document.getElementById('clearChatHistoryBtn');
    if (clearHistoryBtn) {
      clearHistoryBtn.style.display = 'none';
    }

    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;

    if (backLink) backLink.style.display = 'flex';
    if (chatTitle) {
      let cleanIcon = group.iconUrl ? group.iconUrl.trim() : '';
      if (!cleanIcon) {
        cleanIcon = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(group.name)}`;
      }
      chatTitle.innerHTML = `
        <span class="chat-header-title-text" style="color: var(--accent-cyan); display: flex; align-items: center; gap: 8px;">
          <img src="${cleanIcon}" style="width: 20px; height: 20px; border-radius: 4px; object-fit: cover;">
          <span class="chat-header-title-partner">${group.name}</span>
        </span>
      `;
    }

    // Append Group Settings (Cog icon) & Leave Group (logout icon) buttons
    if (controls) {
      // Group Settings Cog Button
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'dm-call-btn dm-call-btn--voice';
      settingsBtn.id = 'groupSettingsBtn';
      settingsBtn.title = 'Group Settings';
      settingsBtn.innerHTML = `
        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: currentColor;">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
        </svg>
      `;
      settingsBtn.onclick = async (e) => {
        e.stopPropagation();
        document.getElementById('settingsGroupId').value = groupId;
        document.getElementById('settingsGroupName').value = group.name;
        document.getElementById('settingsGroupIconUrl').value = group.iconUrl || '';
        
        try {
          const members = await api.request(`/groups/${groupId}/members`) || [];
          this.populateMembersList('settingsGroupAddMembersList', members);
        } catch (err) {
          console.error('[GROUP-MEMBERS-FETCH] Failed to load members:', err);
          this.populateMembersList('settingsGroupAddMembersList', []);
        }

        if (this.groupSettingsModal) {
          this.groupSettingsModal.classList.add('modal-overlay--active');
        }
      };

      // Leave Group Exit Button
      const leaveBtn = document.createElement('button');
      leaveBtn.className = 'dm-call-btn dm-call-btn--video';
      leaveBtn.id = 'leaveGroupBtn';
      leaveBtn.title = 'Leave Group';
      leaveBtn.innerHTML = `
        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: currentColor;">
          <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
        </svg>
      `;
      leaveBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to leave group "${group.name}"?`)) return;
        
        try {
          console.log(`[GROUP-LEAVE] Leaving group ID: ${groupId}...`);
          await api.request(`/groups/${groupId}/leave`, { method: 'POST' });
          socket.unsubscribe(`/topic/group.${groupId}`);
          
          this.groups = this.groups.filter(g => g.id !== groupId);
          this.switchChatPartner(null);
        } catch (err) {
          console.error('[GROUP-LEAVE-ERROR] Failed to leave group:', err);
          alert(`Failed to leave group: ${err.message || err}`);
        }
      };

      controls.insertBefore(leaveBtn, controls.firstChild);
      controls.insertBefore(settingsBtn, controls.firstChild);
    }

    this.input.placeholder = `Send message to ${group.name}...`;

    // Load group messages history
    try {
      console.log(`[GROUP-CHAT-HISTORY] Fetching messages for group: ${groupId}...`);
      const groupMsgs = await api.request(`/groups/${groupId}/messages`) || [];
      
      // Merge group messages into our history
      groupMsgs.forEach(msg => {
        const idx = this.historyMessages.findIndex(m => m.id === msg.id);
        if (idx !== -1) {
          this.historyMessages[idx] = msg;
        } else {
          this.historyMessages.push(msg);
        }
      });

      this.redrawMessages();
    } catch (err) {
      console.error('[GROUP-CHAT-HISTORY-ERROR] Failed to load messages:', err);
    }

    this.drawGroups();
    this.updateActiveUsersList({ username: '', status: 'ONLINE' });
    this.drawUnifiedList();
  }

  populateMembersList(containerId, currentMemberNames = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    
    const cachedUsers = JSON.parse(localStorage.getItem('cache_users') || '[]');
    const otherUsers = cachedUsers.filter(u => u.username !== this.myUsername);
    
    if (otherUsers.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; padding: 4px;">No other members available in workspace.</div>';
      return;
    }
    
    otherUsers.forEach(user => {
      const isAlreadyMember = currentMemberNames.includes(user.username);
      
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '8px';
      div.style.padding = '4px 6px';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = user.username;
      checkbox.id = `${containerId}_user_${user.username}`;
      checkbox.style.accentColor = 'var(--accent-cyan)';
      checkbox.style.cursor = 'pointer';
      
      if (isAlreadyMember) {
        checkbox.checked = true;
        checkbox.disabled = true; // cannot remove from settings
      }
      
      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';
      label.style.cursor = 'pointer';
      label.style.fontSize = '12px';
      label.style.color = '#e4e4e7';
      label.style.userSelect = 'none';
      label.style.flex = '1';
      
      let cleanAvatar = (user.avatarUrl || '').split('||')[0];
      if (!cleanAvatar) {
        cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
      }
      
      label.innerHTML = `
        <img src="${cleanAvatar}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;">
        <span>${user.username} <span style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; background: rgba(255,255,255,0.04); padding: 1px 4px; border-radius: 2px;">${(user.role || 'DEVELOPER').replace(/_/g, ' ')}</span></span>
      `;
      
      div.appendChild(checkbox);
      div.appendChild(label);
      container.appendChild(div);
    });
  }
}

