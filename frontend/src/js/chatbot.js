import { api } from './api';

/**
 * AIChatbot - Premium Floating AI Copilot Chat Assistant
 * Seamlessly interfaces with the secure Spring Boot backend proxy for Gemini AI.
 * Equipped with full offline/degraded mock Agile Coach fallback system.
 */
export class AIChatbot {
  constructor() {
    this.isOpen = false;
    this.messages = [
      { sender: 'ai', text: 'Hi! I am your TaskSphere Agile Assistant. How can I help you optimize your Scrum flow today?' }
    ];
  }

  init() {
    this.createElements();
    this.bindEvents();
    this.renderMessages();
  }

  createElements() {
    // 1. Create floating toggle button
    const toggle = document.createElement('div');
    toggle.id = 'chatbotToggle';
    toggle.className = 'chatbot-toggle';
    toggle.setAttribute('title', 'Consult AI Scrum Assistant');
    toggle.innerHTML = `<span class="chatbot-toggle__icon" style="display: flex; align-items: center; justify-content: center;">${this.getIconSvg('bot')}</span>`;
    document.body.appendChild(toggle);

    // 2. Create chat window modal
    const windowDiv = document.createElement('div');
    windowDiv.id = 'chatbotWindow';
    windowDiv.className = 'chatbot-window';
    windowDiv.innerHTML = `
      <div class="chatbot-header" style="display: flex; align-items: center;">
        <h4 class="chatbot-header__title" style="display: inline-flex; align-items: center; gap: 6px;">
          ${this.getIconSvg('predictive')}
          <span>Scrum AI Co-Pilot</span>
        </h4>
        <button id="chatbotClose" class="chatbot-header__close">&times;</button>
      </div>
      <div class="chatbot-messages" id="chatbotMessages"></div>
      <div class="chatbot-input-area">
        <input type="text" id="chatbotInput" class="chatbot-input" placeholder="Ask about agile, tickets, user stories..." autocomplete="off">
        <button id="chatbotSend" class="chatbot-send" title="Send Message">
          <svg style="width: 14px; height: 14px; fill: #fff" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    `;
    document.body.appendChild(windowDiv);

    this.toggleBtn = toggle;
    this.windowEl = windowDiv;
    this.messagesContainer = windowDiv.querySelector('#chatbotMessages');
    this.inputField = windowDiv.querySelector('#chatbotInput');
    this.sendBtn = windowDiv.querySelector('#chatbotSend');
    this.closeBtn = windowDiv.querySelector('#chatbotClose');
  }

  bindEvents() {
    // Open/Close toggle
    this.toggleBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleWindow();
    };

    this.closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleWindow(false);
    };

    // Close when clicking outside chat window
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.windowEl.contains(e.target) && !this.toggleBtn.contains(e.target)) {
        this.toggleWindow(false);
      }
    });

    // Send handlers
    this.sendBtn.onclick = () => this.handleSendMessage();
    
    this.inputField.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.handleSendMessage();
      }
    };
  }

  toggleWindow(forceState = null) {
    this.isOpen = forceState !== null ? forceState : !this.isOpen;
    if (this.isOpen) {
      this.windowEl.classList.add('visible');
      this.inputField.focus();
    } else {
      this.windowEl.classList.remove('visible');
    }
  }

  renderMessages() {
    this.messagesContainer.innerHTML = '';
    this.messages.forEach(msg => {
      const bubble = document.createElement('div');
      bubble.className = `chatbot-bubble chatbot-bubble--${msg.sender}`;
      bubble.innerHTML = msg.text.replace(/\n/g, '<br>');
      this.messagesContainer.appendChild(bubble);
    });
    this.scrollToBottom();
  }

  scrollToBottom() {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }
    }, 50);
  }

  async handleSendMessage() {
    const text = this.inputField.value.trim();
    if (!text) return;

    // Clear input
    this.inputField.value = '';

    // Add user message
    this.messages.push({ sender: 'user', text });
    this.renderMessages();

    // Show AI loading bubble
    const loadingBubble = document.createElement('div');
    loadingBubble.id = 'chatbotLoading';
    loadingBubble.className = 'chatbot-bubble chatbot-bubble--loading';
    loadingBubble.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;
    this.messagesContainer.appendChild(loadingBubble);
    this.scrollToBottom();

    // Fetch response
    let reply = '';
    
    try {
      console.log('[AI-BOT] Querying secure Spring Boot AI proxy...');
      const res = await api.request('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text })
      });
      
      if (res && res.reply) {
        reply = res.reply;
      } else if (res && res.error) {
        throw new Error(res.error);
      } else {
        throw new Error('Malformed or empty reply from AI proxy');
      }
    } catch (err) {
      console.error('[AI-BOT-FAILURE] Live secure chatbot query failed, falling back:', err);
      reply = `**[API Error: ${err.message}]**\n\n*Agile Coach Local Fallback*:\n` + this.getLocalAgileReply(text);
    }

    // Remove loader
    const loader = this.messagesContainer.querySelector('#chatbotLoading');
    if (loader) loader.remove();

    // Save & render reply
    this.messages.push({ sender: 'ai', text: reply });
    this.renderMessages();
  }

  getLocalAgileReply(query) {
    const q = query.toLowerCase();
    if (q.includes('story') || q.includes('ticket')) {
      return 'When drafting a Scrum Ticket, focus on providing a clear GIVEN-WHEN-THEN acceptance criteria and estimate the effort using Fibonacci Story Points!';
    }
    if (q.includes('points') || q.includes('estimation') || q.includes('fibonacci')) {
      return 'Fibonacci story points (1, 2, 3, 5, 8, 13) represent relative complexity and uncertainty, rather than absolute hours. Use planning poker to align estimations!';
    }
    if (q.includes('scrum') || q.includes('agile') || q.includes('sprint')) {
      return 'Scrum is built on transparency, inspection, and adaptation. Ensure your sprints have a single, focused Sprint Goal to align team velocity!';
    }
    if (q.includes('hello') || q.includes('hi') || q.includes('hey')) {
      return 'Hello! I am your Agile Scrum Assistant. Ask me anything about sprints, velocity charts, or story point estimations!';
    }
    return 'That is a great question! For high agile velocity, ensure that dependencies are resolved early and you follow clean Scrum definition-of-done criteria.';
  }

  getIconSvg(name) {
    const icons = {
      'bot': `<svg viewBox="0 0 24 24" style="width: 28px; height: 28px; fill: none; stroke: url(#botGradient); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; display: block; filter: drop-shadow(0 0 3px rgba(0, 240, 255, 0.3));"><defs><linearGradient id="botGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--accent-cyan)" /><stop offset="100%" stop-color="var(--accent-purple)" /></linearGradient></defs><path d="M12 5V2m-3 0h6" stroke="url(#botGradient)" stroke-width="2" /><rect x="3" y="5" width="18" height="15" rx="5" fill="var(--bg-secondary)" fill-opacity="0.65" stroke="url(#botGradient)" stroke-width="2" /><rect x="1" y="10" width="2" height="5" rx="1" fill="url(#botGradient)" stroke="none" /><rect x="21" y="10" width="2" height="5" rx="1" fill="url(#botGradient)" stroke="none" /><circle cx="8" cy="11" r="1.5" fill="var(--accent-cyan)" stroke="none" /><circle cx="16" cy="11" r="1.5" fill="var(--accent-cyan)" stroke="none" /><circle cx="6" cy="14.5" r="1.2" fill="var(--accent-rose)" stroke="none" /><circle cx="18" cy="14.5" r="1.2" fill="var(--accent-rose)" stroke="none" /><path d="M10 15c1 1.5 3 1.5 4 0" stroke="url(#botGradient)" stroke-width="2" /></svg>`,
      'predictive': `<svg style="width: 14px; height: 14px; fill: var(--accent-purple); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`
    };
    return icons[name] || '';
  }
}
