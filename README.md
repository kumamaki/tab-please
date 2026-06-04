<p align="center">
  <img src="./assets/logo.png" alt="tab-please logo" width="360">
</p>

# tab-please

Fresh zsh completions for CLIs — a curated set **and** on demand for anything.

- **Curated** — completions for `claude`, `gemini`, `wrangler`, `gh`: generated
  from each tool's `--help`, hand-enriched where it counts (live values, choice
  sets, file typing), and **regenerated automatically** when the CLI ships a new
  version. No more hand-written completions that rot the moment a subcommand lands.
- **On demand** — `tab-please add <anytool>` builds a completion for *any*
  installed CLI from its `--help`, right now. Lower fidelity (no enrichment), but
  instant and works on anything.

Same engine underneath; the curated set just adds a human-polish layer on top.

```
claude mcp remove <Tab>        → your actual configured MCP servers
claude --permission-mode <Tab> → acceptEdits  auto  bypassPermissions  default  …
gemini extensions <Tab>        → install  uninstall  list  update  link  …
tab-please add sea-orm-cli     → instant completion for a tool we don't ship
```

## Why it stays fresh

Hand-written completions are a snapshot — they drift on every CLI release.
tab-please splits each **curated** completion into two layers and **regenerates
the boring one for you**:

```
┌─ parsed from `cmd --help` (CI-refreshed) ─┐   ┌─ written by a human (durable) ─┐
│ command tree · flags · (choices:…) enums  │ + │ value actions · dynamic helpers │ → dist/_cmd
│ tools/<cmd>/generated.json                │   │ tools/<cmd>/enrich.ts + helpers │
└───────────────────────────────────────────┘   └─────────────────────────────────┘
```

A new subcommand shows up automatically (with its flags) the next time CI
regenerates; your enrichment is keyed by command path, so it survives the refresh
— it's never clobbered. (On-demand completions skip the human layer entirely:
`--help` structure only, no enrichment.)

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

> Homebrew installs the **curated completions only** (`dist/_*`). The on-demand
> commands — `tab-please add` / `scan` / `request` — and the fzf-tab preview live
> in the zsh plugin; install via a plugin manager (above) for those.

**Bare** (no manager): clone, then in `~/.zshrc` before `compinit`:

```zsh
fpath=(/path/to/tab-please/dist $fpath)
```

After installing, `exec zsh`.

## Usage

### Shipped completions

Once installed, the curated tools just complete — nothing else to do:

```zsh
claude <Tab>                 # mcp  plugin  install  update  …
claude mcp remove <Tab>      # your live, configured MCP servers
claude --permission-mode <Tab>   # acceptEdits  auto  bypassPermissions  default
gemini extensions <Tab>      # install  uninstall  list  update  link  …
wrangler kv <Tab>            # namespace  key  bulk  …
```

### `tab-please add <tool>` — any CLI, on demand

Generate a completion for any installed command straight from its `--help`
(needs [`bun`](https://bun.sh)):

```zsh
tab-please add sea-orm-cli                   # parse → load into THIS shell now
tab-please add httpie                        # works on anything with a --help
tab-please add some-getopt-tool --format generic   # force a parser if auto-detect misses
```

It's active immediately and persists across shells (the plugin keeps the output
dir on `fpath`). Files land in `$TAB_PLEASE_USER_DIR`
(default `~/.local/share/tab-please/completions`).

**Fidelity — what on-demand gives you vs. a curated tool:**

```
                       curated (enriched)        on-demand (raw --help)
subcommand tree        ✓                         ✓
flags + descriptions   ✓                         ✓
choices help prints    ✓                         ✓   (--permission-mode, etc.)
live/dynamic values    ✓  mcp remove → servers   ✗   help can't know your state
value sets help omits  ✓  --model → opus/…       ✗   completes nothing
```

For "I just installed X, complete it" on-demand is exactly right. For a tool you
use daily, add it to the curated set with a PR so it gets the enrichment layer.

### `tab-please scan` — find what's missing

Audit your installed tools and see which have no completion — and what to do
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
own** (enable the tool's native completion — better than a generated one), or
**low value** (flat/one-shot, skip). It looks only at your intentionally-
installed tools (`brew leaves`, `~/.cargo/bin`, `pipx`), not every binary on
`PATH`, and skips anything that already completes.

### `tab-please request <tool>` — ask for a tool to be curated

Want a tool in the *curated* set (enriched, shipped, kept fresh) rather than
generated locally? File a request — it vets the tool, attaches context (format,
version, parse stats), and opens a GitHub issue (via `gh` if you have it, else a
pre-filled URL — no token needed):

```zsh
tab-please request overmind     # → issue with format + version + subcommand/flag counts
tab-please request gemini       # ✗ refused: already curated
tab-please request kubectl      # ✗ refused: ships its own completion — enable that instead
```

It won't file noise: curated tools, self-generators, and flat one-shots are
turned away with a reason. `--force` overrides; `--dry-run` shows the issue
without filing.

### Configuration

| Env var | Default | Effect |
|---------|---------|--------|
| `TAB_PLEASE_USER_DIR` | `~/.local/share/tab-please/completions` | where `tab-please add` writes |
| `TAB_PLEASE_FZF_PREVIEW` | `1` | set `0` to disable the fzf-tab `--help` preview |
| `TAB_PLEASE_REPO` | `kumamaki/tab-please` | repo `tab-please request` files issues against |

tab-please **appends** to `fpath`, so any tool's own completion (gh's dynamic
one, docker's, …) always wins — it only fills gaps.

## Supported tools

Completions tab-please **ships** in `dist/` — installed by the plugin or brew:

| Tool | Format | Notes |
|------|--------|-------|
| `claude` | commander | generated + enriched (dynamic MCP/plugin completions) |
| `gemini` | yargs | generated (mcp · extensions · skills · hooks · gemma) |
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
