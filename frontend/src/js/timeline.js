import { api } from './api';
import { socket } from './websocket';

/**
 * TimelineView manages the interactive Sprint Gantt Timeline view.
 * Group existing tasks chronologically, calculate derived start dates from story points,
 * and support drag/resize schedules with visual snapping.
 */
export class TimelineView {
  constructor() {
    this.tasks = [];
    this.minDate = null;
    this.maxDate = null;
    this.dayWidth = 50;
    this.rowHeight = 48;
    this.barHeight = 26;
    this.days = [];
    this.activeDrag = null; // { type, taskId, initialX, initialStartDate, initialDueDate, initialPoints, rectEl, leftHandleEl, rightHandleEl, textEl }
    this._socketSubscription = null;
    this._mouseMoveHandler = null;
    this._mouseUpHandler = null;
    this._syncHandler = null;
  }

  async render() {
    const mainContainer = document.getElementById('mainContainer');
    if (!mainContainer) return;

    mainContainer.innerHTML = `
      <div class="timeline-view-container">
        <div class="timeline-header">
          <div class="timeline-title-group">
            <h2 class="timeline-title">Sprint Gantt Timeline</h2>
            <span class="timeline-subtitle">Plan schedules visually and track tasks chronologically</span>
          </div>
          <div class="timeline-actions">
            <span id="timelineStats" style="font-size: var(--font-size-xs); font-weight: 700; color: var(--accent-cyan); margin-right: var(--spacing-sm);"></span>
            <button id="timelineRefreshBtn" class="timeline-btn">🔄 Refresh</button>
          </div>
        </div>
        
        <div class="timeline-workspace">
          <div class="timeline-sidebar">
            <div class="timeline-sidebar-header">Deliverables</div>
            <div class="timeline-sidebar-rows" id="timelineSidebarRows"></div>
          </div>
          
          <div class="timeline-grid-wrapper" id="timelineGridWrapper">
            <div class="timeline-grid-header" id="timelineGridHeader"></div>
            <div class="timeline-svg-container" id="timelineSvgContainer">
              <svg id="timelineSvg" class="timeline-svg">
                <defs>
                  <linearGradient id="grad-todo" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#818cf8" />
                    <stop offset="100%" stop-color="#6366f1" />
                  </linearGradient>
                  <linearGradient id="grad-inprogress" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#34d399" />
                    <stop offset="100%" stop-color="#059669" />
                  </linearGradient>
                  <linearGradient id="grad-review" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#fbbf24" />
                    <stop offset="100%" stop-color="#d97706" />
                  </linearGradient>
                  <linearGradient id="grad-done" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#60a5fa" />
                    <stop offset="100%" stop-color="#2563eb" />
                  </linearGradient>
                </defs>
                <g id="ganttWeekendShading"></g>
                <g id="ganttGridLines"></g>
                <g id="ganttBars"></g>
                <line id="ganttTodayLine" class="gantt-grid-line--today" y1="0" y2="100%" style="display: none;"></line>
              </svg>
            </div>
          </div>
        </div>
      </div>
    `;

    await this.loadData();
    this.setupListeners();
    this.subscribeBoardUpdates();
  }

  // --- Date Math Helpers ---

  parseDate(str) {
    if (!str) return new Date();
    const [year, month, day] = str.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  getDiffDays(date1, date2) {
    const diffTime = date2.getTime() - date1.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  calculateTaskDates(task) {
    const duration = Math.max(1, task.storyPoints || 1);
    const dueDate = task.dueDate ? this.parseDate(task.dueDate) : new Date();
    dueDate.setHours(0, 0, 0, 0);
    const startDate = this.addDays(dueDate, -duration);
    startDate.setHours(0, 0, 0, 0);
    return { startDate, dueDate, duration };
  }

  // --- Data Loading & Processing ---

  async loadData() {
    try {
      this.tasks = await api.getTasks();
    } catch (err) {
      console.warn('[TIMELINE] Failed to fetch live tasks. Reading cache...', err);
      this.tasks = JSON.parse(localStorage.getItem('cache_tasks') || '[]');
    }

    if (this.tasks.length === 0) {
      this.minDate = this.addDays(new Date(), -7);
      this.maxDate = this.addDays(new Date(), 7);
    } else {
      let overallMin = null;
      let overallMax = null;

      this.tasks.forEach(task => {
        const { startDate, dueDate } = this.calculateTaskDates(task);
        if (!overallMin || startDate < overallMin) overallMin = startDate;
        if (!overallMax || dueDate > overallMax) overallMax = dueDate;
      });

      // Buffer boundary margins
      this.minDate = this.addDays(overallMin, -4);
      this.maxDate = this.addDays(overallMax, 10);
    }

    this.minDate.setHours(0, 0, 0, 0);
    this.maxDate.setHours(0, 0, 0, 0);

    const daysCount = this.getDiffDays(this.minDate, this.maxDate) + 1;
    this.days = [];
    for (let i = 0; i < daysCount; i++) {
      this.days.push(this.addDays(this.minDate, i));
    }

    this.drawTimeline();
  }

  // --- SVG Gantt Drawing ---

  drawTimeline() {
    const sidebarRows = document.getElementById('timelineSidebarRows');
    const gridHeader = document.getElementById('timelineGridHeader');
    const svg = document.getElementById('timelineSvg');
    const weekendShading = document.getElementById('ganttWeekendShading');
    const gridLines = document.getElementById('ganttGridLines');
    const ganttBars = document.getElementById('ganttBars');
    const todayLine = document.getElementById('ganttTodayLine');
    const statsEl = document.getElementById('timelineStats');

    if (!svg) return;

    // Render Stats
    if (statsEl) {
      statsEl.textContent = `${this.tasks.length} Deliverables Schedule`;
    }

    // Render Sidebar List
    if (sidebarRows) {
      sidebarRows.innerHTML = this.tasks.map(task => {
        const statusClass = task.status.toLowerCase().replace('_', '');
        return `
          <div class="timeline-sidebar-row" data-task-id="${task.id}">
            <span style="font-weight: 700; font-size: 11px; color: var(--accent-cyan); margin-right: 6px;">#${task.id}</span>
            <span class="timeline-sidebar-title" title="${task.title}">${task.title}</span>
          </div>
        `;
      }).join('');

      sidebarRows.querySelectorAll('.timeline-sidebar-row').forEach(row => {
        row.onclick = () => {
          const taskId = parseInt(row.getAttribute('data-task-id'));
          const task = this.tasks.find(t => t.id === taskId);
          if (task) this.openTicketInspector(task);
        };
      });
    }

    // Render Grid Headers
    if (gridHeader) {
      gridHeader.innerHTML = this.days.map(day => {
        const isToday = this.formatDate(day) === this.formatDate(new Date());
        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = day.getDate();
        const monthName = day.toLocaleDateString('en-US', { month: 'short' });

        return `
          <div class="timeline-header-cell ${isToday ? 'timeline-header-cell--today' : ''}" style="width: ${this.dayWidth}px;">
            <span style="font-size: 7px; font-weight: bold; text-transform: uppercase; opacity: 0.8;">${monthName}</span>
            <span class="day-num">${dayNum}</span>
            <span style="font-size: 8px;">${dayName[0]}</span>
          </div>
        `;
      }).join('');
    }

    const svgWidth = this.days.length * this.dayWidth;
    const svgHeight = this.tasks.length * this.rowHeight;
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);

    // Sync sidebar scroll with grid scroll
    const wrapper = document.getElementById('timelineGridWrapper');
    if (wrapper) {
      wrapper.onscroll = () => {
        if (sidebarRows) sidebarRows.scrollTop = wrapper.scrollTop;
      };
    }

    // Weekend shading
    if (weekendShading) {
      let shHtml = '';
      this.days.forEach((day, idx) => {
        const dayOfWeek = day.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          shHtml += `<rect class="gantt-grid-line--weekend" x="${idx * this.dayWidth}" y="0" width="${this.dayWidth}" height="${svgHeight}"></rect>`;
        }
      });
      weekendShading.innerHTML = shHtml;
    }

    // Grid Lines
    if (gridLines) {
      let glHtml = '';
      // Vertical days lines
      this.days.forEach((_, idx) => {
        glHtml += `<line class="gantt-grid-line" x1="${idx * this.dayWidth}" y1="0" x2="${idx * this.dayWidth}" y2="${svgHeight}"></line>`;
      });
      // Horizontal rows lines
      for (let i = 0; i <= this.tasks.length; i++) {
        glHtml += `<line class="gantt-grid-line" x1="0" y1="${i * this.rowHeight}" x2="${svgWidth}" y2="${i * this.rowHeight}"></line>`;
      }
      gridLines.innerHTML = glHtml;
    }

    // Redraw Today Indicator
    const todayIdx = this.days.findIndex(day => this.formatDate(day) === this.formatDate(new Date()));
    if (todayIdx !== -1 && todayLine) {
      const todayX = todayIdx * this.dayWidth + this.dayWidth / 2;
      todayLine.setAttribute('x1', todayX);
      todayLine.setAttribute('x2', todayX);
      todayLine.setAttribute('y1', 0);
      todayLine.setAttribute('y2', svgHeight);
      todayLine.style.display = 'block';
    } else if (todayLine) {
      todayLine.style.display = 'none';
    }

    // Draw Task Bars
    if (ganttBars) {
      let barsHtml = '';
      this.tasks.forEach((task, idx) => {
        const { startDate, dueDate, duration } = this.calculateTaskDates(task);
        const startIdx = this.getDiffDays(this.minDate, startDate);

        const x = startIdx * this.dayWidth;
        const width = duration * this.dayWidth;
        const y = idx * this.rowHeight + (this.rowHeight - this.barHeight) / 2;
        const statusClass = task.status.toLowerCase().replace('_', '');

        // Truncate title overlay if too short
        const maxChars = Math.max(3, Math.floor((width - 20) / 7));
        const labelText = task.title.length > maxChars ? task.title.substring(0, maxChars) + '...' : task.title;

        barsHtml += `
          <g class="gantt-bar-group" data-task-id="${task.id}" data-idx="${idx}" style="cursor: pointer;">
            <!-- Main rounded task rect -->
            <rect class="gantt-bar gantt-bar--${statusClass}" 
                  id="bar-${task.id}"
                  x="${x}" y="${y}" width="${width}" height="${this.barHeight}" 
                  data-task-id="${task.id}"></rect>
                  
            <!-- Left resize handle -->
            <rect class="gantt-handle gantt-handle--left" 
                  id="handle-left-${task.id}"
                  x="${x}" y="${y}" width="8" height="${this.barHeight}" 
                  data-task-id="${task.id}"></rect>
                  
            <!-- Right resize handle -->
            <rect class="gantt-handle gantt-handle--right" 
                  id="handle-right-${task.id}"
                  x="${x + width - 8}" y="${y}" width="8" height="${this.barHeight}" 
                  data-task-id="${task.id}"></rect>
                  
            <!-- Text overlay label -->
            <text class="gantt-text" 
                  id="text-${task.id}"
                  x="${x + 12}" y="${y + this.barHeight / 2 + 4}" 
                  data-task-id="${task.id}">${labelText}</text>
          </g>
        `;
      });
      ganttBars.innerHTML = barsHtml;
    }
  }

  // --- Interactive Drag and Drop & Resizing Event Handlers ---

  setupListeners() {
    const refreshBtn = document.getElementById('timelineRefreshBtn');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.loadData();
    }

    const svg = document.getElementById('timelineSvg');
    if (!svg) return;

    // Event Delegations
    svg.addEventListener('mousedown', (e) => this.onDragStart(e));
    svg.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      this.onDragStart(touch);
    }, { passive: true });

    this._mouseMoveHandler = (e) => this.onDragMove(e);
    this._mouseUpHandler = (e) => this.onDragEnd(e);

    document.addEventListener('mousemove', this._mouseMoveHandler);
    document.addEventListener('mouseup', this._mouseUpHandler);

    document.addEventListener('touchmove', (e) => {
      if (this.activeDrag) {
        this.onDragMove(e.touches[0]);
        e.preventDefault();
      }
    }, { passive: false });
    document.addEventListener('touchend', (e) => this.onDragEnd(e));
  }

  onDragStart(e) {
    const target = e.target;
    const taskIdStr = target.getAttribute('data-task-id');
    if (!taskIdStr) return;

    const taskId = parseInt(taskIdStr);
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const { startDate, dueDate, duration } = this.calculateTaskDates(task);

    let type = 'drag';
    if (target.classList.contains('gantt-handle--left')) {
      type = 'resize-left';
    } else if (target.classList.contains('gantt-handle--right')) {
      type = 'resize-right';
    }

    const rectEl = document.getElementById(`bar-${taskId}`);
    const leftHandleEl = document.getElementById(`handle-left-${taskId}`);
    const rightHandleEl = document.getElementById(`handle-right-${taskId}`);
    const textEl = document.getElementById(`text-${taskId}`);

    this.activeDrag = {
      type,
      taskId,
      initialX: e.clientX,
      initialStartDate: startDate,
      initialDueDate: dueDate,
      initialPoints: duration,
      rectEl,
      leftHandleEl,
      rightHandleEl,
      textEl
    };

    if (type === 'drag') {
      rectEl.style.cursor = 'grabbing';
    }
  }

  onDragMove(e) {
    if (!this.activeDrag) return;

    const drag = this.activeDrag;
    const dx = e.clientX - drag.initialX;
    const deltaDays = Math.round(dx / this.dayWidth);

    const task = this.tasks.find(t => t.id === drag.taskId);
    if (!task) return;

    if (drag.type === 'drag') {
      const newStartDate = this.addDays(drag.initialStartDate, deltaDays);
      const newDueDate = this.addDays(drag.initialDueDate, deltaDays);

      const startIdx = this.getDiffDays(this.minDate, newStartDate);
      const newX = startIdx * this.dayWidth;
      const width = drag.initialPoints * this.dayWidth;

      drag.rectEl.setAttribute('x', newX);
      drag.leftHandleEl.setAttribute('x', newX);
      drag.rightHandleEl.setAttribute('x', newX + width - 8);
      drag.textEl.setAttribute('x', newX + 12);

    } else if (drag.type === 'resize-left') {
      // Limit to prevent duration < 1 day
      let newStartDate = this.addDays(drag.initialStartDate, deltaDays);
      if (newStartDate >= drag.initialDueDate) {
        newStartDate = this.addDays(drag.initialDueDate, -1);
      }

      const startIdx = this.getDiffDays(this.minDate, newStartDate);
      const newX = startIdx * this.dayWidth;
      const newDuration = this.getDiffDays(newStartDate, drag.initialDueDate);
      const newWidth = newDuration * this.dayWidth;

      drag.rectEl.setAttribute('x', newX);
      drag.rectEl.setAttribute('width', newWidth);
      drag.leftHandleEl.setAttribute('x', newX);
      drag.textEl.setAttribute('x', newX + 12);

      // Re-slice text label
      const maxChars = Math.max(3, Math.floor((newWidth - 20) / 7));
      drag.textEl.textContent = task.title.length > maxChars ? task.title.substring(0, maxChars) + '...' : task.title;

    } else if (drag.type === 'resize-right') {
      // Limit to prevent duration < 1 day
      let newDueDate = this.addDays(drag.initialDueDate, deltaDays);
      if (newDueDate <= drag.initialStartDate) {
        newDueDate = this.addDays(drag.initialStartDate, 1);
      }

      const newDuration = this.getDiffDays(drag.initialStartDate, newDueDate);
      const newWidth = newDuration * this.dayWidth;
      const currentX = parseFloat(drag.rectEl.getAttribute('x'));

      drag.rectEl.setAttribute('width', newWidth);
      drag.rightHandleEl.setAttribute('x', currentX + newWidth - 8);

      // Re-slice text label
      const maxChars = Math.max(3, Math.floor((newWidth - 20) / 7));
      drag.textEl.textContent = task.title.length > maxChars ? task.title.substring(0, maxChars) + '...' : task.title;
    }
  }

  async onDragEnd(e) {
    if (!this.activeDrag) return;

    const drag = this.activeDrag;
    drag.rectEl.style.cursor = '';
    this.activeDrag = null;

    const dx = e.clientX - drag.initialX;
    const deltaDays = Math.round(dx / this.dayWidth);

    const task = this.tasks.find(t => t.id === drag.taskId);
    if (!task) return;

    let updatedPoints = task.storyPoints;
    let updatedDueDate = task.dueDate;

    if (drag.type === 'drag') {
      const newDueDate = this.addDays(drag.initialDueDate, deltaDays);
      updatedDueDate = this.formatDate(newDueDate);
    } else if (drag.type === 'resize-left') {
      let newStartDate = this.addDays(drag.initialStartDate, deltaDays);
      if (newStartDate >= drag.initialDueDate) {
        newStartDate = this.addDays(drag.initialDueDate, -1);
      }
      updatedPoints = this.getDiffDays(newStartDate, drag.initialDueDate);
    } else if (drag.type === 'resize-right') {
      let newDueDate = this.addDays(drag.initialDueDate, deltaDays);
      if (newDueDate <= drag.initialStartDate) {
        newDueDate = this.addDays(drag.initialStartDate, 1);
      }
      updatedPoints = this.getDiffDays(drag.initialStartDate, newDueDate);
      updatedDueDate = this.formatDate(newDueDate);
    }

    // Save Changes
    task.storyPoints = updatedPoints;
    task.dueDate = updatedDueDate;

    try {
      await api.updateTask(task.id, task);
      
      // Flash Toast
      if (window.app) {
        if (drag.type === 'drag') {
          window.app.showNotificationToast('📅 Timeline Scheduled', `Rescheduled task "${task.title}" to ${updatedDueDate}.`, 'UPDATE');
        } else {
          window.app.showNotificationToast('⚡ Scope Recalculated', `Resized "${task.title}" to ${updatedPoints} story points.`, 'UPDATE');
        }
      }

      // Sync and broadcast
      socket.send('/app/board.move', {
        taskId: task.id,
        title: task.title,
        fromStatus: task.status,
        toStatus: task.status,
        username: localStorage.getItem('chat_username') || 'CTO Guest'
      });

    } catch (err) {
      console.error('[TIMELINE] Failed to save updated task details:', err);
      alert('Could not synchronize task timeline changes with the backend database.');
    }

    // Reload grid UI
    await this.loadData();
  }

  // --- Real-time Collaborative Synchronization ---

  subscribeBoardUpdates() {
    if (!socket.connected) return;

    this._syncHandler = () => {
      console.log('[TIMELINE] Live WS broadcast received. Refreshing Gantt grid...');
      this.loadData();
    };

    // Listen to generic board moves to live-update timelines across active tabs
    this._socketSubscription = socket.subscribe('/topic/board', this._syncHandler);
  }

  // --- Ticket Inspector Dialog Integration ---

  openTicketInspector(task) {
    const modal = document.getElementById('ticketModal');
    const form = document.getElementById('ticketForm');
    if (!modal || !form) return;

    modal.querySelector('.modal-header__title').textContent = `Scrum Card Inspector: #${task.id}`;
    
    form.querySelector('#ticketTitle').value = task.title;
    form.querySelector('#ticketDescription').value = task.description || '';
    form.querySelector('#ticketPriority').value = task.priority;
    form.querySelector('#ticketPoints').value = task.storyPoints;
    form.querySelector('#ticketDueDate').value = task.dueDate || '';
    
    const assigneeSelect = form.querySelector('#ticketAssignee');
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>`;
    
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

    const checklistContainer = form.querySelector('#checklistBuilderList');
    checklistContainer.innerHTML = '';
    
    let activeChecklist = [...(task.checklist || [])];

    const renderChecklistUI = () => {
      checklistContainer.innerHTML = '';
      activeChecklist.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'checklist-builder-item checklist-builder-item--active';
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
          activeChecklist.splice(idx, 1);
          renderChecklistUI();
        });

        checklistContainer.appendChild(row);
      });
    };

    renderChecklistUI();

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

    modal.classList.add('modal-overlay--active');

    const closeBtn = document.getElementById('closeTicketModal');
    const cancelBtn = document.getElementById('cancelTicketBtn');
    const closeModal = () => modal.classList.remove('modal-overlay--active');
    
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

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

      try {
        await api.updateTask(task.id, updatedTask);
        closeModal();
        await this.loadData();
        
        socket.send('/app/board.move', {
          taskId: task.id,
          title: updatedTask.title,
          fromStatus: task.status,
          toStatus: task.status,
          username: localStorage.getItem('chat_username') || 'CTO Guest'
        });
      } catch (err) {
        console.error('[TIMELINE] Failed to save updated card:', err);
        alert('Failed to save updated task details.');
      }
    };
  }

  destroy() {
    if (this._mouseMoveHandler) {
      document.removeEventListener('mousemove', this._mouseMoveHandler);
    }
    if (this._mouseUpHandler) {
      document.removeEventListener('mouseup', this._mouseUpHandler);
    }
    if (this._socketSubscription) {
      this._socketSubscription.unsubscribe();
    }
  }
}
