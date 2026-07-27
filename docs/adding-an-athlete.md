# Adding an athlete

Everything needed to get a new person's workouts reaching their watch. Budget
twenty minutes, most of it waiting for Garmin to sync.

You need their Intervals.icu login to hand, or them sitting next to you — steps
1 to 4 happen in their account, not yours.

---

## 1. Create the Intervals.icu account

Go to [intervals.icu](https://intervals.icu) and sign up. It is free. Signing in
with Google or Strava is fine.

Set the account's **units** to metric under Settings, unless they genuinely think
in miles. The app sends metric and Intervals.icu will convert for display, but
matching avoids confusion when checking a workout looks right.

## 2. Connect Garmin

In their Intervals.icu account:

1. **Settings → Connections → Garmin Connect**
2. **Authorise.** Garmin shows a permission screen — accept it.
3. Tick **Upload planned workouts**.

**Step 3 is the one people miss.** Without it the connection only pulls
activities *in* from Garmin. Nothing goes *out*, and workouts will never reach
the watch no matter how correct they look on the calendar.

While you are there, check the type filters are not excluding runs.

### Check the watch can take structured workouts

Structured workouts need a Forerunner 255/265/955/965-class device or newer,
a Fenix 6 or later, an Epix 2, a Venu 3, or an Edge 530/830 or later. A
Forerunner 235 or Vivoactive 3 **will not accept them**, and no amount of
software fixes that.

## 3. Gather the two values

Both are on **Settings → Developer** in their Intervals.icu account.

| Value | Looks like | Notes |
| --- | --- | --- |
| **Athlete ID** | `i123456` | The leading `i` is part of it. Also visible in the URL when viewing their calendar |
| **API key** | a long random string | Treat it as a password. It can create and delete calendar entries |

## 4. Confirm it works before touching the app

Worth two minutes, because it separates "Intervals.icu is not set up" from "the
app has a bug".

Hand-build a workout on their calendar for tomorrow:

```
Warmup
- Press lap 2km

Main set 6x
- 800mtr
- 90s

Cooldown
- Press lap 2km
```

Save it, open Garmin Connect on their phone, let it sync, and check the workout
appears under **Training → Workouts** on the watch.

If it does not arrive, the problem is in steps 2 or 3. Do not continue until it
does.

> `m` means **minutes** in Intervals.icu syntax. Metres are `mtr`. Writing
> `800m` creates an 800-minute step and the site accepts it without complaint.

## 5. Add them to the app

Athletes live in one secret, `ICU_ATHLETES`, holding a JSON array. Adding
someone means rewriting that secret with the full list — there is no
add-one command.

```bash
npx wrangler secret put ICU_ATHLETES --name garmin-workouts
```

Paste the whole array when prompted:

```json
[
  { "id": "zoe", "label": "Zoe", "athleteId": "i123456", "apiKey": "her-api-key" },
  { "id": "tim", "label": "Tim", "athleteId": "i652699", "apiKey": "his-api-key" }
]
```

| Field | Rules |
| --- | --- |
| `id` | Lower-case letters, numbers and hyphens. Never shown; changing it resets whoever the browser had remembered |
| `label` | What appears in the picker |
| `athleteId` | From step 3, including the leading `i` |
| `apiKey` | From step 3 |

The picker only appears once there are **two or more** athletes. With one, the
app just uses it.

Changes take effect on the next request. No redeploy.

## 6. Give them access to the app, if they need it

Only required if they will open the app themselves. If you build sessions on
their behalf, skip this.

**Cloudflare dashboard → Zero Trust → Access controls → Policies →
`garmin-builder-allowlist`** → add their email address under the **Emails**
selector.

Use `Emails`, not `Emails ending in` — a domain rule would let in anyone at that
domain.

They will be asked for a one-time PIN by email the first time, and roughly
monthly after that.

## 7. Check it end to end

1. Open the app, pick them in **Send to**
2. Paste a short session and convert it
3. Confirm anything amber, then send it to tomorrow
4. Open Garmin Connect on their phone and sync
5. Confirm it lands on the watch

## 8. Tell them the one thing that bites

**The lap button always advances to the next step.** Pressing it out of habit
mid-interval skips that interval. Warm-ups and cool-downs are deliberately
open-ended and wait for that press — everything else runs to its own duration.

---

## Removing someone

Rewrite `ICU_ATHLETES` without them and remove their email from the Access
policy. Their Intervals.icu account and anything already on their watch are
unaffected — revoke the app's access from their side by regenerating their API
key in Intervals.icu.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| "No athletes are set up yet" | `ICU_ATHLETES` is missing, and no legacy `ICU_ATHLETE_ID`/`ICU_API_KEY` either |
| "The athlete list is misconfigured" | The secret is not valid JSON, or an entry is missing a field |
| Picker missing with several athletes set up | The secret did not save — re-run `wrangler secret put` |
| Workout on the Intervals calendar but not the watch | **Upload planned workouts** unticked, or it is more than a week out. Intervals.icu only pushes about seven days ahead |
| Sent to the wrong person | Check **Send to** before sending. The success message names whose calendar it went to |
