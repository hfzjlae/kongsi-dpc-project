/* ============================================================
   groups.js — list the groups you belong to, create one,
   join one with a code.  Matches the backend contract:
     GET  /groups        -> { groups: [ { id, name, invite_code,
                                          member_count, photo_count } ] }
     POST /groups        -> { group: { id, name, invite_code } }
     POST /groups/join   -> { group }           body: { inviteCode }
   ============================================================ */

(function () {
  if (!Auth.require()) return;

  const me = Auth.user || {};
  const meAvatar = document.getElementById("meAvatar");
  if (meAvatar) {
    meAvatar.textContent = initials(me.username);
    meAvatar.style.background = colourFor(me.username);
  }
  wireSignOut("#signOut");

  const grid = document.getElementById("grid");
  const codeReveal = document.getElementById("codeReveal");

  function groupCard(g) {
    const members = g.member_count || 0;
    const photos = g.photo_count || 0;
    return `
      <a class="gcard" href="group.html?id=${encodeURIComponent(g.id)}">
        <div class="gbanner" style="background:linear-gradient(135deg, ${colourFor(g.name)}, #1f6fa3)"></div>
        <div class="body">
          <b>${esc(g.name)}</b>
          <small>${members} member${members === 1 ? "" : "s"} · ${photos} photo${photos === 1 ? "" : "s"}</small>
        </div>
      </a>`;
  }

  async function loadGroups() {
    try {
      const data = await api.get("/groups");
      const groups = data.groups || [];
      if (!groups.length) {
        grid.innerHTML = `<div class="empty">No groups yet. Create one, or join with an invite code.</div>`;
        return;
      }
      grid.innerHTML = groups.map(groupCard).join("");
    } catch (err) {
      grid.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  /* ---------- join with code ---------- */
  document.getElementById("joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("joinCode");
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    try {
      const data = await api.post("/groups/join", { inviteCode: code });
      const g = data.group;
      toast(`Joined ${g.name}`);
      input.value = "";
      location.href = `group.html?id=${encodeURIComponent(g.id)}`;
    } catch (err) {
      if (err.status === 404) toast("That invite code is not valid.", true);
      else toast(err.message, true);
    }
  });

  /* ---------- create group (modal) ---------- */
  const modalHost = document.getElementById("modalHost");

  function openCreateModal() {
    modalHost.innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cgTitle">
          <header><h3 id="cgTitle">Create a group</h3><button class="icon-btn" id="cgClose" aria-label="Close">✕</button></header>
          <div class="body">
            <div class="field">
              <label for="cgName">Group name</label>
              <input id="cgName" placeholder="e.g. Langkawi 2026" maxlength="80">
              <div class="field-error" id="cgErr"></div>
            </div>
          </div>
          <footer>
            <button class="btn ghost" id="cgCancel">Cancel</button>
            <button class="btn" id="cgSave">Create</button>
          </footer>
        </div>
      </div>`;
    const close = () => { modalHost.innerHTML = ""; };
    document.getElementById("cgClose").onclick = close;
    document.getElementById("cgCancel").onclick = close;
    document.getElementById("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") close(); });
    const nameInput = document.getElementById("cgName");
    nameInput.focus();

    document.getElementById("cgSave").onclick = async () => {
      const name = nameInput.value.trim();
      const errEl = document.getElementById("cgErr");
      if (name.length < 2) { errEl.textContent = "Group name must be at least 2 characters."; return; }
      try {
        const data = await api.post("/groups", { name });
        close();
        showCode(data.group);     // reveal the invite code to share
        await loadGroups();
      } catch (err) {
        errEl.textContent = err.message;
      }
    };
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("cgSave").click(); });
  }
  document.getElementById("createBtn").addEventListener("click", openCreateModal);

  /* ---------- invite-code reveal with copy ---------- */
  function showCode(g) {
    const code = g.invite_code;
    codeReveal.innerHTML = `
      <div class="code-reveal">
        <div style="flex:1; min-width:0">
          <div style="font-size:12px; font-weight:600; color:var(--accent-ink)">Group created. Share this invite code:</div>
          <div class="code" id="newCode">${esc(code)}</div>
        </div>
        <button class="btn" id="copyCode">Copy</button>
      </div>`;
    document.getElementById("copyCode").onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast("Invite code copied");
      } catch (e) {
        const r = document.createRange();
        r.selectNode(document.getElementById("newCode"));
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        toast("Press Ctrl/Cmd+C to copy");
      }
    };
  }

  loadGroups();
})();
