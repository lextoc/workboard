import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
import urllib.error
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

    def test_public_verification_uses_login_and_logout_without_board_writes(self):
        def request(base, path, method="GET", body=None, authenticated=True):
            if path == "/q/health/ready":
                return 403, b""
            if path in ("/", "/app.js", "/picker.js", "/styles.css"):
                return 200, b"asset"
            if not authenticated:
                return 401, b""
            if path == "/api/auth/login":
                self.assertEqual(body, {"email": "smoke@example.com", "password": "test"})
                return 200, b"{}"
            if path == "/api/auth/logout":
                return 204, b""
            if path == "/api/auth/me":
                return 200, b'{"id":"user"}'
            return 200, b"[]"

        replay = unittest.mock.Mock()
        replay.open.side_effect = urllib.error.HTTPError(BASE, 401, "Unauthorized", {}, None)
        with patch.object(smoke, "request", side_effect=request) as requests, \
                patch.object(smoke, "wait_ready"), \
                patch.object(smoke.urllib.request, "build_opener", return_value=replay), \
                patch.object(smoke, "exercise_api") as exercise, \
                patch.object(sys, "argv", ["smoke-test.py", BASE, "--check-auth"]), \
                patch.dict(os.environ, {"SMOKE_EMAIL": "smoke@example.com", "SMOKE_PASSWORD": "test"}):
            smoke.main()
            exercise.assert_not_called()
            requests.assert_any_call(BASE, "/picker.js", authenticated=False)
            requests.assert_any_call(BASE, "/api/projects")
            requests.assert_any_call(BASE, "/api/auth/logout", "POST")
            for entry in requests.call_args_list:
                if entry.kwargs.get("authenticated", True) and not entry.args[1].startswith("/api/auth/"):
                    self.assertEqual(entry.args[2] if len(entry.args) > 2 else "GET", "GET")
            replay.open.assert_called_once()

    def test_request_sends_origin_and_csrf_header_and_separates_anonymous_client(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.read.return_value = b"{}"
        with patch.object(smoke.CLIENT, "open", return_value=response) as client, \
                patch.object(smoke.urllib.request, "urlopen", return_value=response) as anonymous, \
                patch.object(smoke, "ALLOWED_ORIGIN", "https://workboard.example"):
            smoke.request(BASE, "/api/auth/login", "POST", {"email": "test@example.com"})
            request = client.call_args.args[0]
            self.assertEqual(request.get_header("Origin"), "https://workboard.example")
            self.assertEqual(request.get_header("X-workboard-request"), "1")
            self.assertIsNone(request.get_header("Authorization"))
            smoke.request(BASE, "/api/tickets", authenticated=False)
            anonymous.assert_called_once()

    def test_production_mode_cannot_exercise_board_writes(self):
        with patch.object(sys, "argv", ["smoke-test.py", BASE, "--check-auth", "--exercise-api"]):
            with self.assertRaises(SystemExit):
                smoke.main()


if __name__ == "__main__":
    unittest.main()
