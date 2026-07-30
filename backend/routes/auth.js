const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { post__api_auth_register, post__api_auth_register_request_code, post__api_auth_register_verify_code, post__api_auth_login, get__api_profile, put__api_profile_details, get__api_members, get__api_mfa_policy, post__api_auth_mfa_send, post__api_auth_mfa_verify, put__api_profile_mfa, put__api_profile_password } = require('../controllers/authController');

router.post('/api/auth/register', post__api_auth_register);
router.post('/api/auth/register/request-code', post__api_auth_register_request_code);
router.post('/api/auth/register/verify-code', post__api_auth_register_verify_code);
router.post('/api/auth/login', post__api_auth_login);
router.post('/api/auth/mfa/send', post__api_auth_mfa_send);
router.post('/api/auth/mfa/verify', post__api_auth_mfa_verify);
router.get('/api/mfa-policy', get__api_mfa_policy);
router.get('/api/profile', authenticateToken, get__api_profile);
router.put('/api/profile/details', authenticateToken, put__api_profile_details);
router.put('/api/profile/mfa', authenticateToken, put__api_profile_mfa);
router.put('/api/profile/password', authenticateToken, put__api_profile_password);
router.get('/api/members', get__api_members);

module.exports = router;
