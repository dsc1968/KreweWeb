// Global "lock" for the Float Admin tool. When engaged, only the Float Admin
// role may make changes to floats (create/edit/delete floats and riders, and
// member float assignments). When disengaged, behaviour matches the previous
// state (any float admin — admin or float_admin — may change floats).
const { getSiteSetting, setSiteSetting } = require('../utils/backup');
const { isFloatAdmin } = require('../utils/validation');

const LOCK_KEY = 'float_admin_lock';

async function floatLockEnabled() {
  return (await getSiteSetting(LOCK_KEY)) === 'true';
}

async function setFloatLock(locked) {
  await setSiteSetting(LOCK_KEY, locked ? 'true' : 'false');
}

// Gate for float mutations. Engaged => Float Admin only. Disengaged => any
// float admin (admin or float_admin), matching today's behaviour.
async function requireFloatChange(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const locked = await floatLockEnabled();
    if (locked) {
      if (req.user.role !== 'float_admin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Floats are locked. Only the Float Admin or an Admin can make changes.' });
      }
      return next();
    }
    if (req.user.role !== 'admin' && req.user.role !== 'float_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { LOCK_KEY, floatLockEnabled, setFloatLock, requireFloatChange };
