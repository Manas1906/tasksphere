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
    options.headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };

    try {
      const response = await fetch(url, options);
      if (response.status === 401) {
        console.warn('[API-UNAUTHORIZED] Access denied. Directing to login overlay.');
        localStorage.removeItem('tasksphere_jwt');
        localStorage.removeItem('tasksphere_user');
        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
        }
        throw new Error('Unauthorized session terminated.');
      }
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      this.setOnline(true);
      
      // If response has no content (like 204 No Content), return null
      if (response.status === 204) {
        console.log(`[API-SUCCESS] ${method} ${endpoint} - 204 No Content`);
        return null;
      }
      const data = await response.json();
      console.log(`[API-SUCCESS] ${method} ${endpoint} - Successfully received payload:`, data);
      return data;
    } catch (error) {
      console.error(`[API-FAILURE] Fetch to ${endpoint} failed. Engaging LocalStorage fallback cache mechanism.`, error);
      this.setOnline(false);
      
      if (endpoint.startsWith('/auth/')) {
        throw new Error('Authentication service is currently offline. Please ensure your backend is active and try again.');
      }
      
      return this.handleFallback(endpoint, options);
    }
  }

  setOnline(isOnline) {
    const wsStatusText = document.getElementById('wsStatus');
    console.log(`[API-STATUS] Setting API connectivity online state: ${isOnline}`);
    if (!isOnline) {
      this.offlineMode = true;
      if (wsStatusText) {
        wsStatusText.textContent = '● Offline Cache Active';
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
}

export const api = new ApiService();
