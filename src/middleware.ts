import { defineMiddleware } from 'astro:middleware';
import { accessConfig, verifyAccessJwt } from './lib/access';

/**
 * Rejects anything that did not come through Cloudflare Access.
 *
 * If ACCESS_AUD is not set we cannot verify, so this passes the request through
 * and the app relies on edge Access alone. That is not a safe steady state —
 * /api/health reports `access: "unverified"` so the gap is visible rather than
 * silent.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const config = accessConfig();

  if (!config.enforced) {
    context.locals.accessEmail = null;
    return next();
  }

  const result = await verifyAccessJwt(
    context.request,
    config.teamDomain!,
    config.aud!,
  );

  if (result.state !== 'valid') {
    return new Response('Forbidden', {
      status: 403,
      headers: { 'content-type': 'text/plain' },
    });
  }

  context.locals.accessEmail = result.email;
  return next();
});
