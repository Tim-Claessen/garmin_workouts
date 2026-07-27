import { z } from 'zod';

/**
 * Who a workout can be sent to.
 *
 * Athletes live in a single JSON secret, `ICU_ATHLETES`. One secret rather than a
 * pair of bindings per person means adding someone is one `wrangler secret put`
 * and no code change, and it keeps the "no database" decision intact — there is
 * nothing to store because the roster is configuration.
 *
 * The API key never leaves the Worker. The client is given ids and labels only,
 * and sends an id back; credentials are resolved here, server-side.
 */

export const athleteSchema = z.object({
  /** Stable slug used in requests. Not shown to anyone. */
  id: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  /** What appears in the picker. */
  label: z.string().min(1).max(40),
  /** Intervals.icu athlete ID, including the leading "i". */
  athleteId: z.string().min(2).max(40),
  apiKey: z.string().min(8),
});

export type Athlete = z.infer<typeof athleteSchema>;

export const athleteRosterSchema = z.array(athleteSchema).min(1);

/** Safe to send to the browser: no credentials. */
export interface PublicAthlete {
  id: string;
  label: string;
}

export function toPublic(athlete: Athlete): PublicAthlete {
  return { id: athlete.id, label: athlete.label };
}

export interface RosterSource {
  /** JSON array, the preferred form. */
  athletesJson?: string;
  /** Legacy single-athlete bindings, kept working so nothing breaks. */
  athleteId?: string;
  apiKey?: string;
}

export type RosterResult =
  | { ok: true; athletes: Athlete[] }
  | { ok: false; reason: 'none_configured' | 'invalid_json' | 'invalid_shape' };

/**
 * Reads the roster, preferring ICU_ATHLETES and falling back to the original
 * single-athlete bindings. Pure so that it can be tested without the runtime —
 * a misconfigured roster is the difference between sending a workout to the
 * right person and the wrong one.
 */
export function readRoster(source: RosterSource): RosterResult {
  const raw = source.athletesJson?.trim();

  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }

    const result = athleteRosterSchema.safeParse(parsed);
    if (!result.success) return { ok: false, reason: 'invalid_shape' };

    // Later entries win on a duplicate id, but the order the roster was written
    // in is preserved so the picker is stable.
    const seen = new Set<string>();
    const athletes: Athlete[] = [];
    for (const athlete of result.data) {
      if (seen.has(athlete.id)) continue;
      seen.add(athlete.id);
      athletes.push(athlete);
    }
    return { ok: true, athletes };
  }

  if (source.athleteId && source.apiKey) {
    return {
      ok: true,
      athletes: [
        {
          id: 'default',
          label: 'Default athlete',
          athleteId: source.athleteId,
          apiKey: source.apiKey,
        },
      ],
    };
  }

  return { ok: false, reason: 'none_configured' };
}

/**
 * Resolves the athlete a request is for. An absent id falls back to the first in
 * the roster; an id that is present but unknown is an error rather than a
 * fallback, because silently sending to the wrong calendar is worse than failing.
 */
export function selectAthlete(
  athletes: Athlete[],
  id: string | null | undefined,
): Athlete | null {
  if (!id) return athletes[0] ?? null;
  return athletes.find((athlete) => athlete.id === id) ?? null;
}
