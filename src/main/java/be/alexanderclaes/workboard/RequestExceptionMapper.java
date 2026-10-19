package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.ticket.BlockedNote;
import be.alexanderclaes.workboard.ticket.CreateTicketRequest;
import be.alexanderclaes.workboard.ticket.TicketTitle;
import be.alexanderclaes.workboard.ticket.UpdateTicketRequest;
import be.alexanderclaes.workboard.project.CreateProjectRequest;
import be.alexanderclaes.workboard.project.UpdateProjectRequest;
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

            if ((type == TicketTitle.class
                    || type == BlockedNote.class
                    || type == CreateTicketRequest.class
                    || type == UpdateTicketRequest.class
                    || type == CreateProjectRequest.class
                    || type == UpdateProjectRequest.class)
                    && failure.getCause() instanceof IllegalArgumentException reason) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .type(MediaType.APPLICATION_JSON_TYPE)
                        .entity(Map.of("message", reason.getMessage()))
                        .build();
            }
        }

        if (exception.getResponse().getStatus() == 404
                && !exception.getResponse().hasEntity()) {
            return Response.fromResponse(exception.getResponse())
                    .type(MediaType.APPLICATION_JSON_TYPE)
                    .entity(Map.of("message", exception.getMessage()))
                    .build();
        }

        return exception.getResponse();
    }
}