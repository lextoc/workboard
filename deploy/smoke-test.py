#!/usr/bin/env python3
import argparse
import copy
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path
import uuid


COOKIE_JAR = http.cookiejar.MozillaCookieJar()
CLIENT = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
ALLOWED_ORIGIN = None


def request(base, path, method="GET", body=None, authenticated=True):
    headers = {"Accept": "application/json"}
    if method not in ("GET", "HEAD", "OPTIONS"):
        parts = urllib.parse.urlsplit(base)
        headers["Origin"] = ALLOWED_ORIGIN or f"{parts.scheme}://{parts.netloc}"
        headers["X-Workboard-Request"] = "1"
    data = None if body is None else json.dumps(body).encode()
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        opener = CLIENT.open if authenticated else urllib.request.urlopen
        with opener(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def wait_ready(base, public=False):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            path = "/" if public else "/q/health/ready"
            status, body = request(base, path, authenticated=False)
            if status == 200 and (public or json.loads(body)["status"] == "UP"):
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
    global ALLOWED_ORIGIN
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--exercise-api", action="store_true")
    mode.add_argument("--check-auth", action="store_true")
    parser.add_argument("--ensure-account", action="store_true")
    parser.add_argument("--credentials-file", type=Path)
    parser.add_argument("--origin")
    parser.add_argument("--session-file", type=Path)
    parser.add_argument("--keep-session", action="store_true")
    parser.add_argument("--reuse-session", action="store_true")
    args = parser.parse_args()
    require(not args.keep_session or args.session_file is not None, "Keeping a session requires --session-file")
    require(not args.reuse_session or args.session_file is not None, "Reusing a session requires --session-file")
    require(not args.check_auth or not (args.keep_session or args.reuse_session), "Production checks must close their session")
    base = args.base_url.rstrip("/")
    ALLOWED_ORIGIN = args.origin
    COOKIE_JAR.clear()
    wait_ready(base, public=args.check_auth)
    for path in ["/", "/app.js", "/picker.js", "/styles.css"]:
        status, _ = request(base, path, authenticated=False)
        require(status == 200, f"Public asset {path} returned {status}")
    if args.check_auth:
        status, _ = request(base, "/q/health/ready", authenticated=False)
        require(status == 403, f"Public health endpoint returned {status}, expected 403")
    for path in ["/api/auth/me", "/api/tickets", "/api/projects", f"/api/tickets/{uuid.uuid4()}"]:
        status, _ = request(base, path, authenticated=False)
        require(status == 401, f"Anonymous GET {path} returned {status}, expected 401")
    for resource in ("tickets", "projects"):
        for method, path in [("POST", f"/api/{resource}"),
                             ("PUT", f"/api/{resource}/{uuid.uuid4()}"),
                             ("DELETE", f"/api/{resource}/{uuid.uuid4()}")]:
            status, _ = request(base, path, method, authenticated=False)
            require(status == 401, f"Anonymous {method} {path} returned {status}, expected 401")
    if args.reuse_session:
        COOKIE_JAR.load(str(args.session_file), ignore_discard=True)
    else:
        credentials = json.loads(args.credentials_file.read_text()) if args.credentials_file else {
            "email": os.environ.get("SMOKE_EMAIL"), "password": os.environ.get("SMOKE_PASSWORD")
        }
        if args.exercise_api and not credentials["email"]:
            credentials = {"email": f"smoke-{uuid.uuid4()}@example.com", "password": uuid.uuid4().hex}
        require(bool(credentials.get("email") and credentials.get("password")), "Smoke checks require an application email and password")
        if args.ensure_account or args.exercise_api:
            status, _ = request(base, "/api/auth/register", "POST", credentials)
            require(status in (201, 409), f"Smoke account registration returned {status}")
        status, _ = request(base, "/api/auth/login", "POST", credentials)
        require(status == 200, f"Application login returned {status}")
    retained = False
    try:
        status, body = request(base, "/api/auth/me")
        require(status == 200 and json.loads(body).get("id"), "Session authentication failed")
        for path in ["/api/tickets", "/api/projects"]:
            status, body = request(base, path)
            require(status == 200 and isinstance(json.loads(body), list), f"{path} list response is invalid")
        if args.exercise_api:
            exercise_api(base)
        if args.keep_session:
            fd = os.open(args.session_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.fchmod(fd, 0o600)
            os.close(fd)
            COOKIE_JAR.save(str(args.session_file), ignore_discard=True)
            retained = True
    finally:
        if not retained:
            replay_jar = http.cookiejar.CookieJar()
            for cookie in COOKIE_JAR:
                replay_jar.set_cookie(copy.copy(cookie))
            replay = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(replay_jar))
            status, _ = request(base, "/api/auth/logout", "POST")
            require(status == 204, f"Application logout returned {status}")
            try:
                replay.open(base + "/api/auth/me", timeout=10)
            except urllib.error.HTTPError as error:
                require(error.code == 401, f"Revoked session returned {error.code}")
            else:
                raise RuntimeError("Logged-out session remains valid")
            if args.session_file:
                args.session_file.unlink(missing_ok=True)
    print("Smoke checks passed")


if __name__ == "__main__":
    main()
