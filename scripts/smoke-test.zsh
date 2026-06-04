#!/usr/bin/env zsh
# Deterministic smoke test for a generated completion — no pty, no flakiness.
# Stubs the completion builtins, sources the file, and asserts it loads cleanly,
# defines its widget function, and that its dynamic helpers run without error.
#
#   zsh scripts/smoke-test.zsh dist/_claude claude
#
# Exit non-zero on any failure (suitable for CI).

emulate -L zsh
set -u

local file=$1 cmd=$2
local fail=0

if [[ ! -r $file ]]; then print -u2 "✗ cannot read $file"; exit 1; fi

# 1) syntax
if zsh -n $file; then print "✓ zsh -n  $file"; else print -u2 "✗ syntax error in $file"; exit 1; fi

# 2) load with stubbed completion system, in THIS shell (not a subshell)
autoload -Uz compinit && compinit -u 2>/dev/null
functions[_describe]='local n=${@[-1]}; : ${(P)n}'   # touch the array; no output
functions[_arguments]=':'                              # neutralize the guarded self-call
functions[_values]=':'; functions[_files]=':'; functions[_directories]=':'
functions[_command_names]=':'; functions[_normal]=':'

local errfile=$(mktemp)
source $file >$errfile 2>&1
if [[ -s $errfile ]]; then
  print -u2 "✗ output/errors at source time:"; cat $errfile >&2; fail=1
else
  print "✓ sources silently"
fi
rm -f $errfile

# 3) the widget function is defined
if (( $+functions[_$cmd] )); then print "✓ _$cmd defined"; else print -u2 "✗ _$cmd not defined"; fail=1; fi

# 4) every helper/dispatch function the file declares actually parsed
local -a defined=( ${(k)functions[(I)_${cmd}*]} )
print "✓ ${#defined} _$cmd* functions defined"

# 5) dynamic helpers (if present) run without crashing under the stubs
local h
for h in _${cmd}_models _${cmd}_setting_sources; do
  if (( $+functions[$h] )); then
    if $h >/dev/null 2>&1; then print "✓ $h runs"; else print -u2 "✗ $h errored"; fail=1; fi
  fi
done

(( fail == 0 )) && { print "PASS  $file"; exit 0 } || { print -u2 "FAIL  $file"; exit 1 }
