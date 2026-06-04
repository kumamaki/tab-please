// Cobra help format (Go CLIs: kubectl, gh, docker, helm, …).
//   Usage:
//     cmd [command]
//   Available Commands:
//     get         Display one or many resources
//   Flags:
//     -n, --namespace string   If present, the namespace scope
//     -w, --watch              After listing, watch for changes
//   Global Flags:
//     ...
//
// Cobra is templated, so section HEADERS and FLAG rows vary a lot by tool:
//   • headers: standard `Available Commands:` / `Flags:` / `Global Flags:`;
//     docker `Management Commands:` / `Common Commands:` / `Global Options:`;
//     kubectl-root `Basic Commands (Beginner):` / `Other Commands:` (parens);
//     gh UPPERCASE, no colon — `CORE COMMANDS` / `FLAGS` / `INHERITED FLAGS`.
//   • flags: standard `-n, --namespace string   desc` (type word before the
//     2-space gap; bool ⇒ no type); kubectl-verbose `--output='':` with the
//     description on the next tab-indented line and the type folded into an
//     `=<default>` suffix (`=false`→bool, `=''`/`=[]`/`=500`→takes a value).
// We can't lean on shared `sectionize` (its header regex misses gh's no-colon
// uppercase and kubectl's parenthesised headers), so we classify headers here.
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import { groupEntries, isCommandToken, joinDesc, makeFlag, splitHeadDesc, withoutHelp } from "./shared.ts";

// Canonical bucket for a section header line, or null if it isn't a header.
// Handles: `Title:` (optionally with trailing parens), and gh's UPPERCASE
// no-colon headers. Folds every command/flag header spelling onto Commands /
// Options; the Usage header onto Usage.
function classifyHeader(line: string): "Commands" | "Options" | "Usage" | "Other" | null {
  const raw = line.replace(/\r$/, "");
  // Header candidates are left-aligned (no leading whitespace) with no 2-space
  // run (that would make it a row, not a title).
  if (/^\s/.test(raw) || /\S {2,}\S/.test(raw.trim())) return null;
  let title: string | null = null;
  const colon = raw.match(/^([A-Za-z][A-Za-z /()-]+?):\s*$/);
  if (colon) title = colon[1].trim();
  // gh: an all-caps (+ spaces) header with no colon, e.g. "CORE COMMANDS".
  else if (/^[A-Z][A-Z ]+[A-Z]$/.test(raw.trim())) title = raw.trim();
  if (title === null) return null;

  const t = title.toLowerCase();
  if (/^usage$/.test(t)) return "Usage";
  // Flags / Options buckets first (so "Help Topics" / "Learn More" don't get
  // mis-bucketed and a stray "options" header is caught): Flags, Global Flags,
  // Inherited Flags, Persistent Flags, Options, Global Options.
  if (/\b(flags|options)\b/.test(t)) return "Options";
  // Any "…command(s)…" header → Commands. kubectl parenthesises the level
  // (`Basic Commands (Beginner)`), so match the word, not an end-anchor.
  // gh's "HELP TOPICS" is intentionally not a command group → Other.
  if (/\bcommands?\b/.test(t) || /^subcommands\b/.test(t)) return "Commands";
  // Everything else (Examples, Help Topics, Aliases, Arguments, Learn More…).
  return "Other";
}

// Split a cobra page into canonical sections. Lines before the first header
// (and the Usage block) land in Usage. We merge multiple command/flag headers
// (docker has 4 command groups; kubectl ~9) into one Commands / Options list.
function cobraSections(help: string): Record<string, string[]> {
  const sections: Record<string, string[]> = { Usage: [], Commands: [], Options: [], Other: [] };
  let current = "Usage";
  for (const line of help.split("\n")) {
    const bucket = classifyHeader(line);
    if (bucket) {
      current = bucket === "Usage" ? "Usage" : bucket;
      // The Usage header's own body lines follow it; keep collecting into Usage.
      if (bucket === "Usage") sections.Usage.push(line);
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

// Group flag entries. We can't use shared `groupEntries` for flags: kubectl's
// verbose dialect puts the description on a *tab*-indented (shallower) line, so
// indentation-based grouping inverts heads and wraps. Instead, a new entry
// starts at any flag-shaped line (`-x` / `--long`); following non-flag lines
// (wrapped description) attach to it. Works for both dialects.
function groupCobraFlags(lines: string[]): string[][] {
  const entries: string[][] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const isHead = /^-{1,2}[A-Za-z0-9]/.test(line.trim());
    if (isHead) entries.push([line.trim()]);
    else if (entries.length) entries[entries.length - 1].push(line.trim());
  }
  return entries;
}

// Cobra's flag-takes-a-value rule: a flag has a value iff a type word follows
// the long flag AND that word isn't bool. The type word itself becomes the `arg`
// placeholder (string/int/duration/stringArray/…) for the build to type.
function typeToArg(type: string | undefined): string | undefined {
  if (!type || type === "bool" || type === "boolean") return undefined;
  return type;
}

// Strip a trailing `(default …)` (balanced-ish: cobra never nests parens here).
function stripDefault(desc: string): string {
  return desc.replace(/\s*\(default[^)]*\)\s*$/, "").trim();
}

// Standard cobra flag row: `-n, --namespace string   desc` or `-w, --watch  desc`.
// The names half is everything up to the 2-space gap; its last whitespace token
// is the type word iff it isn't itself a flag spelling.
function parseStdFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0]);
  const description = stripDefault(joinDesc(entry, firstDesc));

  const parts = head.split(/\s+/);
  let type: string | undefined;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && !last.startsWith("-")) type = last.replace(/,$/, "");
  const nameToks = (type ? parts.slice(0, -1) : parts).join(" ");
  const names = nameToks
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const arg = typeToArg(type);
  // strings/stringArray/stringSlice/list/ints/… ⇒ repeatable value.
  const repeatable = !!type && /s$|Array$|Slice$|^list$|^ints$|^uints$/.test(type);
  return makeFlag(names, description, { arg, ...(arg && repeatable ? { repeatable: true } : {}) });
}

// kubectl-verbose flag row: head is `-A, --all-namespaces=false:` (desc is on
// following tab-indented lines, already folded into `entry`). The `=<default>`
// suffix encodes type: `=false`/`=true` ⇒ bool; `=''`/`=""`/`=[]`/`=500` ⇒ value.
function parseVerboseFlag(entry: string[]): CliFlag | null {
  const m = entry[0].match(/^(--?\S.*?)=(.*?):?$/);
  if (!m) return null;
  const namePart = m[1];
  const def = m[2];
  const names = namePart
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("-"));
  const description = stripDefault(joinDesc(entry, "").replace(/^[:\s]+/, ""));
  const isBool = def === "true" || def === "false";
  const repeatable = def === "[]";
  const arg = isBool ? undefined : repeatable ? "list" : "value";
  return makeFlag(names, description, { arg, ...(arg && repeatable ? { repeatable: true } : {}) });
}

// kubectl-verbose head shape: `--flag=<default>:`, i.e. the flag column ends in
// `=<something>:` (the trailing colon is cobra's verbose marker). Standard rows
// never carry an `=`, so this cleanly disambiguates the two dialects.
const VERBOSE_HEAD = /^--?\S.*=.*:\s*$/;

// Pick the row dialect per-flag, then fall back to standard if verbose fails.
function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  if (VERBOSE_HEAD.test(splitHeadDesc(entry[0])[0])) {
    const verbose = parseVerboseFlag(entry);
    if (verbose) return verbose;
  }
  return parseStdFlag(entry);
}

// Command row: `get   Display one or many resources`. gh suffixes the name with
// a colon (`login:`); docker marks plugin commands with `*` (`buildx*`). Cobra
// shows aliases on a separate `Aliases:` line, not inline, so the token is just
// the name.
function parseSubRef(entry: string[]): SubRef | null {
  const [signature, firstDesc] = splitHeadDesc(entry[0]);
  let token = signature.split(/\s+/)[0];
  token = token.replace(/[:*]+$/, ""); // gh's `login:`, docker's `buildx*`.
  if (!token || !isCommandToken(token)) return null;
  return { name: token, aliases: [], description: joinDesc(entry, firstDesc) };
}

// Positionals from the Usage block. Cobra rarely names them, but docker does
// (`docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`). The Usage bucket also holds
// the page's prose preamble (everything before the first header), so we pick the
// ONE genuine usage line — it carries a structural marker (`[flags]`/`[command]`/
// `[OPTIONS]`/`COMMAND`) that prose never does — and scan only that for
// bracketed/UPPERCASE placeholders, dropping the structural noise words.
const POS_NOISE = new Set(["OPTIONS", "COMMAND", "ARG", "ARGS", "FLAGS", "OPTION"]);

// Locate the one genuine usage line in the Usage bucket (which also holds the
// page's prose preamble). Cobra emits either an inline `Usage:  cmd …` (docker)
// or a bare `Usage:` header followed by the indented `  cmd …` line (kubectl/gh,
// whose header is `USAGE`). Anchoring on the header — not a fuzzy keyword — keeps
// prose sentences (which contain words like "command"/"options") out.
function usageLine(usageLines: string[]): string {
  const i = usageLines.findIndex((l) => /^\s*(Usage|USAGE):/.test(l));
  if (i < 0) return "";
  const inline = usageLines[i].replace(/^\s*(Usage|USAGE):\s*/, "");
  if (inline.trim()) return inline;
  for (let j = i + 1; j < usageLines.length; j++) {
    if (usageLines[j].trim()) return usageLines[j];
  }
  return "";
}

function parsePositionals(usageLines: string[]): string[] {
  // Strip the binary/subcommand path up to the first placeholder/marker so we
  // only look at the placeholder tail.
  const after = usageLine(usageLines).replace(/.*?(?=\[|[A-Z]{2,})/, "");
  // Bail on complex usage grammars (kubectl's `[(-o|--output=)…] (TYPE… | …)`):
  // alternations / groupings / inline flags make positional extraction noise.
  // docker/gh use flat `IMAGE [COMMAND]` shapes that are safe.
  if (/[(|=]/.test(after)) return [];
  const pos: string[] = [];
  for (const m of after.matchAll(/[<\[]([^>\]]+)[>\]]|\b([A-Z][A-Z_]+)\b/g)) {
    const name = (m[1] ?? m[2]).replace(/\.{2,}$/, "").trim();
    if (!name || POS_NOISE.has(name.toUpperCase())) continue;
    if (!/^[A-Za-z][\w.-]*$/.test(name)) continue; // names only — no embedded syntax
    if (/^[a-z]/.test(name) && !/[<\[]/.test(m[0])) continue; // bare lowercase ⇒ not a positional
    pos.push(name);
  }
  return pos;
}

const adapter: Adapter = {
  name: "cobra",
  detect(help) {
    // Cobra-specific signals. The header names and footer below are emitted by
    // cobra's default templates and are near-unique to it; commander/click never
    // produce them. We deliberately avoid keying on bare `Flags:`/`Options:`
    // (shared with commander) or a lone `Commands:`.
    const headerSignals =
      /^\s*Available Commands:/im.test(help) || // canonical cobra (kubectl subcmds)
      /^\s*Global (Flags|Options):/im.test(help) || // kubectl/docker root
      /^\s*Inherited Flags:/im.test(help) || // cobra persistent-flag split
      /^(Core|Additional|Management|Common|Swarm) Commands:/m.test(help) || // docker/cobra groups
      /^(CORE|ADDITIONAL|AVAILABLE|GENERAL|TARGETED) COMMANDS$/m.test(help) || // gh uppercase
      /^INHERITED FLAGS$/m.test(help);
    // Cobra usage/footer shapes that commander & click do NOT emit:
    //   • `<bin> [flags]` — cobra's word is `flags`; commander/click say `options`.
    //   • `<bin> [OPTIONS] COMMAND` with no trailing `[ARGS]...` — that's docker/
    //     cobra; click always appends `[ARGS]...`.
    //   • kubectl's `[flags] [options]` double suffix.
    //   • cobra's `Use "<bin> … --help" for more information` footer.
    const shapeSignals =
      /^\s*\S+(?:\s+\S+)*\s+\[flags\]\s*$/m.test(help) ||
      (/^\s*\S+(?:\s+\S+)*\s+\[OPTIONS\]\s+COMMAND\s*$/m.test(help) && !/\[ARGS\]/.test(help)) ||
      /\[flags\]\s+\[options\]/m.test(help) ||
      /Use\s+"[^"]+--help"\s+for more information/i.test(help);
    return headerSignals || shapeSignals;
  },
  parsePage(help): ParsedPage {
    const s = cobraSections(help);
    const flags = withoutHelp(
      groupCobraFlags(s.Options)
        .map(parseFlag)
        .filter((f): f is CliFlag => !!f),
    );
    const subcommands = groupEntries(s.Commands)
      .map(parseSubRef)
      .filter((x): x is SubRef => !!x && x.name !== "help" && x.name !== "completion");
    return { flags, subcommands, positionals: parsePositionals(s.Usage) };
  },
};

export default adapter;
