// Requests via the platform `fetch` have no timeout by default — if a
// remote host is unreachable in a way that doesn't fail fast (DNS black
// hole, a firewall silently dropping packets, a paused/degraded upstream)
// the underlying request never settles. Anywhere that's `await`ed directly
// in a server component, layout, or route handler, that turns into the
// entire page/request hanging forever with no error surfaced. Bound every
// such request so a network failure turns into a thrown error instead of
// an infinite hang.
//
// This lives in its own module (not lib/db.ts) because several test files
// replace "@/lib/db" wholesale via bun's `mock.module`, which
// patches the module registry for the whole test run — any other import of
// that same resolved path (including this file's own tests) would get the
// fake module instead of the real exports.
export const REQUEST_TIMEOUT_MS = 10_000;

function createDeadline(timeoutMs: number, callerSignal?: AbortSignal) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let callerAborted = false;
  let onCallerAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = (reason: unknown) => reject(reason ?? new DOMException("The operation was aborted.", "AbortError"));
    onCallerAbort = () => {
      callerAborted = true;
      controller.abort(callerSignal?.reason);
      rejectAbort(callerSignal?.reason);
    };
    if (callerSignal?.aborted) {
      onCallerAbort();
      return;
    }
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      const error = new Error(`request timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  return {
    controller,
    aborted,
    get timedOut() { return timedOut; },
    get callerAborted() { return callerAborted; },
    cleanup() {
      if (timer) clearTimeout(timer);
      if (onCallerAbort) callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

// `timeoutMs` defaults to REQUEST_TIMEOUT_MS; tests override it to keep timeout
// cases fast. The same deadline covers headers and response-body parsing.
export function timeoutFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const deadline = createDeadline(timeoutMs, init?.signal || undefined);
  if (deadline.callerAborted) return deadline.aborted;
  const request = fetch(input, { ...init, signal: deadline.controller.signal });
  return Promise.race([request, deadline.aborted]).finally(deadline.cleanup);
}

export async function timeoutFetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; body: unknown }> {
  const deadline = createDeadline(timeoutMs, init?.signal || undefined);
  if (deadline.callerAborted) return deadline.aborted;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await Promise.race([
      fetch(input, { ...init, signal: deadline.controller.signal }),
      deadline.aborted,
    ]);
    let text = "";
    if (response.body) {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await Promise.race([reader.read(), deadline.aborted]);
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }

    let body: unknown = {};
    try {
      body = JSON.parse(text);
    } catch {
      // Match the previous res.json().catch(() => ({})) behavior for malformed or empty JSON.
    }
    return { response, body };
  } finally {
    deadline.cleanup();
    if (reader) {
      if (deadline.timedOut || deadline.callerAborted) {
        void reader.cancel().catch(() => undefined);
      }
      try {
        reader.releaseLock();
      } catch {
        // A timed-out read can still be pending while its stream is cancelled.
      }
    }
  }
}
