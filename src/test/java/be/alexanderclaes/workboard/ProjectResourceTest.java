package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.ticket.Ticket;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
class ProjectResourceTest {
    @Inject
    EntityManager entityManager;

    private final List<UUID> projects = new ArrayList<>();
    private final List<UUID> tickets = new ArrayList<>();

    @AfterEach
    void removeFixtures() {
        for (UUID id : tickets) {
            given().when().delete("/api/tickets/{id}", id).then().statusCode(204);
        }
        for (UUID id : projects) {
            given().when().delete("/api/projects/{id}", id).then().statusCode(204);
        }
    }

    @Test
    void createsAndListsEmptyProjectsInIdentifierOrder() {
        UUID first = createProject("First empty project");
        UUID second = createProject("Second empty project");

        List<String> ids = given().when().get("/api/projects")
                .then().statusCode(200)
                .extract().jsonPath().getList("id", String.class);

        assertTrue(ids.containsAll(List.of(first.toString(), second.toString())));
        assertEquals(ids.stream().sorted().toList(), ids);
        assertProjectName(first, "First empty project");
        assertProjectName(second, "Second empty project");
    }

    @Test
    void acceptsMaximumNameLengthAndRenamesAssignedProject() {
        UUID projectId = createProject("x".repeat(200));
        UUID ticketId = createTicket(Map.of("title", "Assigned ticket", "status", "TODO", "projectId", projectId));
        String renamed = "y".repeat(200);

        given().contentType(ContentType.JSON).body(Map.of("name", renamed))
                .when().put("/api/projects/{id}", projectId)
                .then().statusCode(200)
                .body("id", equalTo(projectId.toString()))
                .body("name", equalTo(renamed));

        assertProjectName(projectId, renamed);
        assertAssignment(ticketId, projectId, renamed);
    }

    @Test
    void rejectsInvalidProjectNamesWithoutCreatingOrRenamingProjects() {
        UUID projectId = createProject("Original name");
        List<Map<String, Object>> invalidRequests = new ArrayList<>();
        invalidRequests.add(Map.of());
        Map<String, Object> nullName = new HashMap<>();
        nullName.put("name", null);
        invalidRequests.add(nullName);
        for (String name : List.of("", " \t\n", "x".repeat(201))) {
            invalidRequests.add(Map.of("name", name));
        }
        List<Map<String, Object>> before = projectList();

        for (Map<String, Object> request : invalidRequests) {
            String message = request.get("name") instanceof String name && name.length() > 200
                    ? "Project name cannot exceed 200 characters."
                    : "Project name cannot be blank.";
            given().contentType(ContentType.JSON).body(request)
                    .when().post("/api/projects")
                    .then().statusCode(400).body("violations.message", hasItem(message));
            given().contentType(ContentType.JSON).body(request)
                    .when().put("/api/projects/{id}", projectId)
                    .then().statusCode(400).body("violations.message", hasItem(message));
            assertEquals(before, projectList());
        }
    }

    @Test
    void rejectsNullProjectRequestBodies() {
        UUID projectId = createProject("Original name");
        List<Map<String, Object>> before = projectList();

        given().contentType(ContentType.JSON).body("null")
                .when().post("/api/projects").then().statusCode(400);
        given().contentType(ContentType.JSON).body("null")
                .when().put("/api/projects/{id}", projectId).then().statusCode(400);

        assertEquals(before, projectList());
    }

    @Test
    void missingProjectUpdatesAndDeletesReturnJsonNotFound() {
        UUID missing = UUID.randomUUID();
        given().contentType(ContentType.JSON).body(Map.of("name", "Missing"))
                .when().put("/api/projects/{id}", missing)
                .then().statusCode(404).contentType(ContentType.JSON)
                .body("message", equalTo("Project not found."));
        given().when().delete("/api/projects/{id}", missing)
                .then().statusCode(404).contentType(ContentType.JSON)
                .body("message", equalTo("Project not found."));
    }

    @Test
    void deletesEmptyProjectAndRemovesItFromCatalog() {
        UUID projectId = createProject("Delete empty project");
        given().when().delete("/api/projects/{id}", projectId).then().statusCode(204);
        projects.remove(projectId);

        given().when().get("/api/projects").then().statusCode(200)
                .body("id", not(hasItem(projectId.toString())));
        given().when().delete("/api/projects/{id}", projectId)
                .then().statusCode(404).body("message", equalTo("Project not found."));
    }

    @Test
    void rejectsDeletionWithOpenAssignmentWithoutChangingStoredData() {
        assertAssignedProjectCannotBeDeleted("TODO");
    }

    @Test
    void rejectsDeletionWithOlderDoneAssignmentWithoutChangingStoredData() {
        assertAssignedProjectCannotBeDeleted("DONE");
    }

    @Test
    void ticketCreatePersistsAssignmentAndAllowsOmittedOrNullProject() {
        UUID projectId = createProject("Ticket creation");
        UUID assigned = createTicket(Map.of("title", "Assigned", "status", "TODO", "projectId", projectId));
        assertAssignment(assigned, projectId, "Ticket creation");

        Map<String, Object> request = new HashMap<>(Map.of("title", "Unassigned", "status", "TODO"));
        assertAssignment(createTicket(request), null, null);
        request.put("projectId", null);
        assertAssignment(createTicket(request), null, null);
    }

    @Test
    void ticketUpdatesAssignReassignAndUnassignProjects() {
        UUID first = createProject("First assignment");
        UUID second = createProject("Second assignment");
        UUID ticketId = createTicket(Map.of("title", "Assignment changes", "status", "TODO"));
        Map<String, Object> request = new HashMap<>(Map.of("title", "Assignment changes", "status", "DOING", "blocked", false));

        for (UUID projectId : List.of(first, second)) {
            request.put("projectId", projectId);
            given().contentType(ContentType.JSON).body(request)
                    .when().put("/api/tickets/{id}", ticketId)
                    .then().statusCode(200).body("projectId", equalTo(projectId.toString()));
            assertAssignment(ticketId, projectId, projectId.equals(first) ? "First assignment" : "Second assignment");
        }
        request.put("projectId", null);
        given().contentType(ContentType.JSON).body(request)
                .when().put("/api/tickets/{id}", ticketId)
                .then().statusCode(200).body("projectId", nullValue()).body("projectName", nullValue());
        assertAssignment(ticketId, null, null);

        request.put("projectId", first);
        given().contentType(ContentType.JSON).body(request)
                .when().put("/api/tickets/{id}", ticketId).then().statusCode(200);
        request.remove("projectId");
        given().contentType(ContentType.JSON).body(request)
                .when().put("/api/tickets/{id}", ticketId).then().statusCode(200);
        assertAssignment(ticketId, null, null);
    }

    @Test
    void unknownProjectsRejectTicketWritesWithoutCreatingOrChangingTickets() {
        UUID projectId = createProject("Original assignment");
        UUID ticketId = createTicket(Map.of("title", "Original ticket", "status", "TODO", "projectId", projectId));
        Map<String, Object> before = storedTicket(ticketId);
        List<String> idsBefore = given().get("/api/tickets").then().statusCode(200)
                .extract().jsonPath().getList("id", String.class);
        UUID missing = UUID.randomUUID();

        given().contentType(ContentType.JSON)
                .body(Map.of("title", "Rejected create", "status", "TODO", "projectId", missing))
                .when().post("/api/tickets")
                .then().statusCode(404).body("message", equalTo("Project not found."));
        given().contentType(ContentType.JSON)
                .body(Map.of("title", "Rejected update", "status", "DOING", "blocked", true,
                        "blockedNote", "New reason", "projectId", missing))
                .when().put("/api/tickets/{id}", ticketId)
                .then().statusCode(404).body("message", equalTo("Project not found."));

        assertEquals(before, storedTicket(ticketId));
        assertEquals(idsBefore, given().get("/api/tickets").then().statusCode(200)
                .extract().jsonPath().getList("id", String.class));
        assertProjectName(projectId, "Original assignment");
    }

    @Test
    void invalidTicketUpdateDoesNotChangeAssignmentOrOtherFields() {
        UUID first = createProject("Original assignment");
        UUID second = createProject("Rejected assignment");
        UUID ticketId = createTicket(Map.of("title", "Original ticket", "status", "TODO", "projectId", first));
        Map<String, Object> before = storedTicket(ticketId);

        given().contentType(ContentType.JSON)
                .body(Map.of("title", "", "status", "DOING", "blocked", false, "projectId", second))
                .when().put("/api/tickets/{id}", ticketId).then().statusCode(400);

        assertEquals(before, storedTicket(ticketId));
    }

    private void assertAssignedProjectCannotBeDeleted(String status) {
        UUID projectId = createProject("Protected " + status);
        UUID ticketId = createTicket(Map.of("title", "Keep assigned ticket", "status", status, "projectId", projectId));
        if (status.equals("DONE")) {
            QuarkusTransaction.requiringNew().run(() -> entityManager.find(Ticket.class, ticketId)
                    .setCompletedAt(Instant.now().minus(Duration.ofDays(2))));
            given().when().get("/api/tickets").then().statusCode(200)
                    .body("id", not(hasItem(ticketId.toString())));
        }
        Map<String, Object> before = storedTicket(ticketId);

        given().when().delete("/api/projects/{id}", projectId)
                .then().statusCode(409).contentType(ContentType.JSON)
                .body("message", equalTo("Unassign this project's tickets before deleting it."));

        assertEquals(before, storedTicket(ticketId));
        assertProjectName(projectId, "Protected " + status);
    }

    private UUID createProject(String name) {
        UUID id = UUID.fromString(given().contentType(ContentType.JSON).body(Map.of("name", name))
                .when().post("/api/projects").then().statusCode(201)
                .body("name", equalTo(name)).extract().jsonPath().getString("id"));
        projects.add(id);
        return id;
    }

    private UUID createTicket(Map<String, Object> request) {
        UUID id = UUID.fromString(given().contentType(ContentType.JSON).body(request)
                .when().post("/api/tickets").then().statusCode(201)
                .extract().jsonPath().getString("id"));
        tickets.add(id);
        return id;
    }

    private List<Map<String, Object>> projectList() {
        return given().get("/api/projects").then().statusCode(200).extract().jsonPath().getList("$");
    }

    private void assertProjectName(UUID id, String name) {
        given().when().get("/api/projects").then().statusCode(200)
                .body("find { it.id == '" + id + "' }.name", equalTo(name));
    }

    private Map<String, Object> storedTicket(UUID id) {
        return given().get("/api/tickets/{id}", id).then().statusCode(200).extract().jsonPath().getMap("$");
    }

    private void assertAssignment(UUID ticketId, UUID projectId, String name) {
        given().when().get("/api/tickets/{id}", ticketId).then().statusCode(200)
                .body("projectId", projectId == null ? nullValue() : equalTo(projectId.toString()))
                .body("projectName", name == null ? nullValue() : equalTo(name));
        String ticket = "find { it.id == '" + ticketId + "' }";
        given().when().get("/api/tickets").then().statusCode(200)
                .body(ticket + ".id", equalTo(ticketId.toString()))
                .body(ticket + ".projectId", projectId == null ? nullValue() : equalTo(projectId.toString()))
                .body(ticket + ".projectName", name == null ? nullValue() : equalTo(name));
    }
}
