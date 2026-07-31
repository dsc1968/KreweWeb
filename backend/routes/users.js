const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { isFloatAdmin, isFinanceAdmin } = require('../utils/validation');
const { requireFloatChange } = require('../utils/floatsLock');
const { get__api_users, get__api_current_season, get__api_admin_users, get__api_admin_users_report, get__api_admin_users__userId, put__api_admin_users__userId_details, post__api_admin_users, post__api_users, put__api_admin_users__userId_role, put__api_users__userId_role, put__api_admin_users__userId_disable, put__api_users__userId_disable, delete__api_admin_users__userId, delete__api_users__userId, put__api_admin_users__userId_password, put__api_users__userId_password, get__api_admin_users__userId_orders, patch__api_admin_users__userId_payments, get__api_admin_floats, get__api_admin_floats_report, post__api_admin_floats, put__api_admin_floats__floatId, delete__api_admin_floats__floatId, delete__api_admin_floats__floatId_riders, get__api_floats, get__api_admin_payments, put__api_admin_floats_lock } = require('../controllers/usersController');

function requireFloatAdmin(req, res, next) {
  if (!isFloatAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function requireFinanceAdmin(req, res, next) {
  if (!isFinanceAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.get('/api/users', authenticateToken, get__api_users);
router.get('/api/current-season', authenticateToken, get__api_current_season);
router.get('/api/admin/users', authenticateToken, get__api_admin_users);
// NOTE: this exact route MUST be registered before '/:userId' below,
// otherwise Express matches 'report' as the :userId param.
router.get('/api/admin/users/report', authenticateToken, get__api_admin_users_report);
router.get('/api/admin/users/:userId', authenticateToken, get__api_admin_users__userId);
router.put('/api/admin/users/:userId/details', authenticateToken, put__api_admin_users__userId_details);
router.post('/api/admin/users', authenticateToken, post__api_admin_users);
router.post('/api/users', authenticateToken, post__api_users);
router.put('/api/admin/users/:userId/role', authenticateToken, put__api_admin_users__userId_role);
router.put('/api/users/:userId/role', authenticateToken, put__api_users__userId_role);
router.put('/api/admin/users/:userId/disable', authenticateToken, put__api_admin_users__userId_disable);
router.put('/api/users/:userId/disable', authenticateToken, put__api_users__userId_disable);
router.delete('/api/admin/users/:userId', authenticateToken, delete__api_admin_users__userId);
router.delete('/api/users/:userId', authenticateToken, delete__api_users__userId);
router.put('/api/admin/users/:userId/password', authenticateToken, put__api_admin_users__userId_password);
router.put('/api/users/:userId/password', authenticateToken, put__api_users__userId_password);
router.get('/api/admin/users/:userId/orders', authenticateToken, get__api_admin_users__userId_orders);
router.patch('/api/admin/users/:userId/payments', authenticateToken, requireFinanceAdmin, patch__api_admin_users__userId_payments);
router.get('/api/floats', authenticateToken, get__api_floats);
router.get('/api/admin/floats', authenticateToken, requireFloatAdmin, get__api_admin_floats);
router.get('/api/admin/floats/report', authenticateToken, requireFloatAdmin, get__api_admin_floats_report);
router.post('/api/admin/floats', authenticateToken, requireFloatChange, post__api_admin_floats);
router.put('/api/admin/floats/lock', authenticateToken, requireFloatChange, put__api_admin_floats_lock);
router.put('/api/admin/floats/:floatId', authenticateToken, requireFloatChange, put__api_admin_floats__floatId);
router.delete('/api/admin/floats/:floatId', authenticateToken, requireFloatChange, delete__api_admin_floats__floatId);
router.delete('/api/admin/floats/:floatId/riders', authenticateToken, requireFloatChange, delete__api_admin_floats__floatId_riders);
router.get('/api/admin/payments', authenticateToken, requireFinanceAdmin, get__api_admin_payments);

module.exports = router;
