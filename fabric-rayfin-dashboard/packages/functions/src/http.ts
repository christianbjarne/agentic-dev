/**
 * Small, dependency-free helpers shared by the command-center functions.
 * Nothing here logs tokens, prompts or response bodies.
 */

export const HTTP_TIMEOUT_MS = 45_000;

export class HttpResult {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Headers,
  ) {}

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
}

/** fetch with a hard timeout and tolerant JSON parsing. */
export async function request(
  method: string,
  url: string,
  authorization: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    Authorization: authorization,
    Accept: 'application/json',
    ...extraHeaders,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text.slice(0, 600);
    }
  }
  return new HttpResult(response.status, parsed, response.headers);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown, max = 4000): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A short, safe description of a failed upstream call (never the token). */
export function describeFailure(label: string, result: HttpResult): string {
  const error = asRecord(asRecord(result.body).error);
  const detail =
    str(error.message, 300) ||
    str(asRecord(result.body).message, 300) ||
    (typeof result.body === 'string' ? str(result.body, 300) : '');
  return `${label} failed: HTTP ${result.status}${detail ? ` - ${detail}` : ''}`;
}

/** Decode JWT claims for identity display. The signature is not needed here. */
export function jwtClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    const json = Buffer.from(part, 'base64url').toString('utf8');
    return asRecord(JSON.parse(json) as unknown);
  } catch {
    return {};
  }
}

export function claimString(
  claims: Record<string, unknown>,
  ...names: string[]
): string {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HEX_KEY_PATTERN = /^[0-9a-f]{32}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return nowIso();
}
