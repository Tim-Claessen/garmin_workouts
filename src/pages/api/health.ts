import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { accessConfig } from '../../lib/access';
import { loadRoster } from '../../lib/roster';

export const prerender = false;

export const GET: APIRoute = () => {
  const config = accessConfig();
  const roster = loadRoster();

  // Deliberately reports configuration state, not values. This endpoint is the
  // Phase 1 gate: reaching it unauthenticated from the public internet is the
  // failure condition, so it must stay behind Access.
  return new Response(
    JSON.stringify({
      ok: true,
      access: config.enforced ? 'enforced' : 'unverified',
      bindings: {
        ai: Boolean(env.AI),
        // Count only — never the labels, which would leak who is configured.
        athletes: roster.ok ? roster.athletes.length : 0,
        roster: roster.ok ? 'ok' : roster.reason,
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
};
