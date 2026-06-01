/**
 * OnboardingTour - Action-Oriented Guided Setup Wizard
 * Drives the user to perform concrete actions: Create Ticket, Upload Profile, Enable MFA/Push, Update Password.
 */
export class OnboardingTour {
  constructor() {
    this.currentStep = -1; // -1: Not started, 0: Welcome, 1: Add Task Button, 2: Form Modal, 3: Profile settings, 4: MFA, 5: Push, 6: Password
    this.guideCard = null;
    this.spotlight = null;
    this.overlay = null;
    this.steps = [
      {
        title: "Welcome to TaskSphere!",
        desc: "Your highly optimized, decoupled Agile workspace is ready. Let's take a quick guided tour to set up your profile and join team collaborations!",
        target: null,
        placement: "center"
      },
      {
        title: "Step 1: Create a Scrum Ticket",
        desc: "First, let's plan a task in your Backlog. Click the **+ Add New Task** button under the Backlog column header to launch the Sprint planner.",
        target: ".kanban-column--todo .kanban-column-add-btn",
        placement: "bottom"
      },
      {
        title: "Describe Your Deliverable",
        desc: "Enter a ticket title (e.g., 'Deploy Outer Shell') and details in the Scope Description. Once complete, click **Create Ticket** to proceed.",
        target: "#ticketForm",
        placement: "left"
      },
      {
        title: "Step 2: Customize Profile Photo",
        desc: "Outstanding! Let's initialize your profile identity. Select a custom photo to upload, or reset to your default Dicebear robotic avatar.",
        target: "#securityForm .form-group:first-of-type",
        placement: "left"
      },
      {
        title: "Step 3: Enable Multi-Factor (MFA)",
        desc: "Secure your account credentials. Check the **MFA** box to enforce 6-digit email security codes on future session startups.",
        target: "#mfaSettingsToggle",
        placement: "left"
      },
      {
        title: "Step 4: Allow Push Notifications",
        desc: "Never miss active scope changes. Check **Push Notifications** and authorize the browser permissions popup to receive background notifications.",
        target: "#pushSettingsToggle",
        placement: "left"
      },
      {
        title: "Step 5: Enforce Password & Apply",
        desc: "Enter an updated password (optional) and click **Save Settings** to persist your profile customizations and progress to chat tools!",
        target: "#securityForm button[type='submit']",
        placement: "top"
      },
      {
        title: "Step 6: Team Collaboration",
        desc: "Coordinate with your squad in real-time. Type message updates in the input box below and hit Enter to publish instantly to the group channel.",
        target: "#chatContainer",
        placement: "left"
      },
      {
        title: "Step 7: Private Chat DMs",
        desc: "Want to talk in private? Click any teammate's avatar in the active list above to immediately launch a secure direct message (DM) session.",
        target: "#activeUsersList",
        placement: "left"
      },
      {
        title: "Step 8: Reactions, Edits & Threads",
        desc: "Hover over any chat bubble to react with emojis (👍, ❤️, 🔥), edit your sent messages, or click the **Reply** icon to start nested threads!",
        target: "#chatMessages",
        placement: "left"
      }
    ];
  }

  get myUsername() {
    return localStorage.getItem('chat_username') || 'Guest';
  }

  init() {
    // 1. Prevent onboarding starting if user is not authenticated
    const token = localStorage.getItem('tasksphere_jwt');
    const username = this.myUsername;
    if (!token || username === 'Guest') {
      console.log('[ONBOARDING] User not authenticated. Aborting walkthrough.');
      return;
    }

    // 2. Check if onboarding was already completed by this specific user
    const completed = localStorage.getItem(`tasksphere_onboarding_completed_${username}`) === 'true';
    if (completed) {
      console.log(`[ONBOARDING] Tour already completed previously by ${username}.`);
      this.injectReplayButton();
      return;
    }

    // 3. Prevent onboarding auto-start if workspace is locked behind authentication screen
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay && !loginOverlay.classList.contains('hidden')) {
      console.log('[ONBOARDING] Workspace locked behind authentication screen. Aborting walkthrough.');
      return;
    }

    // Delay start slightly to let the workspace render cleanly
    setTimeout(() => {
      // Re-verify login screen & auth token are still active before popping up
      const currentToken = localStorage.getItem('tasksphere_jwt');
      const checkOverlay = document.getElementById('loginOverlay');
      if (!currentToken || (checkOverlay && !checkOverlay.classList.contains('hidden'))) {
        console.log('[ONBOARDING] User logged out or login screen is active. Aborting start.');
        return;
      }
      this.startTour();
    }, 1500);
  }

  injectReplayButton() {
    const navAdmin = document.getElementById('navAdminItem');
    const navList = document.querySelector('.active-users-bar');
    
    if (navList && !document.getElementById('navReplayTour')) {
      const li = document.createElement('li');
      li.id = 'navReplayTour';
      li.innerHTML = `
        <button class="sidebar-nav-btn">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/>
          </svg>
          <span>Replay Walkthrough</span>
        </button>
      `;
      navList.appendChild(li);
      
      li.querySelector('button').onclick = () => {
        // Enforce board view route first
        if (window.app) window.app.switchRoute('BOARD');
        this.startTour();
      };
    }
  }

  startTour() {
    console.log('[ONBOARDING] Initiating interactive setup tour...');
    this.currentStep = 0;
    this.renderWelcome();
  }

  renderWelcome() {
    this.cleanupDOM();

    // Welcome Screen Backdrop Overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'onboarding-overlay';
    
    const robotSvg = `
      <svg style="width: 60px; height: 60px; fill: var(--accent-purple); margin-bottom: var(--spacing-md);" viewBox="0 0 24 24">
        <path d="M12 2a2 2 0 012 2c0 .28-.06.53-.16.76l1.92 1.92C18.43 7.15 20 9.38 20 12v1H4v-1c0-2.62 1.57-4.85 4.24-5.32l1.92-1.92c-.1-.23-.16-.48-.16-.76a2 2 0 012-2M9 13a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-6 5h6v1H9v-1z"/>
      </svg>
    `;

    this.overlay.innerHTML = `
      <div class="onboarding-welcome-card">
        <button class="onboarding-close">&times;</button>
        ${robotSvg}
        <h2 class="modal-header__title" style="font-size: var(--font-size-lg); margin-bottom: var(--spacing-sm); color: #fff;">${this.steps[0].title}</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; margin-bottom: var(--spacing-lg);">${this.steps[0].desc}</p>
        <div style="display: flex; gap: var(--spacing-md); justify-content: center;">
          <button id="skipTourBtn" class="onboarding-btn onboarding-btn--secondary">Skip Guide</button>
          <button id="startTourBtn" class="onboarding-btn onboarding-btn--primary" style="display: inline-flex; align-items: center; gap: 4px;">
            Start Guided Tour 🚀
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Bind welcome events
    this.overlay.querySelector('.onboarding-close').onclick = () => this.skipTour();
    this.overlay.querySelector('#skipTourBtn').onclick = () => this.skipTour();
    this.overlay.querySelector('#startTourBtn').onclick = () => {
      this.currentStep = 1;
      this.overlay.remove();
      this.overlay = null;
      this.renderGuideStep();
    };
  }

  renderGuideStep() {
    this.cleanupDOM();
    const step = this.steps[this.currentStep];
    if (!step) return;

    // Enforce route state: Step 1 & 2 must be on the BOARD page
    if ((this.currentStep === 1 || this.currentStep === 2) && window.app && window.app.activeRoute !== 'BOARD') {
      window.app.switchRoute('BOARD');
    }

    // Ensure appropriate modals are open/closed depending on the step
    if (this.currentStep === 2) {
      // Auto-open ticket modal for Step 2 if not open yet
      const ticketModal = document.getElementById('ticketModal');
      if (ticketModal && !ticketModal.classList.contains('modal-overlay--active')) {
        const addBtn = document.querySelector(".kanban-column--todo .kanban-column-add-btn");
        if (addBtn) {
          addBtn.click();
        } else {
          ticketModal.classList.add('modal-overlay--active');
        }
      }
    } else {
      // Auto-close ticket modal when leaving Step 2
      const ticketModal = document.getElementById('ticketModal');
      if (ticketModal && ticketModal.classList.contains('modal-overlay--active')) {
        ticketModal.classList.remove('modal-overlay--active');
      }
    }

    if (this.currentStep >= 3 && this.currentStep <= 6) {
      // Auto-open security modal for Steps 3, 4, 5, 6 if not open yet
      const securityModal = document.getElementById('securityModal');
      if (securityModal && !securityModal.classList.contains('modal-overlay--active')) {
        if (window.app) {
          window.app.openSecurityModal();
        } else {
          securityModal.classList.add('modal-overlay--active');
        }
      }
    } else {
      // Auto-close security modal when leaving settings steps
      const securityModal = document.getElementById('securityModal');
      if (securityModal && securityModal.classList.contains('modal-overlay--active')) {
        securityModal.classList.remove('modal-overlay--active');
      }
    }

    // Ensure chat panel is visible for Chat steps
    if (this.currentStep >= 7 && this.currentStep <= 9) {
      const shell = document.getElementById('appShell');
      if (shell) {
        shell.classList.add('app-shell--show-chat');
        shell.classList.remove('app-shell--hide-chat');
        shell.classList.remove('app-shell--show-sidebar');
      }
    }

    const targetEl = document.querySelector(step.target);
    if (!targetEl && this.currentStep > 0) {
      console.warn(`[ONBOARDING] Target ${step.target} not found. Skipping step.`);
      this.nextStep();
      return;
    }

    // Create Spotlight backdrop
    this.spotlight = document.createElement('div');
    this.spotlight.className = 'onboarding-spotlight';
    document.body.appendChild(this.spotlight);

    // Create Guide Card
    this.guideCard = document.createElement('div');
    this.guideCard.className = `onboarding-guide-card onboarding-guide-card--${step.placement}`;
    
    // Calculate dots indicators
    let dotsHtml = "";
    for (let i = 1; i < this.steps.length; i++) {
      dotsHtml += `<span class="onboarding-dot ${i === this.currentStep ? 'onboarding-dot--active' : ''}"></span>`;
    }

    // Dynamic buttons depending on action requirement
    let nextBtnHtml = `<button id="onboardingNextBtn" class="onboarding-btn onboarding-btn--primary">Next</button>`;
    if (this.currentStep === 1) {
      nextBtnHtml = `
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <span style="font-size: 9px; font-weight: 700; color: var(--accent-amber); animation: pulseOrange 1.5s infinite; white-space: nowrap;">Click + Add New Task to progress</span>
          <button id="onboardingNextBtn" class="onboarding-btn onboarding-btn--primary">Next</button>
        </div>
      `;
    } else if (this.currentStep === 2) {
      nextBtnHtml = `
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <span style="font-size: 9px; font-weight: 700; color: var(--accent-cyan); animation: pulseLock 1.5s infinite; white-space: nowrap;">Submit ticket form to progress</span>
          <button id="onboardingNextBtn" class="onboarding-btn onboarding-btn--primary">Next</button>
        </div>
      `;
    } else if (this.currentStep === 6) {
      nextBtnHtml = `
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <span style="font-size: 9px; font-weight: 700; color: var(--accent-emerald); white-space: nowrap;">Submit security settings to progress</span>
          <button id="onboardingNextBtn" class="onboarding-btn onboarding-btn--primary">Next</button>
        </div>
      `;
    } else if (this.currentStep === 9) {
      nextBtnHtml = `<button id="onboardingNextBtn" class="onboarding-btn onboarding-btn--primary">Finish Tour 🚀</button>`;
    }

    this.guideCard.innerHTML = `
      <button class="onboarding-close" style="position: absolute; top: 12px; right: 16px; background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
      <h3 style="font-size: var(--font-size-base); font-weight: bold; margin-bottom: var(--spacing-xs); color: #fff; display: flex; align-items: center; gap: 6px; padding-right: 24px;">
        <svg style="width: 15px; height: 15px; fill: var(--accent-purple);" viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .28-.06.53-.16.76l1.92 1.92C18.43 7.15 20 9.38 20 12v1H4v-1c0-2.62 1.57-4.85 4.24-5.32l1.92-1.92c-.1-.23-.16-.48-.16-.76a2 2 0 012-2"/></svg>
        <span>${step.title}</span>
      </h3>
      <p style="color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.4; margin-bottom: var(--spacing-md);">${step.desc}</p>
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%">
        <div class="onboarding-dots">${dotsHtml}</div>
        <div style="display: flex; gap: var(--spacing-sm); align-items: center">
          ${this.currentStep > 1 && this.currentStep !== 7 ? `<button id="onboardingBackBtn" class="onboarding-btn onboarding-btn--secondary">Back</button>` : ''}
          ${nextBtnHtml}
        </div>
      </div>
    `;

    document.body.appendChild(this.guideCard);

    // Scroll the target element smoothly into view
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Position spotlight & guide card dynamically next to the target element with a short delay for smooth scrolling
    setTimeout(() => {
      this.positionSpotlightAndGuide(targetEl, step.placement);
    }, 250);

    // Listen to window size tweaks to self-heal coordinates
    window.onresize = () => this.positionSpotlightAndGuide(targetEl, step.placement);

    // Bind Guide Card events
    const nextBtn = this.guideCard.querySelector('#onboardingNextBtn');
    if (nextBtn) {
      nextBtn.onclick = () => this.nextStep();
    }
    const backBtn = this.guideCard.querySelector('#onboardingBackBtn');
    if (backBtn) {
      backBtn.onclick = () => this.backStep();
    }
    const closeBtn = this.guideCard.querySelector('.onboarding-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.skipTour();
    }

    // Dynamic Action Event Interception Triggers
    if (this.currentStep === 1) {
      // Step 1: Wait for them to click the Add New Task button in TODO lane
      const addBtn = document.querySelector(step.target);
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          setTimeout(() => {
            // Once the modal is opened, shift to Step 2 (Form Modal)
            if (this.currentStep === 1) {
              this.currentStep = 2;
              this.renderGuideStep();
            }
          }, 100);
        }, { once: true });
      }
    }
  }

  positionSpotlightAndGuide(targetEl, placement) {
    if (!targetEl || !this.spotlight || !this.guideCard) return;

    const rect = targetEl.getBoundingClientRect();
    const pad = 6; // comfortable padding around element
    
    // Place spotlight overlay
    this.spotlight.style.top = `${rect.top - pad + window.scrollY}px`;
    this.spotlight.style.left = `${rect.left - pad + window.scrollX}px`;
    this.spotlight.style.width = `${rect.width + pad * 2}px`;
    this.spotlight.style.height = `${rect.height + pad * 2}px`;

    // Position guide card floating tooltips
    const cardRect = this.guideCard.getBoundingClientRect();
    let top = 0;
    let left = 0;
    const offset = 14; // Arrow offset boundary

    if (placement === "center") {
      top = window.innerHeight / 2 - cardRect.height / 2;
      left = window.innerWidth / 2 - cardRect.width / 2;
    } else if (placement === "bottom") {
      top = rect.bottom + offset;
      left = rect.left + rect.width / 2 - cardRect.width / 2;
    } else if (placement === "top") {
      top = rect.top - cardRect.height - offset;
      left = rect.left + rect.width / 2 - cardRect.width / 2;
    } else if (placement === "left") {
      top = rect.top + rect.height / 2 - cardRect.height / 2;
      left = rect.left - cardRect.width - offset;
    } else if (placement === "right") {
      top = rect.top + rect.height / 2 - cardRect.height / 2;
      left = rect.right + offset;
    }

    // Keep guides inside viewport constraints
    top = Math.max(10, Math.min(top, window.innerHeight - cardRect.height - 10));
    left = Math.max(10, Math.min(left, window.innerWidth - cardRect.width - 10));

    this.guideCard.style.top = `${top + window.scrollY}px`;
    this.guideCard.style.left = `${left + window.scrollX}px`;
    this.guideCard.classList.add('active');
  }

  // Intercepted from main.js when ticket is successfully created
  onTicketCreated() {
    if (this.currentStep === 2) {
      console.log('[ONBOARDING] Intercepted task creation success. Redirecting to settings modal...');
      setTimeout(() => {
        if (window.app) {
          window.app.openSecurityModal();
          this.currentStep = 3;
          this.renderGuideStep();
        }
      }, 500);
    }
  }

  // Intercepted from main.js when profile settings is successfully saved
  onSecuritySaved() {
    if (this.currentStep === 6) {
      console.log('[ONBOARDING] Intercepted profile save success. Progressing to Chat onboarding steps...');
      this.currentStep = 7;
      setTimeout(() => {
        this.renderGuideStep();
      }, 600);
    }
  }

  nextStep() {
    this.currentStep++;
    if (this.currentStep >= this.steps.length) {
      this.finishTour();
    } else {
      this.renderGuideStep();
    }
  }

  finishTour() {
    console.log('[ONBOARDING] Tour completed cleanly.');
    this.cleanupDOM();
    const username = this.myUsername;
    localStorage.setItem(`tasksphere_onboarding_completed_${username}`, 'true');
    this.injectReplayButton();

    if (window.app) {
      window.app.playNotificationSound();
      window.app.showNotificationToast("🎉 Walkthrough Completed!", "Collaboration hub ready. Go ahead and conquer your goals!", "UPDATE");
    }
  }

  backStep() {
    this.currentStep--;
    if (this.currentStep < 1) {
      this.currentStep = 1;
    }
    this.renderGuideStep();
  }

  skipTour() {
    console.log('[ONBOARDING] User dismissed interactive tour.');
    this.cleanupDOM();
    const username = this.myUsername;
    localStorage.setItem(`tasksphere_onboarding_completed_${username}`, 'true');
    this.injectReplayButton();
  }

  cleanupDOM() {
    if (this.guideCard) {
      this.guideCard.remove();
      this.guideCard = null;
    }
    if (this.spotlight) {
      this.spotlight.remove();
      this.spotlight = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
