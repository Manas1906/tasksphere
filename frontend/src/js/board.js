import { api } from './api';
import { socket } from './websocket';

/**
 * BoardView - Agile Scrum Kanban Board Controller
 * Manages ticket layouts, drag-and-drop, WebSocket syncs, and card inspector dialogs.
 */
export class BoardView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.tasks = [];
    this.draggedCard = null;
  }

  async render() {
    this.container.innerHTML = `
      <div class="chat-panel-header" style="background: none; border: none; padding: 0; margin-bottom: var(--spacing-sm)">
        <h2 class="modal-header__title" style="font-size: var(--font-size-xl)">Scrum Kanban Board</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm)">Drag and drop tickets to update deliverable statuses in real-time.</p>
      </div>

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
    `;

    await this.loadBoardData();
    this.setupDragAndDrop();
    this.bindAddButtons();
    this.handleRedirectHighlight();
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
    this.tasks = await api.getTasks();
    this.distributeTasks();
  }

  /**
   * Day 1 & Day 10 - Semantic HTML Elements & Dynamic DOM Tree manipulation
   */
  distributeTasks() {
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

    // Map and inject task elements
    this.tasks.forEach(task => {
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

      card.innerHTML = `
        <!-- Figma specs inspector element - Day 6 -->
        <span class="design-spec-badge">.task-card w:100% r:8px p:16px shadow:0_8px_32px</span>
        
        <div class="task-card__header">
          <span class="task-card__priority-badge task-card__priority-badge--${task.priority.toLowerCase()}">${task.priority}</span>
          <span style="font-size: 10px; font-weight: bold; color: var(--text-muted)">#${task.id}</span>
        </div>
        <h4 class="task-card__title">${task.title}</h4>
        <p class="task-card__description">${task.description || 'No description supplied.'}</p>
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
        assignee: selectedAssignee,
        checklist: activeChecklist
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

