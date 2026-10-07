// ------------------------------------------------------------------
// routes/comments.js — edit or delete your own comment
//   PUT    /api/comments/:commentId   body: { body, version }
//   DELETE /api/comments/:commentId
//
// OPTIMISTIC CONCURRENCY CONTROL (for the report):
// Every comment has a "version" number. The browser sends back the
// version it loaded. The UPDATE only succeeds if the version in the
// database is still the same, and it then adds 1. If the comment was
// changed in the meantime (e.g. edited from a second device), the
// versions no longer match, nothing is overwritten, and the API
// replies 409 Conflict so the user can reload and try again.
// This prevents the "lost update" problem without locking rows.
// ------------------------------------------------------------------
const express = require('express');
const db = require('../db');
const { requireAuth, toId } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.put('/:commentId', async (req, res, next) => {
  try {
    const commentId = toId(req.params.commentId);
    const body = String(req.body.body || '').trim();
    const version = parseInt(req.body.version, 10);
    if (!commentId) return res.status(404).json({ error: 'Comment not found.' });
    if (!body || body.length > 1000) {
      return res.status(400).json({ error: 'Comments must be 1–1000 characters.' });
    }
    if (!Number.isInteger(version)) {
      return res.status(400).json({ error: 'Missing comment version.' });
    }

    const { rows } = await db.query(
      `UPDATE comments
          SET body = $1, version = version + 1, updated_at = now()
        WHERE id = $2 AND user_id = $3 AND version = $4
        RETURNING id, body, version, created_at, updated_at, user_id`,
      [body, commentId, req.user.id, version]
    );
    if (rows[0]) return res.json({ comment: { ...rows[0], username: req.user.username } });

    // Nothing updated: find out why.
    const check = await db.query('SELECT user_id, version FROM comments WHERE id = $1', [commentId]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Comment not found.' });
    if (check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own comments.' });
    }
    return res.status(409).json({
      error: 'This comment was changed somewhere else. Reload to see the latest version.',
      currentVersion: check.rows[0].version,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:commentId', async (req, res, next) => {
  try {
    const commentId = toId(req.params.commentId);
    const { rowCount } = await db.query('DELETE FROM comments WHERE id = $1 AND user_id = $2', [
      commentId,
      req.user.id,
    ]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found, or it is not yours to delete.' });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
