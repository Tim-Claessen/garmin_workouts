import type { Block, Step, Workout } from './schema';

/**
 * Hard validation that runs after parsing and before anything is displayed or
 * sent. These are deliberately blunt range checks rather than anything clever:
 * their job is to make the failure modes observed in the Test 0.4 spike
 * impossible to reach.
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
 * Used only to bring distance into the same units as time for the total-duration
 * guard. It is never shown to the user and never sent anywhere — we hold no pace
 * data and deliberately do not ask the model for any. Six minutes per kilometre
 * is a deliberately slow assumption, so the guard errs towards catching things.
 */
export const NOMINAL_SECONDS_PER_KM = 360;

export type ValidationCode =
  | 'empty_workout'
  | 'step_time_too_long'
  | 'step_distance_too_long'
  | 'step_distance_too_short'
  | 'too_many_reps'
  | 'total_too_long';

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

function checkStep(
  step: Step,
  blockIndex: number,
  stepIndex: number | null,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (step.duration.kind === 'time') {
    if (step.duration.seconds > MAX_STEP_TIME_SECONDS) {
      errors.push({
        code: 'step_time_too_long',
        blockIndex,
        stepIndex,
        message: `A single step of ${Math.round(step.duration.seconds / 60)} minutes is longer than the ${MAX_STEP_TIME_SECONDS / 60}-minute limit. This is usually a distance that was read as a time.`,
      });
    }
  } else {
    if (step.duration.metres > MAX_STEP_DISTANCE_METRES) {
      errors.push({
        code: 'step_distance_too_long',
        blockIndex,
        stepIndex,
        message: `A single step of ${(step.duration.metres / 1000).toFixed(1)}km is longer than a marathon.`,
      });
    }
    if (step.duration.metres < MIN_STEP_DISTANCE_METRES) {
      errors.push({
        code: 'step_distance_too_short',
        blockIndex,
        stepIndex,
        message: `A step of ${step.duration.metres}m is shorter than the ${MIN_STEP_DISTANCE_METRES}m minimum.`,
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
        message: `${block.reps} repeats is more than the ${MAX_REPS} allowed.`,
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
