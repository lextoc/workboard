# Workboard

A learning project for a ticket board with TODO, DOING, and DONE columns. The owner builds the application; agents act as coaches and reviewers under the agreement in [AGENTS.md](AGENTS.md).

## Current features

- Create tickets in any column, edit titles inline in a textarea beside the actions button, and delete tickets. While editing, Enter adds a line, Ctrl/⌘ + Enter saves, and Escape cancels. Saved titles preserve line breaks on the card.
- Cards show the title, a three-dot actions button, and a small indicator when blocked. Hover over the actions button for 250 ms or click/tap it to open movement, blocking, deletion, and drag controls. Keyboard users can open it with Enter/Space or Arrow Down, Tab through actions, and close it with Escape. The drag control also supports left/right arrow keys.
- Add tickets with an explicit Add button or Enter. The actions panel contains a shortened UUID reference; the full identifier is retained in API requests and available in the reference tooltip.
- Submit blocking requests, record or edit a blocking reason, and unblock tickets.
- Refresh the board manually to load the current server state.
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
- Quarkus JUnit and REST Assured for API tests

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
./mvnw test
./mvnw package
```

The API test suite covers creation, validation, listing order, blocking, unblocking, updates, and missing-ticket updates.

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
