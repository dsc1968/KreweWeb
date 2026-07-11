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

async function post__api_contact(req, res) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = normalizeEmailAddress(req.body?.email);
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
  }

  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (!isValidEmailAddress(CONTACT_RECIPIENT)) {
    return res.status(500).json({ error: 'Contact recipient is not configured correctly.' });
  }

  const normalizedSubject = subject.replace(/\s+/g, ' ').slice(0, 120);
  const normalizedMessage = message.slice(0, 5000);

  const textBody = [
    'New contact form submission',
    '',
    `From: ${name} <${email}>`,
    `Subject: ${normalizedSubject}`,
    '',
    normalizedMessage,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827;">
      <h2 style="margin-bottom: 0.75rem;">New contact form submission</h2>
      <p style="margin: 0.25rem 0;"><strong>From:</strong> ${name} &lt;${email}&gt;</p>
      <p style="margin: 0.25rem 0;"><strong>Subject:</strong> ${normalizedSubject}</p>
      <hr style="margin: 1rem 0; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="white-space: pre-wrap; margin: 0;">${normalizedMessage.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))}</p>
    </div>
  `;

  try {
    if (!smtpTransport) {
      return res.status(503).json({ error: 'Email delivery is not configured. Set SMTP settings first.' });
    }

    await smtpTransport.sendMail({
      from: SMTP_FROM,
      to: CONTACT_RECIPIENT,
      subject: `[Contact] ${normalizedSubject}`,
      text: textBody,
      html: htmlBody,
      replyTo: email,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to send contact form email', error);
    res.status(500).json({ error: 'Unable to send your message right now.' });
  }
}
module.exports = { post__api_contact, };
