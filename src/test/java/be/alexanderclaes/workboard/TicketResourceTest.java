package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.project.Project;
import be.alexanderclaes.workboard.ticket.Ticket;
import be.alexanderclaes.workboard.ticket.TicketStatus;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
class TicketResourceTest extends AuthenticatedApiTest {

    @Inject
    EntityManager entityManager;

    @Test
    void getEndpointsIncludeProjectIdentifierAndNameForAssignedTicket() {
        UUID ticketId = createTicket("Assigned ticket");
        UUID projectId = QuarkusTransaction.requiringNew().call(() -> {
            Project project = new Project();
            project.setName("Workboard");
            project.assignOwner(entityManager.getReference(be.alexanderclaes.workboard.auth.AppUser.class, userId));
            entityManager.persist(project);
            entityManager.find(Ticket.class, ticketId).setProject(project);
            return project.getId();
        });

        try {
            assertStoredState(ticketId, "Assigned ticket", "TODO", false, null);
            assertProjectOnGetEndpoints(ticketId, projectId, "Workboard");
        } finally {
            QuarkusTransaction.requiringNew().run(() -> {
                entityManager.remove(entityManager.find(Ticket.class, ticketId));
                entityManager.remove(entityManager.find(Project.class, projectId));
            });
        }
    }

    @Test
    void getEndpointsIncludeNullProjectFieldsForUnassignedTicket() {
        UUID ticketId = createTicket("Unassigned ticket");

        try {
            assertStoredState(ticketId, "Unassigned ticket", "TODO", false, null);
            assertProjectOnGetEndpoints(ticketId, null, null);
        } finally {
            given().when().delete("/api/tickets/{id}", ticketId)
                    .then().statusCode(204);
        }
    }

    @Test
    void createsTicketInEachRequestedColumnWithUnblockedDefaults() {
        for (TicketStatus status : TicketStatus.values()) {
            UUID id = UUID.fromString(given()
                    .contentType(ContentType.JSON)
                    .body(Map.of("title", "Write API tests", "status", status.name()))
                    .when().post("/api/tickets")
                    .then()
                    .statusCode(201)
                    .body("id", notNullValue())
                    .body("title", equalTo("Write API tests"))
                    .body("status", equalTo(status.name()))
                    .body("blocked", equalTo(false))
                    .body("blockedNote", nullValue())
                    .extract().jsonPath().getString("id"));

            assertStoredState(id, "Write API tests", status.name(), false, null);
        }
    }

    @Test
    void rejectsMissingNullAndUnknownStatusOnCreate() {
        Map<String, Object> request = new HashMap<>();
        request.put("title", "Choose a column");
        given().contentType(ContentType.JSON).body(request)
                .when().post("/api/tickets").then().statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Status is required."));

        request.put("status", null);
        given().contentType(ContentType.JSON).body(request)
                .when().post("/api/tickets").then().statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Status is required."));

        request.put("status", "DOIGN");
        given().contentType(ContentType.JSON).body(request)
                .when().post("/api/tickets").then().statusCode(400);
    }

    @Test
    void rejectsMissingBlankAndOversizedTitlesOnCreate() {
        List<Map<String, Object>> requests = new ArrayList<>();
        requests.add(Map.of("status", "TODO"));
        Map<String, Object> nullTitle = new HashMap<>();
        nullTitle.put("title", null);
        nullTitle.put("status", "TODO");
        requests.add(nullTitle);
        for (String title : List.of("", " \t\n", "x".repeat(201))) {
            requests.add(Map.of("title", title, "status", "TODO"));
        }

        for (Map<String, Object> request : requests) {
            String title = (String) request.get("title");
            String message = title == null ? "Title is required."
                    : title.isBlank() ? "Title cannot be blank."
                    : "Title cannot exceed 200 characters.";
            given()
                    .contentType(ContentType.JSON)
                    .body(request)
                    .when().post("/api/tickets")
                    .then().statusCode(400).contentType(ContentType.JSON)
                    .body("message", equalTo(message));
        }
    }

    @Test
    void rejectsNullTicketRequestBodiesWithoutChangingStoredTicket() {
        UUID id = createTicket("Original title");
        Map<String, Object> before = given().get("/api/tickets/{id}", id)
                .then().statusCode(200).extract().jsonPath().getMap("$");
        List<String> idsBefore = given().get("/api/tickets")
                .then().statusCode(200).extract().jsonPath().getList("id", String.class);

        given().contentType(ContentType.JSON).body("null")
                .when().post("/api/tickets").then().statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Request body is required."));
        given().contentType(ContentType.JSON).body("null")
                .when().put("/api/tickets/{id}", id).then().statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Request body is required."));

        assertEquals(before, given().get("/api/tickets/{id}", id)
                .then().statusCode(200).extract().jsonPath().getMap("$"));
        assertEquals(idsBefore, given().get("/api/tickets")
                .then().statusCode(200).extract().jsonPath().getList("id", String.class));
    }

    @Test
    void listsTicketsInAscendingIdentifierOrder() {
        UUID first = createTicket("First listed ticket");
        UUID second = createTicket("Second listed ticket");

        List<String> ids = given()
                .when().get("/api/tickets")
                .then().statusCode(200)
                .extract().jsonPath().getList("id", String.class);

        assertTrue(ids.containsAll(List.of(first.toString(), second.toString())));
        assertEquals(ids.stream().sorted().toList(), ids);
    }

    @Test
    void acceptsTitleAndNoteAtTheirMaximumLengths() {
        String title = "x".repeat(200);
        String note = "x".repeat(1000);
        UUID id = createTicket(title);

        update(id, state(title, "DOING", true, note)).statusCode(200);

        assertStoredState(id, title, "DOING", true, note);
    }

    @Test
    void blockingRequiresNonblankNoteAndDoesNotChangeStoredTicket() {
        UUID id = createTicket("Original title");
        Map<String, Object> request = state("Changed title", "DOING", true, null);
        update(id, request).statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Please provide a reason for blocking this ticket."));
        assertStoredState(id, "Original title", "TODO", false, null);

        for (String note : List.of("", " \t\n")) {
            request.put("blockedNote", note);
            update(id, request).statusCode(400).contentType(ContentType.JSON)
                    .body("message", equalTo("Blocked note cannot be blank."));
            assertStoredState(id, "Original title", "TODO", false, null);
        }
    }

    @Test
    void blockedTicketKeepsNoteWhenMovingBetweenTodoAndDoing() {
        UUID id = createTicket("Waiting ticket");
        String note = "Waiting for access";
        update(id, state("Waiting ticket", "TODO", true, note)).statusCode(200);

        update(id, state("Waiting ticket", "DOING", true, note)).statusCode(200);
        assertStoredState(id, "Waiting ticket", "DOING", true, note);

        update(id, state("Waiting ticket", "TODO", true, note)).statusCode(200);
        assertStoredState(id, "Waiting ticket", "TODO", true, note);
    }

    @Test
    void blockedTicketCanMoveToDoneWhenSimultaneouslyUnblocking() {
        UUID id = createTicket("Blocked ticket");
        String note = "Waiting for review";
        update(id, state("Blocked ticket", "DOING", true, note)).statusCode(200);

        update(id, state("Changed title", "DONE", true, note)).statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Unblock this ticket before moving it to DONE."));
        assertStoredState(id, "Blocked ticket", "DOING", true, note);

        update(id, state("Changed title", "DONE", false, note))
                .statusCode(200)
                .body("blockedNote", nullValue())
                .body("completedAt", notNullValue());
        assertStoredState(id, "Changed title", "DONE", false, null);
    }

    @Test
    void unblockingClearsOldNoteAndAllowsLaterMoveToDone() {
        UUID id = createTicket("Finish ticket");
        String oldNote = "Waiting for review";
        update(id, state("Finish ticket", "DOING", true, oldNote)).statusCode(200);

        update(id, state("Finish ticket", "DOING", false, oldNote))
                .statusCode(200)
                .body("blockedNote", nullValue());
        assertStoredState(id, "Finish ticket", "DOING", false, null);

        update(id, state("Finish ticket", "DONE", false, null)).statusCode(200);
        assertStoredState(id, "Finish ticket", "DONE", false, null);
    }

    @Test
    void doneTicketCannotBeBlocked() {
        UUID id = createTicket("Completed ticket");
        update(id, state("Completed ticket", "DONE", false, null)).statusCode(200);

        update(id, state("Changed title", "DONE", true, "A new blocker")).statusCode(400);

        assertStoredState(id, "Completed ticket", "DONE", false, null);
    }

    @Test
    void cannotBecomeDoneAndBlockedInOneUpdate() {
        UUID id = createTicket("Open ticket");

        update(id, state("Changed title", "DONE", true, "A blocker")).statusCode(400);

        assertStoredState(id, "Open ticket", "TODO", false, null);
    }

    @Test
    void rejectsInvalidFieldValuesWithoutChangingStoredTicket() {
        UUID id = createTicket("Original title");
        Map<String, Object> invalidValues = new HashMap<>();
        invalidValues.put("title", " \t\n");
        invalidValues.put("status", "DOIGN");
        invalidValues.put("blocked", null);
        invalidValues.put("blockedNote", "x".repeat(1001));

        invalidValues.forEach((field, value) -> {
            Map<String, Object> request = state("Changed title", "DOING", true, "Valid note");
            request.put(field, value);
            ValidatableResponse response = update(id, request).statusCode(400);
            if (!field.equals("status")) {
                String message = switch (field) {
                    case "title" -> "Title cannot be blank.";
                    case "blocked" -> "Blocked is required.";
                    default -> "Blocked note cannot exceed 1000 characters.";
                };
                response.contentType(ContentType.JSON).body("message", equalTo(message));
            }
            assertStoredState(id, "Original title", "TODO", false, null);
        });

        update(id, state("x".repeat(201), "DOING", false, null)).statusCode(400).contentType(ContentType.JSON)
                .body("message", equalTo("Title cannot exceed 200 characters."));
        assertStoredState(id, "Original title", "TODO", false, null);
    }

    @Test
    void rejectsOmittedAndNullRequiredUpdateFieldsWithoutChangingStoredTicket() {
        UUID id = createTicket("Original title");

        for (String field : List.of("title", "status", "blocked")) {
            String message = switch (field) {
                case "title" -> "Title is required.";
                case "status" -> "Status is required.";
                default -> "Blocked is required.";
            };
            Map<String, Object> request = state("Changed title", "DOING", true, "Valid note");
            request.remove(field);
            update(id, request).statusCode(400).contentType(ContentType.JSON)
                    .body("message", equalTo(message));
            assertStoredState(id, "Original title", "TODO", false, null);

            request.put(field, null);
            update(id, request).statusCode(400).contentType(ContentType.JSON)
                    .body("message", equalTo(message));
            assertStoredState(id, "Original title", "TODO", false, null);
        }
    }

    @Test
    void updatingUnknownIdentifierReturnsNotFound() {
        UUID id = createTicket("Temporary ticket");
        given().when().delete("/api/tickets/{id}", id).then().statusCode(204);

        update(id, state("Missing ticket", "TODO", false, null)).statusCode(404);
    }

    private void assertProjectOnGetEndpoints(UUID ticketId, UUID projectId, String projectName) {
        given()
                .when().get("/api/tickets/{id}", ticketId)
                .then()
                .statusCode(200)
                .body("id", equalTo(ticketId.toString()))
                .body("$", hasKey("projectId"))
                .body("$", hasKey("projectName"))
                .body("projectId", projectId == null ? nullValue() : equalTo(projectId.toString()))
                .body("projectName", projectName == null ? nullValue() : equalTo(projectName));

        String ticketPath = "find { it.id == '" + ticketId + "' }";

        given()
                .when().get("/api/tickets")
                .then()
                .statusCode(200)
                .body(ticketPath + ".id", equalTo(ticketId.toString()))
                .body(ticketPath, hasKey("projectId"))
                .body(ticketPath, hasKey("projectName"))
                .body(ticketPath + ".projectId", projectId == null ? nullValue() : equalTo(projectId.toString()))
                .body(ticketPath + ".projectName", projectName == null ? nullValue() : equalTo(projectName));
    }

    private UUID createTicket(String title) {
        return UUID.fromString(given()
                .contentType(ContentType.JSON)
                .body(Map.of("title", title, "status", "TODO"))
                .when().post("/api/tickets")
                .then().statusCode(201)
                .extract().jsonPath().getString("id"));
    }

    private Map<String, Object> state(String title, String status, boolean blocked, String note) {
        Map<String, Object> request = new HashMap<>();
        request.put("title", title);
        request.put("status", status);
        request.put("blocked", blocked);
        request.put("blockedNote", note);
        return request;
    }

    private ValidatableResponse update(UUID id, Map<String, Object> request) {
        return given()
                .contentType(ContentType.JSON)
                .body(request)
                .when().put("/api/tickets/{id}", id)
                .then();
    }

    private void assertStoredState(UUID id, String title, String status, boolean blocked, String note) {
        given()
                .when().get("/api/tickets/{id}", id)
                .then()
                .statusCode(200)
                .body("id", equalTo(id.toString()))
                .body("title", equalTo(title))
                .body("status", equalTo(status))
                .body("blocked", equalTo(blocked))
                .body("blockedNote", note == null ? nullValue() : equalTo(note));
    }
}
