const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { post__api_auth_register_request_code, post__api_auth_register_verify_code, post__api_auth_login, get__api_profile, put__api_profile_details, get__api_members } = require('../controllers/authController');

router.post('/api/auth/register/request-code', post__api_auth_register_request_code);
router.post('/api/auth/register/verify-code', post__api_auth_register_verify_code);
router.post('/api/auth/login', post__api_auth_login);
router.get('/api/profile', authenticateToken, get__api_profile);
router.put('/api/profile/details', authenticateToken, put__api_profile_details);
router.get('/api/members', get__api_members);

module.exports = router;
