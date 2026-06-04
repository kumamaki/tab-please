// clap v4 help format (Rust CLIs). Two layouts share one adapter:
//
//  ┌─ column (cargo) ──────────────────────────────────────────────────────┐
//  │ Usage: cargo [OPTIONS] [COMMAND]                                        │
//  │ Arguments:                                                              │
//  │   [ARGS]...  Arguments for the binary                                   │
//  │ Options:                                                                │
//  │   -A, --after-context <NUM>   Show NUM lines after [possible values: …] │
//  │ Commands:                                                               │
//  │   build, b    Compile the current package                              │
//  └────────────────────────────────────────────────────────────────────────┘
//  ┌─ long template (ripgrep `--help`) ────────────────────────────────────┐
//  │ INPUT OPTIONS:                  ← scattered UPPERCASE option sections   │
//  │     -A NUM, --after-context=NUM ← head on its own line, `=`/space arg   │
//  │         Show NUM lines after each match.   ← deep-indented prose desc   │
//  │                                                                         │
//  │     --color=WHEN                                                        │
//  │         …  The possible values for this flag are:  ← choices as prose   │
//  │         never: …                                                        │
//  │         auto: …                                                         │
//  └────────────────────────────────────────────────────────────────────────┘
//
// Unifying insight: a "flags section" is any section whose first entry head
// starts with "-". That folds cargo's Package/Target/Feature Selection and
// rg's INPUT/SEARCH/OUTPUT OPTIONS into one bucket — no header allow-list.
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import {
  bracketArg,
  isCommandToken,
  joinDesc,
  makeFlag,
  sectionize,
  splitHeadDesc,
  withoutHelp,
} from "./shared.ts";

// Header aliases: rg uses uppercase, plural, custom-titled sections. Fold the
// positional ones onto "Arguments"; option sections are detected structurally
// (head starts with "-"), so they don't need aliasing.
const HEADER_ALIASES: Record<string, string> = {
  "POSITIONAL ARGUMENTS": "Arguments",
  Arguments: "Arguments",
  Commands: "Commands",
};

const indentOf = (l: string) => l.match(/^\s*/)![0].length;

// Local grouper (not in shared.ts). shared.groupEntries is wrong for clap:
//   1. It splits entries on indent EQUALITY to a single base indent. clap right-
//      pads short flags so a long flag's head sits deeper than a short one's
//      (`··-V` vs `······--list`); equality misclassifies the deeper heads as
//      continuations, fusing most options into the first entry. A stray shallow
//      footer line (cargo's `See 'cargo help …'` at indent 0) poisons the base
//      indent the same way for the Commands section.
//   2. It discards blank lines, fusing rg's multi-paragraph long-help bodies.
//
// Fix: caller supplies an `isHead(line)` predicate (flags vs commands need
// different signals), and we keep intra-entry blank lines as "" so parseFlag can
// split paragraphs. Everything that isn't a head folds into the current entry.
//
// ⚠ Candidate to promote to shared.ts if another aligned-column / long-help
// format needs the same head/continuation discrimination.
function groupEntriesRaw(lines: string[], isHead: (line: string) => boolean): string[][] {
  const entries: string[][] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (entries.length) entries[entries.length - 1].push("");
      continue;
    }
    if (isHead(line)) entries.push([line.trim()]);
    else if (entries.length) entries[entries.length - 1].push(line.trim());
  }
  // Trim trailing blank markers (gaps between entries).
  return entries.map((e) => {
    let end = e.length;
    while (end > 0 && e[end - 1] === "") end--;
    return e.slice(0, end);
  });
}

// Flag heads: a "-"-led line shallower than the DESCRIPTION COLUMN. Descriptions
// are vertically aligned; lines not starting with "-" are unambiguously body
// text, so descCol = their min indent. This admits short+long heads at any pad
// and rejects rg's prose lines that merely start with "-" (they sit at descCol).
function flagHeadTest(lines: string[]): (line: string) => boolean {
  const body = lines.filter((l) => l.trim().length > 0);
  const nonFlag = body.filter((l) => !l.trim().startsWith("-"));
  const descCol = nonFlag.length
    ? Math.min(...nonFlag.map(indentOf))
    : Math.max(0, ...body.map(indentOf)) + 1;
  return (line) => line.trim().startsWith("-") && indentOf(line) < descCol;
}

// Command / positional heads: rows sit at one shallow indent; descriptions are
// deeper, and footer noise (cargo's `…  See all commands` overflow row, the
// trailing `See 'cargo help …'` line) is shallower or off-shape. Heads have a
// recognizable lead — `<UPPER>`/`[UPPER]` (positional) or a lowercase word
// (command, maybe `name, alias`); the footer's leading capital `S` / `…` fails
// it. So: head = a row whose lead matches AND sits at the shallowest such indent
// (rg's verbose arg descriptions can outnumber heads, so a modal vote misfires).
function rowHeadTest(lines: string[]): (line: string) => boolean {
  const looksLikeHead = (l: string) => /^[<\[a-z]/.test(l.trim());
  const headIndents = lines.filter((l) => l.trim() && looksLikeHead(l)).map(indentOf);
  if (headIndents.length === 0) return () => false;
  const headIndent = Math.min(...headIndents);
  return (line) => indentOf(line) === headIndent && looksLikeHead(line);
}

// ── description tails ────────────────────────────────────────────────────────
// clap appends bracketed metadata to the column-format description:
//   [possible values: a, b, c]   [default: x]   [aliases: foo, bar]
// Capture before stripping; the leftover text is the menu blurb.

function tailValues(desc: string, key: string): string[] | undefined {
  // Tolerate the list wrapping across (already-joined) lines: grab to the "]".
  const m = desc.match(new RegExp(`\\[${key}:\\s*([^\\]]+)\\]`));
  if (!m) return undefined;
  const vals = m[1].split(",").map((v) => v.trim()).filter(Boolean);
  return vals.length ? vals : undefined;
}

function stripTails(desc: string): string {
  return desc
    .replace(/\[possible values:[^\]]*\]/g, "")
    .replace(/\[default:[^\]]*\]/g, "")
    .replace(/\[aliases:[^\]]*\]/g, "")
    // Drop a dangling rg-prose "… The possible values for this flag are:" lead-in
    // — the values themselves live in `choices`, so this stub adds only noise.
    .replace(/\s*(?:The\s+)?possible values for this flag are:?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Local helper (not in shared.ts): re-segment one entry into paragraphs at its
// blank lines. groupEntries drops blanks outright, which collapses rg's long
// multi-paragraph bodies into one blob — we need the boundaries to (a) keep
// only the first paragraph as the menu blurb and (b) read prose choice lists.
// `firstDesc` is the head-line tail (column format), prepended to paragraph 0.
//
// ⚠ Candidate to promote to shared.ts if another long-help format wants it.
function entryParagraphs(entry: string[], firstDesc: string): string[] {
  const paras: string[] = [];
  let buf: string[] = firstDesc ? [firstDesc] : [];
  for (const line of entry.slice(1)) {
    if (line.trim() === "") {
      if (buf.length) paras.push(buf.join(" ").replace(/\s+/g, " ").trim());
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) paras.push(buf.join(" ").replace(/\s+/g, " ").trim());
  return paras.filter(Boolean);
}

// rg's long help has no brackets — choices come as prose: a sentinel sentence
// "… The possible values for this flag are:" (which may itself wrap), then one
// paragraph per value, each led by "<name>: …". Harvest the leading tokens.
function proseChoices(paras: string[]): string[] | undefined {
  const at = paras.findIndex((p) => /possible values for this flag are:?$/i.test(p));
  if (at < 0) return undefined;
  const out: string[] = [];
  for (const p of paras.slice(at + 1)) {
    const m = p.match(/^([A-Za-z][A-Za-z0-9_+-]*):\s/);
    if (m) out.push(m[1]);
    else if (out.length) break; // first off-shape paragraph ends the list
  }
  return out.length ? out : undefined;
}

// ── flag heads ───────────────────────────────────────────────────────────────
// A head may carry the value placeholder three ways:
//   -A, --after-context <NUM>     bracketed (column)  → bracketArg handles it
//   -A NUM, --after-context=NUM   space / `=` (rg)    → trailing UPPERCASE word
// Names are comma-separated; each name is the leading `-…` token of its piece.

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0]);

  // Segment the body into paragraphs. Column format → one paragraph (the head
  // tail, possibly with a wrapped [possible values:…]); rg long → many.
  const paras = entryParagraphs(entry, firstDesc);
  const fullDesc = paras.join(" ");
  const firstPara = paras[0] ?? "";

  // Choices: bracketed tail (column) wins; else prose list (rg long).
  const choices = tailValues(fullDesc, "possible values") ?? proseChoices(paras);

  // Try bracketed placeholder first (column). If none, pull a trailing
  // `=VALUE` or ` VALUE` (UPPERCASE) off the head (rg long).
  let { arg, optional, repeatable, rest } = bracketArg(head);
  if (!arg) {
    const ph = head.match(/[=\s]([A-Z][A-Z0-9_+?]*(?:\.\.\.)?|[A-Z][A-Z0-9_+?]*\??)\s*$/);
    if (ph) {
      const raw = ph[1];
      repeatable = raw.endsWith("...");
      arg = raw.replace(/\.{3}$/, "").replace(/[?]+$/, "");
      // Drop everything from the placeholder onward so name-splitting is clean:
      //   "-A NUM, --after-context=NUM" → "-A, --after-context"
      rest = head
        .replace(/=([A-Z][A-Z0-9_+?]*(?:\.\.\.)?)/g, "")
        .replace(/\s+[A-Z][A-Z0-9_+?]*(?:\.\.\.)?(?=,|$)/g, "")
        .trim();
    }
  }

  // A boolean flag may still carry a trailing `...` (clap's repeatable count,
  // e.g. `-v, --verbose...`) directly on the name — no placeholder. Strip it.
  if (!arg && /\.\.\.\s*$/.test(rest)) {
    repeatable = true;
    rest = rest.replace(/\.\.\.\s*$/, "").trim();
  }

  const names = rest.split(",").map((s) => s.trim().split(/\s+/)[0]);
  return makeFlag(names, stripTails(firstPara), { arg, optional, repeatable, choices });
}

// ── positionals ──────────────────────────────────────────────────────────────
// Source of truth is the `Arguments:` section (clean `<PATTERN>` / `[PATH]...`).
// We only fall back to the Usage synopsis when there's no Arguments section,
// because the synopsis also carries FLAG values (`--path <PATH>`, `--git <URL>`)
// that must not be mistaken for positionals.

function uppercaseArgs(text: string): string[] {
  const pos: string[] = [];
  for (const tok of text.matchAll(/[<\[]([A-Z][A-Z0-9_|=]*)(?:\.\.\.)?[>\]]/g)) {
    pos.push(tok[1].split(/[|=]/)[0].toLowerCase());
  }
  return pos;
}

// Drop any `<ARG>` / `[ARG]` immediately preceded by an option token — that's
// the flag's value, not a positional (`--path <PATH>`, `-o <FILE>`).
function usageArgs(line: string): string[] {
  const stripped = line.replace(/(?:^|\s)(--?[A-Za-z][\w-]*)[=\s][<\[][A-Z][A-Z0-9_|=]*(?:\.\.\.)?[>\]]/g, " ");
  return uppercaseArgs(stripped);
}

function parsePositionals(usageLines: string[], argEntries: string[][]): string[] {
  const seen = new Set<string>();
  const push = (name: string) => {
    const n = name.trim();
    if (n && n !== "options" && n !== "command" && n !== "args" && !seen.has(n)) seen.add(n);
  };
  for (const entry of argEntries) {
    for (const name of uppercaseArgs(entry[0])) push(name);
  }
  if (seen.size === 0) {
    // No Arguments section → fall back to the synopsis. A synopsis line begins
    // `Usage:` (column form) or carries `[OPTIONS]` (rg's indented USAGE: block);
    // that filter keeps us off the banner/description prose sectionize sweeps in.
    for (const line of usageLines) {
      if (!/^(Usage|usage):/.test(line) && !/\[OPTIONS\]/.test(line)) continue;
      for (const name of usageArgs(line)) push(name);
    }
  }
  return [...seen];
}

// ── subcommands ──────────────────────────────────────────────────────────────
//   build, b    Compile the current package        (name, alias before the gap)
// Reject the `...  See all commands with --list` overflow row.

function parseSubRef(entry: string[]): SubRef | null {
  const [signature, firstDesc] = splitHeadDesc(entry[0]);
  const tokens = signature.split(",").map((t) => t.trim());
  const name = tokens[0];
  if (!name || !isCommandToken(name)) return null;
  const aliases = tokens.slice(1).filter((a) => isCommandToken(a));
  return { name, aliases, description: stripTails(joinDesc(entry, firstDesc)) };
}

const adapter: Adapter = {
  name: "clap",
  detect(help) {
    // commander also emits "Usage:"/"Options:"; disambiguate by clap-only signs
    // and explicitly bow out on commander's "(choices:" syntax.
    if (/\(choices:/.test(help)) return false;
    if (/\[possible values:/.test(help)) return true;
    const hasUsage = /^Usage:/m.test(help) || /^USAGE:/m.test(help);
    const hasOptions = /^(Options|OPTIONS|[A-Z][A-Za-z ]*OPTIONS):\s*$/m.test(help);
    // A real positional/metavar (<PATTERN>, <NUM>, [PATH]) — but NOT the literal
    // usage placeholders click and commander also print (`[OPTIONS]`, `[COMMAND]`,
    // `[ARGS]`). Counting those made us hijack flask and other click tools.
    const PLACEHOLDER = new Set(["OPTIONS", "COMMAND", "ARGS", "SUBCOMMAND", "ARGUMENTS"]);
    const hasUpperArg = [...help.matchAll(/[<\[]([A-Z][A-Z0-9_]*)(?:\.\.\.)?[>\]]/g)].some(
      (m) => !PLACEHOLDER.has(m[1]),
    );
    return hasUsage && hasOptions && hasUpperArg;
  },
  parsePage(help): ParsedPage {
    const s = sectionize(help, HEADER_ALIASES);

    // Flags: every non-Usage/Arguments/Commands section whose first entry is a
    // flag. Covers Options + all the custom-titled option sections.
    const flags: CliFlag[] = [];
    for (const [title, lines] of Object.entries(s)) {
      if (title === "Usage" || title === "Arguments" || title === "Commands") continue;
      const entries = groupEntriesRaw(lines, flagHeadTest(lines));
      if (!entries.length || !entries[0][0].startsWith("-")) continue;
      for (const e of entries) {
        const f = parseFlag(e);
        if (f) flags.push(f);
      }
    }

    const argLines = s["Arguments"] ?? [];
    const argEntries = groupEntriesRaw(argLines, rowHeadTest(argLines));
    // rg titles its usage block `USAGE:` (own section); cargo's is in "Usage".
    const usageLines = [...(s["Usage"] ?? []), ...(s["USAGE"] ?? [])];
    const positionals = parsePositionals(usageLines, argEntries);

    const cmdLines = s["Commands"] ?? [];
    const subcommands = groupEntriesRaw(cmdLines, rowHeadTest(cmdLines))
      .map(parseSubRef)
      .filter((x): x is SubRef => !!x && x.name !== "help");

    return { flags: withoutHelp(flags), subcommands, positionals };
  },
};

export default adapter;
