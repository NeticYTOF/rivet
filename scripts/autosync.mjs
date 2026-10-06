// One-way autosync: pull merged remote commits into this working copy.
//
// Deliberately ONE-WAY. This never pushes. Local commits are never discarded,
// never reset away, and never overwritten. If the remote cannot be merged
// cleanly, it says so and does nothing rather than trying to force it.
//
//   node scripts/autosync.mjs            # one pass, then exit
//   node scripts/autosync.mjs --watch    # loop forever, default 120s interval
//
// Env:
//   AUTOSYNC_INTERVAL_MS  poll interval in watch mode (default 120000)

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTERVAL_MS = Number(process.env.AUTOSYNC_INTERVAL_MS) || 120_000;
const WATCH = process.argv.includes("--watch");

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function safeGit(args) {
  try {
    return { ok: true, out: git(args) };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message).trim() };
  }
}

export function syncOnce({ log = console.log } = {}) {
  const before = safeGit(["rev-parse", "HEAD"]);
  if (!before.ok) {
    log(`[autosync] cannot read HEAD - skipping`);
    return { status: "error" };
  }

  const fetched = safeGit(["fetch", "origin", "--quiet"]);
  if (!fetched.ok) {
    // Offline, bad creds, repo moved: expected, not alarming. Stay quiet-ish.
    log(`[autosync] fetch failed - will retry`);
    return { status: "fetch-failed" };
  }

  const upstream = safeGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream.ok) {
    log(`[autosync] no upstream tracking branch - skipping`);
    return { status: "no-upstream" };
  }

  const counts = safeGit(["rev-list", "--left-right", "--count", `HEAD...${upstream.out}`]);
  if (!counts.ok) return { status: "error" };
  const [ahead, behind] = counts.out.split(/\s+/).map((n) => Number(n) || 0);

  if (behind === 0) {
    return { status: "up-to-date", ahead };
  }

  // Never clobber: an uncommitted change to a file the remote also touched
  // would fail the merge below anyway, so detect it up front and say so
  // rather than reporting a confusing conflict.
  const dirty = safeGit(["status", "--porcelain"]);
  if (dirty.ok && dirty.out.trim()) {
    const dirtyFiles = dirty.out
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    const incoming = safeGit(["diff", "--name-only", "HEAD", `HEAD..${upstream.out}`]);
    const incomingFiles = incoming.ok ? incoming.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    const clash = dirtyFiles.filter((f) => incomingFiles.includes(f));
    if (clash.length) {
      log(`[autosync] SKIPPED - ${behind} new commit(s) but local edits conflict: ${clash.join(", ")}`);
      log(`[autosync] commit or stash your changes, then it will sync`);
      return { status: "blocked", behind, clash };
    }
  }

  // --ff-only guarantees this can only fast-forward. If history has diverged
  // it fails instead of creating a merge commit, which is what we want: the
  // human decides how to reconcile.
  const merged = safeGit(["merge", "--ff-only", upstream.out]);
  if (!merged.ok) {
    log(`[autosync] SKIPPED - ${behind} new commit(s) but cannot fast-forward`);
    log(`[autosync] local is ahead by ${ahead}; resolve manually`);
    return { status: "diverged", behind, ahead };
  }

  const after = safeGit(["rev-parse", "HEAD"]);
  if (after.out === before.out) {
    return { status: "up-to-date", ahead };
  }

  const subject = safeGit(["log", "-1", "--pretty=%s"]);
  const newCommits = safeGit(["log", `--oneline`, `${before.out}..${after.out}`]);
  const lines = newCommits.ok ? newCommits.out.split("\n").filter(Boolean) : [];
  log(`[autosync] synced ${lines.length} commit(s):`);
  for (const line of lines.slice(0, 10)) log(`  ${line}`);
  if (lines.length > 10) log(`  ...and ${lines.length - 10} more`);
  log(`[autosync] HEAD now ${after.out.slice(0, 8)} - ${subject.out}`);
  return { status: "synced", count: lines.length, head: after.out };
}

// Compare resolved paths, not strings: on Windows process.argv[1] is often
// relative ("scripts/autosync.mjs"), so a file:// string comparison never
// matches and the script silently does nothing.
const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(ROOT, process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  syncOnce();
  if (!WATCH) process.exit(0);
  const tick = () => {
    try {
      syncOnce();
    } catch (error) {
      console.error(`[autosync] unexpected: ${error instanceof Error ? error.message : String(error)}`);
    }
    setTimeout(tick, INTERVAL_MS);
  };
  setTimeout(tick, INTERVAL_MS);
}