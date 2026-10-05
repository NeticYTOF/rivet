import { test, expect } from "bun:test";
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "loadout", "program.json");

interface LoadoutSource {
  name: string;
  type?: string;
  url?: string;
}

interface LoadoutProgram {
  id: string;
  scope?: string;
  channels?: string[];
  sources: LoadoutSource[];
  pinnedRules: string[];
}

function loadout(): LoadoutProgram {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as LoadoutProgram;
}

test("every LOADOUT source points at a file that exists", () => {
  const missing = loadout()
    .sources.filter((s) => (s.url || "").startsWith("file://"))
    .map((s) => ({ name: s.name, path: s.url!.replace("file://", "") }))
    .filter((s) => !fs.existsSync(path.join(ROOT, s.path)));
  expect(missing).toEqual([]);
});

test("every LOADOUT source is a named markdown file inside the repo", () => {
  for (const source of loadout().sources) {
    expect(source.name).toBeTruthy();
    expect(source.type).toBe("markdown");
    expect(source.url!.startsWith("file://loadout/corpus/")).toBe(true);
  }
});

test("the LOADOUT program stays inert until channels are claimed", () => {
  const program = loadout();
  expect(program.scope).toBe("program");
  expect(program.channels ?? []).toEqual([]);
});

test("LOADOUT pins the economy rules that the corpus is graded on", () => {
  const rules = loadout().pinnedRules.join("\n");
  expect(rules).toContain("Cores");
  expect(rules).toContain("25%");
  expect(rules).toContain("Compute");
  expect(rules).toContain("Research");
});

test("the corpus states the currency and discount rule in prose, not only in config", () => {
  const corpus = fs.readFileSync(path.join(ROOT, "loadout", "corpus", "02-tracks.md"), "utf8").toLowerCase();
  expect(corpus).toContain("cores");
  expect(corpus).toContain("25%");
  expect(corpus).toContain("every 3 levels");
});

test("the corpus never reintroduces the superseded Bolts model", () => {
  const corpusDir = path.join(ROOT, "loadout", "corpus");
  const offenders = fs
    .readdirSync(corpusDir)
    .filter((f) => f.endsWith(".md") && f !== "08-public-copy.md")
    .filter((f) => /\bbolts?\b/i.test(fs.readFileSync(path.join(corpusDir, f), "utf8")));
  expect(offenders).toEqual([]);
});
