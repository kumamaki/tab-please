// parse.ts — drive a CLI's --help into generated.json, in any supported format.
//
//   bun generator/parse.ts <command> [--out <file>] [--format <name>] [--max-depth N]
//
// The driver owns IO + recursion; a per-format Adapter (generator/parsers/*.ts)
// turns each rendered --help page into structure. Format is auto-detected from
// the root help unless --format is given.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Adapter, CliCommand, CliModel, SubRef } from "./types.ts";

// Most specific first; commander is the broad fallback. `generic` is never
// auto-detected (opt in with --format generic). Exported so the fixture test
// (tests/) exercises the real detection, not a copy of this list.
export const DETECT_ORDER = ["cobra", "argparse", "yargs", "clap", "click", "commander"];

export async function loadAdapter(name: string): Promise<Adapter> {
  const mod = await import(resolve(import.meta.dir, "parsers", `${name}.ts`));
  return mod.default as Adapter;
}

export async function detectAdapter(rootHelp: string): Promise<Adapter> {
  for (const name of DETECT_ORDER) {
    try {
      const a = await loadAdapter(name);
      if (a.detect(rootHelp)) return a;
    } catch {
      /* adapter not present yet — skip */
    }
  }
  return loadAdapter("commander");
}

function runHelp(command: string, args: string[]): string {
  // Capture both streams: many CLIs print --help to stdout, but some (and most
  // on a non-zero exit) print it to stderr. Prefer whichever has content.
  try {
    const out = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    return out.trim() ? out : "";
  } catch (err: any) {
    const stdout = err?.stdout ? String(err.stdout) : "";
    const stderr = err?.stderr ? String(err.stderr) : "";
    if (stdout.trim()) return stdout;
    if (stderr.trim()) return stderr;
    throw new Error(`failed: \`${command} ${args.join(" ")}\``);
  }
}

function getVersion(command: string): string | undefined {
  for (const args of [["--version"], ["version"], ["-V"]]) {
    try {
      const out = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) return out.split("\n")[0];
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function buildTree(
  adapter: Adapter,
  command: string,
  path: string[],
  depth: number,
  maxDepth: number,
  ref?: SubRef,
): CliCommand {
  const args = adapter.helpArgs ? adapter.helpArgs(path) : [...path, "--help"];
  // A subcommand whose --help fails (needs args, not really a command, etc.)
  // must not abort the whole parse — degrade it to a leaf and carry on.
  let page;
  try {
    page = adapter.parsePage(runHelp(command, args));
  } catch (err: any) {
    console.error(`  ⚠ skipping \`${command} ${path.join(" ")}\`: ${String(err?.message ?? err).split("\n")[0]}`);
    page = { flags: [], subcommands: [], positionals: [] };
  }

  const subcommands: CliCommand[] = [];
  if (depth < maxDepth) {
    for (const sref of page.subcommands) {
      subcommands.push(buildTree(adapter, command, [...path, sref.name], depth + 1, maxDepth, sref));
    }
  }

  return {
    name: ref?.name ?? command,
    ...(ref?.aliases?.length ? { aliases: ref.aliases } : {}),
    description: ref?.description ?? "",
    flags: page.flags,
    subcommands,
    ...(page.positionals.length ? { positionals: page.positionals } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command.startsWith("-")) {
    console.error("usage: bun generator/parse.ts <command> [--out <file>] [--format <name>] [--max-depth N]");
    process.exit(1);
  }
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = flag("--out");
  const formatName = flag("--format");
  const maxDepth = flag("--max-depth") ? Number(flag("--max-depth")) : 4;

  const rootHelp = runHelp(command, ["--help"]);
  const adapter = formatName ? await loadAdapter(formatName) : await detectAdapter(rootHelp);

  const root = buildTree(adapter, command, [], 0, maxDepth);
  const model: CliModel = { command, version: getVersion(command), format: adapter.name, root };
  const json = JSON.stringify(model, null, 2) + "\n";

  if (out) {
    writeFileSync(out, json);
    console.error(`wrote ${out} — format=${adapter.name}, version=${model.version ?? "?"}`);
  } else {
    process.stdout.write(json);
  }
}

// Only run the CLI driver when invoked directly; importing this module (e.g.
// from the fixture test, to reuse detectAdapter/loadAdapter) must not run main.
if (import.meta.main) main();
