package be.alexanderclaes.workboard.auth;

import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.AuthenticationRequest;
import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticationMechanism;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.Set;

@ApplicationScoped
public class SessionAuthenticationMechanism
        implements HttpAuthenticationMechanism {

    @Inject
    SessionCookie cookies;

    @Override
    public Uni<SecurityIdentity> authenticate(
            RoutingContext context,
            IdentityProviderManager identityProviderManager
    ) {
        String token = cookies.read(context);

        if (token == null) {
            return Uni.createFrom().nullItem();
        }

        return identityProviderManager.authenticate(
                new SessionAuthenticationRequest(token)
        );
    }

    @Override
    public Uni<ChallengeData> getChallenge(RoutingContext context) {
        return Uni.createFrom().item(
                new ChallengeData(401, "Cache-Control", "no-store")
        );
    }

    @Override
    public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
        return Set.of(SessionAuthenticationRequest.class);
    }
}