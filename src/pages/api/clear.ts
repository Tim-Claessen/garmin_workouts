import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  clearWorkouts,
  listWorkouts,
  type ClearScope,
  type Credentials,
} from '../../lib/intervals-admin';

export const prerender = false;

function credentials(): Credentials | null {
  const athleteId = env.ICU_ATHLETE_ID;
  const apiKey = env.ICU_API_KEY;
  return athleteId && apiKey ? { athleteId, apiKey } : null;
}

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

  const creds = credentials();
  if (!creds) return json({ error: 'This app is not connected to Intervals.icu yet.' }, 500);

  try {
    const events = await listWorkouts(creds, scope);
    return json({ scope, count: events.length });
  } catch {
    return json({ error: 'Could not reach Intervals.icu.' }, 502);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: { scope?: unknown; confirm?: unknown };
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

  const creds = credentials();
  if (!creds) return json({ error: 'This app is not connected to Intervals.icu yet.' }, 500);

  try {
    const result = await clearWorkouts(creds, scope);
    return json(result);
  } catch {
    return json({ error: 'Could not reach Intervals.icu. Nothing was deleted.' }, 502);
  }
};
