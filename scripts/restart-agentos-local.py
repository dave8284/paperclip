#!/usr/bin/env python3
"""Gracefully recover this checkout's com.agentos.backend launchd service.

Uses native hot-restart preparation. Never force-kills, manufactures an intent,
signals the supervisor, or continues after failed process/database preflight.
Run with --check for read-only lifecycle validation.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request


def command(args, *, env=None, cwd=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, cwd=cwd)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed during preflight (exit {result.returncode}); no server signal sent.")
    return result.stdout.strip()


def listener():
    ids = set(command(["/usr/sbin/lsof", "-nP", "-t", "-iTCP:3100", "-sTCP:LISTEN"]).splitlines())
    if len(ids) != 1 or not next(iter(ids)).isdigit():
        raise RuntimeError("Expected exactly one HTTP listener on port 3100; no server signal sent.")
    return int(next(iter(ids)))


def process_start(pid):
    value = command(["/bin/ps", "-p", str(pid), "-o", "lstart="])
    if not value:
        raise RuntimeError("Cannot establish the server's OS start identity; no server signal sent.")
    return value


def service(repo):
    status = command(["/bin/launchctl", "print", f"gui/{os.getuid()}/com.agentos.backend"])
    working = re.search(r"^\s*working directory = (.+)$", status, re.M)
    pid = re.search(r"^\s*pid = (\d+)$", status, re.M)
    arguments = re.search(r"^\s*arguments = \{\s*\n(.*?)\n\s*\}", status, re.M | re.S)
    args = [line.strip() for line in arguments.group(1).splitlines()] if arguments else []
    if not working or Path(working.group(1)).resolve() != repo or not pid:
        raise RuntimeError("The running launchd job does not match this checkout; no server signal sent.")
    if len(args) != 4 or Path(args[0]).name != "pnpm" or args[1:] != ["dev:once", "--data-dir", "../.runtime"]:
        raise RuntimeError("The launchd startup command is not the expected local development service; no server signal sent.")
    if not re.search(r"^\s*properties = .*keepalive", status, re.M | re.I):
        raise RuntimeError("The launchd job is not configured to restart automatically; no server signal sent.")
    return int(pid.group(1))


def validate_ancestry(server_pid, supervisor_pid):
    current = server_pid
    for _ in range(12):
        parent = command(["/bin/ps", "-p", str(current), "-o", "ppid="])
        if not parent.isdigit() or int(parent) <= 1:
            break
        current = int(parent)
        if current == supervisor_pid:
            return
    raise RuntimeError("The HTTP listener is not a descendant of the verified launchd job; no server signal sent.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate lifecycle without preparing or restarting")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise RuntimeError("This helper is for the local macOS launchd deployment.")
    repo = Path(__file__).resolve().parents[1]
    runtime = repo.parent / ".runtime"
    supervisor_pid = service(repo)
    old_pid = listener()
    old_start = process_start(old_pid)
    validate_ancestry(old_pid, supervisor_pid)
    if args.check:
        print("Verified local service, listener and process ancestry. No changes made.")
        return
    node = repo.parent / ".toolchain/node_modules/.bin/node"
    if not node.is_file():
        raise RuntimeError("The checkout's Node toolchain is missing; no server signal sent.")
    # This handoff belongs to the verified launchd instance, not the caller's
    # agent session or shell DB overrides. Native config loads its own .env.
    allowed_env = {"HOME", "USER", "LOGNAME", "TMPDIR", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SHELL"}
    env = {key: value for key, value in os.environ.items() if key in allowed_env}
    env.update({"PAPERCLIP_HOME": str(runtime), "PAPERCLIP_INSTANCE_ID": "default",
                "PAPERCLIP_CONFIG": str(runtime / "instances/default/config.json")})
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    prepared = json.loads(command([str(node), "--import", str(repo / "cli/node_modules/tsx/dist/loader.mjs"),
                                  str(repo / "scripts/request-hot-restart.ts"), "--server-pid", str(old_pid)], env=env, cwd=repo))
    if not isinstance(prepared, dict) or prepared.get("status") != "hot_restart_intent_written" or prepared.get("previousServerPid") != old_pid or prepared.get("drainRequired") or not isinstance(prepared.get("requestedAt"), str) or not prepared["requestedAt"]:
        raise RuntimeError("Native preparation did not approve a recoverable restart; no server signal sent.")
    if service(repo) != supervisor_pid or listener() != old_pid or process_start(old_pid) != old_start:
        raise RuntimeError("The running service changed during preparation; no server signal sent. Re-run to inspect it afresh.")
    validate_ancestry(old_pid, supervisor_pid)
    print("Native preflight passed. Requesting graceful shutdown of the verified HTTP server…", flush=True)
    os.kill(old_pid, signal.SIGTERM)
    deadline = time.monotonic() + 90
    report_path = runtime / "instances/default/hot-restart-report.json"
    while time.monotonic() < deadline:
        try:
            new_pid = listener()
            if new_pid != old_pid:
                with urllib.request.urlopen("http://127.0.0.1:3100/api/health", timeout=2) as response:
                    health = json.load(response)
                report = json.loads(report_path.read_text())
                if (isinstance(health, dict) and isinstance(report, dict)
                        and health.get("status") == "ok" and report.get("previousServerPid") == old_pid
                        and report.get("newServerPid") == new_pid and report.get("requestedAt") == prepared["requestedAt"]
                        and isinstance(report.get("lostRunIds"), list)):
                    if report.get("lostRunIds"):
                        raise RuntimeError("Server is healthy, but native recovery reports lost runs. Review the restart report before resuming work.")
                    print("Server is healthy on http://localhost:3100. Native recovery reports no lost runs.")
                    return
        except RuntimeError as error:
            if "lost runs" in str(error):
                raise
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError("Graceful shutdown was requested, but readiness and the matching recovery report were not confirmed within 90 seconds. Inspect the launchd service; no force-kill was attempted.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(f"Restart stopped: {error}", file=sys.stderr)
        sys.exit(1)
