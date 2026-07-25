import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from 'cloudflare:workers';

/**
 * Verifies the Cloudflare Access JWT that Access attaches to every request it
 * lets through.
 *
 * Access already enforces authentication at the edge, so this is defence in
 * depth: it means a request that somehow reaches the Worker by another route
 * still gets rejected. Cloudflare's own dashboard prompts for this whenever an
 * application handles sensitive data, and this one holds an Intervals.icu key
 * that writes to a real training calendar.
 */

// createRemoteJWKSet caches the fetched keys internally, so we hold one instance
// per team domain rather than re-fetching the JWKS on every request.
const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let jwks = jwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeamDomain.set(teamDomain, jwks);
  }
  return jwks;
}

function readToken(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;

  // Browser navigations carry the token as a cookie rather than a header.
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'CF_Authorization') return rest.join('=');
  }
  return null;
}

export type AccessResult =
  | { state: 'valid'; email: string | null }
  | { state: 'missing' }
  | { state: 'invalid'; reason: string };

export async function verifyAccessJwt(
  request: Request,
  teamDomain: string,
  aud: string,
): Promise<AccessResult> {
  const token = readToken(request);
  if (!token) return { state: 'missing' };

  try {
    const { payload } = await jwtVerify(token, jwksFor(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    const email = typeof payload.email === 'string' ? payload.email : null;
    return { state: 'valid', email };
  } catch (error) {
    return {
      state: 'invalid',
      reason: error instanceof Error ? error.message : 'unknown',
    };
  }
}

/**
 * Whether JWT verification is actually switched on. It requires both the team
 * domain and the application's AUD tag; without them we cannot verify anything
 * and the Worker is relying on edge Access alone.
 */
export function accessConfig() {
  // Astro 7 removed Astro.locals.runtime.env; bindings now come from the
  // cloudflare:workers module. Read inside the call, not at module scope.
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  return {
    enforced: Boolean(teamDomain && aud),
    teamDomain,
    aud,
  };
}
