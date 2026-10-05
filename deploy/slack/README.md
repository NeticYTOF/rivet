# Putting Rivet in a Slack workspace

Operator runbook for a single-workspace Rivet deployment on Railway. Every claim
below cites `path:line` in this repo or names the Slack admin screen it comes
from. Where a value is workspace-specific it is written as a placeholder — no
value in this file is invented.

Steps 1–4 happen once. Steps 5–7 are what you re-run after any env or code
change.

---

## 1. Create the Slack app from the generated manifest

Command names are derived from `RIVET_BOT_SLUG` (`lib/brand.ts:20-28`), and the
bot registers its listeners from the same slug. Generating the manifest rather
than writing it is what keeps the two in step — an app advertising
`/sol-teach` while the process listens for `/rivet-teach` fails silently, with
no error anywhere (`scripts/manifest.cjs:9-12`).

```sh
bun install
RIVET_BOT_NAME="Sol" RIVET_BOT_SLUG=sol bun run manifest
```

`RIVET_BOT_NAME` becomes the display name; `RIVET_BOT_SLUG` becomes every slash
command (`/sol`, `/sol-teach`, `/sol-gaps`, …). **Slash command names are unique
per workspace** — two apps cannot both own `/sol`, so if the prefix is taken the
second app fails to install (`.env.example:39-43`).

In Slack:

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
   **From a manifest** → choose the workspace → paste the JSON.
2. **Install to Workspace.**

That single manifest sets, for you:

| Setting | Value | Where in the manifest |
| --- | --- | --- |
| Bot scopes | the 14 in `BOT_SCOPES` | `scripts/manifest.cjs:17-35`, emitted at `:96` |
| Bot events | the 8 in `BOT_EVENTS` | `scripts/manifest.cjs:37-46` |
| Slash commands | the 12 in `COMMANDS` | `scripts/manifest.cjs:50-63`, emitted at `:76-81` |
| Socket Mode | on | `scripts/manifest.cjs:102` |
| Interactivity | on | `scripts/manifest.cjs:99` |

Regenerate and re-apply the manifest if you change the slug or the scope list —
the token's scopes are fixed at install time from `oauth_config.scopes.bot`
(`scripts/manifest.cjs:96`). Adding a program never touches the manifest.

## 2. Copy the two tokens

They are not interchangeable and they come from different screens.

| Variable | Slack screen | Prefix | Scope that matters |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | **OAuth & Permissions** → **Bot User OAuth Token** | `xoxb-` | the bot scopes from step 1 |
| `SLACK_APP_TOKEN` | **Basic Information** → **App-Level Tokens** → **Generate** | `xapp-` | `connections:write` |

`SLACK_APP_TOKEN` is what authorises the Socket Mode connection itself; without
`connections:write` the process opens no connection and nothing arrives at all
(`.env.example:12-16`).

**Socket Mode means no ingress.** The bot dials out to Slack over a websocket and
listens on no port (`index.ts:67`, `socketMode: true`), so there is no public
URL, no domain, no tunnel, and no healthcheck — `Dockerfile:17` says so and
`railway.json` defines no port. The `RIVET_WEB_PORT` you may see referenced
(default `4100`, `lib/config.ts:364`) is the optional local web console, not how
Slack reaches the bot.

## 3. Collect the channel IDs

Right-click the channel in Slack → **View channel details**; the **ID** is at the
bottom of that panel. Names will not work (`.env.example:18-24`).

You need two different values:

- `SLACK_HELP_CHANNEL` — one ID. Every top-level message in it gets a reply.
- `SLACK_FAQ_CHANNELS` — comma-separated IDs the bot watches. The **first** entry
  is the auto-reply channel: the one where the bot answers without being
  mentioned (`lib/config.ts:163`, `:320`).

## 4. Set the variables on the service

Railway: service → **Variables**. The engine refuses to boot without the five
below and names every one that is missing rather than degrading into silent
fallbacks at answer time (`lib/config.ts:388`, `:392-401`, called at `index.ts:32`).

| Variable | Required | Where the value comes from |
| --- | --- | --- |
| `OPENCODE_API_KEY` | yes | model pool key. `MODEL_VARS` (`lib/config.ts:30`) — `_2`, `_3`… rotate (`lib/config.ts:192-194`) |
| `SLACK_BOT_TOKEN` | yes | step 2 |
| `SLACK_APP_TOKEN` | yes | step 2 |
| `SLACK_HELP_CHANNEL` | yes | step 3 |
| `SLACK_FAQ_CHANNELS` | yes | step 3 |
| `HCAI_API_KEY` | no | Hack Club AI key for the hosted tier (`.env.example:30-32`); the first tier of the model cascade (`lib/config.ts:327-336`) |
| `RIVET_PROGRAMS_JSON` | no, but nothing to answer from without it | the program JSON **inline as a value**, not a path — step 5 |
| `RIVET_BOT_NAME` | no | step 1 |
| `RIVET_BOT_SLUG` | no | step 1. Must match the installed app exactly |
| `RIVET_ADMIN_USER_IDS` | no | your Slack user ID — profile → three dots → **Copy member ID**. **Fails closed**: empty means nobody can teach the bot anything (`.env.example:45-48`) |
| `RIVET_DB_PATH` | no | point at a volume, e.g. `/data/rivet.db` (`.env.example:78-83`) |
| `RIVET_WORKSPACE_ID` | no | Slack team id, for tenant boundaries on a hosted deployment |

Attach a volume mounted at `/data` **before the first deploy finishes**: the bot
opens its database on boot (`index.ts:33`), so a volume attached afterwards means
the first run wrote to a path that then disappeared. Without one, every redeploy
discards the answer cache, everything taught, ticket records, and the last-good
copy of the docs.

`bun scripts/slack-bootstrap.mjs` writes a `.env` skeleton with the required
names, prints the manifest, and lists the manual steps. It reads no environment
variable *values* and never prints a secret, and it refuses to overwrite an
existing `.env` (`scripts/slack-bootstrap.mjs:8-22`).

## 5. Give it something to answer from

`RIVET_PROGRAMS_JSON` is `JSON.parse`d straight from the variable
(`lib/programs.ts:161-176`) — it is the JSON itself, not a filename. Accepted
shapes are an array or an object with a `programs` array; entries without an
`id` are dropped (`lib/programs.ts:178-193`).

For this repo's bundled LOADOUT program, inline it:

```sh
bun -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("loadout/program.json","utf8"));console.log(JSON.stringify([p]))'
```

Two things to know about that file before you deploy it as-is:

- Its seven sources are `file://` URLs (`loadout/program.json:31-67`), resolved
  under the app root and refused if they escape it
  (`lib/knowledge.ts:226-233`). `Dockerfile:15` copies the whole repo into
  `/app`, so `file://loadout/corpus/…` does resolve in the image — but a
  deployment that ships only `lib/` will load zero sources.
- It has **no** `channels` and no `helpChannel` (`loadout/README.md:34`), so it
  owns no channel and `channelPolicy.resolve()` returns the `shared` program with
  role `none` on every channel (`lib/channelPolicy.ts:36-44`) — the bot stays
  silent. Add `"channels": ["C…"]` and `"helpChannel": "C…"` using the IDs from
  step 3.

A source that loads but has nothing about your question produces a decline, not
an invention — that is the intended behaviour (`lib/respond.ts:452-457`).

## 6. Read the boot log

Railway: service → **Deployments** → latest → **Logs**. A healthy boot ends with
these three lines, in this order:

```
[rivet/db] opened /data/rivet.db
[rivet/knowledge] corpus refreshed — 7/7 sources loaded
[rivet/bot] connected via Socket Mode as U01ABCDEF
```

- `[rivet/db] opened …` — `lib/db.ts:270`, on its way to `index.ts:33`. Before
  it, one `[rivet/db] migrated: <column>` line per schema addition is normal and
  only happens once per database.
- `corpus refreshed — N/M sources loaded` — `lib/knowledge.ts:1060`. **`N` must
  equal `M`.** `0/0` means nothing is configured to answer from; `3/7` means
  four sources failed, and the reason is on a `[rivet/knowledge] failed to fetch
  "<name>": …` line just above (`lib/knowledge.ts:741-745`).
- `connected via Socket Mode as U…` — `index.ts:106`, printed after `app.start()`
  (`index.ts:103`) and `auth.test` (`lib/config.ts:403-407`). The `U…` is the bot
  user id. If this line is missing, the process did not finish starting.

`missing required environment variable: …` anywhere in the log means step 4 is
incomplete — the message names the exact variables (`lib/config.ts:395-398`).

## 7. Smoke test the deployment

The build being green only means the process started. Prove the bot answers.

```sh
bun run smoke
```

`bun run smoke` is `node scripts/smoke-test.js` (`package.json:13`). It reads the
**live** service variables over Railway's GraphQL API
(`scripts/smoke-test.js:121-133`), so it tests what is deployed, not what is in
your shell.

It needs four shell variables of its own
(`scripts/smoke-test.js:19-24`):

| Variable | Where to get it |
| --- | --- |
| `RAILWAY_TOKEN` | [railway.com/account/tokens](https://railway.com/account/tokens), account-scoped (`scripts/migrate-railway.mjs:19`) |
| `RAILWAY_PROJECT_ID` | Railway project → **Settings** |
| `RAILWAY_ENVIRONMENT_ID` | Railway project → **Settings** → the environment |
| `RAILWAY_SERVICE_ID` | the Rivet service's **Settings** tab |

Checks run in order and it exits on the first hard failure:

1. `[1/4]` the latest deployment's log contains `connected via Socket Mode`
   (`scripts/smoke-test.js:168-203`).
2. `[2/4]` the engine loads a program and sees its sources under the new env
   (`scripts/smoke-test.js:241-268`).
3. `[3/4]` `auth.test` against the deployed `SLACK_BOT_TOKEN` — right team, right
   bot (`scripts/smoke-test.js:508-531`).
4. `[4/4]` **the bot actually answers.** Checks 1–3 all pass on a bot that boots
   and then declines everything, because nothing has asked it a question yet.
   This one loads the configured program, asserts its sources load, then runs the
   engine's own `--ask` path (`index.ts:152`) and requires a *grounded* answer —
   non-empty, from a real source, and not one of the bot's declines. Grounding is
   judged by `lib/respond.isGroundedAnswer` (`lib/respond.ts:142-170`), the same
   function the bot uses on itself, so the two cannot drift.

The default question is `what is the program's currency?`, which the bundled
LOADOUT corpus answers (`loadout/corpus/03-economy.md:3`,
`loadout/corpus/02-tracks.md:21`). For a different program, point it at something
your docs cover:

```sh
RIVET_SMOKE_QUESTION="how do I submit my project" RIVET_SMOKE_PROGRAM=myprogram bun run smoke
```

Check 4 needs `bun` on your PATH and a `RIVET_PROGRAMS_JSON` with a `sources`
array on the service. When either is missing it prints `SKIP:` with the reason and
what to do about it, and moves on (`scripts/smoke-test.js:381-427`) — it never
passes silently.

### If check 4 fails

| Message | Meaning |
| --- | --- |
| `declares N source(s) and loaded none of them` | the source URLs are wrong, or the files they point at are not in the image. Check step 6's `corpus refreshed` line for the per-source reason. |
| `the bot declined …` | the sources loaded but did not answer the question. Either the question is not in your corpus, or a source is the wrong document. Wording is not asserted, so this is not a phrasing fluke. |
| `--ask failed` with `missing required environment variable` | step 4 is incomplete; the message names the variable. |

### Verify in Slack

Once the smoke test passes, in the workspace:

- `/sol-sources` — what loaded and when it last refreshed.
- `/sol <question>` — a private answer, no channel clutter. The question is the
  whole argument: `/sol what is the deadline`, not `/sol ask what is the
  deadline` — there is no `ask` subcommand.
- Post in the help channel — every top-level message gets a reply there.

If a command silently does nothing, suspect a slug mismatch between the installed
app and `RIVET_BOT_SLUG`, not Slack. If `/sol-sources` is the only thing that
answers, the program is loaded but owns no channels — step 5.