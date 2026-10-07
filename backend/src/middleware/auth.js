// ------------------------------------------------------------------
// auth.js — checks WHO is making the request.
//
// After logging in, the browser receives a JWT (JSON Web Token): a
// signed "ticket" containing the user's id and username. The browser
// sends it with every request in the header:
//     Authorization: Bearer <token>
//
// Because the ticket itself proves identity, the API server does not
// need to remember logged-in users in its memory. That makes the API
// "stateless", so we can run 2+ copies of it behind a load balancer
// and any copy can serve any user. (Important for a distributed system.)
// ------------------------------------------------------------------
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.id, username: payload.username };
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

// Returns true if the user belongs to the friend group.
async function isGroupMember(groupId, userId) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return rowCount > 0;
}

// Turns a URL parameter like "12" into a number, or null if invalid.
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { signToken, requireAuth, isGroupMember, toId };
