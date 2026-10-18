package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.ticket.BlockedNote;
import be.alexanderclaes.workboard.ticket.TicketTitle;
import com.fasterxml.jackson.databind.exc.ValueInstantiationException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

import java.util.Map;

@Provider
public class RequestExceptionMapper
        implements ExceptionMapper<WebApplicationException> {

    @Override
    public Response toResponse(WebApplicationException exception) {
        if (exception.getResponse().getStatus() == 400
                && exception.getCause() instanceof ValueInstantiationException failure) {

            Class<?> type = failure.getType().getRawClass();

            if ((type == TicketTitle.class || type == BlockedNote.class)
                    && failure.getCause() instanceof IllegalArgumentException reason) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .type(MediaType.APPLICATION_JSON_TYPE)
                        .entity(Map.of("message", reason.getMessage()))
                        .build();
            }
        }

        return exception.getResponse();
    }
}