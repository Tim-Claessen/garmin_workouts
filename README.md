# Garmin workout builder

Paste a running session as text, check what the parser made of it, and send it to
a Garmin watch. One session at a time, roughly weekly. No accounts, no history,
no database.

The delivery path is **Intervals.icu → Garmin Connect**, not the Garmin API
directly. See [DECISIONS.md](DECISIONS.md) for why.

Nothing reaches Garmin without passing through a human review step where every
value the model inferred has to be confirmed individually.

## How it fits together

```
paste text
   │
   ▼
/api/parse ──► Workers AI (llama-3.3-70b, JSON schema mode)
   │              └─► normalised into the internal schema, then Zod-validated
   ▼
review screen ──► every inferred value acknowledged by hand
   │
   ▼
/api/send ──► Intervals.icu calendar event ──► Garmin Connect ──► watch
```

| Module | Job |
| --- | --- |
| [src/lib/schema.ts](src/lib/schema.ts) | The workout shape. No pace or HR targets, ever |
| [src/lib/validate.ts](src/lib/validate.ts) | Hard range checks that run before display and again before send |
| [src/lib/parse.ts](src/lib/parse.ts) | Prompt, model-facing schema, normalisation. Takes an injected AI runner |
| [src/lib/ai.ts](src/lib/ai.ts) | The only file that touches the AI binding |
| [src/lib/to-intervals.ts](src/lib/to-intervals.ts) | Emits the Intervals.icu description **string** |
| [src/lib/to-plain-english.ts](src/lib/to-plain-english.ts) | The restatement. Never model-generated |
| [src/lib/intervals-admin.ts](src/lib/intervals-admin.ts) | Bulk removal of planned workouts |
| [src/client/review.ts](src/client/review.ts) | The review screen |

## Step cues — your words on the watch

Intervals.icu has **no separate notes field**. `description` is the only free
text and it doubles as the workout syntax, so the pasted session cannot be
shipped through verbatim: any number in it would be parsed as a duration.

What does work is a *cue* — text placed before the duration on a step line, which
Intervals.icu stores as the step's `text` and which shows on the watch mid-run:

```
- threshold effort 0.8km   →   { text: "threshold effort", distance: 800 }
```

So the parser lifts a short label from the athlete's own wording ("threshold",
"jog back", "easy") into `note`, and the emitter puts it in front of the
duration. `sanitiseCue()` strips **every digit** before it goes anywhere near the
description — a number in a cue is the 26-hour failure by another route.

## Athletes

The app can send to more than one Intervals.icu account. The roster is a single
JSON secret, `ICU_ATHLETES`:

```json
[
  { "id": "zoe", "label": "Zoe", "athleteId": "i123456", "apiKey": "…" },
  { "id": "tim", "label": "Tim", "athleteId": "i652699", "apiKey": "…" }
]
```

One secret rather than a pair of bindings per person means adding someone is one
`wrangler secret put` and no code change — and there is still nothing to store,
so the no-database decision holds.

**API keys never leave the Worker.** `/api/athletes` returns ids and labels only;
the client sends an id back and credentials are resolved server-side. An id that
is present but unknown is an error rather than a fallback, because silently
sending to the wrong calendar is worse than failing.

The picker appears only with two or more athletes, and the choice is remembered
in `localStorage`. The original single-athlete bindings still work when
`ICU_ATHLETES` is absent.

Full walkthrough: [docs/adding-an-athlete.md](docs/adding-an-athlete.md).

## Clearing the calendar

The Intervals.icu web interface makes bulk tidying painful, so the paste screen
has a collapsed panel to remove planned workouts: upcoming, past, or all. It
counts first, states the number, and requires a second confirmation.

Two hard limits, both deliberate:

- **Only `category: "WORKOUT"` is ever deleted.** The calendar also holds season
  markers, notes and races that this app did not create.
- **Recorded activities are never touched.** Completed runs live on a different
  endpoint. This removes *planned* workouts only, never training history.

Deleting a planned workout does **not** remove a copy already synced to the
watch.

The confirmation names whose calendar is about to be emptied. With several
athletes configured, that is the only thing standing between a mis-set picker
and someone else's training plan.

## One-time setup

### Intervals.icu → Garmin

1. Create an Intervals.icu account.
2. **Settings → Connections → Garmin Connect** → authorise.
3. Tick **Upload planned workouts**. Without this nothing goes *out* to the
   watch — the connection alone only pulls activities in.
4. Check runs are not excluded by the type filters.

Workouts are pushed roughly **one week ahead** of the current date. Anything
further out sits on the Intervals calendar until it comes into range. That is not
a bug.

### Cloudflare

The Worker is reachable only at `run.timclaessen.com`, behind Cloudflare Access
with an email-OTP policy and a two-address allowlist.

`workers_dev` and `preview_urls` are both `false` in
[wrangler.jsonc](wrangler.jsonc). **Leave them that way.** Either one re-opens a
public hostname that Access does not protect. A dashboard toggle is not enough —
wrangler re-enables `workers.dev` on deploy unless the config says otherwise.

The Worker also verifies the Access JWT on every request, so a request arriving
by any other route is rejected at the application layer too.

### Signing in as someone else

Access has no account switcher. To change which email you are signed in as, use
the **Sign out** link at the foot of the page — it hits
`/cdn-cgi/access/logout`, which clears the Access cookie — then sign in again
with the other address.

The old session stops being accepted within about 30 seconds.

Note this is separate from the **Send to** picker. Signing in as someone else
changes *who is using the app*; the picker changes *whose calendar receives the
workout*. Either can be changed without touching the other.

### Tidying the login page

The Access sign-in page can carry a name, logo, colours and header text:
**Cloudflare One → Reusable components → Custom pages → Access login page →
Manage.** There is a live preview, and the change applies to every Access
application on the account.

It is branding only — the page structure and the OTP flow are fixed.

## Running locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill it in
npm run dev
```

`npm test` is offline and instant. The golden suite needs a running Worker,
because Workers AI is only reachable through the binding:

```bash
npx wrangler dev --port 8788
PARSE_URL=http://127.0.0.1:8788/api/parse npx vitest run parse.golden
```

It writes `tests/.last-golden-run.txt` with the pass rate and every mismatch.

> Local dev shares the rate limit. If the golden suite starts returning 429,
> stop the dev server and delete `.wrangler/state/v3/kv`.

## Node version

[.nvmrc](.nvmrc) pins Node 24, and it matters.

Cloudflare Workers Builds defaults to **Node 22.16.0 / npm 10.9.2**. A
`package-lock.json` generated by npm 11 resolves the peer dependencies of the
`wasm32` optional packages (`@emnapi/core`, `@emnapi/runtime`, pulled in through
sharp via miniflare) differently from npm 10, and `npm ci` fails the build with
"can only install packages when your package.json and package-lock.json are in
sync".

So CI and local development must run the same npm major. If you regenerate the
lockfile, do it on Node 24.

## Deploying

**Deployment happens through Cloudflare Workers Builds on push to `main`.**
Do not deploy from the command line. Two deploy paths racing over which version
is live is worse than a slightly slower one.

The pipeline is configured in the dashboard under **Settings → Build**:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**The build command is not optional and cannot be moved into the repo.** The
Cloudflare adapter generates its entrypoint and a redirected config
(`dist/server/wrangler.json`) during the build, and wrangler resolves `main`
when it loads configuration — before any `build.command` in `wrangler.jsonc`
could run. So a `build` block there does not help: the build executes but
wrangler has already resolved `main` against the root config and fails with
"entry-point file was not found". The build genuinely has to be a separate,
earlier step.

`npm run deploy` still exists for emergencies — a broken CI pipeline with a fix
that has to ship. If you use it, use *that*, never `wrangler deploy` alone: the
Cloudflare adapter generates a second config at `dist/server/wrangler.json`
during the build and wrangler deploys that one, so deploying without rebuilding
silently ships stale configuration.

Rerun `npm run cf-types` after changing bindings in `wrangler.jsonc`.

## Rotating secrets

Secrets live on the Worker, not in this repo.

| Secret | Where it comes from | How to rotate |
| --- | --- | --- |
| `ICU_ATHLETES` | Intervals.icu → Settings → Developer, per athlete | Regenerate the key there, then rewrite the whole array with `npx wrangler secret put ICU_ATHLETES` |
| `ACCESS_AUD` | Zero Trust → Access controls → Applications → the app → Overview | Changes only if the Access application is recreated |

`ACCESS_TEAM_DOMAIN` is a plain var in [wrangler.jsonc](wrangler.jsonc) — it
appears in every Access redirect and is not a credential.

`ICU_ATHLETE_ID` and `ICU_API_KEY` are the original single-athlete bindings.
They still work, but `ICU_ATHLETES` supersedes them and takes precedence.

To list what is set:

```bash
npx wrangler secret list --name garmin-workouts
```

Note that a var and a secret cannot share a name. If `wrangler secret put` fails
with "binding name already in use", the name exists as a plain var and must be
removed from `wrangler.jsonc` first.

## The thing most likely to bite you

In Intervals.icu syntax **`m` means minutes**. Metres are `mtr`. Writing `400m`
for a 400 metre rep produces a 400-*minute* step — a 26-hour workout that the API
accepts with HTTP 200 and no warning.

[src/lib/to-intervals.ts](src/lib/to-intervals.ts) therefore never emits a bare
number followed by `m` for a distance; everything goes out as `km`, and a test
asserts it. See [docs/intervals-syntax.md](docs/intervals-syntax.md) for the
captured payloads.

## TODO

### Onboarding Zoe

- [ ] Work through [docs/adding-an-athlete.md](docs/adding-an-athlete.md) for her
      account, then add her to `ICU_ATHLETES`.
- [ ] Add her email to the Access policy if she will open the app herself.
- [ ] Write `docs/for-zoe.md` — three sentences: build it the night before, open
      Garmin Connect to sync, the lap button skips to the next step.

### Quality

- [ ] **Replace the synthetic fixtures with real sessions** from her program.
      They currently cover the failure modes we predicted, not necessarily the
      ones that occur. The golden suite picks up any `.txt` with a matching
      `.expected.json`, so adding one is a two-file change.
- [ ] Fixture 05 fails: "finish with an easy 10" reads as a distance rather than
      10 minutes. Genuinely ambiguous in the source text — left failing on
      purpose rather than tuned away.
- [ ] No accessibility pass beyond focus rings, 44px targets and contrast.

### If it gets more use

- [ ] Whether a lap-press placeholder can be trivially small (`1s`) rather than
      2km. Would stop placeholders inflating planned-load figures.
- [ ] Nothing caches the athlete roster; every page load re-reads the secret.
      Fine at this volume.
