package db.migration;

import org.flywaydb.core.api.configuration.Configuration;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class LegacyOwnershipMigrationTest {
    private static final String EMAIL = "owner@example.com";
    private static final String HASH = "$argon2id$v=19$m=19456,t=2,p=1$test$test";

    @Test
    void emptyDatabaseNeedsNoBootstrapAccountAndEnforcesOwnership() throws Exception {
        try (Connection connection = database()) {
            new V4__assign_legacy_ownership(Map.of()).migrate(context(connection));
            assertEquals(0, count(connection, "SELECT count(*) FROM app_user"));
            assertThrows(SQLException.class, () -> seed(connection));
        }
    }

    @Test
    void populatedDatabasePreservesDataAndAssignsBothTablesToOneOwner() throws Exception {
        try (Connection connection = database()) {
            seed(connection);
            new V4__assign_legacy_ownership(Map.of(
                    "WORKBOARD_LEGACY_OWNER_EMAIL", " OWNER@example.com ",
                    "WORKBOARD_LEGACY_OWNER_PASSWORD_HASH", HASH
            )).migrate(context(connection));
            assertEquals(1, count(connection, "SELECT count(*) FROM app_user WHERE email = '" + EMAIL + "'"));
            assertEquals(1, count(connection, "SELECT count(*) FROM ticket t JOIN project p ON t.project_id = p.id WHERE t.owner_id = p.owner_id AND t.title = 'Preserved ticket' AND p.name = 'Preserved project'"));
            assertEquals(0, count(connection, "SELECT count(*) FROM ticket WHERE owner_id IS NULL"));
            assertEquals(0, count(connection, "SELECT count(*) FROM project WHERE owner_id IS NULL"));
        }
    }

    @Test
    void missingBootstrapConfigurationFailsWithoutDeletingRows() throws Exception {
        try (Connection connection = database()) {
            seed(connection);
            assertThrows(SQLException.class, () ->
                    new V4__assign_legacy_ownership(Map.of()).migrate(context(connection)));
            assertEquals(1, count(connection, "SELECT count(*) FROM ticket WHERE owner_id IS NULL"));
            assertEquals(1, count(connection, "SELECT count(*) FROM project WHERE owner_id IS NULL"));
            assertEquals(0, count(connection, "SELECT count(*) FROM app_user"));
        }
    }

    @Test
    void existingOwnerAccountIsReusedWithoutReplacingItsPassword() throws Exception {
        try (Connection connection = database()) {
            seed(connection);
            UUID id = UUID.randomUUID();
            try (var statement = connection.prepareStatement("INSERT INTO app_user VALUES (?, ?, ?, CURRENT_TIMESTAMP)")) {
                statement.setObject(1, id);
                statement.setString(2, EMAIL);
                statement.setString(3, "existing-hash");
                statement.executeUpdate();
            }
            new V4__assign_legacy_ownership(Map.of("WORKBOARD_LEGACY_OWNER_EMAIL", EMAIL))
                    .migrate(context(connection));
            assertEquals(1, count(connection, "SELECT count(*) FROM app_user WHERE password_hash = 'existing-hash'"));
            try (var statement = connection.createStatement();
                 var rows = statement.executeQuery("SELECT owner_id FROM ticket")) {
                assertTrue(rows.next());
                assertEquals(id, rows.getObject(1, UUID.class));
            }
        }
    }

    private Connection database() throws Exception {
        Connection connection = DriverManager.getConnection("jdbc:h2:mem:" + UUID.randomUUID());
        for (String migration : new String[]{"V1__create_ticket.sql", "V2__create_project_and_ticket_assignment.sql", "V3__create_users_and_sessions.sql"}) {
            try (var input = getClass().getResourceAsStream("/db/migration/" + migration);
                 var statement = connection.createStatement()) {
                assertNotNull(input);
                for (String sql : new String(input.readAllBytes(), StandardCharsets.UTF_8).split(";")) {
                    if (!sql.isBlank()) statement.execute(sql);
                }
            }
        }
        return connection;
    }

    private void seed(Connection connection) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute("INSERT INTO project (id,name) VALUES ('00000000-0000-0000-0000-000000000001', 'Preserved project')");
            statement.execute("INSERT INTO ticket (id,title,status,blocked,project_id) VALUES ('00000000-0000-0000-0000-000000000002','Preserved ticket','TODO',false,'00000000-0000-0000-0000-000000000001')");
        }
    }

    private int count(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            rows.next();
            return rows.getInt(1);
        }
    }

    private Context context(Connection connection) {
        return new Context() {
            @Override
            public Configuration getConfiguration() {
                return null;
            }

            @Override
            public Connection getConnection() {
                return connection;
            }
        };
    }
}
