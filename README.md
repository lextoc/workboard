# Workboard

A learning project for a ticket board with TODO, DOING, and DONE columns. The owner builds the backend with agents as coaches and reviewers, and delegates frontend implementation to AI under the agreement in [AGENTS.md](AGENTS.md).

## Current features

- A blue SVG favicon depicts the three-column board and scales to browser tab sizes.

- Log in or create an account with email and password, without email verification. The frontend checks `/api/auth/me` before loading tickets or projects, logs in after successful registration, and provides a logout button. Registration, login, logout, and account isolation are covered by backend tests and a local live-browser exercise against PostgreSQL.

- Create tickets in any column, click a card outside its actions menu to edit its title inline in a textarea beside the actions button, and delete tickets. While editing, Enter adds a line, Ctrl/⌘ + Enter saves, and Escape cancels. Saved titles preserve line breaks on the card.
- Cards show the title, project name, a three-dot actions button, a monochrome blocked icon when applicable, and visible arrow buttons for moving to adjacent columns. To do and Done have one movement arrow; In progress has two. Arrow buttons work with pointer, touch, Enter, or Space and are disabled while the ticket is editing or saving. Drag-and-drop is not implemented. Hover over the actions button for 250 ms or click/tap it to open assignment, blocking, and deletion controls. Menu and movement clicks do not open the title editor. Keyboard users can open the menu with Enter/Space or Arrow Down, Tab through actions, and close it with Escape.
- Add tickets with an explicit Add button or Enter. The actions panel contains a shortened UUID reference; the full identifier is retained in API requests and available in the reference tooltip.
- Submit blocking requests, record or edit a blocking reason, and unblock tickets.
- Refresh the board manually to load the current server state.
- The app always uses its light appearance, including when the operating system prefers dark mode. There is no theme toggle or dark stylesheet.
- Persist tickets through a JSON REST API, with UUID identifiers.
- Show project names on ticket cards and filter the board by all projects, a specific project, or unassigned tickets. Column counts reflect the current filter.
- Search titles, project names, blocking reasons, and ticket IDs with case-insensitive, multiword matching: every word must appear somewhere on the ticket. Literal punctuation is supported. Matches in titles, project badges, and blocking previews are highlighted safely as text. The search field shows matches within the selected project/blocked scope, a dedicated clear button, and a platform-specific shortcut hint. Press `/` outside text fields or ⌘/Ctrl+K to focus and select the query; Enter focuses the first result without editing it; Escape or Clear search clears only the query. Reset filters also clears the project and Blocked only filter. View controls are disabled during edits and saves.
- The board starts directly with search and filters. Decorative headings, column descriptions, repeated form hints, and duplicate summary metrics have been removed. Column counts and the result line describe loaded tickets, including the API's one-day completion window shown beside Done. Empty columns distinguish no tickets from no matches. Routine refresh completion is announced to screen readers; errors and action feedback remain visible.
- The board follows the visual language of [Start](https://start.alexanderclaes.be): white and pale gray surfaces, Apple blue, system typography, fine dividers, rounded controls, and blurred dialog backdrops. Layouts adapt to mobile, with expandable keyboard help. Column headings and counts use plain text, project names use muted metadata, and the header has no decorative monogram. Colored column/filter bullets, project pills, and dashed empty-state boxes are removed. Long project names truncate visually while retaining their full text and tooltip.
- Project controls use custom `project-picker` elements with styled listboxes instead of native dropdown menus. They support arrow keys, Home/End, Enter/Space, typeahead, Escape, outside-click dismissal, selected-state announcements, and disabled states. Listboxes appear above dialogs and ticket menus and fit the viewport. Ticket deletion uses a styled confirmation dialog with initial focus on Cancel instead of a browser confirmation prompt.
- Dropdown preferences are saved in local storage under `workboard.dropdowns.v1.<user-id>`: the project filter, a separate new-ticket project for each column, and the selected project in the management dialog. They restore after the session, projects, and tickets load. Account IDs scope preferences independently; the previous unscoped storage key is no longer read. Deleted or unknown projects fall back to All projects, Unassigned, or New project as appropriate; temporary catalog failures preserve saved choices for retry. Invalid or unavailable storage does not block the board. Ticket assignment dropdowns always reflect persisted server data rather than browser preferences.
- Open Projects to create, rename, or delete a project. Deletion requires a custom confirmation dialog and is disabled with an explanation when loaded tickets are assigned to the project. Successful deletion refreshes the catalog and board and resets a deleted project filter to All projects. Server errors preserve the selection for retry. Newly created projects remain selected in the dialog and appear in the project filter, including projects without tickets.
- Ticket assignment controls submit the selected project; the resource now resolves and saves assignments, based on code inspection. The frontend verifies the saved assignment through GET and reports any mismatch. When the project list cannot be loaded, management and assignment controls are disabled while existing assignments remain visible and filterable.

Blocking is a separate flag, not a column. The API rejects blocked tickets in DONE. Unblocking clears the stored reason.

Ticket and project frontend input validation is disabled to allow manual testing of API validation. Create and edit forms submit text unchanged, including blank, whitespace-only, and overlong values. The UI also allows attempting to block DONE tickets or move blocked tickets to DONE. Server errors are displayed on the form or ticket. These frontend submission paths are covered by the frontend browser suite.

The frontend formats API constraint violations with field labels and displays JSON or plain-text error messages alongside the HTTP status. Empty or HTML error responses produce a fallback message, and connection failures advise refreshing to confirm the saved state. Value-record constructor messages can only be displayed when the API includes them in its response; a Java exception message alone is not an API error contract.

The list endpoint filters out DONE tickets whose completion timestamp is older than one day (verified by code inspection). This does not delete them, and the board only reloads the list on page load or manual refresh. Entering DONE sets the completion timestamp, editing a ticket that remains DONE preserves it, and leaving DONE clears it.

Backend domain guarantees and limitations, verified by code inspection: the ticket title setter requires a non-null checked `TicketTitle` before storing its text. The public ticket constructor initializes title and lifecycle state, while the no-argument constructor is protected for persistence. `Ticket.changeState` checks the proposed status/blocking combination before mutation, accepts a checked blocking note, clears notes when unblocking, and records, preserves, or clears completion time according to the transition. The resource supplies the current time. These operations protect ordinary domain callers as well as HTTP requests; they do not repair existing inconsistent database rows. The production migrations enforce nullability, text lengths, allowed status values, and project references, but do not enforce the relationships between blocking, status, and completion time.

## Stack

- Java 21 and Quarkus 3.40.1
- Jakarta Persistence with Hibernate ORM and `EntityManager`
- Jakarta Validation with Hibernate Validator
- Quarkus REST with Jackson and ArC dependency injection
- H2 for development and tests; PostgreSQL with Flyway migrations for production
- Plain HTML, CSS, and JavaScript served by Quarkus, with no separate frontend build
- Quarkus JUnit and REST Assured for API tests; MicroProfile Health readiness checks

## Setup

Java 21 or newer is required. The Maven wrapper is included.

## Development

```sh
./mvnw quarkus:dev
```

Open the board at http://localhost:8080. To run alongside another app using that port:

```sh
./mvnw quarkus:dev -Dquarkus.http.port=8081
```

Development uses a file-backed H2 database at `./data/workboard`. Hibernate updates its schema on startup. Tests use a separate in-memory H2 database with a recreated schema.

## Ticket API

All endpoints use the `/api/tickets` base path. Request and response bodies use JSON.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/tickets` | List open tickets and recently completed tickets, ordered by identifier |
| GET | `/api/tickets/{id}` | Retrieve a ticket, including one excluded from the list |
| POST | `/api/tickets` | Create a ticket and return it with status 201 |
| PUT | `/api/tickets/{id}` | Update a ticket and return it with status 200 |
| DELETE | `/api/tickets/{id}` | Delete a ticket and return status 204 |

Individual reads, updates, and deletes explicitly return 404 when the ticket does not exist, verified by code inspection. Invalid request values are intended to return 400 through request parsing and API error handling.

Create requests require a nonblank `title` of at most 200 characters and a `status` of `TODO`, `DOING`, or `DONE`:

By code inspection, ticket creation and updates check required fields in request-record constructors and title/note contents in value records. The update request constructor also rejects blocked-with-DONE and blocked-without-note combinations. Project request constructors check nonblank names of at most 200 characters, independently of the entity setter. Ticket and project write endpoints explicitly reject null request bodies and no longer use Jakarta Validation. The request exception mapper includes constructor failures for ticket and project request records in its JSON-message handling; the wrapping and JSON messages are verified by the passing API suite.

```json
{
  "title": "Review ticket validation",
  "status": "TODO"
}
```

New tickets start unblocked with no blocking reason. Update requests require `title`, `status`, and `blocked`; they are not partial updates:

```json
{
  "title": "Review ticket validation",
  "status": "DOING",
  "blocked": true,
  "blockedNote": "Waiting for access"
}
```

`blockedNote` is limited to 1000 characters and must contain nonblank text when `blocked` is true. Requests combining `blocked: true` with `status: "DONE"` are rejected. The API allows unblocking and completing a ticket in one update by setting `blocked: false` and `status: "DONE"`. When `blocked` is false, the stored note is cleared.

Ticket POST, GET, and PUT responses contain `id`, `title`, `status`, `blocked`, `blockedNote`, `completedAt`, `projectId`, and `projectName`. Both project fields are null for unassigned tickets. Both request DTOs accept a nullable `projectId`, which the resource resolves and applies. An unknown project UUID returns 404 with `{ "message": "Project not found." }`. A null or omitted `projectId` means unassigned, including on PUT. These assignment behaviors are covered by the API suite and packaged PostgreSQL exercise.

## Project API

The following endpoints are implemented, based on code inspection. Request and response bodies use JSON.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/projects` | Return an array of `{ "id": "UUID", "name": "Project name" }`, including projects without tickets |
| POST | `/api/projects` | Create a project from `{ "name": "Project name" }`; return `{id, name}` with status 201 |
| PUT | `/api/projects/{id}` | Rename a project using `{ "name": "Project name" }`; return `{id, name}` with status 200 |
| DELETE | `/api/projects/{id}` | Delete a project and return status 204; missing projects return 404 |

Project names must be nonblank and at most 200 characters. Invalid names return 400; renaming or deleting a missing project returns 404 with `{ "message": "Project not found." }`. Deletion counts all assigned tickets, including older DONE tickets. Projects with assigned tickets return 409 with `Unassign this project's tickets before deleting it.` This behavior is verified by regression tests for open and older DONE assignments and by the packaged PostgreSQL smoke exercise. The database foreign key remains necessary for concurrent assignment/deletion races.

Project mutations accept successful 2xx responses, followed by a reload of the project catalog and tickets. Errors appear in the project dialog, preserving the submitted name for retry; names are sent unchanged for server-side validation. These frontend flows were verified with mocked API responses, not against a running backend.

Ticket POST and PUT requests include `projectId` as a UUID string or null. Null means unassigned. Every title, status, blocking, or assignment update sends the current project identifier unless the user explicitly changes it. Choosing a project filter also selects that project in the ticket creation forms; choosing All projects or Unassigned defaults new tickets to no project. Each creation form can override this selection. Reloading restores those per-column overrides independently of the saved project filter. Reset filters saves All projects and resets the new-ticket project defaults to Unassigned; it preserves the project-management selection.

After ticket writes, the frontend reads `/api/tickets/{id}` to render the canonical GET response and verify the saved assignment. If the backend ignores the requested assignment, the UI reports the mismatch rather than showing an optimistic project label. A ticket moved outside the selected project view is hidden and announced. Project management and assignment require a successful project-catalog load; Refresh board retries a failed catalog request.

## Build and test

```sh
./mvnw test -DargLine=
./mvnw --batch-mode verify -DargLine=
```

The current Java suite has 52 tests: 11 authentication/security API tests, 17 ticket API tests, 12 project/assignment API tests, eight ticket-domain tests, and four legacy-ownership migration tests. All 52 passed with Java 21 on 2026-10-22. Existing API tests use real registered accounts, sessions, and CSRF headers. Authentication coverage includes normalized/duplicate email, concurrent signup, validation, Argon2id storage, generic login failures, HttpOnly/SameSite cookie attributes, token hashing, exact fixed 30-day expiry with an injected clock, session-specific logout, invalid tokens, CSRF rejection, anonymous rejection, and cross-account reads, writes, lists, and assignment rejection.

Frontend browser checks are separate from Maven and use Node.js with an externally available Playwright installation and Chromium. No frontend package dependencies are added to the application. With Playwright available to Node:

```sh
node --test src/test/frontend/projects.test.cjs
```

If Playwright is installed elsewhere, set `NODE_PATH` to its containing `node_modules` directory. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium executable, or use Playwright's installed default browser. Optional `WORKBOARD_SCREENSHOT_DIR` captures desktop and mobile screenshots.

The current frontend suite has 28 tests, all passing locally on 2026-10-19 against an isolated static server and mocked API responses. The nine authentication checks cover session restoration before private requests, login, registration followed by login, rejected credentials and duplicate email, recovery after registration succeeds but login fails, expiry hiding and clearing the board and closing dialogs, logout failure/retry, session-service retry, account-scoped preferences, and the authentication layout at 320px. The request helper sends same-origin cookies and `X-Workboard-Request: 1` on modifying requests. No session credentials are stored in local storage. Desktop board and mobile login/signup screenshots were visually inspected. These checks do not verify backend cookies, CSRF enforcement, authorization, or the 30-day expiry.

Deployment tooling tests run with `python3 -m unittest discover -s deploy/tests -v`; all 15 passed locally on 2026-10-19. Actionlint accepted the updated Delivery workflow. The workflow builds on Java 21, runs the frontend tests with Node.js 24 and Playwright 1.62.1 outside the application, and exercises the packaged application against PostgreSQL 16. A restricted cookie file retains the first session across restart; the second exercise reuses that session and checks server-side logout revocation. Maven Failsafe integration tests remain disabled by default; the packaged smoke exercise is a separate workflow step.

Local packaged checks on PostgreSQL 14 on 2026-10-19 passed fresh V1/V2/V3 migration, Hibernate schema validation, restart with the original session, project/ticket operations, and session revocation. A live Chromium exercise against that application passed signup, automatic login, project/ticket creation, logout, restoration after login, and a separate account's empty board. PostgreSQL 16 remains covered by the workflow rather than this local run. A temporary nginx 1.28.0 HTTPS gateway passed configuration validation and live checks of Secure host cookies, public health denial, CSRF rejection, and login/signup rate limits including trailing-slash/matrix-parameter forms. The temporary certificate and listeners were local only; production certificate paths and the running server configuration were not validated. No production database reset or deployment was performed.

## Production configuration

The packaged application uses PostgreSQL and requires these environment variables:

| Variable | Purpose | Example |
| --- | --- | --- |
| `DB_JDBC_URL` | PostgreSQL JDBC connection URL | `jdbc:postgresql://localhost:5432/workboard` |
| `DB_USERNAME` | Database user | `workboard` |
| `DB_PASSWORD` | Database password | Your database password |

Provision the database and credentials, set those variables, then run the packaged application:

```sh
java -jar target/quarkus-app/quarkus-run.jar
```

Flyway runs migrations from `src/main/resources/db/migration` on production startup. Hibernate validates the resulting schema. The database user needs permission to apply migrations.

The health extension exposes `/q/health/ready` locally, including datasource readiness. The updated nginx configuration denies public access to `/q/`.

## Authentication and authorization

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/auth/register` | Validate email/password and create an account; 201, or 409 for an existing normalized email |
| POST | `/api/auth/login` | Verify credentials, create a session, and set its HttpOnly cookie; 200, or generic 401 |
| GET | `/api/auth/me` | Return `{id, email}` for the current session; otherwise 401 |
| POST | `/api/auth/logout` | Revoke the current session and expire its cookie; 204 |

Email is trimmed and lowercased consistently; no verification message is sent. Registration passwords must contain 15–128 Java characters and must not be blank; passwords are never trimmed. An email address is an unverified account identifier, not proof that the account owns a mailbox. Password recovery is not implemented.

Passwords use salted Argon2id (19 MiB memory, two iterations, parallelism one); verification reads the parameters from the encoded hash. Session credentials contain 32 random bytes; only their SHA-256 hashes are persisted. Server expiry is fixed at login plus 30 days, with no renewal during requests. Expired rows are rejected but are not automatically removed. Logout revokes only the current session. Changing credentials or revoking all sessions is not implemented.

Production defaults use the `__Host-workboard-session` cookie with Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, and a 30-day Max-Age. The server expiry remains authoritative. Development/test use `workboard-session` without Secure for local HTTP. Configuration is in `application.properties`; production overrides use `APP_AUTH_COOKIE_NAME`, `APP_AUTH_COOKIE_SECURE`, and `APP_AUTH_ALLOWED_ORIGIN`. The default trusted production origin is `https://workboard.alexanderclaes.be`. Development derives its localhost origin from the HTTP port; using `127.0.0.1` instead requires an explicit matching origin override.

Every modifying API request must include both an exact trusted `Origin` and `X-Workboard-Request: 1`, including registration and login. This same-origin CSRF design requires keeping cross-origin credentialed access disabled. The frontend sends the custom header and same-origin cookies. Protected API responses of 401 clear/hide the board and prompt for login. Preferences are scoped by account ID, and no session credentials are stored in local storage.

Ticket/project resources require authentication and scope reads, writes, and assignment lookups to the authenticated account. Another account's resource returns 404. New REST endpoints without an explicit security annotation are denied by default. Owners are set by the server rather than request input.

`V3__create_users_and_sessions.sql` creates users/sessions and initially nullable ownership columns. The Flyway Java migration `db.migration.V4__assign_legacy_ownership` assigns existing unowned tickets/projects before enforcing NOT NULL on both columns. An empty database requires no bootstrap account. For a populated database, supply `WORKBOARD_LEGACY_OWNER_EMAIL`; creating that account additionally requires `WORKBOARD_LEGACY_OWNER_PASSWORD_HASH`, generated by the application's Argon2id hasher. The migration binds these values through JDBC prepared statements, never reads a plaintext password, preserves existing account passwords, and fails startup if required bootstrap configuration is missing. Remove the one-time bootstrap environment after successful migration. Take a backup before upgrading; no database reset is required.

V3 was corrected only after production inspection confirmed it had never applied successfully and had rolled back. Do not edit an already successful SQL migration or repair history just to bypass a checksum mismatch. A database where an older V3 has already succeeded needs an explicit reviewed migration/history reconciliation.

The tracked nginx configuration replaces the shared Basic gate with public assets/login/signup, application session authentication, per-IP login/signup throttling returning 429, and public `/q/` denial. Login permits an average five requests per minute with burst five; signup permits two per minute with burst two. Equivalent trailing-slash and matrix-parameter endpoint forms are covered. The backend remains bound to localhost. These gateway and privileged helper changes need administrative installation; editing the repository does not change the running server. See [deployment activation](deploy/README.md).

The repository also includes a JVM Dockerfile at `src/main/docker/Dockerfile.jvm`. The current droplet deployment uses the packaged application directly with Java 21 and systemd.

## Live deployment

The production board is hosted at https://workboard.alexanderclaes.be on the existing droplet, reached administratively through `ssh root@alexanderclaes.be`. Deployment configuration is tracked in `deploy/`; database credentials stay on the server. The separate deployment SSH key and HTTP smoke-test credentials are stored as encrypted GitHub production environment secrets.

| Component | Location or behavior |
| --- | --- |
| Application | `workboard.service`, running as the dedicated `workboard` system user with the `prod` profile |
| Releases | `/opt/workboard/releases/`, selected by the `/opt/workboard/current` symlink |
| Backend | `127.0.0.1:18083`, with an explicit hostname allowlist |
| Database | Dedicated PostgreSQL `workboard` database and login role |
| Database configuration | `/etc/workboard/workboard.env`, readable only by root and loaded by systemd |
| Public gateway | `/etc/nginx/sites-available/workboard.alexanderclaes.be` |
| Application login | Email/password accounts in PostgreSQL with Argon2id password hashes and session cookies |
| HTTPS | Let's Encrypt certificate with automatic renewal and an nginx reload hook; HTTP redirects to HTTPS |
| Backups | `workboard-backup.timer` runs daily around 03:20 UTC, retaining roughly 14 days of PostgreSQL dumps under `/var/backups/workboard` |

Backups are stored on the same droplet. They do not protect against losing the droplet or its disk; off-server backup storage is not configured.

The manual release procedure is to build with `./mvnw package -DargLine=`, upload the entire `target/quarkus-app/` directory into a new release directory, switch the `current` symlink, and restart `workboard.service`. Keep the previous release for rollback. Flyway runs on each startup; rolling back application files does not reverse database migrations.

The [GitHub Delivery workflow](.github/workflows/delivery.yml) automates checks on pull requests and deploys successful builds of `main`. GitHub and the droplet have been configured for this workflow. See [deployment setup and recovery](deploy/README.md) for the exact changes, credentials, branch rules, and rollback behavior. Deployment helper changes require a separate administrative installation; application deployments do not replace the privileged server tooling.

Inspect application logs with `journalctl -u workboard.service` and trigger a backup with `systemctl start workboard-backup.service`. The backup job checks that each dump has a readable archive directory; a full restore drill has not been performed.

Deployment verification on 2026-10-17: all 14 API tests passed during packaging. Live HTTPS checks confirmed anonymous requests are rejected for the frontend, assets, and API methods; authenticated assets match the workspace; ticket creation, updates, blocking, completion, and deletion work against PostgreSQL; and a temporary ticket survived a service restart before being removed. HTTP redirects to HTTPS, the backend port is not publicly reachable, and a database dump completed successfully. Development H2 data was not migrated. Browser rendering and interaction checks were not performed as part of deployment.

Local automation verification on 2026-10-18: the Java 21 build and all 14 API tests passed; eight deployment-tooling tests passed; Actionlint 1.7.12 accepted the workflow. Packaged API smoke checks passed against an isolated local PostgreSQL 14 database on first startup and restart, with one successful Flyway migration and no remaining smoke tickets. Administrative setup verified the GitHub environment and branch protection, the restricted deployment connection, and rejection of arbitrary SSH commands and corrupt uploads. PostgreSQL 16 checks and production deployment results are recorded in [GitHub Actions](https://github.com/lextoc/workboard/actions/workflows/delivery.yml).


The auth recovery migrations are now tracked in source: V3 adds nullable ownership, and V4 backfills legacy rows before enforcing NOT NULL. This reconciles normal deployment artifacts with the previously verified recovery build. No database reset is required.
