/* ============================================================
   groups.js — list the groups you belong to, create one,
   join one with a code.
   ============================================================ */

(function () {
  if (!Auth.require()) return;

  const me = Auth.user || {};
  const meAvatar = document.getElementById("meAvatar");
  if (meAvatar) {
    meAvatar.textContent = initials(me.name);
    meAvatar.style.background = colourFor(me.name);
  }
  wireSignOut("#signOut");

  const grid = document.getElementById("grid");
  const codeReveal = document.getElementById("codeReveal");

  /* ---------- render the group grid ---------- */
  function memberStack(members) {
    return (members || []).slice(0, 4)
      .map((m) => `<i style="background:${colourFor(m.name)}"></i>`).join("");
  }

  function groupCard(g) {
    const cover = g.coverUrl
      ? `style="background-image:url('${esc(g.coverUrl)}')"`
      : `style="background:linear-gradient(135deg, ${colourFor(g.name)}, #1f6fa3)"`;
    return `
      <a class="gcard" href="group.html?id=${encodeURIComponent(g.id)}">
        <div class="gbanner" ${cover}></div>
        <div class="body">
          <b>${esc(g.name)}</b>
          <small>${g.memberCount} member${g.memberCount === 1 ? "" : "s"} · ${g.photoCount} photo${g.photoCount === 1 ? "" : "s"}</small>
          <div class="stack">${memberStack(g.members)}</div>
        </div>
      </a>`;
  }

  async function loadGroups() {
    try {
      const groups = await api.get("/groups");
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
      const g = await api.post("/groups/join", { code });
      toast(`Joined ${g.name}`);
      input.value = "";
      location.href = `group.html?id=${encodeURIComponent(g.id)}`;
    } catch (err) {
      if (err.status === 404) toast("That invite code is not valid.", true);
      else if (err.status === 409) toast("You are already in that group.", true);
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
              <input id="cgName" placeholder="e.g. Langkawi 2026" maxlength="60">
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
      if (!name) { errEl.textContent = "Please enter a name."; return; }
      try {
        const g = await api.post("/groups", { name });
        close();
        showCode(g);           // reveal the invite code to share
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
    codeReveal.innerHTML = `
      <div class="code-reveal">
        <div style="flex:1; min-width:0">
          <div style="font-size:12px; font-weight:600; color:var(--accent-ink)">Group created. Share this invite code:</div>
          <div class="code" id="newCode">${esc(g.inviteCode)}</div>
        </div>
        <button class="btn" id="copyCode">Copy</button>
      </div>`;
    document.getElementById("copyCode").onclick = async () => {
      try {
        await navigator.clipboard.writeText(g.inviteCode);
        toast("Invite code copied");
      } catch (e) {
        // fallback: select the text so they can copy manually
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
