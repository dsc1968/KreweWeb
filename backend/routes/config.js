const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_admin_file_source, put__api_admin_file_source, get__api_admin_config, put__api_admin_config, post__api_admin_season_reset, get__api_admin_mfa_config, put__api_admin_mfa_config, get__api_admin_theme_config, put__api_admin_theme_config, get__api_theme } = require('../controllers/configController');

router.get('/api/admin/file-source', authenticateToken, get__api_admin_file_source);
router.put('/api/admin/file-source', authenticateToken, put__api_admin_file_source);
router.get('/api/admin/config', authenticateToken, get__api_admin_config);
router.put('/api/admin/config', authenticateToken, put__api_admin_config);
router.post('/api/admin/season-reset', authenticateToken, post__api_admin_season_reset);
router.get('/api/admin/mfa-config', authenticateToken, get__api_admin_mfa_config);
router.put('/api/admin/mfa-config', authenticateToken, put__api_admin_mfa_config);
router.get('/api/admin/theme-config', authenticateToken, get__api_admin_theme_config);
router.put('/api/admin/theme-config', authenticateToken, put__api_admin_theme_config);
// Public: no auth so every page (including login/marketing) can apply the theme.
router.get('/api/theme', get__api_theme);

module.exports = router;
