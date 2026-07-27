import type { APIRoute } from 'astro';
import { toPublic } from '../../lib/athletes';
import { loadRoster } from '../../lib/roster';

export const prerender = false;

/**
 * The picker's data source. Returns ids and labels only — API keys never leave
 * the Worker.
 */
export const GET: APIRoute = () => {
  const roster = loadRoster();

  if (!roster.ok) {
    const error =
      roster.reason === 'none_configured'
        ? 'No athletes are set up yet.'
        : 'The athlete list is misconfigured.';
    return new Response(JSON.stringify({ error, athletes: [] }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ athletes: roster.athletes.map(toPublic) }), {
    headers: { 'content-type': 'application/json' },
  });
};
