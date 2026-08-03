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

import { classify, type Verdict } from "./classify.ts";
import {
  bold,
  bright,
  cyan,
  dim,
  formatDuration,
  green,
  makeSpinner,
  symbols,
  yellow,
} from "./ui.ts";

const cmds = process.argv.slice(2).filter((c) => c && !c.startsWith("-"));
if (!cmds.length) {
  console.error("usage: bun generator/scan.ts <cmd>...");
  process.exit(1);
}

const total = cmds.length;
const started = performance.now();
const spinner = makeSpinner({ verb: "classifying" });
spinner.tick(0, total);

// Parallel classify, but settle one-by-one so the spinner can name the latest
// finished tool. Order of completion is nondeterministic; the final report sorts.
let settled = 0;
const verdicts = await Promise.all(
  cmds.map(async (cmd) => {
    const v = await classify(cmd);
    settled++;
    spinner.set(cmd);
    spinner.tick(settled, total);
    return v;
  }),
);

const elapsed = formatDuration(performance.now() - started);
spinner.done(
  `${green(symbols.ok)} classified ${bold(String(total))} tools in ${dim(elapsed)}`,
);

const add = verdicts.filter((v) => v.kind === "add").sort((a, b) => a.cmd.localeCompare(b.cmd));
const native = verdicts.filter((v) => v.kind === "native").sort((a, b) => a.cmd.localeCompare(b.cmd));
const low = verdicts.filter((v) => v.kind === "low").sort((a, b) => a.cmd.localeCompare(b.cmd));

const err = (s = "") => process.stderr.write(s + "\n");

function detailLine(v: Verdict): string {
  if (v.kind === "add") {
    const parts = [
      v.format,
      `${v.subcommands ?? 0} subcommands`,
      `${v.flags ?? 0} flags`,
    ].filter(Boolean);
    return dim(parts.join(` ${symbols.sep} `));
  }
  return dim(v.detail);
}

function section(
  marker: string,
  color: (s: string) => string,
  title: string,
  count: number,
  rows: Verdict[],
  listOnly = false,
) {
  if (!rows.length) return;
  err();
  err(`${color(marker)} ${bold(title)} ${dim(`(${count})`)}`);
  if (listOnly) {
    err(`    ${dim(rows.map((v) => v.cmd).join("  "))}`);
    return;
  }
  for (const v of rows) {
    err(`    ${bright(v.cmd.padEnd(18))} ${detailLine(v)}`);
  }
}

section(symbols.fail, yellow, "no completion — worth adding", add.length, add);
if (add.length) {
  err(
    `    ${dim(symbols.arrow)} tab-please add ${add.map((v) => v.cmd).join(" ")}`,
  );
}
section(
  symbols.native,
  cyan,
  "ships its own — enable native",
  native.length,
  native,
);
section(symbols.low, dim, "low value — skipped", low.length, low, true);

if (!add.length && !native.length && !low.length) {
  err();
  err(`  ${green(symbols.ok)} nothing to report.`);
} else if (!add.length && !native.length) {
  err();
  err(`  ${green(symbols.ok)} nothing worth adding — you're covered.`);
}
err();

// stdout = the worth-adding names, for `tab-please scan --add`
if (add.length) process.stdout.write(add.map((v) => v.cmd).join("\n") + "\n");
