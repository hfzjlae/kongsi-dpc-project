// ------------------------------------------------------------------
// groups.js — list, create and join friend groups (groups.html)
// ------------------------------------------------------------------
requireLogin();
renderTopbar();

const groupList = document.getElementById('groupList');
const listMessage = document.getElementById('listMessage');

async function loadGroups() {
  try {
    const { groups } = await api('/groups');
    if (groups.length === 0) {
      groupList.innerHTML = `
        <li class="panel empty">
          <h3>No groups yet</h3>
          <p>Start a group for your friends, or join one with an invite code.</p>
        </li>`;
      return;
    }
    groupList.innerHTML = groups
      .map(
        (g) => `
        <li class="group-item">
          <a href="group.html?id=${g.id}">
            <div>
              <h3>${escapeHtml(g.name)}</h3>
              <span class="muted small">${g.member_count} ${g.member_count === 1 ? 'member' : 'members'},
                ${g.photo_count} ${g.photo_count === 1 ? 'photo' : 'photos'}</span>
            </div>
            <span class="muted small">Open</span>
          </a>
        </li>`
      )
      .join('');
  } catch (err) {
    showMessage(listMessage, err.message);
  }
}

document.getElementById('createForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const message = document.getElementById('createMessage');
  form.querySelector('button').disabled = true;
  try {
    const { group } = await api('/groups', {
      method: 'POST',
      json: { name: document.getElementById('groupName').value },
    });
    window.location.href = `group.html?id=${group.id}`;
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    form.querySelector('button').disabled = false;
  }
});

document.getElementById('joinForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const message = document.getElementById('joinMessage');
  form.querySelector('button').disabled = true;
  try {
    const { group } = await api('/groups/join', {
      method: 'POST',
      json: { inviteCode: document.getElementById('inviteCode').value },
    });
    window.location.href = `group.html?id=${group.id}`;
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    form.querySelector('button').disabled = false;
  }
});

loadGroups();
