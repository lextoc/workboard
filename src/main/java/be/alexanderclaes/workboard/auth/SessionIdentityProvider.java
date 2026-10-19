package be.alexanderclaes.workboard.auth;

import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;

import java.time.Clock;

@ApplicationScoped
public class SessionIdentityProvider
        implements IdentityProvider<SessionAuthenticationRequest> {

    @Inject
    SessionLookup lookup;

    @Override
    public Class<SessionAuthenticationRequest> getRequestType() {
        return SessionAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            SessionAuthenticationRequest request,
            AuthenticationRequestContext context
    ) {
        return context.runBlocking(() -> lookup.authenticate(request.token()));
    }

    @ApplicationScoped
    public static class SessionLookup {
        @Inject
        EntityManager entityManager;

        @Inject
        SessionTokens tokens;

        @Inject
        Clock clock;

        @Transactional
        public SecurityIdentity authenticate(String token) {
            if (!tokens.hasValidFormat(token)) {
                return null;
            }

            UserSession session = entityManager.find(
                    UserSession.class,
                    tokens.hash(token)
            );

            if (session == null
                    || !session.getExpiresAt().isAfter(clock.instant())) {
                return null;
            }

            String userId = session.getUser().getId().toString();

            return QuarkusSecurityIdentity.builder()
                    .setPrincipal(() -> userId)
                    .build();
        }
    }
}