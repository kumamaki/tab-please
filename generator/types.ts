// Shared data model for tab-please.
//
// The pipeline is:  cmd --help ──parse──▶ generated.json ─┐
//                   tools/<x>/enrich.yml ─────────────────┼─merge─▶ Spec ─build─▶ dist/_<x>
//                   tools/<x>/helpers.zsh ────────────────┘
//
// `generated.json` is a faithful, never-hand-edited dump of the CLI's --help
// tree. `enrich.yml` is the human layer: value actions, choice sets help can't
// express, dynamic-helper bindings, and alias hints. The merge is by command
// PATH + flag/positional KEY, so enrichment survives regeneration — a new
// subcommand from --help shows up automatically, keeping its boolean flags,
// and is only "enriched" where a human adds value.

/** A single option/flag as parsed from --help. */
export interface CliFlag {
  /** All spellings, e.g. ["-m", "--model"] or ["--allowedTools", "--allowed-tools"]. */
  names: string[];
  /** Argument placeholder name if the flag takes a value (`<model>` → "model"); absent ⇒ boolean. */
  arg?: string;
  /** `[value]` (optional) vs `<value>` (required). Only meaningful when `arg` is set. */
  optional?: boolean;
  /** `<dirs...>` ellipsis ⇒ the flag may be repeated. */
  repeatable?: boolean;
  /** One-line description (un-wrapped). */
  description: string;
  /** Values parsed from `(choices: "a", "b")`. */
  choices?: string[];
}

/** A command or subcommand node. */
export interface CliCommand {
  /** Canonical name, e.g. "mcp". Root command uses the binary name. */
  name: string;
  /** Extra spellings from `plugin|plugins`. */
  aliases?: string[];
  description: string;
  flags: CliFlag[];
  subcommands: CliCommand[];
  /** Positional placeholders from the Usage line, e.g. ["name", "commandOrUrl"]. */
  positionals?: string[];
}

/** Top-level parsed model (the content of generated.json). */
export interface CliModel {
  /** Binary name, e.g. "claude". */
  command: string;
  /** `cmd --version` at parse time, if available. Used to key regeneration. */
  version?: string;
  /** Help format the parser used (commander, yargs, cobra, …). */
  format?: string;
  root: CliCommand;
}

// ── Parser adapters ────────────────────────────────────────────────────────
// One CLI's --help format = one adapter. The driver (parse.ts) owns recursion
// and IO; an adapter only turns a single rendered --help page into structure.
// To add a format, drop a `generator/parsers/<name>.ts` that default-exports an
// Adapter — nothing else in the pipeline changes.

/** A subcommand as referenced from a parent's Commands list. */
export interface SubRef {
  name: string;
  aliases: string[];
  description: string;
}

/** The structured result of parsing ONE command's --help page. */
export interface ParsedPage {
  flags: CliFlag[];
  subcommands: SubRef[];
  positionals: string[];
}

export interface Adapter {
  /** Format id, e.g. "cobra". Matches the filename and the --format flag. */
  name: string;
  /** Auto-detect: does the root --help look like this format? Be specific. */
  detect(rootHelp: string): boolean;
  /** Parse one --help page into flags / subcommand refs / positionals. */
  parsePage(help: string): ParsedPage;
  /** How to ask a (sub)command for help. Default: [...path, "--help"]. */
  helpArgs?(path: string[]): string[];
}

/**
 * Human enrichment layer (tools/<x>/enrich.yml).
 *
 * `actions` keys are `"<command path>::<selector>"`:
 *   - command path is space-joined subcommands; the root command is "" (empty).
 *   - selector is a flag spelling (`--model`, `-t`) or `pos:N` for the Nth positional.
 * Values are a raw zsh completion action:
 *   - `(a b c)`            literal choice set
 *   - `_files` / `_directories` / `_claude_models`  a helper/function
 *   - `_values -s , tag a b c`   any valid action string
 */
export interface Enrich {
  /** Relative path to a zsh file injected verbatim at the top (dynamic helpers). */
  helpersFile?: string;
  /**
   * Pin the parser's format adapter, overriding auto-detection. Set this when a
   * tool's --help won't auto-detect — most often `"generic"` for unstructured
   * getopt help (which is never auto-detected). `regen.ts` reads it so the
   * choice survives every regeneration instead of being re-detected away.
   */
  format?: string;
  /** action overrides, keyed by `"<path>::<selector>"`. */
  actions?: Record<string, string>;
  /** Subcommands to drop from completion (deprecated/hidden), by path. */
  hide?: string[];
}

/** Fully-merged, build-ready spec. */
export interface Spec {
  command: string;
  version?: string;
  root: CliCommand;
  actions: Record<string, string>;
  helpers: string; // resolved contents of helpersFile, or ""
}
