// API client for the habits server. All endpoints live under /api and speak
// JSON; errors arrive as { error: { code, message } } envelopes.

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    let code = 'unknown';
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body — keep the fallback code/message.
    }
    if (res.status === 401 && code === 'unauthenticated') {
      // Session expired or missing: send the user to the login screen.
      // Hash routing means this works without any server-side route config.
      // Other 401 codes (invalid_credentials, wrong_password) are form-level
      // errors on an authenticated/login page — those render inline instead.
      location.hash = '#/login';
    }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
