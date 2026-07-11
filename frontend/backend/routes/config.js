const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_admin_file_source, put__api_admin_file_source, get__api_admin_config, put__api_admin_config, post__api_admin_season_reset } = require('../controllers/configController');

router.get('/api/admin/file-source', authenticateToken, get__api_admin_file_source);
router.put('/api/admin/file-source', authenticateToken, put__api_admin_file_source);
router.get('/api/admin/config', authenticateToken, get__api_admin_config);
router.put('/api/admin/config', authenticateToken, put__api_admin_config);
router.post('/api/admin/season-reset', authenticateToken, post__api_admin_season_reset);

module.exports = router;
