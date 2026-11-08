#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$repo_root/integrations/agentos-data"
reference="$(< "$workdir/supabase/.temp/project-ref")"
if [[ "$reference" != "rxcykzhtkspsonntirhi" ]]; then
  printf '%s\n' 'Stopped: this checkout is not linked to the expected AgentOS project.' >&2
  exit 1
fi

if (( $# > 1 )); then
  printf '%s\n' 'Usage: agentos-supabase-preflight.sh [private-report-path]' >&2
  exit 2
fi
report="${1:-/private/tmp/agentos-supabase-preflight-20261108.json}"
if [[ -e "$report" || -L "$report" ]]; then
  printf '%s\n' 'The report already exists. Return to Codex so it can be inspected.'
  exit 0
fi
temporary="$(mktemp /private/tmp/agentos-supabase-preflight.XXXXXXXX)"
diagnostic=""
trap 'rm -f -- "$temporary"; [[ -z "$diagnostic" ]] || rm -f -- "$diagnostic"' EXIT
diagnostic="$(mktemp /private/tmp/agentos-supabase-preflight-error.XXXXXXXX)"

printf '%s\n' 'Checking AgentOS database metadata. This does not migrate application data.'
if supabase db query --linked --workdir "$workdir" \
  --file "$workdir/migration-preflight.sql" --output json > "$temporary" 2> "$diagnostic"; then
  :
else
  cli_status=$?
  # Driver diagnostics can contain credentials. Emit only recognized failure
  # categories; never publish partial stdout or the original diagnostic.
  python3 - "$diagnostic" "$cli_status" <<'PY' >&2
import sys
with open(sys.argv[1], encoding="utf-8", errors="replace") as source:
    error = source.read(65_536)
if "unexpected login role status 544" in error and "connection timeout" in error.lower():
    print("Supabase timed out opening its temporary database login (544). The metadata query did not run.")
    print("This does not establish a wrong password. Check the AgentOS project status in the Supabase dashboard and tell Codex what it shows.")
elif "Access token not provided" in error:
    print("Supabase cannot see a CLI login in this terminal. Use the terminal where your AgentOS project listing worked.")
else:
    print(f"Supabase could not complete the metadata check (exit {sys.argv[2]}). Return this message to Codex.")
print("No report was saved. Do not paste passwords or access tokens into chat.")
PY
  exit "$cli_status"
fi
python3 - "$temporary" <<'PY'
import json, os, sys
try:
    if os.path.getsize(sys.argv[1]) > 16 * 1024 * 1024:
        raise ValueError()
    with open(sys.argv[1], encoding="utf-8") as source:
        result = json.load(source)
    # Preserve the CLI's untrusted-data envelope when agent detection is on.
    rows = result.get("rows") if isinstance(result, dict) else result
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError()
    report = rows[0].get("preflight")
    if not isinstance(report, dict) or report.get("schema") != "agentos.supabase-migration-preflight.v1":
        raise ValueError()
    if report.get("requested_project_ref") != "rxcykzhtkspsonntirhi":
        raise ValueError()
    if not isinstance(report.get("database"), dict) or not report["database"].get("server_version_num"):
        raise ValueError()
    if any(not isinstance(report.get(key), list) for key in ("extensions", "schemas", "relations")):
        raise ValueError()
except (ValueError, TypeError, OSError):
    raise SystemExit("The CLI returned no valid AgentOS metadata report; no report was saved.") from None
PY
# Publish a complete private report without replacing an existing result.
ln -- "$temporary" "$report"
printf '%s\n' 'Finished. The private report is saved; return to Codex and say done.'
