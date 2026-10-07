// ------------------------------------------------------------------
// api.js — shared helpers used by every page (PRESENTATION TIER).
//
// The frontend only ever talks to the API through the api() function
// below. It never connects to the database or to S3 directly.
// ------------------------------------------------------------------
const API_BASE = window.APP_CONFIG.API_BASE_URL.replace(/\/$/, '');
const TOKEN_KEY = 'kongsi_token';
const USER_KEY = 'kongsi_user';

// ---------- Session (who is signed in) ----------
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}
function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
// Call at the top of any page that needs a signed-in user
function requireLogin() {
  if (!getToken()) window.location.href = 'index.html';
}

// ---------- Calling the API ----------
// api('/groups')                                  -> GET
// api('/groups', { method: 'POST', json: {...} }) -> POST JSON
// api('/groups/1/photos', { method: 'POST', formData }) -> file upload
async function api(path, { method = 'GET', json, formData } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (formData) {
    body = formData; // the browser sets the multipart Content-Type itself
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && token) {
    // Token expired or invalid: sign out and go to the sign-in page
    clearSession();
    window.location.href = 'index.html';
  }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// ---------- Safety: always escape user text before showing it ----------
// Without this, a comment like <script>...</script> would run in other
// users' browsers (a Cross-Site Scripting / XSS attack).
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Small formatting helpers ----------
function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(iso);
}
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Shows a message inside an element. kind: 'error' | 'success' | 'info'
function showMessage(element, text, kind = 'error') {
  element.textContent = text;
  element.className = `message message-${kind}`;
  element.hidden = !text;
}

// ---------- Top bar shown on signed-in pages ----------
function renderTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const user = getUser();
  bar.innerHTML = `
    <a class="wordmark" href="groups.html">kongsi</a>
    <div class="topbar-user">
      <span>Signed in as <strong>${escapeHtml(user?.username || '')}</strong></span>
      <button type="button" class="button button-quiet" id="signOut">Sign out</button>
    </div>`;
  document.getElementById('signOut').addEventListener('click', () => {
    clearSession();
    window.location.href = 'index.html';
  });
}
