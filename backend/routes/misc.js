const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_calendar_events, post__api_admin_upload_image, get__api_admin_images, put__api_admin_calendar_events, delete__api_admin_calendar_events } = require('../controllers/miscController');

router.get('/api/calendar-events', get__api_calendar_events);
router.post('/api/admin/upload-image', authenticateToken, upload.single('image'), post__api_admin_upload_image);
router.get('/api/admin/images', authenticateToken, get__api_admin_images);
router.put('/api/admin/calendar-events', authenticateToken, put__api_admin_calendar_events);
router.delete('/api/admin/calendar-events', authenticateToken, delete__api_admin_calendar_events);

module.exports = router;
