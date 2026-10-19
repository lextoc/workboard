package be.alexanderclaes.workboard.auth;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.NotAuthorizedException;

import java.util.UUID;

@RequestScoped
public class CurrentUser {
    @Inject
    SecurityIdentity identity;

    public UUID id() {
        if (identity.isAnonymous()) {
            throw new NotAuthorizedException("Session");
        }

        return UUID.fromString(identity.getPrincipal().getName());
    }
}