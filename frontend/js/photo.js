/* ============================================================
   photo.js — one photo with its live comment thread. Matches backend:
     GET /photos/:id            -> { photo:{ url, caption, tags[], group_id,
                                     uploader (username), uploader_id } }
     GET /photos/:id/comments   -> { comments:[ { id, body, version,
                                     created_at, updated_at, user_id, username } ] }
     POST /photos/:id/comments  -> { comment }          body: { body }
     PUT /comments/:id          -> { comment } or 409    body: { body, version }
   - comments poll every COMMENT_POLL_MS (5s), new ones fade in
   - post optimistically; edit/delete only your own
   - 409 version conflict -> "changed elsewhere" bar
   ============================================================ */

(function () {
  if (!Auth.require()) return;

  const photoId = qs("id");
  if (!photoId) { location.replace("groups.html"); return; }

  const me = Auth.user || {};
  const myId = Number(me.id);
  const meAvatar = document.getElementById("meAvatar");
  meAvatar.textContent = initials(me.username);
  meAvatar.style.background = colourFor(me.username);

  const el = {
    hero: document.getElementById("hero"),
    caption: document.getElementById("caption"),
    cmtList: document.getElementById("cmtList"),
    cmtStatus: document.getElementById("cmtStatus"),
    cmtForm: document.getElementById("cmtForm"),
    cmtInput: document.getElementById("cmtInput"),
    conflictHost: document.getElementById("conflictHost"),
    deletePhoto: document.getElementById("deletePhoto"),
    backToGroup: document.getElementById("backToGroup"),
  };

  let groupId = null;
  let pollTimer = null;
  let editingId = null;
  const seenIds = new Set();
  const pendingComments = [];

  /* ---------- load the photo ---------- */
  async function loadPhoto() {
    try {
      const data = await api.get(`/photos/${encodeURIComponent(photoId)}`);
      const p = data.photo;
      groupId = p.group_id;
      el.backToGroup.href = `group.html?id=${encodeURIComponent(p.group_id)}`;
      el.hero.src = p.url;
      el.hero.alt = p.caption || "photo";
      const tags = (p.tags || []).map((t) => `<span class="ptag">#${esc(t)}</span>`).join(" ");
      const uploader = p.uploader || "";
      el.caption.innerHTML = `
        <div class="who">
          <span class="avatar" style="width:30px;height:30px;font-size:12px;background:${colourFor(uploader)}">${esc(initials(uploader))}</span>
          <div><b>${esc(uploader)}</b><small>${esc(timeAgo(p.created_at))}</small></div>
        </div>
        ${p.caption ? `<p>${esc(p.caption)}</p>` : ""}
        ${tags ? `<div class="ptags" style="margin-top:9px">${tags}</div>` : ""}`;
      // only the uploader can delete
      if (Number(p.uploader_id) === myId) {
        el.deletePhoto.hidden = false;
        el.deletePhoto.onclick = () => deletePhoto(p.group_id);
      }
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        toast("Photo not found, or you are not a member.", true);
        setTimeout(() => location.replace("groups.html"), 1200);
      } else { toast(err.message, true); }
    }
  }

  async function deletePhoto(gid) {
    // in-page confirm (browser confirm() is blocked in some embeds)
    if (el.deletePhoto.dataset.armed !== "1") {
      el.deletePhoto.dataset.armed = "1";
      el.deletePhoto.textContent = "Click again to confirm";
      setTimeout(() => { el.deletePhoto.dataset.armed = "0"; el.deletePhoto.textContent = "Delete photo"; }, 3000);
      return;
    }
    try {
      await api.del(`/photos/${encodeURIComponent(photoId)}`);
      toast("Photo deleted");
      location.replace(`group.html?id=${encodeURIComponent(gid)}`);
    } catch (err) { toast(err.message, true); }
  }

  /* ---------- render a comment ---------- */
  function commentNode(c, pending = false) {
    const wrap = document.createElement("div");
    wrap.className = "cmt" + (pending ? " pending" : "");
    if (!pending && !seenIds.has(c.id)) { wrap.classList.add("fade-in"); seenIds.add(c.id); }
    wrap.dataset.id = c.id || "";
    const name = c.username || "";
    const mine = Number(c.user_id) === myId;
    const edited = c.version > 1 || (c.updated_at && c.updated_at !== c.created_at);

    wrap.innerHTML = `
      <span class="av" style="background:${colourFor(name)}">${esc(initials(name))}</span>
      <div class="bub">
        <div class="top"><b>${mine ? "You" : esc(name)}</b><time>${pending ? "sending…" : esc(timeAgo(c.created_at))}${edited && !pending ? " · edited" : ""}</time></div>
        <p>${esc(c.body)}</p>
        ${mine && !pending ? `<div class="own-actions"><button data-act="edit">Edit</button><button data-act="del">Delete</button></div>` : ""}
      </div>`;

    if (mine && !pending) {
      wrap.querySelector('[data-act="edit"]').onclick = () => startEdit(wrap, c);
      wrap.querySelector('[data-act="del"]').onclick = () => deleteComment(c.id);
    }
    return wrap;
  }

  /* ---------- load + merge comments ---------- */
  async function loadComments() {
    try {
      const data = await api.get(`/photos/${encodeURIComponent(photoId)}/comments`);
      const comments = data.comments || [];
      render(comments);
      el.cmtStatus.textContent = `${comments.length} comment${comments.length === 1 ? "" : "s"} · refreshes every ${CFG.COMMENT_POLL_MS / 1000}s`;
    } catch (err) {
      el.cmtStatus.textContent = err.message;
    }
  }

  function render(comments) {
    if (editingId) return; // don't stomp an in-progress edit
    el.cmtList.innerHTML = "";
    comments.forEach((c) => el.cmtList.appendChild(commentNode(c)));
    pendingComments.forEach((c) => el.cmtList.appendChild(commentNode(c, true)));
    el.cmtList.scrollTop = el.cmtList.scrollHeight;
  }

  /* ---------- post (optimistic) ---------- */
  el.cmtForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = el.cmtInput.value.trim();
    if (!body) return;
    el.cmtInput.value = "";

    const temp = { body, user_id: myId, username: me.username, created_at: new Date().toISOString() };
    pendingComments.push(temp);
    el.cmtList.appendChild(commentNode(temp, true));
    el.cmtList.scrollTop = el.cmtList.scrollHeight;

    try {
      await api.post(`/photos/${encodeURIComponent(photoId)}/comments`, { body });
      pendingComments.splice(pendingComments.indexOf(temp), 1);
      await loadComments();
    } catch (err) {
      pendingComments.splice(pendingComments.indexOf(temp), 1);
      toast(err.message || "Could not post comment.", true);
      el.cmtInput.value = body; // give their text back
      await loadComments();
    }
  });

  /* ---------- edit, with optimistic-concurrency 409 handling ---------- */
  function startEdit(node, c) {
    editingId = c.id;
    const bub = node.querySelector(".bub");
    bub.querySelector("p").hidden = true;
    const actions = bub.querySelector(".own-actions");
    if (actions) actions.hidden = true;

    const row = document.createElement("div");
    row.className = "edit-row";
    row.innerHTML = `<input value="${esc(c.body)}" maxlength="1000"><button class="btn" style="padding:6px 12px">Save</button><button class="btn ghost" style="padding:6px 10px">Cancel</button>`;
    bub.appendChild(row);
    const input = row.querySelector("input");
    input.focus();

    const cancel = () => { editingId = null; loadComments(); };
    row.querySelectorAll("button")[1].onclick = cancel;
    row.querySelector("button").onclick = async () => {
      const body = input.value.trim();
      if (!body) return;
      try {
        // send the version we last saw; backend returns 409 if it changed
        await api.put(`/comments/${encodeURIComponent(c.id)}`, { body, version: c.version });
        editingId = null;
        clearConflict();
        await loadComments();
      } catch (err) {
        if (err.status === 409) {
          editingId = null;
          showConflict();
          await loadComments();
        } else {
          toast(err.message || "Could not save edit.", true);
        }
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") row.querySelector("button").click(); if (e.key === "Escape") cancel(); });
  }

  async function deleteComment(id) {
    try {
      await api.del(`/comments/${encodeURIComponent(id)}`);
      seenIds.delete(id);
      await loadComments();
    } catch (err) { toast(err.message, true); }
  }

  /* ---------- 409 conflict bar ---------- */
  function showConflict() {
    el.conflictHost.innerHTML = `
      <div class="conflict">
        This comment was changed on another device.
        <button id="refreshC">Refresh</button> to see the latest version.
      </div>`;
    document.getElementById("refreshC").onclick = () => { clearConflict(); loadComments(); };
  }
  function clearConflict() { el.conflictHost.innerHTML = ""; }

  /* ---------- polling ---------- */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { if (!document.hidden) loadComments(); }, CFG.COMMENT_POLL_MS);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadComments(); });
  window.addEventListener("beforeunload", stopPolling);

  /* ---------- go ---------- */
  (async function init() {
    await loadPhoto();
    await loadComments();
    startPolling();
  })();
})();
