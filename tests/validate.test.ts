import { describe, expect, it } from 'vitest';
import {
  MAX_REPS,
  MAX_STEP_DISTANCE_METRES,
  MAX_STEP_TIME_SECONDS,
  MIN_STEP_DISTANCE_METRES,
  validateWorkout,
} from '../src/lib/validate';
import {
  distanceStep,
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
