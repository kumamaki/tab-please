// Python argparse (stdlib) help format.
//   usage: prog [-h] [--foo FOO] {sub1,sub2} ...
//   positional arguments:
//     path                  the path
//     {build,test}          (subcommand set — name listed, then indented rows)
//       build               build it
//   options:                (Py3.10+; "optional arguments:" on older Pythons)
//     -f FOO, --foo FOO     help text          ← old style: metavar repeats
//     -m, --mode {a,b}      help text          ← Py3.13+: metavar shown once
//     -v, --verbose         be verbose         ← no metavar ⇒ boolean
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import { groupEntries, joinDesc, makeFlag, sectionize, splitHeadDesc, withoutHelp } from "./shared.ts";

// Fold both option-section spellings onto "Options", and the positional header
// onto "Arguments". argparse's "positional arguments:" header has a space, which
// sectionize's header regex ([A-Za-z][A-Za-z /]+:) accepts.
const HEADER_ALIASES = {
  "options": "Options",
  "optional arguments": "Options",
  "positional arguments": "Arguments",
};

// A metavar is either a CHOICES set `{a,b,c}` or an UPPER/word token argparse
// derives from the dest (FILE, NUM, or a custom metavar like out_dir).
const CHOICES_RE = /^\{([^}]*)\}$/;

function parseChoices(metavar: string): string[] | undefined {
  const m = metavar.match(CHOICES_RE);
  if (!m) return undefined;
  const vals = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return vals.length ? vals : undefined;
}

// Split a flag head into its spellings and (optional) trailing metavar. Handles
// both layouts:
//   old  "-f FOO, --foo FOO"   → names [-f,--foo], metavar FOO (repeated)
//   new  "-m, --mode {a,b}"    → names [-m,--mode], metavar {a,b} (once, at end)
//   bool "-v, --verbose"       → names [-v,--verbose], no metavar
function parseFlagHead(head: string): { names: string[]; metavar?: string } {
  // The metavar (if any) is the trailing token that isn't a flag spelling:
  // either a choice set `{a,b}` (may contain commas — pull it first so the
  // comma-split below doesn't shatter it) or a bare word like FILE / out_dir.
  let metavar: string | undefined;
  let rest = head;
  const choiceTail = rest.match(/\{[^}]*\}$/);
  if (choiceTail) {
    metavar = choiceTail[0];
    rest = rest.slice(0, choiceTail.index).trim();
  }
  // Spellings are comma-separated; each is "-x" or (old style) "-x METAVAR".
  const names: string[] = [];
  for (const part of rest.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, ...mv] = part.split(/\s+/);
    if (name.startsWith("-")) names.push(name);
    // A token after the flag name is the repeated metavar (old argparse).
    if (mv.length && !metavar) metavar = mv.join(" ");
  }
  return { names, ...(metavar ? { metavar } : {}) };
}

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0]);
  const { names, metavar } = parseFlagHead(head);
  const description = joinDesc(entry, firstDesc);
  const choices = metavar ? parseChoices(metavar) : undefined;
  // nargs renders the metavar twice: "FILES [FILES ...]" ⇒ repeatable; the real
  // arg name is the first token, lowercased.
  const repeatable = metavar ? /\[.*\.\.\.\]/.test(metavar) : false;
  // Value-taking iff a metavar is present. The arg name is the lowercased
  // metavar (first token only); for a choice set we expose the choices.
  const arg = metavar ? (choices ? "value" : metavar.split(/\s+/)[0].toLowerCase()) : undefined;
  return makeFlag(names, description, { arg, choices, repeatable });
}

// Subcommands live as a positional whose head is the `{a,b,c}` set, optionally
// followed by indented per-sub rows ("    build   build it"). groupEntries folds
// those rows into the same entry, deeper-indented than the set line.
//
// A `{a,b}` *choice* positional looks identical except it carries an inline
// two-column description ("{json,yaml}   the format") and never has child rows.
// So the subparser group is the `{...}` entry with NO inline description and/or
// WITH indented child rows. argparse renders at most one subparser group, last.
function parseSubcommands(argLines: string[]): SubRef[] {
  for (const entry of groupEntries(argLines)) {
    const m = entry[0].match(/^\{([^}]*)\}/);
    if (!m) continue;
    const [, inlineDesc] = splitHeadDesc(entry[0]);
    const hasChildRows = entry.length > 1;
    if (inlineDesc && !hasChildRows) continue; // a choice positional, not subparsers
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    // Map any indented "name  description" rows to descriptions.
    const desc = new Map<string, string>();
    for (const row of entry.slice(1)) {
      const [head, d] = splitHeadDesc(row);
      const name = head.split(/\s+/)[0];
      if (names.includes(name)) desc.set(name, d);
    }
    return names
      .filter((n) => n !== "help")
      .map((name) => ({ name, aliases: [], description: desc.get(name) ?? "" }));
  }
  return [];
}

// Positionals from the Arguments section that aren't the subcommand set. A bare
// `{a,b}` choice positional keeps its dest unknown, so we skip choice-only sets
// (they're either subcommands or unnamed enum slots completion can't key on).
function parsePositionals(argLines: string[]): string[] {
  const pos: string[] = [];
  for (const entry of groupEntries(argLines)) {
    const head = splitHeadDesc(entry[0])[0];
    const token = head.split(/\s+/)[0];
    if (/^\{/.test(token)) continue; // choice set / subcommand group
    if (/^-/.test(token)) continue; // safety: not a flag
    if (/^[a-z][a-z0-9_-]*$/i.test(token)) pos.push(token);
  }
  return pos;
}

const adapter: Adapter = {
  name: "argparse",
  detect(help) {
    // Lowercase `usage:` plus an argparse-specific section header, or the `[-h]`
    // option that argparse always injects into the usage line. Commander uses
    // capital `Usage:`; click uses capital `Usage:` + `Options:` — neither
    // matches lowercase `usage:` with these section names.
    const lowerUsage = /^usage:/m.test(help);
    const argparseSection = /^(positional arguments|optional arguments|options):\s*$/m.test(help);
    const dashH = /^usage:.*\[-h\]/m.test(help);
    return lowerUsage && (argparseSection || dashH);
  },
  parsePage(help): ParsedPage {
    const s = sectionize(help, HEADER_ALIASES);
    const flags = withoutHelp(
      (s["Options"] ? groupEntries(s["Options"]) : []).map(parseFlag).filter((f): f is CliFlag => !!f),
    );
    const argLines = s["Arguments"] ?? [];
    // Subparsers normally live in "positional arguments:" (→ Arguments), but
    // `add_subparsers(title="…")` renames the section to anything (pipx uses
    // "subcommands:"). argparse renders at most one `{…}` group, so when
    // Arguments has none, scan the other non-Options sections for it.
    let subcommands = parseSubcommands(argLines);
    if (!subcommands.length) {
      for (const [title, lines] of Object.entries(s)) {
        if (title === "Options" || title === "Usage" || title === "Arguments") continue;
        const found = parseSubcommands(lines);
        if (found.length) {
          subcommands = found;
          break;
        }
      }
    }
    return { flags, subcommands, positionals: parsePositionals(argLines) };
  },
};

export default adapter;
