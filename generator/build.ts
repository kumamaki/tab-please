// build.ts — merge generated.json + enrich.ts (+ helpers.zsh) into dist/_<tool>.
//
//   bun generator/build.ts <tool> [--out dist/_<tool>]
//
// The merge is by command PATH + flag/positional KEY, so the human enrichment
// survives regeneration: a new subcommand that appears in generated.json shows
// up automatically (with its boolean flags) and is only upgraded where enrich
// binds an action. Output ends with the loader-safe guarded idiom.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CliCommand, CliFlag, CliModel, Enrich } from "./types.ts";

const ROOT = resolve(import.meta.dir, "..");

/**
 * Clean a description for use inside a single-quoted `[…]` spec: drop the
 * trailing `(choices: …)`/`(default: …)`/`(preset: …)` noise (the value set is
 * already shown by the action) and strip chars that would break the quoting.
 */
const esc = (s: string) =>
  s
    .replace(/\((choices|default|preset):[^)]*\)/g, "")
    .replace(/[\[\]'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A command path → a zsh function name: ["sea-orm-cli","generate"] → "_sea-orm-cli_generate".
 *  Hyphens are KEPT (valid in zsh function names) so the root function matches the
 *  `#compdef <cmd>` tag, the filename, and the footer; only other punctuation is sanitized. */
const fnName = (path: string[]) => "_" + path.map((p) => p.replace(/[^a-zA-Z0-9-]/g, "_")).join("_");

/** Path key used to look up enrichment: root = "", else space-joined sans binary. */
const pathKey = (path: string[]) => path.slice(1).join(" ");

/** Count commands in the tree (root + every descendant) — the user-meaningful
 *  "how much can I now complete" number the `add` banner reports. */
const countCommands = (cmd: CliCommand): number =>
  1 + cmd.subcommands.reduce((n, s) => n + countCommands(s), 0);

const HELP_SPEC = `'(-h --help)'{-h,--help}'[Display help for command]'`;

function resolveFlagAction(
  path: string[],
  flag: CliFlag,
  actions: Record<string, string>,
): string | null {
  const pk = pathKey(path);
  for (const n of flag.names) {
    const key = `${pk}::${n}`;
    if (actions[key] != null) return actions[key];
  }
  if (flag.choices?.length) return `(${flag.choices.join(" ")})`;
  if (flag.arg) {
    const a = flag.arg.toLowerCase();
    if (/director|(^|[^a-z])dir([^a-z]|$)/.test(a)) return "_directories";
    if (/file|path/.test(a)) return "_files";
  }
  return null;
}

function flagSpec(path: string[], flag: CliFlag, actions: Record<string, string>): string {
  const action = resolveFlagAction(path, flag, actions);
  const names = flag.names;
  const excl = flag.repeatable ? "*" : `(${names.join(" ")})`;
  let body = `[${esc(flag.description)}]`;
  if (flag.arg) {
    const sep = flag.optional ? "::" : ":";
    body += `${sep}${flag.arg}:${action ?? ""}`;
  }
  return names.length > 1
    ? `'${excl}'{${names.join(",")}}'${body}'`
    : `'${excl}${names[0]}${body}'`;
}

function positionalSpecs(path: string[], cmd: CliCommand, actions: Record<string, string>): string[] {
  if (!cmd.positionals?.length) return [];
  const pk = pathKey(path);
  return cmd.positionals.map((name, i) => {
    const action = actions[`${pk}::pos:${i + 1}`] ?? "";
    return `'${i + 1}:${name}:${action}'`;
  });
}

function dispatchPattern(sub: CliCommand): string {
  return [sub.name, ...(sub.aliases ?? [])].join("|");
}

/** Emit one command (and recurse). Returns an array of complete zsh function blocks. */
function emitCommand(
  cmd: CliCommand,
  path: string[],
  actions: Record<string, string>,
  hide: Set<string>,
): string[] {
  const blocks: string[] = [];
  const f = fnName(path);
  const flagSpecs = cmd.flags.map((fl) => flagSpec(path, fl, actions));

  // Drop subcommands the enrichment hides (deprecated/internal), by path key.
  const subcommands = cmd.subcommands.filter((s) => !hide.has(pathKey([...path, s.name])));

  if (subcommands.length > 0) {
    // Container: state machine over subcommands.
    const argSpecs = [...flagSpecs, HELP_SPEC, `'1: :${f}_commands'`, `'*::arg:->args'`];
    const dispatch = subcommands
      .map((s) => `        ${dispatchPattern(s)}) ${fnName([...path, s.name])} ;;`)
      .join("\n");
    blocks.push(
      `${f}() {\n` +
        `  local curcontext="$curcontext" state line\n` +
        `  _arguments -C \\\n    ${argSpecs.join(" \\\n    ")}\n` +
        `  case $state in\n` +
        `    args)\n` +
        `      case $line[1] in\n` +
        `${dispatch}\n` +
        `      esac\n` +
        `      ;;\n` +
        `  esac\n` +
        `}`,
    );

    // Subcommand list function.
    const items = [
      ...subcommands.map((s) => `    '${s.name}:${esc(s.description)}'`),
      `    'help:Display help for command'`,
    ].join("\n");
    blocks.push(
      `${f}_commands() {\n` +
        `  local -a _c=(\n${items}\n  )\n` +
        `  _describe -t commands '${cmd.name} command' _c\n` +
        `}`,
    );

    for (const sub of subcommands) {
      blocks.push(...emitCommand(sub, [...path, sub.name], actions, hide));
    }
  } else {
    // Leaf: flags + positionals.
    const argSpecs = [...flagSpecs, HELP_SPEC, ...positionalSpecs(path, cmd, actions)];
    blocks.push(`${f}() {\n  _arguments \\\n    ${argSpecs.join(" \\\n    ")}\n}`);
  }

  return blocks;
}

function loadEnrich(tool: string): Promise<Enrich> {
  const tsPath = resolve(ROOT, "tools", tool, "enrich.ts");
  if (!existsSync(tsPath)) return Promise.resolve({} as Enrich);
  return import(tsPath).then((m) => (m.default ?? m.enrich ?? {}) as Enrich);
}

async function main() {
  const args = process.argv.slice(2);
  const tool = args[0];
  if (!tool || tool.startsWith("-")) {
    console.error("usage: bun generator/build.ts <tool> [--out <file>]");
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : resolve(ROOT, "dist", `_${tool}`);
  // --quiet: stay off the diagnostics channel and print only the command count
  // to stdout, for the shell `add` flow to fold into its own success banner.
  const quiet = args.includes("--quiet");

  // --from <model.json> builds an arbitrary tool (on-demand `tab-please add`),
  // bypassing the tools/<tool>/ convention. Default is the curated location.
  const fromIdx = args.indexOf("--from");
  const genPath = fromIdx >= 0 ? resolve(args[fromIdx + 1]) : resolve(ROOT, "tools", tool, "generated.json");
  if (!existsSync(genPath)) {
    console.error(`missing ${genPath} — run \`bun generator/parse.ts ${tool} --out ${genPath}\` first`);
    process.exit(1);
  }
  const model: CliModel = JSON.parse(readFileSync(genPath, "utf8"));
  const enrich = await loadEnrich(tool);
  const actions = enrich.actions ?? {};

  let helpers = "";
  if (enrich.helpersFile) {
    const hp = resolve(ROOT, "tools", tool, enrich.helpersFile);
    if (existsSync(hp)) helpers = readFileSync(hp, "utf8").trimEnd();
  }

  const cmd = model.command;
  const hide = new Set(enrich.hide ?? []);
  const blocks = emitCommand(model.root, [cmd], actions, hide);
  const rootFn = fnName([cmd]);

  const header =
    `#compdef ${cmd}\n` +
    `# ${cmd} zsh completion — generated by tab-please from ${cmd} ${model.version ?? "?"}.\n` +
    `# Do not edit by hand: regenerate with \`bun generator/build.ts ${cmd}\`.\n` +
    `# Enrichment (value actions, dynamic helpers) lives in tools/${cmd}/.`;

  // Use the sanitized fn name (not `_${cmd}`) so a command whose name carries
  // punctuation fnName rewrites (e.g. a dot) still resolves to the defined
  // function; the `#compdef`/compdef target stays the real command name.
  const footer =
    `if [[ $funcstack[1] = ${rootFn} ]]; then\n` +
    `  ${rootFn} "$@"\n` +
    `elif (( $+functions[compdef] )); then\n` +
    `  compdef ${rootFn} ${cmd}\n` +
    `fi`;

  const parts = [header, helpers, blocks.join("\n\n"), footer].filter(Boolean);
  writeFileSync(out, parts.join("\n\n") + "\n");
  if (quiet) process.stdout.write(`${countCommands(model.root)}\n`);
  else console.error(`wrote ${out} (${blocks.length} functions)`);
}

main();
