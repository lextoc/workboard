#!/usr/bin/env python3
import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.request
import uuid


def request(base, path, method="GET", body=None, authenticated=True):
    headers = {}
    if authenticated and os.environ.get("SMOKE_USERNAME"):
        credentials = f"{os.environ['SMOKE_USERNAME']}:{os.environ['SMOKE_PASSWORD']}"
        headers["Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
    data = None if body is None else json.dumps(body).encode()
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def wait_ready(base):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            status, body = request(base, "/q/health/ready")
            if status == 200 and json.loads(body)["status"] == "UP":
                return
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(2)
    raise RuntimeError("Application did not become ready within 90 seconds")


def exercise_api(base):
    title = f"CI smoke test {uuid.uuid4()}"
    status, body = request(base, "/api/tickets", "POST", {"title": title, "status": "TODO"})
    require(status == 201, f"Create returned {status}")
    ticket = json.loads(body)
    path = f"/api/tickets/{uuid.UUID(ticket['id'])}"
    try:
        update = {"title": title, "status": "DOING", "blocked": True, "blockedNote": "CI check"}
        status, body = request(base, path, "PUT", update)
        require(status == 200 and json.loads(body)["blocked"], "Blocking failed")
        update.update(status="DONE", blocked=False, blockedNote=None)
        status, body = request(base, path, "PUT", update)
        require(status == 200 and json.loads(body)["completedAt"] is not None, "Completion failed")
        status, body = request(base, path)
        require(status == 200 and json.loads(body)["title"] == title, "Stored ticket read failed")
    finally:
        status, _ = request(base, path, "DELETE")
        require(status == 204, "Smoke ticket cleanup failed")
    status, _ = request(base, path)
    require(status == 404, "Deleted ticket remains accessible")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("--exercise-api", action="store_true")
    parser.add_argument("--check-auth", action="store_true")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    if args.check_auth:
        require(bool(os.environ.get("SMOKE_USERNAME") and os.environ.get("SMOKE_PASSWORD")),
                "Public checks require smoke test credentials")
        for path, method in [("/", "GET"), ("/app.js", "GET"), ("/api/tickets", "GET"),
                             ("/api/tickets", "POST"), (f"/api/tickets/{uuid.uuid4()}", "PUT"),
                             (f"/api/tickets/{uuid.uuid4()}", "DELETE"), ("/q/health/ready", "GET")]:
            status, _ = request(base, path, method, authenticated=False)
            require(status == 401, f"Anonymous {method} {path} returned {status}, expected 401")
    wait_ready(base)
    for path in ["/", "/app.js", "/styles.css", "/api/tickets"]:
        status, body = request(base, path)
        require(status == 200, f"GET {path} returned {status}")
        if path == "/api/tickets":
            require(isinstance(json.loads(body), list), "Ticket list response is invalid")
    if args.exercise_api:
        exercise_api(base)
    print("Smoke checks passed")


if __name__ == "__main__":
    main()
