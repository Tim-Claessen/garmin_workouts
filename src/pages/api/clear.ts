import type { APIRoute } from 'astro';
import { resolveAthlete } from '../../lib/roster';
import { clearWorkouts, listWorkouts, type ClearScope } from '../../lib/intervals-admin';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SCOPES: ClearScope[] = ['future', 'past', 'all'];

function readScope(value: unknown): ClearScope | null {
  return SCOPES.includes(value as ClearScope) ? (value as ClearScope) : null;
}

/** Counts what a given scope would remove, so the confirmation can state a number. */
export const GET: APIRoute = async ({ url }) => {
  const scope = readScope(url.searchParams.get('scope'));
  if (!scope) return json({ error: 'Unknown scope.' }, 400);

  const resolved = resolveAthlete(url.searchParams.get('athlete'));
  if (!resolved.ok) return json({ error: resolved.error }, resolved.status);

  try {
    const events = await listWorkouts(resolved.athlete, scope);
    // The label goes back with the count so the confirmation can name whose
    // calendar is about to be emptied.
    return json({ scope, count: events.length, athlete: resolved.athlete.label });
  } catch {
    return json({ error: 'Could not reach Intervals.icu.' }, 502);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: { scope?: unknown; confirm?: unknown; athlete?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Could not read that request.' }, 400);
  }

  const scope = readScope(body.scope);
  if (!scope) return json({ error: 'Unknown scope.' }, 400);

  // The client must echo the scope back as an explicit confirmation. This is
  // irreversible and there is no undo, so a stray POST should not be enough.
  if (body.confirm !== scope) {
    return json({ error: 'That deletion was not confirmed.' }, 400);
  }

  const resolved = resolveAthlete(
    typeof body.athlete === 'string' ? body.athlete : null,
  );
  if (!resolved.ok) return json({ error: resolved.error }, resolved.status);

  try {
    const result = await clearWorkouts(resolved.athlete, scope);
    return json({ ...result, athlete: resolved.athlete.label });
  } catch {
    return json({ error: 'Could not reach Intervals.icu. Nothing was deleted.' }, 502);
  }
};
