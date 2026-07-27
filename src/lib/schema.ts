import { z } from 'zod';

/**
 * The workout schema.
 *
 * Two things here differ from a naive reading of the Intervals.icu syntax, and
 * both were established empirically in the Test 0.4 spike (see
 * docs/intervals-syntax.md):
 *
 * 1. Lap-press is a *flag*, not a duration type. Intervals.icu emits
 *    `until_lap_press: true` alongside a real distance/duration, which acts as a
 *    placeholder the lap press overrides. So every step has a duration, and
 *    `untilLapPress` sits on top of it.
 * 2. There are no pace or heart-rate targets anywhere, by design. Their absence
 *    is the single biggest reduction in what the model can hallucinate.
 */

export const STEP_TYPES = ['warmup', 'run', 'recover', 'rest', 'cooldown'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/**
 * Where a value came from. `inferred` means the model supplied something the
 * source text did not state, and the review screen must have it acknowledged
 * before the workout can be sent.
 */
export const sourceSchema = z.enum(['parsed', 'inferred']);
export type Source = z.infer<typeof sourceSchema>;

export const durationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('time'),
    seconds: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('distance'),
    metres: z.number().positive(),
  }),
]);
export type Duration = z.infer<typeof durationSchema>;

export const stepSchema = z.object({
  kind: z.literal('step'),
  type: z.enum(STEP_TYPES),
  duration: durationSchema,
  /**
   * When true, the step runs until the lap button is pressed and `duration`
   * serves only as the placeholder Intervals.icu requires.
   */
  untilLapPress: z.boolean().default(false),
  note: z.string().max(200).optional(),
  source: sourceSchema,
});
export type Step = z.infer<typeof stepSchema>;

export const repeatSchema = z.object({
  kind: z.literal('repeat'),
  reps: z.number().int().min(2),
  steps: z.array(stepSchema).min(1),
  source: sourceSchema,
});
export type Repeat = z.infer<typeof repeatSchema>;

export const blockSchema = z.discriminatedUnion('kind', [stepSchema, repeatSchema]);
export type Block = z.infer<typeof blockSchema>;

export const workoutSchema = z.object({
  name: z.string().min(1).max(80),
  blocks: z.array(blockSchema).min(1),
});
export type Workout = z.infer<typeof workoutSchema>;

/*
 * `allSteps` and `hasUnacknowledgedInference` used to live here and were called
 * from nowhere. The second was the dangerous one: it read like the server-side
 * guard that stops an unconfirmed workout being sent, so anyone reading this file
 * would take that guard as implemented. It is not, and cannot be — `source` says
 * where a value came from, not whether a human has agreed to it, and
 * acknowledgement is client state that never crosses the wire. The review screen
 * counts outstanding confirmations itself and is the only thing that gates Send.
 */
