package be.alexanderclaes.workboard.auth;

import jakarta.persistence.*;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

@Entity
@Table(name = "user_session")
public class UserSession {
    public static final Duration LIFETIME = Duration.ofDays(30);

    @Id
    @Column(name = "token_hash", length = 64, nullable = false)
    private String tokenHash;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, updatable = false)
    private AppUser user;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    protected UserSession() {
    }

    public UserSession(String tokenHash, AppUser user, Instant now) {
        this.tokenHash = Objects.requireNonNull(tokenHash);
        this.user = Objects.requireNonNull(user);
        this.createdAt = Objects.requireNonNull(now);
        this.expiresAt = now.plus(LIFETIME);
    }

    public AppUser getUser() {
        return user;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}