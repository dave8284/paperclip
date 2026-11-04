"""Controlled restart handoff tests; no real process, service or HTTP calls."""
import contextlib
import importlib.util
import io
import itertools
import json
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "restart_agentos_local", Path(__file__).with_name("restart-agentos-local.py")
)
restart = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restart)


class RestartHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve() / "paperclip"
        (self.repo / "scripts").mkdir(parents=True)
        node = self.repo.parent / ".toolchain/node_modules/.bin/node"
        node.parent.mkdir(parents=True)
        node.touch()
        self.report_path = self.repo.parent / ".runtime/instances/default/hot-restart-report.json"
        self.report_path.parent.mkdir(parents=True)
        self.old_pid, self.new_pid, self.supervisor_pid = 101, 202, 50
        self.old_start = "Tue Nov  3 12:00:00 2026"
        self.requested_at = "2026-11-04T00:00:00.000Z"
        self.prepared = {
            "status": "hot_restart_intent_written",
            "previousServerPid": self.old_pid,
            "previousServerStartedAt": "2026-11-03T12:00:00.000Z",
            "requestedAt": self.requested_at,
            "drainRequired": False,
            "preflightActiveRunIds": [],
        }
        self.service_output = (
            f"working directory = {self.repo}\n"
            f"pid = {self.supervisor_pid}\n"
            "arguments = {\n /toolchain/pnpm\n dev:once\n --data-dir\n ../.runtime\n}\n"
            "properties = keepalive | runatload\n"
        )
        self.listener_values = iter([self.old_pid, self.old_pid])
        self.start_values = iter([self.old_start, self.old_start])
        self.fail_command = None
        self.output = io.StringIO()

    def report(self, **changes):
        return {
            "version": 1,
            "requestedAt": self.requested_at,
            "completedAt": "2026-11-04T00:00:05.000Z",
            "previousServerPid": self.old_pid,
            "newServerPid": self.new_pid,
            "lostRunIds": [],
            **changes,
        }

    def run_command(self, args, **kwargs):
        # Every subprocess boundary is replaced. An unexpected command fails the
        # test instead of reaching the machine running the suite.
        name = Path(args[0]).name
        if name == self.fail_command:
            return subprocess.CompletedProcess(args, 1, "", "controlled preflight failure")
        if name == "launchctl":
            result = self.service_output
        elif name == "lsof":
            result = str(next(self.listener_values, self.new_pid))
        elif name == "ps" and args[-1] == "lstart=":
            result = next(self.start_values, self.old_start)
        elif name == "ps" and args[-1] == "ppid=":
            result = str(self.supervisor_pid)
        elif name == "node":
            self.assertEqual(kwargs["cwd"], self.repo)
            self.assertEqual(kwargs["env"]["PAPERCLIP_HOME"], str(self.repo.parent / ".runtime"))
            for inherited_override in ["DATABASE_URL", "PAPERCLIP_API_URL", "PAPERCLIP_API_KEY", "PAPERCLIP_RUN_ID", "NODE_OPTIONS"]:
                self.assertNotIn(inherited_override, kwargs["env"])
            self.assertEqual(args[-2:], ["--server-pid", str(self.old_pid)])
            result = json.dumps(self.prepared)
        else:
            raise AssertionError(f"Unexpected subprocess: {args!r}")
        return subprocess.CompletedProcess(args, 0, result, "")

    @contextlib.contextmanager
    def controlled_main(self, *, after_wait=None):
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(restart, "__file__", str(self.repo / "scripts/restart-agentos-local.py")))
            stack.enter_context(mock.patch.object(restart.sys, "platform", "darwin"))
            stack.enter_context(mock.patch.object(restart.sys, "argv", ["restart-agentos-local.py"]))
            stack.enter_context(mock.patch.dict(restart.os.environ, {
                "DATABASE_URL": "postgres://other-instance.invalid/foreign",
                "PAPERCLIP_API_URL": "https://other-instance.invalid",
                "PAPERCLIP_API_KEY": "unrelated-test-key",
                "PAPERCLIP_RUN_ID": "unrelated-test-run",
                "NODE_OPTIONS": "--require unrelated-hook",
            }))
            stack.enter_context(mock.patch.object(restart.subprocess, "run", side_effect=self.run_command))
            kill = stack.enter_context(mock.patch.object(restart.os, "kill"))
            network = stack.enter_context(mock.patch.object(
                restart.urllib.request, "urlopen", side_effect=lambda *a, **k: io.BytesIO(b'{"status":"ok"}')
            ))
            stack.enter_context(mock.patch.object(restart.time, "monotonic", side_effect=itertools.count()))
            wait = stack.enter_context(mock.patch.object(restart.time, "sleep", side_effect=after_wait))
            stack.enter_context(contextlib.redirect_stdout(self.output))
            yield kill, network, wait

    def test_preflight_failures_never_signal(self):
        cases = ["ps_denied", "native_preparation_failed", "wrong_startup_command", "preparation_rejected", "non_object_preparation"]
        for case in cases:
            with self.subTest(case=case):
                self.listener_values = iter([self.old_pid, self.old_pid])
                self.fail_command = {"ps_denied": "ps", "native_preparation_failed": "node"}.get(case)
                service_output = self.service_output
                prepared = dict(self.prepared)
                if case == "wrong_startup_command":
                    self.service_output = self.service_output.replace("dev:once", "other:service")
                if case == "preparation_rejected":
                    self.prepared["status"] = "not_prepared"
                if case == "non_object_preparation":
                    self.prepared = []
                try:
                    with self.controlled_main() as (kill, network, wait):
                        with self.assertRaises(RuntimeError):
                            restart.main()
                        kill.assert_not_called()
                        network.assert_not_called()
                        wait.assert_not_called()
                finally:
                    self.service_output = service_output
                    self.prepared = prepared

    def test_replaced_listener_or_reused_pid_never_signals(self):
        for case in ["listener_replaced", "same_pid_new_process"]:
            with self.subTest(case=case):
                self.listener_values = iter([self.old_pid, self.new_pid if case == "listener_replaced" else self.old_pid])
                self.start_values = iter([self.old_start, "Wed Nov  4 12:00:00 2026"])
                with self.controlled_main() as (kill, network, wait):
                    with self.assertRaisesRegex(RuntimeError, "changed during preparation"):
                        restart.main()
                    kill.assert_not_called()
                    network.assert_not_called()
                    wait.assert_not_called()

    def test_waits_for_this_request_and_explicit_empty_lost_runs(self):
        reports = [
            self.report(requestedAt="2026-11-03T00:00:00.000Z"),
            [],
            {key: value for key, value in self.report().items() if key != "lostRunIds"},
            self.report(lostRunIds=""),
            self.report(),
        ]
        self.report_path.write_text(json.dumps(reports.pop(0)))

        def advance_report(_seconds):
            self.report_path.write_text(json.dumps(reports.pop(0)))

        with self.controlled_main(after_wait=advance_report) as (kill, network, wait):
            restart.main()
            kill.assert_called_once_with(self.old_pid, signal.SIGTERM)
            self.assertEqual(wait.call_count, 4)
            self.assertEqual(network.call_count, 5)
        self.assertIn("Native recovery reports no lost runs", self.output.getvalue())

    def test_lost_runs_and_missing_report_never_claim_success(self):
        for case in ["lost_runs", "missing_report"]:
            with self.subTest(case=case):
                self.listener_values = iter([self.old_pid, self.old_pid])
                self.start_values = iter([self.old_start, self.old_start])
                self.output.seek(0)
                self.output.truncate()
                if case == "lost_runs":
                    self.report_path.write_text(json.dumps(self.report(lostRunIds=["run-needing-recovery"])))
                else:
                    self.report_path.unlink(missing_ok=True)
                with self.controlled_main() as (kill, _network, _wait):
                    expected = "reports lost runs" if case == "lost_runs" else "not confirmed within 90 seconds"
                    with self.assertRaisesRegex(RuntimeError, expected):
                        restart.main()
                    kill.assert_called_once_with(self.old_pid, signal.SIGTERM)
                self.assertNotIn("Native recovery reports no lost runs", self.output.getvalue())


if __name__ == "__main__":
    unittest.main()
