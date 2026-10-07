// ------------------------------------------------------------------
// group.js — one friend group's album (group.html)
//   * shows group info, invite code and members
//   * uploads photos (resized in the browser first to save storage
//     and bandwidth — a cost-optimisation you can mention)
//   * search & filter (bonus feature)
//   * refreshes the feed every 20 seconds so new photos from friends appear
// ------------------------------------------------------------------
requireLogin();
renderTopbar();

const groupId = getParam('id');
if (!groupId) window.location.href = 'groups.html';

const PAGE_SIZE = 24;
const REFRESH_MS = 20000;
let offset = 0;
let activeFilters = {};

const board = document.getElementById('board');
const feedStatus = document.getElementById('feedStatus');
const loadMoreButton = document.getElementById('loadMore');
const pageMessage = document.getElementById('pageMessage');

// ---------- Group details ----------
async function loadGroup() {
  try {
    const { group, members, tags } = await api(`/groups/${groupId}`);
    document.title = `${group.name} — Kongsi`;
    document.getElementById('groupName').textContent = group.name;
    document.getElementById('inviteCode').textContent = group.invite_code;
    document.getElementById('members').innerHTML = members
      .map((m) => `<li>${escapeHtml(m.username)}</li>`)
      .join('');

    fillSelect('uploader', members.map((m) => m.username), 'Anyone');
    fillSelect('tag', tags, 'Any tag');
  } catch (err) {
    showMessage(pageMessage, err.message);
  }
}

// Refills a <select>, keeping the current choice if it still exists
function fillSelect(id, values, emptyLabel) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML =
    `<option value="">${emptyLabel}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  select.value = values.includes(current) ? current : '';
}

document.getElementById('copyCode').addEventListener('click', async (event) => {
  const code = document.getElementById('inviteCode').textContent;
  try {
    await navigator.clipboard.writeText(code);
    event.target.textContent = 'Copied';
    setTimeout(() => (event.target.textContent = 'Copy'), 1500);
  } catch {
    event.target.textContent = 'Select and copy';
  }
});

// ---------- Feed ----------
function photoCard(p) {
  const tags = p.tags.length
    ? `<ul class="tags">${p.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '';
  return `
    <a class="print" href="photo.html?id=${p.id}">
      <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || 'Photo by ' + p.uploader)}" loading="lazy" />
      ${p.caption ? `<p class="print-caption">${escapeHtml(p.caption)}</p>` : ''}
      ${tags}
      <div class="print-meta" style="margin-top:0.5rem">
        <span>${escapeHtml(p.uploader)}, ${timeAgo(p.created_at)}</span>
        <span>${p.comment_count} ${p.comment_count === 1 ? 'comment' : 'comments'}</span>
      </div>
    </a>`;
}

function buildQuery(extra) {
  const params = new URLSearchParams({ ...activeFilters, ...extra });
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  return params.toString();
}

// replace = true: reload from the top. false: append the next page.
async function loadPhotos(replace = true) {
  try {
    const nextOffset = replace ? 0 : offset;
    // When refreshing, fetch everything already shown so nothing disappears
    const limit = replace ? Math.max(PAGE_SIZE, Math.min(offset, 50)) : PAGE_SIZE;
    const { photos } = await api(`/groups/${groupId}/photos?${buildQuery({ limit, offset: nextOffset })}`);

    if (replace) board.innerHTML = '';
    board.insertAdjacentHTML('beforeend', photos.map(photoCard).join(''));
    offset = nextOffset + photos.length;
    loadMoreButton.hidden = photos.length < limit;

    const filtering = Object.values(activeFilters).some(Boolean);
    document.getElementById('clearFilters').hidden = !filtering;
    if (offset === 0) {
      feedStatus.textContent = filtering
        ? 'No photos match these filters.'
        : 'No photos yet. Add the first one.';
    } else {
      feedStatus.textContent = `Showing ${offset} ${offset === 1 ? 'photo' : 'photos'}${filtering ? ' matching your filters' : ''}.`;
    }
  } catch (err) {
    showMessage(pageMessage, err.message);
  }
}

loadMoreButton.addEventListener('click', () => loadPhotos(false));

document.getElementById('filterForm').addEventListener('submit', (event) => {
  event.preventDefault();
  activeFilters = {
    q: document.getElementById('q').value.trim(),
    uploader: document.getElementById('uploader').value,
    tag: document.getElementById('tag').value,
    from: document.getElementById('from').value,
    to: document.getElementById('to').value,
  };
  offset = 0;
  loadPhotos(true);
});

document.getElementById('clearFilters').addEventListener('click', () => {
  document.getElementById('filterForm').reset();
  activeFilters = {};
  offset = 0;
  loadPhotos(true);
});

// ---------- Upload ----------
const fileInput = document.getElementById('photoFile');
const preview = document.getElementById('preview');

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) {
    preview.hidden = true;
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});

// Shrinks large photos to at most 1600px on the longest side and
// re-saves them as JPEG. A 6 MB phone photo usually becomes ~300 KB.
// GIFs are left alone so animations keep working.
async function resizeImage(file, maxSide = 1600, quality = 0.82) {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1024 * 1024) return file; // already small
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

document.getElementById('uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  const message = document.getElementById('uploadMessage');
  const file = fileInput.files[0];
  if (!file) return showMessage(message, 'Choose a photo to upload.');

  button.disabled = true;
  button.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('photo', await resizeImage(file));
    formData.append('caption', document.getElementById('caption').value);
    formData.append('tags', document.getElementById('tags').value);
    await api(`/groups/${groupId}/photos`, { method: 'POST', formData });

    form.reset();
    preview.hidden = true;
    showMessage(message, 'Photo uploaded.', 'success');
    setTimeout(() => showMessage(message, ''), 2500);
    await Promise.all([loadGroup(), loadPhotos(true)]);
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Upload photo';
  }
});

// ---------- Start ----------
loadGroup();
loadPhotos(true);
// Keep the album fresh while friends upload (paused when the tab is hidden)
setInterval(() => {
  if (!document.hidden) loadPhotos(true);
}, REFRESH_MS);
