// Commander.js help format.
//   Usage: cmd [options] [command]
//   Options:
//     -m, --model <model>   desc... (choices: "a", "b") (default: "x")
//   Commands:
//     mcp                   Configure...
//     plugin|plugins        Manage...
import type { Adapter, CliFlag, ParsedPage, SubRef } from "../types.ts";
import {
  bracketArg,
  groupEntries,
  isCommandToken,
  joinDesc,
  makeFlag,
  sectionize,
  splitHeadDesc,
  withoutHelp,
} from "./shared.ts";

function parseChoices(text: string): string[] | undefined {
  const m = text.match(/\(choices:\s*([^)]+)\)/);
  if (!m) return undefined;
  const vals = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return vals.length ? vals : undefined;
}

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0]);
  const description = joinDesc(entry, firstDesc);
  const { arg, optional, repeatable, rest } = bracketArg(head);
  const names = rest.split(",").map((s) => s.trim());
  return makeFlag(names, description, { arg, optional, repeatable, choices: parseChoices(description) });
}

function parsePositionals(usageLines: string[]): string[] {
  const usage = usageLines.find((l) => /^Usage:/.test(l)) ?? "";
  const after = usage.replace(/^Usage:\s*\S+/, "");
  const pos: string[] = [];
  for (const tok of after.matchAll(/[<\[]([^>\]]+)[>\]]/g)) {
    const name = tok[1].replace(/\.{2,}$/, "").trim();
    if (name === "options" || name === "command") continue;
    pos.push(name);
  }
  return pos;
}

function parseSubRef(entry: string[]): SubRef | null {
  const [signature, firstDesc] = splitHeadDesc(entry[0]);
  const token = signature.split(/\s+/)[0];
  if (!token || !isCommandToken(token)) return null;
  const [name, ...aliases] = token.split("|");
  return { name, aliases, description: joinDesc(entry, firstDesc) };
}

const adapter: Adapter = {
  name: "commander",
  detect(help) {
    return (
      /^Usage:\s+\S+\s+\[options\]/m.test(help) ||
      /\(choices:/.test(help) ||
      (/^Options:\s*$/m.test(help) && /^Commands:\s*$/m.test(help))
    );
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
