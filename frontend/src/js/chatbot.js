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
      'bot': `<svg viewBox="0 0 24 24" style="width: 26px; height: 26px; fill: currentColor; display: block;"><defs><mask id="bot-mask"><rect width="24" height="24" fill="white" /><circle cx="8.5" cy="11.5" r="1.5" fill="black" /><circle cx="15.5" cy="11.5" r="1.5" fill="black" /><path d="M9 14.5c1 1.5 3 1.5 4 0" stroke="black" stroke-width="1.8" stroke-linecap="round" fill="none" /></mask></defs><rect x="1" y="10" width="1.8" height="5" rx="0.9" /><rect x="21.2" y="10" width="1.8" height="5" rx="0.9" /><line x1="12" y1="5.5" x2="12" y2="2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><circle cx="12" cy="2" r="1.2" /><path d="M18 5.5H6c-1.9 0-3.5 1.6-3.5 3.5v5c0 1.9 1.6 3.5 3.5 3.5h3.5l3 3 3-3H18c1.9 0 3.5-1.6 3.5-3.5V9c0-1.9-1.6-3.5-3.5-3.5z" mask="url(#bot-mask)" /></svg>`,
      'predictive': `<svg style="width: 14px; height: 14px; fill: var(--accent-purple); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`
    };
    return icons[name] || '';
  }
}
