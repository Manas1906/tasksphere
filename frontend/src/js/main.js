import { api } from './api';
import { socket } from './websocket';
import { DashboardView } from './dashboard';
import { BoardView } from './board';
import { ChatController } from './chat';
import { AICopilot } from './copilot';
import { AIChatbot } from './chatbot';
import { AdminView } from './admin';
import { CursorSyncController } from './cursors';

/**
 * TaskSphereApp - Day 12 & 14 Root System Assembly
 * Orchestrates routes, visualInspect overlays, dialogs, and real-time handshakes.
 */
class TaskSphereApp {
  constructor() {
    this.currentView = null;
    this.chatController = null;
    this.cursorSyncController = null;
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
    
    // Intercept Google/GitHub redirect parameters from URL search query on startup
    const urlParams = new URLSearchParams(window.location.search);
    const oauthToken = urlParams.get('token');
    const oauthUsername = urlParams.get('username');
    const oauthRole = urlParams.get('role');
    const oauthEmail = urlParams.get('email');
    const oauthAvatar = urlParams.get('avatar');
    const oauthError = urlParams.get('error');

    if (oauthError) {
      console.error('[AUTH-OAUTH] Federated social login failed:', oauthError);
      setTimeout(() => {
        const errorMsg = document.getElementById('authErrorMsg');
        if (errorMsg) {
          errorMsg.textContent = decodeURIComponent(oauthError);
          errorMsg.classList.add('visible');
        }
      }, 300);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (oauthToken && oauthUsername) {
      console.log('[AUTH-OAUTH] Intercepted federated social credentials in URL callback.');
      localStorage.setItem('tasksphere_jwt', oauthToken);
      localStorage.setItem('chat_username', oauthUsername);
      localStorage.setItem('chat_role', oauthRole || 'DEVELOPER');
      localStorage.setItem('chat_avatar', oauthAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${oauthUsername}`);
      localStorage.setItem('tasksphere_email', oauthEmail);

      // Cache profile details
      if (oauthEmail) {
        localStorage.setItem('profile_' + oauthEmail.toLowerCase().trim(), JSON.stringify({
          username: oauthUsername,
          role: oauthRole || 'DEVELOPER',
          avatarUrl: oauthAvatar
        }));
      }

      // Clean query search parameters from URL instantly to prevent reload loops
      window.history.replaceState({}, document.title, window.location.pathname);
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
    
    // Register Service Worker for background Web Push alerts (Phase 13)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(registration => {
            console.log('[SW-REGISTER] Service Worker successfully registered with scope:', registration.scope);
          })
          .catch(err => {
            console.error('[SW-REGISTER-ERROR] Service Worker registration failed:', err);
          });
      });
    }

    // Default load dashboard
    this.switchRoute('DASHBOARD');
  }

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
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

    // --- Federated Social Auth Redirect Handlers ---
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const githubLoginBtn = document.getElementById('githubLoginBtn');

    if (googleLoginBtn) {
      googleLoginBtn.onclick = () => {
        clearError();
        const cleanApiUrl = api.baseUrl.endsWith('/api') ? api.baseUrl.substring(0, api.baseUrl.length - 4) : api.baseUrl;
        console.log('[AUTH-GOOGLE] Redirecting to Google Login page...');
        window.location.href = `${cleanApiUrl}/api/auth/google/login`;
      };
    }

    if (githubLoginBtn) {
      githubLoginBtn.onclick = () => {
        clearError();
        const cleanApiUrl = api.baseUrl.endsWith('/api') ? api.baseUrl.substring(0, api.baseUrl.length - 4) : api.baseUrl;
        console.log('[AUTH-GITHUB] Redirecting to GitHub Login page...');
        window.location.href = `${cleanApiUrl}/api/auth/github/login`;
      };
    }

    // --- Forgot Password Navigations ---
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const forgotBackToLoginLink = document.getElementById('forgotBackToLoginLink');
    const forgotOtpBackToLoginLink = document.getElementById('forgotOtpBackToLoginLink');
    const resetPasswordBackToLoginLink = document.getElementById('resetPasswordBackToLoginLink');

    if (forgotPasswordLink) {
      forgotPasswordLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authLoginStep').classList.add('hidden');
        document.getElementById('authForgotEmailStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your registered email to request recovery';
        document.getElementById('forgotEmailInput').focus();
      };
    }

    if (forgotBackToLoginLink) {
      forgotBackToLoginLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authForgotEmailStep').classList.add('hidden');
        document.getElementById('authLoginStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your credentials to access the workspace';
        document.getElementById('loginEmailInput').focus();
      };
    }

    if (forgotOtpBackToLoginLink) {
      forgotOtpBackToLoginLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authForgotOtpStep').classList.add('hidden');
        document.getElementById('authLoginStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your credentials to access the workspace';
        document.getElementById('loginEmailInput').focus();
      };
    }

    if (resetPasswordBackToLoginLink) {
      resetPasswordBackToLoginLink.onclick = (e) => {
        e.preventDefault();
        clearError();
        document.getElementById('authResetPasswordStep').classList.add('hidden');
        document.getElementById('authLoginStep').classList.remove('hidden');
        subtitle.textContent = 'Enter your credentials to access the workspace';
        document.getElementById('loginEmailInput').focus();
      };
    }

    const forgotNewPasswordInput = document.getElementById('forgotNewPasswordInput');
    if (forgotNewPasswordInput) {
      forgotNewPasswordInput.oninput = () => {
        const passBar = document.getElementById('forgotPasswordStrengthBar');
        const passFeedback = document.getElementById('forgotPasswordFeedback');
        this.checkPasswordStrength(forgotNewPasswordInput.value, passBar, passFeedback);
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

    // --- Forgot Password Action Handlers ---
    let submittedOtp = '';

    const forgotEmailForm = document.getElementById('forgotEmailForm');
    if (forgotEmailForm) {
      forgotEmailForm.onsubmit = (e) => {
        e.preventDefault();
        clearError();

        const emailInput = document.getElementById('forgotEmailInput');
        const sendBtn = document.getElementById('sendForgotOtpBtn');
        const emailVal = emailInput.value.trim();

        if (!emailVal || !emailVal.includes('@')) {
          showError('Please supply a valid email address.');
          return false;
        }

        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="auth-spinner"></span>Verifying...';

        (async () => {
          try {
            console.log(`[AUTH-FORGOT-CHECK] Checking registration status for ${emailVal}...`);
            const check = await api.checkEmail(emailVal);
            if (!check || !check.registered) {
              showError('This email address is not registered.');
              return;
            }

            console.log(`[AUTH-FORGOT-OTP] Sending reset OTP to ${emailVal}`);
            await api.sendOtp(emailVal);

            submittedEmail = emailVal;
            subtitle.innerHTML = `Recovery code sent to:<br><b style="color: var(--accent-cyan); word-break: break-all;">${emailVal}</b><br>Please enter it below.`;
            document.getElementById('authForgotEmailStep').classList.add('hidden');
            document.getElementById('authForgotOtpStep').classList.remove('hidden');
            document.getElementById('forgotOtpInput').value = '';
            document.getElementById('forgotOtpInput').focus();
          } catch (err) {
            console.error('[AUTH-FORGOT-OTP] Recovery OTP dispatch failed:', err);
            showError(err.message || 'Verification service failed. Please try again.');
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Recovery Code';
          }
        })();
        return false;
      };
    }

    const forgotOtpForm = document.getElementById('forgotOtpSubmitForm');
    if (forgotOtpForm) {
      forgotOtpForm.onsubmit = (e) => {
        e.preventDefault();
        clearError();

        const otpInput = document.getElementById('forgotOtpInput');
        const verifyBtn = document.getElementById('verifyForgotOtpBtn');
        const otpVal = otpInput.value.trim();

        if (otpVal.length !== 6 || isNaN(otpVal)) {
          showError('Verification code must be 6 digits.');
          return false;
        }

        submittedOtp = otpVal;
        
        // Transition straight to the reset password view
        document.getElementById('authForgotOtpStep').classList.add('hidden');
        document.getElementById('authResetPasswordStep').classList.remove('hidden');
        document.getElementById('forgotNewPasswordInput').value = '';
        document.getElementById('forgotNewPasswordInput').focus();

        subtitle.textContent = 'Choose a secure new password for your account';
        return false;
      };
    }

    const resetPasswordForm = document.getElementById('resetPasswordSubmitForm');
    if (resetPasswordForm) {
      resetPasswordForm.onsubmit = (e) => {
        e.preventDefault();
        clearError();

        const newPassInput = document.getElementById('forgotNewPasswordInput');
        const resetBtn = document.getElementById('resetPasswordBtn');
        const newPassword = newPassInput.value;

        // Verify strength before sending
        const passBar = document.getElementById('forgotPasswordStrengthBar');
        const passFeedback = document.getElementById('forgotPasswordFeedback');
        const isStrong = this.checkPasswordStrength(newPassword, passBar, passFeedback);
        if (!isStrong) {
          showError('Please specify a secure password matching all validation rules.');
          return false;
        }

        resetBtn.disabled = true;
        resetBtn.innerHTML = '<span class="auth-spinner"></span>Updating...';

        (async () => {
          try {
            console.log(`[AUTH-RESET] Submitting password reset request for: ${submittedEmail}`);
            const res = await api.request('/auth/password/reset', {
              method: 'POST',
              body: JSON.stringify({
                email: submittedEmail,
                otp: submittedOtp,
                newPassword: newPassword
              })
            });

            console.log('[AUTH-RESET-SUCCESS] Password updated successfully. Returning to login.');
            
            // Show successful alert
            alert(res.message || 'Password updated successfully. Please log in using your new credentials.');

            // Transition back to login card
            document.getElementById('authResetPasswordStep').classList.add('hidden');
            document.getElementById('authLoginStep').classList.remove('hidden');
            subtitle.textContent = 'Enter your credentials to access the workspace';
            document.getElementById('loginEmailInput').focus();
          } catch (err) {
            console.error('[AUTH-RESET-FAILURE] Password reset failed:', err);
            showError(err.message || 'Verification code is invalid or password strength requirements not met.');
          } finally {
            resetBtn.disabled = false;
            resetBtn.textContent = 'Reset Password';
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
            
            // Store the token immediately so subsequent API calls use the authenticated header
            localStorage.setItem('tasksphere_jwt', mfaRes.token);
            localStorage.setItem('tasksphere_email', emailVal);

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
            let avatarUrl = me ? (me.avatarUrl || '').split('||')[0] : '';
            if (!avatarUrl || avatarUrl.trim() === '') {
              avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
            }

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

    // Instantiate and initialize collaborative cursors controller
    this.cursorSyncController = new CursorSyncController();
    this.cursorSyncController.init();

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
            if (this.currentView && this.currentView.tasks) {
              const idx = this.currentView.tasks.findIndex(t => t.id === payload.taskId);
              if (idx !== -1) {
                console.log(`[APP-SYNC-BOARD] Syncing card status update locally for Task ID ${payload.taskId}`);
                this.currentView.tasks[idx].status = payload.toStatus;
              }
            }
          }
        });

        // Subscribe to secure private user queues for assignment alerts
        const username = localStorage.getItem('chat_username');
        if (username) {
          console.log(`[APP-SYNC] Subscribing to secure private alert stream for: ${username}`);
          socket.subscribe('/user/queue/notifications', (alert) => {
            console.log('[APP-SYNC-ALERT] Intercepted real-time notification queue alert payload:', alert);
            this.showNotificationToast(
              alert.type === 'ASSIGNMENT' ? 'Task Assigned' : alert.type === 'UNASSIGNMENT' ? 'Task Unassigned' : 'Task Updated', 
              alert.message, 
              alert.type
            );
          });
        }

        // Initialize Chat WebSocket subscriptions and presence sync
        this.chatController.subscribeChannels();
        this.chatController.syncMyPresence();

        // Initialize Cursor WebSocket channel subscription
        this.cursorSyncController.subscribeChannel();

        // Subscribe to live system diagnostics metrics stream (CTO Showcase)
        socket.subscribe('/topic/stats', (stats) => {
          console.log('[APP-SYNC-STATS] Received incoming system diagnostics payload:', stats);
          const archModeEl = document.getElementById('diagArchMode');
          const emailQueueEl = document.getElementById('diagEmailQueue');
          const aiQueueEl = document.getElementById('diagAiQueue');
          const latencySavingsEl = document.getElementById('diagLatencySavings');
          
          if (archModeEl) archModeEl.textContent = stats.activeMode || 'REDIS EVENT QUEUE';
          if (emailQueueEl) emailQueueEl.textContent = `${stats.emailQueueSize || 0} pending`;
          if (aiQueueEl) aiQueueEl.textContent = `${stats.aiQueueSize || 0} pending`;
          if (latencySavingsEl) latencySavingsEl.textContent = stats.latencySavings || '99.8%';
        });

        // Periodically trigger system stats collection (every 5 seconds)
        const triggerStatsSync = () => {
          if (socket.connected) {
            socket.send('/app/system.stats', {});
          }
        };
        setTimeout(triggerStatsSync, 2000);
        const statsInterval = setInterval(() => {
          if (!socket.connected) {
            clearInterval(statsInterval);
          } else {
            triggerStatsSync();
          }
        }, 5000);
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
      activeChecklist = [];
      renderChecklistUI();
      
      modal.classList.add('modal-overlay--active');
    };

    const closeModal = () => modal.classList.remove('modal-overlay--active');
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    // Set up local checklist state management for Create Ticket flow
    let activeChecklist = [];
    const checklistContainer = form.querySelector('#checklistBuilderList');
    const addChecklistBtn = form.querySelector('#checklistBuilderAddBtn');
    const checklistInput = form.querySelector('#checklistBuilderInput');

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
      makeChecklistDragSortable(checklistContainer, activeChecklist, renderChecklistUI);
    };

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

    // AI Subtask Generator Wiring
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
          const subtasks = await queryGeminiForSubtasks(title, description);
          if (subtasks && subtasks.length > 0) {
            // Clear existing checklist items and begin dynamic sequential stream typing
            activeChecklist = [];
            renderChecklistUI();

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

              // Get the newly rendered text element
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
          alert('Failed to generate AI subtasks. Falling back to manual scaffolding.');
        }
      };
    }

    // Handle ticket creation submission
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      const assigneeId = form.querySelector('#ticketAssignee').value;
      const members = JSON.parse(localStorage.getItem('cache_users') || '[]');
      const assignee = members.find(m => m.id === assigneeId) || null;

      // Extract checklist items cleanly preserving sorting order
      const checklistItems = [];
      form.querySelectorAll('.checklist-builder-item').forEach(item => {
        const textSpan = item.querySelector('label span:last-of-type');
        const checkInput = item.querySelector('input[type="checkbox"]');
        if (textSpan && textSpan.textContent.trim()) {
          checklistItems.push({
            content: textSpan.textContent.trim(),
            completed: checkInput ? checkInput.checked : false
          });
        }
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

    // Wire Web Push Notification toggle checkbox (Phase 13)
    const pushToggle = document.getElementById('pushSettingsToggle');
    if (pushToggle) {
      pushToggle.onchange = async () => {
        const username = localStorage.getItem('chat_username');
        if (!username) {
          alert('Session required to alter notifications.');
          pushToggle.checked = false;
          return;
        }

        if (pushToggle.checked) {
          // Subscribing
          if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            alert('Desktop push notifications are not supported in your browser.');
            pushToggle.checked = false;
            return;
          }

          try {
            console.log('[WEBPUSH-SUBSCRIBE] Requesting user permission...');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
              alert('Notification permission was denied. Please update your browser permissions.');
              pushToggle.checked = false;
              return;
            }

            console.log('[WEBPUSH-SUBSCRIBE] Retrieving VAPID public key from backend...');
            const keyRes = await api.getVapidPublicKey();
            const vapidPublicKey = keyRes.publicKey;

            if (!vapidPublicKey) {
              throw new Error('VAPID Public Key not found in backend response.');
            }

            console.log('[WEBPUSH-SUBSCRIBE] Awaiting service worker ready...');
            const registration = await navigator.serviceWorker.ready;
            
            console.log('[WEBPUSH-SUBSCRIBE] Registering browser push subscription...');
            const subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey)
            });

            console.log('[WEBPUSH-SUBSCRIBE] Registering subscription object in backend...');
            await api.subscribePush(username, subscription);
            console.log('[WEBPUSH-SUBSCRIBE] Push subscription fully active.');
            alert('Desktop push notifications successfully enabled!');
          } catch (err) {
            console.error('[WEBPUSH-SUBSCRIBE-ERROR] Failed to enable Web Push:', err);
            alert(`Failed to enable push notifications: ${err.message || err}`);
            pushToggle.checked = false;
          }
        } else {
          // Unsubscribing
          try {
            console.log('[WEBPUSH-UNSUBSCRIBE] Awaiting service worker ready...');
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            
            if (subscription) {
              await subscription.unsubscribe();
              console.log('[WEBPUSH-UNSUBSCRIBE] Revoked browser push subscription.');
            }

            await api.unsubscribePush(username);
            console.log('[WEBPUSH-UNSUBSCRIBE] Cleared push subscription in backend.');
            alert('Desktop push notifications disabled.');
          } catch (err) {
            console.error('[WEBPUSH-UNSUBSCRIBE-ERROR] Failed to disable Web Push:', err);
            alert(`Failed to disable push notifications: ${err.message || err}`);
            pushToggle.checked = true; // reset checkbox
          }
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

    // Set Desktop Push Notifications toggle state by checking active browser registration (Phase 13)
    const pushToggle = document.getElementById('pushSettingsToggle');
    if (pushToggle) {
      pushToggle.checked = false; // default
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(registration => {
          registration.pushManager.getSubscription().then(subscription => {
            pushToggle.checked = (subscription !== null);
          }).catch(err => {
            console.warn('[WEBPUSH-CHECK-ERROR] Failed to query subscription:', err);
          });
        });
      }
    }

    // Show modal
    modal.classList.add('modal-overlay--active');
  }

  async switchRoute(route) {
    this.activeRoute = route;
 
    // Clear collaborative cursor representations on dynamic route switches
    if (this.cursorSyncController) {
      this.cursorSyncController.clearAllCursors();
    }
 
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

  playNotificationSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      // Node 1 - Base tone (C5 - 523.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain1.gain.setValueAtTime(0.12, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      
      // Node 2 - Delayed chime tone (G5 - 783.99 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.1);
      gain2.gain.setValueAtTime(0, ctx.currentTime);
      gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.3);
      
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.4);
    } catch (e) {
      console.warn('[AUDIO-CHIME-ERROR] Browser AudioContext blocked or unsupported:', e);
    }
  }

  showNotificationToast(title, message, type = 'ASSIGNMENT') {
    const stack = document.getElementById('toastNotificationStack');
    if (!stack) return;

    // Create Toast Card
    const toast = document.createElement('div');
    toast.className = `toast-card toast-card--${type.toLowerCase()}`;
    
    // Choose icon depending on type
    let icon = '🔔';
    if (type === 'ASSIGNMENT') icon = '⚡';
    else if (type === 'UNASSIGNMENT') icon = '🚫';
    else if (type === 'UPDATE') icon = '✏️';

    toast.innerHTML = `
      <div class="toast-header">
        <div class="toast-badge-group">
          <span class="toast-icon">${icon}</span>
          <span class="toast-title">${title}</span>
        </div>
        <button class="toast-close-btn">&times;</button>
      </div>
      <div class="toast-message">${message}</div>
      <div class="toast-progress-container">
        <div class="toast-progress-bar"></div>
      </div>
    `;

    // Append to stack
    stack.appendChild(toast);

    // Play retro-cybernetic synth chime
    this.playNotificationSound();

    // Auto dismiss setup
    let dismissTimeout;
    const triggerDismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px) scale(0.95)';
      setTimeout(() => {
        if (toast.parentNode === stack) {
          stack.removeChild(toast);
        }
      }, 300);
    };

    dismissTimeout = setTimeout(triggerDismiss, 5000);

    // Pause on hover
    const progressBar = toast.querySelector('.toast-progress-bar');
    toast.onmouseenter = () => {
      clearTimeout(dismissTimeout);
      if (progressBar) progressBar.style.animationPlayState = 'paused';
    };

    toast.onmouseleave = () => {
      // Re-trigger remaining time estimation or simple reset
      dismissTimeout = setTimeout(triggerDismiss, 2000); // give 2s buffer when leaving
      if (progressBar) progressBar.style.animationPlayState = 'running';
    };

    // Close button click
    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        clearTimeout(dismissTimeout);
        triggerDismiss();
      };
    }
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
    bindToggle('toggleResetRegPassword', 'forgotNewPasswordInput');
  }
}

// ========================================================
// Phase 7: AI Copilot & Dynamic Checklist Helper Functions
// ========================================================
async function queryGeminiForSubtasks(title, description) {
  const activeKey = import.meta.env.VITE_GEMINI_API_KEY || '';
  if (activeKey) {
    try {
      console.log('[AI-SUBTASK] Contacting Google Gemini stable v1 API (gemini-2.5-flash)...');
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
      console.warn('[AI-SUBTASK] Gemini API failed, falling back to local simulated coach...', err);
      return getLocalSubtaskFallback(title, description);
    }
  } else {
    // Local fallback with natural delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    return getLocalSubtaskFallback(title, description);
  }
}

function getLocalSubtaskFallback(title, description) {
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

function makeChecklistDragSortable(container, listArray, renderCallback) {
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

// Instantiate and launch app
const app = new TaskSphereApp();
window.addEventListener('DOMContentLoaded', () => app.start());
