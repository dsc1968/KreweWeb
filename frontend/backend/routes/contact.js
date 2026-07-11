const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { post__api_contact } = require('../controllers/contactController');

router.post('/api/contact', post__api_contact);

module.exports = router;
