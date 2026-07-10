const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_admin_backup_location, put__api_admin_backup_location, get__api_admin_backup_rclone_check, get__api_admin_backups, post__api_admin_backups, post__api_admin_backups__id_restore, delete__api_admin_backups__id } = require('../controllers/backupController');

router.get('/api/admin/backup-location', authenticateToken, get__api_admin_backup_location);
router.put('/api/admin/backup-location', authenticateToken, put__api_admin_backup_location);
router.get('/api/admin/backup/rclone-check', authenticateToken, get__api_admin_backup_rclone_check);
router.get('/api/admin/backups', authenticateToken, get__api_admin_backups);
router.post('/api/admin/backups', authenticateToken, post__api_admin_backups);
router.post('/api/admin/backups/:id/restore', authenticateToken, post__api_admin_backups__id_restore);
router.delete('/api/admin/backups/:id', authenticateToken, delete__api_admin_backups__id);

module.exports = router;
