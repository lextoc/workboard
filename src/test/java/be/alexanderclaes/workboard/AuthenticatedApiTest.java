package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.auth.AppUser;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

import java.util.Map;
import java.util.UUID;

abstract class AuthenticatedApiTest {
    @Inject
    EntityManager authEntityManager;

    protected UUID userId;
    private String session;

    @BeforeEach
    void signIn() {
        Map<String, String> credentials = Map.of(
                "email", UUID.randomUUID() + "@example.com",
                "password", "a-long-test-password"
        );
        userId = UUID.fromString(anonymous().body(credentials)
                .post("/api/auth/register").then().statusCode(201)
                .extract().path("id"));
        session = anonymous().body(credentials).post("/api/auth/login")
                .then().statusCode(200).extract().cookie("workboard-session");
    }

    protected static RequestSpecification anonymous() {
        return io.restassured.RestAssured.given()
                .contentType(ContentType.JSON)
                .header("Origin", "http://localhost:8081")
                .header("X-Workboard-Request", "1");
    }

    protected RequestSpecification given() {
        return anonymous().cookie("workboard-session", session);
    }

    @AfterEach
    void removeAccount() {
        if (userId == null) return;
        QuarkusTransaction.requiringNew().run(() -> {
            authEntityManager.createQuery("DELETE FROM Ticket t WHERE t.owner.id = :id")
                    .setParameter("id", userId).executeUpdate();
            authEntityManager.createQuery("DELETE FROM Project p WHERE p.owner.id = :id")
                    .setParameter("id", userId).executeUpdate();
            authEntityManager.createQuery("DELETE FROM UserSession s WHERE s.user.id = :id")
                    .setParameter("id", userId).executeUpdate();
            authEntityManager.remove(authEntityManager.find(AppUser.class, userId));
        });
    }
}
