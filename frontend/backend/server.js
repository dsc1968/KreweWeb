// Entry point: ensure DB schema, schedule the daily season reset, then start listening.
const app = require('./app');
const { ensureContentTable } = require('./config/db');
const { checkAndRunSeasonReset } = require('./utils/season');
const { runScheduledBackupTick } = require('./utils/backup');

const port = process.env.PORT || 8000;

ensureContentTable()
  .then(async () => {
    // Schedule the season reset to run daily at UTC midnight. checkAndRunSeasonReset
    // only fires on the exact season-end date and never catches up, so an outage
    // during the scheduled window means the reset is skipped rather than replayed.
    const nextMidnight = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1,
    );
    setTimeout(() => {
      checkAndRunSeasonReset();
      setInterval(checkAndRunSeasonReset, 24 * 60 * 60 * 1000);
    }, nextMidnight - Date.now());

    // Evaluate the configured automatic-backup schedule once per minute. A missed
    // window is skipped (never replayed), consistent with the season reset.
    const startMinuteTicks = (fn) => {
      const delay = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
      setTimeout(function tick() {
        try { fn(); } catch (e) { console.error('[Scheduled Backup] tick error', e); }
        setTimeout(tick, 60 * 1000);
      }, delay);
    };
    startMinuteTicks(runScheduledBackupTick);

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database tables', err);
    process.exit(1);
  });
