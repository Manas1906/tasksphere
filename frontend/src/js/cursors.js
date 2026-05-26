import { socket } from './websocket';

/**
 * CursorSyncController - Orchestrates Figma-like collaborative cursor synchronizations
 */
export class CursorSyncController {
  constructor() {
    this.layer = document.getElementById('collaborativeCursorLayer');
    this.remoteCursors = {}; // Cache of active remote pointer DOM elements: { username: { element, timeoutId } }
    this.mousemoveHandler = null;
  }

  get myUsername() {
    return localStorage.getItem('chat_username') || '';
  }

  get myRole() {
    return localStorage.getItem('chat_role') || 'DEVELOPER';
  }

  init() {
    console.log('[CURSOR-INIT] Initializing CursorSyncController...');
    if (!this.layer) {
      console.warn('[CURSOR-INIT-WARNING] Collaborative cursor layer DOM element not found!');
      return;
    }

    // Set up local cursor throttling dispatcher (80ms)
    this.throttledSend = this.throttle((x, y) => {
      if (socket && socket.connected && this.myUsername) {
        socket.send('/app/cursors.move', {
          username: this.myUsername,
          role: this.myRole,
          x: x,
          y: y
        });
      }
    }, 80);

    this.bindMouseMove();
  }

  subscribeChannel() {
    if (!socket || !socket.connected) return;
    
    console.log('[CURSOR-SUBSCRIBE] Subscribing to collaborative cursor sync channel...');
    
    // Subscribe to coordinates updates
    socket.subscribe('/topic/cursors', (payload) => {
      if (!payload || !payload.username) return;
      
      // Filter out self pointer streams
      if (payload.username === this.myUsername) return;
      
      this.updateRemoteCursor(payload);
    });
  }

  bindMouseMove() {
    const container = document.getElementById('mainContainer');
    if (!container) return;

    console.log('[CURSOR-TRACK] Setting up local mouse movement tracking inside mainContainer...');
    
    this.mousemoveHandler = (e) => {
      if (!this.myUsername) return;

      const rect = container.getBoundingClientRect();
      
      // Calculate cursor position as responsive percentage relative to container boundary
      const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const yPercent = ((e.clientY - rect.top) / rect.height) * 100;

      // Broadcast throttled update
      this.throttledSend(xPercent, yPercent);
    };

    container.addEventListener('mousemove', this.mousemoveHandler);
  }

  updateRemoteCursor(payload) {
    const { username, role, x, y } = payload;
    let remote = this.remoteCursors[username];

    if (!remote) {
      console.log(`[CURSOR-SPAWN] Spawning new pointer container for user: ${username}`);
      
      const el = document.createElement('div');
      el.className = `remote-cursor remote-cursor--${(role || 'developer').toLowerCase()}`;
      
      // Inject glowing pointer tip SVG and dynamic capsule username label
      el.innerHTML = `
        <svg class="remote-cursor__pointer" viewBox="0 0 24 24">
          <path d="M4.5 3v15.2l4.5-4.3 3 5.3 2.5-1.4-3-5.3h6z"/>
        </svg>
        <span class="remote-cursor__label">${username}</span>
      `;
      
      this.layer.appendChild(el);
      
      // Trigger reflow to initiate smooth opacity/scale entry transition
      setTimeout(() => el.classList.add('visible'), 20);
      
      remote = {
        element: el,
        timeoutId: null
      };
      
      this.remoteCursors[username] = remote;
    }

    // Set responsive position
    remote.element.style.left = `${x}%`;
    remote.element.style.top = `${y}%`;

    // Reset inactivity expiration timeout (3s)
    if (remote.timeoutId) clearTimeout(remote.timeoutId);
    
    remote.timeoutId = setTimeout(() => {
      this.removeRemoteCursor(username);
    }, 3000);
  }

  removeRemoteCursor(username) {
    const remote = this.remoteCursors[username];
    if (remote) {
      console.log(`[CURSOR-EXPIRE] User inactivity timeout reached. Removing pointer: ${username}`);
      remote.element.classList.remove('visible');
      if (remote.timeoutId) clearTimeout(remote.timeoutId);
      
      setTimeout(() => {
        if (remote.element.parentNode === this.layer) {
          this.layer.removeChild(remote.element);
        }
      }, 250); // wait for fade transition to end
      
      delete this.remoteCursors[username];
    }
  }

  clearAllCursors() {
    console.log('[CURSOR-CLEANUP] Cleaning up all active remote pointers...');
    Object.keys(this.remoteCursors).forEach(username => {
      this.removeRemoteCursor(username);
    });
  }

  disconnect() {
    this.clearAllCursors();
    const container = document.getElementById('mainContainer');
    if (container && this.mousemoveHandler) {
      container.removeEventListener('mousemove', this.mousemoveHandler);
    }
  }

  // Throttle helper - enforces coordinate dispatch restrictions
  throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
}
