const { test } = require("node:test");
const assert = require("node:assert/strict");

let startAfterReady: any;
try {
  startAfterReady = require("./startup").startAfterReady;
} catch (_) {
  startAfterReady = null;
}

test("Slack does not connect until the initial corpus work is complete", async () => {
  assert.equal(typeof startAfterReady, "function");

  const order: string[] = [];
  let finishInitialWork!: () => void;
  const initialWork = new Promise<void>((resolve) => {
    finishInitialWork = () => {
      order.push("corpus ready");
      resolve();
    };
  });
  const connecting = startAfterReady(initialWork, async () => {
    order.push("Socket Mode connected");
  });

  assert.deepEqual(order, []);
  finishInitialWork();
  await connecting;
  assert.deepEqual(order, ["corpus ready", "Socket Mode connected"]);
});

test("Socket Mode starts after the configured corpus readiness deadline", async () => {
  let finishInitialWork!: () => void;
  let started = false;
  let timedOut = false;
  const initialWork = new Promise<void>((resolve) => {
    finishInitialWork = resolve;
  });
  const connecting = startAfterReady(
    initialWork,
    async () => {
      started = true;
    },
    { timeoutMs: 5, onTimeout: () => (timedOut = true) },
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  const startedBeforeCorpusReady = started;
  finishInitialWork();
  await connecting;

  assert.equal(startedBeforeCorpusReady, true);
  assert.equal(timedOut, true);
});

export {};
