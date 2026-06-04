// Python click help format.
//   Usage: tool [OPTIONS] COMMAND [ARGS]...
//   Options:
//     -n, --name TEXT          The name.                 ← UPPERCASE metavar ⇒ valued
//     --mode [fast|slow|auto]  Execution mode.           ← inline choice set
//     --shout / --no-shout     Whether to shout.         ← boolean pair (take positive)
//     -v, --verbose            Enable verbose output.    ← no metavar ⇒ boolean
//   Commands:
//     init     Initialize the thing.
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import { groupEntries, isCommandToken, joinDesc, makeFlag, sectionize, splitHeadDesc, withoutHelp } from "./shared.ts";

// click metavars are uppercase placeholders (TEXT INTEGER FLOAT PATH BOOLEAN
// UUID FILENAME DIRECTORY ...) or a user-supplied UPPER_SNAKE token.
const METAVAR_RE = /^[A-Z][A-Z0-9_]*(\.\.\.)?$/;
// An inline choice set: `[fast|slow|auto]`.
const CHOICES_RE = /^\[([^\]]*\|[^\]]*)\]$/;

function parseChoices(token: string): string[] | undefined {
  const m = token.match(CHOICES_RE);
  if (!m) return undefined;
  const vals = m[1].split("|").map((s) => s.trim()).filter(Boolean);
  return vals.length ? vals : undefined;
}

// Strip click's bracketed tails (`[default: 1]`, `[required]`, `[env var: X]`)
// from a description — they're noise the build would strip anyway, but choices
// live in the head so this can't eat them.
function cleanDesc(desc: string): string {
  return desc.replace(/\s*\[(default|required|env var|x-[^\]]*)[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
}

// Split a flag head into spellings + an optional metavar/choice token. click
// puts a single metavar after the long form: "-n, --name TEXT". Boolean pairs
// "--shout / --no-shout" have a " / " and no metavar — take the positive.
function parseFlagHead(head: string): { names: string[]; metavar?: string } {
  // A boolean on/off pair: keep only the positive spelling, no metavar.
  if (/\s\/\s/.test(head) && !/[<\[]/.test(head.replace(CHOICES_RE, ""))) {
    const positive = head.split(/\s\/\s/)[0].trim();
    const names = positive.split(",").map((s) => s.trim()).filter((s) => s.startsWith("-"));
    return { names };
  }
  // Otherwise: comma-separated spellings, then maybe a trailing metavar token.
  const tokens = head.split(/\s+/).filter(Boolean);
  const names: string[] = [];
  let metavar: string | undefined;
  for (const tok of tokens) {
    const t = tok.replace(/,$/, "");
    if (t.startsWith("-")) {
      names.push(t.replace(/,/g, ""));
    } else if (METAVAR_RE.test(t) || CHOICES_RE.test(t)) {
      metavar = t;
    }
  }
  return { names, ...(metavar ? { metavar } : {}) };
}

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0]);
  const { names, metavar } = parseFlagHead(head);
  if (names.length === 0) return null;
  const description = cleanDesc(joinDesc(entry, firstDesc));
  const choices = metavar ? parseChoices(metavar) : undefined;
  // Value-taking iff a metavar is present. Choice set ⇒ a generic "value" arg.
  const arg = metavar ? (choices ? "value" : metavar.toLowerCase().replace(/\.\.\.$/, "")) : undefined;
  const repeatable = metavar ? metavar.endsWith("...") : false;
  return makeFlag(names, description, { arg, choices, repeatable });
}

function parseSubRef(entry: string[]): SubRef | null {
  const [head, firstDesc] = splitHeadDesc(entry[0]);
  const token = head.split(/\s+/)[0];
  if (!token || !isCommandToken(token)) return null;
  const [name, ...aliases] = token.split("|");
  return { name, aliases, description: joinDesc(entry, firstDesc) };
}

// click usage: `Usage: tool [OPTIONS] COMMAND [ARGS]...`. Positionals are the
// bracketed args after the binary that aren't the OPTIONS/COMMAND/ARGS noise.
function parsePositionals(usageLines: string[]): string[] {
  const usage = usageLines.find((l) => /^Usage:/.test(l)) ?? "";
  const after = usage.replace(/^Usage:\s*\S+/, "");
  const pos: string[] = [];
  for (const tok of after.matchAll(/[<\[]([^>\]]+)[>\]]/g)) {
    const name = tok[1].replace(/\.{2,}$/, "").trim();
    if (/^(OPTIONS|COMMAND|ARGS)$/.test(name)) continue;
    pos.push(name.toLowerCase());
  }
  return pos;
}

const adapter: Adapter = {
  name: "click",
  detect(help) {
    // Capital `Usage:` with `[OPTIONS]`, an `Options:` and `Commands:` section,
    // and at least one UPPERCASE metavar after a long option — the combination
    // that separates click from commander (lowercase choices, no UPPER metavar)
    // and argparse (lowercase `usage:`).
    const hasUsage = /^Usage:.*\[OPTIONS\]/m.test(help);
    const hasCommands = /^Commands:\s*$/m.test(help);
    // Require ≥2 uppercase chars (FILE, TEXT, IMPORT) so a capitalized first
    // word of a description — clap prints `--version  Print version…` — isn't
    // mistaken for a metavar, which made us hijack cargo and other clap tools.
    const hasUpperMetavar = /^\s+(?:-\w,\s*)?--[\w-]+\s+(?:[A-Z][A-Z0-9_]+|\[[^\]]*\|)/m.test(help);
    return hasUsage && hasCommands && hasUpperMetavar;
  },
  parsePage(help): ParsedPage {
    const s = sectionize(help);
    const flags = withoutHelp(
      (s["Options"] ? groupEntries(s["Options"]) : []).map(parseFlag).filter((f): f is CliFlag => !!f),
    );
    const subcommands = (s["Commands"] ? groupEntries(s["Commands"]) : [])
      .map(parseSubRef)
      .filter((x): x is SubRef => !!x && x.name !== "help");
    return { flags, subcommands, positionals: parsePositionals(s["Usage"] ?? []) };
  },
};

export default adapter;
