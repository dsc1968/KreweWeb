// Express application: middleware, static assets, and API routers.
// This module intentionally does NOT call app.listen() — see server.js.
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Serve the frontend (moved from app/ to frontend/).
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// Domain routers (handlers live in backend/controllers, wired in backend/routes).
app.use(require('./routes/auth'));
app.use(require('./routes/contact'));
app.use(require('./routes/content'));
app.use(require('./routes/albums'));
app.use(require('./routes/users'));
app.use(require('./routes/shop'));
app.use(require('./routes/backup'));
app.use(require('./routes/config'));
app.use(require('./routes/health'));
app.use(require('./routes/misc'));

module.exports = app;
