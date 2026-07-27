import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffWorkouts, type Difference } from './compare';
import type { Workout } from '../src/lib/schema';

/**
 * The golden suite. Runs every fixture through the live parse endpoint and
 * reports a pass rate rather than failing the build on any single mismatch,
 * because the parser is a language model and an occasional miss is expected —
 * that is what the review screen is for.
 *
 * It needs a running Worker, since Workers AI is only reachable through the AI
 * binding. Start one and point the suite at it:
 *
 *   npx wrangler dev --port 8787
 *   PARSE_URL=http://127.0.0.1:8787/api/parse npx vitest run parse.golden
 *
 * Without PARSE_URL the suite skips. It is deliberately not part of the default
 * `npm test`, which must stay offline and instant.
 */

const PARSE_URL = process.env.PARSE_URL;
const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');

/** Below this, the prompt needs work before anything else is worth doing. */
const FLOOR_PASS_RATE = 0.5;

interface Fixture {
  name: string;
  input: string;
  expected: Workout;
}

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.txt'))
    .map((file) => {
      const base = file.replace(/\.txt$/, '');
      const expected = JSON.parse(
        readFileSync(join(FIXTURE_DIR, `${base}.expected.json`), 'utf8'),
      ) as Workout & { _why?: string };
      return {
        name: base,
        input: readFileSync(join(FIXTURE_DIR, file), 'utf8'),
        expected,
      };
    });
}

const fixtures = loadFixtures();

describe.skipIf(!PARSE_URL)('parse golden suite', () => {
  const results: { name: string; differences: Difference[]; error?: string }[] = [];

  it(
    'reports a pass rate across every fixture',
    { timeout: 180_000 },
    async () => {
      for (const fixture of fixtures) {
        try {
          const response = await fetch(PARSE_URL!, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: fixture.input }),
          });

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            results.push({
              name: fixture.name,
              differences: [],
              error: `HTTP ${response.status} ${body.slice(0, 200)}`,
            });
            continue;
          }

          const payload = (await response.json()) as { workout: Workout };
          results.push({
            name: fixture.name,
            differences: diffWorkouts(fixture.expected, payload.workout),
          });
        } catch (error) {
          results.push({
            name: fixture.name,
            differences: [],
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
      }

      const passed = results.filter((r) => !r.error && r.differences.length === 0);
      const rate = passed.length / results.length;

      const lines = [
        '',
        `Golden pass rate: ${passed.length}/${results.length} (${Math.round(rate * 100)}%)`,
        '',
      ];
      for (const result of results) {
        if (result.error) {
          lines.push(`  ✗ ${result.name} — request failed: ${result.error}`);
        } else if (result.differences.length === 0) {
          lines.push(`  ✓ ${result.name}`);
        } else {
          lines.push(`  ✗ ${result.name}`);
          for (const difference of result.differences) {
            lines.push(
              `      ${difference.path}: expected ${JSON.stringify(difference.expected)}, got ${JSON.stringify(difference.actual)}`,
            );
          }
        }
      }
      // Written to a file as well as logged: vitest suppresses console output
      // for passing tests, and the pass rate is the whole point of this suite.
      const report = lines.join('\n');
      console.log(report);
      writeFileSync(join(import.meta.dirname, '.last-golden-run.txt'), report, 'utf8');

      // Only the floor fails the build. Anything above it is information for a
      // human, not a gate.
      expect(rate).toBeGreaterThanOrEqual(FLOOR_PASS_RATE);
    },
  );
});

describe('fixtures', () => {
  it('every fixture has an expected file that parses', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(fixture.expected.blocks.length, fixture.name).toBeGreaterThan(0);
    }
  });
});
