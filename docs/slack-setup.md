# Slack setup

From a fresh clone to a bot answering in Slack. Every step below is grounded in
the code; where a claim could not be verified in this repository it is marked
**unverified**.

The mechanical half of this is one command:

```sh
bun install
bun scripts/slack-bootstrap.mjs
```

It writes a `.env` skeleton with empty values (refusing to touch an existing
`.env`), prints the Slack app manifest, and prints the remaining manual steps.
The rest of this document is what it cannot do for you.

For a fork you intend to keep current, see [self-hosting.md](self-hosting.md)
instead — this page is the Slack half only.

---

## 1. Generate the manifest, never write it by hand

`scripts/manifest.cjs` is the single source of truth for scopes, bot events, and
the twelve slash commands. Read it as JSON:

```sh
bun run manifest
```

It reads `RIVET_BOT_NAME` and `RIVET_BOT_SLUG` from the environment
(`lib/brand.ts:12-24`) and builds every command name from the slug
(`lib/brand.ts:26-28`), which is the same function `lib/commands.ts:756-771`
uses to register the listeners.

The header comment of `scripts/manifest.cjs` states the failure mode directly
(`scripts/manifest.cjs:9-12`): command names come from `RIVET_BOT_SLUG`, and
hand-editing a manifest is how you end up with an app advertising
`/sol-teach` while the process listens for `/rivet-teach` — a failure with no
error anywhere, because Slack is perfectly happy with a command nobody handles.
The manifest is not documentation of the bot; it is what Slack is told exists.

Consequences worth knowing before you pick a slug:

- **Slash command names are unique per workspace.** Two apps cannot both own
  `/rivet`; the second fails to install. Rename now, not later
  (`.env.example:36-37`).
- **Regenerate after changing the slug.** A manifest generated with one slug and
  an app configured with another is exactly the silent failure above. The bot
  token's scope list is also fixed at install time from
  `oauth_config.scopes.bot` (`scripts/manifest.cjs:96`), so changing
  `BOT_SCOPES` needs a manifest re-apply, not just a restart.

## 2. Create the app from that manifest

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
   **From a manifest** → choose your workspace → paste the JSON from
   `bun run manifest`.
2. **Install to Workspace.**

Socket Mode is already on in the generated manifest
(`scripts/manifest.cjs:101-102`, `socket_mode_enabled: true`, with a comment
noting it must stay true).

## 3. The two tokens are not interchangeable

| | Where it comes from | Variable | Prefix |
| --- | --- | --- | --- |
| Bot token | OAuth & Permissions → Bot User OAuth Token | `SLACK_BOT_TOKEN` | `xoxb-` |
| App-level token | Basic Information → App-Level Tokens → Generate | `SLACK_APP_TOKEN` | `xapp-` |

The app-level token needs the **`connections:write`** scope
(`.env.example:12-13`); that is what authorises the Socket Mode connection
itself. Without it the process cannot open a Socket Mode connection, so nothing
arrives at all.

**Socket Mode means no ingress.** The bot dials out to Slack over a websocket and
listens on no port, so there is no public URL, no domain, no tunnel and no
reverse proxy to configure (`.env.example:14-15`, `scripts/manifest.cjs:101`).
The port you may see referenced elsewhere (`RIVET_WEB_PORT`, default `4100`, at
`lib/config.ts:364` and `lib/web/serve.ts:1083`) is the optional local web
console, not how Slack reaches the bot.

## 4. Required environment variables

`validate()` in `lib/config.ts:392-401` throws at startup, naming everything
absent, rather than degrading into silent fallbacks at answer time. The required
set is `MODEL_VARS` plus `SLACK_VARS` (`lib/config.ts:29-30`, `lib/config.ts:387-390`):

| Variable | What it is |
| --- | --- |
| `OPENCODE_API_KEY` | model pool key (`lib/config.ts:30`); `_2`, `_3`… rotate (`lib/config.ts:192-194`) |
| `SLACK_BOT_TOKEN` | the bot token from step 3 |
| `SLACK_APP_TOKEN` | the app-level token from step 3 |
| `SLACK_HELP_CHANNEL` | channel **ID** that always gets a reply to every top-level message (`.env.example:18-20`) |
| `SLACK_FAQ_CHANNELS` | comma-separated channel IDs the bot watches; the **first** entry is the auto-reply channel (`lib/config.ts:163`, `lib/config.ts:320`) |

Channel IDs, not names: right-click a channel → View channel details → the ID is
at the bottom (`.env.example:18-20`).

> **Known contradiction.** `.env.example` does not mention `OPENCODE_API_KEY`
> anywhere, and lists `HCAI_API_KEY` as required (`.env.example:26-27`) — but
> `HCAI_API_KEY` is *not* in `MODEL_VARS`, so filling in `.env.example` exactly
> as written still fails `validate()` with `missing required environment
> variable: OPENCODE_API_KEY` (verified by running `validate()` with
> `.env.example`'s five "required" values set). `deploy/staging/env.staging.example:17-18`
> lists both. Treat `OPENCODE_API_KEY` as required; `HCAI_API_KEY` is a real
> provider key but not a boot requirement. `docs/self-hosting.md:17-19` also
> describes Hack Club AI as "the sole provider", which the multi-tier cascade in
> `lib/config.ts` does not match.

## 5. Give it something to answer from

Rivet answers from a program corpus. With no program configured, `programs.all()`
is empty and there is no knowledge to retrieve.

`RIVET_PROGRAMS_JSON` takes the program's JSON **inline as a value** — it is
`JSON.parse`d straight from the variable (`lib/programs.ts:160-176`). It is not
a path to a file. Setting it to `loadout/program.json` logs
`RIVET_PROGRAMS_JSON is not valid JSON … — falling back to files` and configures
zero programs (verified by running the loader that way). Accepted shapes are an
array, or an object with a `programs` array (`lib/programs.ts:178-188`); entries
without an `id` are dropped (`lib/programs.ts:190-193`).

To run this repo's bundled LOADOUT program, inline its contents:

```sh
bun -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("loadout/program.json","utf8"));console.log(JSON.stringify([p]))'
```

Paste that single line into `.env` as the value of `RIVET_PROGRAMS_JSON`.

Two things to know about that file:

- Its sources are `file://` URLs (`loadout/program.json`, seven entries under
  `sources`) resolved relative to the app root and refused if they escape it
  (`lib/knowledge.ts:73`, `lib/knowledge.ts:226-233`), so they only work from
  this checkout — not from a deploy with the file absent.
- It has **no** `channels` and no `helpChannel` (verified by reading the file's
  keys). As shipped, the program owns no channels, and `channelPolicy.resolve()`
  on any channel returns the `shared` program with role `none`, not LOADOUT
  (verified by running `channelPolicy.resolve()` with it loaded). Add
  `"channels": ["C…"]` and `"helpChannel": "C…"` — matching your `channels` —
  or the bot will be silent everywhere. After adding them, `resolve()` on that
  channel returns the LOADOUT program with role `help` (verified).

Channel *ownership* is separate from `SLACK_FAQ_CHANNELS`: `isMainChannel()` also
accepts any channel in `config.slack.faqChannels` (`lib/channelPolicy.ts:8-14`),
so a program with `channels` set behaves correctly on the channel you named in
step 4.

## 6. Verify without Slack

```sh
bun index.ts --ask "how do i get started"
```

`--ask` runs `validate({ needsSlack: false })` (`index.ts:132-135`), so it needs
the model key but none of the four Slack variables — you can prove retrieval and
answering work before the app exists. It builds the corpus and prints what the
bot would have said.

## 7. Smoke test in Slack

Start the bot with all five required variables set:

```sh
bun index.ts
```

Then, in Slack:

- `/rivet-sources` — what loaded and when it last refreshed
  (`lib/commands.ts:760`).
- `/rivet <question>` — a private answer, no channel clutter
  (`lib/commands.ts:759`; the manifest's usage hint is `[question]`,
  `scripts/manifest.cjs:51`). The question is the whole argument: `/rivet what is
  the deadline`, not `/rivet ask what is the deadline` — there is no `ask`
  subcommand, and the bare word would just be searched for.
- Post in the help channel — every top-level message gets a reply there.

If a command silently does nothing, suspect a slug mismatch between the app and
`RIVET_BOT_SLUG`, not Slack. If `/rivet-sources` is the only thing that answers,
the program is loaded but owns no channels (step 5).

---

## Footguns in the web console, verified in this codebase

Both concern the optional web console (`lib/web/serve.ts`), not the Slack path.
They matter only if you start the console during setup.

**1. `SLACK_CLIENT_ID=dev-testing` is a developer bypass — and it takes two
variables to arm.** `handleAuth()` issues a signed admin session cookie with no
credential at all (`lib/web/serve.ts:377-381`), and `isAdminSession()` grants
that session admin rights (`lib/web/auth.ts:118-127`). The gate is
`devAuthEnabled()`, which requires **both** `SLACK_CLIENT_ID === "dev-testing"`
**and** `NODE_ENV === "development"` (`lib/web/auth.ts:14-16`) — the sentinel
client ID alone does nothing, which is the deliberate design noted at
`lib/web/auth.ts:11-13`. The footgun is the pair: set both in a real deployment
and every visitor is an admin. Never ship `NODE_ENV=development`.

**2. `RIVET_DASHBOARD_PASSCODE` is fail-closed, not a default.** An unset
passcode resolves to `null` (`lib/web/serve.ts:367-371`) and passcode login is
refused outright with a 503 and an error naming the variable
(`lib/web/serve.ts:384-388`) — there is no guessable default password. Set
`RIVET_DASHBOARD_PASSCODE` to anything before running the console, and note
that with `SLACK_CLIENT_ID` unset there is no Slack login to fall back to
(`lib/web/serve.ts:1077-1081`), so an unconfigured passcode means the console is
simply closed rather than quietly open.

Neither variable appears in `.env.example` — verified by grepping it: it
documents neither `RIVET_DASHBOARD_PASSCODE` nor `NODE_ENV`. If you start the
console, read `lib/web/serve.ts:363-402` before assuming anything about who can
get in.

> These two were weaker earlier in this repo's history: the passcode used to
> fall back to the literal `"rivet"`, and the sentinel client ID alone unlocked
> admin. Both are fixed in the current tree; this note is here because older
> forks and older write-ups still describe the old behaviour.

## Unverified

- The exact Slack UI labels and click-paths change with Slack's admin console;
  only the app-manifest flow and the two token locations are confirmed by this
  repository (`.env.example:9-16`, `scripts/manifest.cjs:7`).
- Whether Slack still permits more than one app per workspace owning
  `/rivet`-style command names is Slack-side policy, not code.