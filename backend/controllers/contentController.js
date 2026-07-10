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

async function get__api_content(req, res) {
  const pagePath = normalizePagePath(req.query.page);
  try {
    const result = await pool.query(
      `SELECT page_path, content_key, content_type, content_value, updated_at
       FROM content_blocks
       WHERE page_path = $1
       ORDER BY updated_at ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch content', error);
    res.status(500).json({ error: 'Unable to fetch content' });
  }
}

async function get__api_page_sections(req, res) {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
      `SELECT id, page_path, title, body, image_path, background_path, position, created_at, updated_at
       FROM page_sections
       WHERE page_path = $1
       ORDER BY position ASC, id ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch page sections', error);
    res.status(500).json({ error: 'Unable to fetch page sections' });
  }
}

async function get__api_element_overrides(req, res) {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
            `SELECT page_path, element_key, hidden, deleted, text_align, font_family, font_weight, font_style, text_transform, font_size, opacity_value, text_color,
              background_color, background_opacity_value, width_value, height_value, border_style, border_width, border_color, border_radius,
              position_mode, pos_x, pos_y, position, updated_at
       FROM element_overrides
       WHERE page_path = $1
       ORDER BY position ASC NULLS LAST, updated_at ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch element overrides', error);
    res.status(500).json({ error: 'Unable to fetch element overrides' });
  }
}

async function put__api_admin_content(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const { contentKey, contentType, contentValue } = req.body;

  if (!contentKey || typeof contentKey !== 'string') {
    return res.status(400).json({ error: 'Content key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  if (typeof contentValue !== 'string') {
    return res.status(400).json({ error: 'Content value is required' });
  }

  const normalizedContentValue = contentValue.trim();

  try {
    const result = await pool.query(
      `INSERT INTO content_blocks (page_path, content_key, content_type, content_value, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (page_path, content_key, content_type)
       DO UPDATE SET content_value = EXCLUDED.content_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
       RETURNING page_path, content_key, content_type, content_value, updated_at`,
      [pagePath, contentKey, contentType, normalizedContentValue, req.user.userId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to save content', error);
    res.status(500).json({ error: 'Unable to save content' });
  }
}

async function delete__api_admin_content(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const { contentKey, contentType } = req.body;

  if (!contentKey || typeof contentKey !== 'string') {
    return res.status(400).json({ error: 'Content key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM content_blocks WHERE page_path = $1 AND content_key = $2 AND content_type = $3 RETURNING page_path, content_key, content_type',
      [pagePath, contentKey, contentType]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    res.json({ deleted: true, item: result.rows[0] });
  } catch (error) {
    console.error('Failed to delete content', error);
    res.status(500).json({ error: 'Unable to delete content' });
  }
}

async function post__api_admin_content_new(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const { parentKey, contentType, contentValue } = req.body;

  if (!parentKey || typeof parentKey !== 'string') {
    return res.status(400).json({ error: 'Parent key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  if (typeof contentValue !== 'string') {
    return res.status(400).json({ error: 'Content value is required' });
  }

  const normalizedContentValue = contentValue.trim();
  if (contentType === 'text' && !normalizedContentValue) {
    return res.status(400).json({ error: 'Content value cannot be empty' });
  }

  try {
    // Generate a unique key for the new element
    const timestamp = Date.now();
    const contentKey = `${parentKey}>dynamic-${contentType}-${timestamp}|${contentType}`;

    const result = await pool.query(
      `INSERT INTO content_blocks (page_path, content_key, content_type, content_value, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       RETURNING page_path, content_key, content_type, content_value, updated_at`,
      [pagePath, contentKey, contentType, normalizedContentValue, req.user.userId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to create new content', error);
    res.status(500).json({ error: 'Unable to create new content' });
  }
}

async function put__api_admin_content_move(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;

  const oldContentKey = typeof req.body.oldContentKey === 'string' ? req.body.oldContentKey.trim() : '';
  const newParentKey = typeof req.body.newParentKey === 'string' ? req.body.newParentKey.trim() : '';
  const contentType = typeof req.body.contentType === 'string' ? req.body.contentType.trim() : '';

  if (!oldContentKey) {
    return res.status(400).json({ error: 'Source content key is required' });
  }

  if (!newParentKey) {
    return res.status(400).json({ error: 'Destination parent key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  const oldKeyParts = oldContentKey.split('>');
  const suffix = oldKeyParts[oldKeyParts.length - 1] || '';
  if (!suffix || !suffix.endsWith(`|${contentType}`)) {
    return res.status(400).json({ error: 'Content key does not match the requested content type' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceResult = await client.query(
      `SELECT page_path, content_key, content_type, content_value, updated_at
       FROM content_blocks
       WHERE page_path = $1 AND content_key = $2 AND content_type = $3
       FOR UPDATE`,
      [pagePath, oldContentKey, contentType]
    );

    if (sourceResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Content not found' });
    }

    let nextContentKey = `${newParentKey}>${suffix}`;
    if (nextContentKey === oldContentKey) {
      await client.query('COMMIT');
      return res.json({ item: sourceResult.rows[0] });
    }

    const conflictCheck = await client.query(
      `SELECT 1
       FROM content_blocks
       WHERE page_path = $1 AND content_key = $2 AND content_type = $3`,
      [pagePath, nextContentKey, contentType]
    );

    if (conflictCheck.rowCount > 0) {
      const timestamp = Date.now();
      nextContentKey = `${newParentKey}>dynamic-${contentType}-${timestamp}|${contentType}`;
    }

    const updateResult = await client.query(
      `UPDATE content_blocks
       SET content_key = $1, updated_at = NOW(), updated_by = $2
       WHERE page_path = $3 AND content_key = $4 AND content_type = $5
       RETURNING page_path, content_key, content_type, content_value, updated_at`,
      [nextContentKey, req.user.userId, pagePath, oldContentKey, contentType]
    );

    await client.query(
      `UPDATE element_overrides
       SET element_key = $1, updated_at = NOW(), updated_by = $2
       WHERE page_path = $3 AND element_key = $4`,
      [nextContentKey, req.user.userId, pagePath, oldContentKey]
    );

    await client.query('COMMIT');
    res.json({ item: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to move content', error);
    res.status(500).json({ error: 'Unable to move content' });
  } finally {
    client.release();
  }
}

async function post__api_admin_page_sections(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';

  try {
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM page_sections WHERE page_path = $1',
      [pagePath]
    );
    const nextPosition = positionResult.rows[0].next_position;

    const result = await pool.query(
      `INSERT INTO page_sections (page_path, title, body, image_path, background_path, position, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, page_path, title, body, image_path, background_path, position, created_at, updated_at`,
      [
        pagePath,
        title,
        body,
        '',
        null,
        nextPosition,
        req.user.userId,
      ]
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to create page section', error);
    res.status(500).json({ error: 'Unable to create page section' });
  }
}

async function put__api_admin_element_overrides(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const elementKey = typeof req.body.elementKey === 'string' ? req.body.elementKey.trim() : '';
  if (!elementKey) {
    return res.status(400).json({ error: 'Element key is required' });
  }

  const hidden = Boolean(req.body.hidden);
  const deleted = Boolean(req.body.deleted);
  const textAlign = typeof req.body.textAlign === 'string' && req.body.textAlign ? req.body.textAlign : null;
  const fontFamily = typeof req.body.fontFamily === 'string' && req.body.fontFamily.trim() ? req.body.fontFamily.trim() : null;
  const fontWeight = typeof req.body.fontWeight === 'string' && req.body.fontWeight ? req.body.fontWeight : null;
  const fontStyle = typeof req.body.fontStyle === 'string' && req.body.fontStyle ? req.body.fontStyle : null;
  const textTransform = typeof req.body.textTransform === 'string' && req.body.textTransform ? req.body.textTransform : null;
  const fontSize = normalizeLengthValue(req.body.fontSize);
  const opacityValue = normalizeOpacityValue(req.body.opacityValue);
  const textColor = normalizeHexColor(req.body.textColor);
  const backgroundColor = normalizeHexColor(req.body.backgroundColor);
  const backgroundOpacityValue = normalizeOpacityValue(req.body.backgroundOpacityValue);
  const widthValue = normalizeLengthValue(req.body.widthValue);
  const heightValue = normalizeLengthValue(req.body.heightValue);
  const borderStyle = normalizeBorderStyle(req.body.borderStyle);
  const borderWidth = normalizeLengthValue(req.body.borderWidth);
  const borderColor = normalizeHexColor(req.body.borderColor);
  const borderRadius = normalizeLengthValue(req.body.borderRadius);
  const positionMode = normalizePositionMode(req.body.positionMode);
  const posX = normalizeCoordinate(req.body.posX);
  const posY = normalizeCoordinate(req.body.posY);
  const position = Number.isInteger(req.body.position) ? req.body.position : null;

  try {
    const result = await pool.query(
      `INSERT INTO element_overrides (
        page_path, element_key, hidden, deleted, text_align, font_family, font_weight, font_style, text_transform, font_size, opacity_value, text_color,
        background_color, background_opacity_value, width_value, height_value, border_style, border_width, border_color, border_radius,
        position_mode, pos_x, pos_y, position, updated_at, updated_by
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), $25)
       ON CONFLICT (page_path, element_key)
       DO UPDATE SET
         hidden = EXCLUDED.hidden,
         deleted = EXCLUDED.deleted,
         text_align = EXCLUDED.text_align,
         font_family = EXCLUDED.font_family,
         font_weight = EXCLUDED.font_weight,
         font_style = EXCLUDED.font_style,
         text_transform = EXCLUDED.text_transform,
         font_size = EXCLUDED.font_size,
         opacity_value = EXCLUDED.opacity_value,
         text_color = EXCLUDED.text_color,
         background_color = EXCLUDED.background_color,
         background_opacity_value = EXCLUDED.background_opacity_value,
         width_value = EXCLUDED.width_value,
         height_value = EXCLUDED.height_value,
         border_style = EXCLUDED.border_style,
         border_width = EXCLUDED.border_width,
         border_color = EXCLUDED.border_color,
         border_radius = EXCLUDED.border_radius,
         position_mode = EXCLUDED.position_mode,
         pos_x = EXCLUDED.pos_x,
         pos_y = EXCLUDED.pos_y,
         position = EXCLUDED.position,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
      RETURNING page_path, element_key, hidden, deleted, text_align, font_family, font_weight, font_style, text_transform, font_size, opacity_value, text_color,
             background_color, background_opacity_value, width_value, height_value, border_style, border_width, border_color, border_radius,
                 position_mode, pos_x, pos_y, position, updated_at`,
      [
        pagePath,
        elementKey,
        hidden,
        deleted,
        textAlign,
        fontFamily,
        fontWeight,
        fontStyle,
        textTransform,
        fontSize,
        opacityValue,
        textColor,
        backgroundColor,
        backgroundOpacityValue,
        widthValue,
        heightValue,
        borderStyle,
        borderWidth,
        borderColor,
        borderRadius,
        positionMode,
        posX,
        posY,
        position,
        req.user.userId,
      ]
    );
    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to save element override', error);
    res.status(500).json({ error: 'Unable to save element override' });
  }
}

async function put__api_admin_page_sections__sectionId___d__(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const sectionId = Number.parseInt(req.params.sectionId, 10);
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return res.status(400).json({ error: 'Valid section id is required' });
  }

  const allowedFields = new Map([
    ['title', 'title'],
    ['body', 'body'],
    ['image_path', 'image_path'],
    ['background_path', 'background_path'],
  ]);

  const field = allowedFields.get(req.body.field);
  const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';

  if (!field) {
    return res.status(400).json({ error: 'Unsupported section field' });
  }

  // Empty string is allowed for title/body so editor delete can clear those fields.

  // image_path is NOT NULL in the schema; keep empty string when clearing image.
  const persistedValue = field === 'background_path' ? (value || null) : value;

  try {
    const sectionLookup = await pool.query('SELECT page_path FROM page_sections WHERE id = $1', [sectionId]);
    if (sectionLookup.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (!validateEditablePagePath(res, normalizePagePath(sectionLookup.rows[0].page_path))) return;

    const result = await pool.query(
      `UPDATE page_sections
       SET ${field} = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, page_path, title, body, image_path, background_path, position, created_at, updated_at`,
      [persistedValue, sectionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to update page section', error);
    res.status(500).json({ error: 'Unable to update page section' });
  }
}

async function delete__api_admin_page_sections__sectionId___d__(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const sectionId = Number.parseInt(req.params.sectionId, 10);
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return res.status(400).json({ error: 'Valid section id is required' });
  }

  try {
    const sectionLookup = await pool.query('SELECT page_path FROM page_sections WHERE id = $1', [sectionId]);
    if (sectionLookup.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (!validateEditablePagePath(res, normalizePagePath(sectionLookup.rows[0].page_path))) return;

    const result = await pool.query('DELETE FROM page_sections WHERE id = $1 RETURNING id', [sectionId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ deleted: true, id: sectionId });
  } catch (error) {
    console.error('Failed to delete page section', error);
    res.status(500).json({ error: 'Unable to delete page section' });
  }
}

async function put__api_admin_page_sections_reorder(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
  const cleanIds = orderedIds
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (cleanIds.length === 0) {
    return res.status(400).json({ error: 'Ordered section ids are required' });
  }

  const client = await pool.connect();
  try {
    const pagePathLookup = await client.query(
      'SELECT DISTINCT page_path FROM page_sections WHERE id = ANY($1::int[])',
      [cleanIds]
    );
    const blocked = pagePathLookup.rows.some((row) => !isAdminEditablePagePath(normalizePagePath(row.page_path)));
    if (blocked) {
      return res.status(403).json({ error: 'Editing is disabled for one or more selected pages' });
    }

    await client.query('BEGIN');
    for (let index = 0; index < cleanIds.length; index += 1) {
      await client.query('UPDATE page_sections SET position = $1, updated_at = NOW() WHERE id = $2', [index + 1, cleanIds[index]]);
    }
    await client.query('COMMIT');
    res.json({ updated: true, orderedIds: cleanIds });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to reorder page sections', error);
    res.status(500).json({ error: 'Unable to reorder page sections' });
  } finally {
    client.release();
  }
}
module.exports = { delete__api_admin_content,delete__api_admin_page_sections__sectionId___d__,get__api_content,get__api_element_overrides,get__api_page_sections,post__api_admin_content_new,post__api_admin_page_sections,put__api_admin_content,put__api_admin_content_move,put__api_admin_element_overrides,put__api_admin_page_sections_reorder,put__api_admin_page_sections__sectionId___d__, };
