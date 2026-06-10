// Shared router plumbing: zod body parsing → 400 envelope, :id param
// validation → 404 envelope, and the AuthedRequest userId accessor.
// Every feature router uses these — single source of truth for the error
// shapes (plan: "Errors: { error: { code, message } }").

import { z } from 'zod';
import type { AuthedRequest } from './auth/middleware.js';
import { HttpError } from './errors.js';

/** Validate a request body; throws the standard 400 validation envelope. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

/**
 * Express 5: an invalid uuid reaching a pg uuid column throws — validate the
 * param up front and map straight to the 404 envelope (not a 500).
 */
export function uuidParam(raw: string, notFoundMessage: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'not_found', notFoundMessage);
  return parsed.data;
}

/**
 * requireAuth (mounted router-wide) guarantees userId; the cast goes via
 * unknown because parameterized Request<{id}> doesn't overlap AuthedRequest.
 */
export function userIdOf(req: unknown): string {
  return (req as AuthedRequest).userId;
}
