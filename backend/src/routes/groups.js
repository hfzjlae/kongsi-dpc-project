// ------------------------------------------------------------------
// routes/groups.js — friend groups (shared albums) and their photos
//   GET  /api/groups                    my groups
//   POST /api/groups                    create a group
//   POST /api/groups/join               join with an invite code
//   GET  /api/groups/:groupId           group details + members
//   GET  /api/groups/:groupId/photos    feed, with optional search/filter
//   POST /api/groups/:groupId/photos    upload a photo
// ------------------------------------------------------------------
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const storage = require('../storage');
const { requireAuth, isGroupMember, toId } = require('../middleware/auth');
const { searchGroupPhotos, getPhoto } = require('../services/photos');

const router = express.Router();
router.use(requireAuth); // every route below needs a signed-in user

// Allowed image types and their file extensions
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// multer reads the uploaded file into memory (req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Only JPEG, PNG, WebP or GIF images can be uploaded.');
    err.status = 400;
    return cb(err);
  },
});

function makeInviteCode() {
  // 8 characters, no easily confused letters (0/O, 1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (const byte of crypto.randomBytes(8)) code += alphabet[byte % alphabet.length];
  return code;
}

// ---------- My groups ----------
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.invite_code, g.created_at,
              (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS member_count,
              (SELECT COUNT(*)::int FROM photos p WHERE p.group_id = g.id)        AS photo_count
         FROM friend_groups g
         JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.user_id = $1
        ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json({ groups: rows });
  } catch (err) {
    next(err);
  }
});

// ---------- Create a group ----------
router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: 'Group name must be 2–80 characters.' });
    }
    // Transaction: the group and its first member are saved together,
    // or not at all.
    const group = await db.transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO friend_groups (name, invite_code, created_by)
         VALUES ($1, $2, $3) RETURNING id, name, invite_code, created_at`,
        [name, makeInviteCode(), req.user.id]
      );
      await client.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [
        rows[0].id,
        req.user.id,
      ]);
      return rows[0];
    });
    res.status(201).json({ group });
  } catch (err) {
    next(err);
  }
});

// ---------- Join with an invite code ----------
router.post('/join', async (req, res, next) => {
  try {
    const code = String(req.body.inviteCode || '').trim().toUpperCase();
    const { rows } = await db.query(
      'SELECT id, name, invite_code, created_at FROM friend_groups WHERE invite_code = $1',
      [code]
    );
    const group = rows[0];
    if (!group) return res.status(404).json({ error: 'No group matches that invite code.' });

    // ON CONFLICT DO NOTHING: joining twice (or double-clicking) is harmless
    await db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [group.id, req.user.id]
    );
    res.json({ group });
  } catch (err) {
    next(err);
  }
});

// ---------- Group details ----------
router.get('/:groupId', async (req, res, next) => {
  try {
    const groupId = toId(req.params.groupId);
    if (!groupId || !(await isGroupMember(groupId, req.user.id))) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    const { rows } = await db.query(
      'SELECT id, name, invite_code, created_by, created_at FROM friend_groups WHERE id = $1',
      [groupId]
    );
    const members = await db.query(
      `SELECT u.id, u.username, gm.joined_at
         FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1 ORDER BY u.username`,
      [groupId]
    );
    const tags = await db.query(
      `SELECT DISTINCT t.name
         FROM tags t JOIN photo_tags pt ON pt.tag_id = t.id
         JOIN photos p ON p.id = pt.photo_id
        WHERE p.group_id = $1 ORDER BY t.name`,
      [groupId]
    );
    res.json({ group: rows[0], members: members.rows, tags: tags.rows.map((r) => r.name) });
  } catch (err) {
    next(err);
  }
});

// ---------- Feed with search & filter ----------
router.get('/:groupId/photos', async (req, res, next) => {
  try {
    const groupId = toId(req.params.groupId);
    if (!groupId || !(await isGroupMember(groupId, req.user.id))) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const filters = {
      uploader: String(req.query.uploader || '').trim() || null,
      from: isDate(req.query.from) ? req.query.from : null,
      to: isDate(req.query.to) ? req.query.to : null,
      tag: String(req.query.tag || '').trim().toLowerCase() || null,
      q: String(req.query.q || '').trim().slice(0, 100) || null,
      limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 50),
      offset: Math.max(parseInt(req.query.offset, 10) || 0, 0),
    };
    const photos = await searchGroupPhotos(groupId, filters);
    res.json({ photos, limit: filters.limit, offset: filters.offset });
  } catch (err) {
    next(err);
  }
});

// ---------- Upload a photo ----------
router.post('/:groupId/photos', upload.single('photo'), async (req, res, next) => {
  const groupId = toId(req.params.groupId);
  let storedKey = null;
  try {
    if (!groupId || !(await isGroupMember(groupId, req.user.id))) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload.' });

    const caption = String(req.body.caption || '').trim().slice(0, 500) || null;
    const tags = [
      ...new Set(
        String(req.body.tags || '')
          .split(',')
          .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
          .filter((t) => /^[a-z0-9_-]{1,40}$/.test(t))
      ),
    ].slice(0, 10);

    // 1) Save the file under a random UUID name, so two friends uploading
    //    "IMG_0001.jpg" at the same moment never overwrite each other.
    const key = `groups/${groupId}/${crypto.randomUUID()}.${IMAGE_TYPES[req.file.mimetype]}`;
    await storage.saveFile(key, req.file.buffer, req.file.mimetype);
    storedKey = key;

    // 2) Save the metadata + tags in ONE transaction.
    const photoId = await db.transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO photos (group_id, uploader_id, storage_key, original_name, content_type, size_bytes, caption)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [groupId, req.user.id, key, req.file.originalname, req.file.mimetype, req.file.size, caption]
      );
      for (const tag of tags) {
        // "Upsert": if two uploads create the same new tag at the same
        // time, ON CONFLICT makes one reuse the other's row instead of failing.
        const t = await client.query(
          `INSERT INTO tags (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [tag]
        );
        await client.query(
          'INSERT INTO photo_tags (photo_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [rows[0].id, t.rows[0].id]
        );
      }
      return rows[0].id;
    });
    storedKey = null; // success: keep the file

    const { storage_key: _hidden, ...photo } = await getPhoto(photoId);
    res.status(201).json({ photo });
  } catch (err) {
    // If the database step failed, remove the orphaned file so storage
    // and database stay consistent (a simple "compensating action").
    if (storedKey) await storage.deleteFile(storedKey);
    next(err);
  }
});

module.exports = router;
