import { env } from 'cloudflare:workers';
import { readRoster, selectAthlete, type Athlete, type RosterResult } from './athletes';

/**
 * The binding-backed side of the roster. Kept apart from athletes.ts so that the
 * selection logic stays importable under Node and testable.
 */

export function loadRoster(): RosterResult {
  return readRoster({
    athletesJson: env.ICU_ATHLETES,
    athleteId: env.ICU_ATHLETE_ID,
    apiKey: env.ICU_API_KEY,
  });
}

export type ResolveResult =
  | { ok: true; athlete: Athlete }
  | { ok: false; status: number; error: string };

/** Resolves the athlete for a request, with messages a user can act on. */
export function resolveAthlete(id: string | null | undefined): ResolveResult {
  const roster = loadRoster();

  if (!roster.ok) {
    const error =
      roster.reason === 'none_configured'
        ? 'No athletes are set up yet. See docs/adding-an-athlete.md.'
        : 'The athlete list is misconfigured. Check the ICU_ATHLETES secret.';
    return { ok: false, status: 500, error };
  }

  const athlete = selectAthlete(roster.athletes, id);
  if (!athlete) {
    return { ok: false, status: 400, error: 'That athlete is not set up.' };
  }

  return { ok: true, athlete };
}
