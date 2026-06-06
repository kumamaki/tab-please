// classify.ts — shared tool classification used by `scan` and `request`.
//
// Given a command name, decide what tab-please should do about it:
//   add     → parses into real subcommands/flags; worth a completion
//   native  → the tool ships its own zsh completion (clap/cobra); enable that
//   low     → flat / unparseable; not worth a completion
//
// Probes run from a throwaway cwd so a tool that misreads `completion` as an
// output path can't litter the caller's working directory.

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { detectAdapter } from "./parse.ts";

const pexec = promisify(execFile);
const SAFE = { maxBuffer: 8 * 1024 * 1024, cwd: tmpdir() } as const;

export async function runHelp(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await pexec(cmd, ["--help"], SAFE);
    return stdout.trim() ? stdout : stderr;
  } catch (err: any) {
    return String(err?.stdout || err?.stderr || "");
  }
}

// Does the tool emit its own zsh completion? (clap_complete, cobra, …) Returns
// the command that generates it, or null.
// Bare "completions" is tried first: tools like bun install to a file when
// given a shell name but fall back to stdout otherwise — making the bare form
// the only reliable one to suggest to users.
export async function selfGenerates(cmd: string): Promise<string | null> {
  for (const args of [["completions"], ["completion", "zsh"], ["gen-completion", "zsh"], ["completions", "zsh"]]) {
    try {
      const { stdout } = await pexec(cmd, args, SAFE);
      if (/#compdef\b/.test(stdout)) return `${cmd} ${args.join(" ")}`;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

// First line of `--version` (or `-V` / `version`), if the tool offers one.
export async function toolVersion(cmd: string): Promise<string | undefined> {
  for (const args of [["--version"], ["-V"], ["version"]]) {
    try {
      const { stdout } = await pexec(cmd, args, SAFE);
      const line = stdout.trim().split("\n")[0];
      if (line) return line;
    } catch {
      /* try the next spelling */
    }
  }
  return undefined;
}

export type Verdict = {
  cmd: string;
  kind: "add" | "native" | "low";
  detail: string;
  format?: string;
  subcommands?: number;
  flags?: number;
};

export async function classify(cmd: string): Promise<Verdict> {
  const native = await selfGenerates(cmd);
  if (native) return { cmd, kind: "native", detail: native };

  const help = await runHelp(cmd);
  if (!help.trim()) return { cmd, kind: "low", detail: "no parseable --help" };

  const adapter = await detectAdapter(help);
  const page = adapter.parsePage(help);
  const subcommands = page.subcommands.length;
  const flags = page.flags.length;
  // A completion earns its keep with a subcommand tree or a real flag set; a
  // flat tool with a couple of flags is what zsh's _files default already covers.
  if (subcommands >= 1 || flags >= 5) {
    return { cmd, kind: "add", detail: `${adapter.name}: ${subcommands} subcommands, ${flags} flags`, format: adapter.name, subcommands, flags };
  }
  return { cmd, kind: "low", detail: `flat (${adapter.name})`, format: adapter.name, subcommands, flags };
}
