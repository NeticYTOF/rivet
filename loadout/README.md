# Rivet × LOADOUT

Rivet is configured here as the helper bot for **LOADOUT**, the YSWS where every project levels you up as a builder. Everything a builder asks in `#loadout` is answered from `corpus/`, so Rivet stays grounded in the actual program rules instead of improvising.

## What is in here

- `program.json` — the drop-in program config: sources, pinned rules, links, escalation behaviour.
- `corpus/01-program.md` — what LOADOUT is, the loop, Digital vs Physical Loadout.
- `corpus/02-tracks.md` — the five tracks, levels, and how level-based discounts work.
- `corpus/03-economy.md` — Cores, the four quality dimensions, bonuses, the AI cap.
- `corpus/04-shop.md` — shop categories, shop suggestions, Custom Orders.
- `corpus/05-eligibility.md` — what counts as a project, higher/lower fit examples, unconfirmed data.
- `corpus/06-timeline.md` — timeline, where to find people, feedback the maintainers want.
- `corpus/07-faq.md` — the same facts as Q&A, for phrasing that matches a question.
- `corpus/08-public-copy.md` — tightened Slack Canvas and website copy. Not a bot source; reference material.

## Wire it up

**Option A — env var.** Point `RIVET_PROGRAMS_JSON` at this file's contents:

```powershell
$env:RIVET_PROGRAMS_JSON = (Get-Content .\loadout\program.json -Raw)
bun index.ts
```

**Option B — file.** Copy the program into `config/programs.json` (Rivet reads that file by default) or merge it into an existing array there. Env config takes precedence over the file.

Then claim the LOADOUT channels so events resolve to the program:

```
/rivet-program channels add C0000000000,C1111111111
```

`program.json` ships with `"scope": "program"` and no channels, so it stays inert until channels are claimed — adding the config cannot make Rivet answer in unrelated channels.

## Ground rules the bot enforces

`pinnedRules` in `program.json` plus `requireGroundedAnswer` are what stop Rivet from confidently getting LOADOUT wrong. The load-bearing ones:

- Cores are the currency. Rivet will not say Bolts, XP, or points.
- Five tracks: Compute, Systems, Hardware, Build, Research.
- Every 3 levels earns a track reduction coupon, capped at 25%.
- Dates, eligibility, prices, inventory, sponsors, and participation numbers are unconfirmed and must never be stated as fact.
- Rivet must not fall back to the superseded Bolts / four-track / Requisition model.

Because `requireGroundedAnswer` is on, a question the corpus does not cover produces an "I don't have that confirmed" and a ticket for a human maintainer, rather than a plausible-sounding invention. That is the intended behaviour — an unanswerable question should reach a maintainer, not get guessed at.

## Editing the corpus

Edit the markdown, then force a refresh:

```
/rivet-sources
/rivet-reload
```

Rivet re-reads `file://` sources from disk, so no restart is needed. Every 3 levels of your own track level, and every Cores change, is a maintainer decision — do not edit the economy numbers without the maintainers confirming them first.

## Site discrepancy to be aware of

The public site at `loadout-jerry-team1.vercel.app` currently describes the **superseded** model: four tracks (Tools, Systems, Compute, Hardware), Bolts as the currency, and Requisition milestones at LV.3 / 6 / 9 / 12 / 15. This corpus follows the newer draft instead: five tracks including Build and Research, Cores, and a 25%-capped reduction coupon every 3 levels. Until the site catches up, a builder who reads the site and then asks Rivet will see two different answers — flag that to the maintainers rather than papering over it.
