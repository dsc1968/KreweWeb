const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_users, get__api_current_season, get__api_admin_users, get__api_admin_users__userId, put__api_admin_users__userId_details, post__api_admin_users, post__api_users, put__api_admin_users__userId_role, put__api_users__userId_role, put__api_admin_users__userId_disable, put__api_users__userId_disable, delete__api_admin_users__userId, delete__api_users__userId, put__api_admin_users__userId_password, put__api_users__userId_password, get__api_admin_users__userId_orders } = require('../controllers/usersController');

router.get('/api/users', authenticateToken, get__api_users);
router.get('/api/current-season', authenticateToken, get__api_current_season);
router.get('/api/admin/users', authenticateToken, get__api_admin_users);
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

module.exports = router;
