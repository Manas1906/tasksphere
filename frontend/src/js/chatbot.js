/**
 * AIChatbot - Premium Floating AI Copilot Chat Assistant
 * Seamlessly interfaces with Google Gemini API (v1 gemini-2.5-flash) over Port 443
 * Equipped with full offline/degraded mock Agile Coach fallback system.
 */
export class AIChatbot {
  constructor() {
    this.isOpen = false;
    this.apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
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
    toggle.innerHTML = `<span class="chatbot-toggle__icon">🤖</span>`;
    document.body.appendChild(toggle);

    // 2. Create chat window modal
    const windowDiv = document.createElement('div');
    windowDiv.id = 'chatbotWindow';
    windowDiv.className = 'chatbot-window';
    windowDiv.innerHTML = `
      <div class="chatbot-header">
        <h4 class="chatbot-header__title">
          <span>🔮</span>
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
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
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
    
    // Read the key dynamically in case it got populated
    const activeKey = import.meta.env.VITE_GEMINI_API_KEY || this.apiKey;

    if (activeKey) {
      try {
        console.log('[AI-BOT] Querying Google Gemini stable v1 API (gemini-2.5-flash)...');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${activeKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are an expert Scrum Master assistant in the TaskSphere Agile tool. Respond concisely (under 3 sentences) to the following request:\n${text}`
              }]
            }]
          })
        });

        if (!response.ok) {
          throw new Error(`API Status ${response.status}`);
        }

        const resData = await response.json();
        reply = resData.candidates[0].content.parts[0].text;
      } catch (err) {
        console.error('[AI-BOT-FAILURE] Live Gemini chatbot query failed:', err);
        reply = `⚠️ **[API Error: ${err.message}]**\n\n*Agile Coach Local Fallback*:\n` + this.getLocalAgileReply(text);
      }
    } else {
      // Local simulated response delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      reply = `🤖 *[Offline Mode]*\n` + this.getLocalAgileReply(text);
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
}
