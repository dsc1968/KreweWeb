// Email/SMTP transport + verification mail helpers (copied verbatim from server.js).
const nodemailer = require('nodemailer');
const {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO,
  REGISTRATION_CODE_TTL_MINUTES,
} = require('../config/db');

const smtpTransport = SMTP_HOST && SMTP_PORT && SMTP_FROM
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER || SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;
function normalizeEmailAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskVerificationTarget(target) {
  const [localPart = '', domain = ''] = target.split('@');
  const maskedLocal = localPart.length <= 2 ? `${localPart.charAt(0) || ''}*` : `${localPart.slice(0, 2)}***`;
  return domain ? `${maskedLocal}@${domain}` : 'your email';
}

async function sendVerificationMail({ to, subject, text, html }) {
  if (!smtpTransport) {
    const error = new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.');
    error.statusCode = 503;
    throw error;
  }

  await smtpTransport.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
    html,
    replyTo: SMTP_REPLY_TO || undefined,
  });
}

async function dispatchVerificationCode(target, code) {
  const emailSubject = 'Your Krewe Mystique verification code';
  const emailText = [
    'Your verification code is below.',
    '',
    `Code: ${code}`,
    '',
    `This code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.`,
    'If you did not request this code, you can ignore this message.',
  ].join('\n');
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h2 style="margin-bottom: 0.5rem;">Krewe Mystique verification</h2>
      <p>Your verification code is:</p>
      <p style="font-size: 2rem; font-weight: 700; letter-spacing: 0.2rem; margin: 1rem 0;">${code}</p>
      <p>This code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.</p>
      <p>If you did not request this code, you can ignore this message.</p>
    </div>
  `;

  if (smtpTransport) {
    await sendVerificationMail({
      to: target,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    });
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info(`[registration-verification] email code for ${target}: ${code}`);
    return;
  }

  const error = new Error('Email verification is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.');
  error.statusCode = 503;
  throw error;
}


module.exports = {
  smtpTransport,
  normalizeEmailAddress,
  isValidEmailAddress,
  generateVerificationCode,
  maskVerificationTarget,
  sendVerificationMail,
  dispatchVerificationCode,
};
