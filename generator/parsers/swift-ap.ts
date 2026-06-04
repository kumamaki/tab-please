// Swift ArgumentParser help format (mas, xcrun, swift-package, etc.)
//
// OVERVIEW: Mac App Store command-line interface
//
// USAGE: mas <subcommand>
//
// OPTIONS:
//   --version               Show the version.
//   -h, --help              Show help information.
//
// SUBCOMMANDS:
//   config                  Output mas config & related system info
//   get, purchase           Get & install free apps  ← comma-space aliases
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

function parseFlag(entry: string[]): CliFlag | null {
  if (!entry[0].trim().startsWith("-")) return null;
  const [head, firstDesc] = splitHeadDesc(entry[0].trim());
  const { arg, optional, repeatable, rest } = bracketArg(head);
  const names = rest.split(",").map((s) => s.trim());
  return makeFlag(names, joinDesc(entry, firstDesc), { arg, optional, repeatable });
}

// Swift AP aliases are comma+space separated: `get, purchase` not `get|purchase`
function parseSubRef(entry: string[]): SubRef | null {
  const [signature, firstDesc] = splitHeadDesc(entry[0].trim());
  const names = signature.split(/,\s+/).map((s) => s.trim());
  const [name, ...rest] = names;
  if (!name || !isCommandToken(name)) return null;
  const aliases = rest.filter((n) => isCommandToken(n));
  return { name, aliases, description: joinDesc(entry, firstDesc) };
}

const adapter: Adapter = {
  name: "swift-ap",
  detect(help) {
    // OVERVIEW: is the strongest signal — no other format uses it
    return /^OVERVIEW:/m.test(help) || (/^SUBCOMMANDS:/m.test(help) && /^OPTIONS:/m.test(help));
  },
  parsePage(help): ParsedPage {
    const s = sectionize(help, {
      OPTIONS: "Options",
      ARGUMENTS: "Arguments",
      SUBCOMMANDS: "Commands",
    });
    const flags = withoutHelp(
      (s["Options"] ? groupEntries(s["Options"]) : [])
        .map(parseFlag)
        .filter((f): f is CliFlag => !!f),
    );
    const subcommands = (s["Commands"] ? groupEntries(s["Commands"]) : [])
      .map(parseSubRef)
      .filter((x): x is SubRef => !!x && x.name !== "help");
    return { flags, subcommands, positionals: [] };
  },
};

export default adapter;
