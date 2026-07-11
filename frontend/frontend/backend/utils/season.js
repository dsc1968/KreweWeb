
const fs = require('fs');
const { envFilePath, parseEnvFile } = require('./envConfig');

function easterDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function ashWednesdayDate(year) {
  return new Date(easterDate(year).getTime() - 46 * 24 * 60 * 60 * 1000);
}

// Parse the SEASON_END_DATE value from the .env file.
// Returns null (fall back to Ash Wednesday) or one of:
//   { type: 'fixed',    month: 1-12, day: 1-31 }
//   { type: 'relative', ordinal: 1-4 | -1, dow: 0-6, month: 1-12 }
//
// .env format examples:
//   SEASON_END_DATE=fixed:7:15        → July 15 every year
//   SEASON_END_DATE=relative:1:3:7    → 1st Wednesday of July
//   SEASON_END_DATE=relative:-1:5:8   → Last Friday of August
function parseSeasonEndConfig() {
  try {
    const content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const raw = (parseEnvFile(content).SEASON_END_DATE || '').trim();
    if (!raw) return null;
    const parts = raw.split(':');
    if (parts[0] === 'fixed' && parts.length === 3) {
      const month = Number.parseInt(parts[1], 10);
      const day   = Number.parseInt(parts[2], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return { type: 'fixed', month, day };
      }
    }
    if (parts[0] === 'relative' && parts.length === 4) {
      const ordinal = Number.parseInt(parts[1], 10); // 1-4 or -1 (last)
      const dow     = Number.parseInt(parts[2], 10); // 0=Sun … 6=Sat
      const month   = Number.parseInt(parts[3], 10); // 1-12
      if ((ordinal >= 1 && ordinal <= 4 || ordinal === -1) &&
          dow >= 0 && dow <= 6 && month >= 1 && month <= 12) {
        return { type: 'relative', ordinal, dow, month };
      }
    }
  } catch (_) { /* fall through to default */ }
  return null;
}

// Resolve the configured season end date for a specific calendar year.
// Falls back to Ash Wednesday when no SEASON_END_DATE is configured.
function resolveSeasonEndDate(year) {
  const cfg = parseSeasonEndConfig();
  if (!cfg) return ashWednesdayDate(year);
  if (cfg.type === 'fixed') {
    return new Date(Date.UTC(year, cfg.month - 1, cfg.day));
  }
  // relative: Nth DOW of MONTH
  const { ordinal, dow, month } = cfg;
  if (ordinal === -1) {
    // Last occurrence: find last day of month, walk back to the desired DOW
    const lastDay = new Date(Date.UTC(year, month, 0)); // day-0 = last day of month
    const diff = (lastDay.getUTCDay() - dow + 7) % 7;
    return new Date(lastDay.getTime() - diff * 24 * 60 * 60 * 1000);
  }
  // First occurrence of DOW in MONTH, then advance (ordinal-1) weeks
  const first = new Date(Date.UTC(year, month - 1, 1));
  const diff = (dow - first.getUTCDay() + 7) % 7;
  const day = 1 + diff + (ordinal - 1) * 7;
  return new Date(Date.UTC(year, month - 1, day));
}

// The "season year" is the year of the season currently in effect.
// Once the season end date passes, we advance to the next season year so that
// dues/fees paid in the previous season are treated as unpaid.
function currentSeasonYear() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const end = resolveSeasonEndDate(year);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return todayMs >= end.getTime() ? year + 1 : year;
}
function seasonEndISO(year) {
  return resolveSeasonEndDate(year).toISOString().slice(0, 10);
}
function ashWednesdayISO(year) {
  return ashWednesdayDate(year).toISOString().slice(0, 10);
}

// ── Season reset ──────────────────────────────────────────────────────────
// Sets dues_paid, guest_fee_paid, beads_paid, and costume_paid to FALSE for
// all members and records the reset date in site_settings so the scheduler
// does not double-reset if the server restarts on the same day.
async function performSeasonReset() {
  const { pool } = require('../config/db');
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[Season Reset] Running season reset for ${today}`);
  await pool.query(`
    UPDATE user_profiles
    SET dues_paid      = FALSE,
        guest_fee_paid = FALSE,
        updated_at     = NOW()
    WHERE dues_paid = TRUE
       OR guest_fee_paid = TRUE
  `);
  await pool.query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('last_season_reset_date', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [today],
  );
  console.log('[Season Reset] Reset complete.');
}

// Called once daily at UTC midnight. Runs performSeasonReset() only when the
// current calendar date is exactly the configured season-end date. It does NOT
// catch up if the server was offline when that date passed — the reset is
// skipped for that cycle.
async function checkAndRunSeasonReset() {
  const { pool } = require('../config/db');
  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const endDate  = resolveSeasonEndDate(year);
    const todayISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
                       .toISOString().slice(0, 10);
    const endISO   = endDate.toISOString().slice(0, 10);

    // Only reset on the exact season-end date. If the server was offline during
    // the scheduled window and comes back online afterwards, todayISO is past
    // endISO, so we skip rather than catch up.
    if (todayISO !== endISO) return;

    // Check when we last reset to avoid double-resetting
    const result = await pool.query(
      `SELECT value FROM site_settings WHERE key = 'last_season_reset_date'`,
    );
    const lastReset = result.rows.length > 0 ? result.rows[0].value : null;

    // Skip if we already reset on or after this season's end date
    if (lastReset && lastReset >= endISO) return;

    await performSeasonReset();
  } catch (err) {
    console.error('[Season Reset] Scheduled check failed:', err);
  }
}

module.exports = { ashWednesdayDate,ashWednesdayISO,checkAndRunSeasonReset,currentSeasonYear,easterDate,parseSeasonEndConfig,performSeasonReset,resolveSeasonEndDate,seasonEndISO, };
