import { api } from './api';
import { socket } from './websocket';
import { DashboardView } from './dashboard';
import { BoardView } from './board';
import { ChatController } from './chat';
import { AICopilot } from './copilot';
import { AIChatbot } from './chatbot';
import { AdminView } from './admin';

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
    this.setupProfileDropdown();
    this.setupThemeToggle();
    
    // Initialize floating AI Scrum Assistant Chatbot
    try {
      new AIChatbot().init();
    } catch (chatbotErr) {
      console.warn('[CHATBOT-ERROR] Failed to start chatbot:', chatbotErr);
    }
    
    const token = localStorage.getItem('tasksphere_jwt');
    const username = localStorage.getItem('chat_username');
    const role = localStorage.getItem('chat_role');
    const loginOverlay = document.getElementById('loginOverlay');
    
    if (token && username && role) {
      console.log('[APP-START] Active JWT session recovered. Checking approval status...');
      
      // Before letting them in, verify their status is not PENDING_APPROVAL
      (async () => {
        try {
          const users = await api.getUsers() || [];
          const me = users.find(u => u.username === username);
          if (me && me.status === 'PENDING_APPROVAL') {
            console.log('[APP-START] Recovered session requires admin approval. Gating.');
            if (loginOverlay) loginOverlay.classList.remove('hidden');
            this.waitForApproval(username, role);
            return;
          }
        } catch (e) {
          console.warn('[APP-START] Could not verify database registration status, assuming active.', e);
        }
        
        console.log('[APP-START] Active JWT session recovered. Directing to active workspace.');
        this.applyProfileUI();
        if (loginOverlay) loginOverlay.classList.add('hidden');

        // Recover email directly from JWT subject claim if missing to self-heal browser state
        let email = localStorage.getItem('tasksphere_email');
        if (!email && token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            email = payload.sub;
            if (email) {
              localStorage.setItem('tasksphere_email', email);
            }
          } catch (jwtErr) {
            console.warn('[APP-START] Failed to decode email from active JWT:', jwtErr);
          }
        }

        if (email) {
          localStorage.setItem('profile_' + email.toLowerCase().trim(), JSON.stringify({
            username: username,
            role: role,
            avatarUrl: localStorage.getItem('chat_avatar') || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
          }));
        }

        this.toggleAdminTab();
        this.initRealtimeSync();
      })();
    } else {
      console.log('[APP-START] No active session or incomplete profile. Gating workspace behind login overlay.');
      if (loginOverlay) {
        loginOverlay.classList.remove('hidden');
        if (token) {
          console.log('[APP-START] JWT session found but profile incomplete. Navigating to Step 3 Profile Initialization.');
          document.getElementById('authEmailStep').classList.add('hidden');
          document.getElementById('authOtpStep').classList.add('hidden');
          document.getElementById('authProfileStep').classList.remove('hidden');
          
          document.querySelector('.auth-card__logo').textContent = 'Initialize Developer Session';
          document.querySelector('.auth-card__logo').style.fontSize = 'var(--font-size-lg)';
          document.querySelector('.auth-card__logo').style.letterSpacing = '1px';
          
          const subtitle = document.getElementById('authSubtitle');
          if (subtitle) subtitle.textContent = '';
          
          const userPrefix = localStorage.getItem('chat_username') || '';
          document.getElementById('authUsernameInput').value = userPrefix;
          document.getElementById('authUsernameInput').focus();
        }
      }
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
    const profileForm = document.getElementById('profileSubmitForm');
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

          console.log('[AUTH-SUCCESS] OTP verified successfully. Checking profile state.');
          
          // Cache JWT immediately
          localStorage.setItem('tasksphere_jwt', data.token);
          localStorage.setItem('tasksphere_email', submittedEmail);

          // Dual-layered bypass strategy (local cache check first, then remote database list fallback)
          let isPreviouslyRegistered = false;
          let existingProfile = null;
          
          // 1. Try local cache check first (handles browser re-logins and database resets)
          try {
            const localCached = localStorage.getItem('profile_' + submittedEmail.toLowerCase().trim());
            if (localCached) {
              existingProfile = JSON.parse(localCached);
              isPreviouslyRegistered = true;
              console.log('[AUTH-CHECK] Local profile cache found:', existingProfile);
            }
          } catch (localErr) {
            console.warn('[AUTH-CHECK] Failed to parse local profile cache:', localErr);
          }

          // 2. Fallback to querying active users in the database
          if (!isPreviouslyRegistered) {
            try {
              const users = await api.getUsers();
              existingProfile = users.find(u => u.username.toLowerCase() === data.username.toLowerCase());
              if (existingProfile) {
                isPreviouslyRegistered = true;
                console.log('[AUTH-CHECK] Database profile found:', existingProfile);
                
                // Cache it locally to speed up subsequent logins
                localStorage.setItem('profile_' + submittedEmail.toLowerCase().trim(), JSON.stringify({
                  username: existingProfile.username,
                  role: existingProfile.role,
                  avatarUrl: existingProfile.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${existingProfile.username}`
                }));
              }
            } catch (fetchErr) {
              console.warn('[AUTH-CHECK] Failed to fetch active users list, defaulting to manual profile setup:', fetchErr);
            }
          }



          if (isPreviouslyRegistered && existingProfile) {
            console.log('[AUTH-LOGIN] Previously registered user recognized. Auto-bypassing Profile Setup.');
            
            // Persist details locally
            localStorage.setItem('chat_username', existingProfile.username);
            localStorage.setItem('chat_role', existingProfile.role);
            localStorage.setItem('chat_avatar', existingProfile.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${existingProfile.username}`);
            
            // Log in silently on backend to register active ONLINE session status
            const activeSession = await api.login({
              username: existingProfile.username,
              role: existingProfile.role,
              avatarUrl: existingProfile.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${existingProfile.username}`,
              status: 'ONLINE'
            });

            if (activeSession && activeSession.status === 'PENDING_APPROVAL') {
              console.log('[AUTH-LOGIN] Session requires administrator activation.');
              this.waitForApproval(existingProfile.username, existingProfile.role);
            } else {
              console.log('[AUTH-LOGIN] Session authorized immediately.');
              // Update UI headers
              this.applyProfileUI();
              
              // Hide overlay card
              loginOverlay.classList.add('hidden');
              this.toggleAdminTab();
              
              // Initialize sockets synchronization
              this.initRealtimeSync();
              
              // Refresh views (trigger current nav filter click to populate cards under correct profile details)
              const activeNav = document.querySelector('.filter-btn--active');
              if (activeNav) {
                activeNav.click();
              }
            }
          } else {
            console.log('[AUTH-PROFILE] First-time user detected. Transitioning to Step 3 Profile Selection.');
            // Transition to Step 3 Profile setup
            document.getElementById('authOtpStep').classList.add('hidden');
            document.getElementById('authProfileStep').classList.remove('hidden');
            
            // Dynamic title conversion matching mockup
            document.querySelector('.auth-card__logo').textContent = 'Initialize Developer Session';
            document.querySelector('.auth-card__logo').style.fontSize = 'var(--font-size-lg)';
            document.querySelector('.auth-card__logo').style.letterSpacing = '1px';
            subtitle.textContent = '';
            
            // Pre-populate input with server's suggested username prefix
            const usernameInput = document.getElementById('authUsernameInput');
            usernameInput.value = data.username || '';
            usernameInput.focus();
          }
        } catch (err) {
          console.error('[AUTH-VERIFY] OTP verification failed:', err);
          const displayMsg = err.message === 'Invalid or expired verification code.' ? 'Wrong OTP' : (err.message || 'Invalid or expired verification code.');
          showError(displayMsg);
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify & Authenticate';
        }
      })();

      return false;
    };

    // 3. Submit Profile Form to Launch Workspace
    if (profileForm) {
      profileForm.onsubmit = (e) => {
        e.preventDefault();
        clearError();

        const usernameInput = document.getElementById('authUsernameInput');
        const roleSelect = document.getElementById('authRoleSelect');
        const launchBtn = document.getElementById('launchWorkspaceBtn');

        const username = usernameInput.value.trim();
        const role = roleSelect.value;

        if (!username) {
          showError('Session Username is required.');
          return false;
        }

        launchBtn.disabled = true;
        launchBtn.innerHTML = '<span class="auth-spinner"></span>Launching...';

        (async () => {
          try {
            console.log(`[AUTH-PROFILE] Finalizing user profile: ${username} as role: ${role}`);
            
            // Call /api/users/login to register active session on backend
            const activeSession = await api.login({
              username: username,
              role: role,
              avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
              status: 'ONLINE'
            });

            if (activeSession && activeSession.status === 'PENDING_APPROVAL') {
              console.log('[AUTH-PROFILE] User session requires administrator activation.');
              
              // Persist locally for blocker display / reload recovery
              localStorage.setItem('chat_username', username);
              localStorage.setItem('chat_role', role);
              localStorage.setItem('chat_avatar', `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`);
              
              // Trigger the blocker flow
              this.waitForApproval(username, role);
            } else {
              console.log('[AUTH-PROFILE] User session authorized immediately.');
              
              // Persist locally
              localStorage.setItem('chat_username', username);
              localStorage.setItem('chat_role', role);
              localStorage.setItem('chat_avatar', `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`);

              // Cache profile details for the active email to bypass Step 3 during next login on this browser (even after H2 reset)
              const activeEmail = localStorage.getItem('tasksphere_email');
              if (activeEmail) {
                localStorage.setItem('profile_' + activeEmail.toLowerCase().trim(), JSON.stringify({
                  username: username,
                  role: role,
                  avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
                }));
              }

              // Update UI headers
              this.applyProfileUI();

              // Hide overlay card
              loginOverlay.classList.add('hidden');
              this.toggleAdminTab();

              // Initialize sockets synchronization
              this.initRealtimeSync();

              // Refresh views
              this.switchRoute(this.activeRoute);
            }
          } catch (err) {
            console.error('[AUTH-PROFILE] Profile setup failed:', err);
            showError(err.message || 'Failed to initialize session. Please try again.');
          } finally {
            launchBtn.disabled = false;
            launchBtn.textContent = 'Launch Workspace';
          }
        })();

        return false;
      };
    }

    // 4. Back to Email Link
    changeEmailLink.onclick = (e) => {
      e.preventDefault();
      
      // Restore default branding header
      document.querySelector('.auth-card__logo').textContent = 'TaskSphere';
      document.querySelector('.auth-card__logo').style.fontSize = '';
      document.querySelector('.auth-card__logo').style.letterSpacing = '';
      subtitle.textContent = 'Verify your identity to access the agile workspace';

      document.getElementById('authOtpStep').classList.add('hidden');
      document.getElementById('authEmailStep').classList.remove('hidden');
      document.getElementById('authEmailInput').focus();
    };
  }

  applyProfileUI() {
    const username = localStorage.getItem('chat_username') || 'Guest';
    const role = localStorage.getItem('chat_role') || 'DEVELOPER';
    const avatar = localStorage.getItem('chat_avatar') || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
    const email = localStorage.getItem('tasksphere_email') || `${username.toLowerCase()}@tasksphere.com`;

    document.getElementById('myUsername').textContent = username;
    document.getElementById('myRole').textContent = role.replace(/_/g, ' ');
    document.getElementById('myAvatar').src = avatar;

    // Populate profile dropdown popup elements
    const dName = document.getElementById('dropdownUsername');
    const dRole = document.getElementById('dropdownRole');
    const dAvatar = document.getElementById('dropdownAvatar');
    const dEmail = document.getElementById('dropdownEmail');

    if (dName) dName.textContent = username;
    if (dRole) dRole.textContent = role.replace(/_/g, ' ');
    if (dAvatar) dAvatar.src = avatar;
    if (dEmail) dEmail.textContent = email;
  }

  setupProfileDropdown() {
    const badge = document.getElementById('currentUserBadge');
    const dropdown = document.getElementById('profileDropdown');
    const logoutBtn = document.getElementById('logoutBtn');

    if (!badge || !dropdown) return;

    // Toggle dropdown card visibility
    badge.onclick = (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    };

    // Close dropdown card when clicking outside
    document.addEventListener('click', (e) => {
      if (!badge.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });

    // Handle logout click handler
    if (logoutBtn) {
      logoutBtn.onclick = (e) => {
        e.preventDefault();
        console.log('[AUTH-LOGOUT] Terminating session. Wiping local security context...');

        // Wipe local storage credentials
        localStorage.removeItem('tasksphere_jwt');
        localStorage.removeItem('chat_username');
        localStorage.removeItem('chat_role');
        localStorage.removeItem('chat_avatar');
        localStorage.removeItem('tasksphere_email');

        // Disconnect WebSockets
        try {
          socket.disconnect();
        } catch (err) {
          console.warn('[AUTH-LOGOUT] WebSocket close failed:', err);
        }

        // Full clean reload to trigger standard gated startup overlay state
        window.location.reload();
      };
    }
  }

  setupThemeToggle() {
    const btn = document.getElementById('themeToggleBtn');
    const icon = document.getElementById('themeToggleIcon');
    const label = document.getElementById('themeToggleLabel');

    if (!btn || !icon || !label) return;

    // Load active state from localStorage
    const savedTheme = localStorage.getItem('tasksphere_theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
      icon.textContent = '🌙';
      label.textContent = 'Dark Mode';
    } else {
      document.body.classList.remove('light-theme');
      icon.textContent = '☀️';
      label.textContent = 'Light Mode';
    }

    // Toggle active state on click
    btn.onclick = (e) => {
      e.stopPropagation();
      const isLight = document.body.classList.toggle('light-theme');
      if (isLight) {
        localStorage.setItem('tasksphere_theme', 'light');
        icon.textContent = '🌙';
        label.textContent = 'Dark Mode';
      } else {
        localStorage.setItem('tasksphere_theme', 'dark');
        icon.textContent = '☀️';
        label.textContent = 'Light Mode';
      }
    };
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
    const adminBtn = document.getElementById('navAdmin');
 
    const clearActive = () => {
      dashboardBtn.classList.remove('filter-btn--active');
      boardBtn.classList.remove('filter-btn--active');
      teamBtn.classList.remove('filter-btn--active');
      if (adminBtn) adminBtn.classList.remove('filter-btn--active');
    };
 
    dashboardBtn.onclick = () => { clearActive(); dashboardBtn.classList.add('filter-btn--active'); this.switchRoute('DASHBOARD'); };
    boardBtn.onclick = () => { clearActive(); boardBtn.classList.add('filter-btn--active'); this.switchRoute('BOARD'); };
    teamBtn.onclick = () => { clearActive(); teamBtn.classList.add('filter-btn--active'); this.switchRoute('AI_LAB'); };
    if (adminBtn) {
      adminBtn.onclick = () => { clearActive(); adminBtn.classList.add('filter-btn--active'); this.switchRoute('ADMIN_PANEL'); };
    }

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

  waitForApproval(username, role) {
    console.log(`[APPROVAL-GATE] Gating session for user: ${username} (Role: ${role}). Awaiting admin activation...`);
    
    // Switch auth step card views to blocker
    document.getElementById('authEmailStep').classList.add('hidden');
    document.getElementById('authOtpStep').classList.add('hidden');
    document.getElementById('authProfileStep').classList.add('hidden');
    document.getElementById('authApprovalStep').classList.remove('hidden');
    document.getElementById('blockedRoleText').textContent = role.replace(/_/g, ' ');
 
    // Subtitle check
    const subtitle = document.getElementById('authSubtitle');
    if (subtitle) subtitle.textContent = '';
    document.querySelector('.auth-card__logo').textContent = 'Workspace Lock';
 
    // Connect WebSocket to listen to active presence updates for immediate activation
    socket.connect(
      () => {
        console.log('[APPROVAL-GATE-WS] WebSocket established. Subscribing to presence stream...');
        socket.subscribe('/topic/users', (presenceUpdate) => {
          console.log('[APPROVAL-GATE-WS] Received presence broadcast:', presenceUpdate);
          if (presenceUpdate.username === username && presenceUpdate.status === 'ONLINE' && presenceUpdate.action === 'APPROVED') {
            console.log('[APPROVAL-GATE-WS] Real-time approval received! Launching workspace.');
            clearInterval(intervalId);
            socket.disconnect();
            this.handleApprovalSuccess(username, role);
          } else if (presenceUpdate.username === username && presenceUpdate.status === 'OFFLINE' && presenceUpdate.action === 'REJECTED') {
            console.log('[APPROVAL-GATE-WS] Session rejected. Resetting credentials.');
            clearInterval(intervalId);
            socket.disconnect();
            alert('Your request to join the workspace has been declined by an administrator.');
            localStorage.removeItem('tasksphere_jwt');
            localStorage.removeItem('chat_username');
            localStorage.removeItem('chat_role');
            localStorage.removeItem('chat_avatar');
            localStorage.removeItem('tasksphere_email');
            window.location.reload();
          }
        });
      },
      (err) => {
        console.warn('[APPROVAL-GATE-WS] Real-time WS connection unreachable, relying on REST polling.', err);
      }
    );
 
    // Fallback polling registry status verification check (every 5 seconds)
    const intervalId = setInterval(async () => {
      try {
        const users = await api.getUsers() || [];
        const me = users.find(u => u.username === username);
        
        if (!me) {
          // Admin deleted user
          console.log('[APPROVAL-GATE-POLL] User removed from database. Resetting...');
          clearInterval(intervalId);
          socket.disconnect();
          localStorage.removeItem('tasksphere_jwt');
          localStorage.removeItem('chat_username');
          localStorage.removeItem('chat_role');
          localStorage.removeItem('chat_avatar');
          localStorage.removeItem('tasksphere_email');
          window.location.reload();
          return;
        }
 
        if (me && me.status !== 'PENDING_APPROVAL') {
          console.log('[APPROVAL-GATE-POLL] User status transition recognized! Unblocking.');
          clearInterval(intervalId);
          socket.disconnect();
          this.handleApprovalSuccess(username, role);
        }
      } catch (pollErr) {
        console.warn('[APPROVAL-GATE-POLL] Directory polling status fetch failed:', pollErr);
      }
    }, 5000);
 
    // Bind cancel approval back button to reset storage and refresh
    const cancelBtn = document.getElementById('cancelApprovalBtn');
    if (cancelBtn) {
      cancelBtn.onclick = (e) => {
        e.preventDefault();
        clearInterval(intervalId);
        socket.disconnect();
        
        localStorage.removeItem('tasksphere_jwt');
        localStorage.removeItem('chat_username');
        localStorage.removeItem('chat_role');
        localStorage.removeItem('chat_avatar');
        localStorage.removeItem('tasksphere_email');
        
        window.location.reload();
      };
    }
  }
 
  handleApprovalSuccess(username, role) {
    console.log(`[APPROVAL-SUCCESS] Granting full access credentials to username: ${username}`);
    
    // Cache profile details for the active email to bypass OTP setup completely
    const email = localStorage.getItem('tasksphere_email');
    if (email) {
      localStorage.setItem('profile_' + email.toLowerCase().trim(), JSON.stringify({
        username: username,
        role: role,
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
      }));
    }
 
    // Close blocking overlay
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) loginOverlay.classList.add('hidden');
    document.getElementById('authApprovalStep').classList.add('hidden');
 
    // Apply layout changes
    this.applyProfileUI();
    this.toggleAdminTab();
    this.initRealtimeSync();
    
    // Load Dashboard
    this.switchRoute('DASHBOARD');
  }
 
  toggleAdminTab() {
    const role = localStorage.getItem('chat_role') || 'DEVELOPER';
    const adminNav = document.getElementById('navAdminItem');
    if (adminNav) {
      if (role === 'PRODUCT_OWNER' || role === 'MANAGER') {
        adminNav.style.display = 'block';
      } else {
        adminNav.style.display = 'none';
      }
    }
  }
 
  async switchRoute(route) {
    this.activeRoute = route;
 
    if (route === 'DASHBOARD') {
      this.currentView = new DashboardView('mainContainer');
    } else if (route === 'BOARD') {
      this.currentView = new BoardView('mainContainer');
    } else if (route === 'AI_LAB') {
      this.currentView = new AICopilot('mainContainer');
    } else if (route === 'ADMIN_PANEL') {
      this.currentView = new AdminView('mainContainer');
    }
 
    await this.currentView.render();
  }
}

// Instantiate and launch app
const app = new TaskSphereApp();
window.addEventListener('DOMContentLoaded', () => app.start());
