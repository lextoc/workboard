package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.auth.AppUser;
import be.alexanderclaes.workboard.auth.PasswordHasher;
import be.alexanderclaes.workboard.auth.SessionTokens;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
class AuthResourceTest {
    private static final String PASSWORD = "a-long-test-password";
    private final String prefix = UUID.randomUUID().toString();

    @Inject
    EntityManager entityManager;

    @Inject
    MutableClock clock;

    @Inject
    SessionTokens tokens;

    @Inject
    PasswordHasher passwords;

    @AfterEach
    void cleanUp() {
        clock.set(null);
        QuarkusTransaction.requiringNew().run(() -> {
            List<AppUser> users = entityManager.createQuery(
                    "SELECT u FROM AppUser u WHERE u.email LIKE :prefix", AppUser.class)
                    .setParameter("prefix", prefix + "%").getResultList();
            for (AppUser user : users) {
                UUID id = user.getId();
                entityManager.createQuery("DELETE FROM Ticket t WHERE t.owner.id = :id")
                        .setParameter("id", id).executeUpdate();
                entityManager.createQuery("DELETE FROM Project p WHERE p.owner.id = :id")
                        .setParameter("id", id).executeUpdate();
                entityManager.createQuery("DELETE FROM UserSession s WHERE s.user.id = :id")
                        .setParameter("id", id).executeUpdate();
                entityManager.remove(user);
            }
        });
    }

    @Test
    void registersNormalizedEmailAndStoresOnlyAnArgonHash() {
        String email = email("owner");
        Response response = request().body(credentials("  " + email.toUpperCase() + "  "))
                .post("/api/auth/register");
        response.then().statusCode(201).header("Cache-Control", "no-store")
                .body("email", equalTo(email))
                .body("$", not(hasKey("passwordHash")))
                .body("$", not(hasKey("password")));
        String encoded = QuarkusTransaction.requiringNew().call(() ->
                (String) entityManager.createNativeQuery(
                        "SELECT password_hash FROM app_user WHERE email = :email")
                        .setParameter("email", email).getSingleResult());
        assertTrue(encoded.startsWith("$argon2id$"));
        assertTrue(passwords.matches(PASSWORD, encoded));
        assertNotEquals(PASSWORD, encoded);
        request().body(credentials(email)).post("/api/auth/register").then().statusCode(409);
    }

    @Test
    void validatesRegistrationAndLoginBodies() {
        request().body(Map.of("email", "invalid", "password", PASSWORD))
                .post("/api/auth/register").then().statusCode(400);
        request().body(Map.of("email", email("short"), "password", "short"))
                .post("/api/auth/register").then().statusCode(400);
        for (String endpoint : List.of("register", "login")) {
            request().body("null").post("/api/auth/" + endpoint).then().statusCode(400);
            request().body("{}").post("/api/auth/" + endpoint).then().statusCode(400);
        }
    }

    @Test
    void returnsSameFailureForUnknownAccountAndWrongPassword() {
        String email = email("known");
        register(email);
        Response unknown = request().body(credentials(email("unknown"))).post("/api/auth/login");
        Response wrong = request().body(Map.of("email", email, "password", "wrong password"))
                .post("/api/auth/login");
        unknown.then().statusCode(401);
        wrong.then().statusCode(401);
        assertEquals(unknown.jsonPath().getMap("$"), wrong.jsonPath().getMap("$"));
        assertNull(wrong.cookie("workboard-session"));
    }

    @Test
    void issuesThirtyDayHttpOnlyCookieAndStoresOnlyTokenHash() {
        String email = email("cookie");
        register(email);
        Response response = login(email);
        String token = response.cookie("workboard-session");
        assertTrue(tokens.hasValidFormat(token));
        String header = response.header("Set-Cookie");
        assertTrue(header.toLowerCase().contains("httponly"));
        assertTrue(header.toLowerCase().contains("samesite=lax"));
        assertTrue(header.toLowerCase().contains("path=/"));
        assertTrue(header.toLowerCase().contains("max-age=2592000"));
        assertFalse(header.toLowerCase().contains("domain="));
        String stored = QuarkusTransaction.requiringNew().call(() ->
                (String) entityManager.createNativeQuery("SELECT token_hash FROM user_session WHERE token_hash = :hash")
                        .setParameter("hash", tokens.hash(token)).getSingleResult());
        assertEquals(tokens.hash(token), stored);
        assertNotEquals(token, stored);
        withSession(token).get("/api/auth/me").then().statusCode(200)
                .body("email", equalTo(email));
    }

    @Test
    void expiresExactlyThirtyDaysAfterLoginWithoutExtendingOnUse() {
        Instant start = Instant.parse("2026-01-01T12:00:00Z");
        clock.set(start);
        String email = email("expiry");
        register(email);
        String token = login(email).cookie("workboard-session");
        Instant expiry = start.plus(Duration.ofDays(30));
        clock.set(expiry.minusMillis(1));
        withSession(token).get("/api/auth/me").then().statusCode(200);
        Instant storedExpiry = QuarkusTransaction.requiringNew().call(() ->
                entityManager.createQuery("SELECT s.expiresAt FROM UserSession s WHERE s.tokenHash = :hash", Instant.class)
                        .setParameter("hash", tokens.hash(token)).getSingleResult());
        assertEquals(expiry, storedExpiry);
        clock.set(expiry);
        withSession(token).get("/api/auth/me").then().statusCode(401);
        clock.set(expiry.plusSeconds(1));
        withSession(token).get("/api/tickets").then().statusCode(401);
    }

    @Test
    void logoutRevokesOnlyCurrentSessionAndClearsCookie() {
        String email = email("logout");
        register(email);
        String first = login(email).cookie("workboard-session");
        String second = login(email).cookie("workboard-session");
        Response logout = withSession(first).post("/api/auth/logout");
        logout.then().statusCode(204);
        assertTrue(logout.header("Set-Cookie").toLowerCase().contains("max-age=0"));
        withSession(first).get("/api/auth/me").then().statusCode(401);
        withSession(second).get("/api/auth/me").then().statusCode(200);
    }

    @Test
    void rejectsUnknownAndMalformedTokensButAllowsFreshLogin() {
        for (String token : List.of("invalid", tokens.generate())) {
            withSession(token).get("/api/auth/me").then().statusCode(401);
        }
        String email = email("fresh");
        register(email);
        withSession("invalid").body(credentials(email)).post("/api/auth/login")
                .then().statusCode(200);
    }

    @Test
    void requiresTrustedOriginAndCustomHeaderEvenForPublicAuthEndpoints() {
        String email = email("csrf");
        for (String endpoint : List.of("register", "login")) {
            given().contentType(ContentType.JSON).body(credentials(email))
                    .post("/api/auth/" + endpoint).then().statusCode(403);
            request().header("Origin", "https://attacker.example")
                    .body(credentials(email)).post("/api/auth/" + endpoint).then().statusCode(403);
            given().contentType(ContentType.JSON).header("Origin", "http://localhost:8081")
                    .body(credentials(email)).post("/api/auth/" + endpoint).then().statusCode(403);
        }
        register(email);
        String token = login(email).cookie("workboard-session");
        given().cookie("workboard-session", token).post("/api/auth/logout").then().statusCode(403);
        withSession(token).get("/api/auth/me").then().statusCode(200);
    }

    @Test
    void rejectsAnonymousAccessToEveryBoardOperation() {
        for (String resource : List.of("tickets", "projects")) {
            String base = "/api/" + resource;
            request().get(base).then().statusCode(401);
            request().body("{}").post(base).then().statusCode(401);
            request().body("{}").put(base + "/" + UUID.randomUUID()).then().statusCode(401);
            request().delete(base + "/" + UUID.randomUUID()).then().statusCode(401);
        }
        request().get("/api/tickets/" + UUID.randomUUID()).then().statusCode(401);
    }

    @Test
    void isolatesListsReadsWritesAndProjectAssignmentsBetweenAccounts() {
        String owner = email("owner");
        String other = email("other");
        register(owner);
        register(other);
        String a = login(owner).cookie("workboard-session");
        String b = login(other).cookie("workboard-session");
        String projectId = withSession(a).body(Map.of("name", "Private project"))
                .post("/api/projects").then().statusCode(201).extract().path("id");
        String ticketId = withSession(a).body(Map.of("title", "Private", "status", "DONE", "projectId", projectId))
                .post("/api/tickets").then().statusCode(201).extract().path("id");
        withSession(b).get("/api/projects").then().statusCode(200).body("size()", equalTo(0));
        withSession(b).get("/api/tickets").then().statusCode(200).body("size()", equalTo(0));
        withSession(b).get("/api/tickets/" + ticketId).then().statusCode(404);
        Map<String, Object> update = Map.of("title", "Stolen", "status", "TODO", "blocked", false);
        withSession(b).body(update).put("/api/tickets/" + ticketId).then().statusCode(404);
        withSession(b).delete("/api/tickets/" + ticketId).then().statusCode(404);
        withSession(b).body(Map.of("name", "Stolen")).put("/api/projects/" + projectId).then().statusCode(404);
        withSession(b).delete("/api/projects/" + projectId).then().statusCode(404);
        withSession(b).body(Map.of("title", "New", "status", "TODO", "projectId", projectId))
                .post("/api/tickets").then().statusCode(404);
        String otherTicket = withSession(b).body(Map.of("title", "Other", "status", "TODO"))
                .post("/api/tickets").then().statusCode(201).extract().path("id");
        withSession(b).body(Map.of("title", "Other", "status", "TODO", "blocked", false, "projectId", projectId))
                .put("/api/tickets/" + otherTicket).then().statusCode(404);
        withSession(a).get("/api/tickets/" + ticketId).then().statusCode(200).body("title", equalTo("Private"));
        withSession(b).get("/api/tickets/" + otherTicket).then().statusCode(200).body("projectId", nullValue());
    }

    @Test
    void concurrentRegistrationCreatesExactlyOneAccount() {
        String email = email("race");
        CompletableFuture<Integer> first = CompletableFuture.supplyAsync(() ->
                request().body(credentials(email)).post("/api/auth/register").statusCode());
        CompletableFuture<Integer> second = CompletableFuture.supplyAsync(() ->
                request().body(credentials(email)).post("/api/auth/register").statusCode());
        List<Integer> statuses = List.of(first.join(), second.join()).stream().sorted().toList();
        assertEquals(List.of(201, 409), statuses);
    }

    private String email(String label) {
        return prefix + "." + label + "@example.com";
    }

    private Map<String, String> credentials(String email) {
        return Map.of("email", email, "password", PASSWORD);
    }

    private RequestSpecification request() {
        return AuthenticatedApiTest.anonymous();
    }

    private RequestSpecification withSession(String token) {
        return request().cookie("workboard-session", token);
    }

    private void register(String email) {
        request().body(credentials(email)).post("/api/auth/register").then().statusCode(201);
    }

    private Response login(String email) {
        return request().body(credentials(email)).post("/api/auth/login").then().statusCode(200).extract().response();
    }
}
