const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_admin_backup_location, put__api_admin_backup_location, get__api_admin_backup_rclone_check, get__api_admin_backups, get__api_admin_backup_schedule, get__api_admin_backups__id_files, post__api_admin_backups, post__api_admin_backups__id_restore, put__api_admin_backup_schedule, delete__api_admin_backups__id } = require('../controllers/backupController');

router.get('/api/admin/backup-location', authenticateToken, get__api_admin_backup_location);
router.put('/api/admin/backup-location', authenticateToken, put__api_admin_backup_location);
router.get('/api/admin/backup/rclone-check', authenticateToken, get__api_admin_backup_rclone_check);
router.get('/api/admin/backups', authenticateToken, get__api_admin_backups);
router.get('/api/admin/backups/:id/files', authenticateToken, get__api_admin_backups__id_files);
router.post('/api/admin/backups', authenticateToken, post__api_admin_backups);
router.post('/api/admin/backups/:id/restore', authenticateToken, post__api_admin_backups__id_restore);
router.delete('/api/admin/backups/:id', authenticateToken, delete__api_admin_backups__id);
router.get('/api/admin/backup-schedule', authenticateToken, get__api_admin_backup_schedule);
router.put('/api/admin/backup-schedule', authenticateToken, put__api_admin_backup_schedule);

module.exports = router;
