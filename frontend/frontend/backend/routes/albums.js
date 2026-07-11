const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { get__api_albums, get__api_albums__albumId_images, post__api_admin_albums, put__api_admin_albums__albumId___d__, delete__api_admin_albums__albumId___d__, handleAlbumReorder, post__api_admin_albums__albumId___d___images, put__api_admin_albums__albumId___d___images__imageId___d__, delete__api_admin_albums__albumId___d___images__imageId___d__ } = require('../controllers/albumsController');

router.get('/api/albums', get__api_albums);
router.get('/api/albums/:albumId/images', get__api_albums__albumId_images);
router.post('/api/admin/albums', authenticateToken, post__api_admin_albums);
router.put('/api/admin/albums/:albumId(\\d+)', authenticateToken, put__api_admin_albums__albumId___d__);
router.delete('/api/admin/albums/:albumId(\\d+)', authenticateToken, delete__api_admin_albums__albumId___d__);
router.put('/api/admin/albums-reorder', authenticateToken, handleAlbumReorder);
router.put('/api/admin/albums/reorder', authenticateToken, handleAlbumReorder);
router.post('/api/admin/albums/:albumId(\\d+)/images', authenticateToken, post__api_admin_albums__albumId___d___images);
router.put('/api/admin/albums/:albumId(\\d+)/images/:imageId(\\d+)', authenticateToken, put__api_admin_albums__albumId___d___images__imageId___d__);
router.delete('/api/admin/albums/:albumId(\\d+)/images/:imageId(\\d+)', authenticateToken, delete__api_admin_albums__albumId___d___images__imageId___d__);

module.exports = router;
