/* ============================================================
   config.js — the ONE place the API address is set.
   Change this when you deploy. Nothing else needs editing.
   ============================================================ */

window.KONGSI_CONFIG = {
  // Local development (API running on your laptop):
  API_URL: "http://localhost:3000/api",

  // When you deploy, comment the line above and use your EC2 address, e.g.:
  // API_URL: "http://13.250.xx.xx/api",
  // or, behind a domain / HTTPS:
  // API_URL: "https://api.kongsi.example.com/api",

  // How often the feed and comments re-poll, in milliseconds.
  FEED_POLL_MS: 20000,     // album feed  -> every 20s  (per spec)
  COMMENT_POLL_MS: 5000,   // comments    -> every 5s   (per spec)

  // Max edge length (px) a photo is resized to in the browser before upload.
  UPLOAD_MAX_EDGE: 1600,
  UPLOAD_QUALITY: 0.85,
};
