// RFC 6238 TOTP support (compatible with Google Authenticator, Microsoft

// Authenticator, Authy, 1Password, etc.) plus base32 helpers and otpauth://
// URI building. Implemented with the Node crypto module only — no external
// runtime dependency — so the TOTP math stays self-contained and auditable.
const crypto = require('crypto');

// RFC 4648 base32 alphabet (no padding), which is what authenticator apps
// expect for shared secrets.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input) {
  const clean = String(input)
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[\s]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error('Invalid base32 character: ' + clean[i]);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

// Generates a new cryptographically-random shared secret encoded as base32.
// 20 bytes (160 bits) is the de-facto standard for TOTP authenticator apps.
function randomBase32Secret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

// HMAC-based one-time password (RFC 4226) for a given 64-bit counter.
function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // Write the counter as a big-endian 64-bit integer. JavaScript numbers are
  // safe well past the counters we will ever see for a 30s step.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % Math.pow(10, digits);
  return String(otp).padStart(digits, '0');
}

function totpToken(secretBase32, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const counter = Math.floor(time / 1000 / step);
  return hotp(secretBase32, counter, digits);
}

// Validates a submitted TOTP against the secret, allowing `window` steps of
// clock drift in each direction (default ±1 step = ±30s).
function verifyTotp(secretBase32, token, { step = 30, digits = 6, window = 1 } = {}) {
  const clean = String(token).replace(/\D/g, '');
  if (clean.length !== digits) return false;
  const counter = Math.floor(Date.now() / 1000 / step);
  for (let i = -window; i <= window; i++) {
    if (hotp(secretBase32, counter + i, digits) === clean) return true;
  }
  return false;
}

// Builds the otpauth:// URI that authenticator apps parse from a QR scan.
// `account` is the user identifier (their email) shown under the issuer.
function buildOtpauthUri({ issuer, account, secretBase32, step = 30, digits = 6 }) {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(digits),
    period: String(step),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  BASE32_ALPHABET,
  base32Encode,
  base32Decode,
  randomBase32Secret,
  hotp,
  totpToken,
  verifyTotp,
  buildOtpauthUri,
};
