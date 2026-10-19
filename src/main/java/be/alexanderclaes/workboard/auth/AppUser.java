package be.alexanderclaes.workboard.auth;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(
        name = "app_user",
        uniqueConstraints = @UniqueConstraint(
                name = "app_user_email_unique",
                columnNames = "email"
        )
)
public class AppUser {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 254, updatable = false)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 512)
    private String passwordHash;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AppUser() {
    }

    public AppUser(String email, String passwordHash, Instant createdAt) {
        String normalized = normalizeEmail(email);

        if (normalized.isBlank() || normalized.length() > 254) {
            throw new IllegalArgumentException("Invalid email.");
        }

        if (passwordHash == null || passwordHash.isBlank()) {
            throw new IllegalArgumentException("Password hash is required.");
        }

        this.email = normalized;
        this.passwordHash = passwordHash;
        this.createdAt = Objects.requireNonNull(createdAt);
    }

    public static String normalizeEmail(String email) {
        return Objects.requireNonNull(email).trim().toLowerCase(Locale.ROOT);
    }

    public UUID getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    String passwordHash() {
        return passwordHash;
    }
}