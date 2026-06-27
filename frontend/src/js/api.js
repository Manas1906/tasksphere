/**
 * ApiService - Day 12 JS OOP & Browser APIs
 * Elegant OOP wrapper utilizing Fetch API to interact with Spring Boot REST API
 * Features automated fallback to localStorage if backend is offline.
 */
const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  const hostname = window.location.hostname;
  const isLocal = !hostname || 
                  hostname === 'localhost' || 
                  hostname === '127.0.0.1' || 
                  hostname.startsWith('192.168.') || 
                  hostname.startsWith('10.') || 
                  hostname.startsWith('172.');
  if (isLocal) {
    return '';
  } else {
    return 'https://tasksphere-backend-w0pb.onrender.com';
  }
};

const API_URL = getApiUrl();
const CLEAN_API_URL = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;

class ApiService {
  constructor(baseUrl = `${CLEAN_API_URL}/api`) {
    this.baseUrl = baseUrl;
    this.offlineMode = false;
  }

  /**
   * Universal fetch wrapper with timeout & offline recovery
   */
  /**
   * silent401 – when true, a 401/403 response only throws; it does NOT clear
   * localStorage or show the login overlay. Use for non-critical background calls
   * (feature toggles, sprint simulation, chat-list, etc.) so a transient backend
   * hiccup doesn't immediately log the user out.
   *
   * isRetry – internal flag used by the SSO grace-period logic below.  Never pass
   * this from outside; it exists purely to prevent infinite retry recursion.
   */
  async request(endpoint, options = {}, silent401 = false, isRetry = false) {
    const method = options.method || 'GET';
    const url = `${this.baseUrl}${endpoint}`;
    
    console.log(`[API-REQUEST] Sending ${method} request to: ${url}`);
    
    // Configure default headers with JWT integration
    const token = localStorage.getItem('tasksphere_jwt');
    const hasValidToken = token && token !== 'null' && token !== 'undefined';
    options.headers = {
      'Content-Type': 'application/json',
      ...(hasValidToken ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };

    let response;
    try {
      response = await fetch(url, options);
    } catch (networkError) {
      console.error(`[API-FAILURE] Fetch to ${endpoint} failed. Connection offline.`, networkError);
      this.setOnline(false);
      
      if (endpoint.startsWith('/auth/')) {
        throw new Error('Authentication service is currently offline. Please ensure your backend is active and try again.');
      }
      
      return this.handleFallback(endpoint, options);
    }

    this.setOnline(true);

    if ((response.status === 401 || response.status === 403) && !endpoint.startsWith('/auth/')) {
      if (silent401) {
        // Background / non-critical call – log but do NOT nuke session or redirect
        console.warn(`[API-UNAUTHORIZED-SILENT] ${response.status} on background endpoint '${endpoint}'. Session preserved; skipping logout redirect.`);
        throw new Error(`${response.status} on ${endpoint} (silent mode – session not cleared).`);
      }

      // SSO grace-period: if the JWT was stored within the last 60 seconds the
      // backend may still be waking up on Render.com free tier.  Give it one
      // automatic retry after a short back-off before forcing re-login.
      if (!isRetry) {
        const jwtStoredAt = parseInt(localStorage.getItem('tasksphere_jwt_stored_at') || '0');
        const tokenAgeMs = Date.now() - jwtStoredAt;
        if (jwtStoredAt && tokenAgeMs < 60_000) {
          console.warn(`[API-UNAUTHORIZED] 401 on '${endpoint}' but JWT is only ${Math.round(tokenAgeMs / 1000)}s old (fresh SSO). Waiting 2s for backend to stabilize then retrying once...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return this.request(endpoint, options, silent401, true /* isRetry */);
        }
      }

      console.error(`[API-UNAUTHORIZED] ${response.status} received on '${endpoint}'. JWT may be expired or missing. Clearing session and directing to login overlay.`);
      console.error('[API-UNAUTHORIZED] JWT in storage at failure time:', localStorage.getItem('tasksphere_jwt') ? 'PRESENT' : 'ABSENT');
      console.error('[API-UNAUTHORIZED] Username at failure time:', localStorage.getItem('chat_username'));

      localStorage.removeItem('tasksphere_jwt');
      localStorage.removeItem('tasksphere_user');
      localStorage.removeItem('chat_username');
      localStorage.removeItem('is_social_signup');

      // Clean up any active onboarding guides and spotlights
      if (window.onboarding) {
        window.onboarding.cleanupDOM();
      }

      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) {
        loginOverlay.style.display = 'flex';
        loginOverlay.classList.remove('hidden');
      }
      throw new Error('Session expired or unauthorized. Please log in again.');
    }

    if (!response.ok) {
      let errMsg = `API Error: ${response.status} ${response.statusText}`;
      try {
        const errData = await response.json();
        errMsg = errData.error || errData.message || errMsg;
      } catch (e) {
        // Ignore JSON parsing failure for non-JSON responses
      }
      throw new Error(errMsg);
    }

    // If response has no content (like 204 No Content), return null
    if (response.status === 204) {
      console.log(`[API-SUCCESS] ${method} ${endpoint} - 204 No Content`);
      return null;
    }
    
    const data = await response.json();
    console.log(`[API-SUCCESS] ${method} ${endpoint} - Successfully received payload:`, data);
    return data;
  }

  setOnline(isOnline) {
    const wsStatusText = document.getElementById('wsStatus');
    console.log(`[API-STATUS] Setting API connectivity online state: ${isOnline}`);
    if (!isOnline) {
      this.offlineMode = true;
      if (wsStatusText) {
        wsStatusText.textContent = '● Offline';
        wsStatusText.className = 'text-amber';
      }
    } else {
      this.offlineMode = false;
    }
  }

  /**
   * Dynamic localstorage cache handler - Day 12 LocalStorage Fallback
   */
  handleFallback(endpoint, options) {
    const method = options.method || 'GET';
    const key = `cache_${endpoint.split('/')[1]}`; // e.g. cache_tasks, cache_users

    // READ Operations
    if (method === 'GET') {
      const cached = localStorage.getItem(key);
      if (endpoint.includes('/tasks/')) {
        // Individual item fetch fallback
        const tasks = JSON.parse(localStorage.getItem('cache_tasks') || '[]');
        const id = parseInt(endpoint.split('/').pop());
        return tasks.find(t => t.id === id) || null;
      }
      return cached ? JSON.parse(cached) : [];
    }

    // WRITE Operations
    if (method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const cachedList = JSON.parse(localStorage.getItem(key) || '[]');
      
      // Assign fake ID
      body.id = body.id || Date.now();
      body.createdAt = new Date().toISOString();
      body.updatedAt = new Date().toISOString();
      
      cachedList.push(body);
      localStorage.setItem(key, JSON.stringify(cachedList));
      return body;
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      const cachedList = JSON.parse(localStorage.getItem(key) || '[]');
      const id = parseInt(endpoint.split('/').pop());
      
      const idx = cachedList.findIndex(item => item.id === id);
      if (idx !== -1) {
        cachedList[idx] = { ...cachedList[idx], ...body, updatedAt: new Date().toISOString() };
        localStorage.setItem(key, JSON.stringify(cachedList));
        return cachedList[idx];
      }
      return body;
    }

    if (method === 'DELETE') {
      const cachedList = JSON.parse(localStorage.getItem(key) || '[]');
      const id = parseInt(endpoint.split('/').pop());
      const filtered = cachedList.filter(item => item.id !== id);
      localStorage.setItem(key, JSON.stringify(filtered));
      return null;
    }

    return null;
  }

  /* ---- Task Endpoints ---- */
  getTasks() { return this.request('/tasks'); }
  getTask(id) { return this.request(`/tasks/${id}`); }
  createTask(task) { return this.request('/tasks', { method: 'POST', body: JSON.stringify(task) }); }
  updateTask(id, task) { return this.request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(task) }); }
  updateTaskStatus(id, status) { return this.request(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify(status) }); }
  deleteTask(id) { return this.request(`/tasks/${id}`, { method: 'DELETE' }); }

  /* ---- Task Comments ---- */
  getTaskComments(taskId) { return this.request(`/tasks/${taskId}/comments`); }
  addTaskComment(taskId, author, avatarUrl, content) {
    return this.request(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ author, avatarUrl, content }) });
  }
  updateTaskComment(taskId, commentId, author, content) {
    return this.request(`/tasks/${taskId}/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ author, content }) });
  }
  deleteTaskComment(taskId, commentId, author) {
    return this.request(`/tasks/${taskId}/comments/${commentId}?author=${encodeURIComponent(author)}`, { method: 'DELETE' });
  }

  /* ---- Task Activity Log ---- */
  getTaskActivity(taskId) { return this.request(`/tasks/${taskId}/activity`); }

  /* ---- Sprints ---- */
  getSprints() { return this.request('/sprints', {}, true); }
  getActiveSprint() { return this.request('/sprints/active', {}, true); }
  createSprint(sprint) { return this.request('/sprints', { method: 'POST', body: JSON.stringify(sprint) }); }
  updateSprint(id, sprint) { return this.request(`/sprints/${id}`, { method: 'PUT', body: JSON.stringify(sprint) }); }
  updateSprintStatus(id, status) { return this.request(`/sprints/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); }
  deleteSprint(id) { return this.request(`/sprints/${id}`, { method: 'DELETE' }); }
  addTaskToSprint(sprintId, taskId) { return this.request(`/sprints/${sprintId}/tasks/${taskId}`, { method: 'POST' }); }
  removeTaskFromSprint(sprintId, taskId) { return this.request(`/sprints/${sprintId}/tasks/${taskId}`, { method: 'DELETE' }); }

  /* ---- CSV Export ---- */
  exportTasksCsv() {
    const token = localStorage.getItem('tasksphere_jwt');
    const url = `${this.baseUrl}/tasks/export/csv`;
    const link = document.createElement('a');
    link.href = url + (token ? `?token=${encodeURIComponent(token)}` : '');
    // Use fetch to properly include Authorization header
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => {
        const objUrl = URL.createObjectURL(blob);
        link.href = objUrl;
        link.download = 'tasks-export.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objUrl);
      });
  }

  /* ---- User Endpoints ---- */
  getUsers() { return this.request('/users'); }

  /**
   * Lightweight session validation – returns the current user's DB record without
   * overwriting status the way getAllUsers() does. Use this for startup checks.
   *
   * silent401=true: a 401 from /users/me must NOT clear localStorage or show the
   * login overlay. The caller (app startup IIFE) handles auth failures explicitly,
   * so a destructive 401 handler here would wipe a freshly-issued SSO token before
   * the startup check even gets a chance to evaluate the response.
   */
  validateSession() { return this.request('/users/me', {}, true); }

  login(user) { 
    return this.request('/users/login', { method: 'POST', body: JSON.stringify(user) }); 
  }

  /* ---- Authentication Endpoints ---- */
  sendOtp(email) {
    return this.request('/auth/otp/send', { method: 'POST', body: JSON.stringify({ email }) });
  }
  verifyOtp(email, otp) {
    return this.request('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, otp }) });
  }
  checkEmail(email) {
    return this.request(`/auth/check-email?email=${encodeURIComponent(email)}`);
  }

  /* ---- Chat Endpoints ---- */
  updateChatMessage(id, payload) {
    return this.request(`/chat-messages/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  }

  /* ---- Predictive Sprint Simulation (Phase 12) ---- */
  runSprintSimulation() {
    return this.request('/sprint-simulation/run', { method: 'POST' });
  }

  /* ---- Web Push background notifications (Phase 13) ---- */
  getVapidPublicKey() { 
    return this.request('/web-push/public-key'); 
  }

  subscribePush(username, sub) { 
    return this.request(`/web-push/subscribe?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify(sub) }); 
  }

  unsubscribePush(username) { 
    return this.request(`/web-push/unsubscribe?username=${encodeURIComponent(username)}`, { method: 'POST' }); 
  }

  /* ---- Feature Toggles (Phase: Voice Calling) ---- */
  // silent401=true: a 401 from /features must NOT log the user out
  getFeatureToggles() {
    return this.request('/features', {}, true);
  }

  updateFeatureToggle(key, enabled, requester) {
    return this.request(`/features/${encodeURIComponent(key)}?requester=${encodeURIComponent(requester)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled })
    });
  }
}


export const api = new ApiService();
