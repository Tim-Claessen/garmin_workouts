import { env } from 'cloudflare:workers';
import type { AiRunner } from './parse';

/**
 * The real Workers AI runner. Isolated here so that parse.ts stays importable
 * outside the Workers runtime, and so that swapping Workers AI for AI Gateway
 * later is a change to this file alone.
 */
export const runAI: AiRunner = (model, input) =>
  env.AI.run(model as never, input as never) as Promise<unknown>;
