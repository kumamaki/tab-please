import type { Enrich } from "../../generator/types.ts";

// Human enrichment for claude. The command tree + boolean flags + (choices:…)
// enums come from generated.json automatically; this file adds the things
// --help can't express: dynamic lookups, value sets, and file/dir typing that
// the heuristic misses.
//
// Keys are "<command path>::<selector>":
//   - path is space-joined subcommands; the root command is "" (empty)
//   - selector is a flag spelling (--model, -t) or pos:N for the Nth positional
// Values are raw zsh completion actions.

const enrich: Enrich = {
  helpersFile: "helpers.zsh",
  actions: {
    // ── root: model + dynamic-value flags ───────────────────────────────
    "::--model": "_claude_models",
    "::--fallback-model": "_claude_models",
    "::--setting-sources": "_claude_setting_sources",
    // file/dir typing the arg-name heuristic doesn't catch
    "::--settings": "_files",
    "::--mcp-config": "_files",
    "::--debug-file": "_files",
    "::--plugin-dir": "_directories",
    // (--add-dir, --output-format, --permission-mode, --input-format, --effort
    //  resolve automatically: dir heuristic + parsed (choices:…))

    // ── mcp ─────────────────────────────────────────────────────────────
    "mcp add::-t": "(stdio sse http)",
    "mcp add::-s": "(local user project)",
    "mcp remove::-s": "(local user project)",
    "mcp remove::pos:1": "_claude_mcp_servers",
    "mcp get::pos:1": "_claude_mcp_servers",

    // ── plugin: complete against installed plugins ──────────────────────
    "plugin enable::pos:1": "_claude_plugins",
    "plugin disable::pos:1": "_claude_plugins",
    "plugin uninstall::pos:1": "_claude_plugins",
    "plugin update::pos:1": "_claude_plugins",
    "plugin details::pos:1": "_claude_plugins",

    // ── install: documented targets ─────────────────────────────────────
    "install::pos:1": "(stable latest)",
  },
};

export default enrich;
