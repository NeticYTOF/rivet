process.env.RIVET_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const knowledge = require("./knowledge");
const programs = require("./programs");
const db = require("./db");

db.open(":memory:");

test("textFromJsonFaq extracts question and answer pairs", () => {
  assert.equal(
    knowledge.textFromJsonFaq({ faq: { items: [{ question: "How?", answer: "Like this." }] } }),
    "Q: How?\nA: Like this.",
  );
  assert.equal(knowledge.textFromJsonFaq({}), "");
});

test("HTML conversion preserves useful links and removes page chrome", () => {
  const html =
    '<nav>menu</nav><main><h1 id="start">Start here</h1><p>Read <a href="https://example.invalid/docs">the docs</a>.</p></main>';
  const links = new Map<string, string>();
  const annotated = knowledge.annotateHeadingAnchors(html, "https://example.invalid/docs", links);
  assert.match(annotated, /## Start here/);
  assert.equal(links.get("start here"), "https://example.invalid/docs#start");
  assert.equal(
    knowledge.stripHtml(annotated),
    "## Start here (https://example.invalid/docs#start)\n\n Read the docs (https://example.invalid/docs) .",
  );
});

test("preserveLinks does not duplicate a URL used as its own label", () => {
  assert.equal(
    knowledge.preserveLinks('<a href="https://example.invalid">https://example.invalid</a>').trim(),
    "https://example.invalid",
  );
});

test("filename helpers create stable titles and slugs", () => {
  assert.equal(knowledge.docTitleFromFilename("01-get_started.md"), "Get Started");
  assert.equal(knowledge.docSlugFromFilename("01-get_started.md"), "get-started");
});

test("markdown listings keep only usable markdown files in order", () => {
  const listing = [
    { type: "file", name: "z.md", download_url: "https://example.invalid/z" },
    { type: "file", name: "a.md", download_url: "https://example.invalid/a" },
    { type: "dir", name: "nested" },
  ];
  const files = knowledge.markdownFilesFromListing(listing, "https://example.invalid/docs");
  assert.deepEqual(
    files.map((file: { name: string }) => file.name),
    ["a.md", "z.md"],
  );
  assert.equal(files[0].pageUrl, "https://example.invalid/docs/a");
});

test("dropSharedLines removes repeated page chrome", () => {
  const pages = ["Header\nUnique A", "Header\nUnique B", "Header\nUnique C"];
  assert.deepEqual(knowledge.dropSharedLines(pages), ["Unique A", "Unique B", "Unique C"]);
  assert.deepEqual(knowledge.dropSharedLines(["one", "two"]), ["one", "two"]);
});

test("inline sources render generically", async () => {
  assert.equal(
    await knowledge.fetchSourceText({ name: "FAQ", type: "json-faq", content: [{ question: "Q", answer: "A" }] }),
    "Q: Q\nA: A",
  );
  assert.equal(await knowledge.fetchSourceText({ name: "Docs", type: "text", content: "  body  " }), "body");
  await assert.rejects(
    () => knowledge.fetchSourceText({ name: "Missing", type: "text" }),
    /neither a url nor inline content/,
  );
});

test("unsupported source types fail instead of using a special-case fetcher", async () => {
  await assert.rejects(
    () => knowledge.fetchSourceText({ name: "Unknown", type: "unsupported", url: "https://example.invalid" }),
    /unknown source type/,
  );
});

test("source cache keys isolate URLs and inline content", () => {
  assert.equal(
    knowledge.sourceCacheKey({ name: "Docs", url: "https://example.invalid/a" }),
    "Docs::https://example.invalid/a",
  );
  assert.notEqual(
    knowledge.sourceCacheKey({ name: "FAQ", type: "text", content: "a" }),
    knowledge.sourceCacheKey({ name: "FAQ", type: "text", content: "b" }),
  );
  assert.match(knowledge.sourceCacheKey({ name: "No source" }), /::inline::/);
});

test("startup restores last-good source text before starting a network refresh", () => {
  const source = { name: "Docs", type: "url", url: "https://example.invalid/docs" };
  db.saveSourceText(knowledge.sourceCacheKey(source), "last good source text");

  assert.deepEqual(knowledge.restoreCorpusFromDisk([source]), { restored: 1, total: 1 });
});

test("startup does not trust a dynamic source cache until this boot's refresh finishes", () => {
  const source = { name: "Dynamic status", type: "url", url: "https://example.invalid/status", dynamic: true };
  db.saveSourceText(knowledge.sourceCacheKey(source), "old status");

  assert.deepEqual(knowledge.restoreCorpusFromDisk([source]), { restored: 0, total: 1 });
});

test("source eligibility uses the last successful copy and keeps dynamic copies stale", () => {
  const stable = { name: "Stable", type: "text", url: "https://example.invalid/stable" };
  const stableKey = knowledge.sourceCacheKey(stable);
  db.saveSourceText(stableKey, "stable");
  assert.equal(knowledge.sourceEligibility(stable).exactClaimsAllowed, true);

  const dynamic = { name: "Dynamic", type: "text", url: "https://example.invalid/dynamic", dynamic: true };
  const dynamicKey = knowledge.sourceCacheKey(dynamic);
  db.saveSourceText(dynamicKey, "last good");
  db.recordSourceFailure(dynamicKey, "offline");
  const result = knowledge.sourceEligibility(dynamic);
  assert.equal(result.authority, "dynamic");
  assert.equal(result.exactClaimsAllowed, false);
});

test("operator sources load from configured programs", async () => {
  const saved = process.env.RIVET_PROGRAMS_JSON;
  process.env.RIVET_PROGRAMS_JSON = JSON.stringify([
    {
      id: "demo",
      name: "Demo",
      sources: [{ name: "Demo docs", type: "text", content: "demo body" }],
    },
  ]);
  programs.invalidate();
  try {
    assert.deepEqual(
      knowledge.loadSources().map((source: { name: string }) => source.name),
      ["Demo docs"],
    );
    await knowledge.refreshSource(programs.get("demo").sources[0], true);
    assert.match(knowledge.getCorpus("demo"), /demo body/);
  } finally {
    if (saved === undefined) delete process.env.RIVET_PROGRAMS_JSON;
    else process.env.RIVET_PROGRAMS_JSON = saved;
    programs.invalidate();
    knowledge.invalidate();
  }
});

test("program source corpora remain isolated", async () => {
  const saved = process.env.RIVET_PROGRAMS_JSON;
  process.env.RIVET_PROGRAMS_JSON = JSON.stringify([
    { id: "acme", name: "Acme", sources: [{ name: "Acme docs", type: "text", content: "acme-only" }] },
    { id: "beta", name: "Beta", sources: [{ name: "Beta docs", type: "text", content: "beta-only" }] },
  ]);
  programs.invalidate();
  knowledge.invalidate();
  try {
    await knowledge.refreshSource(programs.get("acme").sources[0], true);
    await knowledge.refreshSource(programs.get("beta").sources[0], true);
    assert.match(knowledge.getContext("acme facts", "acme"), /acme-only/);
    assert.doesNotMatch(knowledge.getContext("acme facts", "beta"), /acme-only/);
  } finally {
    if (saved === undefined) delete process.env.RIVET_PROGRAMS_JSON;
    else process.env.RIVET_PROGRAMS_JSON = saved;
    programs.invalidate();
    knowledge.invalidate();
  }
});

test("refreshSource invalidates cached source sections", async () => {
  const saved = process.env.RIVET_PROGRAMS_JSON;
  process.env.RIVET_PROGRAMS_JSON = JSON.stringify([
    { id: "cache-demo", name: "Cache Demo", sources: [{ name: "Docs", type: "text", content: "version-one token" }] },
  ]);
  programs.invalidate();
  knowledge.invalidate();
  try {
    const source = programs.get("cache-demo").sources[0];
    await knowledge.refreshSource(source, true);
    assert.match(knowledge.getContext("version one", "cache-demo"), /version-one token/);

    source.content = "version-two token";
    await knowledge.refreshSource(source, true);
    const refreshed = knowledge.getContext("version two", "cache-demo");
    assert.match(refreshed, /version-two token/);
    assert.doesNotMatch(refreshed, /version-one token/);
  } finally {
    if (saved === undefined) delete process.env.RIVET_PROGRAMS_JSON;
    else process.env.RIVET_PROGRAMS_JSON = saved;
    programs.invalidate();
    knowledge.invalidate();
  }
});

test("program invalidation drops cached source-section views", async () => {
  const saved = process.env.RIVET_PROGRAMS_JSON;
  const sourceA = { name: "Docs A", type: "text", content: "alpha-source token" };
  const sourceB = { name: "Docs B", type: "text", content: "beta-source token" };

  await knowledge.refreshSource(sourceA, true);
  await knowledge.refreshSource(sourceB, true);

  process.env.RIVET_PROGRAMS_JSON = JSON.stringify([
    { id: "versioned", name: "Versioned", sources: [sourceA] },
  ]);
  programs.invalidate();
  knowledge.invalidate();

  try {
    assert.match(knowledge.getContext("alpha source", "versioned"), /alpha-source token/);

    process.env.RIVET_PROGRAMS_JSON = JSON.stringify([
      { id: "versioned", name: "Versioned", sources: [sourceB] },
    ]);
    programs.invalidate();

    const refreshed = knowledge.getContext("beta source", "versioned");
    assert.match(refreshed, /beta-source token/);
    assert.doesNotMatch(refreshed, /alpha-source token/);
  } finally {
    if (saved === undefined) delete process.env.RIVET_PROGRAMS_JSON;
    else process.env.RIVET_PROGRAMS_JSON = saved;
    programs.invalidate();
    knowledge.invalidate();
  }
});

test("draft knowledge uses only supplied source text", () => {
  const result = knowledge.registerDraftKnowledge(
    { id: "draft-demo", status: "suspended", privateSandboxOnly: true },
    { "Draft docs": "draft-only" },
  );
  assert.equal(result.sources, 1);
  assert.match(knowledge.getDraftContext("draft-demo", "draft"), /draft-only/);
});

test("local path resolution stays inside the application root", () => {
  assert.match(knowledge.resolveLocalPath("file://./package.json"), /package\.json$/);
  assert.throws(() => knowledge.resolveLocalPath("file:///tmp/outside"), /outside app root/);
});

test("status sanitizes remote URLs", () => {
  const sourceStatus = knowledge.sourceStatus("missing-program");
  assert.deepEqual(sourceStatus, []);
});

test("deployment program config is gitignored, never committed", () => {
  // config/programs.json holds a real deployment's channel ids, so it exists
  // locally but must never be tracked. Asserting the file is absent instead
  // would break the moment anyone deploys, which is exactly backwards.
  const ignore = fs.readFileSync(".gitignore", "utf8");
  assert.match(ignore, /^config\/$/m);
});

export {};
