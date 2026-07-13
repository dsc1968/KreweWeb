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


// Normalise a phone number to E.164 so carrier/SMS gateways (Textedly, Twilio,
// etc.) can route it. Strips formatting, keeps an existing '+', and assumes
// US/Canada (+1) when a 10-digit local number is supplied.
function normalizePhoneToE164(raw) {
  if (!raw) return raw;
  const withPlus = String(raw).trim();
  if (withPlus.startsWith('+')) {
    return '+' + withPlus.replace(/\D/g, '');
  }
  const digits = withPlus.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

// Sends an MFA sign-in code. Email is fully implemented; SMS is dispatched by
// POSTing { phoneNumber, message } to a configurable webhook (e.g. a Zapier
// Catch Hook wired to Textedly, or any provider). Falls back to a development
// log of the code when no webhook is configured.
async function dispatchMfaCode(method, target, code) {
  if (method === 'sms') {
    const phoneNumber = normalizePhoneToE164(target);
    const webhookUrl = process.env.SMS_WEBHOOK_URL || process.env.TEXTEDLY_WEBHOOK_URL;
    const message = `Your Krewe Mystique verification code is ${code}. It expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.`;

    if (webhookUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber, message }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '');
          throw new Error(`gateway responded ${resp.status}: ${detail.slice(0, 200)}`);
        }
        return { delivered: true, method: 'sms' };
      } catch (err) {
        if (process.env.NODE_ENV === 'production') {
          const error = new Error('SMS delivery failed: ' + err.message);
          error.statusCode = 502;
          throw error;
        }
        console.warn(`[mfa] SMS gateway error (${err.message}); dev fallback for ${String(phoneNumber || '').replace(/\D/g, '').slice(-4).padStart(4, '*')}: ${code}`);
        return { delivered: false, method: 'sms', notice: 'SMS gateway unavailable; using development fallback code.', devCode: code };
      }
    }

    // No webhook configured
    if (process.env.NODE_ENV === 'production') {
      const error = new Error('SMS delivery is not configured. Set SMS_WEBHOOK_URL in admin settings (MFA → SMS Gateway).');
      error.statusCode = 503;
      throw error;
    }
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    const masked = digits.length >= 4 ? `***-***-${digits.slice(-4)}` : 'your phone';
    console.warn(`[mfa] SMS not configured; dev fallback code for ${masked}: ${code}`);
    return {
      delivered: false,
      method: 'sms',
      notice: 'SMS delivery is not yet configured. The code is shown in the server log (development mode).',
      devCode: code,
    };
  }

  const emailSubject = 'Your Krewe Mystique login code';
  const emailText = [
    'Your login verification code is below.',
    '',
    `Code: ${code}`,
    '',
    `This code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.`,
    'If you did not request this code, you can ignore this message.',
  ].join('\n');
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h2 style="margin-bottom: 0.5rem;">Krewe Mystique verification</h2>
      <p>Your login verification code is:</p>
      <p style="font-size: 2rem; font-weight: 700; letter-spacing: 0.2rem; margin: 1rem 0;">${code}</p>
      <p>This code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.</p>
      <p>If you did not request this code, you can ignore this message.</p>
    </div>
  `;

  if (smtpTransport) {
    await sendVerificationMail({ to: target, subject: emailSubject, text: emailText, html: emailHtml });
    return { delivered: true, method: 'email' };
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info(`[mfa] email code for ${target}: ${code}`);
    return { delivered: false, method: 'email', devCode: code };
  }

  const error = new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.');
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
  dispatchMfaCode,
};
