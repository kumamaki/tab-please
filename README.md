# tab-please

Zsh completions for popular CLIs that **stay current**. Each completion is
generated from the tool's own `--help` and hand-enriched where it counts
(choice values, dynamic lookups, file/dir typing) — then regenerated
automatically when the CLI ships a new version. No more stale, hand-written
completion files that rot the moment a subcommand is added.

```
claude mcp remove <Tab>      → your actual configured MCP servers
claude --permission-mode <Tab> → acceptEdits  auto  bypassPermissions  default  …
claude plugin enable <Tab>   → your actually-installed plugins
```

## Why another completions repo?

Hand-written completions are a snapshot — they drift on every CLI release.
tab-please splits each completion into two layers and **regenerates the boring
one for you**:

```
┌─ parsed from `cmd --help` (CI-refreshed) ─┐   ┌─ written by a human (durable) ─┐
│ command tree · flags · (choices:…) enums  │ + │ value actions · dynamic helpers │ → dist/_cmd
│ tools/<cmd>/generated.json                │   │ tools/<cmd>/enrich.ts + helpers │
└───────────────────────────────────────────┘   └─────────────────────────────────┘
```

A new subcommand in `cmd` shows up automatically (with its flags) the next time
CI regenerates. Your enrichment is keyed by command path, so it survives the
refresh — it's never clobbered. The only manual step is *optionally* binding a
value action where it adds value.

## Install

**zsh plugin** (zap / zinit / antidote / oh-my-zsh):

```zsh
# zap
plug "kumamaki/tab-please"

# zinit
zinit light kumamaki/tab-please

# antidote  → add to your plugins file:
kumamaki/tab-please

# oh-my-zsh → clone into custom/plugins, then add `tab-please` to plugins=()
```

**Homebrew:**

```zsh
brew tap kumamaki/tap
brew install tab-please
```

**Bare** (no manager): clone, then in `~/.zshrc` before `compinit`:

```zsh
fpath=(/path/to/tab-please/dist $fpath)
```

After installing, `exec zsh`.

## Supported tools

Completions tab-please **ships** in `dist/` — installed by the plugin or brew:

| Tool | Format | Notes |
|------|--------|-------|
| `claude` | commander | generated + enriched (dynamic MCP/plugin completions) |
| `wrangler` | yargs | generated |
| `gh` | cobra | generated |

tab-please deliberately **doesn't** ship completions for tools that already have
good (often dynamic) ones — `docker`, `kubectl`, `cargo`, `rg` complete live
containers/pods/crates via their own completions, which a static `--help` dump
can't match. The plugin appends to `fpath`, so those keep winning; tab-please
only fills the gaps (tools with no decent completion).

## Supported help formats

The parser auto-detects the CLI's help format and routes to the right adapter
(`generator/parsers/*.ts`). Adding a format is one file — every tool using it
then works for free. Each ✓ is a committed snapshot of that CLI's real `--help`
under `tests/fixtures/<tool>/` that **CI re-parses on every PR**
(`bun run test:fixtures`), so a format we claim to support can't silently rot.

| Format | Detected from | CI fixture |
|--------|---------------|-----------|
| Commander.js | `Usage … [options]`, `(choices:…)` | `claude` ✓ |
| yargs | `[string]`/`[boolean]` type tags, `[aliases:…]` | `wrangler` ✓ |
| cobra (Go) | `Available Commands:` / `Global Flags:` (+ docker/gh header variants) | `kubectl`, `docker` ✓ |
| clap (Rust) | `[possible values:…]`, `<UPPERCASE>` args | `cargo`, `rg` ✓ |
| argparse (Python) | lowercase `usage:`, `{a,b,c}` subparser groups | `pipx` ✓ |
| click (Python) | `Usage … [OPTIONS] COMMAND`, UPPERCASE metavars | `flask` ✓ |
| unstructured | — | opt-in `--format generic` fallback |

## How it works

```
bun run regen claude   # parse `claude --help` → generated.json, then build
bun run build claude   # merge generated.json + enrich.ts + helpers.zsh → dist/_claude
bun run validate       # zsh -n + deterministic smoke test on every dist/_*
```

- **`generator/parse.ts`** — drives `cmd --help` recursively into a typed model.
  It owns IO + recursion and auto-detects the help format; per-format
  **adapters** in `generator/parsers/*.ts` turn each rendered `--help` page into
  structure. Output (`generated.json`) is never hand-edited. Override detection
  with `--format <name>`.
- **`generator/build.ts`** — merges the model with `tools/<cmd>/enrich.ts`,
  injects `helpers.zsh`, and emits a completion with the loader-safe guarded
  footer (works whether autoloaded via fpath or sourced by a `.zshrc` loop).
- **`.github/workflows/regen.yml`** — weekly + on-demand: installs the CLIs,
  re-parses, and opens a PR when `--help` changed.
- **`.github/workflows/ci.yml`** — every PR: rebuilds from snapshots, fails if
  `dist/` is stale, validates output. No CLIs required.

## fzf-tab help previews

If you use [fzf-tab](https://github.com/Aloxaf/fzf-tab), the plugin wires the
preview pane to render the highlighted subcommand's own `--help` as you scroll
the menu — turning that empty box into live docs:

```
claude mcp <Tab>
┌── menu ─────────────┬── preview ──────────────────────────────┐
│ add                 │ Usage: claude mcp add [options] <name>…  │
│ get               ◂─┤ Add an MCP server to Claude Code.        │
│ list                │   --transport  stdio | sse | http        │
└─────────────────────┴──────────────────────────────────────────┘
```

It's scoped to the tools tab-please ships (it never touches your other
previews), inert without fzf-tab, and disabled with
`export TAB_PLEASE_FZF_PREVIEW=0`. Not using the plugin loader? Source it
yourself: `source /path/to/tab-please/integrations/fzf-tab-preview.zsh`.

## Contributing

Adding a tool is mostly dropping a `tools/<tool>/enrich.ts`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

WTFPL — do what the fuck you want.
