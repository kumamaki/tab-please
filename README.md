<p align="center">
  <img src="./assets/logo.png" alt="tab-please logo" width="360">
</p>

# tab-please

Fresh zsh completions for CLIs: a curated set, and on demand for anything else.

- **Curated:** completions for `claude`, `gemini`, `wrangler`, `gh`, generated
  from each tool's `--help`, hand-enriched where it counts (live values, choice
  sets, file typing), and **regenerated for you** when the CLI ships a new
  version. No more hand-written completions that rot the moment a subcommand lands.
- **On demand:** `tab-please add <anytool>` builds a completion for *any*
  installed CLI from its `--help`, right now. Lower fidelity (no enrichment), but
  instant, and it works on anything.

Same engine underneath; the curated set adds a human-polish layer on top.

```
claude mcp remove <Tab>        → your actual configured MCP servers
claude --permission-mode <Tab> → acceptEdits  auto  bypassPermissions  default  …
gemini extensions <Tab>        → install  uninstall  list  update  link  …
tab-please add sea-orm-cli     → instant completion for a tool we don't ship
```

## Why it stays fresh

Hand-written completions are a snapshot. They drift on every CLI release.
tab-please splits each **curated** completion into two layers and **regenerates
the boring one for you**:

```
┌─ parsed from `cmd --help` (CI-refreshed) ─┐   ┌─ written by a human (durable) ─┐
│ command tree · flags · (choices:…) enums  │ + │ value actions · dynamic helpers │ → dist/_cmd
│ tools/<cmd>/generated.json                │   │ tools/<cmd>/enrich.ts + helpers │
└───────────────────────────────────────────┘   └─────────────────────────────────┘
```

A new subcommand shows up on its own (with its flags) the next time CI
regenerates; your enrichment is keyed by command path, so it survives the refresh
and the merge never clobbers it. (On-demand completions skip the human layer:
`--help` structure only, no enrichment.)

## Install

Two ways in, and they're **not** equivalent. Pick by how much you want:

| | curated completions | `tab-please add/scan/request` | fzf-tab `--help` preview |
|---|:---:|:---:|:---:|
| **zsh plugin** | ✓ | ✓ | ✓ |
| **Homebrew** | ✓ | ✗ | ✗ |

If all you want is the shipped tools (`claude`, `gemini`, `wrangler`,
`gh`) to complete, **Homebrew alone is enough; skip the plugin.** For the
on-demand commands or the preview, use the plugin.

### zsh plugin (recommended)

```zsh
# zap
plug "kumamaki/tab-please"

# zinit
zinit light kumamaki/tab-please

# antidote → add to your plugins file:
kumamaki/tab-please
```

**oh-my-zsh:** clone into oh-my-zsh's custom plugins dir:

```zsh
git clone https://github.com/kumamaki/tab-please \
  "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/tab-please"
```

then add it to the plugin list in `~/.zshrc` (space-separated, **no commas**):

```zsh
plugins=(git … tab-please)
```

### Homebrew

```zsh
brew tap kumamaki/tap
brew install tab-please
```

Brew installs the curated completions (`dist/_*`) into its zsh `site-functions`
dir. In a standard Homebrew setup that dir is already on your `fpath`, so
`compinit` autoloads them. No plugin, no extra config. That's the same reason
brew **can't** give you the `tab-please` command or the fzf-tab preview: those are
shell code the plugin sources at startup, and a completions-only install never
runs them.

### Bare (no manager)

Clone, then in `~/.zshrc` **before** `compinit`:

```zsh
fpath=(/path/to/tab-please/dist $fpath)
```

After any of these, reload your shell with `exec zsh`.

## Usage

### Shipped completions

Once installed, the curated tools complete on their own. Nothing else to do:

```zsh
claude <Tab>                 # mcp  plugin  install  update  …
claude mcp remove <Tab>      # your live, configured MCP servers
claude --permission-mode <Tab>   # acceptEdits  auto  bypassPermissions  default
gemini extensions <Tab>      # install  uninstall  list  update  link  …
wrangler kv <Tab>            # namespace  key  bulk  …
```

### `tab-please add <tool>`: any CLI, on demand

Generate a completion for any installed command straight from its `--help`
(needs [`bun`](https://bun.sh)):

```zsh
tab-please add sea-orm-cli                   # parse → load into THIS shell now
tab-please add httpie                        # works on anything with a --help
tab-please add some-getopt-tool --format generic   # force a parser if auto-detect misses
```

It loads into the current shell and persists across new ones (the plugin keeps
the output dir on `fpath`). Files land in `$TAB_PLEASE_USER_DIR`
(default `~/.local/share/tab-please/completions`).

**Fidelity, on-demand vs. a curated tool:**

```
                       curated (enriched)        on-demand (raw --help)
subcommand tree        ✓                         ✓
flags + descriptions   ✓                         ✓
choices help prints    ✓                         ✓   (--permission-mode, etc.)
live/dynamic values    ✓  mcp remove → servers   ✗   help can't know your state
value sets help omits  ✓  --model → opus/…       ✗   completes nothing
```

For "I just installed X, complete it," on-demand fits. For a tool you
use daily, add it to the curated set with a PR so it gets the enrichment layer.

### `tab-please scan`: find what's missing

Audit your installed tools, see which have no completion, and what to do
about each:

```zsh
tab-please scan          # report only
tab-please scan --add    # also generate the "worth adding" ones
```
```
✗ no completion — worth adding:
    gemini             yargs: 5 subcommands, 27 flags
    sea-orm-cli        commander: 2 subcommands, 2 flags
    → tab-please add gemini sea-orm-cli …
◆ no completion — but the tool ships its own (enable it, don't generate):
    rustup             rustup completions zsh
· no completion — low value (flat / one-shot), skipped:
    btop  duf  exiftool  …
```

It buckets each gap into **worth adding** (run `tab-please add`), **ships its
own** (enable the tool's native completion, better than a generated one), or
**low value** (flat/one-shot, skip). It looks only at your intentionally-
installed tools (`brew leaves`, `~/.cargo/bin`, `pipx`), not every binary on
`PATH`, and skips anything that already completes.

### `tab-please request <tool>`: ask for a tool to be curated

To get a tool into the *curated* set (enriched, shipped, kept fresh) rather than
generating it locally, file a request. It vets the tool, attaches context
(format, version, parse stats), and opens a GitHub issue (via `gh` if you have
it, else a pre-filled URL, no token needed):

```zsh
tab-please request overmind     # → issue with format + version + subcommand/flag counts
tab-please request gemini       # ✗ refused: already curated
tab-please request kubectl      # ✗ refused: ships its own completion — enable that instead
```

It refuses to file noise: it turns away curated tools, self-generators, and flat
one-shots, each with a reason. `--force` overrides; `--dry-run` shows the issue
without filing.

### Configuration

| Env var | Default | Effect |
|---------|---------|--------|
| `TAB_PLEASE_USER_DIR` | `~/.local/share/tab-please/completions` | where `tab-please add` writes |
| `TAB_PLEASE_FZF_PREVIEW` | `1` | set `0` to disable the fzf-tab `--help` preview |
| `TAB_PLEASE_REPO` | `kumamaki/tab-please` | repo `tab-please request` files issues against |

tab-please **appends** to `fpath`, so any tool's own completion (gh's dynamic
one, docker's, …) always wins; tab-please only fills gaps.

## Supported tools

Completions tab-please **ships** in `dist/`, installed by the plugin or brew:

| Tool | Format | Notes |
|------|--------|-------|
| `claude` | commander | generated + enriched (dynamic MCP/plugin completions) |
| `gemini` | yargs | generated (mcp · extensions · skills · hooks · gemma) |
| `wrangler` | yargs | generated |
| `gh` | cobra | generated |

tab-please **doesn't** ship completions for tools that already have
good (often dynamic) ones. `docker`, `kubectl`, `cargo`, `rg` complete live
containers/pods/crates via their own completions, which a static `--help` dump
can't match. The plugin appends to `fpath`, so those keep winning; tab-please
only fills the gaps (tools with no decent completion).

## Supported help formats

The parser auto-detects the CLI's help format and routes to the right adapter
(`generator/parsers/*.ts`). Adding a format is one file. Every tool using it
then works for free. Each ✓ is a committed snapshot of that CLI's real `--help`
under `tests/fixtures/<tool>/` that **CI re-parses on every PR**
(`bun run test:fixtures`), so a format we claim to support can't rot without CI
catching it.

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

- **`generator/parse.ts`** walks `cmd --help` and its subcommands into a typed
  model. It owns IO and recursion and auto-detects the help format; per-format
  **adapters** in `generator/parsers/*.ts` turn each rendered `--help` page into
  structure. Never hand-edit the output (`generated.json`). Override detection
  with `--format <name>`.
- **`generator/build.ts`** merges the model with `tools/<cmd>/enrich.ts`,
  injects `helpers.zsh`, and emits a completion with the loader-safe guarded
  footer (works whether autoloaded via fpath or sourced by a `.zshrc` loop).
- **`.github/workflows/regen.yml`** runs weekly and on demand: installs the
  CLIs, re-parses, and opens a PR when `--help` changed.
- **`.github/workflows/ci.yml`** runs on every PR: rebuilds from snapshots, fails
  if `dist/` is stale, validates output. No CLIs required.

## fzf-tab help previews

If you use [fzf-tab](https://github.com/Aloxaf/fzf-tab), the plugin wires the
preview pane to render the highlighted subcommand's own `--help` as you scroll
the menu, turning that empty box into live docs:

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
`export TAB_PLEASE_FZF_PREVIEW=0`. Without the plugin loader, source it
yourself: `source /path/to/tab-please/integrations/fzf-tab-preview.zsh`.

## Contributing

Adding a tool is mostly dropping a `tools/<tool>/enrich.ts`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

WTFPL. Do what the fuck you want.
