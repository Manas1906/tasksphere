import { api } from './api';

/**
 * AdminView - Real-time Centralized Admin Panel
 * Handles user directory lookups, access approvals, and role management.
 */
export class AdminView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  get myUsername() {
    return localStorage.getItem('chat_username') || 'admin';
  }

  async render() {
    this.container.innerHTML = `
      <div class="chat-panel-header" style="background: none; border: none; padding: 0; margin-bottom: var(--spacing-lg)">
        <h2 class="modal-header__title" style="font-size: var(--font-size-xl); display: flex; align-items: center; gap: 6px;">${this.getIconSvg('crown')} Centralized Admin Directory</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm)">Review active workspace sessions, authorize pending registrations, and manage team credentials in real-time.</p>
      </div>

      <div class="admin-panel">
        <div class="admin-header">
          <div>
            <div class="admin-title" style="display: flex; align-items: center; gap: 6px;">
              ${this.getIconSvg('group')} <span>User Accounts Directory</span>
            </div>
            <div class="admin-subtitle">Verify workspace membership and approval logs.</div>
          </div>
          <button id="refreshAdminDir" class="filter-btn" style="padding: 6px 12px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
            ${this.getIconSvg('refresh')} Refresh Registry
          </button>
        </div>

        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Member Profile</th>
                <th>Selected Enterprise Role</th>
                <th>Access Status</th>
                <th style="text-align: right">Administrative Actions</th>
              </tr>
            </thead>
            <tbody id="adminUsersTbody">
              <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
                  <span class="auth-spinner" style="display: inline-block; vertical-align: middle; margin-right: 8px;"></span> Loading directory...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Feature Gates Section -->
      <div class="admin-panel feature-gates-section">
        <div class="admin-header">
          <div>
            <div class="admin-title" style="display: flex; align-items: center; gap: 6px;">
              ${this.getIconSvg('status')} <span>Feature Gates</span>
            </div>
            <div class="admin-subtitle">Control platform-wide feature availability for all workspace members.</div>
          </div>
        </div>
        <div id="featureGatesContainer" style="padding: var(--spacing-md);">
          <div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 12px;">Loading feature gates...</div>
        </div>
      </div>
    `;

    // Bind refresh button
    const refreshBtn = document.getElementById('refreshAdminDir');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.loadDirectory();
    }

    // Load actual content
    await this.loadDirectory();
    await this.loadFeatureGates();
  }

  async loadDirectory() {
    const tbody = document.getElementById('adminUsersTbody');
    if (!tbody) return;

    try {
      // Fetch user accounts
      const users = await api.getUsers() || [];
      tbody.innerHTML = '';

      if (users.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
              No registered user sessions found in the directory.
            </td>
          </tr>
        `;
        return;
      }

      users.forEach(user => {
        const isPending = user.status === 'PENDING_APPROVAL';
        const formattedRole = (user.role || 'DEVELOPER').replace(/_/g, ' ');
        const isAdminRole = user.role === 'PRODUCT_OWNER' || user.role === 'MANAGER';
        
        // Parse metadata inside avatarUrl string (email & mfa)
        const rawAvatar = user.avatarUrl || '';
        let cleanAvatar = rawAvatar;
        let email = 'N/A';
        let mfaEnabled = false;
        
        if (rawAvatar.includes('||')) {
          const parts = rawAvatar.split('||');
          cleanAvatar = parts[0];
          parts.forEach(part => {
            if (part.startsWith('email:')) {
              email = part.substring(6);
            } else if (part.startsWith('mfa:')) {
              mfaEnabled = part.substring(4) === 'true';
            }
          });
        }
        
        if (!cleanAvatar) {
          cleanAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
        }

        const safeUsername = window.escapeHTML ? window.escapeHTML(user.username) : user.username;
        const safeEmail = window.escapeHTML ? window.escapeHTML(email) : email;
        const safeFormattedRole = window.escapeHTML ? window.escapeHTML(formattedRole) : formattedRole;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div class="admin-user-cell">
              <div class="admin-avatar-container">
                <img class="admin-user-avatar" src="${cleanAvatar}" alt="${safeUsername}">
                <div class="admin-user-details-tooltip">
                  <div class="tooltip-banner"></div>
                  <div class="tooltip-avatar-wrapper">
                    <img src="${cleanAvatar}" class="tooltip-avatar" alt="${safeUsername}">
                  </div>
                  <div class="tooltip-body">
                    <h4 class="tooltip-name">${safeUsername}</h4>
                    <span class="tooltip-role">${safeFormattedRole}</span>
                    
                    <div class="tooltip-divider"></div>
                    
                    <div class="tooltip-info-section">
                      <div class="tooltip-info-item">
                        <span class="info-icon" style="display: inline-flex; align-items: center;">${this.getIconSvg('email')}</span>
                        <div class="info-content">
                          <span class="info-label">Email Address</span>
                          <span class="info-value" title="${safeEmail}">${safeEmail}</span>
                        </div>
                      </div>
                      
                      <div class="tooltip-info-item">
                        <span class="info-icon" style="display: inline-flex; align-items: center;">${this.getIconSvg('key')}</span>
                        <div class="info-content">
                          <span class="info-label">Security Credentials</span>
                          <span class="info-value ${mfaEnabled ? 'enabled' : 'disabled'}">MFA: ${mfaEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                      </div>

                      <div class="tooltip-info-item">
                        <span class="info-icon" style="display: inline-flex; align-items: center;">${this.getIconSvg('status')}</span>
                        <div class="info-content">
                          <span class="info-label">Account Status</span>
                          <span class="info-value status-${user.status.toLowerCase()}">${isPending ? 'Pending Approval' : 'Approved / Active'}</span>
                        </div>
                      </div>

                      <div class="tooltip-info-item">
                        <span class="info-icon" style="display: inline-flex; align-items: center;">${this.getIconSvg('id')}</span>
                        <div class="info-content">
                          <span class="info-label">Session ID</span>
                          <span class="info-value tooltip-uuid" title="${user.id}">${user.id}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div class="admin-user-name">${user.username}</div>
                <div style="font-size: 11px; color: var(--text-muted)">ID: ${user.id.substring(0, 8)}...</div>
              </div>
            </div>
          </td>
          <td>
            <span class="admin-badge ${isAdminRole ? 'admin-badge--role-admin' : 'admin-badge--role'}" style="display: inline-flex; align-items: center; gap: 4px;">
              ${isAdminRole ? this.getIconSvg('crown') : ''}${formattedRole}
            </span>
          </td>
          <td>
            <span class="admin-badge ${isPending ? 'admin-badge--pending' : 'admin-badge--approved'}" style="display: inline-flex; align-items: center; gap: 4px;">
              ${isPending ? `${this.getIconSvg('pending')} Pending Approval` : '● Approved / Active'}
            </span>
          </td>
          <td style="text-align: right">
            <div style="display: inline-flex; gap: 8px; justify-content: flex-end">
              ${isPending ? `
                <button class="admin-action-btn admin-action-btn--approve" data-user="${user.username}" style="display: inline-flex; align-items: center;">
                  ${this.getIconSvg('check')} Approve
                </button>
              ` : ''}
              <button class="admin-action-btn admin-action-btn--reject" data-user="${user.username}">
                ${isPending ? 'Decline' : 'Revoke'}
              </button>
            </div>
          </td>
        `;

        tbody.appendChild(tr);
      });

      // Bind button click handlers
      tbody.querySelectorAll('.admin-action-btn--approve').forEach(btn => {
        btn.onclick = async () => {
          const username = btn.getAttribute('data-user');
          await this.approveUser(username);
        };
      });

      tbody.querySelectorAll('.admin-action-btn--reject').forEach(btn => {
        btn.onclick = async () => {
          const username = btn.getAttribute('data-user');
          const isPending = btn.textContent.trim().toLowerCase() === 'decline';
          const confirmMsg = isPending 
            ? `Are you sure you want to decline registration for user "${username}"?` 
            : `Are you sure you want to revoke workspace access for user "${username}"?`;
            
          if (confirm(confirmMsg)) {
            await this.rejectUser(username);
          }
        };
      });

      // Bind smart hover tooltip alignment (prevent top boundary clipping)
      tbody.querySelectorAll('.admin-avatar-container').forEach(container => {
        const tooltip = container.querySelector('.admin-user-details-tooltip');
        if (!tooltip) return;

        container.onmouseenter = () => {
          const rect = container.getBoundingClientRect();
          const tooltipHeight = 310; // Comfortable estimated height of the tooltip
          
          // Check if space above inside the table container is too small
          const tableContainer = document.querySelector('.admin-table-container');
          let hasSpaceAbove = true;
          
          if (tableContainer) {
            const tableRect = tableContainer.getBoundingClientRect();
            // Available space above is the distance from top of avatar to top of table container
            const spaceAbove = rect.top - tableRect.top;
            if (spaceAbove < tooltipHeight) {
              hasSpaceAbove = false;
            }
          } else {
            // Fallback to checking against the top of the viewport
            if (rect.top < tooltipHeight) {
              hasSpaceAbove = false;
            }
          }

          if (!hasSpaceAbove) {
            tooltip.classList.add('tooltip--bottom');
          } else {
            tooltip.classList.remove('tooltip--bottom');
          }
        };
      });

    } catch (err) {
      console.error('[ADMIN] Failed to load directory:', err);
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: #ef4444; padding: 24px;">
            ${this.getIconSvg('warning')} Failed to retrieve directory logs. Error: ${err.message || err}
          </td>
        </tr>
      `;
    }
  }

  async approveUser(username) {
    try {
      console.log(`[ADMIN] Approving user "${username}" by admin "${this.myUsername}"`);
      await api.request(`/users/${encodeURIComponent(username)}/approve?requester=${encodeURIComponent(this.myUsername)}`, {
        method: 'POST'
      });
      
      // Sync via WS presence so the user gets unblocked instantly
      if (window.socket && window.socket.stompClient && window.socket.stompClient.connected) {
        window.socket.stompClient.send('/app/user.presence', {}, JSON.stringify({
          username: username,
          status: 'ONLINE',
          action: 'APPROVED'
        }));
      }

      await this.loadDirectory();
    } catch (err) {
      alert(`Approval failed: ${err.message || err}`);
    }
  }

  async rejectUser(username) {
    try {
      console.log(`[ADMIN] Rejecting/Revoking user "${username}" by admin "${this.myUsername}"`);
      await api.request(`/users/${encodeURIComponent(username)}/reject?requester=${encodeURIComponent(this.myUsername)}`, {
        method: 'POST'
      });

      // Notify the user client via WS presence so they get logged out / kicked
      if (window.socket && window.socket.stompClient && window.socket.stompClient.connected) {
        window.socket.stompClient.send('/app/user.presence', {}, JSON.stringify({
          username: username,
          status: 'OFFLINE',
          action: 'REJECTED'
        }));
      }

      await this.loadDirectory();
    } catch (err) {
      alert(`Action failed: ${err.message || err}`);
    }
  }

  getIconSvg(name) {
    const icons = {
      'crown': `<svg style="width: 14px; height: 14px; fill: var(--accent-cyan); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M12 2l4 5 5-2-2 12H5L3 5l5 2 4-5z"/></svg>`,
      'group': `<svg style="width: 14px; height: 14px; fill: var(--accent-purple); display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 2 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`,
      'refresh': `<svg style="width: 12px; height: 12px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>`,
      'email': `<svg style="width: 14px; height: 14px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
      'key': `<svg style="width: 14px; height: 14px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`,
      'status': `<svg style="width: 14px; height: 14px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>`,
      'id': `<svg style="width: 14px; height: 14px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
      'pending': `<svg style="width: 12px; height: 12px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M6 2h12v6l-4 4 4 4v6H6v-6l4-4-4-4V2zm10 14.5L12 13l-4 3.5V20h8v-3.5zm-4-5l4-3.5V4H8v3.5l4 3.5z"/></svg>`,
      'check': `<svg style="width: 12px; height: 12px; fill: currentColor; display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
      'warning': `<svg style="width: 14px; height: 14px; fill: var(--accent-rose); display: inline-block; vertical-align: middle; margin-right: 4px;" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
      'phone': `<svg style="width: 14px; height: 14px; fill: currentColor; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>`
    };
    return icons[name] || '';
  }

  /* =========================================================================
     Feature Gates Management
     ========================================================================= */

  async loadFeatureGates() {
    const container = document.getElementById('featureGatesContainer');
    if (!container) return;

    try {
      const toggles = await api.getFeatureToggles() || {};

      // Update global feature flags
      window.__featureToggles = toggles;

      const featureDescriptions = {
        'voice_calling': {
          name: 'Voice Calling',
          description: 'Enable free peer-to-peer voice calls in personal DM conversations.',
          icon: 'phone'
        }
      };

      const keys = Object.keys(toggles);
      if (keys.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 12px;">No feature gates configured.</div>`;
        return;
      }

      container.innerHTML = '';
      keys.forEach(key => {
        const enabled = toggles[key];
        const meta = featureDescriptions[key] || { name: key, description: '', icon: 'status' };

        const row = document.createElement('div');
        row.className = 'feature-gate-row';
        row.innerHTML = `
          <div class="feature-gate-info">
            <span class="feature-gate-name">
              ${this.getIconSvg(meta.icon)} ${meta.name}
              <span class="feature-gate-status ${enabled ? 'feature-gate-status--on' : 'feature-gate-status--off'}">
                ${enabled ? 'Active' : 'Disabled'}
              </span>
            </span>
            <span class="feature-gate-desc">${meta.description}</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${enabled ? 'checked' : ''} data-feature-key="${key}">
            <span class="toggle-switch__slider"></span>
          </label>
        `;

        const checkbox = row.querySelector('input[type="checkbox"]');
        checkbox.onchange = async () => {
          await this.toggleFeature(key, checkbox.checked);
        };

        container.appendChild(row);
      });

    } catch (err) {
      console.error('[ADMIN] Failed to load feature gates:', err);
      container.innerHTML = `<div style="text-align: center; color: var(--accent-rose); font-size: 12px; padding: 12px;">Failed to load feature gates: ${err.message || err}</div>`;
    }
  }

  async toggleFeature(key, enabled) {
    try {
      console.log(`[ADMIN] Toggling feature "${key}" to ${enabled} by admin "${this.myUsername}"`);
      await api.updateFeatureToggle(key, enabled, this.myUsername);

      // Update global flags immediately
      if (window.__featureToggles) {
        window.__featureToggles[key] = enabled;
      }

      // Re-render the feature gates section to update status badges
      await this.loadFeatureGates();

    } catch (err) {
      console.error(`[ADMIN] Failed to toggle feature "${key}":`, err);
      alert(`Failed to update feature: ${err.message || err}`);
      // Revert the UI
      await this.loadFeatureGates();
    }
  }
}
