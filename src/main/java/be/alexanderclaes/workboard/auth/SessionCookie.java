package be.alexanderclaes.workboard.auth;

import io.vertx.core.http.Cookie;
import io.vertx.core.http.CookieSameSite;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class SessionCookie {
    @ConfigProperty(name = "app.auth.cookie-name")
    String name;

    @ConfigProperty(name = "app.auth.cookie-secure")
    boolean secure;

    public String read(RoutingContext context) {
        Cookie cookie = context.request().getCookie(name);
        return cookie == null ? null : cookie.getValue();
    }

    public void issue(RoutingContext context, String token) {
        context.response().addCookie(
                cookie(token, UserSession.LIFETIME.toSeconds())
        );
    }

    public void clear(RoutingContext context) {
        context.response().addCookie(cookie("", 0));
    }

    private Cookie cookie(String value, long maxAge) {
        return Cookie.cookie(name, value)
                .setPath("/")
                .setHttpOnly(true)
                .setSecure(secure)
                .setSameSite(CookieSameSite.LAX)
                .setMaxAge(maxAge);
    }
}