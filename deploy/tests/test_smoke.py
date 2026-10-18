import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import call, patch


source = Path(__file__).resolve().parents[1] / "smoke-test.py"
spec = importlib.util.spec_from_file_location("workboard_smoke", source)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

PROJECT_ID = "00000000-0000-0000-0000-000000000001"
TICKET_ID = "00000000-0000-0000-0000-000000000002"
BASE = "http://127.0.0.1:18084"


def project_response(name):
    return json.dumps({"id": PROJECT_ID, "name": name}).encode()


class SmokeTests(unittest.TestCase):
    def test_failed_ticket_creation_still_cleans_up_project(self):
        def request(base, path, method="GET", body=None):
            if method == "POST" and path == "/api/projects":
                self.name = body["name"]
                return 201, project_response(self.name)
            if method == "GET" and path == "/api/projects":
                return 200, b"[" + project_response(self.name) + b"]"
            if method == "POST" and path == "/api/tickets":
                return 500, b""
            return 204, b""

        with patch.object(smoke, "request", side_effect=request) as requests:
            with self.assertRaisesRegex(RuntimeError, "Ticket create returned 500"):
                smoke.exercise_api(BASE)
            self.assertEqual(requests.call_args, call(BASE, f"/api/projects/{PROJECT_ID}", "DELETE"))

    def test_network_failure_after_ticket_creation_cleans_up_both_resources(self):
        def request(base, path, method="GET", body=None):
            if method == "POST" and path == "/api/projects":
                self.name = body["name"]
                return 201, project_response(self.name)
            if method == "GET" and path == "/api/projects":
                return 200, b"[" + project_response(self.name) + b"]"
            if method == "POST" and path == "/api/tickets":
                return 201, json.dumps({"id": TICKET_ID}).encode()
            if method == "GET":
                raise OSError("Connection lost")
            return 204, b""

        with patch.object(smoke, "request", side_effect=request) as requests:
            with self.assertRaisesRegex(OSError, "Connection lost"):
                smoke.exercise_api(BASE)
            self.assertEqual(requests.call_args_list[-2:], [
                call(BASE, f"/api/tickets/{TICKET_ID}", "DELETE"),
                call(BASE, f"/api/projects/{PROJECT_ID}", "DELETE"),
            ])

    def test_failed_ticket_cleanup_does_not_skip_project_cleanup(self):
        def request(base, path, method="GET", body=None):
            if method == "POST" and path == "/api/projects":
                self.name = body["name"]
                return 201, project_response(self.name)
            if method == "GET" and path == "/api/projects":
                return 200, b"[" + project_response(self.name) + b"]"
            if method == "POST" and path == "/api/tickets":
                return 201, json.dumps({"id": TICKET_ID}).encode()
            if method == "DELETE" and path == f"/api/tickets/{TICKET_ID}":
                return 500, b""
            if method == "DELETE":
                return 409, b""
            raise OSError("Connection lost")

        with patch.object(smoke, "request", side_effect=request) as requests:
            with self.assertRaisesRegex(RuntimeError, "Smoke ticket cleanup returned 500; Smoke project cleanup returned 409"):
                smoke.exercise_api(BASE)
            self.assertEqual(requests.call_args, call(BASE, f"/api/projects/{PROJECT_ID}", "DELETE"))

    def test_public_verification_checks_projects_and_picker_without_authenticated_writes(self):
        def request(base, path, method="GET", body=None, authenticated=True):
            if not authenticated:
                return 401, b""
            if path == "/q/health/ready":
                return 200, b'{"status":"UP"}'
            if path.startswith("/api/"):
                return 200, b"[]"
            return 200, b"asset"

        with patch.object(smoke, "request", side_effect=request) as requests, \
                patch.object(smoke, "exercise_api") as exercise, \
                patch.object(sys, "argv", ["smoke-test.py", BASE, "--check-auth"]), \
                patch.dict(os.environ, {"SMOKE_USERNAME": "test", "SMOKE_PASSWORD": "test"}):
            smoke.main()
            exercise.assert_not_called()
            requests.assert_any_call(BASE, "/picker.js")
            requests.assert_any_call(BASE, "/picker.js", "GET", authenticated=False)
            requests.assert_any_call(BASE, "/api/projects")
            anonymous_project_methods = set()
            for entry in requests.call_args_list:
                method = entry.args[2] if len(entry.args) > 2 else "GET"
                if entry.kwargs.get("authenticated", True):
                    self.assertEqual(method, "GET")
                elif entry.args[1].startswith("/api/projects"):
                    anonymous_project_methods.add(method)
            self.assertEqual(anonymous_project_methods, {"GET", "POST", "PUT", "DELETE"})


if __name__ == "__main__":
    unittest.main()
