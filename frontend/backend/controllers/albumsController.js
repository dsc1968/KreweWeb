const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager } = require('../utils/validation');
const { smtpTransport, normalizeEmailAddress, isValidEmailAddress, generateVerificationCode, maskVerificationTarget, sendVerificationMail, dispatchVerificationCode } = require('../utils/email');
const { appDir, fileBackupsDir, imagesDir, listImagesInDirectory, resolveEditableFilePath, storage, upload } = require('../utils/files');
const { ashWednesdayDate, ashWednesdayISO, checkAndRunSeasonReset, currentSeasonYear, easterDate, parseSeasonEndConfig, performSeasonReset, resolveSeasonEndDate, seasonEndISO } = require('../utils/season');
const { ENV_CONFIG_ALLOWLIST, envFilePath, parseEnvFile, serializeEnvFile } = require('../utils/envConfig');
const { appDir: _bAppDir, BACKUP_CONFIG_KEYS, backupIdSafe, collectBackupAppFiles, DB_TABLES_INSERT_ORDER, execFileAsync, extractZip, fileBackupsDir: _bFb, isSafeColumnName, isSafeRclonePath, listLocalBackupsFromDir, listRcloneBackupManifests, listS3BackupManifests, makeS3Client, rcloneDeleteFile, rcloneDownloadFile, rcloneListFiles, rcloneRun, rcloneUploadFile, readBackupConfig, removeDir, zipDirectory } = require('../utils/backup');

async function get__api_albums(req, res) {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
      `SELECT
        a.id,
        a.page_path,
        a.title,
        a.description,
        COALESCE(a.cover_image_path, MIN(i.image_path)) AS cover_image_path,
        a.position,
        a.created_at,
        a.updated_at,
        COUNT(i.id)::INTEGER AS image_count
      FROM photo_albums a
      LEFT JOIN album_images i ON i.album_id = a.id
      WHERE a.page_path = $1
      GROUP BY a.id
      ORDER BY a.position ASC, a.id ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch albums', error);
    res.status(500).json({ error: 'Unable to fetch albums' });
  }
}

async function get__api_albums__albumId_images(req, res) {
  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, album_id, image_path, caption, position, created_at, updated_at
      FROM album_images
      WHERE album_id = $1
      ORDER BY position ASC, id ASC`,
      [albumId]
    );
    res.json({ albumId, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch album images', error);
    res.status(500).json({ error: 'Unable to fetch album images' });
  }
}

async function post__api_admin_albums(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const coverImagePath = typeof req.body.coverImagePath === 'string' ? req.body.coverImagePath.trim() : '';

  if (!title) {
    return res.status(400).json({ error: 'Album title is required' });
  }

  try {
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM photo_albums WHERE page_path = $1',
      [pagePath]
    );
    const nextPosition = positionResult.rows[0].next_position;

    const result = await pool.query(
      `INSERT INTO photo_albums (page_path, title, description, cover_image_path, position, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, page_path, title, description, cover_image_path, position, created_at, updated_at`,
      [pagePath, title, description || null, coverImagePath || null, nextPosition, req.user.userId]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to create album', error);
    res.status(500).json({ error: 'Unable to create album' });
  }
}

async function put__api_admin_albums__albumId___d__(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const coverImagePath = typeof req.body.coverImagePath === 'string' ? req.body.coverImagePath.trim() : '';
  const position = Number.isInteger(req.body.position) ? req.body.position : null;

  if (!title) {
    return res.status(400).json({ error: 'Album title is required' });
  }

  try {
    const lookup = await pool.query('SELECT page_path, position FROM photo_albums WHERE id = $1', [albumId]);
    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(lookup.rows[0].page_path);
    if (!validateEditablePagePath(res, pagePath)) return;

    const result = await pool.query(
      `UPDATE photo_albums
      SET title = $1,
          description = $2,
          cover_image_path = $3,
          position = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, page_path, title, description, cover_image_path, position, created_at, updated_at`,
      [title, description || null, coverImagePath || null, position || lookup.rows[0].position, albumId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to update album', error);
    res.status(500).json({ error: 'Unable to update album' });
  }
}

async function delete__api_admin_albums__albumId___d__(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  try {
    const lookup = await pool.query('SELECT page_path FROM photo_albums WHERE id = $1', [albumId]);
    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(lookup.rows[0].page_path);
    if (!validateEditablePagePath(res, pagePath)) return;

    await pool.query('DELETE FROM photo_albums WHERE id = $1', [albumId]);
    res.json({ deleted: true, id: albumId });
  } catch (error) {
    console.error('Failed to delete album', error);
    res.status(500).json({ error: 'Unable to delete album' });
  }
}

async function post__api_admin_albums__albumId___d___images(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  const imagePath = typeof req.body.imagePath === 'string' ? req.body.imagePath.trim() : '';
  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
  const setAsCover = Boolean(req.body.setAsCover);

  if (!imagePath) {
    return res.status(400).json({ error: 'Image path is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const albumLookup = await client.query(
      'SELECT page_path, cover_image_path FROM photo_albums WHERE id = $1 FOR UPDATE',
      [albumId]
    );
    if (albumLookup.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(albumLookup.rows[0].page_path);
    if (!isAdminEditablePagePath(pagePath)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Editing is disabled for this page' });
    }

    const positionResult = await client.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM album_images WHERE album_id = $1',
      [albumId]
    );
    const nextPosition = positionResult.rows[0].next_position;

    const imageResult = await client.query(
      `INSERT INTO album_images (album_id, image_path, caption, position, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, album_id, image_path, caption, position, created_at, updated_at`,
      [albumId, imagePath, caption || null, nextPosition, req.user.userId]
    );

    if (setAsCover || !albumLookup.rows[0].cover_image_path) {
      await client.query('UPDATE photo_albums SET cover_image_path = $1, updated_at = NOW() WHERE id = $2', [imagePath, albumId]);
    }

    await client.query('COMMIT');
    res.status(201).json({ item: imageResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create album image', error);
    res.status(500).json({ error: 'Unable to create album image' });
  } finally {
    client.release();
  }
}

async function put__api_admin_albums__albumId___d___images__imageId___d__(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  const imageId = Number.parseInt(req.params.imageId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
    return res.status(400).json({ error: 'Valid album and image ids are required' });
  }

  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : null;
  const imagePath = typeof req.body.imagePath === 'string' ? req.body.imagePath.trim() : null;
  const setAsCover = Boolean(req.body.setAsCover);
  const position = Number.isInteger(req.body.position) ? req.body.position : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const albumLookup = await client.query('SELECT page_path FROM photo_albums WHERE id = $1 FOR UPDATE', [albumId]);
    if (albumLookup.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(albumLookup.rows[0].page_path);
    if (!isAdminEditablePagePath(pagePath)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Editing is disabled for this page' });
    }

    const current = await client.query('SELECT image_path, caption, position FROM album_images WHERE id = $1 AND album_id = $2', [imageId, albumId]);
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Image not found' });
    }

    const nextImagePath = imagePath !== null ? imagePath : current.rows[0].image_path;
    const nextCaption = caption !== null ? caption : current.rows[0].caption;
    const nextPosition = position || current.rows[0].position;

    const result = await client.query(
      `UPDATE album_images
      SET image_path = $1, caption = $2, position = $3, updated_at = NOW()
      WHERE id = $4 AND album_id = $5
      RETURNING id, album_id, image_path, caption, position, created_at, updated_at`,
      [nextImagePath, nextCaption, nextPosition, imageId, albumId]
    );

    if (setAsCover) {
      await client.query('UPDATE photo_albums SET cover_image_path = $1, updated_at = NOW() WHERE id = $2', [nextImagePath, albumId]);
    }

    await client.query('COMMIT');
    res.json({ item: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update album image', error);
    res.status(500).json({ error: 'Unable to update album image' });
  } finally {
    client.release();
  }
}

async function delete__api_admin_albums__albumId___d___images__imageId___d__(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  const imageId = Number.parseInt(req.params.imageId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
    return res.status(400).json({ error: 'Valid album and image ids are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const albumLookup = await client.query('SELECT page_path, cover_image_path FROM photo_albums WHERE id = $1 FOR UPDATE', [albumId]);
    if (albumLookup.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(albumLookup.rows[0].page_path);
    if (!isAdminEditablePagePath(pagePath)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Editing is disabled for this page' });
    }

    const deleted = await client.query(
      'DELETE FROM album_images WHERE id = $1 AND album_id = $2 RETURNING image_path',
      [imageId, albumId]
    );
    if (deleted.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Image not found' });
    }

    if (albumLookup.rows[0].cover_image_path === deleted.rows[0].image_path) {
      const nextCover = await client.query(
        'SELECT image_path FROM album_images WHERE album_id = $1 ORDER BY position ASC, id ASC LIMIT 1',
        [albumId]
      );
      await client.query(
        'UPDATE photo_albums SET cover_image_path = $1, updated_at = NOW() WHERE id = $2',
        [nextCover.rowCount ? nextCover.rows[0].image_path : null, albumId]
      );
    }

    await client.query('COMMIT');
    res.json({ deleted: true, id: imageId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete album image', error);
    res.status(500).json({ error: 'Unable to delete album image' });
  } finally {
    client.release();
  }
}
async function handleAlbumReorder(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;

  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
  const cleanIds = orderedIds
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (cleanIds.length === 0) {
    return res.status(400).json({ error: 'Ordered album ids are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await client.query(
      'SELECT id FROM photo_albums WHERE page_path = $1 AND id = ANY($2::int[])',
      [pagePath, cleanIds]
    );
    if (ownership.rowCount !== cleanIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Album list contains invalid ids for this page' });
    }

    for (let index = 0; index < cleanIds.length; index += 1) {
      await client.query(
        'UPDATE photo_albums SET position = $1, updated_at = NOW() WHERE id = $2',
        [index + 1, cleanIds[index]]
      );
    }

    await client.query('COMMIT');
    res.json({ updated: true, orderedIds: cleanIds });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to reorder albums', error);
    res.status(500).json({ error: 'Unable to reorder albums' });
  } finally {
    client.release();
  }
}
module.exports = { delete__api_admin_albums__albumId___d__,delete__api_admin_albums__albumId___d___images__imageId___d__,get__api_albums,get__api_albums__albumId_images,handleAlbumReorder,post__api_admin_albums,post__api_admin_albums__albumId___d___images,put__api_admin_albums__albumId___d__,put__api_admin_albums__albumId___d___images__imageId___d__, };
