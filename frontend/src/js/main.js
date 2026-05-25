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
    this.setupSecuritySettings();
    this.setupPasswordToggles();
    
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
          document.getElementById('authLoginStep').classList.add('hidden');
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
    const loginForm = document.getElementById('loginSubmitForm');
    const registerForm = document.getElementById('registerEmailForm');
    const otpForm = document.getElementById('otpSubmitForm');
    const profileForm = document.getElementById('profileSubmitForm');
    const subtitle = document.getElementById('authSubtitle');
    const errorMsg = document.getElementById('authErrorMsg');

    const createAccountBtn = document.getElementById('createAccountBtn');
    const backToLoginLink = document.getElementById('backToLoginLink');
    const backToRegisterLink = document.getElementById('backToRegisterLink');
    const cancelMfaLink = document.getElementById('cancelMfaLink');

    let submittedEmail = '';

    const showError = (msg) => {
      errorMsg.textContent = msg;
      errorMsg.classList.add('visible');
    };

    const clearError = () => {
      errorMsg.classList.remove('visible');
    };

    // --- Action Button Triggers for Steps Navigation ---

    if (createAccountBtn) {
      createAccountBtn.onclick = () => {
        clearError();
        document.getElementById('authLoginStep').classList.add('hidden');
        document.getElementById('authRegisterStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your email to verify and register';
        document.getElementById('registerEmailInput').focus();
      };
    }

    if (backToLoginLink) {
      backToLoginLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authRegisterStep').classList.add('hidden');
        document.getElementById('authLoginStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your credentials to access the workspace';
        document.getElementById('loginEmailInput').focus();
      };
    }

    if (backToRegisterLink) {
      backToRegisterLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authOtpStep').classList.add('hidden');
        document.getElementById('authRegisterStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your email to verify and register';
        document.getElementById('registerEmailInput').focus();
      };
    }

    if (cancelMfaLink) {
      cancelMfaLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authMfaOtpStep').classList.add('hidden');
        document.getElementById('authLoginStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your credentials to access the workspace';
        document.getElementById('loginPasswordInput').focus();
      };
    }

    // --- Submission Handlers ---

    // 1. Submit Unified Password Login Form
    if (loginForm) {
      loginForm.onsubmit = async (e) => {
        e.preventDefault();
        clearError();

        const emailInput = document.getElementById('loginEmailInput');
        const passwordInput = document.getElementById('loginPasswordInput');
        const submitBtn = document.getElementById('submitLoginBtn');

        const emailVal = emailInput.value.trim();
        const passwordVal = passwordInput.value;

        if (!emailVal || !emailVal.includes('@')) {
          showError('Please supply a valid email address.');
          return false;
        }

        if (!passwordVal) {
          showError('Password is required.');
          return false;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="auth-spinner"></span>Logging In...';

        try {
          console.log('[AUTH-LOGIN] Submitting password login for:', emailVal);
          const res = await api.request('/auth/password/login', {
            method: 'POST',
            body: JSON.stringify({ email: emailVal, password: passwordVal })
          });

          if (res.mfaRequired) {
            console.log('[AUTH-LOGIN] Password verified. MFA OTP is required.');
            localStorage.setItem('tasksphere_email', emailVal);
            submittedEmail = emailVal;

            document.getElementById('authLoginStep').classList.add('hidden');
            document.getElementById('authMfaOtpStep').classList.remove('hidden');
            document.getElementById('authMfaOtpInput').value = '';
            document.getElementById('authMfaOtpInput').focus();
          } else if (res.success && res.token) {
            console.log('[AUTH-LOGIN] Direct login authorized.');
            
            localStorage.setItem('tasksphere_jwt', res.token);
            localStorage.setItem('chat_username', res.username);
            localStorage.setItem('chat_role', res.role);
            localStorage.setItem('chat_avatar', res.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${res.username}`);
            localStorage.setItem('tasksphere_email', emailVal);

            // BypassOTP local caching details
            localStorage.setItem('profile_' + emailVal.toLowerCase().trim(), JSON.stringify({
              username: res.username,
              role: res.role,
              avatarUrl: res.avatarUrl
            }));

            this.applyProfileUI();
            
            if (loginOverlay) loginOverlay.classList.add('hidden');
            this.toggleAdminTab();
            this.initRealtimeSync();
            this.switchRoute(this.activeRoute);
          }
        } catch (err) {
          console.error('[AUTH-LOGIN] Login validation failed:', err);
          showError(err.message || 'Incorrect email or password.');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Log In';
        }
        return false;
      };
    }

    // 2. Submit Email Registration Form (OTP request)
    if (registerForm) {
      registerForm.onsubmit = (e) => {
        e.preventDefault();
        clearError();

        const emailInput = document.getElementById('registerEmailInput');
        const sendBtn = document.getElementById('sendRegisterOtpBtn');
        const email = emailInput.value.trim();

        if (!email || !email.includes('@')) {
          showError('Please supply a valid email address.');
          return false;
        }

        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="auth-spinner"></span>Verifying...';

        (async () => {
          try {
            console.log(`[AUTH-REGISTER-CHECK] Checking if email ${email} is already registered...`);
            const checkResult = await api.checkEmail(email);

            if (checkResult && checkResult.registered) {
              showError('This email address is already registered. Please log in using your password!');
              return;
            }

            console.log(`[AUTH-REGISTER-OTP] Sending dynamic OTP dispatch request for email: ${email}`);
            await api.sendOtp(email);
            
            submittedEmail = email;
            subtitle.innerHTML = `Security code sent to:<br><b style="color: var(--accent-cyan); word-break: break-all;">${email}</b><br>Please enter it below.`;
            document.getElementById('authRegisterStep').classList.add('hidden');
            document.getElementById('authOtpStep').classList.remove('hidden');
            document.getElementById('authOtpInput').value = '';
            document.getElementById('authOtpInput').focus();
          } catch (err) {
            console.error('[AUTH-REGISTER-OTP] OTP dispatch failed:', err);
            showError(err.message || 'Verification service failed. Please try again.');
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Verification Code';
          }
        })();

        return false;
      };
    }

    // 3. Submit OTP Code Form to Verify Session
    if (otpForm) {
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

        (async () => {
          try {
            console.log(`[AUTH-VERIFY] Verifying OTP: ${otp} for email: ${submittedEmail}`);
            const data = await api.verifyOtp(submittedEmail, otp);

            console.log('[AUTH-SUCCESS] OTP verified successfully. Preparing profile session.');
            
            localStorage.setItem('tasksphere_jwt', data.token);
            localStorage.setItem('tasksphere_email', submittedEmail);

            // Since it's OTP registration, we ALWAYS route them to Step 3 Profile Setup
            // to choose Username, Role, and Password for H2/Database persistence!
            console.log('[AUTH-PROFILE] Routing to Step 3 Profile Selection.');
            
            document.getElementById('authOtpStep').classList.add('hidden');
            document.getElementById('authProfileStep').classList.remove('hidden');
            
            document.querySelector('.auth-card__logo').textContent = 'Initialize Developer Session';
            document.querySelector('.auth-card__logo').style.fontSize = 'var(--font-size-lg)';
            document.querySelector('.auth-card__logo').style.letterSpacing = '1px';
            subtitle.textContent = '';
            
            const usernameInput = document.getElementById('authUsernameInput');
            usernameInput.value = data.username || '';
            usernameInput.focus();
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
    }

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
            
            const passwordInput = document.getElementById('authPasswordInput');
            const mfaToggle = document.getElementById('authMfaToggle');
            const password = passwordInput.value;
            const mfaEnabled = mfaToggle ? mfaToggle.checked : false;

            // Verify strength before sending
            const passBar = document.getElementById('passwordStrengthBar');
            const passFeedback = document.getElementById('passwordFeedback');
            const isStrong = this.checkPasswordStrength(password, passBar, passFeedback);
            if (!isStrong) {
              showError('Please specify a secure password matching all validation rules.');
              launchBtn.disabled = false;
              launchBtn.textContent = 'Launch Workspace';
              return false;
            }

            // Call /api/users/login to register active session on backend
            const activeSession = await api.login({
              username: username,
              role: role,
              avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
              status: 'ONLINE',
              email: localStorage.getItem('tasksphere_email'),
              password: password,
              mfa: mfaEnabled
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

    // Real-time password strength checker for Step 3
    const passInput = document.getElementById('authPasswordInput');
    if (passInput) {
      passInput.oninput = () => {
        const passBar = document.getElementById('passwordStrengthBar');
        const passFeedback = document.getElementById('passwordFeedback');
        this.checkPasswordStrength(passInput.value, passBar, passFeedback);
      };
    }

    // Submit MFA OTP Code Form
    const mfaOtpForm = document.getElementById('mfaOtpSubmitForm');
    if (mfaOtpForm) {
      mfaOtpForm.onsubmit = async (e) => {
        e.preventDefault();
        clearError();

        const otpValInput = document.getElementById('authMfaOtpInput');
        const otpVal = otpValInput.value.trim();
        const emailVal = localStorage.getItem('tasksphere_email') || submittedEmail;

        if (otpVal.length !== 6 || isNaN(otpVal)) {
          showError('Verification code must be 6 digits.');
          return false;
        }

        const verifyBtn = document.getElementById('verifyMfaOtpBtn');
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Launching...';

        try {
          console.log('[AUTH-MFA] Sending dynamic MFA validation code:', otpVal);
          const mfaRes = await api.request('/auth/otp/verify', {
            method: 'POST',
            body: JSON.stringify({ email: emailVal, otp: otpVal })
          });

          if (mfaRes.success && mfaRes.token) {
            console.log('[AUTH-MFA] Validation valid. Fetching profile metadata details...');
            
            // Fetch directory profiles to extract username & role details
            const users = await api.getUsers() || [];
            const me = users.find(u => {
              const parts = (u.avatarUrl || '').split('||');
              for (const part of parts) {
                if (part.startsWith('email:')) {
                  return part.substring(6).toLowerCase().trim() === emailVal.toLowerCase().trim();
                }
              }
              return false;
            });

            const username = me ? me.username : emailVal.split('@')[0];
            const role = me ? me.role : 'DEVELOPER';
            const avatarUrl = me ? (me.avatarUrl || '').split('||')[0] : `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

            localStorage.setItem('tasksphere_jwt', mfaRes.token);
            localStorage.setItem('chat_username', username);
            localStorage.setItem('chat_role', role);
            localStorage.setItem('chat_avatar', avatarUrl);
            
            // Save local cache bypass details
            localStorage.setItem('profile_' + emailVal.toLowerCase().trim(), JSON.stringify({
              username,
              role,
              avatarUrl
            }));

            // Launch Workspace
            this.applyProfileUI();
            
            if (loginOverlay) loginOverlay.classList.add('hidden');
            this.toggleAdminTab();
            this.initRealtimeSync();

            // Refresh views
            this.switchRoute(this.activeRoute);
          }
        } catch (err) {
          console.error('[AUTH-MFA] Code validation failed:', err);
          showError(err.message || 'Incorrect dynamic security code.');
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify & Launch';
        }
        return false;
      };
    }
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

    const securityBtn = document.getElementById('securitySettingsBtn');
    if (securityBtn) {
      securityBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.add('hidden');
        this.openSecurityModal();
      };
    }

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
    const loginStep = document.getElementById('authLoginStep');
    if (loginStep) loginStep.classList.add('hidden');
    const registerStep = document.getElementById('authRegisterStep');
    if (registerStep) registerStep.classList.add('hidden');
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
 
  checkPasswordStrength(password, barEl, feedbackEl) {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;

    let width = "0%";
    let color = "#ef4444";
    let text = "Weak Password";

    if (score >= 5) {
      width = "100%";
      color = "#10b981";
      text = "Strong Password (Secure)";
    } else if (score >= 3) {
      width = "60%";
      color = "#f59e0b";
      text = "Medium Password";
    } else if (password.length > 0) {
      width = "30%";
      color = "#ef4444";
      text = "Weak Password (Min 8 chars, mixed case, number, symbol)";
    } else {
      text = "Create secure password...";
    }

    if (barEl) {
      barEl.style.width = width;
      barEl.style.backgroundColor = color;
    }
    if (feedbackEl) {
      feedbackEl.textContent = text;
      feedbackEl.style.color = color;
    }
    return score >= 5;
  }

  setupSecuritySettings() {
    const modal = document.getElementById('securityModal');
    const closeBtn = document.getElementById('closeSecurityModal');
    const cancelBtn = document.getElementById('cancelSecurityBtn');
    const form = document.getElementById('securityForm');
    const newPassInput = document.getElementById('settingsNewPassword');

    if (!modal || !form) return;

    // Close security settings modal
    const closeModal = () => modal.classList.remove('modal-overlay--active');
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    let customAvatarDataUrl = null;
    const fileInput = document.getElementById('avatarFileInput');
    const avatarPreview = document.getElementById('settingsAvatarPreview');
    const avatarLoader = document.getElementById('settingsAvatarLoader');
    const resetAvatarBtn = document.getElementById('resetAvatarBtn');

    if (fileInput) {
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          alert('Please select a valid image file.');
          return;
        }

        if (avatarLoader) avatarLoader.classList.remove('hidden');

        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Resize and crop to perfect 150x150 square
            const size = 150;
            canvas.width = size;
            canvas.height = size;

            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;

            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

            // Compress to WebP Base64 at 70% quality
            const compressedDataUrl = canvas.toDataURL('image/webp', 0.7);
            const approxSizeKBytes = Math.round((compressedDataUrl.length * 0.75) / 1024);
            console.log(`[AVATAR-COMPRESSION] Compressed size: ${approxSizeKBytes} KB`);

            if (approxSizeKBytes > 25) {
              // Compress further at 50% quality if still above 25KB
              customAvatarDataUrl = canvas.toDataURL('image/webp', 0.5);
            } else {
              customAvatarDataUrl = compressedDataUrl;
            }

            if (avatarPreview) avatarPreview.src = customAvatarDataUrl;
            if (avatarLoader) avatarLoader.classList.add('hidden');
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      };
    }

    if (resetAvatarBtn) {
      resetAvatarBtn.onclick = () => {
        const username = localStorage.getItem('chat_username');
        customAvatarDataUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
        if (avatarPreview) avatarPreview.src = customAvatarDataUrl;
        if (fileInput) fileInput.value = '';
      };
    }

    // Strength checker for Settings Password Update
    if (newPassInput) {
      newPassInput.oninput = () => {
        const passBar = document.getElementById('settingsPasswordBar');
        const passFeedback = document.getElementById('settingsPasswordFeedback');
        
        if (newPassInput.value.length === 0) {
          if (passBar) passBar.style.width = "0%";
          if (passFeedback) {
            passFeedback.textContent = "Leave blank if you do not want to modify your password.";
            passFeedback.style.color = "var(--text-muted)";
          }
        } else {
          this.checkPasswordStrength(newPassInput.value, passBar, passFeedback);
        }
      };
    }

    // Handle security settings submission
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      const mfaToggle = document.getElementById('mfaSettingsToggle');
      const mfaEnabled = mfaToggle ? mfaToggle.checked : false;
      const newPassword = newPassInput ? newPassInput.value : '';
      const username = localStorage.getItem('chat_username');

      // Verify strength of new password if not blank
      if (newPassword.length > 0) {
        const passBar = document.getElementById('settingsPasswordBar');
        const passFeedback = document.getElementById('settingsPasswordFeedback');
        const isStrong = this.checkPasswordStrength(newPassword, passBar, passFeedback);
        if (!isStrong) {
          alert('Please specify a secure password matching all rules.');
          return false;
        }
      }

      const saveBtn = document.getElementById('saveSecurityBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        console.log('[SECURITY-SETTINGS-SAVE] Sending updates to backend...');
        const payload = { username, mfa: mfaEnabled };
        if (newPassword.length > 0) {
          payload.password = newPassword;
        }
        if (customAvatarDataUrl) {
          payload.avatar = customAvatarDataUrl;
        }

        const res = await api.request('/users/profile/security', {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });

        if (res.success) {
          if (customAvatarDataUrl) {
            localStorage.setItem('chat_avatar', customAvatarDataUrl);
            
            // Sync cache profile details
            const email = localStorage.getItem('tasksphere_email');
            if (email) {
              const cached = JSON.parse(localStorage.getItem('profile_' + email.toLowerCase().trim()) || '{}');
              cached.avatarUrl = customAvatarDataUrl;
              localStorage.setItem('profile_' + email.toLowerCase().trim(), JSON.stringify(cached));
            }
          }
          alert('Security settings synchronized successfully!');
          this.applyProfileUI();
          
          if (this.currentView && typeof this.currentView.render === 'function') {
            this.currentView.render();
          }
          closeModal();
        }
      } catch (err) {
        console.error('[SECURITY-SETTINGS-ERROR] Failed to save:', err);
        alert(`Failed to save settings: ${err.message || err}`);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
      }
      return false;
    };
  }

  async openSecurityModal() {
    const modal = document.getElementById('securityModal');
    const mfaToggle = document.getElementById('mfaSettingsToggle');
    const newPassInput = document.getElementById('settingsNewPassword');
    const passBar = document.getElementById('settingsPasswordBar');
    const passFeedback = document.getElementById('settingsPasswordFeedback');

    if (!modal) return;

    // Reset inputs
    if (newPassInput) newPassInput.value = '';
    if (passBar) passBar.style.width = "0%";
    if (passFeedback) {
      passFeedback.textContent = "Leave blank if you do not want to modify your password.";
      passFeedback.style.color = "var(--text-muted)";
    }

    const fileInput = document.getElementById('avatarFileInput');
    const avatarPreview = document.getElementById('settingsAvatarPreview');
    if (fileInput) fileInput.value = '';
    if (avatarPreview) {
      avatarPreview.src = localStorage.getItem('chat_avatar') || `https://api.dicebear.com/7.x/bottts/svg?seed=${localStorage.getItem('chat_username') || 'Admin'}`;
    }

    // Set toggle state by fetching database user details
    const username = localStorage.getItem('chat_username');
    if (mfaToggle) {
      mfaToggle.checked = false; // default
      try {
        const users = await api.getUsers() || [];
        const me = users.find(u => u.username === username);
        if (me) {
          mfaToggle.checked = me.status === 'PENDING_APPROVAL' ? false : me.avatarUrl.includes('||mfa:true');
        }
      } catch (err) {
        console.warn('[SECURITY-SETTINGS-LOAD] Failed to load user security details:', err);
      }
    }

    // Show modal
    modal.classList.add('modal-overlay--active');
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

  setupPasswordToggles() {
    const bindToggle = (toggleId, inputId) => {
      const toggleBtn = document.getElementById(toggleId);
      const inputEl = document.getElementById(inputId);
      if (toggleBtn && inputEl) {
        toggleBtn.onclick = () => {
          if (inputEl.type === 'password') {
            inputEl.type = 'text';
            toggleBtn.textContent = '🙈';
          } else {
            inputEl.type = 'password';
            toggleBtn.textContent = '👁️';
          }
        };
      }
    };

    bindToggle('toggleLoginPassword', 'loginPasswordInput');
    bindToggle('toggleRegPassword', 'authPasswordInput');
    bindToggle('toggleSettingsPassword', 'settingsNewPassword');
  }
}

// Instantiate and launch app
const app = new TaskSphereApp();
window.addEventListener('DOMContentLoaded', () => app.start());
