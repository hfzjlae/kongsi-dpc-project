// ------------------------------------------------------------------
// photo.js — one photo and its comments (photo.html)
//
// Comments refresh every 5 seconds ("polling"), so when two friends
// have this page open, each sees the other's new comments without
// reloading. This is the easiest way to demo multi-user interaction.
// ------------------------------------------------------------------
requireLogin();
renderTopbar();

const photoId = getParam('id');
if (!photoId) window.location.href = 'groups.html';

const POLL_MS = 5000;
const me = getUser();
const commentsList = document.getElementById('comments');
const commentMessage = document.getElementById('commentMessage');
const pageMessage = document.getElementById('pageMessage');

let lastSignature = '';   // detects whether comments changed since last poll
let editingId = null;     // comment currently being edited (pauses re-render)

// ---------- Photo ----------
async function loadPhoto() {
  try {
    const { photo } = await api(`/photos/${photoId}`);
    document.getElementById('photo').hidden = false;
    document.getElementById('backLink').href = `group.html?id=${photo.group_id}`;
    const img = document.getElementById('photoImg');
    img.src = photo.url;
    img.alt = photo.caption || `Photo by ${photo.uploader}`;
    document.getElementById('photoCaption').textContent = photo.caption || 'Untitled photo';
    document.getElementById('photoMeta').textContent =
      `Shared by ${photo.uploader} on ${formatDate(photo.created_at)}`;
    document.getElementById('photoTags').innerHTML = photo.tags
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join('');

    const deleteButton = document.getElementById('deletePhoto');
    deleteButton.hidden = photo.uploader_id !== me.id;
    deleteButton.onclick = async () => {
      if (!confirm('Delete this photo and all its comments? This cannot be undone.')) return;
      try {
        await api(`/photos/${photoId}`, { method: 'DELETE' });
        window.location.href = `group.html?id=${photo.group_id}`;
      } catch (err) {
        showMessage(pageMessage, err.message);
      }
    };
  } catch (err) {
    showMessage(pageMessage, err.message);
  }
}

// ---------- Comments ----------
function commentItem(c) {
  const mine = c.user_id === me.id;
  const edited = c.updated_at ? ' (edited)' : '';
  return `
    <li class="comment" data-id="${c.id}" data-version="${c.version}">
      <div class="comment-head">
        <strong>${escapeHtml(c.username)}</strong>
        <span>${timeAgo(c.created_at)}${edited}</span>
      </div>
      <p class="comment-body">${escapeHtml(c.body)}</p>
      ${
        mine
          ? `<div class="comment-actions">
               <button type="button" class="button button-quiet button-small" data-action="edit">Edit</button>
               <button type="button" class="button button-danger button-small" data-action="delete">Delete</button>
             </div>`
          : ''
      }
    </li>`;
}

async function loadComments(force = false) {
  if (editingId && !force) return; // don't wipe out an edit in progress
  try {
    const { comments } = await api(`/photos/${photoId}/comments`);
    const signature = comments.map((c) => `${c.id}:${c.version}`).join(',');
    if (!force && signature === lastSignature) return; // nothing new
    lastSignature = signature;

    document.getElementById('commentHeading').textContent =
      `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`;
    commentsList.innerHTML = comments.length
      ? comments.map(commentItem).join('')
      : '<li class="muted small">No comments yet. Start the conversation.</li>';
  } catch (err) {
    showMessage(commentMessage, err.message);
  }
}

document.getElementById('commentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const textarea = document.getElementById('commentBody');
  form.querySelector('button').disabled = true;
  try {
    await api(`/photos/${photoId}/comments`, { method: 'POST', json: { body: textarea.value } });
    textarea.value = '';
    showMessage(commentMessage, '');
    await loadComments(true);
  } catch (err) {
    showMessage(commentMessage, err.message);
  } finally {
    form.querySelector('button').disabled = false;
  }
});

// Edit / delete buttons (one listener for the whole list)
commentsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = button.closest('.comment');
  const id = item.dataset.id;
  const action = button.dataset.action;

  if (action === 'delete') {
    if (!confirm('Delete this comment?')) return;
    try {
      await api(`/comments/${id}`, { method: 'DELETE' });
      await loadComments(true);
    } catch (err) {
      showMessage(commentMessage, err.message);
    }
  }

  if (action === 'edit') {
    editingId = id;
    const current = item.querySelector('.comment-body').textContent;
    item.querySelector('.comment-body').outerHTML = `
      <textarea class="edit-box" maxlength="1000">${escapeHtml(current)}</textarea>`;
    item.querySelector('.comment-actions').innerHTML = `
      <button type="button" class="button button-small" data-action="save">Save</button>
      <button type="button" class="button button-quiet button-small" data-action="cancel">Cancel</button>`;
    item.querySelector('.edit-box').focus();
  }

  if (action === 'cancel') {
    editingId = null;
    await loadComments(true);
  }

  if (action === 'save') {
    try {
      await api(`/comments/${id}`, {
        method: 'PUT',
        // send the version we loaded -> the API rejects the edit if the
        // comment changed elsewhere in the meantime (409 Conflict)
        json: { body: item.querySelector('.edit-box').value, version: Number(item.dataset.version) },
      });
      showMessage(commentMessage, '');
    } catch (err) {
      showMessage(commentMessage, err.message);
    }
    editingId = null;
    await loadComments(true);
  }
});

// ---------- Start ----------
loadPhoto();
loadComments(true);
setInterval(() => {
  if (!document.hidden) loadComments();
}, POLL_MS);
