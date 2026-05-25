import { api } from './api';

/**
 * DashboardView - Day 8-11 JavaScript Array & Math Operations Engine
 * Compiles and renders enterprise statistics and animated SVG charts
 */
export class DashboardView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.tasks = [];
    this.filterType = 'ALL'; // ALL, HIGH_PRIORITY, URGENT, UNASSIGNED
  }

  async render() {
    this.container.innerHTML = `
      <div class="chat-panel-header" style="background: none; border: none; padding: 0; margin-bottom: var(--spacing-lg)">
        <h2 class="modal-header__title" style="font-size: var(--font-size-xl)">Executive Analytics Panel</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm)">Aggregate Scrum metrics and sprint velocities in real-time.</p>
      </div>

      <!-- Filters & Operations Bar - Day 9 Array Operations -->
      <div class="dashboard-controls">
        <div class="dashboard-filters">
          <button class="filter-btn ${this.filterType === 'ALL' ? 'filter-btn--active' : ''}" data-filter="ALL">All Items</button>
          <button class="filter-btn ${this.filterType === 'HIGH_PRIORITY' ? 'filter-btn--active' : ''}" data-filter="HIGH_PRIORITY">⚠️ High Priority</button>
          <button class="filter-btn ${this.filterType === 'URGENT' ? 'filter-btn--active' : ''}" data-filter="URGENT">🔥 Urgent</button>
          <button class="filter-btn ${this.filterType === 'UNASSIGNED' ? 'filter-btn--active' : ''}" data-filter="UNASSIGNED">👤 Unassigned</button>
        </div>
        <div style="font-size: var(--font-size-xs); color: var(--text-muted)">
          Active Scope: <span class="text-cyan" id="filteredCount">0</span> tasks mapped
        </div>
      </div>

      <!-- Stat Cards Row - CSS Grid -->
      <div class="dashboard-grid" id="statsContainer">
        <!-- Stat cards will be injected -->
      </div>

      <!-- Charts & Visualizers Container -->
      <div class="chart-panel-row">
        <!-- SVG Line Chart (Sprint Progress) -->
        <div class="chart-card">
          <div class="chart-card__title">Sprint Velocity & Burndown Estimate</div>
          <div class="svg-chart-container" id="svgChartContainer">
            <!-- Dynamic SVG Chart will be injected -->
          </div>
        </div>

        <!-- SVG Circular Gauge (Goal Compliance) -->
        <div class="chart-card" style="align-items: center; justify-content: center">
          <div class="chart-card__title" style="align-self: flex-start">Sprint Completion Ratio</div>
          <div class="circular-gauge" id="circularGauge">
            <!-- Dynamic Gauge injected -->
          </div>
        </div>
      </div>

      <!-- Bottom Resources Grid -->
      <div class="chart-card">
        <div class="chart-card__title">Agile Workload Distribution</div>
        <div class="enterprise-table-container">
          <table class="enterprise-table">
            <thead>
              <tr>
                <th>Resource Name</th>
                <th>Assigned Tasks</th>
                <th>Estimated Story Points</th>
                <th>SLA Compliance</th>
              </tr>
            </thead>
            <tbody id="workloadTableBody">
              <!-- Loaded dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.bindEvents();
    await this.loadAndProcessData();
  }

  bindEvents() {
    this.container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        this.filterType = e.target.getAttribute('data-filter');
        this.container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-btn--active'));
        e.target.classList.add('filter-btn--active');
        await this.loadAndProcessData();
      });
    });
  }

  async loadAndProcessData() {
    // Renders visual skeleton loaders
    this.tasks = await api.getTasks();
    this.calculateMetrics();
  }

  /**
   * Day 9 Curriculum Showcase - Array Manipulation Engine (Filter, Map, Reduce)
   */
  calculateMetrics() {
    // 1. Array Filtering
    let filteredTasks = [...this.tasks];
    if (this.filterType === 'HIGH_PRIORITY') {
      filteredTasks = this.tasks.filter(t => t.priority === 'HIGH');
    } else if (this.filterType === 'URGENT') {
      filteredTasks = this.tasks.filter(t => t.priority === 'URGENT');
    } else if (this.filterType === 'UNASSIGNED') {
      filteredTasks = this.tasks.filter(t => !t.assignee);
    }

    const filteredCount = document.getElementById('filteredCount');
    if (filteredCount) filteredCount.textContent = filteredTasks.length;

    // 2. Statistics Calculations using Array Reduce
    const totalCount = filteredTasks.length;
    const todoTasks = filteredTasks.filter(t => t.status === 'TODO');
    const progressTasks = filteredTasks.filter(t => t.status === 'IN_PROGRESS');
    const reviewTasks = filteredTasks.filter(t => t.status === 'REVIEW');
    const doneTasks = filteredTasks.filter(t => t.status === 'DONE');

    // Sum story points using Array.reduce()
    const totalStoryPoints = filteredTasks.reduce((acc, curr) => acc + (curr.storyPoints || 0), 0);
    const completedStoryPoints = doneTasks.reduce((acc, curr) => acc + (curr.storyPoints || 0), 0);

    const completionRate = totalCount > 0 ? Math.round((doneTasks.length / totalCount) * 100) : 0;
    
    // Check for overdue cards (due date is in past)
    const today = new Date().toISOString().split('T')[0];
    const overdueTasks = filteredTasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'DONE');

    // 3. Inject Stats Grid
    const statsContainer = document.getElementById('statsContainer');
    if (statsContainer) {
      statsContainer.innerHTML = `
        <div class="stat-card stat-card--cyan">
          <div class="stat-card__title">Total Backlog Items</div>
          <div class="stat-card__value">${totalCount} Tasks</div>
          <div class="stat-card__trend text-cyan">Points estimate: ${totalStoryPoints}SP</div>
        </div>
        <div class="stat-card stat-card--purple">
          <div class="stat-card__title">In Progress Load</div>
          <div class="stat-card__value">${progressTasks.length} Active</div>
          <div class="stat-card__trend text-purple">${reviewTasks.length} in code review</div>
        </div>
        <div class="stat-card stat-card--emerald">
          <div class="stat-card__title">Completed Scope</div>
          <div class="stat-card__value">${doneTasks.length} Closed</div>
          <div class="stat-card__trend text-emerald">${completedStoryPoints} of ${totalStoryPoints} SP delivered</div>
        </div>
        <div class="stat-card stat-card--rose">
          <div class="stat-card__title">SLA Exceptions</div>
          <div class="stat-card__value">${overdueTasks.length} Overdue</div>
          <div class="stat-card__trend text-rose">Requires sprint adjustments</div>
        </div>
      `;
    }

    // 4. Render Dynamic SVG Chart - Day 10 DOM basics & math shapes
    this.renderSvgChart(filteredTasks);

    // 5. Render Circular Gauge
    this.renderCircularGauge(completionRate);

    // 6. Workload table mapping
    this.renderWorkloadTable(filteredTasks);
  }

  renderSvgChart(tasks) {
    const chartContainer = document.getElementById('svgChartContainer');
    if (!chartContainer) return;

    // 1. Calculate active metrics using Array operations
    const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    // 2. Establish dynamic 10-day sprint cycle dates
    const dueDates = tasks.map(t => t.dueDate).filter(Boolean).sort();
    let startDate = new Date();
    
    if (dueDates.length > 0) {
      const earliest = new Date(dueDates[0]);
      startDate = new Date(earliest);
      startDate.setDate(earliest.getDate() - 3); // 3 days buffer
    } else {
      startDate.setDate(startDate.getDate() - 4); // fallback 4 days in past
    }

    const days = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      days.push(d.toISOString().split('T')[0]);
    }

    // 3. Compute coordinates mapping functions
    const xMin = 50;
    const xMax = 460;
    const yMin = 30;
    const yMax = 180;

    const getX = (index) => xMin + (index * (xMax - xMin)) / 9;
    const getY = (points) => {
      if (totalPoints === 0) return yMax;
      return yMax - (points * (yMax - yMin)) / totalPoints;
    };

    // 4. Generate data points for Ideal and Actual curves
    const idealPoints = [];
    const actualPoints = [];
    let idealPathD = "";
    let actualPathD = "";
    let areaPathD = `M ${getX(0)} ${yMax} `;

    for (let i = 0; i < 10; i++) {
      const x = getX(i);
      
      // Ideal line calculation
      const ideal = Math.max(0, totalPoints * (1 - i / 9));
      const yIdeal = getY(ideal);
      idealPoints.push({ x, y: yIdeal, val: Math.round(ideal * 10) / 10 });
      if (i === 0) {
        idealPathD += `M ${x} ${yIdeal} `;
      } else {
        idealPathD += `L ${x} ${yIdeal} `;
      }

      // Actual line calculation: outstanding points left on day i
      const dayDateStr = days[i];
      // Completed tasks on or before this day
      const completedBeforeOrOn = tasks.filter(t => t.status === 'DONE' && t.dueDate && t.dueDate <= dayDateStr);
      const completedNoDate = tasks.filter(t => t.status === 'DONE' && !t.dueDate);
      
      // Let's assume un-dated completed tasks are burned down starting from Day 4 (mid-sprint)
      let bonusBurndown = 0;
      if (i >= 4) {
        const noDatePoints = completedNoDate.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
        // Distribute them over the remaining days
        bonusBurndown = (noDatePoints * (i - 3)) / 6;
        if (bonusBurndown > noDatePoints) bonusBurndown = noDatePoints;
      }

      const completedPoints = completedBeforeOrOn.reduce((sum, t) => sum + (t.storyPoints || 0), 0) + bonusBurndown;
      const actual = Math.max(0, totalPoints - completedPoints);
      
      // For future days (relative to today), we cap the actual curve at the current outstanding points
      const todayStr = new Date().toISOString().split('T')[0];
      let displayActual = actual;
      if (dayDateStr > todayStr && i > 0) {
        // If it's a future day, show the trend carrying over
        displayActual = actualPoints[i-1].val;
      }

      const yActual = getY(displayActual);
      actualPoints.push({ x, y: yActual, val: Math.round(displayActual * 10) / 10, rawVal: displayActual });

      if (i === 0) {
        actualPathD += `M ${x} ${yActual} `;
        areaPathD += `L ${x} ${yActual} `;
      } else {
        // Create smooth Bezier curve connection
        const prevX = actualPoints[i-1].x;
        const prevY = actualPoints[i-1].y;
        const cpX1 = prevX + (x - prevX) / 2;
        const cpY1 = prevY;
        const cpX2 = prevX + (x - prevX) / 2;
        const cpY2 = yActual;
        
        actualPathD += `C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${x} ${yActual} `;
        areaPathD += `C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${x} ${yActual} `;
      }
    }
    areaPathD += `L ${getX(9)} ${yMax} Z`;

    // 5. Build Grid ticks
    let gridLinesHtml = "";
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i++) {
      const yVal = yMax - (i * (yMax - yMin)) / tickCount;
      const pointVal = Math.round((i * totalPoints) / tickCount);
      gridLinesHtml += `
        <line class="svg-chart__grid-line" x1="${xMin}" y1="${yVal}" x2="${xMax}" y2="${yVal}" />
        <text class="svg-chart__label" x="${xMin - 12}" y="${yVal + 4}" text-anchor="end">${pointVal}</text>
      `;
    }

    // 6. Draw actual nodes
    let nodesHtml = "";
    actualPoints.forEach((pt, i) => {
      const idealPt = idealPoints[i];
      const dateLabel = new Date(days[i]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      nodesHtml += `
        <circle class="svg-chart__point" 
                cx="${pt.x}" 
                cy="${pt.y}" 
                r="4.5" 
                data-day="${i + 1}" 
                data-date="${dateLabel}" 
                data-actual="${pt.val}" 
                data-ideal="${idealPt.val}" />
      `;
    });

    // 7. Draw bottom date labels
    let labelsHtml = "";
    days.forEach((day, i) => {
      if (i % 2 === 0 || i === 9) { // render every second label for clean styling
        const dateObj = new Date(day);
        const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        labelsHtml += `<text class="svg-chart__label" x="${getX(i)}" y="${yMax + 18}" text-anchor="middle">${label}</text>`;
      }
    });

    // 8. Render full interactive SVG canvas
    chartContainer.innerHTML = `
      <svg class="svg-chart" viewBox="0 0 500 220" style="overflow: visible;">
        <defs>
          <linearGradient id="chart-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="var(--accent-cyan)" />
            <stop offset="100%" stop-color="var(--accent-purple)" />
          </linearGradient>
          <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.2" />
            <stop offset="100%" stop-color="var(--bg-primary)" stop-opacity="0" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        
        <!-- Y-Axis Grid Lines & Ticks -->
        ${gridLinesHtml}
        
        <!-- Axes -->
        <line class="svg-chart__axis" x1="${xMin}" y1="${yMax}" x2="${xMax}" y2="${yMax}" />
        <line class="svg-chart__axis" x1="${xMin}" y1="${yMin}" x2="${xMin}" y2="${yMax}" />

        <!-- Area shading underneath actual burndown -->
        <path class="svg-chart__area" d="${areaPathD}" fill="url(#area-gradient)" />

        <!-- Ideal Burndown Path (Dashed guide line) -->
        <path class="svg-chart__line--ideal" d="${idealPathD}" fill="none" stroke="var(--text-muted)" stroke-dasharray="4,4" stroke-width="1.5" style="opacity: 0.4;" />

        <!-- Actual Burndown Path (Neon gradient polyline) -->
        <path class="svg-chart__line" d="${actualPathD}" fill="none" stroke="url(#chart-gradient)" stroke-width="3" filter="url(#glow)" />

        <!-- Interactive Point Checkpoints -->
        ${nodesHtml}

        <!-- Bottom Date Labels -->
        ${labelsHtml}
      </svg>
      
      <!-- Floating Glassmorphic Tooltip Card -->
      <div id="chartTooltip" class="svg-chart__tooltip hidden"></div>
    `;

    // 9. Bind dynamic hover events for the tooltips
    const points = chartContainer.querySelectorAll('.svg-chart__point');
    const tooltip = chartContainer.querySelector('#chartTooltip');

    points.forEach(point => {
      point.onmouseenter = () => {
        const day = point.getAttribute('data-day');
        const date = point.getAttribute('data-date');
        const actual = point.getAttribute('data-actual');
        const ideal = point.getAttribute('data-ideal');

        if (tooltip) {
          tooltip.innerHTML = `
            <div style="font-weight: 800; font-size: 10px; text-transform: uppercase; color: var(--accent-cyan); letter-spacing: 0.5px; margin-bottom: 4px;">Day ${day} (${date})</div>
            <div style="display: flex; flex-direction: column; gap: 2px; font-size: 10px;">
              <div style="display: flex; justify-content: space-between; gap: 15px;">
                <span style="color: var(--text-muted);">Actual Backlog:</span>
                <strong style="color: var(--text-primary); font-family: 'Fira Code', monospace;">${actual} SP</strong>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 15px;">
                <span style="color: var(--text-muted);">Ideal Goal:</span>
                <strong style="color: var(--text-muted); font-family: 'Fira Code', monospace;">${ideal} SP</strong>
              </div>
            </div>
          `;
          tooltip.classList.remove('hidden');
        }
      };

      point.onmousemove = (e) => {
        if (tooltip) {
          const rect = chartContainer.getBoundingClientRect();
          const x = e.clientX - rect.left + 12;
          const y = e.clientY - rect.top - 60;
          tooltip.style.left = `${x}px`;
          tooltip.style.top = `${y}px`;
        }
      };

      point.onmouseleave = () => {
        if (tooltip) tooltip.classList.add('hidden');
      };
    });
  }

  renderCircularGauge(percentage) {
    const gaugeContainer = document.getElementById('circularGauge');
    if (!gaugeContainer) return;

    // Circumference of circular path with r=60 is 2 * PI * 60 = 377px
    // The dashoffset determines stroke length: 377 - (377 * percent / 100)
    const strokeDashOffset = 377 - (377 * percentage) / 100;

    gaugeContainer.innerHTML = `
      <svg class="circular-gauge__svg" viewBox="0 0 140 140">
        <defs>
          <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--accent-cyan)" />
            <stop offset="100%" stop-color="var(--accent-purple)" />
          </linearGradient>
        </defs>
        <circle class="circular-gauge__track" cx="70" cy="70" r="60" />
        <circle class="circular-gauge__fill" cx="70" cy="70" r="60" 
                style="stroke-dashoffset: ${strokeDashOffset};" />
      </svg>
      <div class="circular-gauge__center">
        <span class="circular-gauge__value">${percentage}%</span>
        <span class="circular-gauge__label">Complete</span>
      </div>
    `;
  }

  renderWorkloadTable(tasks) {
    const tableBody = document.getElementById('workloadTableBody');
    if (!tableBody) return;

    // Collate workloads by mapping/reducing assignees
    const assignees = {};
    tasks.forEach(task => {
      const name = task.assignee ? task.assignee.username : 'Unassigned';
      if (!assignees[name]) {
        assignees[name] = { count: 0, points: 0, done: 0 };
      }
      assignees[name].count++;
      assignees[name].points += task.storyPoints || 0;
      if (task.status === 'DONE') {
        assignees[name].done++;
      }
    });

    const rows = Object.entries(assignees).map(([name, data]) => {
      const slaRate = data.count > 0 ? Math.round((data.done / data.count) * 100) : 0;
      const progressPercentStr = slaRate === 100 ? 'SLA Compliant' : `${slaRate}% Resolved`;
      const slaClass = slaRate >= 80 ? 'text-emerald' : (slaRate >= 50 ? 'text-amber' : 'text-rose');
      
      return `
        <tr>
          <td style="font-weight: 600; color: var(--text-main)">${name}</td>
          <td>${data.count} Tasks</td>
          <td>${data.points} SP</td>
          <td class="${slaClass}" style="font-weight: bold">${progressPercentStr}</td>
        </tr>
      `;
    }).join('');

    tableBody.innerHTML = rows || `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); font-style: italic">No workload data mapped in active scope.</td>
      </tr>
    `;
  }
}
