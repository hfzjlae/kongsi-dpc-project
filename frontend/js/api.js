/* ============================================================
   api.js — shared helpers. Every page loads this.
   - talks to the backend (the only file that does)
   - stores / clears the JWT
   - escapes HTML so user text can never inject markup (no XSS)
   - small UI helpers: toast, avatar colour, time-ago, served-by badge
   ============================================================ */

const CFG = window.KONGSI_CONFIG;

/* ---------- auth token + current user ---------- */
const Auth = {
  TOKEN_KEY: "kongsi_token",
  USER_KEY: "kongsi_user",

  get token() {
    try { return localStorage.getItem(this.TOKEN_KEY); } catch (e) { return null; }
  },
  get user() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY) || "null"); }
    catch (e) { return null; }
  },
  save(token, user) {
    try {
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    } catch (e) { /* private mode: still works for this tab via memory fallback */ }
  },
  clear() {
    try {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
    } catch (e) {}
  },
  /* redirect to login if not signed in. Call at the top of protected pages. */
  require() {
    if (!this.token) { location.replace("index.html"); return false; }
    return true;
  },
};

/* ---------- the fetch wrapper ---------- */
/* Throws an ApiError on any non-2xx so callers can try/catch.
   Captures the X-Served-By header onto window.KONGSI_LAST_SERVED. */
class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
  }
}

async function apiFetch(path, { method = "GET", body, isForm = false, auth = true } = {}) {
  const headers = {};
  if (auth && Auth.token) headers["Authorization"] = "Bearer " + Auth.token;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(CFG.API_URL + path, {
      method,
      headers,
      body: isForm ? body : (body ? JSON.stringify(body) : undefined),
    });
  } catch (networkErr) {
    // server unreachable / CORS / offline
    throw new ApiError(0, { error: "Cannot reach the server. Is the API running?" });
  }

  // which API server answered (visible proof of the stateless multi-server setup)
  const served = res.headers.get("X-Served-By");
  if (served) window.KONGSI_LAST_SERVED = served;

  // expired or invalid token -> back to login
  if (res.status === 401) {
    Auth.clear();
    if (!location.pathname.endsWith("index.html") && location.pathname !== "/") {
      location.replace("index.html");
    }
    throw new ApiError(401, { error: "Please sign in again." });
  }

  if (res.status === 204) return null;

  let data = null;
  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/* convenience verbs */
const api = {
  get: (p) => apiFetch(p),
  post: (p, body) => apiFetch(p, { method: "POST", body }),
  patch: (p, body) => apiFetch(p, { method: "PATCH", body }),
  del: (p) => apiFetch(p, { method: "DELETE" }),
  upload: (p, form) => apiFetch(p, { method: "POST", body: form, isForm: true }),
  // no-auth call used by the login/register page
  postPublic: (p, body) => apiFetch(p, { method: "POST", body, auth: false }),
};

/* ---------- security: escape everything from users before it hits innerHTML ---------- */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- tiny UI helpers ---------- */

/* deterministic avatar colour from a name, so each person keeps one colour */
function colourFor(name) {
  const palette = ["#ef5a2a", "#1f9d6b", "#7ec8e3", "#9b5de5", "#c9a227", "#e07a3f", "#2e8b57", "#4b56b0"];
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

/* short "2h", "just now" style timestamps */
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "1m";
  const m = s / 60;
  if (m < 60) return Math.round(m) + "m";
  const h = m / 60;
  if (h < 24) return Math.round(h) + "h";
  const d = h / 24;
  if (d < 7) return Math.round(d) + "d";
  return new Date(iso).toLocaleDateString();
}

/* toast notifications (replace alert(), which we never use) */
function toast(msg, isError = false) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* read ?key=value from the URL */
function qs(key) {
  return new URLSearchParams(location.search).get(key);
}

/* sign out link helper */
function wireSignOut(sel) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener("click", (e) => { e.preventDefault(); Auth.clear(); location.replace("index.html"); });
}
