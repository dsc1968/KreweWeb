const fs = require('fs');
const path = require('path');
const multer = require('multer');
const appDir = path.join(__dirname, '..', 'frontend');
const fileBackupsDir = path.join(__dirname, '..', '_file_backups');
const imagesDir = path.join(__dirname, '..', 'frontend', 'assets', 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, imagesDir);
  },
  filename: function (req, file, cb) {
    // sanitize filename
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    // if target provided, use it
    const target = req.body.target;
    if (target) {
      const t = path.basename(target).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, t);
    } else {
      const name = Date.now() + '_' + safeName;
      cb(null, name);
    }
  }
});
const upload = multer({ storage });

function listImagesInDirectory(baseDir, currentDir = baseDir, files = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      listImagesInDirectory(baseDir, fullPath, files);
      return;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extension)) return;
    const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
    files.push(`/assets/images/${relativePath}`);
  });
  return files;
}


function resolveEditableFilePath(requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') return null;
  const ext = path.extname(requestedPath).toLowerCase();
  if (!['.html', '.css'].includes(ext)) return null;
  const relative = requestedPath.startsWith('/') ? requestedPath.slice(1) : requestedPath;
  const resolved = path.resolve(appDir, relative);
  // Must remain inside the app/ directory
  if (!resolved.startsWith(appDir + path.sep) && resolved !== appDir) return null;
  return resolved;
}

module.exports = { appDir,fileBackupsDir,imagesDir,listImagesInDirectory,resolveEditableFilePath,storage,upload, };
