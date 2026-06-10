import { createApp } from './app.js';
import { scheduleAllNudges } from './push/scheduler.js';

const PORT = Number(process.env.PORT ?? 3001);

createApp().listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});

// Daily nudge jobs (spec "Daily Nudge Flow"). Must never block or kill the
// boot — with VAPID keys missing the scheduler still runs and sendNudge
// no-ops with a warning (Rule 10).
scheduleAllNudges().catch((err) => {
  console.error('[push] scheduling nudges on boot failed', err);
});
