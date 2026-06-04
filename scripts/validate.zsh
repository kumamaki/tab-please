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

(( rc == 0 )) && print "all completions valid" || print -u2 "validation FAILED"
exit $rc
