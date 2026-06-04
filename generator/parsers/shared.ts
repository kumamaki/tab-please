// Shared parsing helpers for adapters. These cover the structure that almost
// every CLI help format has in common: titled sections, indented entries that
// may wrap across lines, and "head  description" two-column rows. Adapters use
// these to avoid re-implementing the boring 80%.

import type { CliFlag } from "../types.ts";

/**
 * Split a rendered --help page into sections keyed by header.
 *
 * `aliases` folds a format's header names onto canonical ones, e.g.
 *   { "Flags": "Options", "Available Commands": "Commands", "Global Flags": "Options" }
 * Lines before the first header land in "Usage".
 */
export function sectionize(help: string, aliases: Record<string, string> = {}): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current = "Usage";
  for (const line of help.split("\n")) {
    // A header is a left-aligned "Title:" line with nothing else on it.
    const m = line.match(/^([A-Za-z][A-Za-z /]+):\s*$/);
    if (m) {
      const raw = m[1].trim();
      current = aliases[raw] ?? raw;
      sections[current] ??= [];
      continue;
    }
    if (/^(Usage|usage):/.test(line)) {
      (sections["Usage"] ??= []).push(line);
      continue;
    }
    (sections[current] ??= []).push(line);
  }
  return sections;
}

/**
 * Group an indented section into entries. Each entry is the lines of one item:
 * a head line at the section's base indent, plus any deeper-indented wrap lines.
 */
export function groupEntries(lines: string[]): string[][] {
  const body = lines.filter((l) => l.trim().length > 0);
  if (body.length === 0) return [];
  const baseIndent = Math.min(...body.map((l) => l.match(/^\s*/)![0].length));
  const entries: string[][] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^\s*/)![0].length;
    if (indent === baseIndent) entries.push([line.trim()]);
    else if (entries.length) entries[entries.length - 1].push(line.trim());
  }
  return entries;
}

/** Split a row at its first run of 2+ spaces → [head, description-start]. */
export function splitHeadDesc(firstLine: string): [string, string] {
  const gap = firstLine.search(/\s{2,}/);
  return gap >= 0 ? [firstLine.slice(0, gap).trim(), firstLine.slice(gap).trim()] : [firstLine.trim(), ""];
}

/** Join an entry's wrapped lines into one clean description string. */
export function joinDesc(entry: string[], firstDesc: string): string {
  return [firstDesc, ...entry.slice(1)].join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Pull a `<arg>` / `[arg]` / `<arg...>` / `[arg...]` placeholder out of a flag
 * head. Returns the argument name (sans ellipsis), whether it's optional/
 * repeatable, and the head with the placeholder removed.
 */
export function bracketArg(head: string): {
  arg?: string;
  optional: boolean;
  repeatable: boolean;
  rest: string;
} {
  const m = head.match(/[<\[]([^>\]]+)[>\]]/);
  if (!m) return { optional: false, repeatable: false, rest: head };
  const inside = m[1];
  const repeatable = inside.endsWith("...") || inside.endsWith("..");
  return {
    arg: inside.replace(/\.{2,}$/, "").trim(),
    optional: m[0].startsWith("["),
    repeatable,
    rest: head.replace(m[0], "").trim(),
  };
}

/** Build a CliFlag, attaching choices if the description carries an enum. */
export function makeFlag(
  names: string[],
  description: string,
  opts: { arg?: string; optional?: boolean; repeatable?: boolean; choices?: string[] } = {},
): CliFlag | null {
  const cleaned = names.map((n) => n.trim()).filter((n) => n.startsWith("-"));
  if (cleaned.length === 0) return null;
  return {
    names: cleaned,
    ...(opts.arg ? { arg: opts.arg } : {}),
    ...(opts.optional ? { optional: true } : {}),
    ...(opts.repeatable ? { repeatable: true } : {}),
    description: description.replace(/\s+/g, " ").trim(),
    ...(opts.choices?.length ? { choices: opts.choices } : {}),
  };
}

/** Is this a real (sub)command token, or section noise like "Examples:"? */
export function isCommandToken(token: string): boolean {
  return /^[a-z][a-z0-9-]*(\|[a-z][a-z0-9-]*)*$/.test(token);
}

/** Drop the -h/--help flag — completions add their own. */
export function withoutHelp(flags: CliFlag[]): CliFlag[] {
  return flags.filter((f) => !f.names.includes("-h") && !f.names.includes("--help"));
}
