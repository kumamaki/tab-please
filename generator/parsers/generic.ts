// Generic / getopt fallback for unstructured help (curl, classic unix tools).
// No section structure is assumed: scan every line for `-x` / `--xxx [ARG]`
// patterns and treat them all as top-level flags. No subcommands. Low fidelity
// by nature — meant as a floor so *some* completion exists; enrich.ts carries
// the rest. Never auto-detected (it would swallow everything); opt in with
// --format generic.
import type { Adapter, CliFlag, ParsedPage } from "../types.ts";
import { makeFlag } from "./shared.ts";

const FLAG_RE =
  /(?:^|\s)(-[A-Za-z0-9])?(?:,\s*)?(--[A-Za-z0-9][\w-]*)?(?:[ =](<[^>]+>|\[[^\]]+\]|[A-Z][A-Z_]+))?\s{2,}(.+)/;

function parseLine(line: string): CliFlag | null {
  const m = line.match(FLAG_RE);
  if (!m) return null;
  const [, short, long, argTok, desc] = m;
  const names = [short, long].filter(Boolean) as string[];
  if (names.length === 0) return null;
  const arg = argTok ? argTok.replace(/[<>\[\]]/g, "").replace(/\.{2,}$/, "").trim() : undefined;
  return makeFlag(names, desc, { arg });
}

const adapter: Adapter = {
  name: "generic",
  detect() {
    return false; // explicit opt-in only
  },
  parsePage(help): ParsedPage {
    const flags: CliFlag[] = [];
    const seen = new Set<string>();
    for (const line of help.split("\n")) {
      const f = parseLine(line);
      if (!f) continue;
      const key = f.names.join(",");
      if (seen.has(key) || f.names.includes("-h") || f.names.includes("--help")) continue;
      seen.add(key);
      flags.push(f);
    }
    return { flags, subcommands: [], positionals: [] };
  },
};

export default adapter;
