// Oclif help format (used by Netlify CLI, Heroku, Salesforce CLI, etc.)
//
// USAGE
//   $ netlify [COMMAND]
//
// COMMANDS
//   $ agents       Manage Netlify AI agent tasks
//
// OPTIONS
//   --alias <name>Specifies the alias...  ← no space between arg and desc
//   --boolFlagDesc...                     ← no space between flag name and desc
//   -d, --dir <path>Specify a folder
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import { groupEntries, joinDesc, makeFlag, withoutHelp } from "./shared.ts";

// Oclif headers are ALL_CAPS words, non-indented, with no trailing colon.
function sectionize(help: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current = "Usage";
  for (const line of help.split("\n")) {
    if (/^[A-Z][A-Z ]{2,}$/.test(line)) {
      current = line.trim();
      sections[current] ??= [];
    } else {
      (sections[current] ??= []).push(line);
    }
  }
  return sections;
}

// Oclif flag lines smash the flag name (and optional <arg>) directly against
// the description with no separator. The long name is always kebab-case
// ([a-z][a-z0-9-]*), so the regex stops naturally at any uppercase letter —
// which is where descriptions start in practice. The one false-negative is
// --help whose description "display..." is lowercase, but withoutHelp drops it.
const FLAG_RE = /^(?:(-[a-zA-Z])(?:,\s*))?(--[a-z][a-z0-9-]*)(?:\s+<([^>]+)>)?(.*)/;

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].trim().startsWith("-")) return null;
  const m = entry[0].trim().match(FLAG_RE);
  if (!m) return null;
  const [, short, long, arg, restDesc] = m;
  const names = ([short, long].filter(Boolean) as string[]);
  return makeFlag(names, joinDesc(entry, restDesc?.trim() ?? ""), { arg: arg || undefined });
}

// groupEntries won't work here — oclif's COMMANDS section has 0-indent footer
// lines after the command list that skew the baseIndent calculation. Instead,
// start a new entry on any `$ ` line and append deeper-indented wraps to it.
function groupCommandEntries(lines: string[]): string[][] {
  const entries: string[][] = [];
  for (const line of lines) {
    if (/^\s*\$\s/.test(line)) {
      entries.push([line.trim()]);
    } else if (entries.length && line.trim()) {
      entries[entries.length - 1].push(line.trim());
    }
  }
  return entries;
}

function parseSubRef(entry: string[]): SubRef | null {
  // Commands are prefixed with `$ `: `  $ deploy  Deploy your site`
  const raw = entry[0].trim().replace(/^\$\s+/, "");
  const gapIdx = raw.search(/\s{2,}/);
  const [name, firstDesc] =
    gapIdx >= 0 ? [raw.slice(0, gapIdx).trim(), raw.slice(gapIdx).trim()] : [raw.trim(), ""];
  // Allow namespaced names like `sites:list`
  if (!name || !/^[a-z][a-z0-9:_-]*$/.test(name)) return null;
  return { name, aliases: [], description: joinDesc(entry, firstDesc) };
}

const adapter: Adapter = {
  name: "oclif",
  detect(help) {
    // Root usage line: `$ cmd [COMMAND]` — the dollar-prefix + [COMMAND] token
    return /\$ \S+ \[COMMAND\]/.test(help);
  },
  parsePage(help): ParsedPage {
    const s = sectionize(help);
    const flags = withoutHelp(
      (s["OPTIONS"] ? groupEntries(s["OPTIONS"]) : [])
        .map(parseFlag)
        .filter((f): f is CliFlag => !!f),
    );
    const subcommands = groupCommandEntries(s["COMMANDS"] ?? [])
      .map(parseSubRef)
      .filter((x): x is SubRef => !!x);
    return { flags, subcommands, positionals: [] };
  },
};

export default adapter;
