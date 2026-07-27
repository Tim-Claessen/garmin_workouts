import type { Block, Step, Workout } from './schema';

/**
 * Converts a validated workout into an Intervals.icu calendar event.
 *
 * The critical thing, established in the Test 0.4 spike: Intervals.icu does not
 * accept a structured step tree over the API. You POST a `description` written in
 * their plain-text workout syntax and the server parses it into `workout_doc` on
 * save. So this module's real output is a *string*.
 *
 * See docs/intervals-syntax.md for the captured payloads.
 */

/**
 * In Intervals.icu syntax `m` means MINUTES. Metres are `mtr`. Writing `400m`
 * for a 400 metre rep silently produces a 400-minute step — a 26-hour workout
 * that the API accepts with HTTP 200 and no warning.
 *
 * This module therefore never emits a bare number followed by `m`. Distances go
 * out as `km` and times as `s` or a value suffixed `m` only when it genuinely is
 * minutes. Keeping that rule here, in one function, is what makes the failure
 * structurally unreachable rather than merely tested for.
 */
export function formatDistance(metres: number): string {
  const km = metres / 1000;
  // Three decimals covers metre precision; trailing zeros are stripped so 2000m
  // reads as "2km" rather than "2.000km".
  const trimmed = Number(km.toFixed(3)).toString();
  return `${trimmed}km`;
}

export function formatTime(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  // Anything not a whole number of minutes goes out in seconds. `s` is
  // unambiguous, so this avoids the m/mtr trap entirely for sub-minute and
  // awkward values alike.
  return `${seconds}s`;
}

export function formatStep(step: Step): string {
  const duration =
    step.duration.kind === 'time'
      ? formatTime(step.duration.seconds)
      : formatDistance(step.duration.metres);

  // The literal text "Press lap" is what sets `until_lap_press: true` when
  // Intervals.icu parses the description. The duration is still required and
  // acts as a placeholder the lap press overrides.
  const prefix = step.untilLapPress ? 'Press lap ' : '';
  return `- ${prefix}${duration}`;
}

/**
 * Section headers are not decoration. Intervals.icu derives `warmup: true` and
 * `cooldown: true` from the header text, not from anything on the step line, so
 * a warm-up step must sit under a header reading "Warmup".
 */
function headerFor(block: Block): string {
  if (block.kind === 'repeat') return `Main set ${block.reps}x`;
  switch (block.type) {
    case 'warmup':
      return 'Warmup';
    case 'cooldown':
      return 'Cooldown';
    case 'recover':
      return 'Recovery';
    case 'rest':
      return 'Rest';
    default:
      return 'Main set';
  }
}

export function toDescription(workout: Workout): string {
  const sections = workout.blocks.map((block) => {
    const header = headerFor(block);
    const lines =
      block.kind === 'step'
        ? [formatStep(block)]
        : block.steps.map((step) => formatStep(step));
    return [header, ...lines].join('\n');
  });

  // Intervals.icu requires a blank line before and after every repeat block.
  // Separating every section with one satisfies that and stays readable.
  return sections.join('\n\n');
}

export interface IntervalsEvent {
  category: 'WORKOUT';
  type: 'Run';
  name: string;
  start_date_local: string;
  description: string;
}

/**
 * @param date calendar date in YYYY-MM-DD. Intervals.icu wants a local datetime;
 *   midnight is used because these are planned workouts with no set start time.
 */
export function toIntervalsEvent(workout: Workout, date: string): IntervalsEvent {
  return {
    category: 'WORKOUT',
    type: 'Run',
    name: workout.name,
    start_date_local: `${date}T00:00:00`,
    description: toDescription(workout),
  };
}
