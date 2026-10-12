#!/bin/sh
# Morning digest for launchd or cron: runs `overnight-receipts digest` over the repos you list and, when any
# branch needs triage, sends the file to WhatsApp through OpenClaw. Quiet mornings send nothing.
#
#   OVERNIGHT_RECEIPTS_REPOS        space-separated repo paths; globs are expanded and non-repos skipped (required)
#   OVERNIGHT_RECEIPTS_SINCE        window (default 14h: an evening-to-morning night)
#   OVERNIGHT_RECEIPTS_OUT          digest file (default ~/.overnight-receipts/digest.txt)
#   OVERNIGHT_RECEIPTS_WHATSAPP_TO  E.164 number to send to via `openclaw message send`; unset = write the file only
#   OVERNIGHT_RECEIPTS_EMIT         optional event logger: <emit> overnight-receipts digest <event> <status> "<message>"
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
since=${OVERNIGHT_RECEIPTS_SINCE:-14h}
out=${OVERNIGHT_RECEIPTS_OUT:-$HOME/.overnight-receipts/digest.txt}

emit() { [ -n "${OVERNIGHT_RECEIPTS_EMIT:-}" ] && [ -x "$OVERNIGHT_RECEIPTS_EMIT" ] && "$OVERNIGHT_RECEIPTS_EMIT" overnight-receipts digest "$1" "$2" "$3"; return 0; }

set --
for pattern in ${OVERNIGHT_RECEIPTS_REPOS:?set OVERNIGHT_RECEIPTS_REPOS to the repos to scan}; do
  for dir in $pattern; do
    git -C "$dir" rev-parse --show-toplevel >/dev/null 2>&1 && set -- "$@" --repo "$dir"
  done
done
if [ $# -eq 0 ]; then
  emit run fail "no git repos matched OVERNIGHT_RECEIPTS_REPOS"
  echo "morning-digest: no git repos matched OVERNIGHT_RECEIPTS_REPOS" >&2
  exit 1
fi

summary=$(node "$here/bin/overnight-receipts.js" digest --since "$since" --out "$out" "$@")
code=$?
[ -f "$out" ] || { emit run fail "digest not written (exit $code)"; exit 1; }
branches=$(printf '%s\n' "$summary" | sed -n 's/^wrote .* (\([0-9]*\) branch.*/\1/p')
[ "$code" -ne 0 ] && emit run fail "a repo failed; see $out"

if [ "${branches:-0}" -eq 0 ] && [ "$code" -eq 0 ]; then
  emit run ok "nothing to triage since $since"
  exit 0
fi
if [ -z "${OVERNIGHT_RECEIPTS_WHATSAPP_TO:-}" ]; then
  emit run ok "${branches:-0} branches; written to $out (no OVERNIGHT_RECEIPTS_WHATSAPP_TO, not sent)"
  exit "$code"
fi
if openclaw message send --channel whatsapp --target "$OVERNIGHT_RECEIPTS_WHATSAPP_TO" --message "$(cat "$out")" >/dev/null 2>&1; then
  emit send ok "${branches:-0} branches sent to WhatsApp"
else
  emit send fail "openclaw message send failed; digest is in $out"
  exit 1
fi
exit "$code"
