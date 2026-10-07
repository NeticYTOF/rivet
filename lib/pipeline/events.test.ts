const { test } = require("node:test");
const assert = require("node:assert/strict");
const events = require("./events");

test("pipeline trace records stage latency fields", () => {
  const trace = events.start({ programId: "acme", role: "main", addressed: true });
  trace.set({ contextMs: 11, classifyMs: 22, linkMs: 33, answerMs: 44 });
  const result = trace.finish({ finalAction: "reply", reason: "test" });

  assert.equal(result.context_ms, 11);
  assert.equal(result.classify_ms, 22);
  assert.equal(result.link_ms, 33);
  assert.equal(result.answer_ms, 44);
  const rendered = events.format(result);
  assert.match(rendered, /context_ms=11/);
  assert.match(rendered, /classify_ms=22/);
  assert.match(rendered, /link_ms=33/);
  assert.match(rendered, /answer_ms=44/);
});

export {};
