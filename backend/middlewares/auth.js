// Authentication middleware: verifies the JWT bearer token (or krewe_token cookie)
// and attaches the authenticated user to req.user before the route handler runs.
const jwt = require('jsonwebtoken');
const { pool, JWT_SECRET } = require('../config/db');
const { normalizeRoleSet, primaryRole } = require('../utils/validation');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  if (!token && req.headers.cookie) {
    const cookieMatch = req.headers.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('krewe_token='));
    if (cookieMatch) token = cookieMatch.slice('krewe_token='.length);
  }
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const userResult = await pool.query('SELECT id, role, roles FROM users WHERE id = $1', [payload.userId]);
    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    const currentUser = userResult.rows[0];
    // Resolve the authoritative role set from the DB (fresh on every request so
    // role changes take effect without re-login). Fall back to the legacy
    // single `role` when `roles` has not been populated yet.
    const roles = normalizeRoleSet(
      Array.isArray(currentUser.roles) && currentUser.roles.length ? currentUser.roles : currentUser.role
    );
    if (roles.includes('disabled')) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = {
      ...payload,
      role: primaryRole(roles),
      roles,
    };
    next();
  } catch (error) {
    console.error('Token authentication lookup failed', error);
    res.status(500).json({ error: 'Unable to validate token' });
  }
}


module.exports = { authenticateToken };
