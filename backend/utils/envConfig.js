const fs = require('fs');
const path = require('path');
const ENV_CONFIG_ALLOWLIST = [
  'REGISTRATION_CODE_TTL_MINUTES',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'SMTP_REPLY_TO',
  'CONTACT_RECIPIENT',
  'PLIVO_AUTH_ID',
  'PLIVO_AUTH_TOKEN',
  'PLIVO_SOURCE_NUMBER',
  'PLIVO_VERIFY_APP_ID',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_MODE',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_MODE',
  'PAYMENT_PROCESSOR',
  'PAYMENT_SIMULATE',
  'PAYPAL_ENABLED',
  'PAYPAL_FEE_PCT',
  'PAYPAL_FEE_FIXED',
  'PAYPAL_FEE_ADD',
  'STRIPE_ENABLED',
  'STRIPE_FEE_PCT',
  'STRIPE_FEE_FIXED',
  'STRIPE_FEE_ADD',
  'ZELLE_ENABLED',
  'ZELLE_EMAIL',
  'ZELLE_PHONE',
  'ZELLE_QR',
  'JOIN_REQUEST_RECIPIENTS',
  'SEASON_END_DATE',
  'APPROVAL_EMAIL_SUBJECT',
  'APPROVAL_EMAIL_BODY',
  'DENIAL_EMAIL_SUBJECT',
  'DENIAL_EMAIL_BODY',
];

// The application's real .env lives at the project root — the same place dotenv
// loads it from at startup. Admin-configurable settings (backup location, SMTP,
// season end date, etc.) must be persisted there so they actually take effect.
const envFilePath = path.resolve(__dirname, '..', '..', '.env');

function parseEnvFile(content) {
  const map = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    map[key] = value.replace(/\\n/g, '\n');
  }
  return map;
}

function serializeEnvFile(originalContent, updates) {
  const lines = originalContent.split('\n');
  const written = new Set();

  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      written.add(key);
      const val = updates[key].replace(/\n/g, '\\n');
      const needsQuotes = val.includes(' ') || val.includes('#') || val.includes('"');
      return `${key}=${needsQuotes ? `"${val.replace(/"/g, '\\"')}"` : val}`;
    }
    return line;
  });

  // Append any keys that weren't already in the file
  for (const key of Object.keys(updates)) {
    if (!written.has(key)) {
      const val = updates[key].replace(/\n/g, '\\n');
      const needsQuotes = val.includes(' ') || val.includes('#') || val.includes('"');
      result.push(`${key}=${needsQuotes ? `"${val.replace(/"/g, '\\"')}"` : val}`);
    }
  }

  return result.join('\n');
}

module.exports = { ENV_CONFIG_ALLOWLIST,envFilePath,parseEnvFile,serializeEnvFile, };
