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

import { classify } from "./classify.ts";

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
