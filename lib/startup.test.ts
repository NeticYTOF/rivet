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

export {};
