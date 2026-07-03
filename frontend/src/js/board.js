import { api } from './api';
import { socket } from './websocket';

const LABEL_PRESETS = [
  { key: 'bug',      color: '#f43f5e', text: '#fff' },
  { key: 'feature',  color: '#6366f1', text: '#fff' },
  { key: 'ux',       color: '#ec4899', text: '#fff' },
  { key: 'backend',  color: '#0ea5e9', text: '#fff' },
  { key: 'frontend', color: '#10b981', text: '#fff' },
  { key: 'hotfix',   color: '#f97316', text: '#fff' },
  { key: 'docs',     color: '#a78bfa', text: '#fff' },
  { key: 'test',     color: '#fbbf24', text: '#000' },
];

/**
 * BoardView - Agile Scrum Kanban Board Controller
 * Manages ticket layouts, drag-and-drop, WebSocket syncs, and card inspector dialogs.
 */
export class BoardView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.tasks = [];
    this.draggedCard = null;
    this.filterQuery = '';
    this.filterPriority = '';
    this.filterAssignee = '';
    this.sprints = [];
    this.activeSprint = null;
    this.filterLabel = '';
  }

  async render() {
    this.container.innerHTML = `
      <div class="chat-panel-header" style="background: none; border: none; padding: 0; margin-bottom: var(--spacing-sm)">
        <h2 class="modal-header__title" style="font-size: var(--font-size-xl)">Scrum Kanban Board</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm)">Drag and drop tickets to update deliverable statuses in real-time.</p>
      </div>

      <!-- Board Toolbar -->
      <div class="board-toolbar" style="display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;margin-bottom:12px;align-items:center;padding-bottom:4px;">
        <input id="boardSearchInput" type="text" placeholder="🔍 Search..." 
          style="width:160px;flex-shrink:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:5px 10px;font-size:12px;color:var(--text-primary);outline:none;"/>
        <select id="boardPriorityFilter" 
          style="width:130px;flex-shrink:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:5px 8px;font-size:12px;color:var(--text-primary);">
          <option value="">All Priorities</option>
          <option value="URGENT">URGENT</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select id="boardAssigneeFilter"
          style="width:130px;flex-shrink:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:5px 8px;font-size:12px;color:var(--text-primary);">
          <option value="">All Assignees</option>
        </select>
        <select id="boardSprintFilter"
          style="width:130px;flex-shrink:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:5px 8px;font-size:12px;color:var(--text-primary);">
          <option value="">All Sprints</option>
        </select>
        <select id="boardLabelFilter"
          style="width:120px;flex-shrink:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:5px 8px;font-size:12px;color:var(--text-primary);">
          <option value="">All Labels</option>
          ${LABEL_PRESETS.map(l => `<option value="${l.key}">${l.key}</option>`).join('')}
        </select>
        <button id="boardCsvExportBtn" class="btn btn--ghost" style="flex-shrink:0;font-size:12px;padding:5px 10px;white-space:nowrap;">⬇ CSV</button>
        <button id="boardSaveViewBtn" class="btn btn--ghost" style="flex-shrink:0;font-size:12px;padding:5px 10px;white-space:nowrap;">💾 Save View</button>
        <button id="boardSprintManagerBtn" class="btn btn--ghost" style="flex-shrink:0;font-size:12px;padding:5px 10px;white-space:nowrap;">🏃 Sprints</button>
      </div>
      <!-- Saved Views row -->
      <div id="savedViewsRow" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;min-height:0;"></div>

      <!-- Kanban Lanes - Day 5 Grid & Flexbox -->
      <div class="kanban-board" id="kanbanBoard">
        <!-- Lane: TODO -->
        <section class="kanban-column kanban-column--todo" data-status="TODO">
          <div class="kanban-column-header">
            <h3 class="kanban-column-header__title">
              <span class="kanban-column-header__indicator"></span> Backlog
            </h3>
            <span class="kanban-column-header__count" id="count-TODO">0</span>
          </div>
          <button class="kanban-column-add-btn" data-add-status="TODO">+ Add New Task</button>
          <div class="kanban-cards" id="lane-TODO"></div>
        </section>

        <!-- Lane: IN PROGRESS -->
        <section class="kanban-column kanban-column--progress" data-status="IN_PROGRESS">
          <div class="kanban-column-header">
            <h3 class="kanban-column-header__title">
              <span class="kanban-column-header__indicator"></span> Work In Progress
            </h3>
            <span class="kanban-column-header__count" id="count-IN_PROGRESS">0</span>
          </div>
          <button class="kanban-column-add-btn" data-add-status="IN_PROGRESS">+ Add New Task</button>
          <div class="kanban-cards" id="lane-IN_PROGRESS"></div>
        </section>

        <!-- Lane: REVIEW -->
        <section class="kanban-column kanban-column--review" data-status="REVIEW">
          <div class="kanban-column-header">
            <h3 class="kanban-column-header__title">
              <span class="kanban-column-header__indicator"></span> Quality Assurance
            </h3>
            <span class="kanban-column-header__count" id="count-REVIEW">0</span>
          </div>
          <button class="kanban-column-add-btn" data-add-status="REVIEW">+ Add New Task</button>
          <div class="kanban-cards" id="lane-REVIEW"></div>
        </section>

        <!-- Lane: DONE -->
        <section class="kanban-column kanban-column--done" data-status="DONE">
          <div class="kanban-column-header">
            <h3 class="kanban-column-header__title">
              <span class="kanban-column-header__indicator"></span> Closed Scope
            </h3>
            <span class="kanban-column-header__count" id="count-DONE">0</span>
          </div>
          <button class="kanban-column-add-btn" data-add-status="DONE">+ Add New Task</button>
          <div class="kanban-cards" id="lane-DONE"></div>
        </section>
      </div>

      <!-- Sprint Manager Panel (hidden by default) -->
      <div id="sprintManagerPanel" style="display:none;margin-top:20px;"></div>
    `;

    await this.loadBoardData();
    this.setupDragAndDrop();
    this.bindAddButtons();
    this.handleRedirectHighlight();
    this.bindToolbar();
    this.loadSprintData();
  }

  bindToolbar() {
    const searchInput = document.getElementById('boardSearchInput');
    const priorityFilter = document.getElementById('boardPriorityFilter');
    const assigneeFilter = document.getElementById('boardAssigneeFilter');
    const sprintFilter = document.getElementById('boardSprintFilter');
    const labelFilter = document.getElementById('boardLabelFilter');
    const csvBtn = document.getElementById('boardCsvExportBtn');
    const saveViewBtn = document.getElementById('boardSaveViewBtn');
    const sprintManagerBtn = document.getElementById('boardSprintManagerBtn');

    // Populate assignee filter from cache
    const members = JSON.parse(localStorage.getItem('cache_users') || '[]');
    if (assigneeFilter) {
      members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.username;
        opt.textContent = m.username;
        assigneeFilter.appendChild(opt);
      });
    }

    if (searchInput) searchInput.addEventListener('input', () => { this.filterQuery = searchInput.value.toLowerCase(); this.distributeTasks(); });
    if (priorityFilter) priorityFilter.addEventListener('change', () => { this.filterPriority = priorityFilter.value; this.distributeTasks(); });
    if (assigneeFilter) assigneeFilter.addEventListener('change', () => { this.filterAssignee = assigneeFilter.value; this.distributeTasks(); });
    if (sprintFilter) sprintFilter.addEventListener('change', () => { this.filterSprintId = sprintFilter.value ? parseInt(sprintFilter.value) : null; this.distributeTasks(); });
    if (labelFilter) labelFilter.addEventListener('change', () => { this.filterLabel = labelFilter.value; this.distributeTasks(); });
    if (csvBtn) csvBtn.addEventListener('click', () => api.exportTasksCsv());
    if (sprintManagerBtn) sprintManagerBtn.addEventListener('click', () => this.toggleSprintManager());

    // Saved Views
    this.renderSavedViews();
    if (saveViewBtn) {
      saveViewBtn.addEventListener('click', () => {
        const name = prompt('Name this view (e.g. "My High Priority"):');
        if (!name || !name.trim()) return;
        const views = JSON.parse(localStorage.getItem('board_saved_views') || '[]');
        views.push({
          name: name.trim(),
          filterQuery: this.filterQuery,
          filterPriority: this.filterPriority,
          filterAssignee: this.filterAssignee,
          filterSprintId: this.filterSprintId,
          filterLabel: this.filterLabel
        });
        localStorage.setItem('board_saved_views', JSON.stringify(views));
        this.renderSavedViews();
      });
    }
  }

  renderSavedViews() {
    const row = document.getElementById('savedViewsRow');
    if (!row) return;
    const views = JSON.parse(localStorage.getItem('board_saved_views') || '[]');
    row.innerHTML = '';
    views.forEach((v, idx) => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:20px;padding:3px 10px;font-size:11px;cursor:pointer;';
      chip.innerHTML = `<span>🔖 ${window.escapeHTML ? window.escapeHTML(v.name) : v.name}</span><button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;padding:0;line-height:1;" title="Delete">×</button>`;
      chip.querySelector('span').onclick = () => {
        this.filterQuery   = v.filterQuery   || '';
        this.filterPriority = v.filterPriority || '';
        this.filterAssignee = v.filterAssignee || '';
        this.filterSprintId = v.filterSprintId || null;
        this.filterLabel   = v.filterLabel   || '';
        const si = document.getElementById('boardSearchInput');   if (si) si.value = this.filterQuery;
        const pi = document.getElementById('boardPriorityFilter'); if (pi) pi.value = this.filterPriority;
        const ai = document.getElementById('boardAssigneeFilter'); if (ai) ai.value = this.filterAssignee;
        const li = document.getElementById('boardLabelFilter');    if (li) li.value = this.filterLabel;
        this.distributeTasks();
      };
      chip.querySelector('button').onclick = (e) => {
        e.stopPropagation();
        const updated = JSON.parse(localStorage.getItem('board_saved_views') || '[]').filter((_, i) => i !== idx);
        localStorage.setItem('board_saved_views', JSON.stringify(updated));
        this.renderSavedViews();
      };
      row.appendChild(chip);
    });
  }

  async loadSprintData() {
    try {
      this.sprints = await api.getSprints() || [];
      // Populate sprint filter dropdown
      const sprintFilter = document.getElementById('boardSprintFilter');
      if (sprintFilter) {
        this.sprints.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.status})`;
          sprintFilter.appendChild(opt);
        });
      }
    } catch (e) {
      // Sprints not critical
    }
  }

  toggleSprintManager() {
    const panel = document.getElementById('sprintManagerPanel');
    if (!panel) return;
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      this.renderSprintManager(panel);
    } else {
      panel.style.display = 'none';
    }
  }

  renderSprintManager(panel) {
    const sprintListHtml = this.sprints.map(s => `
      <div class="sprint-item" data-sprint-id="${s.id}" style="
        display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px;
        background:var(--bg-secondary);border-radius:var(--radius-sm);border:1px solid var(--border-color);">
        <div style="flex:1;">
          <strong style="font-size:13px;">${window.escapeHTML ? window.escapeHTML(s.name) : s.name}</strong>
          <span style="margin-left:8px;font-size:11px;padding:2px 6px;border-radius:9px;background:var(--bg-primary);color:var(--text-muted);">${s.status}</span>
          ${s.goal ? `<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0 0;">${window.escapeHTML ? window.escapeHTML(s.goal) : s.goal}</p>` : ''}
        </div>
        <div style="display:flex;gap:6px;">
          ${s.status !== 'ACTIVE' ? `<button class="btn btn--ghost sprint-activate-btn" data-id="${s.id}" style="font-size:11px;padding:4px 8px;">▶ Activate</button>` : '<span style="color:var(--accent-cyan);font-size:11px;font-weight:bold;">● Active</span>'}
          ${s.status !== 'COMPLETED' ? `<button class="btn btn--ghost sprint-complete-btn" data-id="${s.id}" style="font-size:11px;padding:4px 8px;">✓ Complete</button>` : ''}
          <button class="btn btn--ghost sprint-delete-btn" data-id="${s.id}" style="font-size:11px;padding:4px 8px;color:var(--accent-rose);">✕</button>
        </div>
      </div>
    `).join('');

    panel.innerHTML = `
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:var(--font-size-md);margin:0;">Sprint Manager</h3>
          <button id="createSprintBtn" class="btn btn--primary" style="font-size:12px;padding:6px 12px;">+ New Sprint</button>
        </div>
        <div id="sprintList">${sprintListHtml || '<p style="color:var(--text-muted);font-size:13px;">No sprints yet. Create your first sprint!</p>'}</div>
        <div id="createSprintForm" style="display:none;margin-top:12px;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm);">
          <div style="display:flex;flex-direction:column;gap:8px;">
            <input id="newSprintName" class="form-input" placeholder="Sprint name (e.g. Sprint 1)" style="padding:7px 10px;font-size:13px;"/>
            <input id="newSprintGoal" class="form-input" placeholder="Sprint goal (optional)" style="padding:7px 10px;font-size:13px;"/>
            <div style="display:flex;gap:8px;">
              <input id="newSprintStart" type="date" class="form-input" style="flex:1;padding:7px 10px;font-size:13px;"/>
              <input id="newSprintEnd" type="date" class="form-input" style="flex:1;padding:7px 10px;font-size:13px;"/>
            </div>
            <div style="display:flex;gap:8px;">
              <button id="saveSprintBtn" class="btn btn--primary" style="font-size:12px;padding:6px 12px;">Save Sprint</button>
              <button id="cancelSprintBtn" class="btn btn--ghost" style="font-size:12px;padding:6px 12px;">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind buttons
    panel.querySelector('#createSprintBtn').onclick = () => {
      panel.querySelector('#createSprintForm').style.display = 'block';
    };
    panel.querySelector('#cancelSprintBtn').onclick = () => {
      panel.querySelector('#createSprintForm').style.display = 'none';
    };
    panel.querySelector('#saveSprintBtn').onclick = async () => {
      const name = panel.querySelector('#newSprintName').value.trim();
      if (!name) return alert('Sprint name is required.');
      const goal = panel.querySelector('#newSprintGoal').value.trim();
      const startDate = panel.querySelector('#newSprintStart').value || null;
      const endDate = panel.querySelector('#newSprintEnd').value || null;
      const actor = localStorage.getItem('chat_username') || 'system';
      try {
        await api.createSprint({ name, goal, startDate, endDate, createdBy: actor, status: 'PLANNING' });
        this.sprints = await api.getSprints() || [];
        this.renderSprintManager(panel);
      } catch (e) {
        alert('Failed to create sprint: ' + e.message);
      }
    };

    panel.querySelectorAll('.sprint-activate-btn').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api.updateSprintStatus(parseInt(btn.dataset.id), 'ACTIVE');
          this.sprints = await api.getSprints() || [];
          this.renderSprintManager(panel);
        } catch (e) { alert('Failed to activate sprint.'); }
      };
    });

    panel.querySelectorAll('.sprint-complete-btn').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api.updateSprintStatus(parseInt(btn.dataset.id), 'COMPLETED');
          this.sprints = await api.getSprints() || [];
          this.renderSprintManager(panel);
        } catch (e) { alert('Failed to complete sprint.'); }
      };
    });

    panel.querySelectorAll('.sprint-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this sprint?')) return;
        try {
          await api.deleteSprint(parseInt(btn.dataset.id));
          this.sprints = await api.getSprints() || [];
          this.renderSprintManager(panel);
        } catch (e) { alert('Failed to delete sprint.'); }
      };
    });
  }

  bindAddButtons() {
    this.container.querySelectorAll('.kanban-column-add-btn').forEach(btn => {
      btn.onclick = () => {
        const targetStatus = btn.getAttribute('data-add-status');
        
        // Open the Scrum ticket creator modal
        const modal = document.getElementById('ticketModal');
        const form = document.getElementById('ticketForm');
        if (modal && form) {
          form.reset();
          modal.querySelector('.modal-header__title').textContent = 'Create Scrum Ticket';
          
          // Pre-select status
          modal.setAttribute('data-target-status', targetStatus);
          
          // Populate assignee dropdown options
          const assigneeSelect = form.querySelector('#ticketAssignee');
          assigneeSelect.innerHTML = `<option value="">Unassigned</option>`;
          
          const members = JSON.parse(localStorage.getItem('cache_users') || '[]');
          members.forEach(member => {
            const opt = document.createElement('option');
            opt.value = member.id;
            opt.textContent = `${member.username} (${member.role})`;
            assigneeSelect.appendChild(opt);
          });
          
          form.querySelector('#checklistBuilderList').innerHTML = '';
          
          modal.classList.add('modal-overlay--active');
        }
      };
    });
  }

  handleRedirectHighlight() {
    const redirectFilter = localStorage.getItem('board_filter_redirect');
    if (redirectFilter) {
      localStorage.removeItem('board_filter_redirect');
      
      // Delay slightly to ensure browser has rendered DOM
      setTimeout(() => {
        let targetCol = null;
        if (redirectFilter === 'ALL') {
          // Glow all lanes for CTO showcase!
          document.querySelectorAll('.kanban-column').forEach(c => c.classList.add('kanban-column--highlight-glow'));
          setTimeout(() => {
            document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('kanban-column--highlight-glow'));
          }, 3000);
          return;
        } else if (redirectFilter === 'IN_PROGRESS') {
          targetCol = document.querySelector('.kanban-column--progress');
        } else if (redirectFilter === 'COMPLETED') {
          targetCol = document.querySelector('.kanban-column--done');
        } else if (redirectFilter === 'OVERDUE') {
          // Highlight overdue tasks inside the lanes!
          document.querySelectorAll('.task-card--overdue').forEach(card => {
            card.style.outline = '3px solid var(--accent-rose)';
            card.style.boxShadow = '0 0 20px rgba(244, 63, 94, 0.4)';
            setTimeout(() => {
              card.style.outline = '';
              card.style.boxShadow = '';
            }, 3000);
          });
          targetCol = document.querySelector('.kanban-column--review');
        }
        
        if (targetCol) {
          targetCol.classList.add('kanban-column--highlight-glow');
          setTimeout(() => {
            targetCol.classList.remove('kanban-column--highlight-glow');
          }, 3000);
        }
      }, 100);
    }
  }

  async loadBoardData() {
    try {
      this.tasks = (await api.getTasks()) || [];
    } catch (e) {
      this.tasks = [];
      console.error('[BOARD] Failed to load tasks:', e);
    }
    this.distributeTasks();
  }

  /**
   * Day 1 & Day 10 - Semantic HTML Elements & Dynamic DOM Tree manipulation
   */
  distributeTasks() {
    if (!this.tasks) this.tasks = [];
    // Clear all lanes
    const lanes = {
      TODO: document.getElementById('lane-TODO'),
      IN_PROGRESS: document.getElementById('lane-IN_PROGRESS'),
      REVIEW: document.getElementById('lane-REVIEW'),
      DONE: document.getElementById('lane-DONE')
    };

    const counts = { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 };
    Object.values(lanes).forEach(l => { if (l) l.innerHTML = ''; });

    const todayStr = new Date().toISOString().split('T')[0];

    // Build sprint task ID set if sprint filter active
    let sprintTaskIds = null;
    if (this.filterSprintId) {
      const activeSprint = this.sprints.find(s => s.id === this.filterSprintId);
      sprintTaskIds = activeSprint ? new Set(activeSprint.taskIds || []) : new Set();
    }

    // Map and inject task elements
    this.tasks.forEach(task => {
      // Apply filters
      if (this.filterQuery && !task.title.toLowerCase().includes(this.filterQuery) &&
          !(task.description && task.description.toLowerCase().includes(this.filterQuery))) return;
      if (this.filterPriority && task.priority !== this.filterPriority) return;
      if (this.filterAssignee && (!task.assignee || task.assignee.username !== this.filterAssignee)) return;
      if (sprintTaskIds && !sprintTaskIds.has(task.id)) return;
      if (this.filterLabel && !(task.labels && task.labels.split(',').map(s => s.trim()).includes(this.filterLabel))) return;

      const lane = lanes[task.status];
      if (!lane) return;

      counts[task.status]++;

      // Day 1 & Day 12 Curriculum - Custom data attributes and object instantiation
      const card = document.createElement('article');
      card.className = 'task-card';
      card.setAttribute('draggable', 'true');
      card.setAttribute('data-task-id', task.id);
      
      // Determine modifiers
      const isOverdue = task.dueDate && task.dueDate < todayStr && task.status !== 'DONE';
      if (isOverdue) card.classList.add('task-card--overdue');
      if (task.priority === 'URGENT') card.classList.add('task-card--urgent');

      const assigneeAvatar = task.assignee 
        ? `<img src="${task.assignee.avatarUrl}" class="task-card__assignee-avatar" title="${task.assignee.username}">` 
        : '';

      const checklistSize = task.checklist ? task.checklist.length : 0;
      const completedChecklist = task.checklist ? task.checklist.filter(c => c.completed).length : 0;
      const checklistStr = checklistSize > 0 
        ? `<span class="task-card__metric-item" style="display: inline-flex; align-items: center;"><svg style="width: 12px; height: 12px; fill: currentColor; margin-right: 3px;" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>${completedChecklist}/${checklistSize}</span>` 
        : '';

      const safeTitle = window.escapeHTML ? window.escapeHTML(task.title) : task.title;
      const safeDescription = window.escapeHTML ? window.escapeHTML(task.description) : task.description;
      const recurringBadge = task.recurringType && task.recurringType !== 'NONE'
        ? `<span style="font-size:10px;background:var(--bg-primary);color:var(--accent-cyan);border-radius:4px;padding:1px 5px;margin-left:4px;" title="Recurring ${task.recurringType}">↻ ${task.recurringType}</span>`
        : '';

      const labelKeys = task.labels ? task.labels.split(',').map(s => s.trim()).filter(Boolean) : [];
      const labelsHtml = labelKeys.length > 0
        ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px;">${labelKeys.map(k => {
            const preset = LABEL_PRESETS.find(p => p.key === k);
            const bg = preset ? preset.color : '#475569';
            const col = preset ? preset.text : '#fff';
            return `<span style="font-size:10px;background:${bg};color:${col};border-radius:3px;padding:1px 5px;">${k}</span>`;
          }).join('')}</div>`
        : '';
      
      card.innerHTML = `
        <!-- Figma specs inspector element - Day 6 -->
        <span class="design-spec-badge">.task-card w:100% r:8px p:16px shadow:0_8px_32px</span>
        
        <div class="task-card__header">
          <span class="task-card__priority-badge task-card__priority-badge--${task.priority.toLowerCase()}">${task.priority}</span>
          <span style="font-size: 10px; font-weight: bold; color: var(--text-muted)">#${task.id}${recurringBadge}</span>
        </div>
        ${labelsHtml}
        <h4 class="task-card__title">${safeTitle}</h4>
        <p class="task-card__description">${safeDescription || 'No description supplied.'}</p>
        <div class="task-card__footer">
          <div class="task-card__metrics">
            <span class="task-card__metric-item" style="display: inline-flex; align-items: center;"><svg style="width: 12px; height: 12px; fill: var(--accent-cyan); margin-right: 3px;" viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>${task.storyPoints} SP</span>
            ${checklistStr}
          </div>
          ${assigneeAvatar}
        </div>
      `;

      // Bind card click event for editing/inspecting
      card.addEventListener('click', (e) => {
        // Prevent click if dragging
        if (e.target.closest('.task-card__assignee-avatar')) return;
        this.openTicketInspector(task);
      });

      // Bind Drag events
      card.addEventListener('dragstart', (e) => {
        this.draggedCard = card;
        card.style.opacity = '0.5';
        e.dataTransfer.setData('text/plain', task.id);
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
        this.draggedCard = null;
      });

      lane.appendChild(card);
    });

    // Update headers count badges
    Object.entries(counts).forEach(([status, count]) => {
      const badge = document.getElementById(`count-${status}`);
      if (badge) badge.textContent = count;
    });
  }

  /**
   * Day 10 DOM Event Listeners & Drag and Drop API
   */
  setupDragAndDrop() {
    const columns = this.container.querySelectorAll('.kanban-column');
    
    columns.forEach(col => {
      const cardsWrapper = col.querySelector('.kanban-cards');
      const targetStatus = col.getAttribute('data-status');

      col.addEventListener('dragover', (e) => {
        e.preventDefault(); // Required to allow drop action
        if (cardsWrapper) cardsWrapper.classList.add('kanban-cards--drag-over');
      });

      col.addEventListener('dragleave', () => {
        if (cardsWrapper) cardsWrapper.classList.remove('kanban-cards--drag-over');
      });

      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (cardsWrapper) cardsWrapper.classList.remove('kanban-cards--drag-over');

        const taskIdStr = e.dataTransfer.getData('text/plain');
        const taskId = parseInt(taskIdStr);
        
        if (!taskId) return;

        const task = this.tasks.find(t => t.id === taskId);
        if (task && task.status !== targetStatus) {
          const fromStatus = task.status;
          task.status = targetStatus; // Update local state for fast UI sync
          
          // Trigger real-time WebSocket broadcast - Real-time synchronization
          const username = localStorage.getItem('chat_username') || 'CTO Guest';
          const payload = {
            taskId: taskId,
            title: task.title,
            fromStatus: fromStatus,
            toStatus: targetStatus,
            username: username
          };

          const wsSent = socket.send('/app/board.move', payload);
          if (!wsSent) {
            // Fallback to manual Fetch API REST call if socket is offline
            console.log('WS offline. Syncing card move via REST...');
            await api.updateTaskStatus(taskId, targetStatus);
            this.distributeTasks();
          }
        }
      });
    });
  }

  /**
   * Triggers card movements visually when broadcasted from another collaborative client
   */
  syncExternalMove(payload) {
    const task = this.tasks.find(t => t.id === payload.taskId);
    if (task) {
      task.status = payload.toStatus;
      this.distributeTasks();
      
      // Flash a minor visual toast alert
      this.showMoveToast(payload);
    } else {
      // Reload board data if ticket is unknown
      this.loadBoardData();
    }
  }

  showMoveToast(payload) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: var(--spacing-lg);
      left: var(--spacing-lg);
      background: var(--bg-secondary);
      border: 1px solid var(--accent-cyan);
      box-shadow: var(--cyan-glow);
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--radius-sm);
      z-index: 1000;
      font-size: var(--font-size-xs);
      animation: fadeIn 0.3s ease-out;
    `;
    toast.innerHTML = `<span class="text-cyan">${payload.username}</span> moved ticket #${payload.taskId} to <b>${payload.toStatus}</b>`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'fadeIn 0.3s reverse ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /**
   * Day 2 Forms & Lists - Open ticket detailed management inspector
   */
  openTicketInspector(task) {
    const modal = document.getElementById('ticketModal');
    const form = document.getElementById('ticketForm');
    if (!modal || !form) return;

    // Adjust title and fill in form fields
    modal.querySelector('.modal-header__title').textContent = `Scrum Card Inspector: #${task.id}`;
    
    form.querySelector('#ticketTitle').value = task.title;
    form.querySelector('#ticketDescription').value = task.description || '';
    form.querySelector('#ticketPriority').value = task.priority;
    form.querySelector('#ticketPoints').value = task.storyPoints;
    form.querySelector('#ticketDueDate').value = task.dueDate || '';
    
    // Recurring type field
    const recurringSelect = form.querySelector('#ticketRecurringType');
    if (recurringSelect) recurringSelect.value = task.recurringType || '';
    
    // Bind assignee list in dropdown options
    const assigneeSelect = form.querySelector('#ticketAssignee');
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>`;
    
    // Read members cache from localStorage or active state
    const members = JSON.parse(localStorage.getItem('cache_users') || '[]');
    members.forEach(member => {
      const opt = document.createElement('option');
      opt.value = member.id;
      opt.textContent = `${member.username} (${member.role})`;
      if (task.assignee && task.assignee.id === member.id) {
        opt.selected = true;
      }
      assigneeSelect.appendChild(opt);
    });

    // Render Checklist builder elements - Day 2 Lists
    const checklistContainer = form.querySelector('#checklistBuilderList');
    checklistContainer.innerHTML = '';
    
    let activeChecklist = [...(task.checklist || [])];

    // --- Label Picker ---
    const activeLabelKeys = new Set(task.labels ? task.labels.split(',').map(s => s.trim()).filter(Boolean) : []);
    const labelPickerContainer = document.createElement('div');
    labelPickerContainer.id = 'labelPickerSection';
    labelPickerContainer.style.cssText = 'margin-bottom:14px;';
    const renderLabelPicker = () => {
      labelPickerContainer.innerHTML = `
        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px;">🏷️ Labels</label>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${LABEL_PRESETS.map(p => {
            const active = activeLabelKeys.has(p.key);
            return `<button type="button" data-label="${p.key}" style="font-size:11px;padding:3px 9px;border-radius:4px;border:2px solid ${p.color};background:${active ? p.color : 'transparent'};color:${active ? p.text : p.color};cursor:pointer;transition:all .15s;">${p.key}</button>`;
          }).join('')}
        </div>`;
      labelPickerContainer.querySelectorAll('[data-label]').forEach(btn => {
        btn.onclick = () => {
          const k = btn.dataset.label;
          if (activeLabelKeys.has(k)) activeLabelKeys.delete(k); else activeLabelKeys.add(k);
          renderLabelPicker();
        };
      });
    };
    renderLabelPicker();
    const checklistContainer = form.querySelector('#checklistBuilderList');
    checklistContainer.closest('div') && checklistContainer.parentElement.insertBefore(labelPickerContainer, checklistContainer.parentElement.firstChild);

    let activeChecklist = [...(task.checklist || [])];

    const renderChecklistUI = () => {
      checklistContainer.innerHTML = '';
      activeChecklist.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'checklist-builder-item checklist-builder-item--active';
        row.setAttribute('draggable', 'true');
        row.setAttribute('data-idx', idx);
        row.innerHTML = `
          <label class="form-checkbox-row" style="margin: 0; display: flex; align-items: center; gap: 8px; width: 100%;">
            <input type="checkbox" ${item.completed ? 'checked' : ''} data-item-idx="${idx}">
            <span class="form-checkbox-custom"></span>
            <span style="font-size: 13px; flex: 1; ${item.completed ? 'text-decoration: line-through; color: var(--text-muted)' : ''}">${item.content}</span>
          </label>
          <button type="button" class="checklist-builder-item__delete" data-item-idx="${idx}" style="background: none; border: none; font-size: 18px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
        `;
        
        row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
          activeChecklist[idx].completed = e.target.checked;
          renderChecklistUI();
        });

        row.querySelector('.checklist-builder-item__delete').addEventListener('click', () => {
          row.classList.add('checklist-builder-item--deleted');
          setTimeout(() => {
            activeChecklist.splice(idx, 1);
            renderChecklistUI();
          }, 380);
        });

        checklistContainer.appendChild(row);
      });
      makeBoardChecklistDragSortable(checklistContainer, activeChecklist, renderChecklistUI);
    };

    renderChecklistUI();

    // Bind checklist input addition
    const addChecklistBtn = form.querySelector('#checklistBuilderAddBtn');
    const checklistInput = form.querySelector('#checklistBuilderInput');
    
    const handleAddChecklist = () => {
      const content = checklistInput.value.trim();
      if (!content) return;
      
      activeChecklist.push({ content: content, completed: false });
      checklistInput.value = '';
      renderChecklistUI();
    };

    if (addChecklistBtn) addChecklistBtn.onclick = handleAddChecklist;
    if (checklistInput) {
      checklistInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddChecklist();
        }
      };
    }

    // AI Subtask Generator Wiring (Inspector context)
    const aiBtn = document.getElementById('aiSubtaskBtn');
    const aiBtnText = document.getElementById('aiSubtaskBtnText');

    if (aiBtn) {
      aiBtn.onclick = async () => {
        const title = form.querySelector('#ticketTitle').value.trim();
        const description = form.querySelector('#ticketDescription').value.trim();

        if (!description) {
          alert('Please enter a description for the Scrum ticket first so the AI can analyze deliverables!');
          return;
        }

        aiBtn.classList.add('btn--ai-loading');
        if (aiBtnText) aiBtnText.textContent = 'Generating...';

        try {
          const subtasks = await queryBoardGeminiForSubtasks(title, description);
          if (subtasks && subtasks.length > 0) {
            // Keep existing checklist items and append new ones sequentially
            let currentItemIdx = 0;
            const typeNextSubtask = () => {
              if (currentItemIdx >= subtasks.length) {
                aiBtn.classList.remove('btn--ai-loading');
                if (aiBtnText) aiBtnText.textContent = 'Auto-Generate Subtasks';
                return;
              }

              const taskText = subtasks[currentItemIdx];
              activeChecklist.push({ content: '', completed: false });
              const newIdx = activeChecklist.length - 1;
              renderChecklistUI();

              const rows = checklistContainer.querySelectorAll('.checklist-builder-item');
              const targetRow = rows[rows.length - 1];
              const textSpan = targetRow.querySelector('label span:last-of-type');

              let charIdx = 0;
              const typeInterval = setInterval(() => {
                if (charIdx >= taskText.length) {
                  clearInterval(typeInterval);
                  activeChecklist[newIdx].content = taskText;
                  currentItemIdx++;
                  setTimeout(typeNextSubtask, 120);
                  return;
                }
                textSpan.textContent += taskText[charIdx];
                charIdx++;
              }, 12);
            };

            typeNextSubtask();
          } else {
            throw new Error('Empty subtask list.');
          }
        } catch (err) {
          console.error('[AI-SUBTASK-FAILURE]', err);
          aiBtn.classList.remove('btn--ai-loading');
          if (aiBtnText) aiBtnText.textContent = 'Auto-Generate Subtasks';
          alert('Failed to generate AI subtasks. Falling back to manual adding.');
        }
      };
    }

    // Toggle Modal active class
    modal.classList.add('modal-overlay--active');

    // Render comments & activity panel for existing tasks
    if (task.id) {
      this.renderCommentsAndActivity(modal, task);
    }

    // Bind Close buttons
    const closeBtn = document.getElementById('closeTicketModal');
    const cancelBtn = document.getElementById('cancelTicketBtn');
    const closeModal = () => modal.classList.remove('modal-overlay--active');
    
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    // Handle form submit (Updates card specs in database)
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      const assigneeId = form.querySelector('#ticketAssignee').value;
      const selectedAssignee = members.find(m => m.id === assigneeId) || null;

      const updatedTask = {
        ...task,
        title: form.querySelector('#ticketTitle').value.trim(),
        description: form.querySelector('#ticketDescription').value.trim(),
        priority: form.querySelector('#ticketPriority').value,
        storyPoints: parseInt(form.querySelector('#ticketPoints').value) || 1,
        dueDate: form.querySelector('#ticketDueDate').value || null,
        recurringType: form.querySelector('#ticketRecurringType') ? (form.querySelector('#ticketRecurringType').value || null) : task.recurringType,
        assignee: selectedAssignee,
        checklist: activeChecklist,
        labels: [...activeLabelKeys].join(',') || null
      };

      await api.updateTask(task.id, updatedTask);
      closeModal();
      await this.render(); // Redraw board with new specs
      
      // If WebSockets are connected, broadcast list update to trigger reload
      socket.send('/app/board.move', {
        taskId: task.id,
        title: updatedTask.title,
        fromStatus: task.status,
        toStatus: task.status,
        username: localStorage.getItem('chat_username') || 'CTO Guest'
      });
    };
  }

  // ========================================================
  // Comments & Activity Log Panel
  // ========================================================

  async renderCommentsAndActivity(modal, task) {
    // Find or create the comments+activity container inside the modal body
    let container = modal.querySelector('#commentsActivityPanel');
    if (!container) {
      const modalBody = modal.querySelector('.modal-body') || modal.querySelector('form') || modal;
      container = document.createElement('div');
      container.id = 'commentsActivityPanel';
      container.style.cssText = 'margin-top:20px;border-top:1px solid var(--border-color);padding-top:16px;';
      modalBody.after ? modalBody.after(container) : modalBody.parentNode.insertBefore(container, modalBody.nextSibling);
    }

    // Fetch comments and activity in parallel
    let comments = [], activity = [];
    try {
      [comments, activity] = await Promise.all([
        api.getTaskComments(task.id).catch(() => []),
        api.getTaskActivity(task.id).catch(() => [])
      ]);
    } catch (e) { /* non-critical */ }

    const myUsername = localStorage.getItem('chat_username') || '';
    const myAvatar = localStorage.getItem('chat_avatar') || '';

    const commentsHtml = (comments || []).map(c => `
      <div class="comment-item" data-comment-id="${c.id}" style="display:flex;gap:8px;margin-bottom:10px;">
        <img src="${c.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${c.author}`}" style="width:28px;height:28px;border-radius:50%;flex-shrink:0;"/>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;">
            <strong style="font-size:12px;">${window.escapeHTML ? window.escapeHTML(c.author) : c.author}</strong>
            <span style="font-size:10px;color:var(--text-muted);">${new Date(c.createdAt).toLocaleString()}</span>
            ${c.author === myUsername ? `<button class="comment-delete-btn" data-cid="${c.id}" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;margin-left:auto;">✕</button>` : ''}
          </div>
          <p style="font-size:12px;margin:3px 0 0 0;color:var(--text-primary);">${window.escapeHTML ? window.escapeHTML(c.content) : c.content}</p>
        </div>
      </div>
    `).join('');

    const activityHtml = (activity || []).slice(0, 8).map(a => `
      <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;">
        <span style="font-size:10px;color:var(--accent-cyan);margin-top:1px;">●</span>
        <div>
          <span style="font-size:11px;color:var(--text-muted);">${window.escapeHTML ? window.escapeHTML(a.detail) : a.detail}</span>
          <span style="font-size:10px;color:var(--text-muted);margin-left:6px;">${new Date(a.createdAt).toLocaleString()}</span>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <!-- Comments -->
        <div style="flex:1;min-width:200px;">
          <h4 style="font-size:13px;margin:0 0 10px 0;color:var(--text-secondary);">💬 Comments (${(comments||[]).length})</h4>
          <div id="commentsList" style="max-height:160px;overflow-y:auto;margin-bottom:10px;">
            ${commentsHtml || '<p style="font-size:12px;color:var(--text-muted);">No comments yet.</p>'}
          </div>
          <div style="position:relative;">
            <div style="display:flex;gap:6px;">
              <input id="newCommentInput" class="form-input" placeholder="Add a comment... (@mention to notify)" style="flex:1;padding:5px 8px;font-size:12px;"/>
              <button id="postCommentBtn" class="btn btn--primary" style="font-size:12px;padding:5px 10px;">Post</button>
            </div>
            <div id="mentionDropdown" style="display:none;position:absolute;bottom:110%;left:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:999;min-width:160px;box-shadow:var(--shadow-md);"></div>
          </div>
        </div>
        <!-- Activity -->
        <div style="flex:1;min-width:200px;">
          <h4 style="font-size:13px;margin:0 0 10px 0;color:var(--text-secondary);">📋 Activity</h4>
          <div style="max-height:180px;overflow-y:auto;">
            ${activityHtml || '<p style="font-size:12px;color:var(--text-muted);">No activity yet.</p>'}
          </div>
        </div>
      </div>
    `;

    // Post comment
    const commentInput = container.querySelector('#newCommentInput');
    const mentionDropdown = container.querySelector('#mentionDropdown');
    const members = JSON.parse(localStorage.getItem('cache_users') || '[]');

    // @mention autocomplete
    commentInput.addEventListener('input', () => {
      const val = commentInput.value;
      const atIdx = val.lastIndexOf('@');
      if (atIdx === -1) { mentionDropdown.style.display = 'none'; return; }
      const query = val.slice(atIdx + 1).toLowerCase();
      const matches = members.filter(m => m.username.toLowerCase().startsWith(query) && m.username !== myUsername);
      if (!matches.length) { mentionDropdown.style.display = 'none'; return; }
      mentionDropdown.innerHTML = matches.slice(0, 6).map(m =>
        `<div data-username="${m.username}" style="padding:6px 10px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;">
          <img src="${m.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${m.username}`}" style="width:20px;height:20px;border-radius:50%;"/>
          @${window.escapeHTML ? window.escapeHTML(m.username) : m.username}
        </div>`).join('');
      mentionDropdown.querySelectorAll('[data-username]').forEach(item => {
        item.onmousedown = (e) => {
          e.preventDefault();
          const before = val.slice(0, atIdx);
          commentInput.value = before + '@' + item.dataset.username + ' ';
          mentionDropdown.style.display = 'none';
          commentInput.focus();
        };
        item.onmouseenter = () => item.style.background = 'var(--bg-primary)';
        item.onmouseleave = () => item.style.background = '';
      });
      mentionDropdown.style.display = 'block';
    });
    commentInput.addEventListener('blur', () => setTimeout(() => { mentionDropdown.style.display = 'none'; }, 150));

    container.querySelector('#postCommentBtn').onclick = async () => {
      const content = commentInput.value.trim();
      if (!content) return;
      try {
        await api.addTaskComment(task.id, myUsername, myAvatar, content);
        commentInput.value = '';
        this.renderCommentsAndActivity(modal, task); // Refresh
      } catch (e) {
        alert('Failed to post comment.');
      }
    };

    // Delete comment buttons
    container.querySelectorAll('.comment-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api.deleteTaskComment(task.id, parseInt(btn.dataset.cid), myUsername);
          this.renderCommentsAndActivity(modal, task);
        } catch (e) { alert('Failed to delete comment.'); }
      };
    });
  }
}

// ========================================================
// Phase 7: AI Copilot & Dynamic Checklist Helper Functions
// ========================================================
async function queryBoardGeminiForSubtasks(title, description) {
  const activeKey = import.meta.env.VITE_GEMINI_API_KEY || '';
  if (activeKey) {
    try {
      console.log('[AI-SUBTASK-BOARD] Contacting Google Gemini stable v1 API (gemini-2.5-flash)...');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert Agile Scrum master. Analyze this Scrum ticket:\nTitle: "${title}"\nDescription: "${description}"\nGenerate a list of 3 to 5 clear, highly actionable, technical developer subtasks. Return ONLY a valid JSON array of strings representing the subtasks, e.g. ["Create DB migration", "Implement REST endpoint", "Write unit tests"]. Do not return any markdown formatting, no explanation, no backticks, just raw JSON.`
            }]
          }]
        })
      });

      if (response.ok) {
        const resData = await response.json();
        let rawText = resData.candidates[0].content.parts[0].text.trim();
        if (rawText.startsWith('```')) {
          rawText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        }
        return JSON.parse(rawText);
      } else {
        throw new Error(`HTTP Error ${response.status}`);
      }
    } catch (err) {
      console.warn('[AI-SUBTASK-BOARD] Gemini API failed, falling back to local simulated coach...', err);
      return getBoardLocalSubtaskFallback(title, description);
    }
  } else {
    // Local fallback with natural delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    return getBoardLocalSubtaskFallback(title, description);
  }
}

function getBoardLocalSubtaskFallback(title, description) {
  const t = (title + ' ' + description).toLowerCase();
  if (t.includes('auth') || t.includes('login') || t.includes('password') || t.includes('security')) {
    return [
      "Configure database security schemas and credentials validation",
      "Implement secure password strength checker controls",
      "Deploy multi-factor authentication (MFA via OTP) email triggers",
      "Write unit tests verifying login persistence sessions"
    ];
  }
  if (t.includes('database') || t.includes('db') || t.includes('sql') || t.includes('table')) {
    return [
      "Write Liquibase/Flyway database schema migration scripts",
      "Optimize repository connection pools and index parameters",
      "Implement atomic transaction service wrapper logic",
      "Verify query response latency under load exceptions"
    ];
  }
  if (t.includes('dock') || t.includes('compose') || t.includes('contain') || t.includes('devops')) {
    return [
      "Optimize multi-stage Docker build files for deployment compression",
      "Configure network reverse proxy proxying rules in Nginx gateway",
      "Set container memory heap controls and GC logging",
      "Verify microservices build coordination under Docker Compose"
    ];
  }
  if (t.includes('chart') || t.includes('dashboard') || t.includes('svg') || t.includes('analyt')) {
    return [
      "Configure SVG viewport dynamic scaling calculations",
      "Aggregate database sprint story point outstanding arrays",
      "Bind absolute-positioned glassmorphic hover event listeners",
      "Verify pixel-perfect UI scaling across mobile browsers"
    ];
  }
  return [
    "Design high-fidelity UI layout wireframes in Figma Inspect Mode",
    "Implement core service backend controller REST endpoints",
    "Bind real-time WebSocket topic dispatch sync alerts",
    "Execute end-to-end user acceptance flow testing parameters"
  ];
}

function makeBoardChecklistDragSortable(container, listArray, renderCallback) {
  const rows = container.querySelectorAll('.checklist-builder-item');
  let draggedIdx = null;

  rows.forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedIdx = parseInt(row.getAttribute('data-idx'));
      row.classList.add('checklist-builder-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('checklist-builder-item--drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('checklist-builder-item--drag-over');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('checklist-builder-item--drag-over');
      const targetIdx = parseInt(row.getAttribute('data-idx'));

      if (draggedIdx !== null && draggedIdx !== targetIdx) {
        const temp = listArray[draggedIdx];
        listArray.splice(draggedIdx, 1);
        listArray.splice(targetIdx, 0, temp);
        renderCallback();
      }
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('checklist-builder-item--dragging');
      draggedIdx = null;
    });
  });
}

