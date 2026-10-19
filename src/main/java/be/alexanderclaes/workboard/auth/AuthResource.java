package be.alexanderclaes.workboard.auth;

import io.quarkus.security.Authenticated;
import io.vertx.ext.web.RoutingContext;
import jakarta.annotation.security.PermitAll;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.sql.SQLException;
import java.util.Map;

@Path("/api/auth")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class AuthResource {
    @Inject
    AuthService auth;

    @Inject
    SessionCookie cookies;

    @Inject
    RoutingContext context;

    @Inject
    CurrentUser currentUser;

    @POST
    @Path("/register")
    @PermitAll
    public Response register(@NotNull @Valid RegisterRequest request) {
        try {
            return Response.status(Response.Status.CREATED)
                    .entity(auth.register(request))
                    .build();
        } catch (RuntimeException exception) {
            if (isUniqueViolation(exception)) {
                return Response.status(Response.Status.CONFLICT)
                        .entity(Map.of(
                                "message",
                                "Email is already registered."
                        ))
                        .build();
            }

            throw exception;
        }
    }

    @POST
    @Path("/login")
    @PermitAll
    public UserResponse login(@NotNull @Valid LoginRequest request) {
        AuthService.LoginResult result = auth.login(request);
        cookies.issue(context, result.token());

        return result.user();
    }

    @GET
    @Path("/me")
    @Authenticated
    public UserResponse me() {
        return auth.currentUser(currentUser.id());
    }

    @POST
    @Path("/logout")
    @Authenticated
    public Response logout() {
        auth.logout(cookies.read(context));
        cookies.clear(context);

        return Response.noContent().build();
    }

    private boolean isUniqueViolation(Throwable exception) {
        for (Throwable cause = exception;
             cause != null;
             cause = cause.getCause()) {
            if (cause instanceof SQLException sql
                    && "23505".equals(sql.getSQLState())) {
                return true;
            }
        }

        return false;
    }
}