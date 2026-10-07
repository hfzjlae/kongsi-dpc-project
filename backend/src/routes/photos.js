// ------------------------------------------------------------------
// routes/photos.js — a single photo and its comments
//   GET    /api/photos/:photoId              photo details
//   DELETE /api/photos/:photoId              delete (uploader only)
//   GET    /api/photos/:photoId/comments     list comments
//   POST   /api/photos/:photoId/comments     add a comment
// ------------------------------------------------------------------
const express = require('express');
const db = require('../db');
const storage = require('../storage');
const { requireAuth, isGroupMember, toId } = require('../middleware/auth');
const { getPhoto } = require('../services/photos');

const router = express.Router();
router.use(requireAuth);

// Loads the photo and checks the user is in the photo's group.
// Returns the photo, or null after sending a 404.
async function loadPhotoForMember(req, res) {
  const photoId = toId(req.params.photoId);
  const photo = photoId ? await getPhoto(photoId) : null;
  if (!photo || !(await isGroupMember(photo.group_id, req.user.id))) {
    res.status(404).json({ error: 'Photo not found.' });
    return null;
  }
  return photo;
}

router.get('/:photoId', async (req, res, next) => {
  try {
    const photo = await loadPhotoForMember(req, res);
    if (!photo) return;
    const { storage_key: _hidden, ...publicPhoto } = photo;
    res.json({ photo: publicPhoto });
  } catch (err) {
    next(err);
  }
});

router.delete('/:photoId', async (req, res, next) => {
  try {
    const photo = await loadPhotoForMember(req, res);
    if (!photo) return;
    if (photo.uploader_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the person who uploaded this photo can delete it.' });
    }
    // Delete the database row first (comments and tags go with it via
    // ON DELETE CASCADE), then the file.
    await db.query('DELETE FROM photos WHERE id = $1', [photo.id]);
    await storage.deleteFile(photo.storage_key);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:photoId/comments', async (req, res, next) => {
  try {
    const photo = await loadPhotoForMember(req, res);
    if (!photo) return;
    const { rows } = await db.query(
      `SELECT c.id, c.body, c.version, c.created_at, c.updated_at,
              u.id AS user_id, u.username
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.photo_id = $1
        ORDER BY c.created_at ASC, c.id ASC`,
      [photo.id]
    );
    res.json({ comments: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:photoId/comments', async (req, res, next) => {
  try {
    const photo = await loadPhotoForMember(req, res);
    if (!photo) return;
    const body = String(req.body.body || '').trim();
    if (!body || body.length > 1000) {
      return res.status(400).json({ error: 'Comments must be 1–1000 characters.' });
    }
    // Each comment is its own INSERT (its own row), so many friends
    // commenting at the same time never overwrite each other.
    const { rows } = await db.query(
      `INSERT INTO comments (photo_id, user_id, body) VALUES ($1, $2, $3)
       RETURNING id, body, version, created_at, updated_at, user_id`,
      [photo.id, req.user.id, body]
    );
    res.status(201).json({ comment: { ...rows[0], username: req.user.username } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
