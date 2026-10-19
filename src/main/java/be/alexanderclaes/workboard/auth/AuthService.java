package be.alexanderclaes.workboard.auth;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@ApplicationScoped
public class AuthService {
    @Inject
    EntityManager entityManager;

    @Inject
    PasswordHasher passwords;

    @Inject
    SessionTokens tokens;

    @Inject
    Clock clock;

    private volatile String dummyHash;

    private String dummyHash() {
        String current = dummyHash;

        if (current == null) {
            synchronized (this) {
                current = dummyHash;

                if (current == null) {
                    current = passwords.hash(tokens.generate());
                    dummyHash = current;
                }
            }
        }

        return current;
    }

    @Transactional
    public UserResponse register(RegisterRequest request) {
        String email = AppUser.normalizeEmail(request.email());

        if (findByEmail(email) != null) {
            throw failure(409, "Email is already registered.");
        }

        AppUser user = new AppUser(
                email,
                passwords.hash(request.password()),
                clock.instant()
        );

        entityManager.persist(user);
        entityManager.flush();

        return UserResponse.from(user);
    }

    @Transactional
    public LoginResult login(LoginRequest request) {
        AppUser user = findByEmail(
                AppUser.normalizeEmail(request.email())
        );

        String encodedHash = user == null
                ? dummyHash()
                : user.passwordHash();

        boolean matches = passwords.matches(
                request.password(),
                encodedHash
        );

        if (!matches || user == null) {
            throw failure(401, "Invalid email or password.");
        }

        String token = tokens.generate();
        UserSession session = new UserSession(
                tokens.hash(token),
                user,
                clock.instant()
        );

        entityManager.persist(session);

        return new LoginResult(
                token,
                UserResponse.from(user),
                session.getExpiresAt()
        );
    }

    @Transactional
    public UserResponse currentUser(UUID userId) {
        AppUser user = entityManager.find(AppUser.class, userId);

        if (user == null) {
            throw failure(401, "Authentication required.");
        }

        return UserResponse.from(user);
    }

    @Transactional
    public void logout(String token) {
        if (!tokens.hasValidFormat(token)) {
            return;
        }

        entityManager.createQuery("""
                DELETE FROM UserSession s
                WHERE s.tokenHash = :tokenHash
                """)
                .setParameter("tokenHash", tokens.hash(token))
                .executeUpdate();
    }

    private AppUser findByEmail(String email) {
        return entityManager.createQuery("""
                SELECT u FROM AppUser u
                WHERE u.email = :email
                """, AppUser.class)
                .setParameter("email", email)
                .getResultStream()
                .findFirst()
                .orElse(null);
    }

    private WebApplicationException failure(int status, String message) {
        return new WebApplicationException(
                Response.status(status)
                        .entity(Map.of("message", message))
                        .build()
        );
    }

    public record LoginResult(
            String token,
            UserResponse user,
            Instant expiresAt
    ) {
    }
}