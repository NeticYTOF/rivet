import { afterEach, mock, test, expect } from "bun:test";
import { coreTicketSearch } from "./rivetCore";

const originalFetch = global.fetch;

afterEach(() => {
  mock.restore();
  global.fetch = originalFetch;
  delete process.env.RIVET_CORE_BASE_URL;
  delete process.env.RIVET_INTERNAL_TOKEN;
});

test("Core client keeps malformed JSON response fallback", async () => {
  process.env.RIVET_CORE_BASE_URL = "https://core.example";
  process.env.RIVET_INTERNAL_TOKEN = "secret";
  global.fetch = (async () => new Response("{malformed", { status: 200 })) as typeof fetch;

  await expect(coreTicketSearch("program-1")).resolves.toEqual({});
});
