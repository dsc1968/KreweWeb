// Entry point: ensure DB schema, run any due season reset, then start listening.
const app = require('./app');
const { ensureContentTable } = require('./config/db');
const { checkAndRunSeasonReset } = require('./utils/season');

const port = process.env.PORT || 8000;

ensureContentTable()
  .then(async () => {
    // Catch up if the server was offline on the scheduled reset date.
    await checkAndRunSeasonReset();

    // Schedule the next check at UTC midnight, then every 24 hours.
    const nowMs = Date.now();
    const nextMidnight = (() => {
      const d = new Date();
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    })();
    setTimeout(() => {
      checkAndRunSeasonReset();
      setInterval(checkAndRunSeasonReset, 24 * 60 * 60 * 1000);
    }, nextMidnight - nowMs);

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database tables', err);
    process.exit(1);
  });
