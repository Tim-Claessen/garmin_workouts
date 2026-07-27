import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWorkouts,
  inScope,
  MAX_DELETES_PER_RUN,
  resolveToday,
  windowFor,
  type CalendarEvent,
} from '../src/lib/intervals-admin';

/**
 * This decides what gets irreversibly deleted from a real calendar, so the
 * partitioning is tested directly rather than trusted.
 */

const NOW = '2026-07-27';

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 1,
  category: 'WORKOUT',
  start_date_local: `${NOW}T00:00:00`,
  ...over,
});

describe('inScope', () => {
  it('only ever touches workouts', () => {
    // The calendar also holds season markers, notes and races. None of those
    // were created by this app.
    for (const category of ['SEASON_START', 'NOTE', 'RACE_A', undefined]) {
      for (const scope of ['future', 'past', 'all'] as const) {
        expect(inScope(event({ category }), scope, NOW), `${category}/${scope}`).toBe(false);
      }
    }
  });

  it('treats today as upcoming, not past', () => {
    const today = event({ start_date_local: `${NOW}T00:00:00` });
    expect(inScope(today, 'future', NOW)).toBe(true);
    expect(inScope(today, 'past', NOW)).toBe(false);
  });

  it('splits either side of today', () => {
    const yesterday = event({ start_date_local: '2026-07-26T00:00:00' });
    const tomorrow = event({ start_date_local: '2026-07-28T00:00:00' });

    expect(inScope(yesterday, 'past', NOW)).toBe(true);
    expect(inScope(yesterday, 'future', NOW)).toBe(false);
    expect(inScope(tomorrow, 'future', NOW)).toBe(true);
    expect(inScope(tomorrow, 'past', NOW)).toBe(false);
  });

  it('future and past are disjoint and together equal all', () => {
    const events = [
      event({ id: 1, start_date_local: '2020-01-01T00:00:00' }),
      event({ id: 2, start_date_local: '2026-07-26T00:00:00' }),
      event({ id: 3, start_date_local: `${NOW}T00:00:00` }),
      event({ id: 4, start_date_local: '2026-07-28T00:00:00' }),
      event({ id: 5, start_date_local: '2099-01-01T00:00:00' }),
    ];

    const past = events.filter((e) => inScope(e, 'past', NOW));
    const future = events.filter((e) => inScope(e, 'future', NOW));
    const all = events.filter((e) => inScope(e, 'all', NOW));

    expect(past.length + future.length).toBe(all.length);
    expect(past.filter((e) => future.includes(e))).toEqual([]);
  });

  it('ignores an event with no date rather than guessing', () => {
    const undated = event({ start_date_local: undefined });
    expect(inScope(undated, 'future', NOW)).toBe(false);
    expect(inScope(undated, 'past', NOW)).toBe(false);
  });
});

describe('windowFor', () => {
  it('asks the API for a window wide enough for each scope', () => {
    expect(windowFor('all').oldest < '2001-01-01').toBe(true);
    expect(windowFor('all').newest > '2098-01-01').toBe(true);
    expect(windowFor('future').newest > '2098-01-01').toBe(true);
    expect(windowFor('past').oldest < '2001-01-01').toBe(true);
  });

  it('pivots on the date it is given, not the machine it runs on', () => {
    expect(windowFor('future', NOW).oldest).toBe(NOW);
    expect(windowFor('past', NOW).newest).toBe(NOW);
  });
});

/**
 * A Worker's clock is UTC. In Australia that is still yesterday for the first ten
 * hours of every local day, which is long enough for "upcoming" to include a
 * session the athlete ran this morning. The browser knows the real date, but this
 * decides what gets irreversibly deleted, so it is believed only within the range
 * a timezone could actually account for.
 */
describe('resolveToday', () => {
  const UTC = '2026-07-27';

  it('accepts a date within a day either side', () => {
    expect(resolveToday('2026-07-28', UTC)).toBe('2026-07-28');
    expect(resolveToday('2026-07-26', UTC)).toBe('2026-07-26');
    expect(resolveToday(UTC, UTC)).toBe(UTC);
  });

  it('falls back to UTC for anything further out', () => {
    // No real offset is two days wide, so this is a wrong clock or a crafted
    // request. Either way the server keeps its own answer.
    expect(resolveToday('2026-07-29', UTC)).toBe(UTC);
    expect(resolveToday('2020-01-01', UTC)).toBe(UTC);
    expect(resolveToday('2099-12-31', UTC)).toBe(UTC);
  });

  it('falls back to UTC for anything that is not a plain date', () => {
    for (const bad of ['', 'today', '2026-7-27', '2026-07-27T10:00:00', null, 42, {}]) {
      expect(resolveToday(bad, UTC), JSON.stringify(bad)).toBe(UTC);
    }
  });

  it('rejects a well-formed date that is not a real one', () => {
    expect(resolveToday('2026-13-45', UTC)).toBe(UTC);
  });
});

/**
 * Intervals.icu has no bulk delete, so a clear costs one subrequest per workout
 * and a full season's calendar can exceed what a single Worker invocation is
 * allowed. Capping turns "dies part-way with no record of how far it got" into
 * "finishes across a few presses, with an honest count each time".
 */
describe('clearWorkouts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const creds = { athleteId: 'i1', apiKey: 'k' };

  /** Stubs the list call with `count` workouts, and every delete as a success. */
  function stubCalendar(count: number): { deleteCalls: () => number } {
    const events = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      category: 'WORKOUT',
      start_date_local: `${NOW}T00:00:00`,
    }));

    let deletes = 0;
    vi.stubGlobal('fetch', (_url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        deletes += 1;
        return Promise.resolve({ ok: true } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(events),
      } as Response);
    });

    return { deleteCalls: () => deletes };
  }

  it('deletes everything when the total is under the cap', async () => {
    const { deleteCalls } = stubCalendar(3);
    const result = await clearWorkouts(creds, 'all', NOW);

    expect(result).toEqual({
      scope: 'all',
      matched: 3,
      deleted: 3,
      failed: 0,
      remaining: 0,
    });
    expect(deleteCalls()).toBe(3);
  });

  it('stops at the cap and reports what is left rather than running on', async () => {
    const total = MAX_DELETES_PER_RUN + 25;
    const { deleteCalls } = stubCalendar(total);
    const result = await clearWorkouts(creds, 'all', NOW);

    expect(deleteCalls()).toBe(MAX_DELETES_PER_RUN);
    expect(result.matched).toBe(total);
    expect(result.deleted).toBe(MAX_DELETES_PER_RUN);
    expect(result.remaining).toBe(25);
    // A capped run is not a failed one, and must not read as one.
    expect(result.failed).toBe(0);
  });

  it('counts a delete that fails without abandoning the rest', async () => {
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        return url.endsWith('/2')
          ? Promise.reject(new Error('network'))
          : Promise.resolve({ ok: true } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, category: 'WORKOUT', start_date_local: `${NOW}T00:00:00` },
            { id: 2, category: 'WORKOUT', start_date_local: `${NOW}T00:00:00` },
            { id: 3, category: 'WORKOUT', start_date_local: `${NOW}T00:00:00` },
          ]),
      } as Response);
    });

    const result = await clearWorkouts(creds, 'all', NOW);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('never sends a delete for anything that is not a workout', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        deleted.push(url);
        return Promise.resolve({ ok: true } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, category: 'WORKOUT', start_date_local: `${NOW}T00:00:00` },
            { id: 2, category: 'RACE_A', start_date_local: `${NOW}T00:00:00` },
            { id: 3, category: 'NOTE', start_date_local: `${NOW}T00:00:00` },
          ]),
      } as Response);
    });

    const result = await clearWorkouts(creds, 'all', NOW);
    expect(result.matched).toBe(1);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('/events/1');
  });
});
