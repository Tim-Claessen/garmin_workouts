import type { APIRoute } from 'astro';
import { runAI } from '../../lib/ai';
import { parseWorkout } from '../../lib/parse';
import { checkParseRateLimit, PARSE_LIMIT_PER_HOUR } from '../../lib/rate-limit';
import { toPlainEnglish } from '../../lib/to-plain-english';

export const prerender = false;

const MAX_INPUT_CHARS = 4000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  let text: string;
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text : '';
  } catch {
    return json({ error: 'Could not read that request.' }, 400);
  }

  if (!text.trim()) {
    return json({ error: 'Paste a session first.' }, 400);
  }

  if (text.length > MAX_INPUT_CHARS) {
    return json(
      { error: `That is longer than ${MAX_INPUT_CHARS} characters. Paste one session at a time.` },
      413,
    );
  }

  // Access gives us a verified email; fall back to IP only if verification is
  // switched off, so the limit still applies rather than silently vanishing.
  // Astro.clientAddress is not implemented by the Cloudflare adapter, so the
  // address comes from the header Cloudflare sets.
  const identity =
    locals.accessEmail ?? request.headers.get('cf-connecting-ip') ?? 'anonymous';
  const limit = await checkParseRateLimit(identity);
  if (!limit.allowed) {
    return json(
      {
        error: `That is ${PARSE_LIMIT_PER_HOUR} conversions this hour, which is the limit. Try again in about ${Math.ceil(limit.resetIn / 60)} minutes.`,
      },
      429,
    );
  }

  const result = await parseWorkout(text, runAI);

  if (!result.ok) {
    const message =
      result.reason === 'model_error'
        ? 'The parser did not respond. Try again in a moment.'
        : 'That could not be read as a running session. Check the text and try again.';
    return json({ error: message, reason: result.reason }, 502);
  }

  return json({
    workout: result.workout,
    validationErrors: result.validationErrors,
    plainEnglish: toPlainEnglish(result.workout),
    remaining: limit.remaining,
  });
};
