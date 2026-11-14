/* ============================================================
   config.js — the ONE place the API address is set.
   Change this when you deploy. Nothing else needs editing.
   ============================================================ */

window.KONGSI_CONFIG = {
  // Live API (EC2, Sydney ap-southeast-2):
  API_URL: "http://13.54.98.67/api",

  // For local development, comment the line above and use this instead:
  // API_URL: "http://localhost:3000/api",

  // How often the feed and comments re-poll, in milliseconds.
  FEED_POLL_MS: 20000,     // album feed  -> every 20s  (per spec)
  COMMENT_POLL_MS: 5000,   // comments    -> every 5s   (per spec)

  // Max edge length (px) a photo is resized to in the browser before upload.
  UPLOAD_MAX_EDGE: 1600,
  UPLOAD_QUALITY: 0.85,
};
