import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { accessConfig } from '../../lib/access';

export const prerender = false;

export const GET: APIRoute = () => {
  const config = accessConfig();

  // Deliberately reports configuration state, not values. This endpoint is the
  // Phase 1 gate: reaching it unauthenticated from the public internet is the
  // failure condition, so it must stay behind Access.
  return new Response(
    JSON.stringify({
      ok: true,
      access: config.enforced ? 'enforced' : 'unverified',
      bindings: {
        ai: Boolean(env.AI),
        icu: Boolean(env.ICU_ATHLETE_ID && env.ICU_API_KEY),
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
};
