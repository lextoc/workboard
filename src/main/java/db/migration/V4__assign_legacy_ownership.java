package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class V4__assign_legacy_ownership extends BaseJavaMigration {
    private final Map<String, String> environment;

    public V4__assign_legacy_ownership() {
        this(System.getenv());
    }

    V4__assign_legacy_ownership(Map<String, String> environment) {
        this.environment = Map.copyOf(environment);
    }

    @Override
    public void migrate(Context context) throws SQLException {
        Connection connection = context.getConnection();
        if (hasUnownedRows(connection)) {
            UUID ownerId = resolveOwner(connection);
            for (String table : new String[]{"ticket", "project"}) {
                try (var statement = connection.prepareStatement(
                        "UPDATE " + table + " SET owner_id = ? WHERE owner_id IS NULL")) {
                    statement.setObject(1, ownerId);
                    statement.executeUpdate();
                }
            }
        }
        try (var statement = connection.createStatement()) {
            statement.execute("ALTER TABLE ticket ALTER COLUMN owner_id SET NOT NULL");
            statement.execute("ALTER TABLE project ALTER COLUMN owner_id SET NOT NULL");
        }
    }

    private boolean hasUnownedRows(Connection connection) throws SQLException {
        try (var statement = connection.createStatement();
             var rows = statement.executeQuery("""
                     SELECT EXISTS (SELECT 1 FROM ticket WHERE owner_id IS NULL)
                         OR EXISTS (SELECT 1 FROM project WHERE owner_id IS NULL)
                     """)) {
            rows.next();
            return rows.getBoolean(1);
        }
    }

    private UUID resolveOwner(Connection connection) throws SQLException {
        String email = environment.getOrDefault("WORKBOARD_LEGACY_OWNER_EMAIL", "")
                .trim().toLowerCase(Locale.ROOT);
        if (email.isBlank() || email.length() > 254 || !email.contains("@")) {
            throw new SQLException("Legacy rows require WORKBOARD_LEGACY_OWNER_EMAIL before migration.");
        }
        try (var statement = connection.prepareStatement("SELECT id FROM app_user WHERE email = ?")) {
            statement.setString(1, email);
            try (var rows = statement.executeQuery()) {
                if (rows.next()) return rows.getObject(1, UUID.class);
            }
        }
        String hash = environment.getOrDefault("WORKBOARD_LEGACY_OWNER_PASSWORD_HASH", "");
        if (!hash.startsWith("$argon2id$") || hash.length() > 512) {
            throw new SQLException("Creating the legacy owner requires an Argon2id WORKBOARD_LEGACY_OWNER_PASSWORD_HASH.");
        }
        UUID id = UUID.randomUUID();
        try (var statement = connection.prepareStatement("""
                INSERT INTO app_user (id, email, password_hash, created_at)
                VALUES (?, ?, ?, ?)
                """)) {
            statement.setObject(1, id);
            statement.setString(2, email);
            statement.setString(3, hash);
            statement.setTimestamp(4, Timestamp.from(Instant.now()));
            statement.executeUpdate();
        }
        return id;
    }
}
