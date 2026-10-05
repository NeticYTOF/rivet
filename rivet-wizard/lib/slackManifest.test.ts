import { test, expect } from "bun:test";
import { slugify } from "./slackManifest";

test("slugify mirrors the engine's own rule", () => {
  expect(slugify("Solvable! YSWS (2026)")).toBe("solvable-ysws-2026");
  expect(slugify("!!!")).toBe("rivet");
});

test("slugify falls back to rivet when nothing alphanumeric survives", () => {
  expect(slugify("")).toBe("rivet");
  expect(slugify("---")).toBe("rivet");
});
