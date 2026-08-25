#!/usr/bin/env zsh
# Prove the plugin never calls `compinit` (Zap's second-init tax) and still
# registers completions on both sides of dump load.
#
#   zsh -f scripts/plugin-load.zsh
#
# Isolated HOME / fpath so the developer's dump and Homebrew site-functions
# can't pre-register `_claude`. Each case is a subshell so a stub `compinit`
# cannot leak. Exit non-zero on any failure (CI).

emulate -L zsh
set -u

# zsh -f still inherits exported FPATH; re-exec without rc files if needed,
# then keep only the directory that holds `compinit`.
if [[ -o rcs ]]; then
  exec zsh -f -- "$0" "$@"
fi

local here=${0:A:h}
local root=${here:h}
local plugin=$root/tab-please.plugin.zsh
local zsh_functions d
typeset -gi errors=0

if [[ ! -r $plugin ]]; then
  print -u2 "✗ cannot read $plugin"
  exit 1
fi

for d in $fpath; do
  if [[ -r $d/compinit ]]; then
    zsh_functions=$d
    break
  fi
done
if [[ -z ${zsh_functions-} ]]; then
  print -u2 "✗ cannot find compinit on fpath"
  exit 1
fi

ok() { print "✓ $1" }
bad() { print -u2 "✗ $1"; (( ++errors )) }

# Belt: `$+functions[compinit]` is true after a bare autoload (Zap's trap).
# A command-position `compinit` in this file is always a second init.
if grep -vE '^[[:space:]]*#' -- $plugin | grep -E '(^|[[:space:]])compinit([[:space:]]|$)' >/dev/null; then
  bad "plugin still invokes compinit"
else
  ok "plugin never invokes compinit"
fi

# --- 1. autoload only: dump not loaded this session (Zap's trap) ---
(
  emulate -L zsh
  set -u
  local tmp=$(mktemp -d)
  trap 'command rm -rf -- ${tmp:?}' EXIT
  export HOME=$tmp ZDOTDIR=$tmp TAB_PLEASE_FZF_PREVIEW=0
  unset _comp_dumpfile
  fpath=($zsh_functions)
  autoload -Uz compinit
  typeset -gi calls=0
  compinit() {
    (( ++calls ))
    print -u2 "[plugin-load] unexpected compinit (dump not loaded)"
  }
  source $plugin
  (( calls == 0 )) || exit 1
  unfunction compinit
  autoload -Uz compinit
  compinit -u -D
  [[ ${_comps[claude]-} == _claude ]]
) && ok "no compinit when dump not loaded; later dump picks up fpath" \
  || bad "pre-dump source either called compinit or failed to register after dump"

# --- 2. dump already loaded this session ---
(
  emulate -L zsh
  set -u
  local tmp=$(mktemp -d)
  trap 'command rm -rf -- ${tmp:?}' EXIT
  export HOME=$tmp ZDOTDIR=$tmp TAB_PLEASE_FZF_PREVIEW=0
  unset _comp_dumpfile
  fpath=($zsh_functions)
  autoload -Uz compinit
  compinit -u -D
  [[ -n ${_comp_dumpfile-} ]] || exit 1
  unfunction compinit
  typeset -gi extra=0
  compinit() {
    print -u2 "[plugin-load] unexpected compinit (dump already loaded)"
    extra=1
  }
  source $plugin
  (( extra == 0 )) || exit 1
  [[ ${_comps[claude]-} == _claude ]] || exit 1
  [[ ${_comps[tab-please]-} == _tab-please ]]
) && ok "dump already loaded: no extra init, binds via compdef" \
  || bad "dump-loaded source re-ran init or failed to bind"

# --- 3. clobber guard: a richer completion already in _comps wins ---
(
  emulate -L zsh
  set -u
  local tmp=$(mktemp -d)
  trap 'command rm -rf -- ${tmp:?}' EXIT
  export HOME=$tmp ZDOTDIR=$tmp TAB_PLEASE_FZF_PREVIEW=0
  unset _comp_dumpfile
  fpath=($zsh_functions)
  autoload -Uz compinit
  compinit -u -D
  _comps[claude]=_keep
  source $plugin
  [[ ${_comps[claude]-} == _keep ]]
) && ok "does not clobber an existing _comps entry" \
  || bad "clobbered an existing _comps entry"

# --- 4. recording stub before dump (Zap: plugins, then one dump-aware pass) ---
(
  emulate -L zsh
  set -u
  local tmp=$(mktemp -d)
  trap 'command rm -rf -- ${tmp:?}' EXIT
  export HOME=$tmp ZDOTDIR=$tmp TAB_PLEASE_FZF_PREVIEW=0
  unset _comp_dumpfile
  fpath=($zsh_functions)
  autoload -Uz compinit
  typeset -ga deferred
  typeset -gi extra=0
  compdef() { deferred+=( "$1 $2" ) }
  compinit() {
    print -u2 "[plugin-load] unexpected compinit (recording stub)"
    extra=1
  }
  source $plugin
  (( extra == 0 )) || exit 1
  (( ${deferred[(I)_claude claude]} ))
) && ok "recording stub before dump: no extra init, binds for replay" \
  || bad "recording stub path re-ran init or failed to bind"

(( errors == 0 )) && { print "PASS  plugin load"; exit 0 } || { print -u2 "FAIL  plugin load"; exit 1 }
