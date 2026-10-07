import { test, expect, afterEach } from "bun:test";
import { timeoutFetch, timeoutFetchJson, REQUEST_TIMEOUT_MS } from "./timeoutFetch";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test("normal request succeeds and resolves the real response", async () => {
  global.fetch = (async (_input, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  const res = await timeoutFetch("https://example.com");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
});

test("timeout aborts a hanging request", async () => {
  global.fetch = ((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    })) as unknown as typeof fetch;

  await expect(timeoutFetch("https://example.com", undefined, 20)).rejects.toThrow();
});

test("existing caller AbortSignal still aborts the request", async () => {
  const controller = new AbortController();
  global.fetch = ((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    })) as unknown as typeof fetch;

  const promise = timeoutFetch("https://example.com", { signal: controller.signal });
  controller.abort(new Error("caller cancelled"));
  await expect(promise).rejects.toThrow();
});

test("timeout still applies when a caller signal exists and never aborts", async () => {
  const controller = new AbortController(); // never aborted by the caller
  global.fetch = ((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    })) as unknown as typeof fetch;

  await expect(
    timeoutFetch("https://example.com", { signal: controller.signal }, 20),
  ).rejects.toThrow();
});

test("timeout rejects when fetch ignores abort", async () => {
  global.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;

  await expect(timeoutFetch("https://example.com", undefined, 20)).rejects.toThrow(/timed out/);
});

test("caller abort rejects when fetch ignores abort", async () => {
  global.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  const controller = new AbortController();
  const request = timeoutFetch("https://example.com", { signal: controller.signal }, 10_000);

  controller.abort(new Error("caller cancelled"));
  await expect(request).rejects.toThrow("caller cancelled");
});

test("body read timeout rejects and cancels an abort-ignoring response stream", async () => {
  let cancelled = false;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => new Promise<{ done: boolean }>(() => {}),
        cancel: async () => { cancelled = true; },
        releaseLock: () => {},
      }),
    },
  })) as unknown as typeof fetch;

  await expect(timeoutFetchJson("https://example.com", undefined, 20)).rejects.toThrow(/timed out/);
  expect(cancelled).toBe(true);
});

test("timeout constant is bounded and reasonable", () => {
  expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
});
