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
          <button class="filter-btn ${this.filterType === 'HIGH_PRIORITY' ? 'filter-btn--active' : ''}" data-filter="HIGH_PRIORITY" style="display: inline-flex; align-items: center; gap: 4px;">${this.getIconSvg('warning')} High Priority</button>
          <button class="filter-btn ${this.filterType === 'URGENT' ? 'filter-btn--active' : ''}" data-filter="URGENT" style="display: inline-flex; align-items: center; gap: 4px;">${this.getIconSvg('urgent')} Urgent</button>
          <button class="filter-btn ${this.filterType === 'UNASSIGNED' ? 'filter-btn--active' : ''}" data-filter="UNASSIGNED" style="display: inline-flex; align-items: center; gap: 4px;">${this.getIconSvg('user')} Unassigned</button>
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

      <!-- Predictive Sprint Simulation & Forecast Panel (Phase 12) -->
      <div class="chart-card" style="margin-top: var(--spacing-lg)">
        <div class="chart-card__title" style="display: flex; align-items: center; gap: 8px;">
          ${this.getIconSvg('predictive')} Predictive AI Sprint Simulation & Forecast
        </div>
        <p style="color: var(--text-muted); font-size: var(--font-size-xs); margin-bottom: var(--spacing-md)">
          Execute a 1,000-path mathematical Monte Carlo simulation coupled with real-time Google Gemini analysis to model team capacity and rebalance workloads.
        </p>
        
        <div id="simulationPanelContent" style="display: flex; flex-direction: column; gap: var(--spacing-md); width: 100%">
          <!-- Initial state: Big call-to-action button -->
          <div style="display: flex; justify-content: center; align-items: center; padding: var(--spacing-xl) 0">
            <button id="runSimulationBtn" class="auth-btn" style="background: linear-gradient(135deg, #8b54f6 0%, #ff0080 100%); border: none; padding: 12px 30px; display: inline-flex; align-items: center; gap: 8px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 15px rgba(255, 0, 128, 0.3); border-radius: var(--border-radius-md); transition: transform 0.2s, box-shadow 0.2s;">
              ${this.getIconSvg('predictive')} Run Sprint Simulation
            </button>
          </div>
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

    const runSimBtn = this.container.querySelector('#runSimulationBtn');
    if (runSimBtn) {
      runSimBtn.addEventListener('click', () => this.handleRunSimulation());
    }
  }

  async handleRunSimulation() {
    const panelContent = this.container.querySelector('#simulationPanelContent');
    if (!panelContent) return;

    // 1. Renders dynamic cyber-loader stages
    const stages = [
      "Initializing Monte Carlo calculus clusters...",
      "Simulating 1,000 randomized velocity sprint paths...",
      "Evaluating workload resource constraints...",
      "Submitting telemetry metrics to Gemini AI Advisor...",
      "Compiling predictive Scrum timeline report..."
    ];

    let currentStage = 0;
    panelContent.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--spacing-xl) 0; gap: var(--spacing-md);">
        <div class="chatbot-bubble--loading" style="display: flex; gap: 6px; padding: var(--spacing-md); background: rgba(139, 84, 246, 0.1); border-radius: var(--border-radius-md); border: 1px dashed var(--accent-purple);">
          <span class="typing-dot" style="background: var(--accent-purple)"></span>
          <span class="typing-dot" style="background: var(--accent-cyan)"></span>
          <span class="typing-dot" style="background: var(--accent-rose)"></span>
        </div>
        <div id="simulationStageText" style="font-size: var(--font-size-sm); color: var(--accent-purple); font-weight: bold; height: 20px; transition: opacity 0.2s;">
          ${stages[0]}
        </div>
      </div>
    `;

    const stageInterval = setInterval(() => {
      currentStage = (currentStage + 1) % stages.length;
      const stageTextEl = this.container.querySelector('#simulationStageText');
      if (stageTextEl) {
        stageTextEl.style.opacity = '0';
        setTimeout(() => {
          stageTextEl.textContent = stages[currentStage];
          stageTextEl.style.opacity = '1';
        }, 200);
      }
    }, 1500);

    try {
      // 2. Fetch calculations from backend
      const result = await api.runSprintSimulation();
      clearInterval(stageInterval);

      // 3. Render success probability outcomes
      const likelihood = result.completionLikelihood;
      const riskTier = result.riskTier || 'LOW';
      
      const riskColor = riskTier === 'HIGH' ? 'var(--accent-rose)' : (riskTier === 'MEDIUM' ? 'var(--accent-amber)' : 'var(--accent-cyan)');
      const shadowColor = riskTier === 'HIGH' ? 'rgba(255, 0, 85, 0.3)' : (riskTier === 'MEDIUM' ? 'rgba(255, 204, 0, 0.3)' : 'rgba(0, 255, 204, 0.3)');

      // Map bottlenecks list
      let bottleneckListHtml = "";
      if (result.bottlenecks && result.bottlenecks.length > 0) {
        bottleneckListHtml = result.bottlenecks.map(b => {
          let cleanText = b.replace(/\*\*/g, '');
          let svgIcon = this.getIconSvg('siren');
          if (cleanText.includes("Unassigned")) svgIcon = this.getIconSvg('warning');
          if (cleanText.includes("Resource")) svgIcon = this.getIconSvg('user');
          return `
            <div style="font-size: 11px; padding: var(--spacing-xs); background: rgba(255,255,255,0.02); border-radius: var(--border-radius-sm); border-left: 2px solid var(--border-color); display: flex; gap: 6px; align-items: flex-start; line-height: 1.4;">
              <span style="display: inline-flex; align-items: center; margin-top: 2px;">${svgIcon}</span>
              <span style="color: var(--text-muted);">${cleanText}</span>
            </div>
          `;
        }).join('');
      } else {
        bottleneckListHtml = `
          <div style="font-size: 11px; color: var(--text-muted); font-style: italic; text-align: center; padding: var(--spacing-md); display: flex; align-items: center; justify-content: center; gap: 4px;">
            ${this.getIconSvg('success')} No critical SLA exceptions or resource bottlenecks detected.
          </div>
        `;
      }

      // Map AI recommendations list
      let recommendationsListHtml = "";
      if (result.recommendations && result.recommendations.length > 0) {
        recommendationsListHtml = result.recommendations.map((rec, i) => {
          return `
            <div style="display: flex; gap: 8px; align-items: flex-start; line-height: 1.4;">
              <span style="display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: rgba(139, 84, 246, 0.1); color: var(--accent-purple); font-size: 10px; font-weight: bold; flex-shrink: 0;">${i + 1}</span>
              <span style="font-size: 11px; color: var(--text-main); font-weight: 500;">${rec}</span>
            </div>
          `;
        }).join('');
      } else {
        recommendationsListHtml = `
          <div style="font-size: 11px; color: var(--text-muted); font-style: italic; padding: var(--spacing-sm);">
            No recommendations generated. Backlog looks fully optimized!
          </div>
        `;
      }

      panelContent.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: var(--spacing-md); width: 100%; margin-top: var(--spacing-sm)">
          
          <!-- Column 1: Semicircular Gauge -->
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 220px; padding: var(--spacing-md); background: var(--bg-secondary); border-radius: var(--border-radius-md); border: 1px solid var(--border-color); box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
            <div style="font-size: 10px; color: var(--text-muted); margin-bottom: var(--spacing-sm); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Completion Likelihood</div>
            <div class="simulation-gauge-container" style="position: relative; width: 160px; height: 100px;">
              <svg viewBox="0 0 100 55" style="width: 100%; height: 100%">
                <defs>
                  <linearGradient id="gauge-risk-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="var(--accent-rose)" />
                    <stop offset="50%" stop-color="var(--accent-amber)" />
                    <stop offset="100%" stop-color="var(--accent-cyan)" />
                  </linearGradient>
                </defs>
                <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="8" stroke-linecap="round" />
                <path id="gaugePath" d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="url(#gauge-risk-grad)" stroke-width="8" stroke-linecap="round" 
                      stroke-dasharray="126" stroke-dashoffset="126" style="transition: stroke-dashoffset 1.5s cubic-bezier(0.22, 1, 0.36, 1);" />
              </svg>
              <div style="position: absolute; bottom: 8px; width: 100%; text-align: center;">
                <div style="font-size: 26px; font-weight: 800; font-family: 'Fira Code', monospace; color: var(--text-primary); text-shadow: 0 0 10px ${shadowColor};">${likelihood}%</div>
                <div style="font-size: 10px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: ${riskColor};">${riskTier} RISK</div>
              </div>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); text-align: center; margin-top: var(--spacing-xs)">
              Simulated across ${result.daysRemaining} remaining sprint days
            </div>
          </div>

          <!-- Column 2: Bottlenecks List -->
          <div style="flex: 1.2; display: flex; flex-direction: column; min-width: 250px; padding: var(--spacing-md); background: var(--bg-secondary); border-radius: var(--border-radius-md); border: 1px solid var(--border-color); box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
            <div style="font-size: 10px; color: var(--text-muted); margin-bottom: var(--spacing-sm); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Critical Path & Blockages</div>
            <div style="display: flex; flex-direction: column; gap: var(--spacing-xs); max-height: 140px; overflow-y: auto; padding-right: 4px;">
              ${bottleneckListHtml}
            </div>
          </div>

          <!-- Column 3: AI Recommendations -->
          <div style="flex: 1.5; display: flex; flex-direction: column; min-width: 280px; padding: var(--spacing-md); background: var(--bg-secondary); border-radius: var(--border-radius-md); border: 1px solid var(--border-color); border-left: 3px solid var(--accent-purple); box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
            <div style="font-size: 10px; color: var(--accent-purple); margin-bottom: var(--spacing-sm); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px;">
              ${this.getIconSvg('predictive')} AI Sprint Advisor
            </div>
            <div style="display: flex; flex-direction: column; gap: var(--spacing-sm);">
              ${recommendationsListHtml}
            </div>
          </div>

        </div>

        <!-- Action Bar to rerun -->
        <div style="display: flex; justify-content: flex-end; width: 100%; margin-top: var(--spacing-sm);">
          <button id="runSimulationBtn" class="auth-btn" style="background: rgba(139, 84, 246, 0.1); border: 1px solid var(--accent-purple); padding: 8px 18px; color: var(--accent-purple); font-size: var(--font-size-xs); font-weight: bold; cursor: pointer; border-radius: var(--border-radius-sm); transition: background 0.2s; display: inline-flex; align-items: center; gap: 4px;">
            ${this.getIconSvg('predictive')} Rerun Simulation
          </button>
        </div>
      `;

      // Trigger the SVG gauge dashoffset transition trigger on next frame
      setTimeout(() => {
        const fillArc = panelContent.querySelector('#gaugePath');
        if (fillArc) {
          fillArc.style.strokeDashoffset = 126 - (126 * likelihood / 100);
        }
      }, 50);

      // Re-bind the click event on the newly injected Rerun button
      const newSimBtn = panelContent.querySelector('#runSimulationBtn');
      if (newSimBtn) {
        newSimBtn.addEventListener('click', () => this.handleRunSimulation());
      }

    } catch (err) {
      clearInterval(stageInterval);
      console.error('[SPRINT-SIMULATOR-ERROR] Failed to run sprint simulation:', err);
      panelContent.innerHTML = `
        <div style="text-align: center; padding: var(--spacing-lg) 0; border: 1px dashed var(--accent-rose); border-radius: var(--border-radius-md); background: rgba(255, 0, 85, 0.05);">
          <div style="color: var(--accent-rose); font-weight: bold; font-size: var(--font-size-sm); margin-bottom: var(--spacing-xs); display: flex; align-items: center; justify-content: center; gap: 4px;">
            ${this.getIconSvg('siren')} Predictive Simulation Run Failed
          </div>
          <p style="color: var(--text-muted); font-size: var(--font-size-xs); margin-bottom: var(--spacing-md);">${err.message}</p>
          <button id="runSimulationBtn" class="auth-btn" style="background: var(--bg-secondary); border: 1px solid var(--accent-rose); color: var(--accent-rose); padding: 8px 16px; border-radius: var(--border-radius-sm); font-weight: bold; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; margin: 0 auto;">
            Retry Simulation
          </button>
        </div>
      `;
      const retryBtn = panelContent.querySelector('#runSimulationBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => this.handleRunSimulation());
      }
    }
  }


  async loadAndProcessData() {
    // Renders visual skeleton loaders
    this.tasks = await api.getTasks();
    this.calculateMetrics();
  }

  calculateMetrics() {
    // Calculate global unfiltered statistics so that card totals remain static and fully representative
    const unfilteredTasks = [...this.tasks];
    const unfilteredTotalCount = unfilteredTasks.length;
    const unfilteredTotalPoints = unfilteredTasks.reduce((acc, curr) => acc + (curr.storyPoints || 0), 0);
    
    const unfilteredProgress = unfilteredTasks.filter(t => t.status === 'IN_PROGRESS');
    const unfilteredReview = unfilteredTasks.filter(t => t.status === 'REVIEW');
    const unfilteredDone = unfilteredTasks.filter(t => t.status === 'DONE');
    
    const unfilteredDonePoints = unfilteredDone.reduce((acc, curr) => acc + (curr.storyPoints || 0), 0);
    
    const today = new Date().toISOString().split('T')[0];
    const unfilteredOverdue = unfilteredTasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'DONE');

    // 1. Array Filtering
    let filteredTasks = [...this.tasks];
    if (this.filterType === 'HIGH_PRIORITY') {
      filteredTasks = this.tasks.filter(t => t.priority === 'HIGH');
    } else if (this.filterType === 'URGENT') {
      filteredTasks = this.tasks.filter(t => t.priority === 'URGENT');
    } else if (this.filterType === 'UNASSIGNED') {
      filteredTasks = this.tasks.filter(t => !t.assignee);
    } else if (this.filterType === 'IN_PROGRESS') {
      filteredTasks = this.tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'REVIEW');
    } else if (this.filterType === 'COMPLETED') {
      filteredTasks = this.tasks.filter(t => t.status === 'DONE');
    } else if (this.filterType === 'OVERDUE') {
      filteredTasks = this.tasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'DONE');
    }

    const filteredCount = document.getElementById('filteredCount');
    if (filteredCount) filteredCount.textContent = filteredTasks.length;

    // 2. Local statistics of the active scope for visual gauges
    const totalCount = filteredTasks.length;
    const doneTasks = filteredTasks.filter(t => t.status === 'DONE');
    const completionRate = totalCount > 0 ? Math.round((doneTasks.length / totalCount) * 100) : 0;

    // 3. Inject Stats Grid with interactive active states
    const statsContainer = document.getElementById('statsContainer');
    if (statsContainer) {
      statsContainer.innerHTML = `
        <div class="stat-card stat-card--cyan ${this.filterType === 'ALL' ? 'stat-card--active' : ''}" data-stat-filter="ALL" title="Filter by All Items">
          <div class="stat-card__title">Total Backlog Items</div>
          <div class="stat-card__value">${unfilteredTotalCount} Tasks</div>
          <div class="stat-card__trend text-cyan">Points estimate: ${unfilteredTotalPoints}SP</div>
        </div>
        <div class="stat-card stat-card--purple ${this.filterType === 'IN_PROGRESS' ? 'stat-card--active' : ''}" data-stat-filter="IN_PROGRESS" title="Filter by In-Progress Work">
          <div class="stat-card__title">In Progress Load</div>
          <div class="stat-card__value">${unfilteredProgress.length + unfilteredReview.length} Active</div>
          <div class="stat-card__trend text-purple">${unfilteredReview.length} in code review</div>
        </div>
        <div class="stat-card stat-card--emerald ${this.filterType === 'COMPLETED' ? 'stat-card--active' : ''}" data-stat-filter="COMPLETED" title="Filter by Completed Scope">
          <div class="stat-card__title">Completed Scope</div>
          <div class="stat-card__value">${unfilteredDone.length} Closed</div>
          <div class="stat-card__trend text-emerald">${unfilteredDonePoints} of ${unfilteredTotalPoints} SP delivered</div>
        </div>
        <div class="stat-card stat-card--rose ${this.filterType === 'OVERDUE' ? 'stat-card--active' : ''}" data-stat-filter="OVERDUE" title="Filter by SLA Exceptions">
          <div class="stat-card__title">SLA Exceptions</div>
          <div class="stat-card__value">${unfilteredOverdue.length} Overdue</div>
          <div class="stat-card__trend text-rose">Requires sprint adjustments</div>
        </div>
      `;

      // Bind dynamic click events for quick filters
      statsContainer.querySelectorAll('.stat-card').forEach(card => {
        card.onclick = async () => {
          const newFilter = card.getAttribute('data-stat-filter');
          this.filterType = newFilter;

          // Clear other filter buttons active outlines
          const buttons = this.container.querySelectorAll('.dashboard-filters .filter-btn');
          buttons.forEach(btn => {
            if (btn.getAttribute('data-filter') === newFilter) {
              btn.classList.add('filter-btn--active');
            } else {
              btn.classList.remove('filter-btn--active');
            }
          });

          await this.loadAndProcessData();
        };
      });
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

  getIconSvg(name) {
    const icons = {
      'warning': `<svg style="width: 14px; height: 14px; fill: var(--accent-amber); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
      'urgent': `<svg style="width: 14px; height: 14px; fill: #f97316; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8c0-5.39-4.5-9.33-4.5-9.33zM12 19c-2.21 0-4-1.79-4-4 0-.89.29-1.71.78-2.38 1.47 1.47 3.82 1.47 5.29 0C14.71 13.29 15 14.11 15 15c0 2.21-1.79 4-4 4z"/></svg>`,
      'user': `<svg style="width: 14px; height: 14px; fill: var(--text-muted); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
      'predictive': `<svg style="width: 16px; height: 16px; fill: var(--accent-purple); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`,
      'siren': `<svg style="width: 14px; height: 14px; fill: var(--accent-rose); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`,
      'success': `<svg style="width: 14px; height: 14px; fill: var(--accent-emerald); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
    };
    return icons[name] || '';
  }
}
