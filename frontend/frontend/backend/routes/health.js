const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_status } = require('../controllers/healthController');

router.get('/api/status', get__api_status);

module.exports = router;
