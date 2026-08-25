# tab-please — zsh completion plugin entrypoint.
# Works with zap, zinit, antidote, oh-my-zsh, or a bare `source` from .zshrc.
#
# APPENDS dist/ to fpath (never prepends), so a tool's own completion — gh's,
# docker's, anything dynamic you've set up — keeps winning. tab-please only
# fills the gaps: tools with no decent completion (claude, wrangler).

0=${(%):-%N}
typeset -g _TAB_PLEASE_DIR=${0:A:h}

# Curated completions ship in dist/; on-demand ones (`tab-please add`) land in a
# writable user dir. Both APPEND to fpath so a tool's own completion still wins.
# Keep fpath unique so re-sourcing or repeated `tab-please add` can't grow it
# with duplicate entries.
typeset -gU fpath
typeset -g _TAB_PLEASE_USER_DIR=${TAB_PLEASE_USER_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/tab-please/completions}
# completions/ holds the plugin's own hand-written completion (_tab-please) — it
# lives here, not dist/, because it completes the plugin-only `tab-please`
# function, which Homebrew-only users don't have.
fpath=($fpath "${_TAB_PLEASE_DIR}/dist" "${_TAB_PLEASE_DIR}/completions" "${_TAB_PLEASE_USER_DIR}")

# Mark each completion for autoload — but skip any name something else already
# provides (e.g. `source <(gh completion -s zsh)`), so we never replace a richer
# completion.
#
# Init order matters here:
#   · dump not loaded this session (`_comp_dumpfile` unset): just autoload.
#     A later `compinit` (omz, Zap's default-zshrc, bare setups) scans our
#     just-appended fpath dirs and registers the `#compdef` tags itself.
#   · dump already loaded this session (`_comp_dumpfile` set): skip extra
#     `compinit` — the dump is frozen and will not pick up our new dirs.
#     Bind each completion with `compdef`, but only when nothing already
#     completes that command, so a tool's own (richer) completion still wins.
#     A recording `compdef` stub (replay after dump) is the same bind path.
#
# Never call `compinit` from this file. `$+functions[compinit]` is true after
# a bare `autoload -Uz compinit`, which is how Zap users paid a second full
# init every session. "Dump already loaded" is `_comp_dumpfile`; "safe to
# bind" is `compdef` existing (after `compinit`, or as a recording stub).
#
# Relies on the repo invariant (AGENTS.md): filename `_cmd` ↔ command `cmd` ↔
# `#compdef cmd`, so `${f#_}` is the command name.
() {
  local f cmd
  for f in "${_TAB_PLEASE_DIR}/dist"/_*(N:t) "${_TAB_PLEASE_DIR}/completions"/_*(N:t) "${_TAB_PLEASE_USER_DIR}"/_*(N:t); do
    (( $+functions[$f] )) && continue
    autoload -Uz -- "$f"
    cmd=${f#_}
    # `${+_comps}` first: before dump, `_comps` is unset and `[$cmd]` would
    # be a scalar slice (and trip `set -u`). After dump, skip a command
    # something else already completes (`:-` because a missing key is
    # nounset-fatal under `set -u`).
    if (( $+functions[compdef] )); then
      if (( ! ${+_comps} )) || [[ -z ${_comps[$cmd]:-} ]]; then
        compdef "$f" "$cmd"
      fi
    fi
  done
}

# `tab-please` — manage on-demand completions. On-demand ones are lower fidelity
# than the curated tools (structure + flags + printed choices, but no enrichment:
# no live/dynamic values, no value sets --help omits). Needs bun.
#   add <tool> [--format <name>]   generate a completion for an installed CLI and
#                                  load it into this shell now
#   scan [--add]                   list installed tools with no completion and say
#                                  what to do (add · enable native · skip); --add
#                                  generates the worth-adding ones
tab-please() {
  emulate -L zsh
  setopt local_options null_glob
  # Color only when the relevant stream is a TTY and NO_COLOR is unset.
  local g y r d b c nc
  if [[ -z $NO_COLOR ]]; then
    [[ -t 1 || -t 2 ]] && { g=$'\e[32m' y=$'\e[33m' r=$'\e[31m' d=$'\e[2m' b=$'\e[1m' c=$'\e[36m' nc=$'\e[0m' }
  fi
  local sub=$1; (( $# )) && shift
  case $sub in
    add)
      local tool=$1; (( $# )) && shift
      [[ -n $tool ]] || { print -u2 "${y}⚠${nc} usage: tab-please add <tool> [--format <name>]"; return 1 }
      (( $+commands[$tool] )) || { print -u2 "${r}✗${nc} '${tool}' is not an installed command"; return 1 }
      (( $+commands[bun] ))   || { print -u2 "${r}✗${nc} needs ${b}bun${nc} on PATH"; return 1 }
      command mkdir -p -- "$_TAB_PLEASE_USER_DIR" || return 1
      local model="$_TAB_PLEASE_USER_DIR/.${tool}.json"
      local out="$_TAB_PLEASE_USER_DIR/_${tool}"
      # parse streams a live spinner to stderr (slow recursive --help);
      # build --quiet prints a machine line: commands|functions|format|version
      # which we fold into one success banner on stdout.
      zmodload -F zsh/datetime p:EPOCHREALTIME 2>/dev/null
      local start=${EPOCHREALTIME:-$SECONDS} meta ncmd nfn format version elapsed
      if bun "$_TAB_PLEASE_DIR/generator/parse.ts" "$tool" "$@" --out "$model" --quiet &&
         meta=$(bun "$_TAB_PLEASE_DIR/generator/build.ts" "$tool" --from "$model" --out "$out" --quiet); then
        fpath=($fpath "$_TAB_PLEASE_USER_DIR")
        unfunction "_${tool}" 2>/dev/null
        autoload -Uz "_${tool}"
        (( $+functions[compdef] )) && compdef "_${tool}" "$tool"
        local -a parts
        parts=("${(@s:|:)meta}")
        ncmd=${parts[1]:-?}
        nfn=${parts[2]:-?}
        format=${parts[3]:-?}
        version=${parts[4]:-?}
        # Prefer sub-second precision when zsh/datetime is available.
        local end=${EPOCHREALTIME:-$SECONDS}
        local dt=$(( end - start ))
        if (( dt < 1 )); then
          elapsed="$(printf '%dms' $(( dt * 1000 )))"
        else
          elapsed=$(printf '%.1fs' $dt)
        fi
        # Prefer TTY-aware colors on stdout for the banner.
        local og od onc
        if [[ -t 1 && -z $NO_COLOR ]]; then og=$'\e[32m' od=$'\e[2m' onc=$'\e[0m'; fi
        print -r -- "${og}✓${onc} ${tool} ready ${od}· ${ncmd} commands · ${format} · ${elapsed}${onc}"
        print -r -- "  ${od}${out}${onc}"
      else
        print -u2 "${r}✗${nc} failed to generate a completion for '${tool}'"
        return 1
      fi
      ;;
    scan)
      (( $+commands[bun] )) || { print -u2 "${r}✗${nc} needs ${b}bun${nc} on PATH"; return 1 }
      # formula/alias name → real command, for the few that differ
      local -A rename=(
        ripgrep rg  cloudflare-wrangler wrangler  git-delta delta  tlrc tldr
        netlify-cli netlify  gemini-cli gemini  protobuf protoc  ghostscript gs
        smartmontools smartctl
      )
      # Intentionally-installed tools only (not every binary in PATH — that's noise).
      local -a names=(
        ${(f)"$(brew leaves 2>/dev/null)"}
        ~/.cargo/bin/*(N.:t)
        ${(f)"$(pipx list --short 2>/dev/null | awk '{print $1}')"}
      )
      local -a cand; local t cmd
      for t in ${(u)names}; do
        # drop cargo subcommand plugins and rust toolchain internals (not CLIs you complete)
        [[ $t == (cargo-*|clippy-driver|rls|rust-analyzer|rust-gdb|rust-gdbgui|rust-lldb|rustc|rustdoc|rustfmt) ]] && continue
        cmd=${rename[$t]:-$t}
        (( $+commands[$cmd] )) || continue                                   # formula with no direct command
        [[ -z ${_comps[$cmd]} || ${_comps[$cmd]} == (_default|_gnu_generic) ]] || continue   # already completes
        cand+=$cmd
      done
      if (( ! $#cand )); then
        local og onc
        if [[ -t 1 && -z $NO_COLOR ]]; then og=$'\e[32m' onc=$'\e[0m'; fi
        print "${og}✓${onc} every installed tool already completes"
        return 0
      fi
      # Bun owns the live spinner + colored report on stderr. Keep this line
      # short so it doesn't compete with the progress UI that follows.
      print -u2 "${d}found ${#cand} tools with no completion${nc}"
      local add
      add=$(bun "$_TAB_PLEASE_DIR/generator/scan.ts" ${(u)cand})
      if [[ $1 == --add && -n $add ]]; then
        local -a tools=(${(f)add})
        local i=0 n=${#tools} toolname plural
        plural=tools; (( n == 1 )) && plural=tool
        print -u2 "${d}adding ${n} ${plural}…${nc}"
        for toolname in $tools; do
          (( i++ ))
          print -u2 "${c}adding ${i}/${n}${nc} ${d}·${nc} ${b}${toolname}${nc}"
          tab-please add "$toolname" || print -u2 "${y}⚠${nc} skipped '${toolname}' after failure"
        done
      fi
      ;;
    request)
      (( $+commands[bun] )) || { print -u2 "${r}✗${nc} needs ${b}bun${nc} on PATH"; return 1 }
      bun "$_TAB_PLEASE_DIR/generator/request.ts" "$@"
      ;;
    *)
      print -u2 "usage: ${b}tab-please${nc} <command>
  ${c}add${nc} <tool> [--format <name>]   generate a completion for an installed CLI
  ${c}scan${nc} [--add]                   find installed tools with no completion
  ${c}request${nc} <tool> [--force]       ask for a tool to be curated (files a GitHub issue)"
      return 1
      ;;
  esac
}

# Optional fzf-tab integration: show a subcommand's --help in the preview pane.
# Inert if you don't use fzf-tab; scoped to our tools so it won't touch your
# other previews. Disable with `export TAB_PLEASE_FZF_PREVIEW=0`.
if [[ ${TAB_PLEASE_FZF_PREVIEW:-1} != 0 && -r "${_TAB_PLEASE_DIR}/integrations/fzf-tab-preview.zsh" ]]; then
  source "${_TAB_PLEASE_DIR}/integrations/fzf-tab-preview.zsh"
fi
