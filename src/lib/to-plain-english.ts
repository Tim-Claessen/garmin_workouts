import type { Block, Pace, Step, Workout } from './schema';

/**
 * A plain-English restatement of the structured workout, generated on the client
 * from the data itself rather than from the model. It exists so the meaning of
 * the workout can be checked in one read, without decoding a step stack.
 *
 * It must never be produced by an LLM: the whole point is that it reflects
 * exactly what will be sent, so that a mis-parse reads as obviously wrong.
 */

function describeDuration(step: Step): string {
  if (step.untilLapPress) return 'until you press lap';

  if (step.duration.kind === 'distance') {
    const metres = step.duration.metres;
    return metres >= 1000
      ? `${Number((metres / 1000).toFixed(2))}km`
      : `${metres}m`;
  }

  const seconds = step.duration.seconds;
  // Recoveries are spoken in seconds — "90s recovery", not "1m30s" — because
  // that is how sessions are written and how runners think about them. Only
  // once past two minutes does a minute figure read more naturally.
  if (seconds < 120) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function clock(secondsPerKm: number): string {
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
}

/**
 * Spoken as a range from slower to faster, matching both the order the step line
 * is written in and the order the fields appear in the sheet. An en dash rather
 * than the hyphen the payload uses, because this is prose.
 */
function describePace(pace: Pace | undefined): string {
  if (!pace) return '';
  const slower = clock(pace.slowerSecondsPerKm);
  const faster = clock(pace.fasterSecondsPerKm);
  const range = slower === faster ? slower : `${slower}–${faster}`;
  return ` at ${range} per km`;
}

const VERB: Record<Step['type'], string> = {
  warmup: 'warm up',
  run: 'run',
  recover: 'recover',
  rest: 'rest',
  cooldown: 'cool down',
};

function describeStep(step: Step): string {
  const duration = describeDuration(step);
  const pace = describePace(step.pace);
  const verb = VERB[step.type];

  if (step.untilLapPress) return `${verb} ${duration}${pace}`;
  if (step.type === 'run') return `${duration}${pace}`;
  return `${verb} for ${duration}${pace}`;
}

function describeBlock(block: Block): string {
  if (block.kind === 'step') return describeStep(block);

  const parts = block.steps.map((step) => describeStep(step));

  // The common shape is effort + recovery, which reads best as
  // "6 × 800m with 90s recovery" rather than as two clauses.
  //
  // Not when the recovery carries a pace of its own, though: this branch speaks
  // the recovery through describeDuration and would silently drop it, leaving a
  // restatement that no longer matches what gets sent. That is the one thing this
  // file exists to prevent, so an unusual recovery falls back to the long form.
  const second = block.steps[1];
  if (
    block.steps.length === 2 &&
    second &&
    (second.type === 'recover' || second.type === 'rest') &&
    !second.untilLapPress &&
    !second.pace
  ) {
    const noun = second.type === 'recover' ? 'recovery' : 'rest';
    return `${block.reps} × ${parts[0]} with ${describeDuration(second)} ${noun}`;
  }

  return `${block.reps} × ${parts.join(', then ')}`;
}

export function toPlainEnglish(workout: Workout): string {
  if (workout.blocks.length === 0) return 'This workout has no steps.';

  const clauses = workout.blocks.map((block) => describeBlock(block));
  const sentence =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', then ')}, then ${clauses[clauses.length - 1]}`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
