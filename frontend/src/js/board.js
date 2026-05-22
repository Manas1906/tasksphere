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
          <div class="kanban-cards" id="lane-DONE"></div>
        </section>
      </div>
    `;

    await this.loadBoardData();
    this.setupDragAndDrop();
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
        ? `<span class="task-card__metric-item">☑ ${completedChecklist}/${checklistSize}</span>` 
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
            <span class="task-card__metric-item">⚡ ${task.storyPoints} SP</span>
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
        row.className = 'checklist-builder-item';
        row.innerHTML = `
          <label class="form-checkbox-row" style="margin: 0">
            <input type="checkbox" ${item.completed ? 'checked' : ''} data-item-idx="${idx}">
            <span class="form-checkbox-custom"></span>
            <span style="font-size: 13px; ${item.completed ? 'text-decoration: line-through; color: var(--text-muted)' : ''}">${item.content}</span>
          </label>
          <button type="button" class="checklist-builder-item__delete" data-item-idx="${idx}">&times;</button>
        `;
        
        // Checklist status change event
        row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
          activeChecklist[idx].completed = e.target.checked;
          renderChecklistUI();
        });

        // Delete item event
        row.querySelector('.checklist-builder-item__delete').addEventListener('click', () => {
          activeChecklist.splice(idx, 1);
          renderChecklistUI();
        });

        checklistContainer.appendChild(row);
      });
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

    addChecklistBtn.onclick = handleAddChecklist;
    checklistInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklist(); } };

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
