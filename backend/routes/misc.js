const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_calendar_events, post__api_admin_upload_image, get__api_admin_images, put__api_admin_calendar_events, delete__api_admin_calendar_events, post__api_join_request, get__api_pending_users, post__api_approve_user, post__api_deny_user } = require('../controllers/miscController');

router.get('/api/calendar-events', get__api_calendar_events);
router.post('/api/admin/upload-image', authenticateToken, upload.single('image'), post__api_admin_upload_image);
router.get('/api/admin/images', authenticateToken, get__api_admin_images);
router.put('/api/admin/calendar-events', authenticateToken, put__api_admin_calendar_events);
router.delete('/api/admin/calendar-events', authenticateToken, delete__api_admin_calendar_events);

router.post('/api/join-request', post__api_join_request);

// Admin-only endpoints for managing pending registrations
router.get('/api/admin/pending-users', authenticateToken, get__api_pending_users);
router.post('/api/admin/approve-user/:id', authenticateToken, post__api_approve_user);
router.post('/api/admin/deny-user/:id', authenticateToken, post__api_deny_user);

module.exports = router;
