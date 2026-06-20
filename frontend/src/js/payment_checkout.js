import { api } from './api.js';

/**
 * TaskSphere Secure Payment Checkout & Workspace Co-Funding Coordinator
 */
class PaymentCheckoutController {
  constructor() {
    this.activeSession = null;
    this.pledges = [];
    this.selectedMethod = 'card';
    this.currentOrderId = null;
    this.idempotencyKey = null;
    this.razorpayKey = null;
  }

  async init() {
    // Query elements dynamically since they are loaded inside a routing template
    this.tabContainer = document.getElementById('paymentUpgradeTab');
    this.coFundingSection = document.getElementById('coFundingSection');
    this.pledgeBtn = document.getElementById('pledgeShareBtn');
    this.progressBar = document.getElementById('cofundProgressBar');
    this.pledgeCountEl = document.getElementById('cofundPledgeCount');
    this.targetCountEl = document.getElementById('cofundTargetCount');
    this.pricingScaleGrid = document.getElementById('pricingScaleGrid');
    
    // Portal Elements
    this.portalOverlay = document.getElementById('paymentPortalOverlay');
    this.portalCloseBtn = document.getElementById('paymentPortalClose');
    this.portalPayBtn = document.getElementById('paymentPortalPayBtn');
    this.vpaVerifyBtn = document.getElementById('upiVerifyVpaBtn');
    this.bankSubmitBtn = document.getElementById('bankOtpSubmitBtn');

    // Mocks / Developer Elements
    this.devConsole = document.getElementById('devConsoleLog');
    this.devWebhookBtn = document.getElementById('devWebhookBtn');
    this.devReplayBtn = document.getElementById('devReplayBtn');
    this.devSignatureBtn = document.getElementById('devSignatureBtn');
    this.devMockPledgesBtn = document.getElementById('devMockPledgesBtn');
    this.devResetBtn = document.getElementById('devResetBtn');

    this.bindEvents();
    await this.loadConfig();
    await this.loadActiveSession();
  }

  async loadConfig() {
    try {
      const data = await api.request('/payments/config');
      this.razorpayKey = data.razorpayKeyId;
      this.logDevConsole(`Loaded gateway config. Key ID: ${this.razorpayKey}`, 'info');
    } catch (err) {
      console.warn('Failed to load payment config, defaulting to mock mode:', err);
      this.razorpayKey = 'rzp_test_mockKeyId123';
    }
  }

  bindEvents() {
    // Navigation / Setup
    if (this.pledgeBtn) {
      this.pledgeBtn.addEventListener('click', () => this.initiatePledgeCheckout());
    }

    if (this.portalCloseBtn) {
      this.portalCloseBtn.addEventListener('click', () => this.closePortal());
    }

    // Tab selectors
    const methodTabs = document.querySelectorAll('.payment-method-tab');
    methodTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const method = e.currentTarget.getAttribute('data-method');
        this.switchPaymentMethod(method);
      });
    });

    // Payment submissions
    if (this.portalPayBtn) {
      this.portalPayBtn.addEventListener('click', () => this.processPaymentSubmit());
    }

    if (this.vpaVerifyBtn) {
      this.vpaVerifyBtn.addEventListener('click', () => this.simulateUpiCollectFlow());
    }

    if (this.bankSubmitBtn) {
      this.bankSubmitBtn.addEventListener('click', () => this.processBankOtpSubmit());
    }

    // Developer / Recruiter Tools binding
    if (this.devWebhookBtn) this.devWebhookBtn.addEventListener('click', () => this.simulateDevWebhook(false, false));
    if (this.devReplayBtn) this.devReplayBtn.addEventListener('click', () => this.simulateDevWebhook(false, true));
    if (this.devSignatureBtn) this.devSignatureBtn.addEventListener('click', () => this.simulateDevWebhook(true, false));
    if (this.devMockPledgesBtn) this.devMockPledgesBtn.addEventListener('click', () => this.fillMockPledges());
    if (this.devResetBtn) this.devResetBtn.addEventListener('click', () => this.resetFundingPool());
  }

  // Retrieve current active co-funding details
  async loadActiveSession() {
    try {
      const data = await api.request('/payments/co-fund/active');
      
      this.activeSession = data.session;
      this.pledges = data.pledges;

      this.renderMetrics();
      this.renderPricingScale();
      this.checkUserPledgeStatus();
    } catch (err) {
      this.logDevConsole('Error loading active session: ' + err.message, 'error');
    }
  }

  // Draw metrics & progress bar
  renderMetrics() {
    if (!this.activeSession) return;

    const count = this.activeSession.pledgesCount;
    const target = this.activeSession.targetPledges;

    if (this.pledgeCountEl) this.pledgeCountEl.textContent = count;
    if (this.targetCountEl) this.targetCountEl.textContent = `Target: ${target} Pledges`;

    const percentage = Math.min((count / target) * 100, 100);
    if (this.progressBar) {
      this.progressBar.style.width = `${percentage}%`;
    }
  }

  // Render the 5 pricing steps matching exponential decay formula
  renderPricingScale() {
    if (!this.activeSession || !this.pricingScaleGrid) return;

    this.pricingScaleGrid.innerHTML = '';
    const currentCount = this.activeSession.pledgesCount;

    // Calculate rates for N = 1 to 5
    for (let N = 1; N <= 5; N++) {
      const maxPrice = 999;
      const minPrice = 499;
      const lambda = 0.3;
      const finalPrice = Math.round(minPrice + (maxPrice - minPrice) * Math.exp(-lambda * (N - 1)));

      const isActive = currentCount === N || (N === 5 && currentCount >= 5) || (N === 1 && currentCount === 0);
      const isPassed = currentCount > N && !(N === 5);

      const card = document.createElement('div');
      card.className = `pricing-scale-card ${isActive ? 'pricing-scale-card--active' : ''} ${isPassed ? 'pricing-scale-card--passed' : ''}`;
      
      card.innerHTML = `
        <div class="members-num">${N} Pledge${N > 1 ? 's' : ''}</div>
        <div class="price-val">₹${finalPrice}</div>
        ${isActive ? '<span class="pricing-card-badge">CURRENT</span>' : ''}
      `;

      this.pricingScaleGrid.appendChild(card);
    }
  }

  // Check if current logged in user has already pledged
  checkUserPledgeStatus() {
    const currentUser = localStorage.getItem('tasksphere_username') || 'Anonymous';
    const hasPledged = this.pledges.some(p => p.username === currentUser && (p.status === 'AUTHORIZED' || p.status === 'CAPTURED'));

    if (this.pledgeBtn) {
      if (hasPledged) {
        this.pledgeBtn.disabled = true;
        this.pledgeBtn.innerHTML = `
          <svg class="w-4 h-4 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          Pledge Secured (Authorized)
        `;
        this.pledgeBtn.className = "pledge-share-btn pledge-share-btn--secured";
      } else if (this.activeSession && this.activeSession.status === 'SUCCESS') {
        this.pledgeBtn.disabled = true;
        this.pledgeBtn.innerHTML = `
          <svg class="w-4 h-4 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
          Workspace Upgrade Complete
        `;
        this.pledgeBtn.className = "pledge-share-btn pledge-share-btn--completed";
      } else {
        this.pledgeBtn.disabled = false;
        this.pledgeBtn.textContent = 'Pledge Share (Hold ₹999)';
        this.pledgeBtn.className = "pledge-share-btn";
      }
    }
  }

  // Start checkout, call order API with Idempotency Key header
  async initiatePledgeCheckout() {
    const currentUser = localStorage.getItem('tasksphere_username') || 'Anonymous';
    
    // Load config if not loaded
    if (!this.razorpayKey) {
      await this.loadConfig();
    }

    // Set a unique idempotency key for this checkout attempt
    if (!this.idempotencyKey) {
      this.idempotencyKey = 'pledge_idemp_' + Math.random().toString(36).substring(2, 15);
    }

    this.logDevConsole(`Initiating Order creation with Idempotency-Key: ${this.idempotencyKey}...`, 'info');

    try {
      const data = await api.request('/payments/co-fund/order', {
        method: 'POST',
        headers: {
          'Idempotency-Key': this.idempotencyKey
        },
        body: JSON.stringify({
          username: currentUser,
          paymentMethod: this.selectedMethod
        })
      });

      this.currentOrderId = data.orderId;
      this.logDevConsole(`Order created successfully on gateway rails. Order ID: ${this.currentOrderId}.`, 'success');

      const isMockKey = !this.razorpayKey || this.razorpayKey === 'rzp_test_mockKeyId123' || this.currentOrderId.startsWith('order_mock_');

      if (!isMockKey) {
        this.logDevConsole('Real Razorpay credentials found. Opening official Razorpay Checkout SDK popup...', 'info');
        this.openRealRazorpayCheckout(data.orderId, data.amount);
      } else {
        this.logDevConsole('Mock mode active. Opening simulated checkout portal...', 'info');
        // Open Payment overlay
        if (this.portalOverlay) {
          this.portalOverlay.classList.add('payment-portal-overlay--active');
          this.switchPaymentMethod('card');
        }
      }
    } catch (err) {
      this.logDevConsole(`Failed to initialize Order: ${err.message}`, 'error');
      alert(`Initialization failed: ${err.message}`);
    }
  }

  openRealRazorpayCheckout(orderId, amount) {
    const currentUser = localStorage.getItem('tasksphere_username') || 'Anonymous';
    
    const options = {
      "key": this.razorpayKey,
      "amount": Math.round(amount * 100).toString(), // in paise
      "currency": "INR",
      "name": "TaskSphere Workspace",
      "description": "Workspace Premium Co-Funding Upgrade",
      "order_id": orderId,
      "handler": async (response) => {
        this.logDevConsole('Official checkout authorization success. Dispatching signature for verification...', 'success');
        await this.verifyRealPayment(response);
      },
      "prefill": {
        "name": currentUser,
        "email": currentUser.toLowerCase() + "@tasksphere.com"
      },
      "theme": {
        "color": "#6366f1"
      }
    };
    
    try {
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response) => {
        this.logDevConsole(`Payment Failed: ${response.error.description}`, 'error');
        alert(`Payment Failed: ${response.error.description}`);
      });
      rzp.open();
    } catch (err) {
      this.logDevConsole(`Failed to open Razorpay SDK: ${err.message}`, 'error');
      alert(`Razorpay SDK Error: ${err.message}`);
    }
  }

  async verifyRealPayment(response) {
    try {
      await api.request('/payments/verify', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature
        })
      });
      
      this.logDevConsole('Cryptographic signature verified successfully by backend. Unlocking premium features!', 'success');
      this.showSuccessOverlay();
      this.idempotencyKey = null;
    } catch (err) {
      this.logDevConsole(`Verification failed: ${err.message}`, 'error');
      alert(`Payment Verification Failed: ${err.message}`);
    }
  }

  switchPaymentMethod(method) {
    this.selectedMethod = method;
    
    // Update tabs active state
    const tabs = document.querySelectorAll('.payment-method-tab');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-method') === method) {
        tab.classList.add('payment-method-tab--active');
      } else {
        tab.classList.remove('payment-method-tab--active');
      }
    });

    // Update form content displays
    const panels = ['card', 'upi', 'netbanking'];
    panels.forEach(p => {
      const panelEl = document.getElementById(`panel_${p}`);
      if (panelEl) {
        panelEl.style.display = (p === method) ? 'block' : 'none';
      }
    });

    // Handle checkout button text
    if (this.portalPayBtn) {
      if (method === 'card') {
        this.portalPayBtn.style.display = 'block';
        this.portalPayBtn.textContent = 'Pay & Tokenize Card';
      } else if (method === 'netbanking') {
        this.portalPayBtn.style.display = 'none';
      } else {
        // UPI is collect or scan, check pay button visibility
        this.portalPayBtn.style.display = 'none';
      }
    }

    if (method === 'upi') {
      this.drawUpiQrCode();
    }
  }

  // Tokenize card client-side (PCI-DSS compliance)
  processPaymentSubmit() {
    if (this.selectedMethod === 'card') {
      const number = document.getElementById('card_number').value;
      const expiry = document.getElementById('card_expiry').value;
      const cvv = document.getElementById('card_cvv').value;

      if (!number || !expiry || !cvv) {
        alert('Please fill out card credentials.');
        return;
      }

      this.logDevConsole('Client tokenizing raw card details directly to Gateway Vault...', 'info');
      this.logDevConsole('Card details omitted from merchant memory. Token generated: tok_card_success_12345', 'success');

      // Add a small mock authorization step
      this.logDevConsole('Prompting Issuing Bank 3DS OTP Challenge overlay...', 'info');
      
      const otp = prompt("Issuing Bank Simulator: Enter 3DS secure OTP code (Code is 111000 to authorize):", "111000");
      if (otp === "111000") {
        this.logDevConsole('3DS OTP verification complete. Triggering authorized webhook sequence...', 'info');
        this.simulateDevWebhook(false, false);
      } else {
        this.logDevConsole('3DS authentication cancelled or failed.', 'error');
        alert('Transaction declined: 3DS OTP failure.');
      }
    }
  }

  // UPI Collect Push Simulation
  simulateUpiCollectFlow() {
    const vpa = document.getElementById('upi_vpa').value;
    if (!vpa || !vpa.includes('@')) {
      alert('Please enter a valid VPA Address (e.g. user@okaxis)');
      return;
    }

    this.logDevConsole(`UPI Collect request sent for VPA: ${vpa}`, 'info');
    
    // Simulate push alert
    const choice = confirm(`Simulated UPI Push Notification: Approve pledge hold of ₹999.00 from VPA ${vpa}?`);
    if (choice) {
      this.logDevConsole('UPI authorization approved on client device. Sending authorization confirmation...', 'success');
      this.simulateDevWebhook(false, false);
    } else {
      this.logDevConsole('UPI Collect authorization rejected by user.', 'error');
      alert('Pledge cancelled.');
    }
  }

  // Draws compliance UPI dynamic QR Code using canvas APIs
  drawUpiQrCode() {
    const canvas = document.getElementById('upiQrCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 180, 180);

    // Dynamic QR generation simulated
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 180, 180);

    // Draw borders & mock finder squares
    ctx.fillStyle = '#0f172a';
    this.drawFinderPattern(ctx, 10, 10);
    this.drawFinderPattern(ctx, 130, 10);
    this.drawFinderPattern(ctx, 10, 130);

    // Fill inner mock codes
    ctx.fillStyle = '#1e293b';
    for (let x = 45; x < 135; x += 8) {
      for (let y = 10; y < 170; y += 8) {
        if (Math.random() > 0.4) {
          ctx.fillRect(x, y, 6, 6);
        }
      }
    }

    // Add Logo in the middle
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.arc(90, 90, 16, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TS', 90, 90);
  }

  drawFinderPattern(ctx, x, y) {
    ctx.fillRect(x, y, 40, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 5, y + 5, 30, 30);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + 10, y + 10, 20, 20);
  }

  // Redirect to Bank portal layout for Netbanking
  redirectToNetbankingBank(bankName) {
    this.closePortal();
    const bankPortal = document.getElementById('bankPortalOverlay');
    const bankLabel = document.getElementById('bankPortalName');
    
    if (bankPortal && bankLabel) {
      bankLabel.textContent = `${bankName} Secure Gateway`;
      bankPortal.style.display = 'flex';
      this.logDevConsole(`Redirected user to isolated Netbanking portal for bank: ${bankName}`, 'info');
    }
  }

  // Process Netbanking code submission
  async processBankOtpSubmit() {
    const otp = document.getElementById('bank_otp').value;
    if (otp !== '123456') {
      alert('Invalid OTP. Use the code 123456 displayed on screen to authorize.');
      return;
    }

    this.logDevConsole('Netbanking OTP verified successfully. Dispatched webhook status...', 'success');
    
    // Hide bank overlay
    const bankPortal = document.getElementById('bankPortalOverlay');
    if (bankPortal) bankPortal.style.display = 'none';

    // Call webhook endpoint
    await this.simulateDevWebhook(false, false);
  }

  // Triggers mock webhook payload via developer endpoints
  async simulateDevWebhook(causeBadSignature = false, causeTimeDrift = false) {
    if (!this.currentOrderId) {
      alert('No active payment order to simulate. Click "Pledge Share" first.');
      return;
    }

    const secret = causeBadSignature ? "bad_tampered_secret_key" : "tasksphere_secure_webhook_secret_key_2026_xyz";
    
    this.logDevConsole(`[API-SANDBOX] Dispatched webhook with config { drift=${causeTimeDrift}, signatureSecret='${secret.substring(0, 10)}...' }`, 'info');

    try {
      await api.request('/payments/dev/simulate-webhook', {
        method: 'POST',
        body: JSON.stringify({
          event: "payment.authorized",
          orderId: this.currentOrderId,
          webhookSecret: secret,
          causeTimeDrift: causeTimeDrift
        })
      });

      this.logDevConsole(`[SECURITY-VERIFIED] Webhook parsed successfully: HTTP 200`, 'success');
      
      // Close portals & reload metrics
      this.closePortal();
      this.idempotencyKey = null; // Clear key for subsequent checkouts

      // Show success checkmark panel overlay
      this.showSuccessOverlay();

    } catch (err) {
      this.logDevConsole(`Webhook delivery failure: ${err.message}`, 'error');
    }
  }

  // Populate mock pledges to demo curve adjustments
  async fillMockPledges() {
    this.logDevConsole('[SANDBOX] Requesting fill-mock-pledges setup from server...', 'info');

    try {
      await api.request('/payments/dev/fill-mock-pledges', { method: 'POST' });
      this.logDevConsole('[SANDBOX] Populated 4 mock pledges successfully: alice, bob, charlie, david added.', 'success');
      this.loadActiveSession();

    } catch (err) {
      this.logDevConsole(`Sandbox mock fail: ${err.message}`, 'error');
    }
  }

  // Reset co-funding session to clean sandbox state
  async resetFundingPool() {
    this.logDevConsole('[SANDBOX] Resetting workspace co-funding pool...', 'info');

    try {
      await api.request('/payments/co-fund/reset', { method: 'POST' });
      this.logDevConsole('[SANDBOX] Reset completed. All pledges voided and new active session initialized.', 'success');
      this.currentOrderId = null;
      this.idempotencyKey = null;
      
      this.loadActiveSession();

    } catch (err) {
      this.logDevConsole(`Reset fail: ${err.message}`, 'error');
    }
  }

  showSuccessOverlay() {
    this.closePortal();
    const successOverlay = document.getElementById('paymentSuccessOverlay');
    if (successOverlay) {
      successOverlay.style.display = 'flex';
      setTimeout(() => {
        successOverlay.style.display = 'none';
        this.loadActiveSession();
      }, 3000);
    }
  }

  closePortal() {
    if (this.portalOverlay) {
      this.portalOverlay.classList.remove('payment-portal-overlay--active');
    }
  }

  logDevConsole(msg, type = 'info') {
    if (!this.devConsole) return;

    const time = new Date().toLocaleTimeString();
    let color = '#34d399'; // green for success
    if (type === 'error') color = '#f87171'; // red
    if (type === 'info') color = '#38bdf8'; // blue

    const line = `<div style="color: ${color}">[${time}] ${msg}</div>`;
    this.devConsole.innerHTML += line;
    this.devConsole.scrollTop = this.devConsole.scrollHeight;
  }
}

// Instantiate global checkouts handler
window.PaymentCheckout = new PaymentCheckoutController();
document.addEventListener('DOMContentLoaded', () => window.PaymentCheckout.init());
