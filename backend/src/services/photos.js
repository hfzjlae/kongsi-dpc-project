// ------------------------------------------------------------------
// services/photos.js — reusable photo queries, including the
// SEARCH & FILTER logic (bonus feature).
// ------------------------------------------------------------------
const db = require('../db');
const storage = require('../storage');

// Columns returned for every photo, plus uploader name, tag list and
// number of comments.
const PHOTO_SELECT = `
  SELECT p.id, p.group_id, p.caption, p.content_type, p.size_bytes,
         p.storage_key, p.created_at,
         u.id AS uploader_id, u.username AS uploader,
         COALESCE(
           (SELECT array_agg(t.name ORDER BY t.name)
              FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
             WHERE pt.photo_id = p.id), '{}'
         ) AS tags,
         (SELECT COUNT(*)::int FROM comments c WHERE c.photo_id = p.id) AS comment_count
    FROM photos p
    JOIN users u ON u.id = p.uploader_id`;

// Adds a browser-usable image URL and hides the internal storage key.
async function withUrls(rows) {
  return Promise.all(
    rows.map(async (row) => {
      const { storage_key: key, ...rest } = row;
      return { ...rest, url: await storage.getViewUrl(key) };
    })
  );
}

// Builds the group feed query. Every filter is optional; only the ones
// the user supplied are added to the WHERE clause. User input always
// goes in as a numbered parameter ($1, $2, ...) to stop SQL injection.
//
//   uploader -> exact username
//   from, to -> upload date range (YYYY-MM-DD)
//   tag      -> photos having that tag
//   q        -> keyword found in the caption, a tag, OR any comment
async function searchGroupPhotos(groupId, filters) {
  const where = ['p.group_id = $1'];
  const params = [groupId];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.uploader) add('LOWER(u.username) = LOWER(?)', filters.uploader);
  if (filters.from) add('p.created_at >= ?::date', filters.from);
  if (filters.to) add("p.created_at < (?::date + INTERVAL '1 day')", filters.to);
  if (filters.tag) {
    add(
      `EXISTS (SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
               WHERE pt.photo_id = p.id AND t.name = LOWER(?))`,
      filters.tag
    );
  }
  if (filters.q) {
    // Escape % and _ so they are treated as normal characters.
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(pattern);
    const n = `$${params.length}`;
    where.push(`(
      p.caption ILIKE ${n}
      OR EXISTS (SELECT 1 FROM comments c WHERE c.photo_id = p.id AND c.body ILIKE ${n})
      OR EXISTS (SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
                 WHERE pt.photo_id = p.id AND t.name ILIKE ${n})
    )`);
  }

  params.push(filters.limit, filters.offset);
  const sql = `${PHOTO_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await db.query(sql, params);
  return withUrls(rows);
}

async function getPhoto(photoId) {
  const { rows } = await db.query(`${PHOTO_SELECT} WHERE p.id = $1`, [photoId]);
  if (!rows[0]) return null;
  const [photo] = await withUrls(rows);
  return { ...photo, storage_key: rows[0].storage_key };
}

module.exports = { searchGroupPhotos, getPhoto, withUrls };
