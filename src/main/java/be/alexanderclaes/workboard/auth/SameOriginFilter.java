package be.alexanderclaes.workboard.auth;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.PreMatching;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.Map;
import java.util.Set;

@Provider
@PreMatching
@Priority(Priorities.AUTHENTICATION - 100)
public class SameOriginFilter implements ContainerRequestFilter {
    private static final Set<String> SAFE_METHODS =
            Set.of("GET", "HEAD", "OPTIONS");

    @ConfigProperty(name = "app.auth.allowed-origin")
    String allowedOrigin;

    @Override
    public void filter(ContainerRequestContext request) {
        String path = request.getUriInfo().getPath().replaceFirst("^/", "");

        if (!(path.equals("api") || path.startsWith("api/"))
                || SAFE_METHODS.contains(request.getMethod())) {
            return;
        }

        boolean validOrigin = allowedOrigin.equals(
                request.getHeaderString("Origin")
        );

        boolean validHeader = "1".equals(
                request.getHeaderString("X-Workboard-Request")
        );

        if (!validOrigin || !validHeader) {
            request.abortWith(
                    Response.status(Response.Status.FORBIDDEN)
                            .entity(Map.of(
                                    "message",
                                    "Request origin is not allowed."
                            ))
                            .build()
            );
        }
    }
}