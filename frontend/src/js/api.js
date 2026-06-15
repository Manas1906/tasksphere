/**
 * ApiService - Day 12 JS OOP & Browser APIs
 * Elegant OOP wrapper utilizing Fetch API to interact with Spring Boot REST API
 * Features automated fallback to localStorage if backend is offline.
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const CLEAN_API_URL = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;

class ApiService {
  constructor(baseUrl = `${CLEAN_API_URL}/api`) {
    this.baseUrl = baseUrl;
    this.offlineMode = false;
  }

  /**
   * Universal fetch wrapper with timeout & offline recovery
   */
  async request(endpoint, options = {}) {
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
      console.warn('[API-UNAUTHORIZED] Access denied or session expired. Directing to login overlay.');
      localStorage.removeItem('tasksphere_jwt');
      localStorage.removeItem('tasksphere_user');
      localStorage.removeItem('chat_username'); // clear chat username cache
      
      // Clean up any active onboarding guides and spotlights
      if (window.onboarding) {
        window.onboarding.cleanupDOM();
      }

      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) {
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

  /* ---- User Endpoints ---- */
  getUsers() { return this.request('/users'); }
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
  getFeatureToggles() {
    return this.request('/features');
  }

  updateFeatureToggle(key, enabled, requester) {
    return this.request(`/features/${encodeURIComponent(key)}?requester=${encodeURIComponent(requester)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled })
    });
  }
}


export const api = new ApiService();
