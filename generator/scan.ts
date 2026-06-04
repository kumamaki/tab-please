// scan.ts — classify commands that have no zsh completion.
//
//   bun generator/scan.ts <cmd>...
//
// The shell side (`tab-please scan`) does the enumeration and the $_comps check
// — only it can see which commands the live shell already completes — and hands
// us the candidates that have NO completion. For each we run its --help to
// decide what to do about it:
//
//   add     → parses into real subcommands/flags; worth `tab-please add`
//   native  → the tool generates its OWN completion (clap/cobra `completion zsh`);
//             enable that instead, it'll be better than ours
//   low     → flat / unparseable (one-shot tool); not worth a completion
//
// A pretty report goes to stderr; the bare "worth adding" names go to stdout so
// the shell can offer `tab-please scan --add`.

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { detectAdapter } from "./parse.ts";

const pexec = promisify(execFile);
// Probe unknown tools from a throwaway cwd: a tool that misreads `completion` as
// an output path (some do) litters there, not the user's working directory.
const SAFE = { maxBuffer: 8 * 1024 * 1024, cwd: tmpdir() } as const;

async function runHelp(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await pexec(cmd, ["--help"], SAFE);
    return stdout.trim() ? stdout : stderr;
  } catch (err: any) {
    return String(err?.stdout || err?.stderr || "");
  }
}

// Does the tool emit its own zsh completion? (clap_complete, cobra, …)
async function selfGenerates(cmd: string): Promise<string | null> {
  for (const args of [["completion", "zsh"], ["gen-completion", "zsh"], ["completions", "zsh"]]) {
    try {
      const { stdout } = await pexec(cmd, args, SAFE);
      if (/#compdef\b/.test(stdout)) return `${cmd} ${args.join(" ")}`;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

type Verdict = { cmd: string; kind: "add" | "native" | "low"; detail: string };

async function classify(cmd: string): Promise<Verdict> {
  const native = await selfGenerates(cmd);
  if (native) return { cmd, kind: "native", detail: native };

  const help = await runHelp(cmd);
  if (!help.trim()) return { cmd, kind: "low", detail: "no parseable --help" };

  const adapter = await detectAdapter(help);
  const page = adapter.parsePage(help);
  // A completion earns its keep with a subcommand tree or a real flag set;
  // a flat tool with a couple of flags is what zsh's _files default already covers.
  if (page.subcommands.length >= 1 || page.flags.length >= 5) {
    return { cmd, kind: "add", detail: `${adapter.name}: ${page.subcommands.length} subcommands, ${page.flags.length} flags` };
  }
  return { cmd, kind: "low", detail: `flat (${adapter.name})` };
}

const cmds = process.argv.slice(2).filter((c) => c && !c.startsWith("-"));
if (!cmds.length) {
  console.error("usage: bun generator/scan.ts <cmd>...");
  process.exit(1);
}

const verdicts = await Promise.all(cmds.map(classify));
const add = verdicts.filter((v) => v.kind === "add").sort((a, b) => a.cmd.localeCompare(b.cmd));
const native = verdicts.filter((v) => v.kind === "native").sort((a, b) => a.cmd.localeCompare(b.cmd));
const low = verdicts.filter((v) => v.kind === "low").sort((a, b) => a.cmd.localeCompare(b.cmd));

const err = (s = "") => process.stderr.write(s + "\n");
err();
if (add.length) {
  err("  ✗ no completion — worth adding:");
  for (const v of add) err(`      ${v.cmd.padEnd(18)} ${v.detail}`);
  err(`      → tab-please add ${add.map((v) => v.cmd).join(" ")}`);
  err();
}
if (native.length) {
  err("  ◆ no completion — but the tool ships its own (enable it, don't generate):");
  for (const v of native) err(`      ${v.cmd.padEnd(18)} ${v.detail}`);
  err();
}
if (low.length) {
  err("  · no completion — low value (flat / one-shot), skipped:");
  err("      " + low.map((v) => v.cmd).join("  "));
  err();
}
if (!add.length && !native.length) err("  ✓ nothing worth adding — you're covered.");

// stdout = the worth-adding names, for `tab-please scan --add`
if (add.length) process.stdout.write(add.map((v) => v.cmd).join("\n") + "\n");
