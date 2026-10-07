-- =====================================================================
--  Kongsi photo-sharing system — DATA TIER (PostgreSQL schema)
--  Run this once against an empty database:
--      psql "<your connection string>" -f database/schema.sql
--
--  Storage strategy:
--    * Structured, related data (users, groups, comments, tags, photo
--      metadata) lives here, in PostgreSQL.
--    * The actual image files live in object storage (Amazon S3).
--      The photos table only stores the file's key (its "name" in S3).
-- =====================================================================

-- Start clean (safe to re-run during development; DELETES ALL DATA)
DROP TABLE IF EXISTS comments, photo_tags, tags, photos, group_members, friend_groups, users CASCADE;

-- ---------------------------------------------------------------------
-- USERS: one row per registered person
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(30)  NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,   -- stored in lowercase
    password_hash TEXT         NOT NULL,          -- bcrypt hash, never the real password
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- "Lae" and "lae" count as the same username
CREATE UNIQUE INDEX idx_users_username_lower ON users (LOWER(username));

-- ---------------------------------------------------------------------
-- FRIEND GROUPS: a shared album that a group of friends belongs to
-- ---------------------------------------------------------------------
CREATE TABLE friend_groups (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(80)  NOT NULL,
    invite_code VARCHAR(12)  NOT NULL UNIQUE,     -- friends join using this code
    created_by  INT          NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Many-to-many: which users belong to which groups
CREATE TABLE group_members (
    group_id  INT NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    user_id   INT NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)                  -- a user can only join a group once
);

-- ---------------------------------------------------------------------
-- PHOTOS: metadata only; the image itself is in S3 under storage_key
-- ---------------------------------------------------------------------
CREATE TABLE photos (
    id            SERIAL PRIMARY KEY,
    group_id      INT          NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    uploader_id   INT          NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    storage_key   TEXT         NOT NULL UNIQUE,   -- e.g. groups/3/5f1c...e2.jpg (UUID = no name clashes)
    original_name TEXT,
    content_type  VARCHAR(50)  NOT NULL,
    size_bytes    INT          NOT NULL,
    caption       VARCHAR(500),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- TAGS: keywords attached to photos (used by search/filter)
-- ---------------------------------------------------------------------
CREATE TABLE tags (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE                -- stored in lowercase
);

CREATE TABLE photo_tags (
    photo_id INT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    tag_id   INT NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (photo_id, tag_id)
);

-- ---------------------------------------------------------------------
-- COMMENTS: friends' comments on a photo
--   version  -> used for optimistic concurrency control when editing:
--               an edit only succeeds if nobody changed the comment
--               since the editor last loaded it.
-- ---------------------------------------------------------------------
CREATE TABLE comments (
    id         SERIAL PRIMARY KEY,
    photo_id   INT          NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id    INT          NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    body       VARCHAR(1000) NOT NULL,
    version    INT          NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- INDEXES: make the most common queries fast
-- ---------------------------------------------------------------------
CREATE INDEX idx_photos_group_created   ON photos (group_id, created_at DESC);  -- group feed
CREATE INDEX idx_photos_uploader        ON photos (uploader_id);                -- filter by uploader
CREATE INDEX idx_comments_photo_created ON comments (photo_id, created_at);     -- comment thread
CREATE INDEX idx_group_members_user     ON group_members (user_id);             -- "my groups"
