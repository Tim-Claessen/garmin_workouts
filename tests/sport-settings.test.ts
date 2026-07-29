import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THRESHOLD_SECONDS_PER_KM,
  ensureRunThresholdPace,
  hasPaceTarget,
  secondsPerKmToMetresPerSecond,
} from '../src/lib/sport-settings';
import { distanceStep, lapPressStep, pace, repeat, timeStep, workout } from './helpers';

/**
 * The module that writes to an athlete's account. Two rules matter more than the
 * happy path and are tested hardest: it only ever fills an empty field, and it
 * only runs for a workout that actually carries a pace target.
 */

const creds = { athleteId: 'i123', apiKey: 'secret' };

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Records every request and answers the GET with the given Run group. */
function stubApi(runGroup: unknown, writeStatus = 200) {
  const calls: Call[] = [];

  vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body) : null,
    });

    if ((init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 9, types: ['Ride'] }, runGroup]), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response('{}', { status: writeStatus }));
  });

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hasPaceTarget', () => {
  it('is false for a workout with no targets', () => {
    expect(hasPaceTarget(workout([distanceStep('run', 800)]))).toBe(false);
    expect(
      hasPaceTarget(workout([lapPressStep('warmup'), repeat(6, [timeStep('run', 120)])])),
    ).toBe(false);
  });

  it('finds a target on a top-level step', () => {
    const w = workout([distanceStep('run', 800, { pace: pace('4:15', '3:55') })]);
    expect(hasPaceTarget(w)).toBe(true);
  });

  it('finds a target buried inside a repeat', () => {
    // The common case: the effort inside the set carries the pace and nothing
    // else does. Missing this would skip the threshold write for exactly the
    // workouts that need it.
    const w = workout([
      lapPressStep('warmup'),
      repeat(6, [
        distanceStep('run', 800, { pace: pace('4:15', '3:55') }),
        timeStep('recover', 90),
      ]),
      lapPressStep('cooldown'),
    ]);
    expect(hasPaceTarget(w)).toBe(true);
  });
});

describe('secondsPerKmToMetresPerSecond', () => {
  it('converts the default to the speed Intervals.icu stores', () => {
    expect(secondsPerKmToMetresPerSecond(300)).toBeCloseTo(3.3333, 4);
    expect(secondsPerKmToMetresPerSecond(240)).toBeCloseTo(4.1667, 4);
  });
});

describe('ensureRunThresholdPace', () => {
  it('writes a threshold when the field is empty', async () => {
    const calls = stubApi({ id: 42, types: ['Run'], threshold_pace: null });

    const result = await ensureRunThresholdPace(creds);

    expect(result).toEqual({ ok: true, changed: true });

    const write = calls.find((call) => call.method === 'PUT');
    expect(write?.url).toContain('/sport-settings/42');
    expect((write?.body as { threshold_pace: number }).threshold_pace).toBeCloseTo(
      secondsPerKmToMetresPerSecond(DEFAULT_THRESHOLD_SECONDS_PER_KM),
      4,
    );
  });

  it('leaves a real threshold completely alone', async () => {
    // The rule that stops this being destructive. Overwriting a genuine value
    // would rewrite the athlete's pace zones and shift their load history, to
    // fix a problem they do not have.
    const calls = stubApi({ id: 42, types: ['Run'], threshold_pace: 4.2 });

    const result = await ensureRunThresholdPace(creds);

    expect(result).toEqual({ ok: true, changed: false });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('treats zero and a missing key as unset', async () => {
    for (const group of [
      { id: 42, types: ['Run'], threshold_pace: 0 },
      { id: 42, types: ['Run'] },
    ]) {
      const calls = stubApi(group);
      const result = await ensureRunThresholdPace(creds);

      expect(result).toEqual({ ok: true, changed: true });
      expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('reports rather than throws when the read fails', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 401 })));

    const result = await ensureRunThresholdPace(creds);
    expect(result.ok).toBe(false);
  });

  it('does not attempt a write when the read fails', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: { method?: string }) => {
      calls.push(init?.method ?? 'GET');
      return Promise.resolve(new Response('nope', { status: 500 }));
    });

    await ensureRunThresholdPace(creds);
    expect(calls).toEqual(['GET']);
  });

  it('reports when there is no run group at all', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify([{ id: 9, types: ['Ride'] }]), { status: 200 })),
    );

    const result = await ensureRunThresholdPace(creds);
    expect(result.ok).toBe(false);
  });

  it('reports a failed write', async () => {
    stubApi({ id: 42, types: ['Run'], threshold_pace: null }, 403);

    const result = await ensureRunThresholdPace(creds);
    expect(result.ok).toBe(false);
  });

  it('survives an unreachable Intervals.icu', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    const result = await ensureRunThresholdPace(creds);
    expect(result.ok).toBe(false);
  });
});
