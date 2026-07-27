import { env } from 'cloudflare:workers';

/**
 * A deliberately simple fixed-window limit on the parse endpoint.
 *
 * Workers AI is billed in neurons, and this app sits behind Cloudflare Access
 * with a two-address allowlist, so the realistic threat is not an attacker — it
 * is a stuck retry loop or a paste held down on a phone. A fixed window is
 * imprecise at the boundary and that is fine for this.
 */
export const PARSE_LIMIT_PER_HOUR = 10;
const WINDOW_SECONDS = 3600;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets. */
  resetIn: number;
}

export async function checkParseRateLimit(identity: string): Promise<RateLimitResult> {
  const store = env.RATE_LIMIT;
  // If the namespace is missing we allow the request rather than locking the
  // user out of their own tool over a misconfiguration.
  if (!store) return { allowed: true, remaining: PARSE_LIMIT_PER_HOUR, resetIn: 0 };

  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / WINDOW_SECONDS);
  const key = `parse:${identity}:${window}`;
  const resetIn = (window + 1) * WINDOW_SECONDS - now;

  const current = Number((await store.get(key)) ?? '0');

  if (current >= PARSE_LIMIT_PER_HOUR) {
    return { allowed: false, remaining: 0, resetIn };
  }

  await store.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS + 60 });

  return {
    allowed: true,
    remaining: PARSE_LIMIT_PER_HOUR - (current + 1),
    resetIn,
  };
}
