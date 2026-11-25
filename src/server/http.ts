import { config } from "./config";

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * Operator endpoints. With OPERATOR_TOKEN set (any public deployment), requests need
 * `Authorization: Bearer <token>` or the `operator_token` cookie set by /dashboard?token=.
 * Without it (local demo) the console is open.
 */
export function isOperator(request: Request): boolean {
  if (!config.operatorToken) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${config.operatorToken}`) return true;
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(/;\s*/).some((c) => c === `operator_token=${encodeURIComponent(config.operatorToken)}`);
}

/** Fixed-window limiter per client key. In-memory: good enough for one demo instance. */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimited(key: string, limit = 20, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || now - entry.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

export function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
