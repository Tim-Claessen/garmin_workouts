import type { Block, Workout } from './schema';

/**
 * Making sure a pace target survives the hop to Garmin.
 *
 * Intervals.icu accepts a pace target on a step and stores it correctly, but
 * **drops it from the Garmin export when the athlete has no run threshold pace
 * set**. The workout still syncs; the targets simply are not on it, and nothing
 * anywhere says so. The athlete finds out mid-session, or never. That failure was
 * reported against this exact setup — a run workout created over the API as a
 * description string, syncing to a Forerunner — and setting a threshold fixed it.
 * See docs/intervals-syntax.md.
 *
 * So before sending a workout that carries a pace, this makes sure a threshold
 * exists. Two rules bound what it will do to someone's account:
 *
 * 1. **It only ever fills an empty field.** A real threshold is left exactly as
 *    it is. The problem being solved is an absent value; overwriting a present
 *    one would rewrite the athlete's pace zones and shift their load history for
 *    no gain at all.
 * 2. **It only runs when the workout actually has a pace target.** Sessions
 *    without one never touch this endpoint.
 *
 * Credentials are arguments rather than bindings, for the reason athletes.ts and
 * intervals-admin.ts do the same: the logic deciding what gets written to
 * someone's account should be testable under Node.
 */

/**
 * The value written when nothing is set: 5:00/km.
 *
 * It is a placeholder, not an estimate of anybody's fitness, and it is chosen to
 * be unremarkable rather than accurate. Nothing the athlete sees depends on it —
 * threshold pace is Intervals.icu-side configuration and never syncs to Garmin,
 * so the number itself is invisible on the watch. What it affects is
 * Intervals.icu's own pace zones and load figures, which this workflow does not
 * use.
 *
 * The open question is whether the Garmin export treats threshold as a *gate*
 * (present or absent) or as a *scale*. If it scales, a placeholder would put
 * wrong paces on the watch silently, and this constant has to become a real
 * per-athlete number instead. A gate is much the likelier — Garmin has no
 * threshold of its own and needs absolute speeds in a workout step — but it is
 * settled by one real send, not by reasoning. Until docs/intervals-syntax.md
 * records that send, treat this as unverified.
 */
export const DEFAULT_THRESHOLD_SECONDS_PER_KM = 300;

export interface Credentials {
  athleteId: string;
  apiKey: string;
}

/** A sport-settings group. Only the fields this module reads are named. */
interface SportSettings {
  id?: number | string;
  types?: string[];
  threshold_pace?: number | null;
}

export type ThresholdResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

function authHeader(apiKey: string): string {
  return `Basic ${btoa(`API_KEY:${apiKey}`)}`;
}

/** Intervals.icu holds threshold pace as a speed in metres per second. */
export function secondsPerKmToMetresPerSecond(secondsPerKm: number): number {
  return 1000 / secondsPerKm;
}

/** True when any step anywhere in the workout carries a pace target. */
export function hasPaceTarget(workout: Workout): boolean {
  const blockHasPace = (block: Block): boolean =>
    block.kind === 'step'
      ? block.pace !== undefined
      : block.steps.some((step) => step.pace !== undefined);

  return workout.blocks.some(blockHasPace);
}

/**
 * A threshold counts as set only if it is a positive number. Intervals.icu has
 * been seen to use `null`, `0` and an absent key for "not set", and treating any
 * of them as a real value would skip the write and lose the targets.
 */
function isSet(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function ensureRunThresholdPace(
  creds: Credentials,
  secondsPerKm: number = DEFAULT_THRESHOLD_SECONDS_PER_KM,
): Promise<ThresholdResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://intervals.icu/api/v1/athlete/${creds.athleteId}/sport-settings`,
      { headers: { authorization: authHeader(creds.apiKey) } },
    );
  } catch {
    return { ok: false, reason: 'Could not reach Intervals.icu.' };
  }

  if (!response.ok) {
    return { ok: false, reason: `Intervals.icu returned ${response.status}.` };
  }

  let groups: SportSettings[];
  try {
    groups = (await response.json()) as SportSettings[];
  } catch {
    return { ok: false, reason: 'Could not read the sport settings.' };
  }

  if (!Array.isArray(groups)) {
    return { ok: false, reason: 'Could not read the sport settings.' };
  }

  const run = groups.find((group) => group.types?.includes('Run'));
  if (!run || run.id === undefined || run.id === null) {
    return { ok: false, reason: 'No run sport settings found for this athlete.' };
  }

  // Already has one. Leave it alone — this is the rule that keeps the feature
  // from being destructive.
  if (isSet(run.threshold_pace)) return { ok: true, changed: false };

  let write: Response;
  try {
    write = await fetch(
      `https://intervals.icu/api/v1/athlete/${creds.athleteId}/sport-settings/${run.id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: authHeader(creds.apiKey),
        },
        body: JSON.stringify({
          threshold_pace: secondsPerKmToMetresPerSecond(secondsPerKm),
        }),
      },
    );
  } catch {
    return { ok: false, reason: 'Could not reach Intervals.icu.' };
  }

  if (!write.ok) {
    return { ok: false, reason: `Intervals.icu returned ${write.status}.` };
  }

  return { ok: true, changed: true };
}
