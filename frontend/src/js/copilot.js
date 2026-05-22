/**
 * AICopilot - Day 13 AI for Development Prompt Sandbox
 * Manages prompt scaffolding, token insertion, and mock AI compilation loops.
 */
export class AICopilot {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
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
            <div class="prompt-variable-panel">
              <button class="variable-chip" data-token="TICKET_TITLE">Add {{TICKET_TITLE}}</button>
              <button class="variable-chip" data-token="TICKET_DESC">Add {{TICKET_DESC}}</button>
              <button class="variable-chip" data-token="PRIORITY">Add {{PRIORITY}}</button>
            </div>
          </div>

          <div class="form-row-2" style="margin-top: var(--spacing-lg)">
            <div class="form-group">
              <label class="form-label" for="mockTaskSelect">Select Seed Card</label>
              <select id="mockTaskSelect" class="form-select">
                <option value="">-- Choose active card --</option>
                <!-- Populated via script -->
              </select>
            </div>
            <button id="copilotCompileBtn" class="btn btn--submit" style="align-self: flex-end; height: 38px">Compile & Scramble</button>
          </div>
        </div>

        <!-- AI Output & Compilation Logs -->
        <div class="chart-card">
          <div class="chart-card__title">Compiled Context Output (System Scaffolds)</div>
          <div class="copilot-response-container">
            <div id="copilotResponseText" class="copilot-response copilot-response--empty">
              Configure parameters and compile prompts to examine context distributions.
            </div>
            <div class="typing-indicator hidden" id="copilotLoader" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); border: none">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span style="margin-left: var(--spacing-sm)">AI compiling context...</span>
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

    // Compile button click logic - Day 11 Async promises
    compileBtn.onclick = async () => {
      const selectedId = seedSelect.value;
      let title = "N/A";
      let desc = "N/A";
      let priority = "N/A";

      if (selectedId) {
        const tasks = JSON.parse(localStorage.getItem('cache_tasks') || '[]');
        const task = tasks.find(t => t.id === parseInt(selectedId));
        if (task) {
          title = task.title;
          desc = task.description || 'No description supplied';
          priority = task.priority;
        }
      }

      // Read current editor template
      let template = textArea.value;
      const compiledPrompt = template
        .replace(/{{TICKET_TITLE}}/g, title)
        .replace(/{{TICKET_DESC}}/g, desc)
        .replace(/{{PRIORITY}}/g, priority);

      // Visual async compilation simulation
      responseBox.classList.add('hidden');
      loader.classList.remove('hidden');

      // Async/Await promise delay - Day 11
      await new Promise(resolve => setTimeout(resolve, 1500));

      loader.classList.add('hidden');
      responseBox.classList.remove('hidden');
      responseBox.classList.remove('copilot-response--empty');

      responseBox.innerHTML = `
<span class="prompt-editor__system">=== COMPILED SCRUM CONTEXT ===</span>
${compiledPrompt}

<span class="prompt-editor__system">=== GENERATED SCRUM USER STORY ===</span>
<b>As a</b> developer reviewer,
<b>I want to</b> align agile deliverable tickets for "${title}",
<b>So that</b> we establish automated presence tracking and maintain SLA velocity expectations.

<b>Acceptance Criteria:</b>
- GIVEN ticket "${title}" exists with priority ${priority}
- WHEN Agile boards register a column transition event
- THEN broadcast active user notifications to all operations channels instantly.
      `;
    };
  }

  populateSeedCards() {
    const seedSelect = this.container.querySelector('#mockTaskSelect');
    if (!seedSelect) return;

    const tasks = JSON.parse(localStorage.getItem('cache_tasks') || '[]');
    tasks.forEach(task => {
      const opt = document.createElement('option');
      opt.value = task.id;
      opt.textContent = `#${task.id}: ${task.title}`;
      seedSelect.appendChild(opt);
    });
  }
}
