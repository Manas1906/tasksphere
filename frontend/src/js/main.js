import { api } from './api';
import { socket } from './websocket';
import { DashboardView } from './dashboard';
import { BoardView } from './board';
import { ChatController } from './chat';
import { AICopilot } from './copilot';

/**
 * TaskSphereApp - Day 12 & 14 Root System Assembly
 * Orchestrates routes, visualInspect overlays, dialogs, and real-time handshakes.
 */
class TaskSphereApp {
  constructor() {
    this.currentView = null;
    this.chatController = null;
    this.activeRoute = 'DASHBOARD'; // DASHBOARD, BOARD, AI_LAB
  }

  async start() {
    console.log('[APP-START] Bootstrapping TaskSphere Enterprise Workspace...');
    this.seedDemoData();
    this.bindNavigation();
    this.setupModals();
    this.setupLogin();
    this.setupMobileToggles();
    
    const token = localStorage.getItem('tasksphere_jwt');
    const loginOverlay = document.getElementById('loginOverlay');
    
    if (token) {
      console.log('[APP-START] Active JWT session recovered. Directing to active workspace.');
      this.applyProfileUI();
      if (loginOverlay) loginOverlay.classList.add('hidden');
      this.initRealtimeSync();
    } else {
      console.log('[APP-START] No active session found. Gating workspace behind secure login modal.');
      if (loginOverlay) loginOverlay.classList.remove('hidden');
    }
    
    // Default load dashboard
    this.switchRoute('DASHBOARD');
  }

  setupMobileToggles() {
    console.log('[APP-TOGGLES] Initializing desktop/mobile nav & chat toggle listeners.');
    const shell = document.getElementById('appShell');
    const sidebarToggle = document.getElementById('sidebarToggleBtn');
    const chatToggle = document.getElementById('mobileChatToggleBtn');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const chatBackdrop = document.getElementById('chatBackdrop');

    const closeMobileDrawers = () => {
      shell.classList.remove('app-shell--show-sidebar');
      shell.classList.remove('app-shell--show-chat');
    };

    if (sidebarToggle) {
      sidebarToggle.onclick = (e) => {
        e.stopPropagation();
        if (window.innerWidth <= 1024) {
          shell.classList.remove('app-shell--show-chat');
          shell.classList.toggle('app-shell--show-sidebar');
        } else {
          // Desktop sidebar collapse toggle
          shell.classList.toggle('app-shell--hide-sidebar');
        }
      };
    }

    if (chatToggle) {
      chatToggle.onclick = (e) => {
        e.stopPropagation();
        if (window.innerWidth <= 1024) {
          shell.classList.remove('app-shell--show-sidebar');
          shell.classList.toggle('app-shell--show-chat');
        } else {
          // Desktop chat collapse toggle
          shell.classList.toggle('app-shell--hide-chat');
        }
      };
    }

    if (sidebarBackdrop) sidebarBackdrop.onclick = closeMobileDrawers;
    if (chatBackdrop) chatBackdrop.onclick = closeMobileDrawers;

    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const closeChatBtn = document.getElementById('closeChatBtn');
    if (closeSidebarBtn) closeSidebarBtn.onclick = closeMobileDrawers;
    if (closeChatBtn) closeChatBtn.onclick = closeMobileDrawers;

    // Auto-close overlay drawers when navigating views
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', closeMobileDrawers);
    });
  }

  /**
   * Pre-populates clean local state caches to guarantee dazzling visual statistics instantly
   */
  seedDemoData() {
    if (!localStorage.getItem('cache_tasks')) {
      console.log('[APP-SEED] Seeding default visual scrum board tickets to local cache.');
      const demoTasks = [
        { id: 1, title: 'Establish Spring STOMP WebSocket Broker Pipeline', description: 'Scaffold spring-boot-starter-websocket configurations, routing prefixes, and Stomp protocol handshake filters.', status: 'DONE', priority: 'URGENT', storyPoints: 5, dueDate: '2026-05-18' },
        { id: 2, title: 'Implement Fluid Grid Outer Shell Layout System', description: 'Design 3-panel responsive CSS Grid layout including collapsible sidebars, scroll boxes, and clamp resizing.', status: 'DONE', priority: 'HIGH', storyPoints: 3, dueDate: '2026-05-19' },
        { id: 3, title: 'Scaffold PostgreSQL Database Connection Pools', description: 'Connect backend JPA layers to external Neon.tech postgres schemas using Environment Variables.', status: 'IN_PROGRESS', priority: 'HIGH', storyPoints: 5, dueDate: '2026-05-28' },
        { id: 4, title: 'BEM Nesting Architecture & CSS Variables Alignment', description: 'Refactor component classes into block__element--modifier guidelines and nested stylesheets.', status: 'TODO', priority: 'MEDIUM', storyPoints: 2, dueDate: '2026-06-01' },
        { id: 5, title: 'Construct SVG Velocity Chart & Compliance Gauge', description: 'Generate vector graphs, custom polyline calculations, and animated gauges using ES6 array operations.', status: 'TODO', priority: 'URGENT', storyPoints: 8, dueDate: '2026-05-20' }, // Overdue!
        { id: 6, title: 'Refactor Spring Data JPA Repository CRUD Transactions', description: 'Secure service boundary definitions, custom transactional isolation tags, and global ExceptionHandlers.', status: 'REVIEW', priority: 'HIGH', storyPoints: 3, dueDate: '2026-05-25' }
      ];
      localStorage.setItem('cache_tasks', JSON.stringify(demoTasks));
    }
  }

  setupLogin() {
    const loginOverlay = document.getElementById('loginOverlay');
    const emailForm = document.getElementById('emailSubmitForm');
    const otpForm = document.getElementById('otpSubmitForm');
    const formContainer = document.getElementById('authFormContainer');
    const subtitle = document.getElementById('authSubtitle');
    const errorMsg = document.getElementById('authErrorMsg');
    const changeEmailLink = document.getElementById('changeEmailLink');

    let submittedEmail = '';

    const showError = (msg) => {
      errorMsg.textContent = msg;
      errorMsg.classList.add('visible');
    };

    const clearError = () => {
      errorMsg.classList.remove('visible');
    };

    // 1. Submit Email Form to Dispatch OTP
    emailForm.onsubmit = (e) => {
      e.preventDefault();
      clearError();

      const emailInput = document.getElementById('authEmailInput');
      const sendBtn = document.getElementById('sendOtpBtn');
      const email = emailInput.value.trim();

      if (!email || !email.includes('@')) {
        showError('Please supply a valid email address.');
        return false;
      }

      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span class="auth-spinner"></span>Sending...';

      // Perform async fetch safely in the background
      (async () => {
        try {
          console.log(`[AUTH-OTP] Sending dynamic OTP dispatch request for email: ${email}`);
          await api.sendOtp(email);
          
          submittedEmail = email;
          subtitle.innerHTML = `Security code sent to:<br><b style="color: var(--accent-cyan); word-break: break-all;">${email}</b><br>Please enter it below.`;
          document.getElementById('authEmailStep').classList.add('hidden');
          document.getElementById('authOtpStep').classList.remove('hidden');
          document.getElementById('authOtpInput').focus();
        } catch (err) {
          console.error('[AUTH-OTP] OTP dispatch failed:', err);
          showError(err.message || 'Verification service failed. Please try again.');
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send Verification Code';
        }
      })();

      return false;
    };

    // 2. Submit OTP Code Form to Verify Session
    otpForm.onsubmit = (e) => {
      e.preventDefault();
      clearError();

      const otpInput = document.getElementById('authOtpInput');
      const verifyBtn = document.getElementById('verifyOtpBtn');
      const otp = otpInput.value.trim();

      if (otp.length !== 6 || isNaN(otp)) {
        showError('Verification code must be 6 digits.');
        return false;
      }

      verifyBtn.disabled = true;
      verifyBtn.innerHTML = '<span class="auth-spinner"></span>Verifying...';

      // Perform async verification safely in the background
      (async () => {
        try {
          console.log(`[AUTH-VERIFY] Verifying OTP: ${otp} for email: ${submittedEmail}`);
          const data = await api.verifyOtp(submittedEmail, otp);

          console.log('[AUTH-SUCCESS] OTP verified successfully. Establishing authorized workspace session.');
          
          // Cache JWT, profile and role
          localStorage.setItem('tasksphere_jwt', data.token);
          localStorage.setItem('chat_username', data.username);
          localStorage.setItem('chat_avatar', `https://api.dicebear.com/7.x/bottts/svg?seed=${data.username}`);
          localStorage.setItem('chat_role', 'DEVELOPER');

          this.applyProfileUI();

          // Unlock dashboard shell
          loginOverlay.classList.add('hidden');

          // Spin up live WebSocket broker sync
          this.initRealtimeSync();

          // Refresh views to trigger REST calls with valid bearer token
          this.switchRoute(this.activeRoute);
        } catch (err) {
          console.error('[AUTH-VERIFY] OTP verification failed:', err);
          showError(err.message || 'Invalid or expired verification code.');
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify & Authenticate';
        }
      })();

      return false;
    };

    // 3. Back to Email Link
    changeEmailLink.onclick = (e) => {
      e.preventDefault();
      document.getElementById('authOtpStep').classList.add('hidden');
      document.getElementById('authEmailStep').classList.remove('hidden');
      subtitle.textContent = 'Verify your identity to access the agile workspace';
      document.getElementById('authEmailInput').focus();
    };
  }

  applyProfileUI() {
    const username = localStorage.getItem('chat_username') || 'Guest';
    const role = localStorage.getItem('chat_role') || 'DEVELOPER';
    const avatar = localStorage.getItem('chat_avatar') || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

    document.getElementById('myUsername').textContent = username;
    document.getElementById('myRole').textContent = role.replace('_', ' ');
    document.getElementById('myAvatar').src = avatar;
  }

  initRealtimeSync() {
    console.log('[APP-SYNC] Instantiating ChatController and establishing socket handlers.');
    // Instantiate and initialize chat controller instantly so the Send button binds and works immediately
    this.chatController = new ChatController();
    this.chatController.init();

    // Connect socket
    socket.connect(
      () => {
        console.log('[APP-SYNC-SUCCESS] Socket connection established. Registering sync channels...');
        // Subscribe to real-time card updates channel
        socket.subscribe('/topic/board', (payload) => {
          console.log('[APP-SYNC-BOARD] Board card move payload received:', payload);
          if (this.activeRoute === 'BOARD' && this.currentView instanceof BoardView) {
            this.currentView.syncExternalMove(payload);
          } else {
            // Update local memory
            const idx = this.currentView.tasks.findIndex(t => t.id === payload.taskId);
            if (idx !== -1) {
              console.log(`[APP-SYNC-BOARD] Syncing card status update locally for Task ID ${payload.taskId}`);
              this.currentView.tasks[idx].status = payload.toStatus;
            }
          }
        });

        // Initialize Chat WebSocket subscriptions and presence sync
        this.chatController.subscribeChannels();
        this.chatController.syncMyPresence();
      },
      (err) => {
        console.error('[APP-SYNC-ERROR] Real-time broker connection dropped or unreachable. Running under degraded REST fallback sync.', err);
      }
    );
  }

  bindNavigation() {
    const dashboardBtn = document.getElementById('navDashboard');
    const boardBtn = document.getElementById('navBoard');
    const teamBtn = document.getElementById('navTeam');

    const clearActive = () => {
      dashboardBtn.classList.remove('filter-btn--active');
      boardBtn.classList.remove('filter-btn--active');
      teamBtn.classList.remove('filter-btn--active');
    };

    dashboardBtn.onclick = () => { clearActive(); dashboardBtn.classList.add('filter-btn--active'); this.switchRoute('DASHBOARD'); };
    boardBtn.onclick = () => { clearActive(); boardBtn.classList.add('filter-btn--active'); this.switchRoute('BOARD'); };
    teamBtn.onclick = () => { clearActive(); teamBtn.classList.add('filter-btn--active'); this.switchRoute('AI_LAB'); };

    // Figma Inspect Spec Mode toggle - Day 6 UI specifications
    const inspectBtn = document.getElementById('inspectModeBtn');
    inspectBtn.onclick = () => {
      document.body.classList.toggle('figma-inspect-mode');
      inspectBtn.classList.toggle('filter-btn--active');
      if (document.body.classList.contains('figma-inspect-mode')) {
        inspectBtn.textContent = 'Specs Inspector: ON';
      } else {
        inspectBtn.textContent = 'Figma Inspect';
      }
    };
  }

  setupModals() {
    const modal = document.getElementById('ticketModal');
    const openBtn = document.getElementById('sprintPlannerBtn');
    const closeBtn = document.getElementById('closeTicketModal');
    const cancelBtn = document.getElementById('cancelTicketBtn');
    const form = document.getElementById('ticketForm');

    openBtn.onclick = () => {
      // Clear form inputs
      form.reset();
      modal.querySelector('.modal-header__title').textContent = 'Create Scrum Ticket';
      
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

      // Clear checklist builder list
      form.querySelector('#checklistBuilderList').innerHTML = '';
      
      modal.classList.add('modal-overlay--active');
    };

    const closeModal = () => modal.classList.remove('modal-overlay--active');
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    // Handle ticket creation submission
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      const assigneeId = form.querySelector('#ticketAssignee').value;
      const members = JSON.parse(localStorage.getItem('cache_users') || '[]');
      const assignee = members.find(m => m.id === assigneeId) || null;

      // Extract checklist items
      const checklistItems = [];
      form.querySelectorAll('.checklist-builder-item').forEach(item => {
        checklistItems.push({
          content: item.querySelector('span').textContent,
          completed: false
        });
      });

      const payload = {
        title: form.querySelector('#ticketTitle').value.trim(),
        description: form.querySelector('#ticketDescription').value.trim(),
        priority: form.querySelector('#ticketPriority').value,
        storyPoints: parseInt(form.querySelector('#ticketPoints').value) || 3,
        dueDate: form.querySelector('#ticketDueDate').value || null,
        assignee: assignee,
        status: 'TODO',
        checklist: checklistItems
      };

      try {
        await api.createTask(payload);
      } catch (err) {
        console.warn('API error, task cached to memory.');
      }
      
      closeModal();
      
      // Reload current view
      if (this.activeRoute === 'DASHBOARD') {
        this.currentView.render();
      } else if (this.activeRoute === 'BOARD') {
        this.currentView.render();
      }
    };
  }

  async switchRoute(route) {
    this.activeRoute = route;

    if (route === 'DASHBOARD') {
      this.currentView = new DashboardView('mainContainer');
    } else if (route === 'BOARD') {
      this.currentView = new BoardView('mainContainer');
    } else if (route === 'AI_LAB') {
      this.currentView = new AICopilot('mainContainer');
    }

    await this.currentView.render();
  }
}

// Instantiate and launch app
const app = new TaskSphereApp();
window.addEventListener('DOMContentLoaded', () => app.start());
