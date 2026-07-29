import type { Pace, Repeat, Step, StepType, Workout } from '../src/lib/schema';

/**
 * A pace range written the way it is read: `pace('4:15', '3:55')` is the slower
 * end first, matching the step line, the sheet and the stored payload.
 */
export function pace(slower: string, faster: string): Pace {
  const seconds = (clock: string) => {
    const [minutes, secs] = clock.split(':').map(Number);
    return minutes! * 60 + secs!;
  };
  return {
    slowerSecondsPerKm: seconds(slower),
    fasterSecondsPerKm: seconds(faster),
  };
}

export function timeStep(
  type: StepType,
  seconds: number,
  overrides: Partial<Step> = {},
): Step {
  return {
    kind: 'step',
    type,
    duration: { kind: 'time', seconds },
    untilLapPress: false,
    source: 'parsed',
    ...overrides,
  };
}

export function distanceStep(
  type: StepType,
  metres: number,
  overrides: Partial<Step> = {},
): Step {
  return {
    kind: 'step',
    type,
    duration: { kind: 'distance', metres },
    untilLapPress: false,
    source: 'parsed',
    ...overrides,
  };
}

export function lapPressStep(type: StepType, placeholderMetres = 2000): Step {
  return distanceStep(type, placeholderMetres, { untilLapPress: true });
}

export function repeat(reps: number, steps: Step[]): Repeat {
  return { kind: 'repeat', reps, steps, source: 'parsed' };
}

export function workout(blocks: Workout['blocks'], name = 'Test session'): Workout {
  return { name, blocks };
}

/**
 * The session used throughout the Test 0.4 spike, and the one whose Intervals.icu
 * payload is captured in docs/intervals-syntax.md.
 */
export function referenceWorkout(): Workout {
  return workout(
    [
      lapPressStep('warmup'),
      repeat(6, [distanceStep('run', 800), timeStep('recover', 90)]),
      lapPressStep('cooldown'),
    ],
    'Tuesday intervals',
  );
}
