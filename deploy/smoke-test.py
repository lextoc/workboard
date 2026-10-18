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
    name = f"CI smoke project {uuid.uuid4()}"
    title = f"CI smoke ticket {uuid.uuid4()}"
    status, body = request(base, "/api/projects", "POST", {"name": name})
    require(status == 201, f"Project create returned {status}")
    project_id = str(uuid.UUID(json.loads(body)["id"]))
    project_path = f"/api/projects/{project_id}"
    ticket_path = None
    try:
        status, body = request(base, "/api/projects")
        require(status == 200 and any(project["id"] == project_id and project["name"] == name
                                      for project in json.loads(body)), "Empty project is missing from catalog")
        status, body = request(base, "/api/tickets", "POST",
                               {"title": title, "status": "TODO", "projectId": project_id})
        require(status == 201, f"Ticket create returned {status}")
        ticket_id = str(uuid.UUID(json.loads(body)["id"]))
        ticket_path = f"/api/tickets/{ticket_id}"
        status, body = request(base, ticket_path)
        ticket = json.loads(body)
        require(status == 200 and ticket["projectId"] == project_id and ticket["projectName"] == name,
                "Ticket creation did not persist its project assignment")
        status, body = request(base, project_path, "DELETE")
        require(status == 409 and json.loads(body).get("message"), "Assigned project deletion must return a clear 409")
        renamed = name + " renamed"
        status, body = request(base, project_path, "PUT", {"name": renamed})
        require(status == 200 and json.loads(body)["name"] == renamed, "Project rename failed")
        status, body = request(base, ticket_path)
        require(status == 200 and json.loads(body)["projectName"] == renamed, "Ticket does not show renamed project")
        update = {"title": title, "status": "DOING", "blocked": True,
                  "blockedNote": "CI check", "projectId": project_id}
        status, body = request(base, ticket_path, "PUT", update)
        require(status == 200 and json.loads(body)["blocked"]
                and json.loads(body)["projectId"] == project_id, "Blocking or assignment preservation failed")
        update.update(status="DONE", blocked=False, blockedNote=None, projectId=None)
        status, body = request(base, ticket_path, "PUT", update)
        ticket = json.loads(body)
        require(status == 200 and ticket["completedAt"] is not None
                and ticket["projectId"] is None and ticket["projectName"] is None, "Completion or unassignment failed")
        update.update(projectId=project_id)
        status, body = request(base, ticket_path, "PUT", update)
        require(status == 200 and json.loads(body)["projectId"] == project_id, "Ticket reassignment failed")
        status, body = request(base, ticket_path)
        require(status == 200 and json.loads(body)["title"] == title
                and json.loads(body)["projectName"] == renamed, "Stored assigned ticket read failed")
    finally:
        cleanup_errors = []
        if ticket_path:
            try:
                status, _ = request(base, ticket_path, "DELETE")
                if status != 204:
                    cleanup_errors.append(f"Smoke ticket cleanup returned {status}")
            except OSError as error:
                cleanup_errors.append(f"Smoke ticket cleanup failed: {error}")
        try:
            status, _ = request(base, project_path, "DELETE")
            if status != 204:
                cleanup_errors.append(f"Smoke project cleanup returned {status}")
        except OSError as error:
            cleanup_errors.append(f"Smoke project cleanup failed: {error}")
        require(not cleanup_errors, "; ".join(cleanup_errors))
    status, _ = request(base, ticket_path)
    require(status == 404, "Deleted ticket remains accessible")
    status, body = request(base, project_path, "DELETE")
    require(status == 404 and json.loads(body).get("message") == "Project not found.",
            "Deleted project must return a clear 404")
    status, body = request(base, "/api/projects")
    require(status == 200 and all(project["id"] != project_id for project in json.loads(body)),
            "Deleted smoke project remains in catalog")


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
        protected = [("/", "GET"), ("/app.js", "GET"), ("/picker.js", "GET"),
                     ("/styles.css", "GET"), ("/q/health/ready", "GET")]
        for resource in ("tickets", "projects"):
            protected.extend([(f"/api/{resource}", "GET"), (f"/api/{resource}", "POST"),
                              (f"/api/{resource}/{uuid.uuid4()}", "PUT"),
                              (f"/api/{resource}/{uuid.uuid4()}", "DELETE")])
        for path, method in protected:
            status, _ = request(base, path, method, authenticated=False)
            require(status == 401, f"Anonymous {method} {path} returned {status}, expected 401")
    wait_ready(base)
    for path in ["/", "/app.js", "/picker.js", "/styles.css", "/api/tickets", "/api/projects"]:
        status, body = request(base, path)
        require(status == 200, f"GET {path} returned {status}")
        if path in ("/api/tickets", "/api/projects"):
            require(isinstance(json.loads(body), list), f"{path} list response is invalid")
    if args.exercise_api:
        exercise_api(base)
    print("Smoke checks passed")


if __name__ == "__main__":
    main()
