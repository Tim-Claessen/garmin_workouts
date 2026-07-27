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
}

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

/** Today in the athlete's local terms. Dates are compared as plain YYYY-MM-DD. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function windowFor(scope: ClearScope): { oldest: string; newest: string } {
  const now = today();
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
): Promise<CalendarEvent[]> {
  const { oldest, newest } = windowFor(scope);
  const response = await fetch(
    `https://intervals.icu/api/v1/athlete/${creds.athleteId}/events?oldest=${oldest}&newest=${newest}`,
    { headers: { authorization: authHeader(creds.apiKey) } },
  );

  if (!response.ok) throw new Error(`list_failed_${response.status}`);

  const events = (await response.json()) as CalendarEvent[];
  return events.filter((event) => inScope(event, scope));
}

export async function clearWorkouts(
  creds: Credentials,
  scope: ClearScope,
): Promise<ClearResult> {
  const targets = await listWorkouts(creds, scope);
  let deleted = 0;
  let failed = 0;

  for (const event of targets) {
    const response = await fetch(
      `https://intervals.icu/api/v1/athlete/${creds.athleteId}/events/${event.id}`,
      { method: 'DELETE', headers: { authorization: authHeader(creds.apiKey) } },
    ).catch(() => null);

    if (response?.ok) deleted += 1;
    else failed += 1;
  }

  return { scope, matched: targets.length, deleted, failed };
}
