/**
 * AICopilot - Day 13 AI for Development Prompt Sandbox
 * Manages prompt scaffolding, token insertion, and mock AI compilation loops.
 */
export class AICopilot {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    // Explicitly wipe any corrupted key from previous testing sessions to ensure perfect fallback operation
    localStorage.removeItem('gemini_api_key');
    this.promptTemplate = `You are a Senior Scrum Master helping the team draft high-quality user stories.
Analyze the following scope parameters:
- Title: {{TICKET_TITLE}}
- Core Deliverables: {{TICKET_DESC}}
- Workload Priority: {{PRIORITY}}

Generate a standard Agile User Story (As a... I want to... So that...) along with structured Acceptance Criteria.`;
  }

  render() {
    this.container.innerHTML = `
      <div class="chat-panel-header" style="background: none; border: none; padding: 0; margin-bottom: var(--spacing-lg)">
        <h2 class="modal-header__title" style="font-size: var(--font-size-xl)">AI Prompt Engineering Lab & Resources</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm)">Draft optimized AI templates and examine prompt engineering patterns.</p>
      </div>

      <div class="chart-panel-row" style="grid-template-columns: 1fr 1fr">
        <!-- Prompt Construction Sandbox -->
        <div class="chart-card">
          <div class="chart-card__title">Scaffold Agile Prompt Template</div>
          
          <div class="form-group" style="margin-bottom: var(--spacing-md)">
            <label class="form-label">System Guidelines & Context</label>
            <textarea id="copilotTemplateArea" class="form-textarea" style="height: 160px; font-family: var(--font-mono); font-size: 11px; line-height: 1.5; color: var(--accent-cyan)">${this.promptTemplate}</textarea>
          </div>

          <div class="form-group">
            <label class="form-label">Context Variables Injector</label>
            <div class="prompt-variable-panel" style="display: flex; gap: var(--spacing-xs); flex-wrap: wrap">
              <button class="variable-chip" data-token="TICKET_TITLE">Add {{TICKET_TITLE}}</button>
              <button class="variable-chip" data-token="TICKET_DESC">Add {{TICKET_DESC}}</button>
              <button class="variable-chip" data-token="PRIORITY">Add {{PRIORITY}}</button>
            </div>
          </div>

          <div class="copilot-form-row">
            <div class="form-group">
              <label class="form-label" for="mockTaskSelect">Select Seed Card</label>
              <select id="mockTaskSelect" class="form-select">
                <option value="">-- Choose active card --</option>
                <!-- Populated via script -->
              </select>
            </div>
            <button id="copilotCompileBtn" class="btn btn--submit">Generate Story</button>
          </div>
        </div>

        <!-- AI Output & Compilation Logs -->
        <div class="chart-card">
          <div class="chart-card__title">Compiled Context Output (System Scaffolds)</div>
          <div class="copilot-response-container" style="position: relative; min-height: 320px">
            <div id="copilotResponseText" class="copilot-response copilot-response--empty" style="white-space: pre-wrap; font-size: 12px; line-height: 1.6">
              Configure parameters and compile prompts to examine context distributions.
            </div>
            <div class="typing-indicator hidden" id="copilotLoader" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); border: none; display: flex; flex-direction: column; align-items: center; gap: var(--spacing-sm)">
              <div style="display: flex; gap: 4px">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </div>
              <span style="font-size: 11px; color: var(--accent-purple)">Gemini is compiling context & generating Scrum story...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.populateSeedCards();
  }

  bindEvents() {
    const textArea = this.container.querySelector('#copilotTemplateArea');
    const compileBtn = this.container.querySelector('#copilotCompileBtn');
    const responseBox = this.container.querySelector('#copilotResponseText');
    const loader = this.container.querySelector('#copilotLoader');
    const seedSelect = this.container.querySelector('#mockTaskSelect');

    // Token buttons injection handler
    this.container.querySelectorAll('.variable-chip').forEach(btn => {
      btn.onclick = () => {
        const token = btn.getAttribute('data-token');
        const pos = textArea.selectionStart;
        const text = textArea.value;
        textArea.value = text.substring(0, pos) + `{{${token}}}` + text.substring(pos);
        textArea.focus();
      };
    });

    // Compile & Generate Action
    compileBtn.onclick = async () => {
      const selectedId = seedSelect.value;
      let title = "N/A";
      let desc = "N/A";
      let priority = "N/A";

      if (selectedId) {
        // Read tasks from DB fallback or memory
        const tasks = JSON.parse(localStorage.getItem('cache_tasks') || '[]');
        const task = tasks.find(t => t.id === parseInt(selectedId));
        if (task) {
          title = task.title;
          desc = task.description || 'No deliverable details supplied';
          priority = task.priority;
        }
      }

      // Read template and substitute local values
      let template = textArea.value;
      const compiledPrompt = template
        .replace(/{{TICKET_TITLE}}/g, title)
        .replace(/{{TICKET_DESC}}/g, desc)
        .replace(/{{PRIORITY}}/g, priority);

      // Transition visual loader
      responseBox.classList.add('hidden');
      loader.classList.remove('hidden');

      // Wiped to prevent public key leaks - please populate VITE_GEMINI_API_KEY inside your local untracked environment
      const keyParts = ['', '', ''];
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
      let resultText = '';

      if (apiKey) {
        // ACTUAL GOOGLE GEMINI LIVE GENERATION!
        try {
          console.log('[AI-API] Requesting real-time generation from Gemini 2.5 Flash...');
          const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: compiledPrompt
                }]
              }]
            })
          });

          if (!response.ok) {
            throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
          }

          const resData = await response.json();
          resultText = resData.candidates[0].content.parts[0].text;
          
          // Format raw markdown response to clean html lines
          resultText = resultText
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono)">$1</code>')
            .replace(/\n/g, '<br>');

          console.log('[AI-API] Real-time story generated successfully.');
        } catch (err) {
          console.error('[AI-API-FAILURE] Gemini API failed:', err);
          resultText = `<span style="color: var(--accent-rose)">⚠️ **Failed to connect to Google Gemini API!** ${err.message}</span><br><br><i>Falling back to premium local template generation below:</i><br><br>` + this.getLocalFallbackStory(title, priority);
        }
      } else {
        // Local simulation delay for UI responsiveness
        await new Promise(resolve => setTimeout(resolve, 1200));
        resultText = this.getLocalFallbackStory(title, priority);
      }

      loader.classList.add('hidden');
      responseBox.classList.remove('hidden');
      responseBox.classList.remove('copilot-response--empty');

      responseBox.innerHTML = resultText;
    };
  }

  getLocalFallbackStory(title, priority) {
    return `
<span class="prompt-editor__system" style="color: var(--accent-purple); font-weight: 700">=== LOCAL SCRUM CO-PILOT GENERATOR ===</span><br>
<b>As a</b> developer reviewer,<br>
<b>I want to</b> align agile deliverable tickets for "<b>${title}</b>",<br>
<b>So that</b> we establish automated presence tracking and maintain SLA velocity expectations.<br><br>

<b>Acceptance Criteria:</b><br>
- <b>GIVEN</b> ticket "<b>${title}</b>" exists with priority <b>${priority}</b><br>
- <b>WHEN</b> Agile boards register a column transition event<br>
- <b>THEN</b> broadcast active user notifications to all operations channels instantly.
    `;
  }

  populateSeedCards() {
    const seedSelect = this.container.querySelector('#mockTaskSelect');
    if (!seedSelect) return;

    // Populate from db database tasks first, fallback to cached
    const tasks = JSON.parse(localStorage.getItem('cache_tasks') || '[]');
    seedSelect.innerHTML = `<option value="">-- Choose active card --</option>`;
    tasks.forEach(task => {
      const opt = document.createElement('option');
      opt.value = task.id;
      opt.textContent = `#${task.id}: ${task.title}`;
      seedSelect.appendChild(opt);
    });
  }
}
