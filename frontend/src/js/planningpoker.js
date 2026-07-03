import { socket } from './websocket';
import { api } from './api';

const POKER_CARDS = [1, 2, 3, 5, 8, 13, 21, '?'];

/**
 * PlanningPokerModal — real-time story point estimation session.
 * Opens a modal overlay, subscribes to /topic/poker, and manages
 * the full STARTED → VOTED → REVEALED state machine.
 */
export class PlanningPokerModal {
  constructor(tasks = []) {
    this.tasks = tasks;
    this.overlay = null;
    this.state = 'IDLE';     // IDLE | VOTING | REVEALED
    this.activeTaskId = null;
    this.activeTaskTitle = '';
    this.voterCount = 0;
    this.myVote = null;
    this.votes = {};
    this._subscription = null;
    this.myUsername = localStorage.getItem('chat_username') || 'guest';
  }

  open() {
    if (document.getElementById('pokerOverlay')) return;

    this.overlay = document.createElement('div');
    this.overlay.id = 'pokerOverlay';
    this.overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9000;
      display:flex;align-items:center;justify-content:center;padding:16px;
    `;
    this.overlay.innerHTML = `
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;
                  width:100%;max-width:560px;padding:24px;box-shadow:var(--shadow-xl);position:relative;">
        <button id="pokerClose" style="position:absolute;top:14px;right:16px;background:none;border:none;
                font-size:20px;cursor:pointer;color:var(--text-muted);">✕</button>
        <h2 style="margin:0 0 4px 0;font-size:18px;color:var(--accent-cyan);">🃏 Planning Poker</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 18px 0;">Real-time collaborative story point estimation</p>
        <div id="pokerBody"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);
    document.getElementById('pokerClose').onclick = () => this.close();
    this.overlay.onclick = (e) => { if (e.target === this.overlay) this.close(); };

    this._subscription = socket.subscribe('/topic/poker', (msg) => this._handleMessage(msg));
    this._renderIdle();
  }

  close() {
    if (this._subscription) { socket.unsubscribe('/topic/poker'); this._subscription = null; }
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this.state = 'IDLE';
    this.myVote = null;
    this.votes = {};
    this.voterCount = 0;
  }

  _handleMessage(msg) {
    switch (msg.event) {
      case 'STARTED':
        this.state = 'VOTING';
        this.activeTaskId = msg.taskId;
        this.activeTaskTitle = msg.taskTitle;
        this.voterCount = 0;
        this.myVote = null;
        this._renderVoting();
        break;
      case 'VOTED':
        this.voterCount = msg.voterCount;
        this._updateVoterCount();
        break;
      case 'REVEALED':
        this.state = 'REVEALED';
        this.votes = msg.votes || {};
        this._renderRevealed(msg.average);
        break;
    }
  }

  _renderIdle() {
    const body = document.getElementById('pokerBody');
    if (!body) return;
    const taskOptions = this.tasks
      .filter(t => t.status !== 'DONE')
      .map(t => `<option value="${t.id}" data-title="${t.title?.replace(/"/g, '&quot;') || ''}">#${t.id} — ${t.title}</option>`)
      .join('');
    body.innerHTML = `
      <div style="margin-bottom:14px;">
        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px;">Select a task to estimate</label>
        <select id="pokerTaskSelect" style="width:100%;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:7px 10px;font-size:13px;color:var(--text-primary);">
          <option value="">-- choose task --</option>
          ${taskOptions}
        </select>
      </div>
      <button id="pokerStartBtn" class="btn btn--primary" style="width:100%;padding:10px;">Start Estimation Session</button>
      <p style="font-size:11px;color:var(--text-muted);margin-top:10px;text-align:center;">All connected team members will see the session and can vote.</p>
    `;
    document.getElementById('pokerStartBtn').onclick = () => {
      const sel = document.getElementById('pokerTaskSelect');
      if (!sel.value) return alert('Please select a task first.');
      const taskId = parseInt(sel.value);
      const taskTitle = sel.options[sel.selectedIndex].dataset.title || `Task #${taskId}`;
      socket.send('/app/poker.start', { taskId, taskTitle, username: this.myUsername });
    };
  }

  _renderVoting() {
    const body = document.getElementById('pokerBody');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text-muted);">Estimating</div>
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-top:4px;">${this.activeTaskTitle}</div>
        <div id="pokerVoterCount" style="font-size:12px;color:var(--accent-cyan);margin-top:6px;">
          ${this.voterCount} vote${this.voterCount !== 1 ? 's' : ''} submitted
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:20px;" id="pokerCards">
        ${POKER_CARDS.map(v => `
          <button class="poker-card-btn" data-val="${v}" style="
            width:52px;height:72px;border-radius:8px;border:2px solid var(--border-color);
            background:var(--bg-primary);color:var(--text-primary);font-size:18px;font-weight:700;
            cursor:pointer;transition:all .15s;
          ">${v}</button>
        `).join('')}
      </div>
      <div id="pokerVoteStatus" style="text-align:center;font-size:13px;color:var(--text-muted);margin-bottom:14px;"></div>
      <button id="pokerRevealBtn" class="btn btn--ghost" style="width:100%;padding:9px;font-size:13px;">
        👁 Reveal All Votes
      </button>
    `;
    body.querySelectorAll('.poker-card-btn').forEach(btn => {
      btn.onclick = () => {
        const val = btn.dataset.val === '?' ? 0 : parseInt(btn.dataset.val);
        this.myVote = val;
        body.querySelectorAll('.poker-card-btn').forEach(b => {
          b.style.background = b === btn ? 'var(--accent-cyan)' : 'var(--bg-primary)';
          b.style.color = b === btn ? '#000' : 'var(--text-primary)';
          b.style.borderColor = b === btn ? 'var(--accent-cyan)' : 'var(--border-color)';
        });
        document.getElementById('pokerVoteStatus').textContent = `✅ You voted ${btn.dataset.val}`;
        socket.send('/app/poker.vote', { taskId: this.activeTaskId, username: this.myUsername, points: val });
      };
    });
    document.getElementById('pokerRevealBtn').onclick = () => {
      socket.send('/app/poker.reveal', { taskId: this.activeTaskId, username: this.myUsername });
    };
  }

  _updateVoterCount() {
    const el = document.getElementById('pokerVoterCount');
    if (el) el.textContent = `${this.voterCount} vote${this.voterCount !== 1 ? 's' : ''} submitted`;
  }

  _renderRevealed(average) {
    const body = document.getElementById('pokerBody');
    if (!body) return;
    const entries = Object.entries(this.votes);
    const votesHtml = entries.map(([user, pts]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;
                  background:var(--bg-primary);border-radius:6px;margin-bottom:6px;">
        <span style="font-size:13px;">${user}</span>
        <span style="font-size:18px;font-weight:700;color:var(--accent-cyan);">${pts === 0 ? '?' : pts}</span>
      </div>
    `).join('');
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text-muted);">Results for</div>
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-top:4px;">${this.activeTaskTitle}</div>
      </div>
      <div style="margin-bottom:16px;">${votesHtml || '<p style="color:var(--text-muted);text-align:center;font-size:13px;">No votes recorded.</p>'}</div>
      <div style="text-align:center;background:var(--bg-primary);border-radius:8px;padding:14px;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text-muted);">Team Average</div>
        <div style="font-size:36px;font-weight:900;color:var(--accent-cyan);">${average}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button id="pokerApplyBtn" class="btn btn--primary" style="flex:1;padding:9px;font-size:13px;">
          ✓ Apply ${Math.round(average)} SP to Task
        </button>
        <button id="pokerRestartBtn" class="btn btn--ghost" style="flex:1;padding:9px;font-size:13px;">
          🔄 New Session
        </button>
      </div>
    `;
    document.getElementById('pokerApplyBtn').onclick = async () => {
      const sp = Math.round(average);
      try {
        const task = await api.getTaskById(this.activeTaskId);
        if (task) {
          task.storyPoints = sp;
          await api.updateTask(this.activeTaskId, task);
          document.getElementById('pokerApplyBtn').textContent = `✅ Applied ${sp} SP`;
          document.getElementById('pokerApplyBtn').disabled = true;
        }
      } catch (e) { alert('Failed to apply story points.'); }
    };
    document.getElementById('pokerRestartBtn').onclick = () => {
      this.state = 'IDLE'; this.myVote = null; this.votes = {}; this.voterCount = 0;
      this._renderIdle();
    };
  }
}
