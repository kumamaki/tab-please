// regen.ts — refresh one tool end to end: parse the live CLI, then rebuild.
//
//   bun generator/regen.ts <tool>
//
// Needs the CLI installed (it shells out to `<tool> --help`). This is the step
// that picks up new subcommands/flags from a CLI release; CI runs it on a
// schedule and opens a PR when generated.json changes.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Enrich } from "./types.ts";

const ROOT = resolve(import.meta.dir, "..");

const tool = process.argv[2];
if (!tool || tool.startsWith("-")) {
  console.error("usage: bun generator/regen.ts <tool>");
  process.exit(1);
}

const gen = resolve(ROOT, "tools", tool, "generated.json");
const run = (script: string, args: string[]) =>
  execFileSync("bun", [resolve(ROOT, "generator", script), ...args], { stdio: "inherit" });

// A tool can pin its parser format in enrich.ts (e.g. "generic" for getopt help
// that won't auto-detect). Honor it here so every regen — including CI's cron —
// reuses the choice instead of re-detecting and clobbering the output.
async function pinnedFormat(): Promise<string | undefined> {
  const tsPath = resolve(ROOT, "tools", tool, "enrich.ts");
  if (!existsSync(tsPath)) return undefined;
  const mod = await import(tsPath);
  return ((mod.default ?? mod.enrich ?? {}) as Enrich).format;
}

const format = await pinnedFormat();
run("parse.ts", [tool, "--out", gen, ...(format ? ["--format", format] : [])]);
run("build.ts", [tool]);
console.error(`regenerated ${tool}${format ? ` (--format ${format})` : ""}`);
