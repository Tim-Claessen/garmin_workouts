import type { Block, Step, Workout } from './schema';

/**
 * Hard validation that runs after parsing and before anything is displayed or
 * sent. These are deliberately blunt range checks rather than anything clever:
 * their job is to make the failure modes observed in the Test 0.4 spike
 * impossible to reach.
 *
 * The messages name the value and what to check, but never the step number: the
 * review screen owns the numbering, because only it knows a step's position once
 * repeats are expanded. It prefixes "Step N" when it renders these.
 *
 * The one that matters most is MAX_STEP_TIME_SECONDS. Writing `400m` instead of
 * `400mtr` in Intervals.icu syntax produces a 400-*minute* step, and the API
 * accepts it with HTTP 200 and no warning. That is a 26-hour workout that syncs
 * straight to the watch. Nothing downstream catches it, so this does.
 */

export const MAX_STEP_TIME_SECONDS = 90 * 60;
export const MAX_STEP_DISTANCE_METRES = 42_000;
export const MIN_STEP_DISTANCE_METRES = 50;
export const MAX_REPS = 30;
export const MAX_TOTAL_SECONDS = 3 * 60 * 60;

/**
 * Pace bounds, in seconds per kilometre. Deliberately wide: these catch a value
 * entered into the wrong box or off by a factor, not a pace that is merely
 * ambitious. 2:00/km is faster than any human has run a kilometre; 20:00/km is
 * slower than walking.
 */
export const MIN_PACE_SECONDS_PER_KM = 120;
export const MAX_PACE_SECONDS_PER_KM = 1200;

/**
 * Used only to bring distance into the same units as time for the total-duration
 * guard. It is never shown to the user and never sent anywhere. Six minutes per
 * kilometre is a deliberately slow assumption, so the guard errs towards catching
 * things.
 *
 * Deliberately not replaced by a step's pace target when it has one. A target is
 * optional and usually faster than this, so reading it here would shrink the
 * estimate and catch less — and the guard exists to spot a distance misread as a
 * time, which is a question about the *duration*, not about how fast it is run.
 */
export const NOMINAL_SECONDS_PER_KM = 360;

export type ValidationCode =
  | 'empty_workout'
  | 'step_time_too_long'
  | 'step_distance_too_long'
  | 'step_distance_too_short'
  | 'too_many_reps'
  | 'total_too_long'
  | 'pace_out_of_range'
  | 'pace_range_inverted';

export interface ValidationError {
  code: ValidationCode;
  /** Index into workout.blocks, so the review screen can point at the step. */
  blockIndex: number | null;
  /** Index within a repeat block's steps, when applicable. */
  stepIndex: number | null;
  message: string;
}

function estimateSeconds(step: Step): number {
  return step.duration.kind === 'time'
    ? step.duration.seconds
    : (step.duration.metres / 1000) * NOMINAL_SECONDS_PER_KM;
}

function blockSeconds(block: Block): number {
  return block.kind === 'step'
    ? estimateSeconds(block)
    : block.reps * block.steps.reduce((total, step) => total + estimateSeconds(step), 0);
}

function clock(secondsPerKm: number): string {
  return `${Math.floor(secondsPerKm / 60)}:${String(Math.round(secondsPerKm % 60)).padStart(2, '0')}`;
}

/**
 * A pace target is the one value on a step that a human typed rather than the
 * model produced, so these guard typing rather than hallucination — a digit
 * dropped, or the two ends entered the wrong way round.
 *
 * The inverted check is the one that earns its place. Both ends are plausible
 * paces on their own, so nothing else between the sheet and the watch would
 * notice they had been swapped; Intervals.icu takes them in written order and
 * Garmin would show the band inside out.
 */
function checkPace(
  step: Step,
  blockIndex: number,
  stepIndex: number | null,
): ValidationError[] {
  const pace = step.pace;
  if (!pace) return [];

  const errors: ValidationError[] = [];
  const ends = [pace.slowerSecondsPerKm, pace.fasterSecondsPerKm];

  for (const end of ends) {
    if (end < MIN_PACE_SECONDS_PER_KM || end > MAX_PACE_SECONDS_PER_KM) {
      errors.push({
        code: 'pace_out_of_range',
        blockIndex,
        stepIndex,
        message: `A pace of ${clock(end)} per km is outside the ${clock(MIN_PACE_SECONDS_PER_KM)}–${clock(MAX_PACE_SECONDS_PER_KM)} range this tool will send — check the minutes and seconds.`,
      });
      // One complaint per step is enough to stop the send and point at the row.
      break;
    }
  }

  if (pace.fasterSecondsPerKm > pace.slowerSecondsPerKm) {
    errors.push({
      code: 'pace_range_inverted',
      blockIndex,
      stepIndex,
      message: `This pace target has ${clock(pace.fasterSecondsPerKm)} as the faster end and ${clock(pace.slowerSecondsPerKm)} as the slower one, but ${clock(pace.fasterSecondsPerKm)} per km is the slower of the two — check which way round they went in.`,
    });
  }

  return errors;
}

function checkStep(
  step: Step,
  blockIndex: number,
  stepIndex: number | null,
): ValidationError[] {
  const errors: ValidationError[] = [];

  errors.push(...checkPace(step, blockIndex, stepIndex));

  if (step.duration.kind === 'time') {
    if (step.duration.seconds > MAX_STEP_TIME_SECONDS) {
      errors.push({
        code: 'step_time_too_long',
        blockIndex,
        stepIndex,
        message: `A single step of ${Math.round(step.duration.seconds / 60)} minutes is over the ${MAX_STEP_TIME_SECONDS / 60}-minute limit. That usually means a distance was read as a time — check the units.`,
      });
    }
  } else {
    if (step.duration.metres > MAX_STEP_DISTANCE_METRES) {
      errors.push({
        code: 'step_distance_too_long',
        blockIndex,
        stepIndex,
        message: `A single step of ${Number((step.duration.metres / 1000).toFixed(1))} km is longer than anything this tool will send — check the units.`,
      });
    }
    if (step.duration.metres < MIN_STEP_DISTANCE_METRES) {
      errors.push({
        code: 'step_distance_too_short',
        blockIndex,
        stepIndex,
        message: `A single step of ${step.duration.metres} m is under the ${MIN_STEP_DISTANCE_METRES} m minimum — check the units.`,
      });
    }
  }

  return errors;
}

export function validateWorkout(workout: Workout): ValidationError[] {
  const errors: ValidationError[] = [];

  if (workout.blocks.length === 0) {
    return [
      {
        code: 'empty_workout',
        blockIndex: null,
        stepIndex: null,
        message: 'This workout has no steps.',
      },
    ];
  }

  workout.blocks.forEach((block, blockIndex) => {
    if (block.kind === 'step') {
      errors.push(...checkStep(block, blockIndex, null));
      return;
    }

    if (block.reps > MAX_REPS) {
      errors.push({
        code: 'too_many_reps',
        blockIndex,
        stepIndex: null,
        message: `${block.reps} repeats is more than the ${MAX_REPS} allowed — check the number.`,
      });
    }

    block.steps.forEach((step, stepIndex) => {
      errors.push(...checkStep(step, blockIndex, stepIndex));
    });
  });

  const total = workout.blocks.reduce((sum, block) => sum + blockSeconds(block), 0);
  if (total > MAX_TOTAL_SECONDS) {
    errors.push({
      code: 'total_too_long',
      blockIndex: null,
      stepIndex: null,
      message: `This workout comes to about ${Math.round(total / 3600)} hours, over the ${MAX_TOTAL_SECONDS / 3600}-hour limit.`,
    });
  }

  return errors;
}

export function isValid(workout: Workout): boolean {
  return validateWorkout(workout).length === 0;
}
