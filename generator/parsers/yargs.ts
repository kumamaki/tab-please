// yargs help format (Node.js). Two themes in the wild:
//
//   Standard yargs (lowercase, colon headers):
//     prog <command>
//     Commands:
//       prog deploy [script]   Deploy ...   [aliases: publish]
//     Positionals:
//       key   The key   [string] [required]
//     Options:
//       -c, --config   Path ...   [string]
//
//   Custom-themed yargs (e.g. wrangler — UPPERCASE, no colon, emoji, and
//   command rows split across several arbitrarily-named group headers):
//     wrangler <command>
//     COMMANDS
//       wrangler deploy [script]   🆙 Deploy a Worker ...
//     ACCOUNT
//       wrangler login            🔓 Login to Cloudflare
//     GLOBAL FLAGS
//       -c, --config   Path ...   [string]
//
// Both share the load-bearing yargs signal: option/positional rows carry
// trailing type tags — [string] [boolean] [number] [array] [count] [required]
// [choices: "a","b"] [default: ...] [deprecated]. A flag takes a value iff it
// has [string]/[number]/[array]; [boolean]/[count] are valueless. Command rows
// are PREFIXED with the program path — the real subcommand is the token after it.
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import { joinDesc, makeFlag, splitHeadDesc } from "./shared.ts";

// Headers that mean "these rows are options". Custom themes alias Flags/Global
// Flags onto Options; we also fold them here.
const OPTION_HEADERS = new Set(["options", "flags", "global flags"]);
// Headers whose rows are NOT commands even though they're program-prefixed
// (wrangler's EXAMPLES block looks exactly like a command list — skip it).
const NON_COMMAND_HEADERS = new Set(["examples", "positionals"]);

/**
 * Split a yargs page into sections, classifying each header into one of:
 * "Commands" (any header whose rows are program-prefixed command rows),
 * "Options", "Positionals", or a dropped bucket. Handles both the
 * lowercase-colon and UPPERCASE-no-colon header styles, and folds the many
 * custom command-group headers (ACCOUNT, STORAGE & DATABASES, …) into one
 * "Commands" section. Local to this adapter: shared.sectionize only matches
 * `Title:` headers, so it can't see wrangler's colon-less themed headers.
 */
function yargsSections(help: string, prog: string): Record<string, string[]> {
  const out: Record<string, string[]> = { Usage: [], Commands: [], Options: [], Positionals: [] };
  // A header is a non-indented line of letters/spaces/&/colon only — a section
  // title, not an entry (entries are indented) and not the usage line.
  const headerRe = /^([A-Za-z][A-Za-z &/]*?):?\s*$/;
  // Command rows begin with the program path (first word(s) of the usage line).
  const cmdRowRe = new RegExp(`^\\s+${escapeRe(prog)}(\\s|$)`);

  const lines = help.split("\n");
  const firstNonBlank = lines.findIndex((l) => l.trim().length > 0);
  let bucket: string | null = "Usage";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The very first non-blank line is always the usage line for both themes
    // (`wrangler` / `prog <command>`), even when it pattern-matches a header.
    if (i === firstNonBlank) {
      out["Usage"].push(line);
      continue;
    }
    if (line.trim().length === 0) {
      if (bucket) out[bucket].push(line);
      continue;
    }
    const indented = /^\s/.test(line);
    if (!indented) {
      // Non-indented content: either a section header, the standard "Usage:"
      // line, or trailing prose (e.g. wrangler's "Please report any issues…").
      // Trailing prose must NOT leak into a content bucket — it would poison
      // groupEntries' base-indent calc. So a non-header, non-usage flat line
      // ends the current bucket.
      if (/^(Usage|usage)\b/.test(line)) {
        out["Usage"].push(line);
        continue;
      }
      if (headerRe.test(line)) {
        const title = line.replace(/:?\s*$/, "").trim().toLowerCase();
        if (NON_COMMAND_HEADERS.has(title)) bucket = title === "positionals" ? "Positionals" : null;
        else if (OPTION_HEADERS.has(title)) bucket = "Options";
        else if (title === "commands") bucket = "Commands";
        // Any other header (wrangler's themed command groups: ACCOUNT,
        // STORAGE & DATABASES, …) introduces program-prefixed command rows.
        else bucket = "Commands";
        continue;
      }
      bucket = null; // trailing prose → stop collecting
      continue;
    }
    if (bucket === null) continue;
    // In the Commands bucket, keep only genuine program-prefixed rows plus
    // their deeper-indented wrap lines; reject stray prose under a group header.
    if (bucket === "Commands" && !cmdRowRe.test(line)) {
      const last = out["Commands"];
      if (last.length && /^\s{2,}/.test(line)) last.push(line);
      continue;
    }
    out[bucket].push(line);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Group rows into entries by detecting head lines, NOT by raw indent.
 *
 * yargs column-aligns rows, so a short-flag row (`  -c, --config`, indent 2)
 * and a long-only row (`      --cwd`, indent 6) sit at different leading
 * indents — shared.groupEntries would (wrongly) nest the deeper one under the
 * shallower. Here a new entry starts whenever a line matches `isHead`; any
 * other non-blank line is a wrap continuation of the current entry. (Wrapped
 * description lines like wrangler's multi-line `--keep-vars` are deeply
 * indented and never match isHead, so they fold in correctly.)
 */
function yargsEntries(lines: string[], isHead: (trimmed: string) => boolean): string[][] {
  const entries: string[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (isHead(t) || entries.length === 0) entries.push([t]);
    else entries[entries.length - 1].push(t);
  }
  return entries;
}

const isFlagHead = (t: string) => t.startsWith("-");

// Trailing yargs type/meta tags, captured so we can both classify the flag and
// strip them from the description.
const TAG_RE = /\[(string|boolean|number|array|count|required|deprecated|default:[^\]]*|choices:[^\]]*|aliases:[^\]]*)\]/g;

function parseTags(desc: string): {
  takesValue: boolean;
  argName?: string;
  choices?: string[];
  aliases: string[];
  clean: string;
} {
  const tags = [...desc.matchAll(TAG_RE)].map((m) => m[1]);
  let argName: string | undefined;
  let takesValue = false;
  for (const t of tags) {
    if (t === "string") (takesValue = true), (argName ??= "string");
    else if (t === "number") (takesValue = true), (argName ??= "number");
    else if (t === "array") (takesValue = true), (argName ??= "value");
  }
  const choicesTag = tags.find((t) => t.startsWith("choices:"));
  const choices = choicesTag
    ? [...choicesTag.matchAll(/"([^"]*)"/g)].map((x) => x[1])
    : undefined;
  // [array] flags repeat; expose a placeholder name for value-taking flags.
  const aliasesTag = tags.find((t) => t.startsWith("aliases:"));
  const aliases = aliasesTag
    ? aliasesTag
        .slice("aliases:".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (choices?.length) (takesValue = true), (argName = "choice");
  const clean = desc.replace(TAG_RE, "").replace(/\s+/g, " ").trim();
  return { takesValue, argName, choices: choices?.length ? choices : undefined, aliases, clean };
}

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0]);
  const rawDesc = joinDesc(entry, firstDesc);
  const { takesValue, argName, choices, aliases, clean } = parseTags(rawDesc);
  // Flag names: yargs prints `-c, --config` (and extra spellings, e.g.
  // `--compatibility-flags, --compatibility-flag`). The head has no <arg>.
  const inlineAliasNames = aliases.filter((a) => a.startsWith("-"));
  const names = [...head.split(",").map((s) => s.trim()), ...inlineAliasNames];
  const repeatable = /\[array\]/.test(rawDesc);
  return makeFlag(names, clean, {
    arg: takesValue ? argName : undefined,
    optional: takesValue ? true : undefined,
    repeatable: repeatable || undefined,
    choices,
  });
}

// Positionals come from the usage line (`prog put <key> [value]`). Some yargs
// CLIs leave the usage line as just `prog <command>` and only name positionals
// in the Positionals: section, so we fall back to those rows' head tokens.
function parsePositionals(usageLines: string[], positionalRows: string[]): string[] {
  const skip = new Set(["options", "command", "cmd", "subcommand"]);
  const usage = usageLines.find((l) => l.trim().length > 0) ?? "";
  const pos: string[] = [];
  for (const tok of usage.matchAll(/[<\[]([^>\]]+)[>\]]/g)) {
    const name = tok[1].replace(/\.{2,}$/, "").trim();
    if (!skip.has(name)) pos.push(name);
  }
  if (pos.length === 0) {
    for (const entry of yargsEntries(positionalRows, () => true)) {
      const [head] = splitHeadDesc(entry[0]);
      const name = head.replace(/[<>\[\]]/g, "").replace(/\.{2,}$/, "").trim();
      if (name && !name.startsWith("-") && !skip.has(name)) pos.push(name);
    }
  }
  return pos;
}

// "wrangler kv key put <key> [value]   desc..." → real subcommand is the token
// right after the program path. We strip the known program prefix, then take
// the first non-placeholder token. Aliases come from a [aliases: a,b] tail.
function parseSubRef(entry: string[], prog: string): SubRef | null {
  const [signature, firstDesc] = splitHeadDesc(entry[0]);
  if (!signature.startsWith(prog)) return null;
  const after = signature.slice(prog.length).trim();
  // Drop any nested-parent path tokens; the subcommand is the FIRST token that
  // isn't a positional placeholder. For "kv key put <key>" under prog
  // "wrangler kv key" the prefix is already stripped, leaving "put <key>".
  const tokens = after.split(/\s+/).filter(Boolean);
  const name = tokens.find((t) => !/^[<\[]/.test(t));
  if (!name || !/^[a-z][a-z0-9-]*$/i.test(name)) return null;
  const { aliases, clean } = parseTags(joinDesc(entry, firstDesc));
  // Aliases that are plain command words (not -flags) are real subcommand aliases.
  return { name, aliases: aliases.filter((a) => !a.startsWith("-")), description: clean };
}

// First word of the usage line is the program/parent path. The usage line is
// the first non-blank line ("wrangler kv key" / "prog <command>"); take
// everything before the first placeholder/option token as the program path.
function programPath(help: string): string {
  const first = help.split("\n").find((l) => l.trim().length > 0) ?? "";
  const m = first.trim().replace(/^(Usage|usage):\s*/, "");
  const path: string[] = [];
  for (const tok of m.split(/\s+/)) {
    if (/^[<\[-]/.test(tok)) break;
    path.push(tok);
  }
  return path.join(" ");
}

const adapter: Adapter = {
  name: "yargs",
  detect(help) {
    // yargs-specific: trailing bracket type tags on option/positional rows, or
    // the bracket-tag aliases/choices style. These don't appear in commander
    // (which uses `(choices: ...)` parens) or clap.
    const hasTypeTags = /\[(boolean|string|number|array|count)\]/.test(help);
    const hasBracketMeta = /\[(aliases|choices|default):/.test(help);
    const hasProgPrefixedCmds = (() => {
      const prog = programPath(help);
      if (!prog) return false;
      return new RegExp(`^\\s+${escapeRe(prog)}\\s+\\S`, "m").test(help);
    })();
    // Require the type-tag signal (the strongest yargs tell) OR prog-prefixed
    // command rows combined with bracket meta, so we don't fire on clap/cobra.
    return hasTypeTags || (hasProgPrefixedCmds && hasBracketMeta);
  },
  parsePage(help): ParsedPage {
    const prog = programPath(help);
    const s = yargsSections(help, prog);

    const drop = new Set(["-h", "--help", "-v", "--version"]);
    const flags = yargsEntries(s["Options"], isFlagHead)
      .map(parseFlag)
      .filter((f): f is CliFlag => !!f && !f.names.some((n) => drop.has(n)));

    // A command row's head starts with the program path; wrap lines don't.
    const isCmdHead = (t: string) => (prog ? t.startsWith(prog + " ") : false);
    const seen = new Set<string>();
    const subcommands = yargsEntries(s["Commands"], isCmdHead)
      .map((e) => parseSubRef(e, prog))
      .filter((x): x is SubRef => !!x && x.name !== "help")
      .filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)));

    return { flags, subcommands, positionals: parsePositionals(s["Usage"] ?? [], s["Positionals"] ?? []) };
  },
};

export default adapter;
