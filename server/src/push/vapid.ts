/**
 * VAPID configuration from the environment. The keys are OPTIONAL on purpose
 * (Rule 10: agents cannot write .env files): when they are absent the server
 * still boots — push features are disabled with a single console.warn, the
 * vapid-public-key route answers 503 `push_disabled`, and sendNudge no-ops.
 *
 * Generate a key pair with `npx web-push generate-vapid-keys` and set
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (and optionally VAPID_SUBJECT).
 * See the "Push setup" section of the README.
 */

import webpush from 'web-push';

export const DEFAULT_VAPID_SUBJECT = 'mailto:admin@example.com';

let warned = false;

/**
 * The VAPID public key, or null when push is disabled. Read from env on every
 * call (not at module load) so tests and late-loaded environments work; the
 * missing-keys warning fires only once.
 */
export function vapidPublicKey(): string | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) return publicKey;
  if (!warned) {
    warned = true;
    console.warn(
      '[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — web push disabled. ' +
        'Generate keys with `npx web-push generate-vapid-keys`.',
    );
  }
  return null;
}

export function pushEnabled(): boolean {
  return vapidPublicKey() !== null;
}

let configuredFor: string | null = null;

/**
 * The real web-push module with VAPID details applied. Only call when
 * pushEnabled() — setVapidDetails validates the key material and throws on
 * garbage, which must never take the boot path down.
 */
export function configuredWebpush(): typeof webpush {
  const publicKey = process.env.VAPID_PUBLIC_KEY!;
  if (configuredFor !== publicKey) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT,
      publicKey,
      process.env.VAPID_PRIVATE_KEY!,
    );
    configuredFor = publicKey;
  }
  return webpush;
}
