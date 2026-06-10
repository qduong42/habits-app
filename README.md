# Habits App

Mobile-first gamified habit tracker PWA. (Full README lands with Task 22 —
this file currently only documents push setup, because `.env*` files cannot
be written by the agent harness.)

## Push setup

Web push (the daily nudge) is **optional**: without VAPID keys the server
boots normally, logs one warning, push routes answer
`503 {error: {code: 'push_disabled'}}`, and the scheduler's sends no-op.

1. Generate a VAPID key pair:

   ```sh
   npx web-push generate-vapid-keys
   ```

2. Put the keys in the server's environment (e.g. your `.env`):

   ```sh
   VAPID_PUBLIC_KEY=<Public Key from step 1>
   VAPID_PRIVATE_KEY=<Private Key from step 1>
   # optional; identifies the sender to push services
   VAPID_SUBJECT=mailto:admin@example.com
   ```

3. Restart the server, open Profile → Notifications in the app (production
   build — the service worker is only registered in `PROD`), and tap
   "Enable notifications". The daily nudge fires at your configured nudge
   time, in your configured timezone.

Note: browsers require HTTPS (or localhost) for service workers and push.
