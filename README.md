# Workboard

A learning project for a ticket board with TODO, DOING, and DONE columns. The owner builds the application; agents act as coaches and reviewers under the agreement in [AGENTS.md](AGENTS.md).

## Current features

- Create tickets in any column, click a card outside its actions menu to edit its title inline in a textarea beside the actions button, and delete tickets. While editing, Enter adds a line, Ctrl/⌘ + Enter saves, and Escape cancels. Saved titles preserve line breaks on the card.
- Cards show the title, a three-dot actions button, and a small indicator when blocked. Drag a card to another column to move it; dragging is disabled while editing or saving. Hover over the actions button for 250 ms or click/tap it to open movement, blocking, deletion, and drag controls. Menu clicks do not open the title editor. Keyboard users can open the menu with Enter/Space or Arrow Down, Tab through actions, and close it with Escape. The drag control also supports left/right arrow keys.
- Add tickets with an explicit Add button or Enter. The actions panel contains a shortened UUID reference; the full identifier is retained in API requests and available in the reference tooltip.
- Submit blocking requests, record or edit a blocking reason, and unblock tickets.
- Refresh the board manually to load the current server state.
- Light and dark themes follow the system appearance automatically through CSS, including changes while the page is open; there is no theme toggle or saved override.
- Persist tickets through a JSON REST API, with UUID identifiers.

Blocking is a separate flag, not a column. The API rejects blocked tickets in DONE. Unblocking clears the stored reason.

Frontend input validation is disabled to allow manual testing of API validation. Create and edit forms submit text unchanged, including blank, whitespace-only, and overlong values. The UI also allows attempting to block DONE tickets or move blocked tickets to DONE. Server errors are displayed on the form or ticket. These frontend submission paths were verified by code inspection, not by an executed browser check.

The frontend formats API constraint violations with field labels and displays JSON or plain-text error messages alongside the HTTP status. Empty or HTML error responses produce a fallback message, and connection failures advise refreshing to confirm the saved state. Value-record constructor messages can only be displayed when the API includes them in its response; a Java exception message alone is not an API error contract.

The list endpoint filters out DONE tickets whose completion timestamp is older than five minutes. This does not delete them, and the board only reloads the list on page load or manual refresh. Entering DONE sets the completion timestamp, editing a ticket that remains DONE preserves it, and leaving DONE clears it.

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

Individual reads, updates, and deletes return 404 when the ticket does not exist. Invalid request values return 400.

Create requests require a nonblank `title` of at most 200 characters and a `status` of `TODO`, `DOING`, or `DONE`:

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

Ticket responses contain `id`, `title`, `status`, `blocked`, `blockedNote`, and `completedAt`.

## Build and test

```sh
./mvnw test -DargLine=
./mvnw --batch-mode verify -DargLine=
```

The API test suite covers creation, validation, listing order, blocking, unblocking, updates, and missing-ticket updates.

Deployment tooling tests run with `python3 -m unittest discover -s deploy/tests -v`. The GitHub Delivery workflow also starts the packaged application against a disposable PostgreSQL 16 database, checks Flyway startup and API operations, and repeats the smoke checks after restarting the application against the same database. These packaged checks are explicit workflow steps; Maven Failsafe integration tests remain disabled by default.

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

The health extension exposes `/q/health/ready`, including datasource readiness. The production nginx gateway protects this endpoint with the same HTTP authentication as the rest of the site.

The application does not implement its own authentication or authorization. The deployed site uses nginx HTTP Basic authentication over HTTPS to protect both the page and `/api/tickets`. The backend binds only to localhost, so public requests must pass through nginx. Running the application directly without that gateway does not provide authentication.

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
| HTTP login | User `alexander`; password hash stored in `/etc/workboard/htpasswd` |
| HTTPS | Let's Encrypt certificate with automatic renewal and an nginx reload hook; HTTP redirects to HTTPS |
| Backups | `workboard-backup.timer` runs daily around 03:20 UTC, retaining roughly 14 days of PostgreSQL dumps under `/var/backups/workboard` |

Backups are stored on the same droplet. They do not protect against losing the droplet or its disk; off-server backup storage is not configured.

The manual release procedure is to build with `./mvnw package -DargLine=`, upload the entire `target/quarkus-app/` directory into a new release directory, switch the `current` symlink, and restart `workboard.service`. Keep the previous release for rollback. Flyway runs on each startup; rolling back application files does not reverse database migrations.

The [GitHub Delivery workflow](.github/workflows/delivery.yml) automates checks on pull requests and deploys successful builds of `main`. GitHub and the droplet have been configured for this workflow. See [deployment setup and recovery](deploy/README.md) for the exact changes, credentials, branch rules, and rollback behavior. Deployment helper changes require a separate administrative installation; application deployments do not replace the privileged server tooling.

Inspect application logs with `journalctl -u workboard.service` and trigger a backup with `systemctl start workboard-backup.service`. The backup job checks that each dump has a readable archive directory; a full restore drill has not been performed.

Deployment verification on 2026-10-17: all 14 API tests passed during packaging. Live HTTPS checks confirmed anonymous requests are rejected for the frontend, assets, and API methods; authenticated assets match the workspace; ticket creation, updates, blocking, completion, and deletion work against PostgreSQL; and a temporary ticket survived a service restart before being removed. HTTP redirects to HTTPS, the backend port is not publicly reachable, and a database dump completed successfully. Development H2 data was not migrated. Browser rendering and interaction checks were not performed as part of deployment.

Local automation verification on 2026-10-18: the Java 21 build and all 14 API tests passed; eight deployment-tooling tests passed; Actionlint 1.7.12 accepted the workflow. Packaged API smoke checks passed against an isolated local PostgreSQL 14 database on first startup and restart, with one successful Flyway migration and no remaining smoke tickets. Administrative setup verified the GitHub environment and branch protection, the restricted deployment connection, and rejection of arbitrary SSH commands and corrupt uploads. PostgreSQL 16 checks and production deployment results are recorded in [GitHub Actions](https://github.com/lextoc/workboard/actions/workflows/delivery.yml).
