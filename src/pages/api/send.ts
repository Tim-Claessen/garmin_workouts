import type { APIRoute } from 'astro';
import { resolveAthlete } from '../../lib/roster';
import { workoutSchema } from '../../lib/schema';
import { toDescription, toIntervalsEvent } from '../../lib/to-intervals';
import { validateWorkout } from '../../lib/validate';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const POST: APIRoute = async ({ request }) => {
  let body: { workout?: unknown; date?: unknown; athlete?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Could not read that request.' }, 400);
  }

  const parsed = workoutSchema.safeParse(body.workout);
  if (!parsed.success) {
    return json({ error: 'That workout is not in a shape we can send.' }, 400);
  }

  const date = typeof body.date === 'string' ? body.date : '';
  if (!DATE_PATTERN.test(date)) {
    return json({ error: 'Pick a date first.' }, 400);
  }

  // Revalidate server-side. The client already did, but nothing reaches Garmin
  // on the strength of a check that ran in a browser.
  const errors = validateWorkout(parsed.data);
  if (errors.length > 0) {
    return json({ error: errors[0]!.message, validationErrors: errors }, 422);
  }

  const resolved = resolveAthlete(
    typeof body.athlete === 'string' ? body.athlete : null,
  );
  if (!resolved.ok) return json({ error: resolved.error }, resolved.status);
  const { athleteId, apiKey, label } = resolved.athlete;

  const event = toIntervalsEvent(parsed.data, date);

  let response: Response;
  try {
    response = await fetch(
      `https://intervals.icu/api/v1/athlete/${athleteId}/events`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Basic auth with the literal username "API_KEY".
          authorization: `Basic ${btoa(`API_KEY:${apiKey}`)}`,
        },
        body: JSON.stringify(event),
      },
    );
  } catch {
    return json(
      { error: "Could not reach Intervals.icu. Check your connection and try again." },
      502,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return json(
      {
        // Errors name what broke and what to do, per the style guide. The
        // description is included because a unit mistake is the likeliest cause
        // and it is visible in the text we sent.
        error: `Intervals.icu did not accept this (${response.status}). The workout was sent as:\n\n${toDescription(parsed.data)}`,
        detail: detail.slice(0, 400),
      },
      502,
    );
  }

  const created = (await response.json().catch(() => ({}))) as { id?: number };

  return json({
    ok: true,
    eventId: created.id ?? null,
    date,
    // Echoed back so the success state can name who it went to. Sending to the
    // wrong calendar should be obvious immediately, not discovered on a run.
    athlete: label,
    description: event.description,
  });
};
