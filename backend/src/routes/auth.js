// ------------------------------------------------------------------
// routes/auth.js — user accounts
//   POST /api/auth/register   create an account
//   POST /api/auth/login      sign in, receive a token
//   GET  /api/auth/me         who am I? (checks the token)
// ------------------------------------------------------------------
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–30 letters, numbers or underscores.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // Store only a salted hash of the password, never the password itself.
    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );
    const user = rows[0];
    return res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    // 23505 = unique constraint broken (username or email already used).
    // The UNIQUE constraint also protects us if two people try to
    // register the same username at the same instant.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That username or email is already registered.' });
    }
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!login || !password) {
      return res.status(400).json({ error: 'Enter your username or email and password.' });
    }

    const { rows } = await db.query(
      `SELECT id, username, email, password_hash, created_at
       FROM users WHERE LOWER(username) = $1 OR email = $1`,
      [login]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      // Same message for "no such user" and "wrong password" so attackers
      // cannot discover which usernames exist.
      return res.status(401).json({ error: 'Username or password is incorrect.' });
    }
    delete user.password_hash;
    return res.json({ token: signToken(user), user });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    return res.json({ user: rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
