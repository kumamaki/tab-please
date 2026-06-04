// Parser fixtures — prove each format adapter still parses real-world `--help`.
//
//   bun tests/parser-fixtures.ts
//
// Fixtures under tests/fixtures/<tool>/<page>.txt are committed snapshots of a
// real CLI's help (captured once, never hand-edited). The test runs the REAL
// detector (detectAdapter) on each tool's root page to prove format routing,
// then parses every page with that format's adapter and asserts the result is
// non-degenerate (enough subcommands/flags that we know it actually parsed).
//
// This is the freshness guard for the *parsers*: if an adapter regresses, or a
// new CLI release reshapes a help format we claim to support, this goes red —
// without needing any CLI installed in CI (the fixtures are the input).
//
// Adding a tool: capture `tool --help` (+ a representative subcommand) into
// tests/fixtures/<tool>/, then add an entry below with conservative floors.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectAdapter, loadAdapter } from "../generator/parse.ts";

type Page = { file: string; minSubs: number; minFlags: number };
type Fixture = { tool: string; format: string; pages: Page[] };

// Floors are ~half the captured counts: meaningful (a broken adapter collapses
// to ~0) yet robust to a CLI dropping a flag between recaptures.
const FIXTURES: Fixture[] = [
  { tool: "claude", format: "commander", pages: [
    { file: "root.txt", minSubs: 8, minFlags: 30 },
    { file: "mcp.txt", minSubs: 4, minFlags: 0 },
  ] },
  { tool: "wrangler", format: "yargs", pages: [
    { file: "root.txt", minSubs: 25, minFlags: 3 },
    { file: "kv.txt", minSubs: 2, minFlags: 3 },
  ] },
  { tool: "kubectl", format: "cobra", pages: [
    { file: "root.txt", minSubs: 25, minFlags: 0 },
    { file: "get.txt", minSubs: 0, minFlags: 10 },
  ] },
  { tool: "docker", format: "cobra", pages: [
    { file: "root.txt", minSubs: 30, minFlags: 5 },
    { file: "run.txt", minSubs: 0, minFlags: 40 },
  ] },
  { tool: "cargo", format: "clap", pages: [
    { file: "root.txt", minSubs: 10, minFlags: 6 },
    { file: "build.txt", minSubs: 0, minFlags: 15 },
  ] },
  // rg covers the OTHER clap layout: old-style long help (uppercase USAGE:,
  // scattered "* OPTIONS:" sections, prose `possible values` lists) — distinct
  // from cargo's modern column format, so both paths stay tested.
  { tool: "rg", format: "clap", pages: [
    { file: "root.txt", minSubs: 0, minFlags: 50 },
  ] },
  { tool: "pipx", format: "argparse", pages: [
    { file: "root.txt", minSubs: 12, minFlags: 1 },
    { file: "install.txt", minSubs: 0, minFlags: 8 },
  ] },
  { tool: "flask", format: "click", pages: [
    { file: "root.txt", minSubs: 2, minFlags: 3 },
    { file: "run.txt", minSubs: 0, minFlags: 5 },
  ] },
];

const fixturePath = (tool: string, file: string) => resolve(import.meta.dir, "fixtures", tool, file);

let failures = 0;
const note = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};

for (const { tool, format, pages } of FIXTURES) {
  console.log(`\n${tool} (${format})`);

  const rootHelp = readFileSync(fixturePath(tool, "root.txt"), "utf8");
  const detected = await detectAdapter(rootHelp);
  note(detected.name === format, `detect → ${detected.name} (want ${format})`);

  const adapter = await loadAdapter(format);
  for (const { file, minSubs, minFlags } of pages) {
    const page = adapter.parsePage(readFileSync(fixturePath(tool, file), "utf8"));
    const subs = page.subcommands.length;
    const flags = page.flags.length;
    note(
      subs >= minSubs && flags >= minFlags,
      `${file} → subs=${subs} (≥${minSubs}) flags=${flags} (≥${minFlags})`,
    );
  }
}

if (failures) {
  console.error(`\n✗ ${failures} fixture check(s) failed`);
  process.exit(1);
}
console.log(`\n✓ all parser fixtures pass`);
