/* ============================================================
   group.js — album feed for one group. Matches the backend:
     GET /groups/:id          -> { group:{name,invite_code}, members:[{id,username}], tags:[] }
     GET /groups/:id/photos   -> { photos:[ { id, url, caption, tags[],
                                   uploader (username string), comment_count } ] }
     POST /groups/:id/photos  -> multipart field "photo", caption, tags
   - search & filter (keyword, uploader=username, tag, date range)
   - polls every FEED_POLL_MS (20s); shows X-Served-By
   - upload modal resizes the photo in the browser first
   ============================================================ */

(function () {
  if (!Auth.require()) return;

  const groupId = qs("id");
  if (!groupId) { location.replace("groups.html"); return; }

  const me = Auth.user || {};
  const meAvatar = document.getElementById("meAvatar");
  meAvatar.textContent = initials(me.username);
  meAvatar.style.background = colourFor(me.username);

  const el = {
    groupName: document.getElementById("groupName"),
    invitePill: document.getElementById("invitePill"),
    feed: document.getElementById("feed"),
    feedEmpty: document.getElementById("feedEmpty"),
    feedStatus: document.getElementById("feedStatus"),
    served: document.getElementById("served"),
    q: document.getElementById("q"),
    uploader: document.getElementById("uploader"),
    tag: document.getElementById("tag"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
  };

  let pollTimer = null;
  let inviteCode = "";
  let groupTags = [];

  /* ---------- load group header + filter options ---------- */
  async function loadGroup() {
    try {
      const data = await api.get(`/groups/${encodeURIComponent(groupId)}`);
      const g = data.group;
      el.groupName.textContent = g.name;
      document.title = `Kongsi — ${g.name}`;
      inviteCode = g.invite_code || "";
      if (inviteCode) {
        el.invitePill.hidden = false;
        el.invitePill.textContent = "⧉ Invite " + inviteCode;
      }
      // uploader filter: value is the USERNAME (backend matches on username)
      (data.members || []).forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.username; opt.textContent = m.username;
        el.uploader.appendChild(opt);
      });
      groupTags = data.tags || [];
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        toast("You are not a member of this group.", true);
        setTimeout(() => location.replace("groups.html"), 1200);
      } else {
        el.groupName.textContent = "Error";
        toast(err.message, true);
      }
    }
  }

  el.invitePill.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(inviteCode); toast("Invite code copied"); }
    catch (e) { toast("Invite code: " + inviteCode); }
  });

  /* ---------- build the feed query from the filter bar ---------- */
  function buildQuery() {
    const p = new URLSearchParams();
    if (el.q.value.trim()) p.set("q", el.q.value.trim());
    if (el.uploader.value) p.set("uploader", el.uploader.value);
    if (el.tag.value) p.set("tag", el.tag.value);
    if (el.from.value) p.set("from", el.from.value);
    if (el.to.value) p.set("to", el.to.value);
    const s = p.toString();
    return s ? "?" + s : "";
  }

  /* ---------- render ---------- */
  function photoCard(p) {
    const tags = (p.tags || []).map((t) => `<span class="ptag">#${esc(t)}</span>`).join("");
    return `
      <a class="pcard" href="photo.html?id=${encodeURIComponent(p.id)}">
        <img class="pimg" src="${esc(p.url)}" alt="${esc(p.caption || "photo")}" loading="lazy">
        <div class="pbody">
          ${p.caption ? `<p class="pcap">${esc(p.caption)}</p>` : ""}
          ${tags ? `<div class="ptags">${tags}</div>` : ""}
          <div class="pmeta" style="margin-top:7px">
            <span>${esc(p.uploader || "")}</span>
            <span>💬 ${p.comment_count || 0}</span>
          </div>
        </div>
      </a>`;
  }

  /* keep the tag dropdown stable: full group tag list unioned with any
     tags visible in the current feed (so freshly uploaded tags appear) */
  function syncTagOptions(photos) {
    const set = new Set(groupTags);
    photos.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
    const tags = [...set].sort();
    const current = el.tag.value;
    const existing = [...el.tag.options].slice(1).map((o) => o.value);
    if (existing.join("|") === tags.join("|")) return;
    el.tag.innerHTML = `<option value="">Tag: All</option>` +
      tags.map((t) => `<option value="${esc(t)}">#${esc(t)}</option>`).join("");
    el.tag.value = current;
  }

  async function loadFeed() {
    try {
      const data = await api.get(`/groups/${encodeURIComponent(groupId)}/photos${buildQuery()}`);
      const photos = data.photos || [];
      syncTagOptions(photos);

      if (!photos.length) {
        el.feed.innerHTML = "";
        el.feedEmpty.hidden = false;
        el.feedEmpty.textContent = buildQuery() ? "No photos match your filters." : "No photos yet. Be the first to upload.";
      } else {
        el.feedEmpty.hidden = true;
        el.feed.innerHTML = photos.map(photoCard).join("");
      }

      el.feedStatus.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every ${CFG.FEED_POLL_MS / 1000}s`;

      if (window.KONGSI_LAST_SERVED) {
        el.served.hidden = false;
        el.served.textContent = "served by " + window.KONGSI_LAST_SERVED;
      }
    } catch (err) {
      el.feedStatus.textContent = err.message;
    }
  }

  /* ---------- polling ---------- */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { if (!document.hidden) loadFeed(); }, CFG.FEED_POLL_MS);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadFeed(); });
  window.addEventListener("beforeunload", stopPolling);

  /* ---------- filter bar wiring (debounced search) ---------- */
  let debounce = null;
  el.q.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(loadFeed, 300); });
  el.uploader.addEventListener("change", loadFeed);
  el.tag.addEventListener("change", loadFeed);
  el.from.addEventListener("change", loadFeed);
  el.to.addEventListener("change", loadFeed);
  document.getElementById("filterbar").addEventListener("submit", (e) => { e.preventDefault(); loadFeed(); });

  /* ============================================================
     upload modal — resize in the browser, then POST multipart
     ============================================================ */
  const modalHost = document.getElementById("modalHost");
  let chosenBlob = null;

  function openUpload() {
    chosenBlob = null;
    modalHost.innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="upTitle">
          <header><h3 id="upTitle">Upload a photo</h3><button class="icon-btn" id="upClose" aria-label="Close">✕</button></header>
          <div class="body">
            <div class="drop" id="drop">
              <input id="file" type="file" accept="image/*" hidden>
              <span id="dropText">Tap to choose a photo, or drag one here</span>
            </div>
            <div class="field" style="margin-top:14px">
              <label for="caption">Caption</label>
              <input id="caption" maxlength="500" placeholder="Say something about it">
            </div>
            <div class="field">
              <label for="tags">Tags <span style="font-weight:400">(comma separated)</span></label>
              <input id="tags" placeholder="beach, sunset">
            </div>
            <div class="field-error" id="upErr"></div>
          </div>
          <footer>
            <button class="btn ghost" id="upCancel">Cancel</button>
            <button class="btn" id="upSave" disabled>Upload</button>
          </footer>
        </div>
      </div>`;

    const close = () => { modalHost.innerHTML = ""; };
    document.getElementById("upClose").onclick = close;
    document.getElementById("upCancel").onclick = close;
    document.getElementById("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") close(); });

    const drop = document.getElementById("drop");
    const fileInput = document.getElementById("file");
    const saveBtn = document.getElementById("upSave");
    const errEl = document.getElementById("upErr");

    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.style.borderColor = "var(--accent)"; });
    drop.addEventListener("dragleave", () => { drop.style.borderColor = ""; });
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.style.borderColor = "";
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    async function handleFile(file) {
      errEl.textContent = "";
      if (!file.type.startsWith("image/")) { errEl.textContent = "Please choose an image file."; return; }
      if (file.size > 25 * 1024 * 1024) { errEl.textContent = "That image is over 25 MB. Choose a smaller one."; return; }
      try {
        chosenBlob = await resizeImage(file, CFG.UPLOAD_MAX_EDGE, CFG.UPLOAD_QUALITY);
        const url = URL.createObjectURL(chosenBlob);
        drop.classList.add("has-preview");
        drop.innerHTML = `<img src="${url}" alt="preview">`;
        saveBtn.disabled = false;
      } catch (e) {
        errEl.textContent = "Could not read that image.";
      }
    }

    saveBtn.onclick = async () => {
      if (!chosenBlob) return;
      saveBtn.disabled = true; saveBtn.textContent = "Uploading…";
      try {
        const form = new FormData();
        form.append("photo", chosenBlob, "photo.jpg");
        form.append("caption", document.getElementById("caption").value.trim());
        form.append("tags", document.getElementById("tags").value.trim()); // backend splits on comma
        await api.upload(`/groups/${encodeURIComponent(groupId)}/photos`, form);
        close();
        toast("Photo uploaded");
        await loadGroup();   // refresh tags + members
        loadFeed();
      } catch (err) {
        errEl.textContent = err.message || "Upload failed.";
        saveBtn.disabled = false; saveBtn.textContent = "Upload";
      }
    };
  }
  document.getElementById("uploadBtn").addEventListener("click", openUpload);

  function resizeImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/jpeg", quality);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /* ---------- go ---------- */
  wireSignOut("#signOut");
  (async function init() {
    await loadGroup();
    await loadFeed();
    startPolling();
  })();
})();
