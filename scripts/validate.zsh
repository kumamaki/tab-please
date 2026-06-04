#!/usr/bin/env zsh
# Validate every shipped completion in dist/. CI entrypoint.
emulate -L zsh
set -u

local here=${0:A:h}
local rc=0 f cmd
for f in "${here}/.."/dist/_*(N); do
  cmd=${${f:t}#_}
  print "── $cmd ──"
  zsh "${here}/smoke-test.zsh" "$f" "$cmd" || rc=1
  print
done

# Static spec lint — catches malformed option specs the stubbed smoke test can't
# (e.g. an option name with embedded whitespace). Needs bun, which CI always has.
if (( $+commands[bun] )); then
  print "── spec lint ──"
  bun "${here}/lint-dist.ts" || rc=1
  print
else
  print -u2 "⚠ bun not found — skipping dist spec lint"
fi

(( rc == 0 )) && print "all completions valid" || print -u2 "validation FAILED"
exit $rc
