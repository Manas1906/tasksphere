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

    // Define mock timeline data representing task increments over a sprint week
    const statuses = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
    const dataPoints = [3, 6, 8, 12, 16, 20]; // Mock sprint curve points

    // Constructing a beautiful interactive line chart using SVG paths
    chartContainer.innerHTML = `
      <svg class="svg-chart" viewBox="0 0 500 220">
        <defs>
          <linearGradient id="chart-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="var(--accent-cyan)" />
            <stop offset="100%" stop-color="var(--accent-purple)" />
          </linearGradient>
          <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.4" />
            <stop offset="100%" stop-color="var(--bg-primary)" stop-opacity="0" />
          </linearGradient>
        </defs>
        
        <!-- Y-Axis Grid Lines -->
        <line class="svg-chart__grid-line" x1="40" y1="30" x2="480" y2="30" />
        <line class="svg-chart__grid-line" x1="40" y1="80" x2="480" y2="80" />
        <line class="svg-chart__grid-line" x1="40" y1="130" x2="480" y2="130" />
        <line class="svg-chart__grid-line" x1="40" y1="180" x2="480" y2="180" />
        
        <!-- Axes -->
        <line class="svg-chart__axis" x1="40" y1="180" x2="480" y2="180" />
        <line class="svg-chart__axis" x1="40" y1="20" x2="40" y2="180" />

        <!-- Line Chart Path -->
        <path class="svg-chart__area" d="M 40 180 L 100 150 L 180 120 L 260 100 L 340 70 L 420 50 L 420 180 Z" />
        <path class="svg-chart__line" d="M 40 180 Q 70 165, 100 150 T 180 120 T 260 100 T 340 70 T 420 50" />

        <!-- Chart Nodes -->
        <circle class="svg-chart__point" cx="40" cy="180" r="4.5" />
        <circle class="svg-chart__point" cx="100" cy="150" r="4.5" />
        <circle class="svg-chart__point" cx="180" cy="120" r="4.5" />
        <circle class="svg-chart__point" cx="260" cy="100" r="4.5" />
        <circle class="svg-chart__point" cx="340" cy="70" r="4.5" />
        <circle class="svg-chart__point" cx="420" cy="50" r="4.5" />

        <!-- Labels -->
        <text class="svg-chart__label" x="40" y="200">Day 1</text>
        <text class="svg-chart__label" x="100" y="200">Day 3</text>
        <text class="svg-chart__label" x="180" y="200">Day 6</text>
        <text class="svg-chart__label" x="260" y="200">Day 9</text>
        <text class="svg-chart__label" x="340" y="200">Day 12</text>
        <text class="svg-chart__label" x="420" y="200">Day 15</text>

        <text class="svg-chart__label" x="20" y="184">0</text>
        <text class="svg-chart__label" x="20" y="134">10</text>
        <text class="svg-chart__label" x="20" y="84">20</text>
        <text class="svg-chart__label" x="20" y="34">30</text>
      </svg>
    `;
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
