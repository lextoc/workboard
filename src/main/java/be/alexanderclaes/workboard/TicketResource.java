package be.alexanderclaes.workboard;

import jakarta.validation.constraints.NotNull;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;
import java.util.UUID;

@Path("/api/tickets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TicketResource {
    @Inject
    TicketRepository ticketRepository;

    @GET
    public List<Ticket> getTickets() {
        return ticketRepository.findAll();
    }

    @GET
    @Path("/{id}")
    public Ticket getTicket(@PathParam("id") UUID id) {
        Ticket ticket = ticketRepository.findById(id);

        if (ticket == null) {
            throw new NotFoundException("Ticket not found.");
        }

        return ticket;
    }

    @Transactional
    @POST
    public Response create(@Valid @NotNull CreateTicketRequest request) {
        Ticket ticket = new Ticket();

        ticket.setTitle(request.title());
        ticket.setStatus(request.status());
        ticket.setBlocked(false);
        ticket.setBlockedNote(null);

        ticketRepository.persist(ticket);

        return Response.status(Response.Status.CREATED).entity(ticket).build();
    }

    @Transactional
    @PUT
    @Path("/{id}")
    public Ticket update(@PathParam("id") UUID id, @Valid @NotNull UpdateTicketRequest request) {
        Ticket ticket = ticketRepository.findById(id);

        if (ticket == null) {
            throw new NotFoundException("Ticket not found.");
        }

        if ((ticket.isBlocked() || request.blocked()) && request.status() == TicketStatus.DONE) {
            throw new BadRequestException(
                    "Unblock this ticket before moving it to DONE.");
        }

        if (request.blocked() && (request.blockedNote() == null || request.blockedNote().isBlank())) {
            throw new BadRequestException(
                    "Please provide a reason for blocking this ticket.");
        }

        ticket.setTitle(request.title());
        ticket.setStatus(request.status());
        ticket.setBlocked(request.blocked());
        ticket.setBlockedNote(request.blocked() ? request.blockedNote() : null);

        return ticket;
    }

    @Transactional
    @DELETE
    @Path("/{id}")
    public Response delete(@PathParam("id") UUID id) {
        boolean deleted = ticketRepository.deleteById(id);

        if (!deleted) {
            throw new NotFoundException("Ticket not found.");
        }

        return Response.noContent().build();
    }
}
