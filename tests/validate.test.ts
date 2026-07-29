import { describe, expect, it } from 'vitest';
import {
  MAX_PACE_SECONDS_PER_KM,
  MAX_REPS,
  MAX_STEP_DISTANCE_METRES,
  MAX_STEP_TIME_SECONDS,
  MIN_PACE_SECONDS_PER_KM,
  MIN_STEP_DISTANCE_METRES,
  validateWorkout,
} from '../src/lib/validate';
import {
  distanceStep,
  pace,
  referenceWorkout,
  repeat,
  timeStep,
  workout,
} from './helpers';

function codes(w: Parameters<typeof validateWorkout>[0]) {
  return validateWorkout(w).map((error) => error.code);
}

describe('validateWorkout', () => {
  it('accepts the verified reference session', () => {
    expect(validateWorkout(referenceWorkout())).toEqual([]);
  });

  it('rejects a time step over the limit', () => {
    const w = workout([timeStep('run', MAX_STEP_TIME_SECONDS + 1)]);
    expect(codes(w)).toContain('step_time_too_long');
  });

  it('accepts a time step exactly at the limit', () => {
    const w = workout([timeStep('run', MAX_STEP_TIME_SECONDS)]);
    expect(codes(w)).not.toContain('step_time_too_long');
  });

  it('catches the 400m-read-as-400-minutes failure', () => {
    // The exact failure observed against the live API: `- 400m` produced a
    // 24000-second step and the API returned HTTP 200 with no warning.
    const w = workout([repeat(4, [timeStep('run', 24_000), timeStep('recover', 60)])]);
    const found = codes(w);
    expect(found).toContain('step_time_too_long');
    expect(found).toContain('total_too_long');
  });

  it('rejects a distance step longer than a marathon', () => {
    const w = workout([distanceStep('run', MAX_STEP_DISTANCE_METRES + 1)]);
    expect(codes(w)).toContain('step_distance_too_long');
  });

  it('rejects a distance step under the minimum', () => {
    const w = workout([distanceStep('run', MIN_STEP_DISTANCE_METRES - 1)]);
    expect(codes(w)).toContain('step_distance_too_short');
  });

  it('rejects too many repeats', () => {
    const w = workout([repeat(MAX_REPS + 1, [distanceStep('run', 400)])]);
    expect(codes(w)).toContain('too_many_reps');
  });

  it('rejects an empty workout', () => {
    expect(codes({ name: 'Empty', blocks: [] })).toEqual(['empty_workout']);
  });

  it('rejects a workout over the total duration limit', () => {
    const w = workout([repeat(30, [timeStep('run', 400), timeStep('recover', 60)])]);
    expect(codes(w)).toContain('total_too_long');
  });

  it('counts distance towards the total using the nominal pace', () => {
    // 30 × 2km is 60km — comfortably over three hours at any running pace.
    const w = workout([repeat(30, [distanceStep('run', 2000)])]);
    expect(codes(w)).toContain('total_too_long');
  });

  it('accepts a sensible pace target', () => {
    const w = workout([distanceStep('run', 800, { pace: pace('4:15', '3:55') })]);
    expect(validateWorkout(w)).toEqual([]);
  });

  it('accepts equal ends, which mean a single pace', () => {
    const w = workout([distanceStep('run', 800, { pace: pace('4:00', '4:00') })]);
    expect(validateWorkout(w)).toEqual([]);
  });

  it('rejects a pace range entered the wrong way round', () => {
    // Both ends are plausible paces on their own, so nothing downstream would
    // notice: Intervals.icu takes them in written order and Garmin shows the
    // band inside out. This check is the only thing between the two boxes and
    // the watch.
    const w = workout([
      distanceStep('run', 800, {
        pace: { slowerSecondsPerKm: 235, fasterSecondsPerKm: 255 },
      }),
    ]);
    expect(codes(w)).toContain('pace_range_inverted');
  });

  it('rejects a pace outside the sendable range', () => {
    const tooFast = workout([
      distanceStep('run', 800, {
        pace: {
          slowerSecondsPerKm: MIN_PACE_SECONDS_PER_KM - 1,
          fasterSecondsPerKm: MIN_PACE_SECONDS_PER_KM - 1,
        },
      }),
    ]);
    expect(codes(tooFast)).toContain('pace_out_of_range');

    const tooSlow = workout([
      distanceStep('run', 800, {
        pace: {
          slowerSecondsPerKm: MAX_PACE_SECONDS_PER_KM + 1,
          fasterSecondsPerKm: MAX_PACE_SECONDS_PER_KM + 1,
        },
      }),
    ]);
    expect(codes(tooSlow)).toContain('pace_out_of_range');
  });

  it('accepts a pace exactly at either bound', () => {
    const w = workout([
      distanceStep('run', 800, {
        pace: {
          slowerSecondsPerKm: MAX_PACE_SECONDS_PER_KM,
          fasterSecondsPerKm: MIN_PACE_SECONDS_PER_KM,
        },
      }),
    ]);
    expect(validateWorkout(w)).toEqual([]);
  });

  it('points a pace error at the step inside a repeat', () => {
    const w = workout([
      timeStep('warmup', 600),
      repeat(4, [
        distanceStep('run', 800, {
          pace: { slowerSecondsPerKm: 235, fasterSecondsPerKm: 255 },
        }),
      ]),
    ]);
    const error = validateWorkout(w).find((e) => e.code === 'pace_range_inverted');
    expect(error?.blockIndex).toBe(1);
    expect(error?.stepIndex).toBe(0);
  });

  it('never names a step number in a pace message', () => {
    // Only the client knows a step's position once repeats are expanded, so it
    // prefixes "Step N" itself. A number here would produce "Step 3: Step 1: …".
    const w = workout([
      distanceStep('run', 800, {
        pace: { slowerSecondsPerKm: 235, fasterSecondsPerKm: 255 },
      }),
    ]);
    for (const error of validateWorkout(w)) {
      expect(error.message).not.toMatch(/\bstep \d/i);
    }
  });

  it('points errors at the block they came from', () => {
    const w = workout([
      timeStep('warmup', 600),
      repeat(4, [timeStep('run', MAX_STEP_TIME_SECONDS + 1)]),
    ]);
    const error = validateWorkout(w).find((e) => e.code === 'step_time_too_long');
    expect(error?.blockIndex).toBe(1);
    expect(error?.stepIndex).toBe(0);
  });
});
