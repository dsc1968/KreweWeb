const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_content, get__api_page_sections, get__api_element_overrides, put__api_admin_content, delete__api_admin_content, post__api_admin_content_new, put__api_admin_content_move, post__api_admin_page_sections, put__api_admin_element_overrides, put__api_admin_page_sections__sectionId___d__, delete__api_admin_page_sections__sectionId___d__, put__api_admin_page_sections_reorder } = require('../controllers/contentController');

router.get('/api/content', get__api_content);
router.get('/api/page-sections', get__api_page_sections);
router.get('/api/element-overrides', get__api_element_overrides);
router.put('/api/admin/content', authenticateToken, put__api_admin_content);
router.delete('/api/admin/content', authenticateToken, delete__api_admin_content);
router.post('/api/admin/content/new', authenticateToken, post__api_admin_content_new);
router.put('/api/admin/content/move', authenticateToken, put__api_admin_content_move);
router.post('/api/admin/page-sections', authenticateToken, post__api_admin_page_sections);
router.put('/api/admin/element-overrides', authenticateToken, put__api_admin_element_overrides);
router.put('/api/admin/page-sections/:sectionId(\\d+)', authenticateToken, put__api_admin_page_sections__sectionId___d__);
router.delete('/api/admin/page-sections/:sectionId(\\d+)', authenticateToken, delete__api_admin_page_sections__sectionId___d__);
router.put('/api/admin/page-sections/reorder', authenticateToken, put__api_admin_page_sections_reorder);

module.exports = router;
