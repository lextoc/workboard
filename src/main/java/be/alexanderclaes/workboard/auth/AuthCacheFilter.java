package be.alexanderclaes.workboard.auth;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;

@Provider
public class AuthCacheFilter implements ContainerResponseFilter {
    @Override
    public void filter(
            ContainerRequestContext request,
            ContainerResponseContext response
    ) {
        if (request.getUriInfo().getPath().replaceFirst("^/", "").startsWith("api/auth")) {
            response.getHeaders().putSingle("Cache-Control", "no-store");
        }
    }
}