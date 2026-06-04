// regen.ts — refresh one tool end to end: parse the live CLI, then rebuild.
//
//   bun generator/regen.ts <tool>
//
// Needs the CLI installed (it shells out to `<tool> --help`). This is the step
// that picks up new subcommands/flags from a CLI release; CI runs it on a
// schedule and opens a PR when generated.json changes.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const tool = process.argv[2];
if (!tool || tool.startsWith("-")) {
  console.error("usage: bun generator/regen.ts <tool>");
  process.exit(1);
}

const gen = resolve(ROOT, "tools", tool, "generated.json");
const run = (script: string, args: string[]) =>
  execFileSync("bun", [resolve(ROOT, "generator", script), ...args], { stdio: "inherit" });

run("parse.ts", [tool, "--out", gen]);
run("build.ts", [tool]);
console.error(`regenerated ${tool}`);
