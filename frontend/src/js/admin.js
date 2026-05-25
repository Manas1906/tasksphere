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
        <h2 class="modal-header__title" style="font-size: var(--font-size-xl)">👑 Centralized Admin Directory</h2>
        <p style="color: var(--text-muted); font-size: var(--font-size-sm)">Review active workspace sessions, authorize pending registrations, and manage team credentials in real-time.</p>
      </div>

      <div class="admin-panel">
        <div class="admin-header">
          <div>
            <div class="admin-title">
              <span>👥 User Accounts Directory</span>
            </div>
            <div class="admin-subtitle">Verify workspace membership and approval logs.</div>
          </div>
          <button id="refreshAdminDir" class="filter-btn" style="padding: 6px 12px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
            🔄 Refresh Registry
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
    `;

    // Bind refresh button
    const refreshBtn = document.getElementById('refreshAdminDir');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.loadDirectory();
    }

    // Load actual content
    await this.loadDirectory();
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

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div class="admin-user-cell">
              <div class="admin-avatar-container">
                <img class="admin-user-avatar" src="${cleanAvatar}" alt="${user.username}">
                <div class="admin-user-details-tooltip">
                  <div class="tooltip-banner"></div>
                  <div class="tooltip-avatar-wrapper">
                    <img src="${cleanAvatar}" class="tooltip-avatar" alt="${user.username}">
                  </div>
                  <div class="tooltip-body">
                    <h4 class="tooltip-name">${user.username}</h4>
                    <span class="tooltip-role">${formattedRole}</span>
                    
                    <div class="tooltip-divider"></div>
                    
                    <div class="tooltip-info-section">
                      <div class="tooltip-info-item">
                        <span class="info-icon">📧</span>
                        <div class="info-content">
                          <span class="info-label">Email Address</span>
                          <span class="info-value" title="${email}">${email}</span>
                        </div>
                      </div>
                      
                      <div class="tooltip-info-item">
                        <span class="info-icon">🔑</span>
                        <div class="info-content">
                          <span class="info-label">Security Credentials</span>
                          <span class="info-value ${mfaEnabled ? 'enabled' : 'disabled'}">MFA: ${mfaEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                      </div>

                      <div class="tooltip-info-item">
                        <span class="info-icon">⚡</span>
                        <div class="info-content">
                          <span class="info-label">Account Status</span>
                          <span class="info-value status-${user.status.toLowerCase()}">${isPending ? 'Pending Approval' : 'Approved / Active'}</span>
                        </div>
                      </div>

                      <div class="tooltip-info-item">
                        <span class="info-icon">🆔</span>
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
            <span class="admin-badge ${isAdminRole ? 'admin-badge--role-admin' : 'admin-badge--role'}">
              ${isAdminRole ? '👑 ' : ''}${formattedRole}
            </span>
          </td>
          <td>
            <span class="admin-badge ${isPending ? 'admin-badge--pending' : 'admin-badge--approved'}">
              ${isPending ? '⏳ Pending Approval' : '● Approved / Active'}
            </span>
          </td>
          <td style="text-align: right">
            <div style="display: inline-flex; gap: 8px; justify-content: flex-end">
              ${isPending ? `
                <button class="admin-action-btn admin-action-btn--approve" data-user="${user.username}">
                  ✓ Approve
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

    } catch (err) {
      console.error('[ADMIN] Failed to load directory:', err);
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: #ef4444; padding: 24px;">
            ⚠️ Failed to retrieve directory logs. Error: ${err.message || err}
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
}
