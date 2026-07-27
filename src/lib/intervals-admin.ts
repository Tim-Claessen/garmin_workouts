/**
 * Bulk removal of planned workouts from the Intervals.icu calendar.
 *
 * Two safety rules, both deliberate:
 *
 * 1. **Only `category: "WORKOUT"` is ever touched.** The calendar also holds
 *    things like SEASON_START, notes and races. Those were not created by this
 *    app and are not ours to delete.
 * 2. **Recorded activities are never touched.** Completed runs live on a
 *    different endpoint entirely. This only removes *planned* workouts — the
 *    clutter this app creates — not training history.
 *
 * Intervals.icu has no bulk delete, so this lists and then deletes one by one.
 */

export type ClearScope = 'future' | 'past' | 'all';

const WIDE_PAST = '2000-01-01';
const WIDE_FUTURE = '2099-12-31';

export interface CalendarEvent {
  id: number;
  name?: string;
  category?: string;
  start_date_local?: string;
}

export interface ClearResult {
  scope: ClearScope;
  matched: number;
  deleted: number;
  failed: number;
  /** Matched but never attempted, because the per-run cap was reached. */
  remaining: number;
}

/**
 * Intervals.icu has no bulk delete, so clearing N workouts costs N subrequests
 * plus the listing. A Worker invocation has a hard subrequest ceiling, and a
 * calendar with a season of sessions on it can exceed it — at which point the
 * run dies part-way with no record of how far it got. Capping means a large
 * clear finishes across a few presses instead, with an accurate count each time.
 */
export const MAX_DELETES_PER_RUN = 200;

/**
 * Credentials are passed in rather than read from the binding, so this module
 * stays importable under Node and the scope logic — which decides what gets
 * irreversibly deleted — can be unit tested.
 */
export interface Credentials {
  athleteId: string;
  apiKey: string;
}

function authHeader(apiKey: string): string {
  return `Basic ${btoa(`API_KEY:${apiKey}`)}`;
}

/**
 * Today as a plain YYYY-MM-DD date, by the Worker's clock.
 *
 * That clock is always UTC, so this is *not* the athlete's date. In Australia the
 * two disagree for the first ten hours of every local day, and in that window a
 * session planned for this morning still sorts as "future" against UTC's
 * yesterday — putting a run the athlete has already done inside the "upcoming"
 * sweep. Callers that can learn the athlete's date should pass it through
 * `resolveToday` rather than relying on this.
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

/**
 * The athlete's own date, when the browser offers a believable one.
 *
 * The client does not get to name the deletion window outright: this is
 * irreversible, and a wrong "today" silently changes which workouts count as
 * upcoming. A supplied date is honoured only when it is well-formed and within
 * one day of UTC — the exact span real timezone offsets cover, and nothing
 * beyond it. Anything else falls back to the Worker's own date.
 */
export function resolveToday(supplied: unknown, utc: string = today()): string {
  if (typeof supplied !== 'string' || !DATE_PATTERN.test(supplied)) return utc;

  const skew = Math.abs(
    Date.parse(`${supplied}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`),
  );
  return Number.isFinite(skew) && skew <= ONE_DAY_MS ? supplied : utc;
}

export function windowFor(
  scope: ClearScope,
  now: string = today(),
): { oldest: string; newest: string } {
  if (scope === 'future') return { oldest: now, newest: WIDE_FUTURE };
  if (scope === 'past') return { oldest: WIDE_PAST, newest: now };
  return { oldest: WIDE_PAST, newest: WIDE_FUTURE };
}

/**
 * `future` includes today and `past` excludes it, so the two are disjoint and a
 * workout planned for this morning is never silently swept up by "past".
 */
export function inScope(
  event: CalendarEvent,
  scope: ClearScope,
  now: string = today(),
): boolean {
  if (event.category !== 'WORKOUT') return false;
  if (scope === 'all') return true;

  const date = (event.start_date_local ?? '').slice(0, 10);
  if (!date) return false;
  return scope === 'future' ? date >= now : date < now;
}

export async function listWorkouts(
  creds: Credentials,
  scope: ClearScope,
  now: string = today(),
): Promise<CalendarEvent[]> {
  const { oldest, newest } = windowFor(scope, now);
  const response = await fetch(
    `https://intervals.icu/api/v1/athlete/${creds.athleteId}/events?oldest=${oldest}&newest=${newest}`,
    { headers: { authorization: authHeader(creds.apiKey) } },
  );

  if (!response.ok) throw new Error(`list_failed_${response.status}`);

  const events = (await response.json()) as CalendarEvent[];
  return events.filter((event) => inScope(event, scope, now));
}

export async function clearWorkouts(
  creds: Credentials,
  scope: ClearScope,
  now: string = today(),
): Promise<ClearResult> {
  const targets = await listWorkouts(creds, scope, now);
  // Oldest first, so a capped run always clears a prefix of the calendar rather
  // than an arbitrary slice, and pressing again picks up exactly where it left off.
  const batch = targets.slice(0, MAX_DELETES_PER_RUN);

  let deleted = 0;
  let failed = 0;

  for (const event of batch) {
    const response = await fetch(
      `https://intervals.icu/api/v1/athlete/${creds.athleteId}/events/${event.id}`,
      { method: 'DELETE', headers: { authorization: authHeader(creds.apiKey) } },
    ).catch(() => null);

    if (response?.ok) deleted += 1;
    else failed += 1;
  }

  return {
    scope,
    matched: targets.length,
    deleted,
    failed,
    remaining: targets.length - batch.length,
  };
}
