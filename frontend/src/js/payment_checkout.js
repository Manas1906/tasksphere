import { api } from './api.js';

/**
 * TaskSphere Pro Plan Payment Controller
 * Handles all 4 upgrade products via Razorpay Standard Checkout
 */
class PaymentCheckoutController {
  constructor() {
    this.razorpayKey = null;
    // legacy fields for backward compat (old template elements still exist hidden)
    this.activeSession = null;
    this.pledges = [];
    this.selectedMethod = 'card';
    this.currentOrderId = null;
    this.idempotencyKey = null;
  }

  async init() {
    // Bind hidden legacy elements (they are display:none, harmless)
    this.pledgeBtn        = document.getElementById('pledgeShareBtn');
    this.progressBar      = document.getElementById('cofundProgressBar');
    this.pledgeCountEl    = document.getElementById('cofundPledgeCount');
    this.targetCountEl    = document.getElementById('cofundTargetCount');
    this.pricingScaleGrid = document.getElementById('pricingScaleGrid');
    this.portalOverlay    = document.getElementById('paymentPortalOverlay');
    this.portalCloseBtn   = document.getElementById('paymentPortalClose');
    this.portalPayBtn     = document.getElementById('paymentPortalPayBtn');
    this.vpaVerifyBtn     = document.getElementById('upiVerifyVpaBtn');
    this.bankSubmitBtn    = document.getElementById('bankOtpSubmitBtn');
    this.devConsole       = document.getElementById('devConsoleLog');
    this.devWebhookBtn    = document.getElementById('devWebhookBtn');
    this.devReplayBtn     = document.getElementById('devReplayBtn');
    this.devSignatureBtn  = document.getElementById('devSignatureBtn');
    this.devMockPledgesBtn= document.getElementById('devMockPledgesBtn');
    this.devResetBtn      = document.getElementById('devResetBtn');

    await this.loadConfig();
    await this.loadActiveSession();
  }

  async loadConfig() {
    // Priority 1: Vite build-time env variable (KEY_ID only — secret never reaches frontend)
    const envKey = import.meta.env.VITE_RAZORPAY_KEY_ID;
    if (envKey) {
      this.razorpayKey = envKey;
      console.log('[PAYMENTS] Key loaded from env variable.');
      return;
    }

    // Priority 2: Backend /payments/config endpoint (returns key ID from server config)
    try {
      const data = await api.request('/payments/config');
      if (data && data.razorpayKeyId) {
        this.razorpayKey = data.razorpayKeyId;
        console.log('[PAYMENTS] Key loaded from backend config API.');
      } else {
        console.warn('[PAYMENTS] Backend returned no key. Set RAZORPAY_KEY_ID env var on the server.');
      }
    } catch (err) {
      console.warn('[PAYMENTS] Could not load Razorpay key. Set VITE_RAZORPAY_KEY_ID in frontend/.env:', err.message);
      // Do NOT hardcode any key here — keys must come from environment variables only
    }
  }

  /**
   * Main entry point called by each pricing card button.
   * @param {string} planId        - e.g. 'pro_monthly', 'pdf_export', 'theme_pack', 'team_seat'
   * @param {number} amountInPaise - e.g. 49900 for Rs.499
   * @param {string} description   - Human-readable product name shown inside Razorpay modal
   */
  async startCheckout(planId, amountInPaise, description) {
    const currentUser = localStorage.getItem('chat_username') || localStorage.getItem('tasksphere_username') || 'user';

    if (!this.razorpayKey) {
      await this.loadConfig();
    }

    // Highlight active card
    document.querySelectorAll('.pro-plan-card').forEach(c => c.style.outline = '');
    const cardMap = {
      'pro_monthly': 'planCardPro',
      'pdf_export':  'planCardPdf',
      'theme_pack':  'planCardTheme',
      'team_seat':   'planCardTeam',
    };
    const card = document.getElementById(cardMap[planId]);
    if (card) card.style.outline = '2px solid #6366f1';

    try {
      const idempKey = 'order_' + planId + '_' + Date.now();
      const orderData = await api.request('/payments/co-fund/order', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempKey },
        body: JSON.stringify({
          username: currentUser,
          paymentMethod: planId,
          planId: planId,
          amount: amountInPaise
        })
      });

      const orderId = orderData.orderId;
      this._openRazorpay(orderId, amountInPaise, description, currentUser, planId);

    } catch (err) {
      console.warn('[PAYMENTS] Order API error, falling back to direct Razorpay open:', err.message);
      this._openRazorpay(null, amountInPaise, description, currentUser, planId);
    }
  }

  _openRazorpay(orderId, amountInPaise, description, username, planId) {
    const options = {
      key: this.razorpayKey,
      amount: amountInPaise.toString(),
      currency: 'INR',
      name: 'TaskSphere',
      description: description,
      image: 'https://api.dicebear.com/7.x/shapes/svg?seed=tasksphere&backgroundColor=6366f1',
      handler: async (response) => {
        await this._onPaymentSuccess(response, planId);
      },
      prefill: {
        name: username,
        email: username.toLowerCase() + '@tasksphere.com',
        contact: '9999999999',
      },
      notes: {
        planId: planId,
        username: username
      },
      theme: { color: '#6366f1' },
      modal: {
        ondismiss: () => {
          document.querySelectorAll('.pro-plan-card').forEach(c => c.style.outline = '');
          console.log('[PAYMENTS] User dismissed checkout.');
        }
      }
    };

    if (orderId) {
      options.order_id = orderId;
    }

    try {
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        console.error('[PAYMENTS] Payment failed:', resp.error.description);
        this._showToast('Payment failed: ' + resp.error.description, 'error');
        document.querySelectorAll('.pro-plan-card').forEach(c => c.style.outline = '');
      });
      rzp.open();
    } catch (err) {
      this._showToast('Could not open Razorpay. Check your connection.', 'error');
      console.error('[PAYMENTS] Razorpay SDK error:', err);
    }
  }

  async _onPaymentSuccess(response, planId) {
    console.log('[PAYMENTS] Authorized. Verifying signature...');
    this._showToast('Payment received! Verifying...', 'info');

    const currentUser = localStorage.getItem('chat_username') || localStorage.getItem('tasksphere_username') || 'user';

    try {
      await api.request('/payments/verify', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id:   response.razorpay_order_id,
          razorpay_signature:  response.razorpay_signature,
          username:            currentUser,
          planId:              planId
        })
      });

      document.querySelectorAll('.pro-plan-card').forEach(c => c.style.outline = '');
      this._showSuccessModal(planId);
      await this.loadActiveSession();

    } catch (err) {
      console.error('[PAYMENTS] Signature verification failed:', err.message);
      this._showToast('Payment captured but verification failed — contact support.', 'error');
    }
  }

  _showSuccessModal(planId) {
    const labelMap = {
      'pro_monthly': 'TaskSphere Pro is now active! 🚀',
      'pdf_export':  'PDF Export unlocked! Your download is ready. 📄',
      'theme_pack':  'Premium Themes Pack unlocked! 🎨',
      'team_seat':   'New team seat added! Invite your teammate. 👥',
    };
    const msg = labelMap[planId] || 'Purchase complete!';

    const overlay = document.getElementById('paymentSuccessOverlay');
    const p = overlay && overlay.querySelector('p');
    if (p) p.textContent = msg;
    if (overlay) {
      overlay.style.display = 'flex';
      setTimeout(() => { overlay.style.display = 'none'; }, 4000);
    }
  }

  _showToast(message, type = 'info') {
    const stack = document.getElementById('toastNotificationStack');
    if (!stack) return;
    const toast = document.createElement('div');
    const colors = { info: '#6366f1', success: '#10b981', error: '#ef4444' };
    toast.style.cssText = [
      'background:' + (colors[type] || '#6366f1'),
      'color:#fff',
      'padding:12px 20px',
      'border-radius:10px',
      'font-size:0.875rem',
      'font-weight:600',
      'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
      'animation:fadeIn 0.3s ease',
      'max-width:340px',
    ].join(';');
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // Legacy stubs (keep hidden elements from throwing errors)
  async loadActiveSession() {
    try {
      console.log('[PAYMENTS] Loading active session/pledges from backend...');
      const data = await api.request('/payments/co-fund/active');
      if (data && data.pledges) {
        this.pledges = data.pledges;
        this.updateUpgradeUI();
      }
    } catch (err) {
      console.error('[PAYMENTS] Error loading active session / pledges:', err);
    }
  }

  updateUpgradeUI() {
    const currentUser = localStorage.getItem('chat_username') || localStorage.getItem('tasksphere_username') || 'user';
    console.log('[PAYMENTS] Updating Upgrade UI for user:', currentUser);
    
    // Find all successful/active/authorized/captured pledges for the current user
    const userPledges = this.pledges.filter(p => 
      p.username.toLowerCase() === currentUser.toLowerCase() && 
      (p.status === 'AUTHORIZED' || p.status === 'CAPTURED' || p.status === 'SUCCESS' || p.status === 'ACTIVE')
    );
    
    console.log('[PAYMENTS] Found user pledges:', userPledges);
    
    // Reset all buttons to default first to handle resets or updates
    const plans = {
      'pro_monthly': { cardId: 'planCardPro', defaultText: 'Get Pro Now', successText: '✨ Active' },
      'pdf_export':  { cardId: 'planCardPdf', defaultText: 'Buy Export', successText: '✨ Unlocked / Download' },
      'theme_pack':  { cardId: 'planCardTheme', defaultText: 'Get Themes', successText: '✨ Unlocked / Active' },
      'team_seat':   { cardId: 'planCardTeam', defaultText: 'Add Seat', successText: '✨ Seat Unlocked' }
    };
    
    Object.keys(plans).forEach(planId => {
      const plan = plans[planId];
      const card = document.getElementById(plan.cardId);
      if (card) {
        const btn = card.querySelector('.pro-plan-btn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = plan.defaultText;
          btn.style.background = '';
          btn.style.cursor = '';
        }
      }
    });
    
    // Check if the user has an active pro subscription
    const hasPro = userPledges.some(p => p.paymentMethod.toLowerCase() === 'pro_monthly');

    // Now disable/update buttons for purchased/unlocked plans
    userPledges.forEach(pledge => {
      const planId = pledge.paymentMethod.toLowerCase(); // paymentMethod contains the planId (e.g. 'PRO_MONTHLY', 'PDF_EXPORT')
      const plan = plans[planId];
      if (plan) {
        const card = document.getElementById(plan.cardId);
        if (card) {
          const btn = card.querySelector('.pro-plan-btn');
          if (btn) {
            btn.disabled = true;
            btn.textContent = plan.successText;
            btn.style.background = 'var(--accent-green, #10b981)';
            btn.style.cursor = 'default';
          }
        }
      }
    });

    // If user has Pro, automatically unlock and activate all features in the bundle!
    if (hasPro) {
      Object.keys(plans).forEach(planId => {
        const plan = plans[planId];
        const card = document.getElementById(plan.cardId);
        if (card) {
          const btn = card.querySelector('.pro-plan-btn');
          if (btn) {
            btn.disabled = true;
            btn.textContent = plan.successText;
            btn.style.background = 'var(--accent-green, #10b981)';
            btn.style.cursor = 'default';
          }
        }
      });
    }
  }
}

// Export global singleton
window.PaymentCheckout = new PaymentCheckoutController();
document.addEventListener('DOMContentLoaded', () => window.PaymentCheckout.init());
